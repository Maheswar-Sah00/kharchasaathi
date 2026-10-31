"""Product API: unlock PDFs, statement status, findings actions, subscriptions, renewals, insights, memory."""
import json
import pytest
from fastapi.testclient import TestClient
from core import db, detectors


@pytest.fixture
def client():
    import server
    return TestClient(server.app)


@pytest.fixture
def seeded_run(sample_rows, no_llm):
    """A finished audit in the DB built from ground truth (no LLM), like agent.run would leave it."""
    rid = db.x("INSERT INTO runs(started_at,goal,status,summary) VALUES(?,?,?,?)", (db.now(), "test", "done", "ok"))
    with db.conn() as c:
        c.executemany("INSERT INTO transactions(run_id,source,file,date,description,amount,direction,merchant,merchant_display,"
                      "category,cat_source,confidence,reason,flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      [(rid, r["source"], r["file"], r["date"], r["description"], r["amount"], r["direction"], r["merchant"],
                        r["merchant_display"], r["category"], "gt", 1.0, "", "") for r in sample_rows])
        c.commit()
    rec = detectors.detect_recurring(sample_rows)
    ids = {}
    for s in [r for r in rec if r["kind"] == "subscription"]:
        ids[("subscription", s["merchant"])] = db.x("INSERT INTO findings(run_id,kind,merchant,title,amount,details) VALUES(?,?,?,?,?,?)",
                                                    (rid, "subscription", s["merchant"], s["display"], s["latest_amount"], json.dumps(s)))
    dups, _ = detectors.detect_duplicates(sample_rows)
    for d in dups:
        ids[("duplicate", d["merchant"])] = db.x("INSERT INTO findings(run_id,kind,merchant,title,amount,details) VALUES(?,?,?,?,?,?)",
                                                 (rid, "duplicate", d["merchant"], "dup", d["amount"], json.dumps(d)))
    return rid, ids


def test_unlock_wrong_then_right(client, gt):
    name = "card_statement_nova_2026_10.pdf"
    assert client.get("/api/statements/status", params={"name": name}).json()["status"] == "needs_password"
    r = client.post("/api/statements/unlock", json={"name": name, "password": "nope"}).json()
    assert r["unlocked"] is False and "DDMM" in r["error"]
    r = client.post("/api/statements/unlock", json={"name": name, "password": gt["pdf_passwords"][name]}).json()
    assert r["unlocked"] is True and r["transactions"] == 15
    s = client.get("/api/statements/status", params={"name": name}).json()
    assert s["status"] == "ok" and s["unlocked"] is True
    # the password is never written to the database or audit log
    assert gt["pdf_passwords"][name] not in json.dumps(db.q("SELECT * FROM audit_log"))


def test_status_reports_csv_layout_and_corruption(client):
    s = client.get("/api/statements/status", params={"name": "bank_statement_saathi_aug_oct_2026.csv"}).json()
    assert s["status"] == "ok" and s["layout"]["source"] == "heuristic" and s["quarantined"] == 1
    assert client.get("/api/statements/status", params={"name": "card_statement_nova_2026_07_partial.pdf"}).json()["status"] == "corrupted"
    assert client.get("/api/statements/status", params={"name": "../.env"}).status_code == 404


def test_findings_draft_dismiss_flow(client, seeded_run):
    rid, ids = seeded_run
    f = client.get("/api/findings").json()["findings"]
    dup = next(x for x in f if x["kind"] == "duplicate" and x["merchant"] == "netflix")
    assert dup["status"] == "open" and dup["suggested_email"] == "dispute"
    r = client.post(f"/api/findings/{dup['id']}/draft", json={}).json()
    assert r["status"] == "PENDING_APPROVAL"
    again = client.post(f"/api/findings/{dup['id']}/draft", json={}).json()
    assert again["existing"] and again["draft_id"] == r["draft_id"]  # idempotent
    f = {x["id"]: x for x in client.get("/api/findings").json()["findings"]}
    assert f[dup["id"]]["status"] == "draft_pending"
    r = client.post(f"/api/findings/{dup['id']}/dismiss", json={"reason": "I really bought two"}).json()
    assert r["applies_to_future_runs"]
    f = {x["id"]: x for x in client.get("/api/findings").json()["findings"]}
    assert f[dup["id"]]["status"] == "dismissed"
    assert db.q("SELECT status FROM drafts WHERE id=?", (again["draft_id"],), one=True)["status"] == "REJECTED"


