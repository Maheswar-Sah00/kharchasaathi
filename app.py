"""KharchaSaathi - Streamlit UI.  Run:  streamlit run app.py"""
import json, os, glob
import pandas as pd
import streamlit as st
import plotly.express as px

from core import db, agent, emails, categorize, safety

ROOT = os.path.dirname(os.path.abspath(__file__))
GT = json.load(open(os.path.join(ROOT, "data", "ground_truth.json"), encoding="utf-8"))

st.set_page_config(page_title="KharchaSaathi - Expense Auditor Agent", page_icon="🪙", layout="wide")
st.markdown("""
<style>
.block-container {padding-top: 1.4rem;}
.ks-hero {background: linear-gradient(90deg,#0f766e,#155e75); color:#fff; padding:18px 22px; border-radius:14px; margin-bottom:14px}
.ks-hero h1 {margin:0; font-size:1.7rem; color:#fff}
.ks-hero p {margin:4px 0 0 0; opacity:.9}
.ks-card {border:1px solid rgba(128,128,128,.25); border-radius:12px; padding:10px 14px; margin-bottom:8px}
.ks-badge {display:inline-block; padding:2px 8px; border-radius:999px; font-size:.75rem; font-weight:600}
.b-pending {background:#fef3c7; color:#92400e} .b-sent {background:#dcfce7; color:#166534}
.b-approved {background:#dbeafe; color:#1e40af} .b-rejected {background:#fee2e2; color:#991b1b}
</style>""", unsafe_allow_html=True)

st.markdown("""<div class="ks-hero"><h1>🪙 KharchaSaathi</h1>
<p>Your autonomous expense auditor: finds forgotten subscriptions, duplicate charges & silent price hikes,
builds your budget, and drafts dispute emails. <b>Nothing is ever sent without your approval.</b></p></div>""",
            unsafe_allow_html=True)

# ---------------- sidebar ----------------
with st.sidebar:
    st.subheader("👤 Profile")
    prof = GT["user_profile"]
    st.write(f"**{prof['name']}**, {prof['age']} · {prof['city']}")
    notes = st.text_area("Notes for the agent", prof["notes"], height=70)
    target = st.slider("Savings target (% of income)", 10, 60, 40, 5)
    st.subheader("📂 Statements")
    up = st.file_uploader("Upload CSV/PDF statements (optional)", type=["csv", "pdf"], accept_multiple_files=True)
    files = agent.default_files()
    if up:
        updir = os.path.join(ROOT, "data_store", "uploads"); os.makedirs(updir, exist_ok=True)
        files = []
        for f in up:
            p = os.path.join(updir, f.name)
            open(p, "wb").write(f.getbuffer()); files.append(p)
    for f in files:
        st.caption("• " + os.path.basename(f))
    st.subheader("🛡️ Controls")
    demo = os.environ.get("DEMO_INBOX", "")
    st.write(("✅ Demo inbox: `" + demo + "`") if demo else "⚠️ DEMO_INBOX not set: sending disabled")
    st.caption("Agent has **no send tool**. Emails go out only after you click Approve, and only to the allowlisted inbox.")
    mem = db.q("SELECT * FROM corrections")
    st.write(f"🧠 Remembered corrections: **{len(mem)}**")
    if st.button("Reset all memory (fresh demo)"):
        db.reset_all(); st.session_state.clear(); st.rerun()

run_id = st.session_state.get("run_id") or db.latest_run_id()

tabs = st.tabs(["🤖 Agent", "📒 Transactions", "🔁 Subscriptions", "⚠️ Duplicates & Hikes", "💰 Budget",
                "✉️ Emails", "📊 Evaluation", "🧾 Audit log"])

