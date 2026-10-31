"""KharchaSaathi web server (FastAPI). Run:  python server.py   ->  http://localhost:8000"""
import json, os, queue, re, threading, time, uuid
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core import db, agent, emails, categorize, safety, llm, parsers

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
UPLOADS = os.path.join(ROOT, "data_store", "uploads")
GT = json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
app = FastAPI(title="KharchaSaathi")
import api_actions  # noqa: E402  backend product actions (see docs/API.md)
app.include_router(api_actions.router)
import api_reminders  # noqa: E402  reminder phone calls (Linphone/SIP), page: /web/call.html
app.include_router(api_reminders.router)
app.mount("/web", StaticFiles(directory=WEB), name="web")
_run_lock = threading.Lock()


@app.get("/")
def index():
    return FileResponse(os.path.join(WEB, "index.html"), headers={"Cache-Control": "no-cache"})


@app.get("/legacy")
def legacy():
    """The previous single-file dashboard, kept for comparison."""
    return FileResponse(os.path.join(WEB, "legacy.html"))


# ---------------- statement files ----------------
def _file_info(path):
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    return {"name": name, "size": os.path.getsize(path), "type": ext.lstrip("."),
            "kind": "Bank statement" if ext == ".csv" else "Card statement"}


def _batch_files(batch):
    """Uploaded files for a batch id, or the sample files when batch is empty."""
    if not batch:
        return agent.default_files()
    if not re.fullmatch(r"[a-f0-9]{12}", batch or ""):
        raise HTTPException(400, "Bad upload id")
    d = os.path.join(UPLOADS, batch)
    if not os.path.isdir(d):
        raise HTTPException(404, "Upload not found. Please upload your files again.")
    files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith((".csv", ".pdf")))
    if not files:
        raise HTTPException(400, "No CSV or PDF files in this upload")
    return files


@app.get("/api/files")
def sample_files():
    """The sample statements that ship with the demo (Arjun, 24, Bengaluru)."""
    return {"profile": GT["user_profile"], "files": [_file_info(f) for f in agent.default_files()]}


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    batch = uuid.uuid4().hex[:12]
    d = os.path.join(UPLOADS, batch)
    os.makedirs(d, exist_ok=True)
    saved, skipped = [], []
    for f in files:
        name = os.path.basename(f.filename or "")
        name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:120]
        if not name.lower().endswith((".csv", ".pdf")):
            skipped.append({"name": name, "reason": "Only CSV and PDF files are supported"})
            continue
        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            skipped.append({"name": name, "reason": "File is bigger than 10 MB"})
            continue
        p = os.path.join(d, name)
        with open(p, "wb") as out:
            out.write(data)
        saved.append(_file_info(p))
    if not saved:
        raise HTTPException(400, {"message": "No usable files", "skipped": skipped})
    return {"batch": batch, "files": saved, "skipped": skipped}


class PreviewReq(BaseModel):
    batch: str | None = None


@app.post("/api/preview")
def preview(req: PreviewReq):
    """Fast check of each file before the audit (no AI calls): rows read, months, rows set aside, errors."""
    out = []
    for path in _batch_files(req.batch):
        info = _file_info(path)
        try:
            rows, quarantined = parsers.parse_file(path)
            months = sorted({r["date"][:7] for r in rows})
            info.update(ok=True, transactions=len(rows), months=months,
                        debits=round(sum(r["amount"] for r in rows if r["direction"] == "DR"), 2),
                        quarantined=[{"reason": q["reason"], "raw": q["raw"][:220]} for q in quarantined])
        except parsers.ParseError as e:
            info.update(ok=False, error=str(e), transactions=0, months=[], quarantined=[])
        out.append(info)
    return {"files": out}


# ---------------- the agent ----------------
class RunReq(BaseModel):
    goal: str
    savings_target: float = 40
    notes: str = ""
    batch: str | None = None


def _sse(events_iter):
    def gen():
        for e in events_iter:
            yield "data: " + json.dumps(e, default=str, ensure_ascii=False) + "\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/run")
def run(req: RunReq):
    files = _batch_files(req.batch)
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(409, "An audit is already running")
    q: "queue.Queue" = queue.Queue()
    profile = dict(GT["user_profile"], notes=req.notes or GT["user_profile"]["notes"])

    def worker():
        try:
            agent.run(req.goal, files=files, profile=profile, savings_target=req.savings_target, on_event=q.put)
        except Exception as e:  # surface, never crash the stream
            q.put({"type": "error", "text": f"{type(e).__name__}: {e}"})
            q.put({"type": "final", "text": "", "run_id": db.latest_run_id(), "questions": [], "llm_calls": llm.CALLS["n"]})
        finally:
            _run_lock.release()

    threading.Thread(target=worker, daemon=True).start()

    def events():
        while True:
            e = q.get()
            yield e
            if e.get("type") == "final":
                break

    return _sse(events())


