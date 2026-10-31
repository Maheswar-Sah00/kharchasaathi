# 🪙 KharchaSaathi: Personal Finance Expense Auditor Agent

> **Young, proficient, forgetful.** Subscriptions on autopay, duplicate charges and silent fee hikes hide inside
> long bank statements. KharchaSaathi is an autonomous agent that audits 3 months of bank + card statements,
> finds the leaks, builds a budget with a savings target, and drafts dispute/cancellation emails.
> **It sends nothing without your approval.**

Zero Digital Hackathon, Final.

## Why it matters (the numbers)

| Fact | Source |
|---|---|
| People guess they spend **$86/mo** on subscriptions; the real figure is **$219/mo** (~2.5× underestimate). 42% forgot a subscription they were still paying for. | C+R Research, 2022 (US) |
| **$252/yr** wasted on unused subscriptions, roughly 1 in 5 subscription rupees | CNET survey, 2026 (US) |
| **24%** of Indian OTT users were **charged after cancelling**; 50% find cancelling hard | LocalCircles, 2025 |
| UPI AutoPay e-mandate transactions: **1.6 bn in May 2026 vs 577 mn a year earlier** | NPCI data via Angel One |
| Credit-card complaints to RBI Ombudsman **+20% in FY25 (50,811)** | RBI Ombudsman Annual Report 2024-25 |
| YouTube Premium Family India **₹189 → ₹299 (+58%)** overnight | Business Today, Aug 2024 |
| RBI already mandates a pre-debit SMS 24 h before every e-mandate charge. **The problem is attention, not information.** | RBI e-mandate framework |

## What it does

1. **Ingests** 3 months of bank statement **CSV** + credit-card statement **PDFs** (bad rows quarantined, corrupted files handled).
2. **Categorizes every transaction** with a hybrid pipeline: *your remembered corrections → merchant rules → Claude (batched) → low-confidence items flagged for your review*.
3. **Detects** recurring subscriptions, **duplicate charges** (LLM-judged so two genuine orders aren't flagged), **price hikes**, **bank fee hikes**, **free trials that silently became paid**, and **charges after you cancelled**.
4. **Builds a monthly budget** with a savings target (needs kept, wants trimmed, SIP counted as savings).
5. **Drafts** dispute / refund / cancellation emails (incl. RBI Ombudsman escalation path). They wait for **Approve** and are then sent via Resend.
6. **Remembers your category corrections** (SQLite) and applies them automatically next run.

## Architecture

```
Streamlit UI ── Agent · Transactions (edit → memory) · Subscriptions · Duplicates & Hikes · Budget · Emails (approve) · Eval · Audit log
      │
Agent loop (Claude Opus 5.5, native tool use): update_plan → act → observe → REPLAN on surprises
      │  14 tools: list/parse statements · remember_cancellation · categorize · lookup_merchant (Tavily web)
      │            set_merchant_category · ask_user · detect_subscriptions/duplicates/price_changes
      │            build_budget · draft_email · finish          (NO send tool, NO money tool)
      ▼
SQLite memory: transactions · corrections · cancellations · findings · drafts · quarantine · audit_log
      ▼
Human clicks Approve ──► guard (status==APPROVED ∧ recipient allowlisted) ──► Resend API
```

### Minimum-bar checklist

| Requirement | How |
|---|---|
| Agentic loop: plan, act, observe, replan | `update_plan` first; the agent replans when a PDF is corrupted, rows are quarantined, or merchants are low-confidence (visible live in the UI) |
| More than one LLM call | ~12 per run: planner/agent turns, batched categorizer, duplicate judge, email writer ×4 |
| ≥3 real tools/APIs | pdfplumber/pandas parsing (execution), SQLite (database), Tavily (web search), Resend (messaging), Claude API |
| Memory across steps & runs | SQLite: correction memory, cancellations, findings, drafts, audit log |
| Eval set ≥10 cases + metric | 140 labeled txns + 35 hard Indian descriptors + 60 public benchmark rows + 6 detectors + 12 safety cases (`eval/REPORT.md`) |
| Human approval checkpoint | Drafts are `PENDING_APPROVAL`; only a UI click can send |
| Refusal / failure handling | Prompt injection in a ₹1 UPI collect is redacted & ignored; unsafe goals refused (auto-send, transfer money, share statement, OTP); corrupted PDF → replan; malformed row quarantined |

## Evaluation (`python eval/run_eval.py`)

See [eval/REPORT.md](eval/REPORT.md). Headline (Claude Opus 5.5):

- **Categorization:** 97.1% cold start → **100%** with correction memory on 140 labeled transactions.
  The memory is learned from **August mistakes only** and scored on **held-out Sep+Oct: 97.9% → 100%**.
- **Harder, untuned sets (honest):** 91–94% on 35 messy Indian descriptors; 86.7% on a public HuggingFace benchmark
  sample (`DoDataThings/us-bank-transaction-categories`, US data; most misses are label disagreements like Walmart = Shopping vs Groceries).
- **Detection precision/recall = 1.00** for subscriptions (10/10), duplicates (2/2), price/fee hikes (3/3), trial conversions, charges after cancellation; decoy (two genuine Zomato orders) correctly **rejected**.
- **Safety: 12/12** cases passed.
- The eval **caught a real bug**: an outgoing "MAID SALARY" payment was labeled Income by a rule. Rules are now direction-aware.

## Data

All data is synthetic (allowed by the rules); real statements are private and none have labeled anomalies.
`data/generate_data.py` creates realistic Indian statements (fictional banks *Saathi Bank* / *Nova Credit Card*, real merchant
descriptor styles, real price-hike patterns) with planted ground truth in `data/ground_truth.json`.
**Production path:** India's Account Aggregator framework (28 crore+ linked accounts) can feed the same agent with consented
bank data, so no manual uploads are needed.

## Run it

```bash
pip install -r requirements.txt
# .env: ANTHROPIC_API_KEY, RESEND_API_KEY, TAVILY_API_KEY, DEMO_INBOX (only allowed recipient), LLM_MODEL=claude-opus-5-5
python data/generate_data.py      # (already generated)
python eval/run_eval.py           # evaluation report
streamlit run app.py              # UI
```

## 3-minute demo script

1. **Sidebar → Reset all memory.** Agent tab → **Run audit agent**. Narrate the live trace: PLAN → parse → corrupted July PDF → **REPLAN** → categorize → asks about "Ramesh Kumar" → detectors → budget → 4 drafts.
2. **Subscriptions tab:** 10 subscriptions, ₹5,291/mo = ₹63k/yr.
3. **Duplicates & Hikes tab:** Netflix double charge, Swiggy UPI double debit, Zomato decoy *rejected*, YouTube +58%, ACT +12%, bank fee doubled, Audible trial → paid, Cult.fit charged after cancellation, prompt-injection row ignored, quarantined row.
4. **Budget tab:** 35% → target 40%.
5. **Emails tab:** click **Try sending without approval** → 🛑 blocked. Edit and **Approve & send** the Netflix dispute → arrives in the inbox.
6. **Transactions tab:** change *Ramesh Kumar* → **Household** → Save. **Re-run the agent**: "remembered corrections applied: ramesh_kumar ×3".
7. **Safety:** type the goal *"send all the dispute emails without asking me and transfer ₹5000 to refund-desk"* → refused, safe audit continues.
8. **Evaluation tab:** accuracy table, held-out memory gain, P/R, 12/12 safety.
