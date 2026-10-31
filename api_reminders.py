"""Reminder-call API (phone call before renewals + monthly check-in). Mounted by server.py:
    app.include_router(api_reminders.router)
"""
import json, os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import reminders

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME = json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))["user_profile"]["name"].split()[0]
router = APIRouter(prefix="/api/reminders", tags=["reminders"])


class ScriptReq(BaseModel):
    mode: str = "renewal"  # renewal | monthly
    days_ahead: int | None = None  # default: the saved "within N days" setting


class CallReq(BaseModel):
    script: str
    mode: str = "manual"


class SettingsReq(BaseModel):
    enabled: bool
    days_before: int = 7
    monthly: bool = True
    after_audit: bool | None = None


@router.get("")
def overview():
    cfg, missing = reminders.config()
    return {"configured": not missing, "missing": missing, "call_to": cfg["call_to"], "caller": cfg["user"],
            "settings": reminders.settings(), "upcoming": reminders.upcoming(),
            "due_today": reminders.due_calls(), "recent_calls": reminders.recent_calls()}


@router.post("/script")
def script(req: ScriptReq):
    if req.mode not in ("renewal", "monthly"):
        raise HTTPException(400, "mode must be renewal or monthly")
    return reminders.make_script(req.mode, name=NAME, days_ahead=req.days_ahead or reminders.settings()["days_before"])


@router.post("/call")
def call(req: CallReq):
    """Calls ONLY the allowlisted LINPHONE_CALL_TO address. The request cannot choose who to call."""
    try:
        return reminders.place_call(req.script, mode=req.mode, key=f"manual:{req.mode}")
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@router.post("/settings")
def save(req: SettingsReq):
    return reminders.save_settings(req.enabled, req.days_before, req.monthly, req.after_audit)


@router.post("/check-now")
def check_now():
    """Run the automatic scheduler once right now (same logic as the 30-minute background check)."""
    s = reminders.settings()
    if not s or not s["enabled"]:
        return {"enabled": False, "due": [], "results": [], "note": "Automatic calls are off. Switch them on first."}
    due = reminders.due_calls()
    return {"enabled": True, "due": due, "results": reminders._tick(name=NAME) if due else [],
            "note": "" if due else "Nothing is due today with these settings."}


reminders.start_scheduler(name=NAME)
