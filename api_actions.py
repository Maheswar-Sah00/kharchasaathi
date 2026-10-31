"""KharchaSaathi product API (backend actions). Mounted by server.py via:  app.include_router(api_actions.router)

All endpoints are JSON. See docs/API.md for the contract used by the frontend.
"""
import json, os, re
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import db, agent, parsers, detectors, emails, categorize

ROOT = os.path.dirname(os.path.abspath(__file__))
UPLOADS = os.path.join(ROOT, "data_store", "uploads")
GT_PROFILE = json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))["user_profile"]
router = APIRouter(prefix="/api", tags=["actions"])

DEFAULT_EMAIL_KIND = {"duplicate": "dispute", "zombie_charge": "refund", "trial_conversion": "cancellation",
                      "subscription": "cancellation", "price_hike": "cancellation", "bank_fee_hike": "dispute"}
ACTIONABLE = set(DEFAULT_EMAIL_KIND) - {"subscription"}


# ---------------------------------------------------------------- helpers
def _resolve(name: str, batch: str | None):
    name = os.path.basename(name or "")
    if batch:
        if not re.fullmatch(r"[a-f0-9]{12}", batch):
            raise HTTPException(400, "Bad upload id")
        p = os.path.join(UPLOADS, batch, name)
    else:
        p = os.path.join(ROOT, "data", name)
    if not os.path.isfile(p):
        raise HTTPException(404, f"File not found: {name}")
    return p


def _run_id(run_id=None):
    rid = run_id or db.latest_run_id()
    if not rid:
        raise HTTPException(404, "No audit has been run yet")
    return rid


def _finding(fid):
    f = db.q("SELECT * FROM findings WHERE id=?", (fid,), one=True)
    if not f:
        raise HTTPException(404, "Finding not found")
    f["details"] = json.loads(f["details"])
    return f


def _status(f, dismissals, drafts_by_finding):
    if f["kind"] in ("budget", "duplicate_rejected"):
        return None
    k = db.dismissal_key(f["kind"], f["merchant"], f["amount"] if f["kind"] == "duplicate" else None)
    if k in dismissals or f"{f['kind']}:{f['merchant']}" in dismissals:
        return "dismissed"
    d = drafts_by_finding.get(f["id"])
    if d:
        return {"PENDING_APPROVAL": "draft_pending", "APPROVED": "approved", "SENT": "email_sent",
                "REJECTED": "draft_rejected"}[d["status"]]
    return "open"


# ---------------------------------------------------------------- statements: passwords & layouts
class PasswordReq(BaseModel):
    name: str
    password: str
    batch: str | None = None


@router.post("/statements/unlock")
def unlock_pdf(req: PasswordReq):
    """Validate a PDF password and keep it in server memory only (never written to disk or logs)."""
    p = _resolve(req.name, req.batch)
    if not p.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF statements can be password-protected")
    if not parsers.set_password(p, req.password):
        db.log(None, "user", "pdf_unlock_failed", {"file": req.name})
        return {"ok": False, "unlocked": False, "error": "Wrong password. Indian banks usually use the first 4 "
                "letters of your name (capitals) + your birth date as DDMM, e.g. ARJU1402."}
    db.log(None, "user", "pdf_unlocked", {"file": req.name})
    rows, quarantined = parsers.parse_file(p)
    return {"ok": True, "unlocked": True, "transactions": len(rows), "months": sorted({r["date"][:7] for r in rows}),
            "quarantined": len(quarantined)}


@router.get("/statements/status")
def statement_status(name: str, batch: str | None = None):
    """How a statement will be read: ok / needs_password / unknown_format / corrupted, plus CSV layout details."""
    p = _resolve(name, batch)
    out = {"name": os.path.basename(p), "encrypted": p.lower().endswith(".pdf") and parsers.is_encrypted_pdf(p),
           "unlocked": parsers.has_password(p)}
    if p.lower().endswith(".csv"):
        out["layout"] = parsers.detect_csv_layout(p)
    try:
        rows, quarantined = parsers.parse_file(p)
        out.update(status="ok", transactions=len(rows), quarantined=len(quarantined))
    except parsers.ParseError as e:
        out.update(status=e.code, error=str(e))
    return out


