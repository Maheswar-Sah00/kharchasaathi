"""Statement ingestion: bank CSV + card PDF. Bad rows are quarantined, never guessed."""
import csv, os, re
from datetime import datetime

AMT = re.compile(r"^\d[\d,]*(\.\d{1,2})?$")
PDF_LINE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+(Dr|Cr)$")


class ParseError(Exception):
    pass


def _d(s):
    return datetime.strptime(s.strip(), "%d/%m/%Y").date().isoformat()


def parse_csv(path):
    rows, quarantined = [], []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        need = {"Txn Date", "Description", "Debit", "Credit"}
        if not need.issubset(set(reader.fieldnames or [])):
            raise ParseError(f"Unrecognised CSV header {reader.fieldnames}; expected {sorted(need)}")
        for i, r in enumerate(reader, start=2):
            try:
                dr, cr = (r.get("Debit") or "").strip(), (r.get("Credit") or "").strip()
                raw_amt = dr or cr
                if not raw_amt or not AMT.match(raw_amt):
                    raise ValueError(f"invalid amount '{raw_amt}'")
                rows.append(dict(source="bank", file=os.path.basename(path), date=_d(r["Txn Date"]),
                                 description=r["Description"].strip(), amount=float(raw_amt.replace(",", "")),
                                 direction="DR" if dr else "CR"))
            except Exception as e:
                quarantined.append(dict(file=os.path.basename(path), raw=f"line {i}: {dict(r)}", reason=str(e)))
    return rows, quarantined


def parse_pdf(path):
    import pdfplumber
    rows, quarantined = [], []
    try:
        with pdfplumber.open(path) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    except Exception as e:
        raise ParseError(f"Could not open PDF ({type(e).__name__}): file is corrupted or password-protected")
    if "STATEMENT" not in text.upper():
        raise ParseError("PDF opened but no statement text found (scanned image or wrong document)")
    for line in text.splitlines():
        line = line.strip()
        m = PDF_LINE.match(line)
        if m:
            d, desc, amt, dc = m.groups()
            rows.append(dict(source="card", file=os.path.basename(path), date=_d(d), description=desc.strip(),
                             amount=float(amt.replace(",", "")), direction="DR" if dc == "Dr" else "CR"))
        elif re.match(r"^\d{2}/\d{2}/\d{4}", line):
            quarantined.append(dict(file=os.path.basename(path), raw=line, reason="unparseable transaction line"))
    if not rows:
        raise ParseError("No transactions found in PDF")
    return rows, quarantined


def parse_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        return parse_csv(path)
    if ext == ".pdf":
        return parse_pdf(path)
    raise ParseError(f"Unsupported file type {ext}")
