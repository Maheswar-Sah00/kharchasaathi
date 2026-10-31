"""'Ask KharchaSaathi' chat endpoints (included by api_actions.router, so server.py needs no change)."""
import json, os, queue, threading
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import chat

ROOT = os.path.dirname(os.path.abspath(__file__))
PROFILE = json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))["user_profile"]
router = APIRouter()


class ChatReq(BaseModel):
    message: str
    session_id: str | None = None


@router.post("/chat")
def ask(req: ChatReq):
    """Server-sent events: tool_call / tool_result / refusal, then a final {type:'answer', text, session_id}."""
    q: "queue.Queue" = queue.Queue()

    def worker():
        try:
            chat.ask(req.message[:2000], req.session_id, PROFILE, on_event=q.put)
        except Exception as e:
            q.put({"type": "answer", "text": f"Sorry, something went wrong ({type(e).__name__}).", "session_id": req.session_id,
                   "error": str(e)})

    threading.Thread(target=worker, daemon=True).start()

    def gen():
        while True:
            e = q.get()
            yield "data: " + json.dumps(e, default=str, ensure_ascii=False) + "\n\n"
            if e.get("type") == "answer":
                break
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/chat/sync")
def ask_sync(req: ChatReq):
    """Same as /chat but returns one JSON object (handy for simple UIs and testing)."""
    trace = []
    sid, answer = chat.ask(req.message[:2000], req.session_id, PROFILE, on_event=trace.append)
    return {"session_id": sid, "answer": answer,
            "tools_used": [e["name"] for e in trace if e["type"] == "tool_call"],
            "refused": any(e["type"] == "refusal" for e in trace)}


@router.get("/chat/{session_id}")
def chat_history(session_id: str):
    return {"session_id": session_id, "messages": chat.history(session_id)}


SUGGESTIONS = ["How much did I spend on food in September?", "Which subscriptions renew in the next 7 days?",
               "What are my biggest money leaks?", "Did any price go up?", "Draft a dispute for the Netflix double charge",
               "What changed since my last audit?"]


@router.get("/chat-suggestions")
def suggestions():
    return {"suggestions": SUGGESTIONS}