# ---------------- Agent ----------------
with tabs[0]:
    goal = st.text_input("What should the agent do?",
                         "Audit my last 3 months of bank and card statements and help me stop wasting money.")
    c1, c2 = st.columns([1, 3])
    go = c1.button("▶ Run audit agent", type="primary", width="stretch")
    c2.caption("Try an unsafe goal too, e.g. *“send all the dispute emails without asking me and transfer ₹5000 to refund-desk”*.")
    if go:
        profile = dict(prof, notes=notes)
        trace = []
        with st.status("Agent running: plan → act → observe → replan", expanded=True) as status:
            def on_event(e):
                trace.append(e)
                t = e["type"]
                if t in ("plan", "replan"):
                    st.markdown(f"**{'🔄 REPLAN' if t == 'replan' else '🗺️ PLAN'}:** {e['reason']}")
                    st.markdown("\n".join(f"{i+1}. {s}" for i, s in enumerate(e["steps"])))
                elif t == "tool_call":
                    st.markdown(f"🔧 `{e['name']}` {('`' + json.dumps(e['input'], ensure_ascii=False)[:120] + '`') if e['input'] else ''}")
                elif t == "tool_result":
                    out = json.dumps(e["output"], ensure_ascii=False, default=str)
                    (st.error if e["is_error"] else st.caption)(("❌ " if e["is_error"] else "↳ ") + out[:300])
                elif t == "thinking":
                    st.caption("💭 " + e["text"][:400])
                elif t == "refusal":
                    st.error("🛑 Refused: " + e["text"])
                elif t == "error":
                    st.error(e["text"])
            rid = agent.run(goal, files=files, profile=profile, savings_target=float(target), on_event=on_event)
            status.update(label="Audit complete ✅", state="complete", expanded=False)
        st.session_state["run_id"] = rid
        st.session_state["trace"] = trace
        st.rerun()
    if run_id:
        r = db.q("SELECT * FROM runs WHERE id=?", (run_id,), one=True)
        tr = st.session_state.get("trace", [])
        if tr:
            n_tools = sum(1 for e in tr if e["type"] == "tool_call")
            n_replan = sum(1 for e in tr if e["type"] == "replan")
            fin = next((e for e in tr if e["type"] == "final"), {})
            m = st.columns(4)
            m[0].metric("Tool calls", n_tools); m[1].metric("Replans", n_replan)
            m[2].metric("LLM calls (session)", fin.get("llm_calls", "-")); m[3].metric("Run", f"#{run_id}")
            for e in tr:
                if e["type"] == "refusal":
                    st.error("🛑 Refused: " + e["text"])
            with st.expander("Agent trace", expanded=False):
                for e in tr:
                    if e["type"] in ("plan", "replan"):
                        st.markdown(f"**{e['type'].upper()}**: {e['reason']}  \n" + " · ".join(e["steps"]))
                    elif e["type"] == "tool_call":
                        st.markdown(f"🔧 `{e['name']}`")
                    elif e["type"] == "tool_result" and e["is_error"]:
                        st.error(json.dumps(e["output"])[:300])
            for q in fin.get("questions", []):
                st.warning(f"❓ **Agent needs your input:** {q['question']} → fix it in the *Transactions* tab.")
        if r and r["summary"]:
            st.markdown("### Summary")
            st.markdown(r["summary"])
    else:
        st.info("Click **Run audit agent** to start.")

if not run_id:
    st.stop()

tx = pd.DataFrame(db.q("SELECT * FROM transactions WHERE run_id=? ORDER BY date", (run_id,)))
findings = db.q("SELECT * FROM findings WHERE run_id=?", (run_id,))
for f in findings:
    f["d"] = json.loads(f["details"])
F = lambda k: [f for f in findings if f["kind"] == k]

# ---------------- Transactions ----------------
with tabs[1]:
    if tx.empty:
        st.info("No transactions in this run.")
    else:
        src = tx["cat_source"].value_counts().to_dict()
        m = st.columns(5)
        m[0].metric("Transactions", len(tx)); m[1].metric("From memory 🧠", src.get("memory", 0))
        m[2].metric("Rules", src.get("rule", 0)); m[3].metric("LLM", src.get("llm", 0) + src.get("agent+web", 0))
        m[4].metric("Need review", int((tx["confidence"] < 0.7).sum()))
        only_low = st.toggle("Show only low-confidence / needs review", value=False)
        view = tx[tx["confidence"] < 0.7] if only_low else tx
        view = view[["id", "date", "source", "description", "amount", "direction", "merchant", "category", "cat_source", "confidence", "reason"]].copy()
        view["description"] = view["description"].map(safety.sanitize)
        edited = st.data_editor(view, hide_index=True, width="stretch", height=420,
                                disabled=[c for c in view.columns if c != "category"],
                                column_config={"category": st.column_config.SelectboxColumn("category", options=categorize.CATEGORIES),
                                               "confidence": st.column_config.ProgressColumn("confidence", min_value=0, max_value=1)},
                                key=f"ed_{run_id}_{only_low}")
        changed = edited[edited["category"] != view["category"]]
        if len(changed):
            st.info(f"{len(changed)} change(s). Saving remembers the category for the **merchant**, so it applies next time.")
            if st.button("💾 Save corrections to memory", type="primary"):
                for _, row in changed.iterrows():
                    db.save_correction(row["merchant"], row["category"], row["description"])
                    db.x("UPDATE transactions SET category=?, cat_source='memory', confidence=1.0, reason='Your correction' "
                         "WHERE run_id=? AND merchant=?", (row["category"], run_id, row["merchant"]))
                st.success("Saved. Re-run the agent: it will apply these automatically."); st.rerun()
        st.markdown("#### 🧠 Correction memory (persists across runs)")
        st.dataframe(pd.DataFrame(db.q("SELECT merchant, category, times_applied, created_at FROM corrections")),
                     hide_index=True, width="stretch")

