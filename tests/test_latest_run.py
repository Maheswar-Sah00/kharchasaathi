"""A failed or still-running audit must not replace the last good report."""
from core import db


def _run(status):
    return db.x("INSERT INTO runs(started_at,goal,status) VALUES(?,?,?)", (db.now(), "test", status))


def test_no_runs_yet():
    assert db.latest_run_id() is None


def test_unfinished_run_is_used_only_when_nothing_has_finished():
    first = _run("incomplete")
    assert db.latest_run_id() == first
    good = _run("done")
    assert db.latest_run_id() == good


def test_failed_or_running_audit_keeps_the_last_good_one():
    good = _run("done")
    _run("incomplete")
    _run("running")
    assert db.latest_run_id() == good
    newer = _run("done")
    assert db.latest_run_id() == newer
