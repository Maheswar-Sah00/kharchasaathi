"""SQLite memory: transactions, correction memory, cancellations, findings, drafts, audit log."""
import json, os, sqlite3, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("KS_DB", os.path.join(ROOT, "data_store", "kharcha.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, goal TEXT, status TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, source TEXT, file TEXT,
  date TEXT, description TEXT, amount REAL, direction TEXT, merchant TEXT, merchant_display TEXT,
  category TEXT, cat_source TEXT, confidence REAL, reason TEXT, flags TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS corrections(merchant TEXT PRIMARY KEY, category TEXT, example TEXT, created_at TEXT, times_applied INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS cancellations(merchant TEXT PRIMARY KEY, cancelled_on TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS findings(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, kind TEXT, merchant TEXT,
  title TEXT, amount REAL, details TEXT);
CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, finding_id INT, kind TEXT,
  intended_recipient TEXT, to_addr TEXT, subject TEXT, body TEXT, status TEXT, created_at TEXT, decided_at TEXT, provider_id TEXT);
CREATE TABLE IF NOT EXISTS quarantine(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, file TEXT, raw TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, run_id INT, actor TEXT, event TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS csv_formats(signature TEXT PRIMARY KEY, mapping TEXT, source TEXT, example_file TEXT,
  created_at TEXT, times_used INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS dismissals(key TEXT PRIMARY KEY, kind TEXT, merchant TEXT, amount REAL, reason TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS sub_decisions(merchant TEXT PRIMARY KEY, decision TEXT, note TEXT, created_at TEXT);
"""
MEMORY_TABLES = ["corrections", "cancellations", "csv_formats", "dismissals", "sub_decisions"]


def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    return c


def q(sql, args=(), one=False):
    with conn() as c:
        cur = c.execute(sql, args)
        rows = [dict(r) for r in cur.fetchall()]
    return (rows[0] if rows else None) if one else rows


def x(sql, args=()):
    with conn() as c:
        cur = c.execute(sql, args)
        c.commit()
        return cur.lastrowid


def log(run_id, actor, event, detail=""):
    if not isinstance(detail, str):
        detail = json.dumps(detail, default=str, ensure_ascii=False)
    x("INSERT INTO audit_log(ts,run_id,actor,event,detail) VALUES(?,?,?,?,?)", (now(), run_id, actor, event, detail[:4000]))


# ---- correction memory ----
def get_corrections():
    return {r["merchant"]: r["category"] for r in q("SELECT merchant, category FROM corrections")}


def save_correction(merchant, category, example=""):
    x("INSERT INTO corrections(merchant,category,example,created_at) VALUES(?,?,?,?) "
      "ON CONFLICT(merchant) DO UPDATE SET category=excluded.category, created_at=excluded.created_at",
      (merchant, category, example, now()))
    log(None, "user", "category_correction", {"merchant": merchant, "category": category})


def bump_correction(merchant, n):
    x("UPDATE corrections SET times_applied = times_applied + ? WHERE merchant=?", (n, merchant))


def save_cancellation(merchant, cancelled_on, note=""):
    x("INSERT INTO cancellations(merchant,cancelled_on,note) VALUES(?,?,?) "
      "ON CONFLICT(merchant) DO UPDATE SET cancelled_on=excluded.cancelled_on, note=excluded.note",
      (merchant, cancelled_on, note))


def get_cancellations():
    return {r["merchant"]: r["cancelled_on"] for r in q("SELECT * FROM cancellations")}


def latest_run_id():
    r = q("SELECT id FROM runs ORDER BY id DESC LIMIT 1", one=True)
    return r["id"] if r else None


def dismissal_key(kind, merchant, amount=None):
    """A dismissal ('this is expected') matches future findings of the same kind+merchant (+amount for one-offs)."""
    return f"{kind}:{merchant}" + (f":{round(float(amount), 2)}" if amount is not None and kind in ("duplicate",) else "")


def get_dismissals():
    return {r["key"]: r for r in q("SELECT * FROM dismissals")}


def save_dismissal(kind, merchant, amount=None, reason=""):
    k = dismissal_key(kind, merchant, amount)
    x("INSERT INTO dismissals(key,kind,merchant,amount,reason,created_at) VALUES(?,?,?,?,?,?) "
      "ON CONFLICT(key) DO UPDATE SET reason=excluded.reason, created_at=excluded.created_at",
      (k, kind, merchant, amount, reason, now()))
    log(None, "user", "finding_dismissed", {"key": k, "reason": reason})
    return k


def get_sub_decisions():
    return {r["merchant"]: r["decision"] for r in q("SELECT * FROM sub_decisions")}


def save_sub_decision(merchant, decision, note=""):
    x("INSERT INTO sub_decisions(merchant,decision,note,created_at) VALUES(?,?,?,?) "
      "ON CONFLICT(merchant) DO UPDATE SET decision=excluded.decision, note=excluded.note, created_at=excluded.created_at",
      (merchant, decision, note, now()))
    log(None, "user", "subscription_decision", {"merchant": merchant, "decision": decision})


def forget(table, key):
    pk = {"corrections": "merchant", "cancellations": "merchant", "csv_formats": "signature",
          "dismissals": "key", "sub_decisions": "merchant"}
    if table not in pk:
        raise ValueError("unknown memory type")
    x(f"DELETE FROM {table} WHERE {pk[table]}=?", (key,))
    log(None, "user", "memory_forgotten", {"type": table, "key": key})


def reset_all():
    with conn() as c:
        for t in ["runs", "transactions", "findings", "drafts", "quarantine", "audit_log"] + MEMORY_TABLES:
            c.execute(f"DELETE FROM {t}")
        c.commit()
