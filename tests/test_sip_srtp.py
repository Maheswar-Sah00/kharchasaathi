"""Reminder calls: SRTP against the RFC 3711 test vectors, and the encrypted-then-plain call fallback."""
import base64, hashlib, hmac, re, struct
import pytest
from core import sip_call as S


def test_key_derivation_matches_rfc3711_appendix_b3():
    s = S.Srtp(bytes.fromhex("E1F97A0D3E018BE0D64FA32C06DE4139"), bytes.fromhex("0EC675AD498AFEEBB6960B3AABE6"))
    assert s.key.hex().upper() == "C61E7A93744F39EE10734AFE3FF7A087"
    assert s.salt.hex().upper() == "30CBBC08863D8C85D49DB34A9AE1"
    assert s.auth.hex().upper() == "CEBE321F6FF7716B6FD4AB49AF256A156D38BAA4"


def test_keystream_matches_rfc3711_appendix_b2():
    s = S.Srtp(b"\x00" * 16, b"\x00" * 14)
    s.key = bytes.fromhex("2B7E151628AED2A6ABF7158809CF4F3C")
    s.salt = bytes.fromhex("F0F1F2F3F4F5F6F7F8F9FAFBFCFD")
    hdr = struct.pack("!BBHII", 0x80, 0, 0, 0, 0)  # SSRC 0, index 0
    out = s.protect(hdr, b"\x00" * 16, 0)
    assert out[12:28].hex().upper() == "E03EAD0935C95E80E166B16DD92B4EB4"


def test_packet_layout_and_auth_tag_covers_rollover_count():
    s = S.Srtp(bytes(range(16)), bytes(range(14)))
    hdr = struct.pack("!BBHII", 0x80, 0, 7, 160, 1234)
    frame = b"\xff" * 160
    a = s.protect(hdr, frame, 7)
    assert a[:12] == hdr and len(a) == 12 + 160 + 10 and a[12:172] != frame
    assert a[-10:] == hmac.new(s.auth, a[:-10] + b"\x00\x00\x00\x00", hashlib.sha1).digest()[:10]
    b = s.protect(hdr, frame, 7 + (1 << 16))  # same sequence number, next rollover: different keystream and tag
    assert b[12:172] != a[12:172] and b[-10:] != a[-10:]


def _call(monkeypatch, **kw):
    monkeypatch.setattr(S.socket, "gethostbyname", lambda _: "127.0.0.1")
    return S.SipCall("bot", "pw", "example.org", "sip:phone@example.org", **kw)


def test_offer_advertises_encryption_only_when_secure(monkeypatch):
    c = _call(monkeypatch, secure=True)
    sdp = c._sdp("1.2.3.4", 4000)
    assert "RTP/SAVP" in sdp
    key = re.search(r"a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:(\S+)", sdp).group(1)
    assert base64.b64decode(key) == c.master and len(c.master) == 30
    plain = _call(monkeypatch)._sdp("1.2.3.4", 4000)
    assert "RTP/AVP" in plain and "a=crypto" not in plain


def test_refused_encryption_retries_plain_and_other_errors_do_not(monkeypatch):
    monkeypatch.setattr(S, "tts_to_pcm16", lambda _: b"\x00\x00")
    monkeypatch.setattr(S.socket, "gethostbyname", lambda _: "127.0.0.1")
    seen = []

    def place(self, pcm, ring_timeout=45):
        seen.append(self.secure)
        if self.secure:
            raise S.CallError(error)
        return {"answered": True}

    monkeypatch.setattr(S.SipCall, "place", place)
    error = "Call failed: 488 Not acceptable here"
    assert S.call_and_speak("hi", "bot", "pw", "example.org", "sip:p@example.org") == {"answered": True}
    assert seen == [True, False]
    seen.clear()
    error = "Call failed: 486 Busy / declined"
    with pytest.raises(S.CallError):
        S.call_and_speak("hi", "bot", "pw", "example.org", "sip:p@example.org")
    assert seen == [True]


def test_caller_is_priya_in_template_scripts():
    from core import reminders as R
    renewal = R._fallback("renewal", "Arjun", [{"display": "Netflix", "days_left": 5, "amount": 649, "risk": ""}])
    assert "this is Priya from KharchaSaathi" in renewal
    monthly = R._fallback("monthly", "Arjun", {"avg_monthly_spend": 1, "subscription_count": 1, "subscriptions_per_month": 1,
                                               "money_to_recover": 1, "emails_waiting_for_approval": 1})
    assert "this is Priya from KharchaSaathi" in monthly
