"""A cancelled subscription must leave the category it is paid from, not always Entertainment."""
from core import budget


def _rows():
    months = ("2026-08", "2026-09", "2026-10")
    spend = [("Rent", 20000), ("Health & Fitness", 2000), ("Entertainment & Subscriptions", 2500),
             ("Food & Dining", 5000), ("Shopping", 3000)]
    rows = []
    for m in months:
        rows.append(dict(date=f"{m}-01", direction="CR", category="Income", amount=50000.0))
        rows += [dict(date=f"{m}-05", direction="DR", category=c, amount=float(a)) for c, a in spend]
    return rows


def _lines(b):
    return {l["category"]: l for l in b["lines"]}


def test_cancelled_gym_comes_out_of_health_and_fun_keeps_its_budget():
    # Saves 17,500 of 50,000 now. Goal 45% = 22,500, so the plan must find 5,000.
    b = budget.build_budget(_rows(), 45, 0, {"Health & Fitness": 1500, "Entertainment & Subscriptions": 200})
    lines = _lines(b)
    assert lines["Health & Fitness"]["budget"] == 500
    assert lines["Health & Fitness"]["stopped"] == 1500
    assert lines["Entertainment & Subscriptions"]["stopped"] == 200
    # what is left of Fun is still there (the old code wiped it out with the whole cancelled amount)
    assert lines["Entertainment & Subscriptions"]["budget"] >= 1000
    assert b["cancellable_monthly"] == 1700


def test_plan_reaches_the_goal_exactly():
    b = budget.build_budget(_rows(), 45, 0, {"Health & Fitness": 1500, "Entertainment & Subscriptions": 200})
    assert b["savings_target"] == 22500
    assert b["projected_savings"] == 22500


def test_rent_and_other_needs_are_not_trimmed():
    b = budget.build_budget(_rows(), 45, 0, {"Health & Fitness": 1500})
    assert _lines(b)["Rent"]["budget"] == 20000


def test_a_category_cannot_give_up_more_than_it_spends():
    b = budget.build_budget(_rows(), 30, 0, {"Health & Fitness": 9999})
    health = _lines(b)["Health & Fitness"]
    assert health["budget"] == 0 and health["stopped"] == 2000
    assert b["cancellable_monthly"] == 2000


def test_no_cancellations_adds_no_stopped_money():
    b = budget.build_budget(_rows(), 45)
    assert all(l["stopped"] == 0 for l in b["lines"])
    assert b["cancellable_monthly"] == 0
