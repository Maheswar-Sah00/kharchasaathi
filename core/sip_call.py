"""Place a real phone call over SIP (e.g. a Linphone account on sip.linphone.org) and speak a message.

Minimal SIP user agent (UDP): INVITE with digest auth (MD5/SHA-256, qop=auth, opaque) -> wait for answer ->
stream the text-to-speech audio as RTP (PCMU/PCMA) -> BYE. No registration needed for outgoing calls.
Text-to-speech uses the Windows built-in speech engine (System.Speech), so there are no extra dependencies.
"""
import base64, hashlib, hmac, os, random, re, socket, struct, subprocess, tempfile, time, uuid, wave

try:
    import audioop  # stdlib up to Python 3.12
except ImportError:  # pragma: no cover
    audioop = None

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
except ImportError:  # pragma: no cover
    Cipher = None


class CallError(Exception):
    pass


# ------------------------------------------------------------------ SRTP (RFC 3711), send side only
class Srtp:
    """AES_CM_128_HMAC_SHA1_80. Recent Linphone versions refuse unencrypted audio with 488."""
    SUITE = "AES_CM_128_HMAC_SHA1_80"

    def __init__(self, master_key: bytes, master_salt: bytes):
        self.key = self._derive(master_key, master_salt, 0, 16)
        self.auth = self._derive(master_key, master_salt, 1, 20)
        self.salt = self._derive(master_key, master_salt, 2, 14)

    @staticmethod
    def _ctr(key: bytes, iv: bytes, data: bytes) -> bytes:
        enc = Cipher(algorithms.AES(key), modes.CTR(iv)).encryptor()
        return enc.update(data) + enc.finalize()

    @classmethod
    def _derive(cls, master_key, master_salt, label, n):
        x = bytearray(master_salt)
        x[7] ^= label
        return cls._ctr(master_key, bytes(x) + b"\x00\x00", b"\x00" * n)

    def protect(self, header: bytes, payload: bytes, index: int) -> bytes:
        """Encrypt one RTP packet. `index` is the 48-bit packet index: rollover count << 16 | sequence number."""
        ssrc = struct.unpack("!I", header[8:12])[0]
        iv = int.from_bytes(self.salt + b"\x00\x00", "big") ^ (ssrc << 64) ^ (index << 16)
        body = header + self._ctr(self.key, iv.to_bytes(16, "big"), payload)
        roc = struct.pack("!I", (index >> 16) & 0xFFFFFFFF)
        return body + hmac.new(self.auth, body + roc, hashlib.sha1).digest()[:10]


COMPACT = {"v": "via", "f": "from", "t": "to", "i": "call-id", "m": "contact", "l": "content-length",
           "c": "content-type"}


# ------------------------------------------------------------------ text-to-speech
def tts_to_pcm16(text: str) -> bytes:
    """Speak `text` with Windows SAPI into 8 kHz 16-bit mono PCM. Female voice: Indian English if installed, else any English."""
    tmp = tempfile.mkdtemp(prefix="ks_tts_")
    txt, wav = os.path.join(tmp, "say.txt"), os.path.join(tmp, "say.wav")
    with open(txt, "w", encoding="utf-8") as f:
        f.write(text)
    ps = (
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "$f=$s.GetInstalledVoices()|?{$_.Enabled -and $_.VoiceInfo.Gender -eq 'Female'};"
        "$v=$f|?{$_.VoiceInfo.Culture.Name -eq 'en-IN'}|select -First 1;"
        "if(!$v){$v=$f|?{$_.VoiceInfo.Culture.Name -like 'en-*'}|select -First 1};"
        "if($v){$s.SelectVoice($v.VoiceInfo.Name)};"
        "$fmt=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(8000,"
        "[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono);"
        f"$s.SetOutputToWaveFile('{wav}',$fmt);$s.Rate=-1;"
        f"$s.Speak([IO.File]::ReadAllText('{txt}'));[Console]::Out.Write($s.Voice.Name);$s.Dispose()"
    )
    r = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0 or not os.path.exists(wav):
        raise CallError(f"Text-to-speech failed: {(r.stderr or r.stdout)[:300]}")
    with wave.open(wav, "rb") as w:
        rate, width, ch, pcm = w.getframerate(), w.getsampwidth(), w.getnchannels(), w.readframes(w.getnframes())
    if audioop:
        if ch == 2:
            pcm = audioop.tomono(pcm, width, 0.5, 0.5)
        if width != 2:
            pcm = audioop.lin2lin(pcm, width, 2)
        if rate != 8000:
            pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 8000, None)
    return pcm


