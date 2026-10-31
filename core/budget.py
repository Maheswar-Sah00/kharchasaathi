"""Monthly budget with savings target. Needs are kept, wants are trimmed to hit the target."""
from collections import defaultdict

NEEDS = {"Rent", "Utilities & Bills", "Groceries", "Household", "Transport", "Health & Fitness", "Education", "Fees & Charges", "Insurance"}
WANTS = {"Food & Dining", "Shopping", "Entertainment & Subscriptions", "Travel", "Other", "Cash Withdrawal"}
NOT_SPEND = {"Income", "Transfers", "Investments", "Suspicious"}


def build_budget(rows, savings_target_pct=20.0, recoverable=0.0, cancelled_by_category=None):
    """cancelled_by_category: {category: monthly amount} of subscriptions the plan stops.
    Each one leaves the category it is paid from (Cult.fit from Health, Audible from Entertainment)."""
    months = sorted({r["date"][:7] for r in rows})
    n = max(len(months), 1)
    income = sum(r["amount"] for r in rows if r["direction"] == "CR" and r["category"] == "Income") / n
    invest = sum(r["amount"] for r in rows if r["direction"] == "DR" and r["category"] == "Investments") / n
    by_cat = defaultdict(float)
    for r in rows:
        if r["direction"] == "DR" and r["category"] not in NOT_SPEND:
            by_cat[r["category"]] += r["amount"] / n
    spend = sum(by_cat.values())
    current_savings = income - spend  # SIP counts as savings
    target = income * savings_target_pct / 100
    gap = max(0.0, target - current_savings)
    # a category cannot give up more than it spends
    stopped = {cat: min(by_cat.get(cat, 0.0), amount) for cat, amount in (cancelled_by_category or {}).items()}
    cancellable_monthly = sum(stopped.values())
    # first lever: cancelling flagged subscriptions; then trim what is left of the wants proportionally
    after_cancel_gap = max(0.0, gap - cancellable_monthly)
    wants_total = sum(v - stopped.get(k, 0.0) for k, v in by_cat.items() if k in WANTS)
    cut_ratio = min(0.5, after_cancel_gap / wants_total) if wants_total else 0
    lines, new_spend = [], 0.0
    for cat, avg in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        kept = avg - stopped.get(cat, 0.0)
        budget = kept * (1 - cut_ratio) if cat in WANTS else kept
        new_spend += budget
        lines.append(dict(category=cat, type="need" if cat in NEEDS else "want", avg_spend=round(avg),
                          budget=round(budget), change=round(budget - avg), stopped=round(stopped.get(cat, 0.0))))
    return dict(months=months, monthly_income=round(income), avg_monthly_spend=round(spend),
                sip_investments=round(invest), current_savings=round(current_savings),
                current_savings_pct=round(current_savings / income * 100, 1) if income else 0,
                savings_target_pct=savings_target_pct, savings_target=round(target),
                projected_savings=round(income - new_spend),
                projected_savings_pct=round((income - new_spend) / income * 100, 1) if income else 0,
                one_time_recoverable=round(recoverable), cancellable_monthly=round(cancellable_monthly),
                lines=lines)