class FileReq(BaseModel):
    name: str
    batch: str | None = None


@router.post("/statements/learn-format")
def learn_format(req: FileReq):
    """Use Claude to infer an unknown bank CSV layout; validated by parsing, then remembered."""
    p = _resolve(req.name, req.batch)
    try:
        return {"ok": True, **parsers.learn_csv_format(p)}
    except parsers.ParseError as e:
        return {"ok": False, **e.to_dict()}


# ---------------------------------------------------------------- findings & actions
@router.get("/findings")
def findings(run_id: int | None = None):
    """All findings of a run with action status: open | draft_pending | approved | email_sent | draft_rejected | dismissed."""
    rid = _run_id(run_id)
    dis = db.get_dismissals()
    drafts = {d["finding_id"]: d for d in db.q("SELECT * FROM drafts WHERE run_id=? ORDER BY id", (rid,))}
    out = []
    for f in db.q("SELECT * FROM findings WHERE run_id=? ORDER BY id", (rid,)):
        f["details"] = json.loads(f["details"])
        f["status"] = _status(f, dis, drafts)
        f["draft_id"] = drafts.get(f["id"], {}).get("id")
        f["suggested_email"] = DEFAULT_EMAIL_KIND.get(f["kind"])
        f["can_dismiss"] = f["kind"] in ACTIONABLE
        out.append(f)
    return {"run_id": rid, "findings": out}


class DraftReq(BaseModel):
    kind: str | None = None


@router.post("/findings/{fid}/draft")
def draft_for_finding(fid: int, req: DraftReq):
    """On-demand: the user asks for an email for any finding. Saved as PENDING_APPROVAL (never auto-sent)."""
    f = _finding(fid)
    kind = req.kind or DEFAULT_EMAIL_KIND.get(f["kind"])
    if kind not in emails.KIND_GUIDE:
        raise HTTPException(400, f"No email type for finding kind '{f['kind']}'")
    existing = db.q("SELECT * FROM drafts WHERE finding_id=? AND kind=? AND status='PENDING_APPROVAL'", (fid, kind), one=True)
    if existing:
        return {"ok": True, "draft_id": existing["id"], "existing": True, "subject": existing["subject"]}
    sent = emails.already_sent(f["kind"], f["merchant"], f["amount"], kind)
    if sent:
        return {"ok": False, "already_sent": True, "subject": sent["subject"], "sent_at": sent["decided_at"]}
    details = dict(f["details"], id=fid)
    did, out = emails.draft(f["run_id"], details, kind, GT_PROFILE)
    db.log(f["run_id"], "user", "draft_requested", {"finding_id": fid, "kind": kind, "draft_id": did})
    return {"ok": True, "draft_id": did, "status": "PENDING_APPROVAL", "subject": out["subject"]}


class DismissReq(BaseModel):
    reason: str = "Expected - not a problem"


@router.post("/findings/{fid}/dismiss")
def dismiss(fid: int, req: DismissReq):
    """'This is expected': remembered, so the same finding is suppressed in future audits."""
    f = _finding(fid)
    if f["kind"] not in ACTIONABLE:
        raise HTTPException(400, "This finding can't be dismissed")
    k = db.save_dismissal(f["kind"], f["merchant"], f["amount"] if f["kind"] == "duplicate" else None, req.reason)
    for d in db.q("SELECT id FROM drafts WHERE finding_id=? AND status='PENDING_APPROVAL'", (fid,)):
        emails.reject(d["id"])
    return {"ok": True, "memory_key": k, "applies_to_future_runs": True}


# ---------------------------------------------------------------- subscriptions
class DecisionReq(BaseModel):
    decision: str  # keep | cancel
    note: str = ""


@router.post("/subscriptions/{merchant}/decision")
def sub_decision(merchant: str, req: DecisionReq):
    """keep: never recommended for cancellation again. cancel: drafts a cancellation email for approval."""
    if req.decision not in ("keep", "cancel"):
        raise HTTPException(400, "decision must be 'keep' or 'cancel'")
    db.save_sub_decision(merchant, req.decision, req.note)
    out = {"ok": True, "merchant": merchant, "decision": req.decision}
    if req.decision == "cancel":
        rid = _run_id()
        f = db.q("SELECT id FROM findings WHERE run_id=? AND kind='subscription' AND merchant=? ORDER BY id DESC LIMIT 1",
                 (rid, merchant), one=True)
        if f:
            out.update(draft_for_finding(f["id"], DraftReq(kind="cancellation")))
            out["ok"] = True
    return out