def _ulaw_byte(s: int) -> int:
    bias, clip = 0x84, 32635
    sign = 0x80 if s < 0 else 0
    s = min(abs(s), clip) + bias
    exp, mask = 7, 0x4000
    while exp > 0 and not (s & mask):
        exp, mask = exp - 1, mask >> 1
    mant = (s >> (exp + 3)) & 0x0F
    return ~(sign | (exp << 4) | mant) & 0xFF


def encode(pcm16: bytes, pt: int) -> bytes:
    if audioop:
        return audioop.lin2ulaw(pcm16, 2) if pt == 0 else audioop.lin2alaw(pcm16, 2)
    samples = struct.unpack(f"<{len(pcm16) // 2}h", pcm16)
    return bytes(_ulaw_byte(s) for s in samples)  # PCMU only without audioop


# ------------------------------------------------------------------ helpers
def _local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def stun_public(sock: socket.socket, server=("stun.linphone.org", 3478)):
    """Best-effort public ip:port of `sock` (so the far end can send media back through NAT)."""
    try:
        tid = os.urandom(12)
        sock.sendto(struct.pack("!HHI", 1, 0, 0x2112A442) + tid, server)
        old = sock.gettimeout()
        sock.settimeout(2)
        data, _ = sock.recvfrom(2048)
        sock.settimeout(old)
        i = 20
        while i + 4 <= len(data):
            atype, alen = struct.unpack("!HH", data[i:i + 4])
            val = data[i + 4:i + 4 + alen]
            if atype in (0x0020, 0x0001) and val[1] == 1:
                port, ip = struct.unpack("!H", val[2:4])[0], val[4:8]
                if atype == 0x0020:
                    port ^= 0x2112
                    ip = bytes(a ^ b for a, b in zip(ip, struct.pack("!I", 0x2112A442)))
                return socket.inet_ntoa(ip), port
            i += 4 + alen + ((4 - alen % 4) % 4)
    except Exception:
        pass
    return None


def parse_sip(data: bytes):
    text = data.decode("utf-8", errors="replace")
    head, _, body = text.partition("\r\n\r\n")
    lines = head.split("\r\n")
    start = lines[0]
    h = {}
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            k = k.strip().lower()
            h.setdefault(COMPACT.get(k, k), []).append(v.strip())
    if start.startswith("SIP/2.0"):
        parts = start.split(" ", 2)
        return {"status": int(parts[1]), "reason": parts[2] if len(parts) > 2 else "", "method": None,
                "h": h, "body": body, "start": start}
    return {"status": None, "method": start.split(" ")[0], "h": h, "body": body, "start": start}


def _first(m, name, default=""):
    v = m["h"].get(name)
    return v[0] if v else default


def _tag(header_val: str):
    mt = re.search(r";\s*tag=([^;>\s]+)", header_val)
    return mt.group(1) if mt else None


def _uri_of(header_val: str):
    mt = re.search(r"<([^>]+)>", header_val)
    return mt.group(1) if mt else header_val.split(";")[0].strip()


def _route_list(values):
    out = []
    for v in values:
        out += re.findall(r"<[^>]+>[^,]*", v)
    return [r.strip() for r in out]