def _replay_events(run_id):
    """Rebuild the live event stream of a finished run from its audit log."""
    rows = db.q("SELECT event, detail FROM audit_log WHERE run_id=? ORDER BY id", (run_id,))
    questions = []
    for r in rows:
        ev, raw = r["event"], r["detail"] or ""
        try:
            d = json.loads(raw)
        except Exception:
            d = {"note": raw[:300]}
        if ev == "goal":
            yield {"type": "goal", "text": raw}
        elif ev == "refused_request":
            yield {"type": "refusal", "text": d.get("reason", "") if isinstance(d, dict) else str(d)}
        elif ev == "tool_call:update_plan":
            yield {"type": "replan" if d.get("is_replan") else "plan", "steps": d.get("steps", []), "reason": d.get("reason", "")}
        elif ev.startswith("tool_call:"):
            yield {"type": "tool_call", "name": ev.split(":", 1)[1], "input": d}
        elif ev.startswith("result:") and ev != "result:update_plan":
            yield {"type": "tool_result", "name": ev.split(":", 1)[1], "output": d,
                   "is_error": isinstance(d, dict) and "error" in d}
        elif ev == "ask_user":
            questions.append(d)
    run_row = db.q("SELECT * FROM runs WHERE id=?", (run_id,), one=True) or {}
    yield {"type": "final", "text": run_row.get("summary") or "", "run_id": run_id, "questions": questions,
           "llm_calls": None, "replay": True}


@app.get("/api/replay")
def replay(run_id: int | None = None, speed: float = 1.0):
    """Replays a finished run as a live stream (no AI calls, no cost). Used by demos."""
    rid = run_id or db.latest_run_id()
    if not rid:
        raise HTTPException(404, "No finished audit to replay yet")
    pause = {"goal": 0.3, "plan": 1.2, "replan": 1.4, "tool_call": 0.45, "tool_result": 0.7, "refusal": 1.0, "final": 0.4}
    speed = min(max(speed, 0.1), 20)

    def events():
        for e in _replay_events(rid):
            time.sleep(pause.get(e["type"], 0.4) / speed)
            yield e

    return _sse(events())


@app.get("/api/state")
def state():
    rid = db.latest_run_id()
    out = {"profile": GT["user_profile"], "categories": categorize.CATEGORIES,
           "demo_inbox": os.environ.get("DEMO_INBOX", ""), "model": llm.MODEL,
           "corrections": db.q("SELECT * FROM corrections ORDER BY created_at DESC"),
           "cancellations": db.q("SELECT * FROM cancellations"), "run": None}
    if not rid:
        return out
    run = db.q("SELECT * FROM runs WHERE id=?", (rid,), one=True)
    tx = db.q("SELECT * FROM transactions WHERE run_id=? ORDER BY date, id", (rid,))
    for t in tx:
        t["display_description"] = safety.sanitize(t["description"]) if t["flags"] == "prompt_injection" else t["description"]
    findings = db.q("SELECT * FROM findings WHERE run_id=? ORDER BY id", (rid,))
    for f in findings:
        f["details"] = json.loads(f["details"])
    out.update(run=run, transactions=tx, findings=findings,
               drafts=db.q("SELECT * FROM drafts WHERE run_id=? ORDER BY id", (rid,)),
               quarantine=db.q("SELECT * FROM quarantine WHERE run_id=?", (rid,)),
               parse_failures=[json.loads(x["detail"]) for x in
                               db.q("SELECT detail FROM audit_log WHERE run_id=? AND event='parse_failed'", (rid,))],
               questions=[json.loads(x["detail"]) for x in
                          db.q("SELECT detail FROM audit_log WHERE run_id=? AND event='ask_user'", (rid,))],
               audit=db.q("SELECT ts, actor, event, detail FROM audit_log WHERE run_id=? OR run_id IS NULL ORDER BY id DESC LIMIT 400", (rid,)))
    return out


class CorrReq(BaseModel):
    merchant: str
    category: str


@app.post("/api/correction")
def correction(req: CorrReq):
    if req.category not in categorize.CATEGORIES:
        raise HTTPException(400, "Unknown category")
    rid = db.latest_run_id()
    ex = db.q("SELECT description FROM transactions WHERE run_id=? AND merchant=? LIMIT 1", (rid, req.merchant), one=True)
    db.save_correction(req.merchant, req.category, ex["description"] if ex else "")
    db.x("UPDATE transactions SET category=?, cat_source='memory', confidence=1.0, reason='Your correction' "
         "WHERE run_id=? AND merchant=?", (req.category, rid, req.merchant))
    cnt = db.q("SELECT COUNT(*) AS n FROM transactions WHERE run_id=? AND merchant=?", (rid, req.merchant), one=True)["n"]
    return {"ok": True, "updated": cnt}


class DraftEdit(BaseModel):
    subject: str | None = None
    body: str | None = None


@app.post("/api/drafts/{did}/approve")
def approve(did: int, req: DraftEdit):
    try:
        emails.approve(did, req.subject, req.body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        resp = emails.send(did)
        return {"ok": True, "sent": True, "id": resp.get("id")}
    except PermissionError as e:
        return {"ok": False, "sent": False, "blocked": True, "error": str(e)}
    except Exception as e:
        return {"ok": False, "sent": False, "error": str(e)}


@app.post("/api/drafts/{did}/send")
def send_only(did: int):
    """Used by 'try sending without approval' and by retry after approval."""
    try:
        resp = emails.send(did)
        return {"ok": True, "sent": True, "id": resp.get("id")}
    except PermissionError as e:
        return {"ok": False, "blocked": True, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/drafts/{did}/reject")
def reject(did: int):
    emails.reject(did)
    return {"ok": True}


@app.post("/api/policy")
def policy(req: RunReq):
    ok, reason = safety.policy_check(req.goal)
    return {"allowed": ok, "reason": reason}


@app.post("/api/reset")
def reset():
    db.reset_all()
    return {"ok": True}


@app.get("/api/eval")
def eval_results():
    p = os.path.join(ROOT, "eval", "results.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8000)))
