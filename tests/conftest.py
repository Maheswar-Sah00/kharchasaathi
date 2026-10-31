import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
# isolated database for the whole test session - must be set before core.db is imported
os.environ["KS_DB"] = os.path.join(tempfile.mkdtemp(prefix="ks_test_"), "test.db")
os.environ.setdefault("DEMO_INBOX", "demo@example.com")

import json  # noqa: E402
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    from core import db, parsers
    db.reset_all()
    parsers.forget_passwords()
    yield


@pytest.fixture
def gt():
    return json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))


@pytest.fixture
def sample_rows(gt):
    """Parsed sample statements with ground-truth categories (no LLM)."""
    from core import parsers, agent, categorize
    for name, pw in gt["pdf_passwords"].items():
        parsers.set_password(os.path.join(ROOT, "data", name), pw)
    rows = []
    for f in agent.default_files():
        try:
            rows += parsers.parse_file(f)[0]
        except parsers.ParseError:
            pass
    truth = {}
    for t in gt["transactions"]:
        truth.setdefault((t["source"], t["date"], t["description"], t["amount"]), t["category"])
    for r in rows:
        k, disp, _ = categorize.normalize_merchant(r["description"])
        r.update(merchant=k, merchant_display=disp, category=truth[(r["source"], r["date"], r["description"], r["amount"])],
                 cat_source="gt", confidence=1.0, flags="")
    return rows


@pytest.fixture
def no_llm(monkeypatch):
    """Stub Claude: duplicate judge says 'duplicate' unless the notes differ (lunch vs dinner)."""
    from core import llm

    def fake_json_call(system, user, schema, **kw):
        if "pair_id" in json.dumps(schema):
            verdicts = []
            for line in user.splitlines():
                if line.startswith("pair_id"):
                    pid = int(line.split()[1].rstrip(":"))
                    genuine = "Lunch" in line and "Dinner" in line
                    verdicts.append({"pair_id": pid, "is_duplicate": not genuine, "confidence": 0.9, "reason": "stub"})
            return {"verdicts": verdicts}
        if "subject" in json.dumps(schema):
            return {"subject": "Stub subject", "body": "Stub body"}
        raise AssertionError("unexpected LLM call in offline test")

    monkeypatch.setattr(llm, "json_call", fake_json_call)
    return fake_json_call