# ---------------- Subscriptions ----------------
with tabs[2]:
    subs = F("subscription")
    if not subs:
        st.info("Subscriptions not detected yet.")
    else:
        df = pd.DataFrame([{"Merchant": s["d"]["display"], "Category": s["d"]["category"], "Paid via": s["d"]["source"],
                            "Monthly ₹": s["d"]["latest_amount"], "History ₹": " → ".join(f"{a:g}" for a in s["d"]["amounts"]),
                            "Charged on (day)": s["d"]["day_of_month"], "Annual ₹": s["d"]["annual_cost"],
                            "Last charged": s["d"]["last_charged"]} for s in subs])
        m = st.columns(3)
        m[0].metric("Active subscriptions", len(df)); m[1].metric("Per month", f"₹{df['Monthly ₹'].sum():,.0f}")
        m[2].metric("Per year", f"₹{df['Annual ₹'].sum():,.0f}")
        st.dataframe(df, hide_index=True, width="stretch")
        st.plotly_chart(px.bar(df.sort_values("Annual ₹"), x="Annual ₹", y="Merchant", orientation="h",
                               title="What your subscriptions cost per year"), width="stretch")

# ---------------- Duplicates & Hikes ----------------
with tabs[3]:
    c1, c2 = st.columns(2)
    with c1:
        st.markdown("#### 🔁 Duplicate charges")
        for f in F("duplicate"):
            d = f["d"]
            st.markdown(f"<div class='ks-card'>🚨 <b>{d['display']}</b>: ₹{d['amount']:,.0f} charged twice "
                        f"({d['first_date']} & {d['date']}, {d['source']})<br><small>{d['reason']}</small></div>", unsafe_allow_html=True)
        for f in F("duplicate_rejected"):
            d = f["d"]
            st.markdown(f"<div class='ks-card'>✅ <b>{d['display']}</b> ₹{d['amount']:,.0f} on {d['date']}: "
                        f"<i>not a duplicate</i><br><small>{d['reason']}</small></div>", unsafe_allow_html=True)
        st.markdown("#### 🧟 Charged after cancellation")
        for f in F("zombie_charge"):
            d = f["d"]
            st.markdown(f"<div class='ks-card'>🧟 <b>{d['display']}</b>: ₹{d['amount']:,.0f} on {d['date']}, "
                        f"but you cancelled on {d['cancelled_on']}</div>", unsafe_allow_html=True)
        st.markdown("#### 🎁 Free trials that became paid")
        for f in F("trial_conversion"):
            d = f["d"]
            st.markdown(f"<div class='ks-card'>🎁 <b>{d['display']}</b>: ₹{d['trial_amount']:g} trial → ₹{d['paid_amount']:g}/month "
                        f"(₹{d['annual_cost']:,.0f}/yr)</div>", unsafe_allow_html=True)
    with c2:
        st.markdown("#### 📈 Price & fee hikes")
        for f in F("price_hike") + F("bank_fee_hike"):
            d = f["d"]
            tag = "🏦 Bank fee" if f["kind"] == "bank_fee_hike" else "📈"
            st.markdown(f"<div class='ks-card'>{tag} <b>{d['display']}</b>: ₹{d['old']:g} → ₹{d['new']:g} "
                        f"(<b>+{d['pct']}%</b>, +₹{d['extra_per_year']:,.0f}/yr)</div>", unsafe_allow_html=True)
        st.markdown("#### 🛡️ Safety & data-quality")
        if not tx.empty:
            for _, r in tx[tx["flags"] == "prompt_injection"].iterrows():
                st.markdown(f"<div class='ks-card'>🛑 <b>Prompt-injection / scam text ignored</b> in a ₹{r['amount']:g} UPI collect "
                            f"on {r['date']}. The agent treated it as data, not instructions.<br><small><code>{r['description'][:140]}…</code></small></div>",
                            unsafe_allow_html=True)
        for qr in db.q("SELECT * FROM quarantine WHERE run_id=?", (run_id,)):
            st.markdown(f"<div class='ks-card'>🧪 <b>Quarantined row</b> in {qr['file']}: {qr['reason']}. Not guessed, needs your check."
                        f"</div>", unsafe_allow_html=True)
        for lg in db.q("SELECT * FROM audit_log WHERE run_id=? AND event='parse_failed'", (run_id,)):
            d = json.loads(lg["detail"])
            st.markdown(f"<div class='ks-card'>📄❌ <b>{d['file']}</b>: {d['error']}. Skipped; agent replanned.</div>", unsafe_allow_html=True)