def test_dismissal_suppresses_future_runs(seeded_run, sample_rows, no_llm):
    from core import agent
    rid, ids = seeded_run
    db.save_dismissal("duplicate", "netflix", 649.0, "expected")
    ctx = agent.Ctx(rid, [], {}, 40)
    ctx.rows = sample_rows
    out = agent.run_tool(ctx, "detect_duplicates", {})
    assert [d["merchant"] for d in out["suppressed_by_user_preference"]] == ["Netflix"]
    assert all(d["merchant"] != "Netflix" for d in out["confirmed_duplicates"])


def test_subscription_keep_and_cancel(client, seeded_run, sample_rows):
    from core import agent
    rid, ids = seeded_run
    assert client.post("/api/subscriptions/spotify/decision", json={"decision": "keep"}).json()["ok"]
    r = client.post("/api/subscriptions/audible/decision", json={"decision": "cancel"}).json()
    assert r["decision"] == "cancel" and r["status"] == "PENDING_APPROVAL"
    ctx = agent.Ctx(rid, [], {}, 40)
    ctx.rows = sample_rows
    agent.run_tool(ctx, "detect_subscriptions", {})
    b = agent.run_tool(ctx, "build_budget", {"savings_target_pct": 40, "cancel_merchants": ["spotify", "audible"]})
    assert b["cancel_merchants"] == ["audible"] and b["kept_by_user"] == ["spotify"]
    assert client.post("/api/subscriptions/x/decision", json={"decision": "maybe"}).status_code == 400


def test_mark_cancelled_feeds_zombie_detection(client, seeded_run):
    assert client.post("/api/subscriptions/cultfit/cancelled", json={"cancelled_on": "2026-09-20"}).json()["ok"]
    assert db.get_cancellations()["cultfit"] == "2026-09-20"
    assert client.post("/api/subscriptions/cultfit/cancelled", json={"cancelled_on": "20/09/2026"}).status_code == 400


def test_renewals_and_insights(client, seeded_run):
    r = client.get("/api/renewals").json()
    assert r["as_of"] == "2026-10-28"  # last transaction date in the statements
    assert r["renewals"][0]["in_days"] >= 1
    assert any(x["merchant"] == "netflix" and x["date"] == "2026-11-05" for x in r["renewals"])
    i = client.get("/api/insights").json()
    assert i["months"] == ["2026-08", "2026-09", "2026-10"]
    assert all(m["income"] == 85000 for m in i["cash_flow"])
    assert i["leaks"]["counts"]["duplicate"] == 2
    assert i["top_merchants"][0]["merchant"] == "rent"


def test_memory_inspect_and_forget(client):
    db.save_correction("ramesh_kumar", "Household")
    m = client.get("/api/memory").json()
    assert m["corrections"][0]["merchant"] == "ramesh_kumar" and "never stored" in m["pdf_passwords"]
    assert client.post("/api/memory/forget", json={"type": "corrections", "key": "ramesh_kumar"}).json()["ok"]
    assert client.get("/api/memory").json()["corrections"] == []
    assert client.post("/api/memory/forget", json={"type": "runs", "key": "1"}).status_code == 400


def test_runs_history(client, seeded_run):
    runs = client.get("/api/runs").json()["runs"]
    assert runs[0]["transactions"] == 140 and runs[0]["subscriptions"] == 10
