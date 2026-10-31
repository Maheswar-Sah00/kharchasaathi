"""When reminder calls fire: right after an audit, and from the daily check, for renewals within the chosen window."""
import datetime, json
import pytest
from core import db, reminders as R

TODAY = datetime.date(2026, 10, 31)
NOON = datetime.datetime(2026, 10, 31, 12, 0)


@pytest.fixture
def calls(monkeypatch):
    """A finished audit with Netflix renewing on the 5th, and a fake phone."""
    rid = db.x("INSERT INTO runs(started_at,goal,status) VALUES(?,?,?)", (db.now(), "t", "done"))
    db.x("INSERT INTO findings(run_id,kind,merchant,title,amount,details) VALUES(?,?,?,?,?,?)",
         (rid, "subscription", "netflix", "Netflix", 649,
          json.dumps({"merchant": "netflix", "display": "Netflix", "latest_amount": 649, "day_of_month": 5})))
    placed = []

    def fake(script, mode="manual", key="manual"):
        placed.append({"script": script, "mode": mode, "key": key})
        db.x("INSERT INTO reminder_calls(ts,mode,key,script,status,detail) VALUES(?,?,?,?,?,?)",
             (db.now(), mode, key, script, "answered", ""))
        return {"status": "answered"}

    monkeypatch.setattr(R, "place_call", fake)
    monkeypatch.setattr(R, "make_script", lambda *a, **k: {"script": "Netflix renews soon", "source": "test"})
    monkeypatch.setattr(R, "config", lambda: ({}, []))
    R._setup()
    with db.conn() as c:
        c.execute("DELETE FROM reminder_calls")
        c.commit()
    R.save_settings(False, 7, False, True)
    return placed


def test_audit_calls_when_renewal_is_within_a_week(calls):
    r = R.after_audit(today=TODAY)  # Netflix is 5 days away
    assert r["called"] and len(calls) == 1 and "netflix@2026-11-05" in calls[0]["key"]


def test_audit_stays_quiet_when_renewal_is_further_away(calls):
    R.save_settings(False, 4, False, True)
    assert R.after_audit(today=TODAY) == {"called": False, "reason": "no renewal within 4 days"} and not calls


def test_audit_call_can_be_switched_off(calls):
    R.save_settings(False, 7, False, False)
    assert R.after_audit(today=TODAY)["reason"] == "switched off" and not calls


def test_every_audit_calls_again(calls):
    R.after_audit(today=TODAY)
    assert R.after_audit(today=TODAY)["called"] and len(calls) == 2


def test_audit_call_never_raises(calls, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Please wait a minute between calls")
    monkeypatch.setattr(R, "place_call", boom)
    assert R.after_audit(today=TODAY) == {"called": False, "reason": "Please wait a minute between calls"}


def test_daily_check_uses_window_and_calls_each_renewal_once(calls):
    assert R.due_calls(TODAY, NOON) == []  # opted out
    R.save_settings(True, 7, False)
    assert R.due_calls(TODAY, NOON) == [("renewal", "renewal:netflix@2026-11-05")]
    assert R.due_calls(datetime.date(2026, 11, 1), NOON)  # still due on a later day until answered
    R.after_audit(today=TODAY)
    assert R.due_calls(TODAY, NOON) == []
    assert R.due_calls(datetime.date(2026, 11, 2), NOON) == []  # not again for the same renewal


def test_daily_check_never_calls_at_night(calls):
    R.save_settings(True, 7, False)
    for hour in (0, 8, 21, 23):
        assert R.due_calls(TODAY, datetime.datetime(2026, 10, 31, hour, 15)) == []
    assert R.due_calls(TODAY, datetime.datetime(2026, 10, 31, 9, 0))


def test_daily_check_gives_up_after_unanswered_attempts(calls):
    R.save_settings(True, 7, False)
    for _ in range(R.MAX_SCHEDULED_ATTEMPTS):
        assert R.due_calls(TODAY, NOON)
        db.x("INSERT INTO reminder_calls(ts,mode,key,script,status,detail) VALUES(?,?,?,?,?,?)",
             (TODAY.isoformat() + "T12:00:00", "renewal", "renewal:netflix@2026-11-05", "s", "failed", ""))
    assert R.due_calls(TODAY, NOON) == []
    assert R.due_calls(TODAY + datetime.timedelta(days=1), NOON)  # tries again tomorrow


def test_old_database_is_upgraded(calls):
    with db.conn() as c:
        c.execute("DROP TABLE reminder_settings")
        c.execute("CREATE TABLE reminder_settings(id INTEGER PRIMARY KEY CHECK(id=1), enabled INT DEFAULT 0, days_before INT DEFAULT 2, monthly INT DEFAULT 1, updated_at TEXT)")
        c.execute("INSERT INTO reminder_settings(id,enabled,days_before,monthly) VALUES(1,0,2,1)")
        c.commit()
    s = R.settings()
    assert s["after_audit"] == 1 and s["days_before"] == 7