# ------------------------------------------------------------------ the call
class SipCall:
    def __init__(self, user, password, domain, target, display="Priya - KharchaSaathi", log=None, secure=False):
        self.user, self.password, self.domain, self.display = user, password, domain, display
        self.secure = bool(secure and Cipher)
        self.master = os.urandom(30) if self.secure else None  # 16-byte key + 14-byte salt, per call
        self.srtp = None
        self.target = target if target.startswith("sip:") else f"sip:{target}"
        self.log = log or (lambda *_: None)
        self.proxy = (socket.gethostbyname(domain), 5060)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("", 0))
        self.rtp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.rtp.bind(("", 0))
        self.ip, self.port = _local_ip(), self.sock.getsockname()[1]
        self.call_id = f"{uuid.uuid4().hex}@{self.ip}"
        self.from_tag = uuid.uuid4().hex[:10]
        self.to_tag, self.remote_target, self.route_set = None, self.target, []
        self.cseq = 0

    # ---- message building
    def _branch(self):
        return "z9hG4bK" + uuid.uuid4().hex[:16]

    def _req(self, method, uri, cseq, branch, extra=(), body="", routes=()):
        to = f"<{self.target}>" + (f";tag={self.to_tag}" if self.to_tag else "")
        L = [f"{method} {uri} SIP/2.0",
             f"Via: SIP/2.0/UDP {self.ip}:{self.port};branch={branch};rport",
             "Max-Forwards: 70",
             f'From: "{self.display}" <sip:{self.user}@{self.domain}>;tag={self.from_tag}',
             f"To: {to}", f"Call-ID: {self.call_id}", f"CSeq: {cseq} {method}"]
        L += [f"Route: {r}" for r in routes]
        L += [f"Contact: <sip:{self.user}@{self.ip}:{self.port};transport=udp>", "User-Agent: KharchaSaathi/1.0"]
        L += list(extra)
        if body:
            L.append("Content-Type: application/sdp")
        L.append(f"Content-Length: {len(body.encode())}")
        return "\r\n".join(L) + "\r\n\r\n" + body

    def _auth(self, chal_resp, method, uri):
        is_proxy = chal_resp["status"] == 407
        chal = _first(chal_resp, "proxy-authenticate" if is_proxy else "www-authenticate")
        p = {k: (a if a else b) for k, a, b in re.findall(r'(\w+)=(?:"([^"]*)"|([^\s,]+))', chal)}
        algo = p.get("algorithm", "MD5").upper()
        H = (lambda s: hashlib.sha256(s.encode()).hexdigest()) if algo.startswith("SHA-256") else \
            (lambda s: hashlib.md5(s.encode()).hexdigest())
        ha1, ha2 = H(f"{self.user}:{p['realm']}:{self.password}"), H(f"{method}:{uri}")
        val = f'Digest username="{self.user}", realm="{p["realm"]}", nonce="{p["nonce"]}", uri="{uri}", algorithm={algo}'
        if "auth" in [q.strip() for q in p.get("qop", "").split(",")]:
            nc, cnonce = "00000001", uuid.uuid4().hex[:16]
            val += f', response="{H(f"{ha1}:{p["nonce"]}:{nc}:{cnonce}:auth:{ha2}")}", qop=auth, nc={nc}, cnonce="{cnonce}"'
        else:
            val += f', response="{H(f"{ha1}:{p["nonce"]}:{ha2}")}"'
        if p.get("opaque"):
            val += f', opaque="{p["opaque"]}"'
        return f"{'Proxy-Authorization' if is_proxy else 'Authorization'}: {val}"

    def _send(self, text):
        self.sock.sendto(text.encode(), self.proxy)

    def _recv(self, timeout):
        self.sock.settimeout(max(timeout, 0.001))
        try:
            data, _ = self.sock.recvfrom(65535)
        except (socket.timeout, BlockingIOError, ConnectionResetError):
            return None
        if not data.strip():
            return None  # keep-alive
        return parse_sip(data)

    def _reply_ok(self, req):
        L = ["SIP/2.0 200 OK"] + [f"Via: {v}" for v in req["h"].get("via", [])]
        for k, name in (("from", "From"), ("to", "To"), ("call-id", "Call-ID"), ("cseq", "CSeq")):
            L.append(f"{name}: {_first(req, k)}")
        L.append("Content-Length: 0")
        self._send("\r\n".join(L) + "\r\n\r\n")

    def _sdp(self, rtp_ip, rtp_port):
        sid = random.randint(10 ** 6, 10 ** 9)
        pts = "0 8 101" if audioop else "0 101"
        lines = ["v=0", f"o=- {sid} {sid} IN IP4 {rtp_ip}", "s=KharchaSaathi reminder", f"c=IN IP4 {rtp_ip}", "t=0 0",
                 f"m=audio {rtp_port} RTP/{'SAVP' if self.secure else 'AVP'} {pts}", "a=rtpmap:0 PCMU/8000"]
        if audioop:
            lines.append("a=rtpmap:8 PCMA/8000")
        lines.append("a=rtpmap:101 telephone-event/8000")
        if self.secure:
            lines.append(f"a=crypto:1 {Srtp.SUITE} inline:{base64.b64encode(self.master).decode()}")
        lines.append("a=sendrecv")
        return "\r\n".join(lines) + "\r\n"

    # ---- the flow
    def place(self, pcm16: bytes, ring_timeout=45):
        pub = stun_public(self.rtp)
        rtp_ip, rtp_port = pub if pub else (self.ip, self.rtp.getsockname()[1])
        sdp = self._sdp(rtp_ip, rtp_port)
        self.cseq, branch, authed = 1, self._branch(), False
        auth_hdr = ()
        self._send(self._req("INVITE", self.target, self.cseq, branch, body=sdp))
        self.log("invite_sent", {"to": self.target, "media": f"{rtp_ip}:{rtp_port}"})
        deadline, ringing, answer = time.time() + ring_timeout, False, None
        while time.time() < deadline:
            m = self._recv(deadline - time.time())
            if not m:
                continue
            if m["method"]:
                if m["method"] in ("BYE", "CANCEL", "OPTIONS"):
                    self._reply_ok(m)
                continue
            if not _first(m, "cseq").endswith("INVITE") or not _first(m, "cseq").startswith(str(self.cseq)):
                continue
            st = m["status"]
            if st in (401, 407):
                self._ack_error(m, branch)
                if authed:
                    raise CallError("SIP login rejected - check LINPHONE_BOT_USER / LINPHONE_BOT_PASSWORD in .env")
                authed, self.cseq, branch = True, self.cseq + 1, self._branch()
                auth_hdr = (self._auth(m, "INVITE", self.target),)
                self._send(self._req("INVITE", self.target, self.cseq, branch, extra=auth_hdr, body=sdp))
                self.log("invite_auth_sent", {})
            elif st < 200:
                if st in (180, 183) and not ringing:
                    ringing = True
                    self.log("ringing", {})
            elif st < 300:
                answer = m
                break
            else:
                self._ack_error(m, branch)
                msg = {404: "No device is signed in at that SIP address (check the username and that Linphone is connected)",
                       480: "Phone is offline (open the Linphone app)",
                       486: "Busy / declined", 603: "Declined", 408: "No answer"}.get(st, m["reason"])
                raise CallError(f"Call failed: {st} {msg}")
        if not answer:
            self._cancel(branch, auth_hdr)
            raise CallError("No answer (timed out)")
        # dialog established
        self.to_tag = _tag(_first(answer, "to"))
        self.remote_target = _uri_of(_first(answer, "contact", f"<{self.target}>"))
        self.route_set = list(reversed(_route_list(answer["h"].get("record-route", []))))
        self._ack_2xx()
        self.log("answered", {})
        dest, pt = self._remote_media(answer["body"])
        if self.secure and re.search(r"^m=audio \d+ RTP/SAVP", answer["body"], re.M):
            self.srtp = Srtp(self.master[:16], self.master[16:])  # our offered key encrypts what we send
        hung_up = self._stream(pcm16, dest, pt, answer)
        if not hung_up:
            self._bye()
        return {"answered": True, "callee_hung_up": hung_up, "media_to": f"{dest[0]}:{dest[1]}", "codec": pt,
                "encrypted": bool(self.srtp)}

    def _ack_error(self, resp, branch):
        to = _first(resp, "to")
        L = [f"ACK {self.target} SIP/2.0", f"Via: SIP/2.0/UDP {self.ip}:{self.port};branch={branch};rport",
             "Max-Forwards: 70", f'From: "{self.display}" <sip:{self.user}@{self.domain}>;tag={self.from_tag}',
             f"To: {to}", f"Call-ID: {self.call_id}", f"CSeq: {self.cseq} ACK", "Content-Length: 0"]
        self._send("\r\n".join(L) + "\r\n\r\n")

    def _ack_2xx(self):
        self._send(self._req("ACK", self.remote_target, self.cseq, self._branch(), routes=self.route_set))

    def _cancel(self, branch, auth_hdr):
        L = [f"CANCEL {self.target} SIP/2.0", f"Via: SIP/2.0/UDP {self.ip}:{self.port};branch={branch};rport",
             "Max-Forwards: 70", f'From: "{self.display}" <sip:{self.user}@{self.domain}>;tag={self.from_tag}',
             f"To: <{self.target}>", f"Call-ID: {self.call_id}", f"CSeq: {self.cseq} CANCEL", *auth_hdr,
             "Content-Length: 0"]
        self._send("\r\n".join(L) + "\r\n\r\n")

    def _bye(self):
        self.cseq += 1
        branch = self._branch()
        self._send(self._req("BYE", self.remote_target, self.cseq, branch, routes=self.route_set))
        end = time.time() + 4
        while time.time() < end:
            m = self._recv(end - time.time())
            if m and m["status"] in (401, 407) and _first(m, "cseq").endswith("BYE"):
                self.cseq += 1
                self._send(self._req("BYE", self.remote_target, self.cseq, self._branch(), routes=self.route_set,
                                     extra=(self._auth(m, "BYE", self.remote_target),)))
            elif m and m["status"] and _first(m, "cseq").endswith("BYE"):
                break
        self.log("hung_up", {})

    @staticmethod
    def _remote_media(sdp):
        ip = re.search(r"^c=IN IP4 (\S+)", sdp, re.M)
        ma = re.search(r"^m=audio (\d+) RTP/\S+ ([\d ]+)", sdp, re.M)
        if not ip or not ma:
            raise CallError("Answer had no audio description")
        pts = [int(x) for x in ma.group(2).split()]
        pt = next((p for p in pts if p in (0, 8)), 0)
        if pt == 8 and not audioop:
            pt = 0
        return (ip.group(1), int(ma.group(1))), pt

    def _stream(self, pcm16, dest, pt, answer):
        lead = b"\x00\x00" * 8000  # 1 s of silence while the audio path opens
        tail = b"\x00\x00" * 4000
        payload = encode(lead + pcm16 + tail, pt)
        # sequence starts in the lower half so the receiver can't misjudge the SRTP rollover count
        seq, ts, ssrc = random.randint(0, 32767), random.randint(0, 2 ** 31), random.randint(0, 2 ** 31)
        self.sock.setblocking(False)
        nxt = time.time()
        for i in range(0, len(payload), 160):
            frame = payload[i:i + 160].ljust(160, b"\xff" if pt == 0 else b"\xd5")
            hdr = struct.pack("!BBHII", 0x80, (0x80 if i == 0 else 0) | pt, seq & 0xFFFF, ts & 0xFFFFFFFF, ssrc)
            self.rtp.sendto(self.srtp.protect(hdr, frame, seq) if self.srtp else hdr + frame, dest)
            seq, ts = seq + 1, ts + 160
            try:  # drain incoming RTP and watch for BYE
                self.rtp.setblocking(False)
                while True:
                    self.rtp.recv(2048)
            except (BlockingIOError, ConnectionResetError, OSError):
                pass
            try:
                data, _ = self.sock.recvfrom(65535)
                m = parse_sip(data) if data.strip() else None
                if m and m["method"] == "BYE":
                    self._reply_ok(m)
                    self.log("callee_hung_up", {})
                    return True
                if m and m["status"] == 200 and _first(m, "cseq").endswith("INVITE"):
                    self._ack_2xx()  # 200 OK retransmission
            except (BlockingIOError, ConnectionResetError, OSError):
                pass
            nxt += 0.02
            time.sleep(max(0.0, nxt - time.time()))
        self.sock.setblocking(True)
        return False


def call_and_speak(text, user, password, domain, target, log=None, ring_timeout=45):
    pcm = tts_to_pcm16(text)
    # Encrypted audio first; phones that refuse it (488) get a second call attempt without encryption.
    for secure in ((True, False) if Cipher else (False,)):
        c = SipCall(user, password, domain, target, log=log, secure=secure)
        try:
            return c.place(pcm, ring_timeout=ring_timeout)
        except CallError as e:
            if not (secure and " 488 " in f" {e} "):
                raise
            if log:
                log("retry_without_encryption", {})
        finally:
            c.sock.close()
            c.rtp.close()