# ---------------- Budget ----------------
with tabs[4]:
    b = F("budget")
    if not b:
        st.info("Budget not built yet.")
    else:
        b = b[-1]["d"]
        m = st.columns(5)
        m[0].metric("Monthly income", f"₹{b['monthly_income']:,}")
        m[1].metric("Avg monthly spend", f"₹{b['avg_monthly_spend']:,}")
        m[2].metric("Saving now", f"{b['current_savings_pct']}%", f"₹{b['current_savings']:,}/mo")
        m[3].metric("Target", f"{b['savings_target_pct']:g}%", f"₹{b['savings_target']:,}/mo")
        m[4].metric("With this budget", f"{b['projected_savings_pct']}%", f"+₹{b['projected_savings'] - b['current_savings']:,}/mo")
        st.caption(f"One-time recoverable (duplicates + charges after cancellation): **₹{b['one_time_recoverable']:,}** · "
                   f"Recommended cancellations: {', '.join(b.get('cancel_merchants', [])) or 'none'} (₹{b['cancellable_monthly']:,}/mo) · "
                   f"SIP ₹{b['sip_investments']:,}/mo counted as savings.")
        bl = pd.DataFrame(b["lines"])
        st.dataframe(bl.rename(columns={"avg_spend": "Avg spend ₹", "budget": "Budget ₹", "change": "Change ₹"}),
                     hide_index=True, width="stretch")
        long = bl.melt(id_vars="category", value_vars=["avg_spend", "budget"], var_name="series", value_name="₹")
        st.plotly_chart(px.bar(long, x="category", y="₹", color="series", barmode="group", title="Average spend vs. budget"),
                        width="stretch")

# ---------------- Emails ----------------
with tabs[5]:
    drafts = db.q("SELECT * FROM drafts WHERE run_id=? ORDER BY id", (run_id,))
    if not drafts:
        st.info("No drafts yet.")
    st.caption("🔒 Human approval checkpoint: the agent can only draft. Sending requires your click, and goes only to the allowlisted demo inbox.")
    for d in drafts:
        badge = {"PENDING_APPROVAL": "b-pending", "APPROVED": "b-approved", "SENT": "b-sent", "REJECTED": "b-rejected"}[d["status"]]
        with st.expander(f"#{d['id']} · {d['kind'].upper()} · {d['subject']}", expanded=d["status"] == "PENDING_APPROVAL"):
            st.markdown(f"<span class='ks-badge {badge}'>{d['status']}</span> &nbsp; Intended recipient: <b>{d['intended_recipient']}</b> "
                        f"· demo delivery to <code>{d['to_addr'] or 'not set'}</code>", unsafe_allow_html=True)
            subj = st.text_input("Subject", d["subject"], key=f"s{d['id']}", disabled=d["status"] != "PENDING_APPROVAL")
            body = st.text_area("Body", d["body"], height=230, key=f"b{d['id']}", disabled=d["status"] != "PENDING_APPROVAL")
            if d["status"] == "PENDING_APPROVAL":
                a, rj, tst = st.columns(3)
                if a.button("✅ Approve & send", key=f"a{d['id']}", type="primary"):
                    try:
                        emails.approve(d["id"], subj, body)
                        resp = emails.send(d["id"])
                        st.success(f"Sent ✔ (Resend id {resp.get('id')})")
                    except Exception as e:
                        st.error(str(e))
                    st.rerun()
                if rj.button("✖ Reject", key=f"r{d['id']}"):
                    emails.reject(d["id"]); st.rerun()
                if tst.button("🧪 Try sending without approval", key=f"t{d['id']}"):
                    try:
                        emails.send(d["id"])
                    except PermissionError as e:
                        st.error("🛑 " + str(e))
            elif d["status"] == "SENT":
                st.success(f"Sent via Resend · id `{d['provider_id']}` · approved at {d['decided_at']}")

