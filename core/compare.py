"""'Since your last audit': what changed between two audit runs."""
import json
from collections import defaultdict
from . import db

SPEND_SKIP = {"Transfers", "Suspicious", "Investments", "Income"}


def _finding_key(f):
    d = f["details"]
    k = f["kind"]
    if k == "duplicate":
        return (k, f["merchant"], d.get("date"), f["amount"])
    if k == "zombie_charge":
        return (k, f["merchant"], d.get("date"))
    if k in ("price_hike", "bank_fee_hike"):
        return (k, f["merchant"], d.get("new"))
    return (k, f["merchant"])


def _load(run_id):
    tx = db.q("SELECT * FROM transactions WHERE run_id=?", (run_id,))
    fs = db.q("SELECT * FROM findings WHERE run_id=? AND kind NOT IN ('budget','duplicate_rejected')", (run_id,))
    for f in fs:
        f["details"] = json.loads(f["details"])
    run = db.q("SELECT * FROM runs WHERE id=?", (run_id,), one=True)
    return run, tx, fs


def previous_run_id(run_id):
    r = db.q("SELECT id FROM runs WHERE id < ? AND status='done' ORDER BY id DESC LIMIT 1", (run_id,), one=True)
    return r["id"] if r else None


def compare_runs(prev_id, cur_id):
    prun, ptx, pf = _load(prev_id)
    crun, ctx_, cf = _load(cur_id)
    if not prun or not crun:
        raise ValueError("run not found")

    # coverage: which statement files / months are new
    pfiles = {t["file"] for t in ptx}
    cfiles = {t["file"] for t in ctx_}
    by_file = defaultdict(int)
    for t in ctx_:
        if t["file"] not in pfiles:
            by_file[t["file"]] += 1
    pmonths = {(t["source"], t["date"][:7]) for t in ptx}
    new_cov = sorted({f"{s} {m}" for s, m in {(t["source"], t["date"][:7]) for t in ctx_} - pmonths})

    # findings: new vs resolved
    pk = {_finding_key(f): f for f in pf}
    ck = {_finding_key(f): f for f in cf}
    slim = lambda f: {"kind": f["kind"], "merchant": f["merchant"], "title": f["title"], "amount": f["amount"]}
    new_findings = [slim(ck[k]) for k in ck.keys() - pk.keys()]
    gone = [slim(pk[k]) for k in pk.keys() - ck.keys()]
    new_subs = [x for x in new_findings if x["kind"] == "subscription"]
    stopped_subs = [x for x in gone if x["kind"] == "subscription"]

    # what the user did since the previous audit (between the two runs' start times)
    t0, t1 = prun["started_at"], crun["started_at"]
    acts = db.q("SELECT ts, event, detail FROM audit_log WHERE ts >= ? AND ts < ? AND actor='user' AND event != 'goal'", (t0, t1))
    sent = db.q("SELECT d.id, d.kind, d.subject, f.amount, f.kind AS fkind, f.merchant FROM drafts d "
                "LEFT JOIN findings f ON f.id = d.finding_id WHERE d.run_id=? AND d.status='SENT'", (prev_id,))
    claimed = round(sum(s["amount"] or 0 for s in sent if s["fkind"] in ("duplicate", "zombie_charge")), 2)

    # recategorised by memory in the current run
    mem_applied = sum(1 for t in ctx_ if t["cat_source"] == "memory")

    def spend(txs):
        out = defaultdict(float)
        for t in txs:
            if t["direction"] == "DR" and t["category"] not in SPEND_SKIP:
                out[t["category"]] += t["amount"]
        return out
    ps, cs = spend(ptx), spend(ctx_)
    cat_delta = sorted(({"category": c, "before": round(ps.get(c, 0), 2), "now": round(cs.get(c, 0), 2),
                         "change": round(cs.get(c, 0) - ps.get(c, 0), 2)} for c in set(ps) | set(cs)),
                       key=lambda x: -abs(x["change"]))
    cat_delta = [c for c in cat_delta if abs(c["change"]) >= 1][:8]

    sub_total = lambda fs: round(sum(f["amount"] for f in fs if f["kind"] == "subscription"), 2)
    return {
        "previous_run": prev_id, "current_run": cur_id,
        "previous_at": t0, "current_at": t1,
        "transactions": {"before": len(ptx), "now": len(ctx_), "added": len(ctx_) - len(ptx)},
        "new_statement_files": [{"file": f, "transactions": n} for f, n in sorted(by_file.items())],
        "files_no_longer_included": sorted(pfiles - cfiles),
        "new_coverage": new_cov,
        "new_findings": new_findings, "resolved_or_gone": gone,
        "new_subscriptions": new_subs, "subscriptions_no_longer_seen": stopped_subs,
        "subscriptions_per_month": {"before": sub_total(pf), "now": sub_total(cf)},
        "emails_sent_since": [{"kind": s["kind"], "subject": s["subject"], "amount": s["amount"]} for s in sent],
        "amount_claimed_via_sent_disputes": claimed,
        "your_actions_since": [{"ts": a["ts"], "event": a["event"]} for a in acts][:30],
        "transactions_categorised_from_memory": mem_applied,
        "spend_change_by_category": cat_delta,
    }