class CancelledReq(BaseModel):
    cancelled_on: str  # YYYY-MM-DD


@router.post("/subscriptions/{merchant}/cancelled")
def mark_cancelled(merchant: str, req: CancelledReq):
    """User confirms they cancelled. Any later charge from this merchant is flagged as 'charged after cancellation'."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", req.cancelled_on):
        raise HTTPException(400, "cancelled_on must be YYYY-MM-DD")
    db.save_cancellation(merchant, req.cancelled_on, "confirmed by user in app")
    db.log(None, "user", "subscription_cancelled", {"merchant": merchant, "cancelled_on": req.cancelled_on})
    return {"ok": True}


@router.get("/renewals")
def renewals(horizon: int = 30, run_id: int | None = None):
    """What will charge in the next `horizon` days (as of the last statement date)."""
    rid = _run_id(run_id)
    tx = db.q("SELECT * FROM transactions WHERE run_id=?", (rid,))
    if not tx:
        return {"as_of": None, "renewals": [], "total": 0}
    rec = detectors.detect_recurring(tx)
    flags = {f["merchant"]: f["kind"] for f in db.q(
        "SELECT merchant, kind FROM findings WHERE run_id=? AND kind IN ('price_hike','trial_conversion','zombie_charge')", (rid,))}
    as_of = max(t["date"] for t in tx)
    ren = detectors.upcoming_renewals(rec, as_of=as_of, horizon_days=horizon, flags=flags)
    dec = db.get_sub_decisions()
    for r in ren:
        r["user_decision"] = dec.get(r["merchant"])
    return {"as_of": as_of, "renewals": ren, "total": round(sum(r["amount"] for r in ren), 2)}


# ---------------------------------------------------------------- insights
@router.get("/insights")
def insights(run_id: int | None = None):
    """Month-by-month cash flow, category trends, top merchants, and the money-leak scoreboard."""
    rid = _run_id(run_id)
    tx = db.q("SELECT * FROM transactions WHERE run_id=?", (rid,))
    skip = {"Transfers", "Suspicious"}
    months = sorted({t["date"][:7] for t in tx})
    flow = {m: {"month": m, "income": 0.0, "spend": 0.0, "invested": 0.0} for m in months}
    cat_month = defaultdict(lambda: defaultdict(float))
    merch = defaultdict(lambda: {"amount": 0.0, "count": 0, "display": ""})
    for t in tx:
        m = t["date"][:7]
        if t["direction"] == "CR":
            if t["category"] == "Income":
                flow[m]["income"] += t["amount"]
            continue
        if t["category"] in skip:
            continue
        if t["category"] == "Investments":
            flow[m]["invested"] += t["amount"]
            continue
        flow[m]["spend"] += t["amount"]
        cat_month[t["category"]][m] += t["amount"]
        mm = merch[t["merchant"]]
        mm["amount"] += t["amount"]; mm["count"] += 1; mm["display"] = t["merchant_display"]
    for f in flow.values():
        f["saved"] = round(f["income"] - f["spend"], 2)
        f["savings_rate"] = round(f["saved"] / f["income"] * 100, 1) if f["income"] else None
        for k in ("income", "spend", "invested"):
            f[k] = round(f[k], 2)
    cats = []
    for c, by in cat_month.items():
        series = [round(by.get(m, 0), 2) for m in months]
        change = round((series[-1] - series[-2]) / series[-2] * 100, 1) if len(series) > 1 and series[-2] else None
        cats.append({"category": c, "by_month": series, "total": round(sum(series), 2), "last_month_change_pct": change})
    cats.sort(key=lambda x: -x["total"])
    top = sorted(({"merchant": k, **v} for k, v in merch.items()), key=lambda x: -x["amount"])[:10]
    for t in top:
        t["amount"] = round(t["amount"], 2)
    F = defaultdict(list)
    for f in db.q("SELECT kind, amount, details FROM findings WHERE run_id=?", (rid,)):
        F[f["kind"]].append(f)
    hikes_year = sum(json.loads(f["details"]).get("extra_per_year", 0) for f in F["price_hike"] + F["bank_fee_hike"])
    leak = {
        "recoverable_now": round(sum(f["amount"] for f in F["duplicate"] + F["zombie_charge"]), 2),
        "hikes_per_year": round(hikes_year, 2),
        "trial_traps_per_year": round(sum(json.loads(f["details"]).get("annual_cost", 0) for f in F["trial_conversion"]), 2),
        "subscriptions_per_month": round(sum(f["amount"] for f in F["subscription"]), 2),
        "counts": {k: len(v) for k, v in F.items()},
    }
    return {"run_id": rid, "months": months, "cash_flow": list(flow.values()), "categories": cats,
            "top_merchants": top, "leaks": leak}


# ---------------------------------------------------------------- memory (user control)
@router.get("/memory")
def memory():
    """Everything the agent remembers about the user, so they can inspect and delete it."""
    fmt = db.q("SELECT signature, mapping, source, example_file, created_at, times_used FROM csv_formats")
    for f in fmt:
        f["mapping"] = json.loads(f["mapping"])
    return {"corrections": db.q("SELECT * FROM corrections ORDER BY created_at DESC"),
            "cancellations": db.q("SELECT * FROM cancellations"),
            "dismissals": db.q("SELECT * FROM dismissals ORDER BY created_at DESC"),
            "subscription_decisions": db.q("SELECT * FROM sub_decisions ORDER BY created_at DESC"),
            "csv_formats": fmt,
            "pdf_passwords": "held in server memory only, never stored"}


class ForgetReq(BaseModel):
    type: str
    key: str


@router.post("/memory/forget")
def forget(req: ForgetReq):
    try:
        db.forget(req.type, req.key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ---------------------------------------------------------------- audit history
@router.get("/runs")
def runs():
    out = []
    for r in db.q("SELECT * FROM runs ORDER BY id DESC LIMIT 50"):
        rid = r["id"]
        c = db.q("SELECT kind, COUNT(*) n, SUM(amount) s FROM findings WHERE run_id=? GROUP BY kind", (rid,))
        by = {x["kind"]: x for x in c}
        n_tx = db.q("SELECT COUNT(*) n FROM transactions WHERE run_id=?", (rid,), one=True)["n"]
        tools = db.q("SELECT COUNT(*) n FROM audit_log WHERE run_id=? AND event LIKE 'tool_call:%' AND event != 'tool_call:update_plan'",
                     (rid,), one=True)["n"]
        replans = sum(1 for x in db.q("SELECT detail FROM audit_log WHERE run_id=? AND event='tool_call:update_plan'", (rid,))
                      if '"is_replan": true' in (x["detail"] or ""))
        out.append({"id": rid, "started_at": r["started_at"], "status": r["status"], "goal": r["goal"],
                    "transactions": n_tx, "tool_calls": tools, "replans": replans,
                    "subscriptions": by.get("subscription", {}).get("n", 0),
                    "duplicates": by.get("duplicate", {}).get("n", 0),
                    "recoverable": round((by.get("duplicate", {}).get("s") or 0) + (by.get("zombie_charge", {}).get("s") or 0), 2),
                    "drafts": db.q("SELECT COUNT(*) n FROM drafts WHERE run_id=?", (rid,), one=True)["n"]})
    return {"runs": out}


@router.get("/runs/compare")
def compare_runs(prev: int | None = None, cur: int | None = None):
    """'Since your last audit'. Defaults: the latest run vs the run before it."""
    from core import compare
    cur = cur or _run_id()
    prev = prev or compare.previous_run_id(cur)
    if not prev:
        return {"first_audit": True, "current_run": cur}
    try:
        return compare.compare_runs(prev, cur)
    except ValueError as e:
        raise HTTPException(404, str(e))


# chat endpoints live in api_chat.py and are mounted here so server.py needs no further edits
import api_chat  # noqa: E402
router.include_router(api_chat.router)
