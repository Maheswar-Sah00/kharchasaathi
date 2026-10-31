"""KharchaSaathi web server (FastAPI). Run:  python server.py   ->  http://localhost:8000"""
import json, os, queue, threading
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from core import db, agent, emails, categorize, safety, llm

ROOT = os.path.dirname(os.path.abspath(__file__))
GT = json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))
app = FastAPI(title="KharchaSaathi")
_run_lock = threading.Lock()


@app.get("/")
def index():
    return FileResponse(os.path.join(ROOT, "web", "index.html"))


class RunReq(BaseModel):
    goal: str
    savings_target: float = 40
    notes: str = ""


@app.post("/api/run")
def run(req: RunReq):
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(409, "An audit is already running")
    q: "queue.Queue" = queue.Queue()
    profile = dict(GT["user_profile"], notes=req.notes or GT["user_profile"]["notes"])

    def worker():
        try:
            agent.run(req.goal, profile=profile, savings_target=req.savings_target, on_event=q.put)
        except Exception as e:  # surface, never crash the stream
            q.put({"type": "error", "text": f"{type(e).__name__}: {e}"})
            q.put({"type": "final", "text": "", "run_id": db.latest_run_id(), "questions": [], "llm_calls": llm.CALLS["n"]})
        finally:
            _run_lock.release()

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            e = q.get()
            yield "data: " + json.dumps(e, default=str, ensure_ascii=False) + "\n\n"
            if e.get("type") == "final":
                break

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
    n = db.x("UPDATE transactions SET category=?, cat_source='memory', confidence=1.0, reason='Your correction' "
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
    except RuntimeError as e:
        return {"ok": False, "sent": False, "error": str(e)}


@app.post("/api/drafts/{did}/send")
def send_only(did: int):
    """Used by 'try sending without approval' and by retry after approval."""
    try:
        resp = emails.send(did)
        return {"ok": True, "sent": True, "id": resp.get("id")}
    except PermissionError as e:
        return {"ok": False, "blocked": True, "error": str(e)}
    except RuntimeError as e:
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
    uvicorn.run(app, host="127.0.0.1", port=8000)
