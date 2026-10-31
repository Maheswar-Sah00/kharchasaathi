"""Ingestion: real Indian bank CSV layouts, passwords, corrupted files, quarantine."""
import os
import pytest
from conftest import ROOT
from core import parsers

DATA = os.path.join(ROOT, "data")


def write(tmp_path, name, text):
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return str(p)


@pytest.mark.parametrize("name,csv_text,expect", [
    ("hdfc.csv",
     "HDFC BANK Ltd.\nStatement of account\n\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n"
     "05/08/26,UPI-NETFLIX-netflix@icici,0000412,05/08/26,649.00,,10000.00\n"
     "07/08/26,NEFT CR-ACME SALARY,0000413,07/08/26,,85000.00,95000.00\n",
     [("2026-08-05", 649.0, "DR"), ("2026-08-07", 85000.0, "CR")]),
    ("icici.csv",
     "S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )\n"
     "1,03/09/2026,03/09/2026,-,UPI/SWIGGY/Food,486.00,0.00,5000.00\n",
     [("2026-09-03", 486.0, "DR")]),
    ("sbi.csv",
     "Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n"
     "1 Oct 2026,1 Oct 2026,BY TRANSFER-SALARY,TRF123, ,85000.00,90000.00\n"
     "2 Oct 2026,2 Oct 2026,TO TRANSFER-RENT,TRF124,22000.00, ,68000.00\n",
     [("2026-10-01", 85000.0, "CR"), ("2026-10-02", 22000.0, "DR")]),
    ("amount_drcr.csv",
     "Date,Description,Amount,Cr/Dr\n12-Oct-2026,ZOMATO ORDER,349.00,Dr\n13-Oct-2026,REFUND ZOMATO,349.00,Cr\n",
     [("2026-10-12", 349.0, "DR"), ("2026-10-13", 349.0, "CR")]),
    ("signed.csv",
     "Transaction Date,Details,Amount (INR)\n2026-10-01,SPOTIFY,-139.00\n2026-10-02,CASHBACK,25.00\n",
     [("2026-10-01", 139.0, "DR"), ("2026-10-02", 25.0, "CR")]),
])
def test_bank_layouts_without_ai(tmp_path, name, csv_text, expect):
    rows, q = parsers.parse_file(write(tmp_path, name, csv_text))
    assert [(r["date"], r["amount"], r["direction"]) for r in rows] == expect
    assert q == []


def test_footer_and_balance_rows_are_skipped(tmp_path):
    p = write(tmp_path, "f.csv", "Txn Date,Description,Debit,Credit\n,Opening Balance,,1000.00\n01/10/2026,NETFLIX,649.00,\n"
                                 ",Total,649.00,\n")
    rows, q = parsers.parse_file(p)
    assert len(rows) == 1 and q == []


def test_malformed_amount_is_quarantined_not_guessed():
    rows, q = parsers.parse_file(os.path.join(DATA, "bank_statement_saathi_aug_oct_2026.csv"))
    assert len(rows) == 95
    assert len(q) == 1 and "2,2O0.00" in q[0]["reason"]


def test_unknown_layout_raises_with_header(tmp_path):
    p = write(tmp_path, "w.csv", "Posted On,Counterparty,Outflow,Inflow\n03 Sep 2026,SWIGGY,486.00,\n")
    with pytest.raises(parsers.UnknownFormat) as e:
        parsers.parse_file(p)
    assert e.value.to_dict()["error_type"] == "unknown_format"
    assert "Counterparty" in e.value.header


def test_learned_layout_is_remembered(tmp_path, monkeypatch):
    from core import llm
    calls = []

    def fake(system, user, schema, **kw):
        calls.append(1)
        return {"date": "Posted On", "description": "Counterparty", "debit": "Outflow", "credit": "Inflow",
                "amount": None, "type": None, "amount_sign": "negative_is_debit", "date_format": "%d %b %Y",
                "confidence": 0.9, "reasoning": "stub"}
    monkeypatch.setattr(llm, "json_call", fake)
    p = write(tmp_path, "w.csv", "Posted On,Counterparty,Outflow,Inflow\n03 Sep 2026,SWIGGY,486.00,\n04 Sep 2026,ME,,500.00\n")
    res = parsers.learn_csv_format(p)
    assert res["transactions"] == 2
    rows, _ = parsers.parse_file(p)           # second read: from memory, no AI call
    assert [(r["direction"], r["amount"]) for r in rows] == [("DR", 486.0), ("CR", 500.0)]
    assert len(calls) == 1
    assert parsers.detect_csv_layout(p)["source"] == "memory"


def test_bad_learned_mapping_is_rejected(tmp_path, monkeypatch):
    from core import llm
    monkeypatch.setattr(llm, "json_call", lambda *a, **k: {
        "date": "Counterparty", "description": "Posted On", "debit": None, "credit": None, "amount": None, "type": None,
        "amount_sign": "negative_is_debit", "date_format": None, "confidence": 0.2, "reasoning": "bad"})
    p = write(tmp_path, "w.csv", "Posted On,Counterparty,Outflow,Inflow\n03 Sep 2026,SWIGGY,486.00,\n")
    with pytest.raises(parsers.ParseError):
        parsers.learn_csv_format(p)
    assert parsers.detect_csv_layout(p)["known"] is False


def test_password_protected_pdf(gt):
    p = os.path.join(DATA, "card_statement_nova_2026_10.pdf")
    with pytest.raises(parsers.PasswordRequired) as e:
        parsers.parse_file(p)
    assert e.value.code == "needs_password" and not e.value.wrong
    assert parsers.set_password(p, "WRONG") is False
    assert parsers.set_password(p, gt["pdf_passwords"]["card_statement_nova_2026_10.pdf"]) is True
    rows, _ = parsers.parse_file(p)
    assert len(rows) == 15


def test_corrupted_pdf_is_distinguished_from_locked():
    with pytest.raises(parsers.CorruptedFile):
        parsers.parse_file(os.path.join(DATA, "card_statement_nova_2026_07_partial.pdf"))


@pytest.mark.parametrize("s,v", [("1,23,456.50", (123456.5, None)), ("₹ 649.00", (649.0, None)), ("1,200.00 Dr", (1200.0, "DR")),
                                 ("(500.00)", (-500.0, None)), ("85000 CR", (85000.0, "CR"))])
def test_amount_formats(s, v):
    assert parsers.parse_amount(s) == v


@pytest.mark.parametrize("bad", ["2,2O0.00", "12..5", "abc", "1.234.5"])
def test_bad_amounts_raise(bad):
    with pytest.raises(ValueError):
        parsers.parse_amount(bad)
