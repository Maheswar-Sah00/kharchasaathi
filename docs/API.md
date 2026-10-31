# KharchaSaathi backend API: product actions

Router: `api_actions.py`, mounted in `server.py` with `app.include_router(api_actions.router)`.
All bodies and responses are JSON. `batch` is the upload id returned by `POST /api/upload`. Omit it to use the sample statements.
Covered by `tests/test_api_actions.py` (run `python -m pytest tests -q`).

## 1. Statements: passwords and bank layouts

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/statements/status` | `?name=&batch=` | `{name, status: ok\|needs_password\|unknown_format\|corrupted\|parse_error, error?, transactions?, quarantined?, encrypted, unlocked, layout?}` |
| POST | `/api/statements/unlock` | `{name, password, batch?}` | `{unlocked: true, transactions, months, quarantined}` or `{unlocked: false, error}` |
| POST | `/api/statements/learn-format` | `{name, batch?}` | `{ok, mapping, confidence, reasoning, transactions, quarantined}` (Claude infers an unknown CSV layout, validates it, and remembers it) |

- **Passwords are held in server memory only.** They are never written to disk, the database or the audit log, and they are lost on restart.
  Unlock locked PDFs **before** `POST /api/run`, or the agent will report the file as locked and ask the user.
  The demo password for `card_statement_nova_2026_10.pdf` is `ARJU1402`. Indian banks use the first 4 letters of the name plus DDMM of birth.
- `POST /api/preview` (in server.py) now returns the specific error message for each file:
  "This PDF is password-protected…", "Unrecognised bank CSV layout…" or "…corrupted or incomplete…".
  Call `/api/statements/status` to get the machine-readable `status` and decide what to show (unlock box / "Learn format" button / re-download).
- CSV layouts read **without AI**: HDFC-, ICICI-, SBI- and Axis-style headers (Narration/Particulars/Remarks,
  Withdrawal Amt./Deposit Amt., Debit/Credit, Amount + Cr/Dr, signed amounts), bank preamble lines, many date formats.
  `layout.source` is `heuristic`, `memory` (learned before) or `null` (unknown, offer "Learn format").

## 2. Findings and actions

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/findings?run_id=` | - | `{run_id, findings:[{id, kind, merchant, title, amount, details, status, draft_id, suggested_email, can_dismiss}]}` |
| POST | `/api/findings/{id}/draft` | `{kind?: dispute\|refund\|cancellation\|escalation}` | `{draft_id, status:"PENDING_APPROVAL", subject, existing?}` (idempotent) |
| POST | `/api/findings/{id}/dismiss` | `{reason}` | `{memory_key, applies_to_future_runs:true}`. Also rejects pending drafts for it. |

`status`: `open` · `draft_pending` · `approved` · `email_sent` · `draft_rejected` · `dismissed` (null for `budget` / `duplicate_rejected`).
`kind`: `subscription`, `duplicate`, `duplicate_rejected`, `price_hike`, `bank_fee_hike`, `trial_conversion`, `zombie_charge`, `budget`.
Subscription findings now include `details.next_expected` (YYYY-MM-DD) and `details.user_decision` (`keep`/`cancel`/null).
A dismissal ("mark as expected") is **remembered**: future audits suppress it and the agent reports `suppressed_by_user_preference`.

## 3. Subscriptions

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/subscriptions/{merchant}/decision` | `{decision: keep\|cancel, note?}` | keep: `{ok}`. cancel: `{ok, draft_id, status:"PENDING_APPROVAL", subject}` |
| POST | `/api/subscriptions/{merchant}/cancelled` | `{cancelled_on:"YYYY-MM-DD"}` | `{ok}`. Later charges are flagged "charged after cancellation". |
| GET | `/api/renewals?horizon=30&run_id=` | - | `{as_of, total, renewals:[{merchant, display, kind, date, in_days, amount, source, estimate, flag, user_decision}]}` |

`merchant` is the merchant key (e.g. `netflix`, `youtube_premium`). "Keep" means the agent never recommends cancelling it again.
`as_of` is the last transaction date in the statements. `flag` is one of `price_hike`/`trial_conversion`/`zombie_charge`/null.

## 4. Insights (dashboard)

`GET /api/insights?run_id=` returns:
`{months, cash_flow:[{month, income, spend, invested, saved, savings_rate}], categories:[{category, by_month[], total, last_month_change_pct}],
top_merchants:[{merchant, display, amount, count}], leaks:{recoverable_now, hikes_per_year, trial_traps_per_year, subscriptions_per_month, counts}}`

## 5. Memory (user control)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/memory` | - | `{corrections, cancellations, dismissals, subscription_decisions, csv_formats, pdf_passwords}` |
| POST | `/api/memory/forget` | `{type: corrections\|cancellations\|csv_formats\|dismissals\|sub_decisions, key}` | `{ok}` |

Keys: corrections/cancellations/sub_decisions use `merchant`, dismissals use `key`, csv_formats use `signature`.

## 6. Audit history

`GET /api/runs` returns `{runs:[{id, started_at, status, goal, transactions, tool_calls, replans, subscriptions, duplicates, recoverable, drafts}]}`

## 7. New agent events in the `/api/run` stream

- `tool_call` / `tool_result` for the new tools `learn_csv_format` and `upcoming_renewals`.
- `parse_statement` errors now carry `output.error_type` (`needs_password` / `unknown_format` / `corrupted`) and `output.hint`.
- `ask_user` input now has `kind` (`category_review` / `password` / `confirmation`) and `filename`.
  For `kind: "password"`, show an unlock box for that file, then offer "Re-run audit".
- `detect_duplicates` / `detect_price_changes` results include `suppressed_by_user_preference`.
- `detect_subscriptions` result includes `user_chose_to_keep`. `build_budget` returns `kept_by_user`.
- `upcoming_renewals` result: `{as_of, renewals:[…], next_30_days_total}`.