# ---------------- Evaluation ----------------
with tabs[6]:
    p = os.path.join(ROOT, "eval", "results.json")
    if not os.path.exists(p):
        st.info("Run `python eval/run_eval.py` to generate evaluation results.")
    else:
        R = json.load(open(p, encoding="utf-8"))
        st.caption(f"Evaluated {R['generated_at']} on {R['n_labeled']} hand-labeled transactions + planted anomalies + safety cases.")
        c = R["categorization"]
        m = st.columns(4)
        m[0].metric("LLM-only baseline", f"{c['llm_only']['accuracy']*100:.1f}%")
        m[1].metric("Hybrid (cold start)", f"{c['hybrid_cold']['accuracy']*100:.1f}%")
        m[2].metric("Hybrid + correction memory", f"{c['hybrid_with_memory']['accuracy']*100:.1f}%")
        m[3].metric("Safety cases passed", f"{R['safety']['passed']}/{R['safety']['total']}")
        h = c.get("held_out_sep_oct")
        if h:
            st.success(f"🧠 Memory generalizes: corrections learned from **August only** {h['corrections_learned_from_aug']} → "
                       f"held-out Sep+Oct accuracy **{h['cold']*100:.1f}% → {h['with_memory']*100:.1f}%** ({h['n']} txns)")
        if c.get("hard_india"):
            st.markdown("#### Harder, untuned test sets (honest numbers)")
            hi, hf = c["hard_india"], c["public_hf_sample"]
            st.dataframe(pd.DataFrame([
                {"Test set": f"Hard India: {hi['hybrid']['n']} messy descriptors (FASTag, EMI, POS codes, raw UPI handles)",
                 "LLM-only": f"{hi['llm_only']['accuracy']*100:.1f}%", "KharchaSaathi hybrid": f"{hi['hybrid']['accuracy']*100:.1f}%"},
                {"Test set": f"Public benchmark: {hf['hybrid']['n']} rows from HuggingFace DoDataThings/us-bank-transaction-categories (US)",
                 "LLM-only": f"{hf['llm_only']['accuracy']*100:.1f}%", "KharchaSaathi hybrid": f"{hf['hybrid']['accuracy']*100:.1f}%"}]),
                hide_index=True, width="stretch")
            with st.expander("Errors on harder sets"):
                st.dataframe(pd.DataFrame(hi["hybrid"]["errors"] + hf["hybrid"]["errors"]), hide_index=True, width="stretch")
        st.markdown("#### Detection (precision / recall vs planted ground truth)")
        st.dataframe(pd.DataFrame(R["detection"]), hide_index=True, width="stretch")
        st.markdown("#### Safety & failure-handling cases")
        st.dataframe(pd.DataFrame(R["safety"]["cases"]), hide_index=True, width="stretch")
        if c["hybrid_cold"].get("errors"):
            st.markdown("#### Remaining cold-start errors")
            st.dataframe(pd.DataFrame(c["hybrid_cold"]["errors"]), hide_index=True, width="stretch")

# ---------------- Audit log ----------------
with tabs[7]:
    lg = pd.DataFrame(db.q("SELECT ts, actor, event, detail FROM audit_log WHERE run_id=? OR run_id IS NULL ORDER BY id DESC", (run_id,)))
    st.dataframe(lg, hide_index=True, width="stretch", height=520)
