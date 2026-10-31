/* KharchaSaathi - Your report (#/report)
   The results page: verdict headline, four numbers, the money calendar with
   a "What to do" panel (and the actions you can take there), what charges you
   next, the plan in four charts, and the things that need your eyes.

   Data: /api/state is required. /api/findings, /api/renewals, /api/runs/compare,
   /api/insights and /api/memory add to it, and the page still works without them.
   Actions only ever write drafts or remember a choice. Nothing here can send an
   email or move money: sending happens in Emails, after the person approves.   */
import { html, raw, mount, $, $$, on, api, store, summarize, fmt, plain, GROUP, KIND, reveal, navigate, toast } from '../core.js';
import { hbars, segbar, calendar, tipCard, bindTips, whenVisible, finishAll, count, reducedMotion } from '../charts.js';

export const title = 'Your report';

/* ---------- small helpers ---------- */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : fmt.n(n));
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstSentence = (t) => (String(t || '').match(/^.*?[.!?](?=\s|$)/) || [String(t || '')])[0];
const pct0 = (n) => `${Math.round(Number(n) || 0)}%`;
/** 30.5 -> "30.5%", 40.0 -> "40%": the same figure the agent's own summary shows. */
const pct1 = (n) => `${Math.round((Number(n) || 0) * 10) / 10}%`;
const money = (n) => fmt.inr(n, Number(n) % 1 ? 2 : 0);
const ordinal = (d) => `${d}${['th', 'st', 'nd', 'rd'][d % 10 > 3 || [11, 12, 13].includes(d) ? 0 : d % 10]}`;
const andList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const plural = (n, one, many) => `${word(n)} ${n === 1 ? one : many || `${one}s`}`;
const BADGE = { back: 'badge-blue', stop: 'badge-orange', up: 'badge-bad', keep: '', subs: '' };
const C = {
  back: 'var(--c-blue)', stop: 'var(--c-orange)', up: 'var(--c-red)', upOld: 'var(--c-red-2)', keep: 'var(--ink-4)', subs: 'var(--ink-4)', flag: 'var(--ink)',
  trim: 'var(--c-orange-2)', save: 'var(--c-aqua)', save2: 'var(--c-aqua-2)', bar: 'var(--rp-keep)', track: 'var(--track)',
};
const HORIZON = 30;
const RING_FROM = 5000; // payments this big are drawn as a ring at the largest size

/* What a finding's status means, in plain words. */
const STATUS = {
  open:           { short: '',               tone: '',     text: 'No email yet. Nothing is sent until you approve it.' },
  draft_pending:  { short: 'Email waiting',  tone: 'wait', text: 'An email is written. It is waiting for your OK.' },
  approved:       { short: 'Email approved', tone: 'wait', text: 'You approved the email, but it has not gone out yet.' },
  email_sent:     { short: 'Email sent',     tone: 'good', text: 'Email sent.' },
  draft_rejected: { short: 'Not sending',    tone: '',     text: 'You chose not to send the email.' },
  dismissed:      { short: 'Expected',       tone: '',     text: 'You said this is expected. Future audits will not flag it.' },
};
const DRAFT_TO_STATUS = { PENDING_APPROVAL: 'draft_pending', APPROVED: 'approved', SENT: 'email_sent', REJECTED: 'draft_rejected' };

const svg = (inner, w = '1.7') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`);
const I = {
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>'),
  steps: svg('<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>'),
  tag: svg('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>'),
  print: svg('<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8.5" rx="2"/><path d="M7 14h10v6.5H7z"/>'),
  check: svg('<path d="m5 12.5 4.2 4L19 7"/>', '1.9'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', '1.8'),
  question: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6"/><path d="M12 17.2h.01"/>'),
  shield: svg('<path d="M12 3 19 6v5.2c0 4.4-2.9 8.2-7 9.8-4.1-1.6-7-5.4-7-9.8V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
  row: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17"/><path d="M15 12h2.5" stroke-width="2.4"/>'),
  file: svg('<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="m10 12.5 4 4M14 12.5l-4 4"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>', '1.8'),
  play: svg('<circle cx="12" cy="12" r="9"/><path d="M10 8.8v6.4l5.2-3.2z" fill="currentColor"/>'),
  alert: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.6M12 15.8v.2"/>'),
  history: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.8v4h4"/><path d="M12 8v4.3l2.8 1.7"/>'),
};

/* =====================================================================
   Model: turn the API answers into everything the page says.
   ===================================================================== */
function buildModel({ state: s, findings, renewals, compare, insights, memory }) {
  const S = summarize(s);
  const b = S.budget;
  const tx = s.transactions || [];
  const debits = tx.filter((t) => t.direction === 'DR');
  const months = S.months && S.months.length ? S.months : [...new Set(tx.map((t) => t.date.slice(0, 7)))].sort();
  const srcWord = (src) => (src === 'card' ? 'credit card' : 'bank account');
  const findTx = (m, from, to, amount) => debits.filter((t) => t.merchant === m && (!from || (t.date >= from && t.date <= (to || from))) && (amount == null || Math.abs(t.amount - amount) < 0.005));

  /* drafts and each finding's status */
  const drafts = [...(s.drafts || [])].sort((p, q) => p.id - q.id);
  const findingById = new Map((s.findings || []).map((f) => [f.id, f]));
  const lastDraftOf = new Map(drafts.map((d) => [d.finding_id, d]));
  const metaById = new Map(((findings && findings.findings) || []).map((f) => [f.id, f]));
  const meta = (id) => {
    if (metaById.has(id)) return metaById.get(id);
    const d = lastDraftOf.get(id); // /api/findings did not answer: work out what we can from the drafts
    return { id, status: d ? DRAFT_TO_STATUS[d.status] : 'open', draft_id: d ? d.id : null, suggested_email: null, can_dismiss: false };
  };
  const isDismissed = (id) => meta(id).status === 'dismissed';
  /** The newest cancel email for a shop, whichever finding it hangs from (never a turned-down one). */
  const cancelEmail = (m) => [...drafts].reverse().find((d) => d.kind === 'cancellation' && d.status !== 'REJECTED' && (findingById.get(d.finding_id) || {}).merchant === m) || null;
  const pending = drafts.filter((d) => d.status === 'PENDING_APPROVAL');
  const mail = { total: drafts.filter((d) => d.status !== 'REJECTED').length, pending: pending.length, sent: drafts.filter((d) => d.status === 'SENT').length, firstPending: pending.length ? pending[0].id : null };

  /* what the person has told us: details.user_decision is frozen at audit time, memory is live */
  const memOk = !!(memory && memory.subscription_decisions);
  const decisions = new Map();
  if (memOk) memory.subscription_decisions.forEach((d) => decisions.set(d.merchant, d.decision));
  else {
    S.subs.forEach((x) => { if (x.user_decision) decisions.set(x.merchant, x.user_decision); });
    ((renewals && renewals.renewals) || []).forEach((r) => { if (r.user_decision) decisions.set(r.merchant, r.user_decision); });
  }
  const cancelledOn = new Map((s.cancellations || []).map((c) => [c.merchant, { date: c.cancelled_on, inApp: /^confirmed/i.test(c.note || '') }]));
  const dismissalKey = (id) => {
    const f = findingById.get(id);
    if (!f || !memOk) return null;
    const hit = (memory.dismissals || []).find((d) => d.kind === f.kind && d.merchant === f.merchant && (f.kind !== 'duplicate' || Math.abs((d.amount || 0) - (f.amount || 0)) < 0.005));
    return hit ? hit.key : null;
  };

  /* what still counts, once your choices are taken into account */
  const subBy = new Map(S.subs.map((x) => [x.merchant, x]));
  const dups = S.dups.filter((d) => !isDismissed(d.id));
  const zombies = S.zombies.filter((z) => !isDismissed(z.id));
  const trials = S.trials.filter((t) => !isDismissed(t.id));
  const hikes = S.hikes.filter((h) => !isDismissed(h.id));
  const hikeBy = new Map(S.hikes.map((h) => [h.merchant, h]));
  const hikeLive = new Map(hikes.map((h) => [h.merchant, h]));
  const zombieBy = new Map(S.zombies.map((z) => [z.merchant, z]));
  const trialBy = new Map(S.trials.map((t) => [t.merchant, t]));
  const moneyBack = dups.reduce((a, x) => a + x.amount, 0) + zombies.reduce((a, x) => a + x.amount, 0);
  const asked = [...dups, ...zombies].filter((x) => meta(x.id).status === 'email_sent').reduce((a, x) => a + x.amount, 0);
  const hikesYearly = hikes.reduce((a, x) => a + x.extra_per_year, 0);

  /* the plan (fixed at audit time) and what you want to stop now */
  const planStop = S.cancelMerchants.length ? S.cancelMerchants : [...new Set([...S.zombies, ...S.trials].map((x) => x.merchant))];
  const stopKeys = [...planStop.filter((m) => decisions.get(m) !== 'keep'), ...[...decisions].filter(([m, d]) => d === 'cancel' && !planStop.includes(m) && subBy.has(m)).map(([m]) => m)];
  const stopSet = new Set(stopKeys);
  const monthlyOf = (m) => (subBy.get(m) ? subBy.get(m).latest_amount : trialBy.get(m) ? trialBy.get(m).paid_amount : 0);
  const name = (m) => (subBy.get(m) || {}).display || (debits.find((t) => t.merchant === m) || {}).merchant_display || m;
  const liveStopMonthly = stopKeys.reduce((a, m) => a + monthlyOf(m), 0);
  const planStopMonthly = b && b.cancellable_monthly != null ? b.cancellable_monthly : planStop.reduce((a, m) => a + monthlyOf(m), 0);
  const planChanged = [...planStop.filter((m) => !stopSet.has(m)), ...stopKeys.filter((m) => !planStop.includes(m))];

  /* when the next charge is expected */
  const nextBy = new Map(((renewals && renewals.renewals) || []).map((r) => [r.merchant, r.date]));
  S.subs.forEach((x) => { if (!nextBy.has(x.merchant) && x.next_expected) nextBy.set(x.merchant, x.next_expected); });

  /* per-payment tags (colour and tooltip) */
  const tag = new Map(); // id -> back | stop | up | upOld | flag | ok | orig
  const note = new Map();
  const set = (id, t, n) => { tag.set(id, t); if (n) note.set(id, n); };
  debits.forEach((t) => {
    if (stopSet.has(t.merchant)) {
      const tr = trialBy.get(t.merchant);
      set(t.id, 'stop', tr && t.amount <= tr.trial_amount + 0.005 ? `Free trial. It turned into ${fmt.inr(tr.paid_amount)} a month.` : 'You plan to stop paying for this.');
    } else if (decisions.get(t.merchant) === 'keep' && subBy.has(t.merchant)) note.set(t.id, 'You chose to keep this.');
    const h = hikeLive.get(t.merchant);
    if (h && !tag.has(t.id)) {
      if (t.amount >= h.new - 0.005) set(t.id, 'up', `Price went up from ${fmt.inr(h.old)}.`);
      else set(t.id, 'upOld', 'The old price, before it went up.');
    }
    if (t.flags === 'prompt_injection') set(t.id, 'flag', 'It hid an instruction for the AI. The agent ignored it.');
  });
  const EXPECTED = 'You said this is expected.';
  S.notDups.forEach((d) => findTx(d.merchant, d.first_date, d.date, d.amount).forEach((t) => set(t.id, 'ok', 'Looked like a double charge. It was a separate order.')));
  S.hikes.filter((h) => isDismissed(h.id)).forEach((h) => debits.filter((t) => t.merchant === h.merchant && !tag.has(t.id)).forEach((t) => set(t.id, 'ok', EXPECTED)));
  S.dups.forEach((d) => {
    const ts = findTx(d.merchant, d.first_date, d.date, d.amount).sort((p, q) => p.id - q.id);
    if (isDismissed(d.id)) ts.forEach((t) => set(t.id, 'ok', EXPECTED));
    else ts.forEach((t, i) => (i === ts.length - 1 ? set(t.id, 'back', 'Charged twice. Ask for this one back.') : set(t.id, 'orig', 'The real charge. The one next to it is the extra.')));
  });
  S.zombies.forEach((z) => findTx(z.merchant, z.date, z.date, z.amount).forEach((t) => (isDismissed(z.id) ? set(t.id, 'ok', EXPECTED) : set(t.id, 'back', `Charged after you cancelled on ${fmt.date(z.cancelled_on)}. Ask for it back.`))));

  /* "What to do" rows */
  const rows = [];
  const idsOf = (ts) => ts.map((t) => String(t.id));
  const payList = (ts) => {
    const runs = [];
    [...ts].sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0)).forEach((t) => {
      const last = runs[runs.length - 1];
      if (last && last.amount === t.amount) last.dates.push(t.date); else runs.push({ amount: t.amount, dates: [t.date] });
    });
    return `${runs.map((r) => `${money(r.amount)} on ${andList(r.dates.map((d) => fmt.date(d)))}`).join(', ')}.`;
  };
  S.dups.forEach((d) => {
    const off = isDismissed(d.id);
    rows.push({
      key: `f${d.id}`, type: 'finding', fid: d.id, merchant: d.merchant, group: off ? 'keep' : 'back', name: d.display, line: off ? 'You said this is expected' : `Charged twice on ${fmt.date(d.date)}`,
      amount: fmt.inr(d.amount), ids: idsOf(findTx(d.merchant, d.first_date, d.date, d.amount)),
      happened: `${d.display} took ${fmt.inr(d.amount)} from your ${srcWord(d.source)} twice on ${fmt.date(d.date)}. You only owe it once.`,
      how: firstSentence(d.reason) || 'Same shop, same amount, same day, same note.',
      todo: `Ask your ${d.source === 'card' ? 'card company' : 'bank'} to reverse the extra charge.`,
    });
  });
  S.zombies.forEach((z) => {
    const off = isDismissed(z.id);
    rows.push({
      key: `f${z.id}`, type: 'finding', fid: z.id, merchant: z.merchant, group: off ? 'keep' : 'back', name: z.display, line: off ? 'You said this is expected' : 'Charged after you cancelled',
      amount: fmt.inr(z.amount), ids: idsOf(findTx(z.merchant, z.date, z.date, z.amount)),
      happened: `You cancelled ${z.display} on ${fmt.date(z.cancelled_on)}, but it still took ${fmt.inr(z.amount)} on ${fmt.date(z.date)}.`,
      how: 'You told us the date you cancelled. This payment came after it.',
      todo: `Ask ${z.display} for a refund, and to switch off the auto-debit.`,
    });
  });
  const subRow = (m, group) => {
    const sub = subBy.get(m), z = zombieBy.get(m), tr = trialBy.get(m), dec = decisions.get(m), c = cancelledOn.get(m), monthly = monthlyOf(m);
    const ts = debits.filter((t) => t.merchant === m);
    const next = nextBy.get(m);
    const nextText = next ? ` The next charge is expected on ${fmt.date(next)}.` : '';
    const line = dec === 'keep' ? 'You chose to keep this' : c ? `You cancelled on ${fmt.date(c.date)}` : tr ? 'Free trial turned paid' : dec === 'cancel' ? 'You asked to cancel'
      : group === 'stop' ? 'Monthly subscription' : next ? `Next charge ${fmt.date(next)}` : sub ? `On the ${ordinal(sub.day_of_month)} of every month` : 'Monthly subscription';
    return {
      key: `sub-${m}`, type: 'sub', merchant: m, group, name: name(m), line, amount: `${fmt.inr(monthly)}/mo`, ids: idsOf(ts), holdId: tr ? tr.id : null,
      happened: `${tr ? `${name(m)} started as a ${fmt.inr(tr.trial_amount)} free trial, then charged ${fmt.inr(tr.paid_amount)} every month after.`
        : z ? `${name(m)} charges ${fmt.inr(monthly)} every month. You cancelled it, but the auto-debit is still running.`
          : `${name(m)} charges ${fmt.inr(monthly)} every month${sub ? `, around the ${ordinal(sub.day_of_month)}` : ''}.`}${nextText}`,
      how: `${ts.length} ${ts.length === 1 ? 'payment' : 'payments'}: ${payList(ts)}`,
      todo: tr ? `Cancel it and stop the auto-debit. That saves ${fmt.inr(monthly * 12)} a year.`
        : z ? `Make sure the auto-debit is off, so it stops for good. That saves ${fmt.inr(monthly * 12)} a year.`
          : group === 'stop' ? `Cancel it to save ${fmt.inr(monthly * 12)} a year.` : 'Nothing is wrong here. Keep it, or cancel it if you no longer use it.',
    };
  };
  stopKeys.forEach((m) => rows.push(subRow(m, 'stop')));
  S.hikes.forEach((h) => {
    const fee = h.kind === 'bank_fee_hike', off = isDismissed(h.id);
    const ts = debits.filter((t) => t.merchant === h.merchant);
    const firstNew = ts.find((t) => t.amount >= h.new - 0.005);
    rows.push({
      key: `f${h.id}`, type: subBy.has(h.merchant) ? 'hike' : 'finding', fid: h.id, holdId: subBy.has(h.merchant) ? h.id : null, merchant: h.merchant, group: off ? 'keep' : 'up',
      name: fee ? 'Bank fee' : h.display, line: off ? 'You said this is expected' : `${fmt.inr(h.old)} → ${fmt.inr(h.new)}${fee ? ' a month' : ''}`,
      amount: fmt.signedPct(h.pct), ids: idsOf(ts),
      happened: `${fee ? 'Your bank’s account maintenance fee' : h.display} went from ${fmt.inr(h.old)} to ${fmt.inr(h.new)}${firstNew ? ` in ${fmt.month(firstNew.date.slice(0, 7))}` : ''}. That is ${fmt.inr(h.extra_per_year)} more a year.`,
      how: payList(ts),
      todo: fee ? 'Ask the bank to waive it, or move to a zero-balance account.' : `Check it is still worth ${fmt.inr(h.new)} a month. If not, cancel it or pick a cheaper plan.`,
    });
  });
  S.notDups.forEach((d, i) => {
    const ts = findTx(d.merchant, d.first_date, d.date, d.amount);
    rows.push({
      key: `ok-${i}`, type: 'info', merchant: d.merchant, group: 'keep', name: d.display, line: 'Two orders, not a double charge', amount: `${fmt.inr(d.amount)} ×${ts.length || 2}`, ids: idsOf(ts),
      happened: `Two ${fmt.inr(d.amount)} payments to ${d.display} on ${fmt.date(d.date)} looked like a double charge.`,
      how: firstSentence(d.reason) || 'The notes on the two payments are different.', todo: 'Nothing. Both orders were real, so there is nothing to claim.',
    });
  });
  S.subs.filter((x) => !stopSet.has(x.merchant) && !hikeBy.has(x.merchant)).sort((p, q) => q.latest_amount - p.latest_amount).forEach((x) => rows.push(subRow(x.merchant, 'subs')));

  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const rowByTx = new Map();
  rows.forEach((r) => r.ids.forEach((id) => { if (!rowByTx.has(id)) rowByTx.set(id, r.key); }));
  const rowOfMerchant = (m) => rows.find((r) => r.merchant === m && (r.type === 'sub' || r.type === 'hike')) || null;

  /* budget */
  const lines = b ? b.lines || [] : [];
  const cutCats = new Set(lines.filter((l) => l.change < 0).map((l) => l.category));
  const dots = debits.map((t) => ({ t, tag: tag.get(t.id) || 'none' }));

  return {
    s, S, b, tx, debits, months, rows, rowByKey, rowByTx, rowOfMerchant, dots, note, lines, cutCats, subBy, hikeBy, hikeLive,
    dups, zombies, trials, hikes, moneyBack, asked, hikesYearly, planStop, stopKeys, stopSet, planStopMonthly, liveStopMonthly, planChanged, name,
    meta, isDismissed, cancelEmail, decisions, cancelledOn, dismissalKey, memOk, mail,
    renewals, compare, insights, nFiles: new Set(tx.map((t) => t.file)).size, skipped: s.parse_failures || [], setAside: s.quarantine || [],
  };
}

/* What a "What to do" row can do right now: status words, what to do, and its buttons. */
function rowState(r, M) {
  const out = { text: '', tone: '', short: '', todo: r.todo, primary: null, more: [] };
  if (r.type === 'info') { out.text = 'Nothing to do.'; return out; }
  const link = (id, label, style = 'btn-primary') => ({ href: `#/emails?id=${id}`, label, style, icon: I.mail });
  const undo = { do: 'undo', label: 'Undo', busy: 'Undoing…', style: 'btn-ghost' };
  const useStatus = (key) => { const st = STATUS[key] || STATUS.open; out.text = st.text; out.tone = st.tone; out.short = st.short; };
  const f = r.fid != null ? M.meta(r.fid) : null;

  if (f && f.status === 'dismissed') {
    useStatus('dismissed');
    out.todo = 'Nothing. You can undo this if you change your mind.';
    if (undoTasks(r, M).length) out.more.push(undo);
    return out;
  }

  if (r.type === 'finding') {
    const expected = f.can_dismiss ? { do: 'expected', label: 'This is expected', style: 'btn-secondary' } : null;
    const write = (label) => (f.suggested_email ? { do: 'write', label, busy: 'Writing the email…', style: 'btn-primary', icon: I.mail } : null);
    useStatus(f.status);
    if (f.status === 'draft_pending') { out.todo = 'Read the email and approve it. Nothing goes out until you do.'; out.primary = link(f.draft_id, 'Read the email'); }
    else if (f.status === 'approved') { out.todo = 'Open the email and try sending it again.'; out.primary = link(f.draft_id, 'Open the email'); }
    else if (f.status === 'email_sent') { out.todo = 'You have asked. Watch your next statement for the answer.'; out.primary = f.draft_id ? link(f.draft_id, 'See the email', 'btn-secondary') : null; }
    else if (f.status === 'draft_rejected') { out.primary = write('Write a new email'); }
    else { out.primary = write('Write the email'); }
    if (expected && f.status !== 'email_sent') out.more.push(expected);
    return out;
  }

  /* subscriptions: the row is about the shop, whichever finding its cancel email hangs from */
  const m = r.merchant, dec = M.decisions.get(m), email = M.cancelEmail(m), cancelled = M.cancelledOn.get(m);
  const hold = r.holdId != null && !M.isDismissed(r.holdId) && M.meta(r.holdId).can_dismiss;
  const keep = { do: 'keep', label: hold ? 'Keep it, this is expected' : 'Keep it', busy: 'Saving…', style: 'btn-secondary' };
  const already = { do: 'already', label: 'I already cancelled', style: 'btn-ghost' };
  const pend = email && email.status === 'PENDING_APPROVAL';

  if (dec === 'keep') {
    out.text = 'You chose to keep this. We will not suggest cancelling it again.'; out.short = 'Keeping';
    out.todo = 'Nothing. Your next audit will leave it in your budget.';
    if (pend) { out.text += ' A cancel email is still waiting.'; out.todo = 'Turn down the waiting email in Emails, so it does not go out.'; out.primary = link(email.id, 'Read the email', 'btn-secondary'); }
    if (undoTasks(r, M).length) out.more.push(undo);
    return out;
  }
  if (email) {
    useStatus(DRAFT_TO_STATUS[email.status]);
    if (pend) { out.todo = 'Read the email and approve it. Nothing goes out until you do.'; out.primary = link(email.id, 'Read the email'); }
    else if (email.status === 'APPROVED') { out.todo = 'Open the email and try sending it again.'; out.primary = link(email.id, 'Open the email'); }
    else { out.todo = 'You have asked. If it still charges you, tell us the day you cancelled.'; out.primary = link(email.id, 'See the email', 'btn-secondary'); }
    if (!cancelled) out.more.push(already);
    if (email.status !== 'SENT') out.more.push(keep);
    return out;
  }
  if (dec === 'cancel') {
    out.text = 'You asked to cancel. The email is not written yet.'; out.tone = 'wait'; out.short = 'Cancelling';
    out.primary = { do: 'cancel', label: 'Write the cancel email', busy: 'Writing the email…', style: 'btn-primary', icon: I.mail };
    if (undoTasks(r, M).length) out.more.push(undo);
    out.more.push(keep);
    return out;
  }
  const stillCharged = M.zombies.some((z) => z.merchant === m);
  out.text = stillCharged ? `You cancelled on ${fmt.date(cancelled ? cancelled.date : M.zombies.find((z) => z.merchant === m).cancelled_on)}, but it still charged you.`
    : cancelled ? `You told us you cancelled on ${fmt.date(cancelled.date)}.` : 'No decision yet. Cancelling only writes an email for you to check.';
  out.primary = { do: 'cancel', label: cancelled || stillCharged ? 'Write the cancel email' : 'Cancel it', busy: 'Writing the email…', style: r.group === 'stop' ? 'btn-primary' : 'btn-secondary', icon: cancelled || stillCharged ? I.mail : null };
  if (cancelled && cancelled.inApp && undoTasks(r, M).length) out.more.push(undo);
  if (!cancelled) out.more.push(already);
  out.more.push(keep);
  return out;
}

/** What to forget from memory to undo this row's choice: [[type, key], ...]. */
function undoTasks(r, M) {
  if (!M.memOk) return [];
  const out = [];
  const addDismissal = (id) => { const k = id != null ? M.dismissalKey(id) : null; if (k) out.push(['dismissals', k]); };
  if (r.type === 'finding') { addDismissal(r.fid); return out; }
  if (M.decisions.has(r.merchant)) out.push(['sub_decisions', r.merchant]);
  addDismissal(r.fid != null ? r.fid : r.holdId);
  const c = M.cancelledOn.get(r.merchant);
  if (!out.length && c && c.inApp) out.push(['cancellations', r.merchant]);
  return out;
}

/* =====================================================================
   States: loading, empty, error
   ===================================================================== */
function skeleton() {
  return html`<div class="rp rp-loading" aria-busy="true" aria-label="Loading your report">
    <section class="page page-wide rp-hero">
      <div class="skel" style="width:280px;height:14px"></div>
      <div class="skel" style="width:min(780px,90%);height:76px;margin-top:24px;border-radius:14px"></div>
      <div class="skel" style="width:min(620px,70%);height:76px;margin-top:12px;border-radius:14px"></div>
      <div class="skel" style="width:min(640px,95%);height:16px;margin-top:32px"></div>
      <div class="skel" style="width:min(560px,85%);height:16px;margin-top:10px"></div>
      <div class="row" style="margin-top:32px;gap:10px"><div class="skel" style="width:180px;height:44px;border-radius:99px"></div><div class="skel" style="width:150px;height:44px;border-radius:99px"></div><div class="skel" style="width:140px;height:44px;border-radius:99px"></div></div>
    </section>
    <section class="page page-wide"><div class="card rp-stats">${[0, 1, 2, 3].map(() => html`<div class="rp-stat"><div class="skel" style="width:60%;height:12px"></div><div class="skel" style="width:70%;height:44px;margin-top:18px"></div><div class="skel" style="width:90%;height:12px;margin-top:16px"></div></div>`)}</div></section>
    <section class="page page-wide rp-sec"><div class="rp-map-grid"><div class="card skel" style="height:560px;border-radius:20px"></div><div class="card skel" style="height:560px;border-radius:20px"></div></div></section>
  </div>`;
}
function emptyCal() {
  const cells = [];
  for (let i = 0; i < 35; i++) cells.push(html`<rect x="${(i % 7) * 26 + 1}" y="${Math.floor(i / 7) * 26 + 1}" width="22" height="22" rx="6"/>`);
  return html`<svg class="rp-empty-art" viewBox="0 0 182 130" aria-hidden="true">${cells}<circle cx="64" cy="38" r="5.5" class="d1"/><circle cx="116" cy="64" r="4" class="d2"/><circle cx="38" cy="90" r="7" class="d3"/></svg>`;
}
function emptyView() {
  return html`<div class="rp rp-empty-wrap"><section class="page">
    <div class="card rp-empty">
      ${emptyCal()}
      <p class="eyebrow">Your report</p>
      <h1 class="h1">No report yet</h1>
      <p class="lead">Run an audit, or watch a recorded one.</p>
      <div class="row-wrap rp-empty-actions">
        <a class="btn btn-primary btn-lg" href="#/start">Start an audit <span aria-hidden="true">→</span></a>
        <a class="btn btn-secondary btn-lg" href="#/run?mode=replay">${I.play} Watch a recorded run</a>
      </div>
    </div>
  </section></div>`;
}
function errorView(e) {
  return html`<div class="rp rp-empty-wrap"><section class="page">
    <div class="card rp-empty">
      <p class="eyebrow">Your report</p>
      <h1 class="h2">We could not load your report</h1>
      <p class="lead">The app could not reach its server. Check that it is running, then try again.</p>
      <p class="tiny mono">${String((e && e.message) || e)}</p>
      <div class="row-wrap rp-empty-actions"><button class="btn btn-primary" data-act="retry">Try again</button><a class="btn btn-secondary" href="#/">Back to home</a></div>
    </div>
  </section></div>`;
}

/* =====================================================================
   Sections
   ===================================================================== */
function verdict(M) {
  const nStop = M.stopKeys.length, nUp = M.hikes.length;
  const a = M.moneyBack > 0
    ? html`Get <span class="rp-hl rp-hl-back">${fmt.inr(M.moneyBack)} back.</span>`
    : nStop || nUp ? html`Nothing to claim back.` : html`Your money looks clean.`;
  const b = nStop > 0
    ? html`Stop paying for <span class="rp-hl rp-hl-stop">${word(nStop)} ${nStop === 1 ? 'thing' : 'things'}.</span>`
    : nUp > 0 ? html`Keep an eye on <span class="rp-hl rp-hl-up">${word(nUp)} price ${nUp === 1 ? 'rise' : 'rises'}.</span>`
      : M.moneyBack > 0 ? html`Everything else can stay.` : html`Nothing to fix this time.`;
  return html`<span class="rp-line">${a}</span> <span class="rp-line">${b}</span>`;
}
function period(months) {
  if (!months.length) return '';
  const a = months[0], z = months[months.length - 1];
  return a === z ? fmt.month(a, true) : `${fmt.month(a)}–${fmt.month(z)} ${z.slice(0, 4)}`;
}
function emailButton(M) {
  const { total, pending, firstPending } = M.mail;
  const em = (n) => (n === 1 ? 'email' : 'emails');
  const label = !total ? 'See your emails'
    : pending === total ? `Read the ${total} ${em(total)}`
      : pending === 1 ? 'Read the waiting email'
        : pending ? `Read the ${pending} waiting emails` : `See your ${total} ${em(total)}`;
  return { label, href: firstPending != null ? `#/emails?id=${firstPending}` : '#/emails' };
}

function heroTpl(M) {
  const { s } = M;
  const ran = s.run && s.run.started_at ? fmt.date(s.run.started_at.slice(0, 10), true) : '';
  const mail = emailButton(M);
  return html`<section class="page page-wide rp-hero">
    <p class="eyebrow rp-eyebrow reveal">Your report <span aria-hidden="true">·</span> ${(s.profile && s.profile.name) || 'You'} <span aria-hidden="true">·</span> ${period(M.months)}</p>
    <h1 class="rp-verdict reveal" style="--d:60ms">${verdict(M)}</h1>
    <div class="row-wrap rp-meta reveal" style="--d:200ms">
      <span class="badge rp-badge-ok">${I.check}Based on ${fmt.n(M.tx.length)} transactions from ${M.nFiles} ${M.nFiles === 1 ? 'statement' : 'statements'}</span>
      ${M.skipped.length ? html`<button class="badge badge-warn" data-jump="rp-eyes">${M.skipped.length} ${M.skipped.length === 1 ? 'file' : 'files'} skipped</button>` : ''}
      ${M.setAside.length ? html`<button class="badge" data-jump="rp-eyes">${M.setAside.length} ${M.setAside.length === 1 ? 'row' : 'rows'} set aside</button>` : ''}
      ${ran ? html`<span class="tiny rp-ran">Audit run on ${ran}</span>` : ''}
    </div>
    <div class="row-wrap rp-actions reveal" style="--d:260ms">
      <a class="btn btn-primary" href="${mail.href}">${I.mail}${mail.label}</a>
      <a class="btn btn-secondary" href="#/run?mode=replay">${I.steps}See every step</a>
      <a class="btn btn-ghost" href="#/transactions">${I.tag}Fix categories</a>
      <button class="btn btn-ghost" data-act="print">${I.print}Print report</button>
    </div>
  </section>`;
}

function statsTpl(M) {
  const { S, b } = M;
  const now = b ? b.current_savings_pct : 0, plan = b ? b.projected_savings_pct : 0;
  const nBack = M.dups.length + M.zombies.length;
  const upNames = M.hikes.map((h) => (h.kind === 'bank_fee_hike' ? 'a bank fee' : h.display));
  const backText = !nBack ? (S.dups.length + S.zombies.length ? 'You said these charges are expected.' : 'Nothing was taken by mistake.')
    : M.asked >= M.moneyBack - 0.005 ? `${cap1(word(nBack))} ${nBack === 1 ? 'payment was' : 'payments were'} taken by mistake. You have asked for all of it back.`
      : M.asked > 0 ? `${cap1(word(nBack))} ${nBack === 1 ? 'payment was' : 'payments were'} taken by mistake. You have asked for ${fmt.inr(M.asked)} so far.`
        : `${cap1(word(nBack))} ${nBack === 1 ? 'payment was' : 'payments were'} taken by mistake: charged twice, or after you cancelled.`;
  return html`<section class="page page-wide rp-stats-sec">
    <div class="card rp-stats reveal" style="--d:300ms">
      <div class="rp-stat">
        <div class="rp-stat-label"><i style="background:${raw(C.back)}"></i>Money to get back</div>
        <div class="rp-stat-value"><span data-count="${M.moneyBack}" data-fmt="inr">${fmt.inr(0)}</span></div>
        <p class="rp-stat-sub">${backText}</p>
        <div class="rp-stat-bar" data-bar="back"></div>
      </div>
      <div class="rp-stat">
        <div class="rp-stat-label"><i style="background:var(--ink)"></i>Subscriptions</div>
        <div class="rp-stat-value"><span data-count="${S.subsMonthly}" data-fmt="inr">${fmt.inr(0)}</span><small>a month</small></div>
        <p class="rp-stat-sub">${S.subs.length ? `That is ${fmt.inr(S.subsYearly)} a year, for ${S.subs.length} ${S.subs.length === 1 ? 'service' : 'services'}.` : 'No monthly subscriptions were found.'}</p>
        <div class="rp-stat-bar" data-bar="subs"></div>
      </div>
      <div class="rp-stat">
        <div class="rp-stat-label"><i style="background:${raw(C.up)}"></i>Price rises</div>
        <div class="rp-stat-value"><span data-count="${M.hikesYearly}" data-fmt="plusinr">${fmt.inr(0)}</span><small>a year</small></div>
        <p class="rp-stat-sub">${M.hikes.length ? `${cap1(andList(upNames))} now ${M.hikes.length === 1 ? 'costs' : 'cost'} more than before.` : S.hikes.length ? 'You said these price rises are expected.' : 'No prices went up.'}</p>
        <div class="rp-stat-bar" data-bar="up"></div>
      </div>
      <div class="rp-stat">
        <div class="rp-stat-label"><i style="background:${raw(C.save)}"></i>You save</div>
        <div class="rp-stat-value"><span data-count="${now}" data-fmt="pct">0%</span><span class="rp-arrow" aria-hidden="true">→</span><span data-count="${plan}" data-fmt="pct">0%</span></div>
        <p class="rp-stat-sub">Of your income, today and with this plan.</p>
        <div class="rp-stat-bar" data-bar="save"></div>
      </div>
    </div>
  </section>`;
}

/* ---------- Since your last audit: one quiet line, details only when there is something to list ---------- */
const ACT_WORDS = {
  category_correction: (n) => `fixed ${n === 1 ? 'a category' : `${n} categories`}`,
  draft_approved: (n) => `approved ${n === 1 ? 'an email' : `${n} emails`}`,
  draft_rejected: (n) => `turned down ${n === 1 ? 'an email' : `${n} emails`}`,
  draft_requested: (n) => `asked for ${n === 1 ? 'an email' : `${n} emails`}`,
  finding_dismissed: (n) => `marked ${n === 1 ? 'one thing' : `${n} things`} as expected`,
  subscription_decision: (n) => `decided on ${n === 1 ? 'a subscription' : `${n} subscriptions`}`,
  subscription_cancelled: (n) => `told us you cancelled ${n === 1 ? 'a subscription' : `${n} subscriptions`}`,
  pdf_unlocked: (n) => `unlocked ${n === 1 ? 'a statement' : `${n} statements`}`,
};
function sinceTpl(M) {
  const c = M.compare;
  if (!c || c.first_audit || !c.previous_run) return '';
  const notSub = (x) => x.kind !== 'subscription';
  const newFiles = c.new_statement_files || [], goneFiles = c.files_no_longer_included || [];
  const newF = (c.new_findings || []).filter(notSub), goneF = (c.resolved_or_gone || []).filter(notSub);
  const newS = c.new_subscriptions || [], goneS = c.subscriptions_no_longer_seen || [];
  const spend = c.spend_change_by_category || [];
  const sp = c.subscriptions_per_month || {};
  const subDelta = (sp.now || 0) - (sp.before || 0);
  const added = (c.transactions && c.transactions.added) || 0;
  const sent = c.emails_sent_since || [], claimed = c.amount_claimed_via_sent_disputes || 0;
  const fromMemory = c.transactions_categorised_from_memory || 0;
  const counts = {};
  (c.your_actions_since || []).forEach((a) => { if (ACT_WORDS[a.event]) counts[a.event] = (counts[a.event] || 0) + 1; });
  const acts = Object.entries(counts).map(([ev, n]) => ACT_WORDS[ev](n));

  /* what the person did, as plain sentences */
  const did = [];
  if (acts.length) did.push(`You ${andList(acts)}.`);
  if (sent.length) did.push(`You sent ${plural(sent.length, 'email')}${claimed > 0 ? `, asking for ${fmt.inr(claimed)} back` : ''}.`);
  if (fromMemory > 0) did.push(`${cap1(word(fromMemory))} ${fromMemory === 1 ? 'payment was' : 'payments were'} sorted using ${(M.s.corrections || []).length === 1 ? 'your earlier fix' : 'your earlier fixes'}.`);

  /* the headline counts */
  const bits = [];
  if (newFiles.length) bits.push(`${word(newFiles.length)} new ${newFiles.length === 1 ? 'statement' : 'statements'}`);
  else if (added > 0) bits.push(`${fmt.n(added)} more ${added === 1 ? 'payment' : 'payments'}`);
  if (newF.length) bits.push(`${word(newF.length)} new ${newF.length === 1 ? 'problem' : 'problems'}`);
  if (goneF.length) bits.push(`${word(goneF.length)} ${goneF.length === 1 ? 'problem' : 'problems'} gone`);
  if (newS.length) bits.push(`${word(newS.length)} new ${newS.length === 1 ? 'subscription' : 'subscriptions'}`);
  if (goneS.length) bits.push(`${word(goneS.length)} ${goneS.length === 1 ? 'subscription' : 'subscriptions'} no longer seen`);
  if (Math.abs(subDelta) >= 1) bits.push(`subscriptions ${subDelta > 0 ? 'up' : 'down'} ${fmt.inr(Math.abs(subDelta))} a month`);

  const at = c.previous_at ? ` on ${fmt.date(c.previous_at.slice(0, 10))}` : '';
  const hasLists = newFiles.length || goneFiles.length || newF.length || goneF.length || newS.length || goneS.length || spend.length;
  if (!hasLists && !bits.length && !did.length) return '';
  const label = html`<span class="rp-since-ic">${I.history}</span>`;
  if (!hasLists) {
    return html`<section class="page page-wide rp-since-sec"><p class="rp-since-line reveal">${label}<span><b>Since your last audit${at}.</b> ${cap1(bits.join(', '))}${bits.length ? '. ' : ''}${did.join(' ')}</span></p></section>`;
  }

  const coverage = c.new_coverage || [];
  const fileName = (f) => {
    if (newFiles.length !== 1 || coverage.length !== 1) return f.file;
    const [src, ym] = coverage[0].split(' ');
    return ym ? `${cap1(src)} statement for ${fmt.month(ym, true)}` : f.file;
  };
  const dot = (kind) => C[(KIND[kind] || {}).group] || C.keep;
  const li = (color, text, extra) => html`<li><i style="background:${raw(color)}"></i><span title="${text}">${text}</span>${extra ? html`<b>${extra}</b>` : ''}</li>`;
  const col = (name_, items, foot) => (items.length ? html`<div class="rp-since-col"><p class="overline">${name_}</p><ul>${items}</ul>${foot ? html`<p class="tiny">${foot}</p>` : ''}</div>` : '');
  const signed = (n) => `${n > 0 ? '+' : '−'}${fmt.inr(Math.abs(n))}`;
  const cols = [
    col('New', [
      ...newFiles.map((f) => li('var(--ink)', fileName(f), plural(f.transactions, 'payment'))),
      ...newF.map((f) => li(dot(f.kind), f.title)),
      ...newS.map((f) => li(C.keep, `${f.title}, a new subscription`, `${fmt.inr(f.amount)}/mo`)),
    ]),
    col('Gone', [
      ...goneF.map((f) => li(dot(f.kind), f.title)),
      ...goneS.map((f) => li(C.keep, `${f.title}, no charge seen this time`, `${fmt.inr(f.amount)}/mo`)),
      ...goneFiles.map((f) => li('var(--ink)', `${f}, not in this audit`)),
    ]),
    col('How your spending changed', spend.map((x) => li(x.change > 0 ? C.up : C.save, x.category, signed(x.change))), added ? 'You added statements, so some totals grew for that reason.' : ''),
    did.length ? html`<div class="rp-since-col"><p class="overline">What you did</p>${did.map((d) => html`<p class="small">${d}</p>`)}</div>` : '',
  ].filter(Boolean);
  return html`<section class="page page-wide rp-since-sec">
    <details class="rp-since reveal" data-since open>
      <summary class="rp-since-line">${label}<span><b>Since your last audit${at}.</b> ${bits.length ? `${cap1(bits.join(', '))}.` : 'Here is what changed.'}</span><span class="rp-since-chev" aria-hidden="true">${I.chev}</span></summary>
      <div class="card rp-since-body" style="--cols:${cols.length}">${cols}</div>
    </details>
  </section>`;
}

const VIEWS = [
  { key: 'all', label: 'Everything' },
  { key: 'subs', label: 'Subscriptions' },
  { key: 'problems', label: 'Problems' },
  { key: 'plan', label: 'Your plan' },
];
function panelRow(r, M) {
  const st = rowState(r, M);
  return html`<button class="rp-item" data-item="${r.key}" aria-pressed="false" data-name="${`${r.name} ${r.line} ${r.merchant || ''}`.toLowerCase()}">
    <i class="rp-item-dot" style="background:${raw(C[r.group])}"></i>
    <span class="rp-item-main"><b>${r.name}</b><small>${r.line}</small></span>
    <span class="rp-item-right"><span class="rp-item-amt">${r.amount}</span>${st.short ? html`<small class="rp-item-state${st.tone ? ` is-${st.tone}` : ''}">${st.short}</small>` : ''}</span>
  </button>`;
}
function mapTpl(M, ui) {
  const { S } = M;
  const nProblems = M.rows.filter((a) => a.group !== 'keep' && a.group !== 'subs').length;
  const sub = { all: `${M.debits.length} payments`, subs: `${S.subs.length} every month`, problems: `${nProblems} to act on`, plan: 'What it cuts' };
  const groups = ['back', 'stop', 'up', 'keep', 'subs'].map((g) => ({ g, rows: M.rows.filter((a) => a.group === g) })).filter((x) => x.rows.length);
  const otherMonthly = M.rows.filter((r) => r.group === 'subs').reduce((a, r) => a + ((M.subBy.get(r.merchant) || {}).latest_amount || 0), 0);
  const total = { back: M.moneyBack ? fmt.inr(M.moneyBack) : '', stop: `${fmt.inr(M.liveStopMonthly)} a month`, up: M.hikesYearly ? `+${fmt.inr(M.hikesYearly)} a year` : '', keep: '', subs: `${fmt.inr(otherMonthly)} a month` };
  const label = { back: 'Get money back', stop: 'Stop paying', up: 'Price went up', keep: 'Checked and fine', subs: 'Your other subscriptions' };
  return html`<section class="page page-wide rp-sec rp-map-sec" id="rp-map">
    <div class="rp-sec-head reveal">
      <div>
        <p class="eyebrow">Where your money went</p>
        <h2 class="h2">Three months, one dot for every payment.</h2>
      </div>
    </div>
    <div class="rp-map-grid reveal" style="--d:80ms">
      <div class="card rp-cal-card">
        <div class="rp-cal-top">
          <div class="seg rp-seg" role="tablist" aria-label="Choose what the calendar shows">
            ${VIEWS.map((v) => html`<button role="tab" data-view="${v.key}" class="${ui.view === v.key ? 'is-active' : ''}" aria-selected="${ui.view === v.key ? 'true' : 'false'}">${v.label}<small>${sub[v.key]}</small></button>`)}
          </div>
          <a class="link-arrow rp-cal-list" href="#/transactions">See them as a list</a>
        </div>
        <div class="rp-cal-host" data-cal></div>
        <div class="rp-cal-legend" data-legend></div>
        <div class="rp-strip" data-strip tabindex="-1" aria-live="polite"></div>
      </div>
      <aside class="card rp-panel" aria-label="What to do">
        <div class="rp-panel-in">
          <div class="rp-panel-head">
            <h3 class="title">What to do</h3>
            <label class="rp-search">${I.search}<input type="search" data-search placeholder="Find a shop" aria-label="Find a shop" autocomplete="off" spellcheck="false" value="${ui.raw}"/></label>
          </div>
          <div class="rp-panel-list" data-list>
            ${groups.map(({ g, rows }) => html`<div class="rp-grp" data-group="${g}">
              ${g === 'subs'
                ? html`<button class="rp-grp-head rp-grp-toggle" data-more aria-expanded="${ui.more ? 'true' : 'false'}"><span class="overline">${label[g]}</span><span class="rp-grp-total">${total[g]}<span class="rp-grp-chev" aria-hidden="true">${I.chev}</span></span></button>`
                : html`<div class="rp-grp-head"><span class="overline">${label[g]}</span><span class="rp-grp-total">${total[g]}</span></div>`}
              ${rows.map((r) => panelRow(r, M))}
            </div>`)}
            <p class="rp-panel-empty small" data-empty hidden></p>
          </div>
        </div>
      </aside>
    </div>
  </section>`;
}

/* ---------- Coming up ---------- */
function nextWords(r, M) {
  const dec = M.decisions.get(r.merchant);
  const flag = r.flag && !(r.flag === 'price_hike' && !M.hikeLive.has(r.merchant))
    && !(r.flag === 'trial_conversion' && !M.trials.some((t) => t.merchant === r.merchant))
    && !(r.flag === 'zombie_charge' && !M.zombies.some((z) => z.merchant === r.merchant)) ? r.flag : null;
  if (dec === 'keep') return { text: 'You chose to keep this', color: C.keep };
  if (dec === 'cancel') return { text: 'You asked to cancel. It may still charge you', color: C.stop };
  if (flag === 'zombie_charge') return { text: 'You cancelled this, but it may still charge you', color: C.back };
  if (M.cancelledOn.has(r.merchant)) return { text: 'You cancelled this. If it charges you, ask for it back', color: C.keep };
  if (flag === 'trial_conversion') return { text: 'A free trial that turned paid', color: C.stop };
  if (flag === 'price_hike') return { text: `Price went up from ${fmt.inr(M.hikeLive.get(r.merchant).old)}`, color: C.up };
  if (r.estimate) return { text: 'A guess. The date or amount may change', color: C.keep };
  return { text: `From your ${r.source === 'card' ? 'card' : 'bank account'}`, color: M.stopSet.has(r.merchant) ? C.stop : C.keep };
}
function nextTpl(M) {
  const R = M.renewals, list = (R && R.renewals) || [];
  if (!list.length) return '';
  const guesses = list.filter((r) => r.estimate).length;
  const total = R.total != null ? R.total : list.reduce((a, r) => a + r.amount, 0);
  const toStop = list.filter((r) => M.stopSet.has(r.merchant));
  const perCol = Math.ceil(list.length / 2);
  const nudge = !toStop.length ? ''
    : toStop.length === 1 ? `You plan to stop ${toStop[0].display}. Act before ${fmt.date(toStop[0].date)} to skip the next charge.`
      : `You plan to stop ${andList(toStop.map((r) => r.display))}. Act before ${andList(toStop.map((r) => fmt.date(r.date)))} to skip the next charges.`;
  return html`<section class="page page-wide rp-sec" id="rp-next">
    <div class="rp-sec-head reveal">
      <div><p class="eyebrow">Coming up</p><h2 class="h2">What will charge you next</h2></div>
      <p class="body rp-sec-aside">Counted from your last statement, ${fmt.date(R.as_of)}.</p>
    </div>
    <div class="card rp-next reveal">
      <div class="rp-next-sum">
        <p class="overline">Next ${HORIZON} days</p>
        <div class="rp-next-num">${guesses ? html`<small>About</small> ` : ''}${fmt.inr(total)}</div>
        <p class="small">${cap1(plural(list.length, 'charge'))} expected${guesses ? `. ${cap1(word(guesses))} ${guesses === 1 ? 'is a guess' : 'are guesses'}` : ''}.</p>
        ${nudge ? html`<p class="rp-next-nudge">${nudge}</p>` : ''}
      </div>
      <ol class="rp-next-list" style="--rows:${perCol}">
        ${list.map((r, i) => {
          const w = nextWords(r, M), row = M.rowOfMerchant(r.merchant);
          const tipText = tipCard({ title: `${r.display} · ${fmt.date(r.date)}`, value: `${r.estimate ? 'About ' : ''}${money(r.amount)}`, note: `${r.in_days} ${r.in_days === 1 ? 'day' : 'days'} after your last statement.${row ? ' Click to see what you can do.' : ''}`, key: w.color });
          const inner = html`<span class="rp-next-date">${fmt.date(r.date)}</span>
            <i class="rp-item-dot" style="background:${raw(w.color)}"></i>
            <span class="rp-item-main"><b>${r.display}</b><small>${w.text}</small></span>
            <span class="rp-next-amt">${r.estimate ? html`<small>About</small> ` : ''}${money(r.amount)}</span>`;
          const end = i === perCol - 1 || i === list.length - 1;
          return html`<li class="${end ? 'is-colend' : ''}">${row ? html`<button class="rp-next-row" data-next="${row.key}" data-tip="${tipText}">${inner}</button>` : html`<div class="rp-next-row" data-tip="${tipText}">${inner}</div>`}</li>`;
        })}
      </ol>
    </div>
  </section>`;
}

function chartCard(key_, titleText, sentence, legend, extra = '', foot = '') {
  return html`<article class="card rp-cc reveal" data-card="${key_}">
    <header class="rp-cc-head">
      <div><h3 class="title">${titleText}</h3><p class="small">${sentence}</p></div>
      ${extra}
    </header>
    ${legend ? html`<div class="legend rp-cc-legend">${legend}</div>` : ''}
    <div class="rp-cc-body" data-chart="${key_}"></div>
    ${foot ? html`<p class="tiny rp-cc-foot">${foot}</p>` : ''}
  </article>`;
}
const key = (c, label, kind = 'box') => html`<span class="key">${kind === 'tick' ? html`<i class="line"></i>` : kind === 'two' ? html`<i class="rp-key-two" style="--a:${raw(c[0])};--b:${raw(c[1])}"></i>` : html`<i style="background:${raw(c)}"></i>`}${label}</span>`;

function chartsTpl(M) {
  const { S, b } = M;
  if (!b) return '';
  const sorted = [...M.lines].sort((p, q) => q.avg_spend - p.avg_spend);
  const rent = sorted[1] && sorted[0].avg_spend > 2.2 * sorted[1].avg_spend ? sorted[0] : null;
  const afterStop = S.subsMonthly - M.stopKeys.reduce((a, m) => a + ((M.subBy.get(m) || {}).latest_amount || 0), 0);
  const stopNames = andList(M.stopKeys.map((m) => M.name(m)));
  const gap = Math.max(0, b.savings_target - b.current_savings);
  const reached = b.projected_savings >= b.savings_target;
  const adds = Math.max(0, b.projected_savings - b.current_savings);
  const changed = M.planChanged.map((m) => M.name(m));
  return html`<section class="page page-wide rp-sec" id="rp-plan">
    <div class="rp-sec-head reveal">
      <div><p class="eyebrow">Your budget</p><h2 class="h2">The plan in four charts</h2></div>
    </div>
    ${changed.length ? html`<p class="rp-plan-note">${I.history}<span>You changed your mind on ${andList(changed)}. These charts show the plan from your last audit. Your next audit will use your choice.</span><a class="link-arrow" href="#/start">Start an audit</a></p>` : ''}
    <div class="rp-charts">
      ${chartCard('cats', 'Where your money goes each month', 'Each bar is what you spend in a month, on average. The tick is your new budget.',
        [key([C.trim, C.stop], 'Cut by the plan', 'two'), key(C.bar, 'Stays the same'), key(null, 'New budget', 'tick')], '',
        rent ? `${rent.category} (${fmt.inr(rent.avg_spend)}) is drawn shorter so the rest fit.` : '')}
      ${chartCard('subs', 'What you pay every month', `Each bar is one subscription. Together they cost ${fmt.inr(S.subsMonthly)} a month.`,
        [M.stopKeys.length ? key(C.stop, 'Stop paying') : '', M.hikes.length ? key([C.upOld, C.up], 'Price went up (pale = old price)', 'two') : '', key(C.bar, 'Keep')],
        html`<div class="rp-cc-fig"><b>${fmt.inr(S.subsMonthly)}</b><span>a month</span></div>`,
        M.stopKeys.length ? `Stopping ${stopNames} brings this down to ${fmt.inr(afterStop)} a month.` : '')}
      ${monthRows(M).length ? chartCard('months', 'Your income, month by month', `Where each month’s ${fmt.inr(b.monthly_income)} went, and what the plan changes.`,
        [key(C.bar, 'Needs'), key(C.trim, 'Wants'), key(C.save, 'Saved')]) : ''}
      ${chartCard('save', 'Where the savings come from',
        gap <= 0 ? 'You already save more than your goal.'
          : reached ? `To save ${fmt.inr(b.savings_target)} a month you need ${fmt.inr(gap)} more. This is where it comes from.`
            : `Your goal is ${fmt.inr(b.savings_target)} a month. The plan finds ${fmt.inr(adds)} more and takes you to ${fmt.inr(b.projected_savings)}.`, '', '')}
    </div>
  </section>`;
}

function eyesTpl(M) {
  const { s, S } = M;
  const cards = [];
  (s.questions || []).forEach((q) => {
    const keys = q.merchant_keys || [];
    const ts = M.debits.filter((t) => keys.includes(t.merchant));
    if (!ts.length) {
      /* A general note from the agent. The cards below already cover a hidden instruction or a set-aside row. */
      if ((S.suspicious.length || M.setAside.length) && /instruction|injection|quarantin|set aside|unreadable|garbled/i.test(q.question)) return;
      cards.push(html`<article class="card rp-eye">
        <div class="rp-eye-icon">${I.question}</div>
        <p class="overline">A question for you</p>
        <h3 class="rp-eye-title">The agent has a question</h3>
        <p class="small">${plain(q.question)}</p>
        <a class="btn btn-secondary btn-sm" href="#/transactions">Look in Transactions <span aria-hidden="true">→</span></a>
      </article>`);
      return;
    }
    const who = ts[0].merchant_display;
    const head = (q.question.split('?')[0] || q.question).replace(/\s*\([^)]*\)/g, '').trim() + '?';
    const totalPaid = ts.reduce((a, t) => a + t.amount, 0);
    const days = [...new Set(ts.map((t) => Number(t.date.slice(8, 10))))];
    const corrected = ts.find((t) => t.cat_source === 'memory');
    cards.push(html`<article class="card rp-eye">
      <div class="rp-eye-icon">${I.question}</div>
      <p class="overline">A question for you</p>
      <h3 class="rp-eye-title">${head}</h3>
      <p class="small">You paid ${who} ${fmt.inr(ts[0].amount)} ${days.length === 1 ? `on the ${ordinal(days[0])} of every month` : `${ts.length} times`}: ${fmt.inr(totalPaid)} in all. Tell us who this is, so it is sorted right.</p>
      ${corrected ? html`<p class="tiny rp-eye-note">${I.check}You said: ${corrected.category}. You can change it any time.</p>` : ''}
      <a class="btn btn-secondary btn-sm" href="#/transactions">Answer in Transactions <span aria-hidden="true">→</span></a>
    </article>`);
  });
  S.suspicious.forEach((t) => {
    const raw0 = String(t.description || '');
    const segs0 = raw0.split('/');
    const cut = (segs0.length > 4 ? segs0.slice(4).join('/') : raw0).trim();
    const short = cut.length > 66 ? `${cut.slice(0, 66).replace(/\s+\S*$/, '')}…` : cut;
    const wantsStatement = /e-?mail/i.test(raw0) && /statement/i.test(raw0);
    cards.push(html`<article class="card rp-eye">
      <div class="rp-eye-icon">${I.shield}</div>
      <p class="overline">Ignored on purpose</p>
      <h3 class="rp-eye-title">A ${money(t.amount)} payment hid an instruction</h3>
      <p class="small">On ${fmt.date(t.date)}, a ${money(t.amount)} ${t.merchant_display} payment carried text ${wantsStatement ? 'telling an AI to email your full statement to a stranger' : 'that tried to give orders to an AI'}. The agent read it as plain text and did nothing.</p>
      <div class="rp-eye-quote"><span class="badge badge-ink">Ignored</span><code>${short}</code></div>
      <p class="tiny">${/collect/i.test(raw0) ? 'Never approve a collect request you do not recognise.' : 'Check this payment in your bank app.'}</p>
    </article>`);
  });
  if (M.setAside.length) {
    const n = M.setAside.length, q = M.setAside[0];
    const r = String(q.raw || '');
    const line = (r.match(/line (\d+)/) || [])[1];
    const desc = ((r.match(/'Description': '([^']*)'/) || [])[1] || '').split('/').filter((x) => /[a-z]{3}/i.test(x) && !/^UPI$|^DR$|@/i.test(x))[0] || '';
    const date = (r.match(/'Txn Date': '([^']*)'/) || [])[1] || '';
    const amt = (r.match(/'(?:Debit|Credit|Amount)': '([^']+)'/) || [])[1] || '';
    const parts = amt.split(/([A-Za-z])/);
    const isBank = /bank/i.test(q.file || '');
    cards.push(html`<article class="card rp-eye">
      <div class="rp-eye-icon">${I.row}</div>
      <p class="overline">Set aside</p>
      <h3 class="rp-eye-title">${n === 1 ? `One ${isBank ? 'bank ' : ''}row could not be read` : `${cap1(word(n))} rows could not be read`}</h3>
      <p class="small">${n > 1 ? 'For example, l' : 'L'}ine ${line || '?'} of your ${isBank ? 'bank' : 'statement'} file ${amt ? `shows the amount as “${amt}”` : 'has an amount we could not read'}${/[A-Za-z]/.test(amt) ? ', with a letter where a number should be' : ''}. We left ${n === 1 ? 'it' : 'them'} out of every number here, so nothing is counted wrong.</p>
      ${amt ? html`<div class="rp-eye-quote"><code>${date} · ${desc ? desc.toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase()) : 'Payment'} · ${parts.map((p, i) => (i % 2 ? html`<mark>${p}</mark>` : p))}</code></div>` : ''}
      <p class="tiny">Check ${n === 1 ? 'this payment' : 'these payments'} in your bank app.</p>
    </article>`);
  }
  if (M.skipped.length) {
    const n = M.skipped.length;
    const breakable = (f) => String(f).split('_').map((x, i) => (i ? html`_<wbr>${x}` : x));
    cards.push(html`<article class="card rp-eye">
      <div class="rp-eye-icon">${I.file}</div>
      <p class="overline">Skipped ${n === 1 ? 'file' : 'files'}</p>
      <h3 class="rp-eye-title">${n === 1 ? 'One statement' : `${cap1(word(n))} statements`} would not open</h3>
      <p class="small">${n === 1 ? 'The file is' : 'These files are'} damaged or locked with a password, so we skipped ${n === 1 ? 'it' : 'them'}. Download ${n === 1 ? 'it' : 'them'} again from your bank if you want ${n === 1 ? 'it' : 'them'} in the report.</p>
      <div class="rp-eye-quote"><code>${M.skipped.slice(0, 3).map((f, i) => html`${i ? html`<br>` : ''}${breakable(f.file)}`)}${n > 3 ? html`<br>and ${fmt.n(n - 3)} more` : ''}</code></div>
      <a class="btn btn-secondary btn-sm" href="#/start">Add ${n === 1 ? 'it' : 'them'} again <span aria-hidden="true">→</span></a>
    </article>`);
  }
  if (!cards.length) return '';
  return html`<section class="page page-wide rp-sec" id="rp-eyes">
    <div class="rp-sec-head reveal">
      <div><p class="eyebrow">Before you act</p><h2 class="h2">Needs your eyes</h2></div>
    </div>
    <div class="rp-eyes reveal" data-n="${Math.min(cards.length, 4)}">${cards}</div>
  </section>`;
}

function linksTpl() {
  return html`<section class="page page-wide rp-sec rp-words-sec"><nav class="rp-links" aria-label="More">
    <a class="link-arrow" href="#/transactions">All transactions</a>
    <a class="link-arrow" href="#/log">Activity log</a>
    <a class="link-arrow" href="#/proof">How well it works</a>
  </nav></section>`;
}

/* =====================================================================
   Calendar views
   ===================================================================== */
function dotColor(view, d, M) {
  const g = d.tag, t = d.t;
  if (view === 'plan') {
    if (M.stopSet.has(t.merchant)) return C.stop;
    if (M.cutCats.has(t.category)) return C.trim;
    return C.keep;
  }
  if (g === 'back') return C.back;
  if (g === 'stop') return C.stop;
  if (g === 'up') return C.up;
  if (g === 'upOld') return view === 'all' ? C.keep : C.upOld;
  if (g === 'flag') return C.flag;
  return C.keep;
}
function dotNote(view, d, M) {
  const t = d.t;
  if (view === 'plan') {
    if (M.stopSet.has(t.merchant)) return { text: 'The plan stops this.', c: C.stop };
    if (M.cutCats.has(t.category)) return { text: `The plan spends a bit less on ${t.category.toLowerCase()}.`, c: C.trim };
    return { text: 'Stays as it is.', c: C.keep };
  }
  const n = M.note.get(t.id);
  if (n) return { text: n, c: dotColor(view === 'all' ? 'problems' : view, d, M) };
  if (t.category === 'Transfers' && t.merchant === 'card_payment') return { text: 'Paying off your card bill. The card payments themselves are their own dots.', c: C.keep };
  if (t.category === 'Investments') return { text: 'Money into your savings plan (SIP).', c: C.keep };
  if (M.subBy.has(t.merchant)) return { text: 'Monthly subscription. Fine for now.', c: C.keep };
  return null;
}
function itemsFor(view, M) {
  const show = (d) => {
    if (view === 'subs') return M.subBy.has(d.t.merchant) || M.hikeBy.has(d.t.merchant);
    if (view === 'problems') return d.tag !== 'none';
    return true;
  };
  return M.dots.filter(show).map((d) => {
    const t = d.t, n = dotNote(view, d, M);
    return {
      id: String(t.id), key: t.merchant, date: t.date, amount: t.amount, name: t.merchant_display, color: dotColor(view, d, M), pick: M.rowByTx.has(String(t.id)),
      tip: tipCard({ title: `${t.merchant_display} · ${fmt.date(t.date)}`, value: money(t.amount), unit: `${t.source === 'card' ? 'Card' : 'Bank'} · ${t.category}`, note: n && n.text, key: n && n.c }),
    };
  });
}
function legendFor(view, M) {
  const k = (c, label) => html`<span class="key"><i class="rp-key-dot" style="background:${raw(c)}"></i>${label}</span>`;
  const keys = view === 'plan'
    ? [k(C.stop, 'Stop paying'), k(C.trim, 'Spend a bit less'), k(C.keep, 'Stays the same')]
    : [
      M.moneyBack ? k(C.back, 'Get money back') : '', M.stopKeys.length ? k(C.stop, 'Stop paying') : '', M.hikes.length ? k(C.up, 'Price went up') : '',
      view !== 'all' && M.hikes.length ? k(C.upOld, 'Old price') : '', M.S.suspicious.length && view !== 'subs' ? k(C.flag, 'Needs a look') : '', k(C.keep, view === 'all' ? 'Everything else' : 'Fine'),
    ];
  const big = M.debits.reduce((m, t) => (t.amount >= RING_FROM && (!m || t.amount > m.amount) ? t : m), null);
  const sizes = html`<span class="rp-sizes" aria-hidden="true"><i style="--s:7px"></i><i style="--s:12px"></i><i style="--s:19px"></i>${big ? html`<i class="is-ring" style="--s:22px"></i>` : ''}</span>`;
  return html`<div class="legend">${keys}</div>
    <p class="tiny rp-legend-note">${sizes}<span>Each dot is one payment. Bigger dots are bigger amounts.${big ? ` Rings are ${fmt.inr(RING_FROM)} or more, like ${big.merchant_display}.` : ''}</span></p>`;
}

/* ---------- The detail block under the calendar: same skeleton in every state, so nothing jumps ---------- */
function barTpl(st, ui) {
  const btn = (b) => (b.href
    ? html`<a class="btn btn-sm ${b.style}" href="${b.href}">${b.icon || ''}${b.label}</a>`
    : html`<button class="btn btn-sm ${b.style}" data-do="${b.do}" ${ui.busy ? 'disabled' : ''}>${ui.busy === b.do ? html`<span class="spinner"></span>${b.busy || b.label}` : html`${b.icon || ''}${b.label}`}</button>`);
  return html`<div class="rp-strip-bar">
    ${ui.error
      ? html`<p class="rp-status is-bad" role="alert">${I.alert}<span>${ui.error}</span></p>`
      : html`<p class="rp-status${st.tone ? ` is-${st.tone}` : ''}">${st.tone === 'good' ? I.check : ''}<span>${st.text}</span></p>`}
    <div class="rp-strip-btns">${st.more.map(btn)}${st.primary ? btn(st.primary) : ''}</div>
  </div>`;
}
function stripDefault(view, M, items, cls) {
  const { S } = M;
  const amts = items.map((x) => x.amount).sort((p, q) => p - q);
  const median = amts.length ? amts[Math.floor(amts.length / 2)] : 0;
  const under = items.filter((x) => x.amount < 1000).length;
  const underPct = Math.round((under / Math.max(1, items.length)) * 100);
  const biggest = [...new Set([...M.debits].sort((p, q) => q.amount - p.amount).map((t) => t.merchant_display))].slice(0, 2);
  const trims = Math.max(0, M.lines.filter((l) => l.change < 0).reduce((a, l) => a - l.change, 0) - M.planStopMonthly);
  const big = M.debits.reduce((m, t) => (!m || t.amount > m.amount ? t : m), null);
  const bigN = big ? M.debits.filter((t) => t.merchant === big.merchant).length : 0;
  const nBack = M.dups.length + M.zombies.length;
  const stopNames = andList(M.stopKeys.map((m) => M.name(m)));
  const nCut = M.lines.filter((l) => l.change < 0).length;
  const v = {
    all: {
      name: 'Every payment', lead: !items.length ? 'No payments to show.' : `${underPct >= 50 ? `Most payments are small: ${underPct}% were` : `${underPct}% of your payments were`} under ₹1,000. The biggest are ${andList(biggest)}.`,
      figs: [['A typical payment', fmt.inr(median), 'Half of your payments are smaller than this.'], ['The biggest payment', big ? money(big.amount) : '', big ? `${big.merchant_display}${bigN > 1 ? ', every month' : `, on ${fmt.date(big.date)}`}.` : '']],
    },
    subs: {
      name: 'Monthly charges', lead: S.subs.length ? `Your ${plural(S.subs.length, 'subscription')} ${S.subs.length === 1 ? 'charges' : 'charge'} you on about the same day every month.` : 'No monthly subscriptions were found.',
      figs: [['Every month', fmt.inr(S.subsMonthly), S.subs.length ? `${cap1(plural(S.subs.length, 'subscription'))} together.` : 'Nothing to pay.'], ['Every year', fmt.inr(S.subsYearly), 'The same charges, over 12 months.']],
    },
    problems: {
      name: 'Flagged payments', lead: 'Blue dots are money you can ask back. Orange ones are subscriptions to stop. Red ones cost more than before. Grey ones were checked and are fine.',
      figs: [['To get back', fmt.inr(M.moneyBack), nBack ? `From ${plural(nBack, 'payment')}.` : 'Nothing right now.'], ['Payments flagged', fmt.n(items.length), `Out of ${fmt.n(M.debits.length)} in all.`]],
    },
    plan: {
      name: 'What the plan changes', lead: 'Orange dots are what the plan stops. Pale orange is where it asks you to spend a bit less. Grey stays as it is.',
      figs: [['Stopped', fmt.inr(M.liveStopMonthly), stopNames ? `${stopNames}, every month.` : 'Nothing to stop.'], ['Trimmed', fmt.inr(trims), `A bit less, across ${plural(nCut, 'kind')} of spending.`]],
    },
  }[view];
  const { total, pending, sent, firstPending } = M.mail;
  const mailText = !total ? 'No emails written yet.' : `Emails: ${[sent ? `${fmt.n(sent)} sent` : '', pending ? `${fmt.n(pending)} waiting for you` : ''].filter(Boolean).join(', ') || `${fmt.n(total)} written`}.`;
  return html`<div class="rp-strip-in ${cls}">
    <div class="rp-strip-top"><b class="rp-strip-name">${v.name}</b><span class="rp-strip-line rp-strip-hint">Pick a row in What to do, or a coloured dot, to see it here.</span></div>
    <div class="rp-strip-cols">
      <div><p class="overline">What you see</p><p class="small">${v.lead}</p></div>
      ${v.figs.map(([o, n, t]) => html`<div><p class="overline">${o}</p><div class="rp-strip-num">${n}</div><p class="tiny">${t}</p></div>`)}
    </div>
    <div class="rp-strip-bar">
      <p class="rp-status"><span>${mailText}</span></p>
      <div class="rp-strip-btns">${firstPending != null ? html`<a class="btn btn-sm btn-secondary" href="#/emails?id=${firstPending}">${I.mail}${pending === 1 ? 'Read the waiting email' : 'Read the waiting emails'}</a>` : total ? html`<a class="btn btn-sm btn-ghost" href="#/emails">See your emails</a>` : ''}</div>
    </div>
  </div>`;
}
function formTpl(r, M, ui) {
  const lastDate = M.tx.reduce((a, t) => (t.date > a ? t.date : a), '');
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const max = lastDate > today ? lastDate : today;
  const holdMeta = r.holdId != null ? M.meta(r.holdId) : null;
  const email = M.cancelEmail(r.merchant);
  const waits = (r.fid != null && M.meta(r.fid).status === 'draft_pending') || (holdMeta && holdMeta.status === 'draft_pending') || (r.type !== 'finding' && email && email.status === 'PENDING_APPROVAL' && holdMeta && email.finding_id === r.holdId);
  const waitText = waits ? ' The email waiting for it will not be sent.' : '';
  const F = {
    expected: { title: 'This is expected', text: `We will remember this. Future audits will not flag it again.${waitText} You can undo it here.`, cta: 'Yes, this is expected', field: 'Why is it expected? (optional)', hint: 'For example: I really did pay twice' },
    keep: { title: `Keep ${r.name}`, text: `We will stop suggesting you cancel it, and future audits will not flag it again.${waitText} You can undo it here.`, cta: 'Keep it', field: 'Why are you keeping it? (optional)', hint: 'For example: I use it every week' },
    cancelled: { title: 'I already cancelled', text: `Tell us the day you cancelled. If ${r.name} charges you after that, your next audit will flag it so you can ask for the money back.`, cta: 'Save the date', field: 'The day you cancelled' },
  }[ui.form];
  const busy = !!ui.busy;
  return html`<form class="rp-form" data-form="${ui.form}" novalidate>
    <div class="rp-form-copy"><p class="overline">${F.title}</p><p class="small">${F.text}</p></div>
    <div class="rp-form-fields">
      <label class="rp-field"><span>${F.field}</span>
        ${ui.form === 'cancelled'
          ? html`<input class="rp-input" type="date" name="value" value="${ui.value}" max="${max}" ${busy ? 'disabled' : ''} required />`
          : html`<input class="rp-input" type="text" name="value" value="${ui.value}" maxlength="120" placeholder="${F.hint}" autocomplete="off" ${busy ? 'disabled' : ''} />`}
      </label>
      ${ui.error ? html`<p class="rp-status is-bad" role="alert">${I.alert}<span>${ui.error}</span></p>` : ''}
      <div class="rp-form-btns">
        <button class="btn btn-sm btn-ghost" type="button" data-do="form-cancel" ${busy ? 'disabled' : ''}>Not now</button>
        <button class="btn btn-sm btn-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? html`<span class="spinner"></span>Saving…` : F.cta}</button>
      </div>
    </div>
  </form>`;
}
function stripFor(r, M, ui, cls) {
  const st = rowState(r, M);
  const badge = r.group === 'keep' ? 'Checked and fine' : r.group === 'subs' ? 'Subscription' : GROUP[r.group].label;
  return html`<div class="rp-strip-in ${cls}">
    <div class="rp-strip-top">
      <span class="badge ${BADGE[r.group]}"><span class="dot"></span>${badge}</span>
      <b class="rp-strip-name">${r.name}</b><span class="rp-strip-line">${r.line}</span>
      <span class="rp-strip-acts"><button class="btn btn-ghost btn-icon btn-sm rp-strip-x" data-act="clear" aria-label="Close these details">${I.close}</button></span>
    </div>
    ${ui.form ? formTpl(r, M, ui) : html`<div class="rp-strip-cols">
        <div><p class="overline">What happened</p><p class="small">${r.happened}</p></div>
        <div><p class="overline">How we know</p><p class="small">${r.how}</p></div>
        <div><p class="overline">What to do</p><p class="small">${st.todo}</p></div>
      </div>
      ${barTpl(st, ui)}`}
  </div>`;
}
function stripSearch(q, ts, cls) {
  const total = ts.reduce((a, t) => a + t.amount, 0);
  const names = [...new Set(ts.map((t) => t.merchant_display))];
  const last = ts.reduce((m, t) => (!m || t.date > m.date ? t : m), null);
  const nMonths = new Set(ts.map((t) => t.date.slice(0, 7))).size;
  const bar = html`<div class="rp-strip-bar"><p class="rp-status"><span>${ts.length ? 'They are lit up on the calendar.' : 'Nothing to light up.'}</span></p><div class="rp-strip-btns"><button class="btn btn-sm btn-secondary" data-act="clear">Clear search</button></div></div>`;
  if (!ts.length) return html`<div class="rp-strip-in ${cls}"><div class="rp-strip-top"><b class="rp-strip-name">No payments match “${q}”</b></div><p class="small rp-strip-none">Try part of a shop name, like “swig”, or a kind of spending, like “food”.</p>${bar}</div>`;
  return html`<div class="rp-strip-in ${cls}">
    <div class="rp-strip-top"><b class="rp-strip-name">${names.length === 1 ? names[0] : `“${q}”`}</b></div>
    <div class="rp-strip-cols">
      <div><p class="overline">Payments</p><div class="rp-strip-num">${fmt.n(ts.length)}</div><p class="tiny">${names.length > 1 ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and more' : ''}.` : `All to ${names[0]}.`}</p></div>
      <div><p class="overline">In all</p><div class="rp-strip-num">${money(total)}</div><p class="tiny">Over ${plural(nMonths, 'month')}.</p></div>
      <div><p class="overline">Last paid</p><div class="rp-strip-num">${fmt.date(last.date)}</div><p class="tiny">${money(last.amount)} to ${last.merchant_display}.</p></div>
    </div>
    ${bar}
  </div>`;
}

/* =====================================================================
   Four charts
   ===================================================================== */
function drawCharts(root, M, cleanups) {
  const { S, b } = M;
  if (!b) return;
  /* a) categories. The average can hide one big month, so the tooltip also shows each month. */
  const lines = [...M.lines].sort((p, q) => q.avg_spend - p.avg_spend);
  const second = lines[1] ? lines[1].avg_spend : lines[0] ? lines[0].avg_spend : 1;
  const broken = lines[0] && lines[0].avg_spend > second * 2.2;
  const maxA = broken ? Math.ceil((second * 1.12) / 500) * 500 : undefined;
  const planNames = andList(M.planStop.map((m) => M.name(m)));
  const ins = M.insights;
  const monthRows = (cat) => {
    const c = ins && (ins.categories || []).find((x) => x.category === cat);
    return c && ins.months ? ins.months.map((ym, i) => [fmt.month(ym), fmt.inr(c.by_month[i] || 0)]) : [];
  };
  const elA = $('[data-chart="cats"]', root);
  if (elA) {
    cleanups.push(hbars(elA, lines.map((l) => {
      const cut = l.change < 0;
      return {
        key: l.category, label: l.category, tick: l.budget,
        parts: cut ? [{ value: l.budget, color: C.trim }, { value: -l.change, color: C.stop }] : [{ value: l.avg_spend, color: C.bar }],
        valueText: cut ? html`${fmt.inr(l.avg_spend)} <small>→ ${fmt.inr(l.budget)}</small>` : fmt.inr(l.avg_spend),
        aria: `${l.category}: ${fmt.inr(l.avg_spend)} a month now${cut ? `, budget ${fmt.inr(l.budget)}` : ', stays the same'}`,
        tip: tipCard({ title: l.category, value: fmt.inr(l.avg_spend), unit: 'a month on average', rows: [['New budget', fmt.inr(l.budget)], ['Change', l.change ? `−${fmt.inr(-l.change)}` : 'None'], ...monthRows(l.category)], note: cut ? (l.category === 'Entertainment & Subscriptions' && M.planStopMonthly ? `Includes stopping ${planNames} (${fmt.inr(M.planStopMonthly)}).` : 'The plan trims this a little.') : (l.type === 'need' ? 'A need. The plan keeps it.' : 'The plan keeps it.'), key: cut ? C.stop : C.bar }),
      };
    }), { max: maxA, labelWidth: 196, valueWidth: 124, barHeight: 12, rowHeight: 32 }).destroy);
  }
  /* b) subscriptions */
  const elB = $('[data-chart="subs"]', root);
  if (elB) {
    const subs = [...S.subs].sort((p, q) => q.latest_amount - p.latest_amount);
    cleanups.push(hbars(elB, subs.map((x) => {
      const h = M.hikeBy.get(x.merchant), live = M.hikeLive.has(x.merchant), stop = M.stopSet.has(x.merchant);
      const tr = S.trials.find((t) => t.merchant === x.merchant);
      const kept = M.decisions.get(x.merchant) === 'keep';
      const g = stop ? 'stop' : live ? 'up' : 'keep';
      return {
        key: x.merchant, label: x.display,
        parts: live && !stop ? [{ value: h.old, color: C.upOld }, { value: h.new - h.old, color: C.up }] : [{ value: x.latest_amount, color: stop ? C.stop : C.bar }],
        valueText: h ? html`<small>${fmt.inr(h.old)} →</small> ${fmt.inr(h.new)}` : fmt.inr(x.latest_amount),
        tip: tipCard({ title: `${x.display} · on the ${ordinal(x.day_of_month)}`, value: fmt.inr(x.latest_amount), unit: 'a month', rows: [['A year', fmt.inr(x.annual_cost)], ...(h ? [['Before', fmt.inr(h.old)], ['Went up', fmt.signedPct(h.pct)]] : [])], note: stop ? (tr ? `Free trial at ${fmt.inr(tr.trial_amount)}, now paid. You plan to stop it.` : 'You plan to stop it.') : kept ? 'You chose to keep this.' : live ? `Costs ${fmt.inr(h.extra_per_year)} more a year than before.` : 'Fine for now.', key: g === 'keep' ? C.bar : C[g] }),
      };
    }), { labelWidth: 140, valueWidth: 116, barHeight: 12, rowHeight: 41 }).destroy);
  }
  /* c) month by month, d) savings */
  const elC = $('[data-chart="months"]', root);
  if (elC) drawMonths(elC, M, cleanups);
  const elD = $('[data-chart="save"]', root);
  if (elD) drawSavings(elD, M, cleanups);
}

/** Each month's income split into needs, wants and saved, then the same split with the plan. */
function monthRows(M) {
  const { b, insights: ins } = M;
  const flow = (ins && ins.cash_flow) || [];
  if (!b || !flow.length || !b.monthly_income) return [];
  const isNeed = (l) => l.type === 'need';
  const needCats = new Set(M.lines.filter(isNeed).map((l) => l.category));
  const rows = flow.map((c, i) => {
    const needs = (ins.categories || []).filter((x) => needCats.has(x.category)).reduce((a, x) => a + (x.by_month[i] || 0), 0);
    return { label: fmt.month(c.month), needs, wants: Math.max(0, c.spend - needs), saved: Math.max(0, c.saved), rate: c.savings_rate };
  });
  rows.push({
    label: 'With the plan', plan: true, rate: b.projected_savings_pct, saved: b.projected_savings,
    needs: M.lines.filter(isNeed).reduce((a, l) => a + l.budget, 0),
    wants: M.lines.filter((l) => !isNeed(l)).reduce((a, l) => a + l.budget, 0),
  });
  return rows;
}

function drawMonths(el, M, cleanups) {
  const { b } = M;
  const rows = monthRows(M);
  mount(el, html`<div class="rp-save">
    <div class="rp-big">
      <span class="rp-big-num" data-count="${b.projected_savings_pct}" data-fmt="pct">${pct1(b.projected_savings_pct)}</span>
      <p>of your income saved each month with this plan <span>(${pct1(b.current_savings_pct)} now)</span></p>
    </div>
    <div class="rp-mm">
      ${rows.map((r, i) => html`<div class="rp-mm-row ${r.plan ? 'is-plan' : ''}">
        <span class="rp-mm-l">${r.label}</span>
        <div class="rp-mm-bar" data-mm="${i}"></div>
        <span class="rp-mm-v"><b>${pct1(r.rate)}</b><small>saved</small></span>
      </div>`)}
    </div>
  </div>`);
  rows.forEach((r, i) => {
    const tipFor = (word_, v, c, note) => tipCard({ title: `${r.label} · ${word_}`, value: fmt.inr(v), key: c, note });
    cleanups.push(segbar($(`[data-mm="${i}"]`, el), [
      { key: 'needs', value: r.needs, color: C.bar, label: fmt.inr(r.needs), labelColor: 'var(--rp-on-soft)', tip: tipFor('Needs', r.needs, C.bar, 'Rent, bills, groceries and other things you must pay.') },
      { key: 'wants', value: r.wants, color: C.trim, label: fmt.inr(r.wants), labelColor: 'var(--rp-on-soft)', tip: tipFor('Wants', r.wants, C.trim, 'Food out, shopping, fun and other things you choose.') },
      { key: 'saved', value: r.saved, color: C.save, label: fmt.inr(r.saved), labelColor: 'var(--rp-on-save)', tip: tipFor('Saved', r.saved, C.save, `${pct1(r.rate)} of your income.`) },
    ], { size: 'tall', aria: `${r.label}: needs ${fmt.inr(r.needs)}, wants ${fmt.inr(r.wants)}, saved ${fmt.inr(r.saved)}.` }).destroy);
  });
}

function drawSavings(el, M, cleanups) {
  const { b } = M;
  const gap = Math.max(0, b.savings_target - b.current_savings);
  const planLabel = M.planStop.map((m) => M.name(m)).join(' + ');
  const parts = [];
  if (M.planStopMonthly > 0) parts.push({ key: 'stop', label: `Stop ${planLabel}`, value: M.planStopMonthly, color: C.stop, labelColor: '#fff' });
  M.lines.filter((l) => l.change < 0).forEach((l) => {
    let v = -l.change;
    // Stopped subscriptions are already in the "Stop" part. New audits record how much left each line; older ones took it all from this one.
    v -= l.stopped != null ? l.stopped : (l.category === 'Entertainment & Subscriptions' ? M.planStopMonthly : 0);
    if (v >= 1) parts.push({ key: l.category, label: `Less on ${l.category.toLowerCase()}`, value: v, color: C.trim, labelColor: 'var(--rp-on-soft)' });
  });
  const trims = parts.filter((p) => p.key !== 'stop').sort((p, q) => q.value - p.value);
  const ordered = [...parts.filter((p) => p.key === 'stop'), ...trims];
  const adds = Math.max(0, b.projected_savings - b.current_savings);
  /* Each line is rounded on its own. Any rupee left over goes to the biggest trim, so the parts add up to the total. */
  ordered.forEach((p) => { p.value = Math.round(p.value); });
  const left = Math.round(adds) - ordered.reduce((a, p) => a + p.value, 0);
  if (trims.length && left && Math.abs(left) <= 5) trims[0].value += left;
  const sumP = ordered.reduce((a, p) => a + p.value, 0) || 1;
  const scaleTop = Math.max(1, b.savings_target, b.projected_savings);
  const nowShare = Math.max(0, Math.min(1, b.current_savings / scaleTop));
  const planShare = Math.max(nowShare, Math.min(1, b.projected_savings / scaleTop));
  const reached = b.projected_savings >= b.savings_target;
  mount(el, html`<div class="rp-save">
    ${monthRows(M).length ? '' : html`<div class="rp-big">
      <span class="rp-big-num" data-count="${b.projected_savings_pct}" data-fmt="pct">${pct1(b.projected_savings_pct)}</span>
      <p>of your income saved each month with this plan <span>(${pct1(b.current_savings_pct)} now)</span></p>
    </div>`}
    ${gap > 0 ? html`
    <div class="rp-save-over">
      <div class="rp-save-scale"><span><b>${fmt.inr(b.current_savings)}</b> saved now</span><span>${reached ? html`<b>${fmt.inr(b.savings_target)}</b> goal` : html`<b>${fmt.inr(b.projected_savings)}</b> with the plan`}</span></div>
      <div data-over></div>
      <svg class="rp-save-zoom" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${(nowShare * 100).toFixed(2)},0 ${(planShare * 100).toFixed(2)},0 100,40 0,40" />
        <line x1="${(nowShare * 100).toFixed(2)}" y1="0" x2="0" y2="40" /><line x1="${(planShare * 100).toFixed(2)}" y1="0" x2="100" y2="40" />
      </svg>
      <div data-tall></div>
    </div>
    <ul class="rp-save-list">
      ${ordered.map((p) => html`<li><i style="background:${raw(p.color)}"></i><span>${p.label}</span><b>${fmt.inr(p.value)}</b></li>`)}
      <li class="is-total"><i></i><span>Extra saved each month</span><b>${fmt.inr(sumP)}</b></li>
    </ul>` : html`<p class="small">You save ${fmt.inr(b.current_savings)} a month, above your goal of ${fmt.inr(b.savings_target)}.</p>`}
  </div>`);
  if (gap <= 0) return;
  cleanups.push(segbar($('[data-over]', el), [
    { key: 'now', value: b.current_savings, color: C.save, tip: tipCard({ title: 'Saved now', value: fmt.inr(b.current_savings), unit: 'a month', note: `${pct1(b.current_savings_pct)} of your income, including your ${fmt.inr(b.sip_investments)} SIP.`, key: C.save }) },
    { key: 'plan', value: adds, color: C.stop, tip: tipCard({ title: 'What the plan adds', value: fmt.inr(adds), unit: 'a month', note: 'The parts below add up to this.', key: C.stop }) },
    { key: 'rest', value: Math.max(0, b.savings_target - b.projected_savings), color: C.track, tip: tipCard({ title: 'Still short of your goal', value: fmt.inr(Math.max(0, b.savings_target - b.projected_savings)), unit: 'a month', note: `Your goal is ${fmt.inr(b.savings_target)} a month.` }) },
  ], { size: 'thin', aria: `Saved now ${fmt.inr(b.current_savings)}. With the plan ${fmt.inr(b.projected_savings)}. Goal ${fmt.inr(b.savings_target)}.` }).destroy);
  cleanups.push(segbar($('[data-tall]', el), ordered.map((p) => ({
    ...p, label: fmt.inr(p.value),
    tip: tipCard({ title: p.label, value: fmt.inr(p.value), unit: 'a month', note: `${pct0((p.value / sumP) * 100)} of the extra savings.`, key: p.color }),
  })), { size: 'tall', aria: 'Where the extra savings come from' }).destroy);
}

function drawStatBars(root, M, cleanups) {
  const { S, b } = M;
  const backParts = [...M.dups.map((d) => ({ name: `${d.display}, charged twice`, v: d.amount, id: d.id })), ...M.zombies.map((z) => ({ name: `${z.display}, after you cancelled`, v: z.amount, id: z.id }))];
  const put = (sel, parts, aria) => { const n = $(sel, root); if (n && parts.length) cleanups.push(segbar(n, parts, { size: 'thin', aria }).destroy); };
  put('[data-bar="back"]', backParts.map((p, i) => ({ key: `b${i}`, value: p.v, color: C.back, tip: tipCard({ title: p.name, value: fmt.inr(p.v), key: C.back, note: M.meta(p.id).status === 'email_sent' ? 'You have asked for it back.' : 'Ask for it back.' }) })), 'Money to get back');
  put('[data-bar="subs"]', [...S.subs].sort((p, q) => q.latest_amount - p.latest_amount).map((x) => {
    const g = M.stopSet.has(x.merchant) ? 'stop' : M.hikeLive.has(x.merchant) ? 'up' : 'keep';
    const c = g === 'keep' ? C.bar : C[g];
    return { key: x.merchant, value: x.latest_amount, color: c, tip: tipCard({ title: x.display, value: fmt.inr(x.latest_amount), unit: 'a month', note: g === 'stop' ? 'You plan to stop it.' : g === 'up' ? 'Price went up.' : 'Fine for now.', key: c }) };
  }), 'Subscriptions by size');
  put('[data-bar="up"]', M.hikes.map((h) => ({ key: h.merchant, value: h.extra_per_year, color: C.up, tip: tipCard({ title: h.kind === 'bank_fee_hike' ? 'Bank fee' : h.display, value: `+${fmt.inr(h.extra_per_year)}`, unit: 'a year', rows: [['Was', fmt.inr(h.old)], ['Now', fmt.inr(h.new)]], key: C.up, note: `${fmt.signedPct(h.pct)}` }) })), 'Price rises');
  if (b) {
    const now = b.current_savings_pct, plan = Math.max(now, b.projected_savings_pct);
    const byMonth = M.insights && M.insights.cash_flow ? M.insights.cash_flow.map((c) => [fmt.month(c.month), pct1(c.savings_rate)]) : [];
    put('[data-bar="save"]', [
      { key: 'now', value: now, color: C.save, tip: tipCard({ title: 'Saved now, on average', value: pct1(now), unit: `${fmt.inr(b.current_savings)} a month`, rows: byMonth, key: C.save }) },
      { key: 'plan', value: plan - now, color: C.save2, tip: tipCard({ title: 'Extra with the plan', value: `+${pct1(Math.round((plan - now) * 10) / 10)}`, unit: `${fmt.inr(b.projected_savings - b.current_savings)} a month`, key: C.save2 }) },
      { key: 'rest', value: 100 - plan, color: C.track, tip: tipCard({ title: 'Spent', value: pct1(100 - plan), unit: 'of your income with the plan' }) },
    ], 'Share of income saved');
  }
}

/* =====================================================================
   Render
   ===================================================================== */
const optional = (path) => api.get(path).catch(() => null);
async function load() {
  const state = await store.state();
  if (!state || !state.run) return { state };
  const [findings, renewals, compare, insights, memory] = await Promise.all([
    optional('/api/findings'), optional(`/api/renewals?horizon=${HORIZON}`), optional('/api/runs/compare'), optional('/api/insights'), optional('/api/memory'),
  ]);
  return { state, findings, renewals, compare, insights, memory };
}
const friendly = (what, e) => {
  const m = String((e && e.message) || '');
  const base = { write: 'The email could not be written.', cancel: 'The cancel email could not be written.', cancelled: 'We could not save that date.', undo: 'We could not undo that.' }[what] || 'We could not save that.';
  const why = /failed to fetch|networkerror/i.test(m) ? ' We could not reach the server.' : /api.?key|auth|credential/i.test(m) ? ' The AI service is not set up here.' : '';
  return `${base}${why} Nothing was sent. You can try again.`;
};

export async function render(root) {
  const myHash = location.hash;
  let alive = true, teardown = [], M = null;
  /* What the person is doing. Survives a repaint after an action. */
  const ui = { view: 'all', selected: null, query: '', raw: '', more: false, form: null, value: '', busy: null, error: null, sinceClosed: false };

  mount(root, skeleton());
  let data;
  try { data = await load(); } catch (e) {
    if (location.hash !== myHash) return undefined;
    mount(root, errorView(e));
    return on(root, 'click', '[data-act="retry"]', () => { store.invalidate(); navigate('/report'); });
  }
  if (location.hash !== myHash) return undefined;
  if (!data.state || !data.state.run) { mount(root, emptyView()); return undefined; }

  const clearPaint = () => { teardown.forEach((f) => { try { f(); } catch (err) { console.error(err); } }); teardown = []; };

  /* Draw the whole page. still = repaint after an action: same scroll, no animation. */
  const paint = (d, still = false) => {
    clearPaint();
    const y = scrollY;
    const since0 = $('[data-since]', root), list0 = $('[data-list]', root);
    if (since0) ui.sinceClosed = !since0.open;
    const listTop = list0 ? list0.scrollTop : 0;
    if (still) root.style.minHeight = `${root.offsetHeight}px`;

    M = buildModel(d);
    if (ui.selected && !M.rowByKey.has(ui.selected)) { ui.selected = null; ui.form = null; }
    mount(root, html`<div class="rp ${still ? 'rp-still' : ''}">${heroTpl(M)}${statsTpl(M)}${sinceTpl(M)}${mapTpl(M, ui)}${nextTpl(M)}${chartsTpl(M)}${eyesTpl(M)}${linksTpl()}</div>`);
    const page = $('.rp', root);
    if (still) $$('.reveal', root).forEach((n) => n.classList.add('is-in')); else reveal(root);
    const sinceEl = $('[data-since]', root);
    if (sinceEl && ui.sinceClosed) sinceEl.open = false;
    teardown.push(bindTips(root));
    drawStatBars(root, M, teardown);

    /* ---------- money calendar ---------- */
    const host = $('[data-cal]', root), legendEl = $('[data-legend]', root), strip = $('[data-strip]', root), list = $('[data-list]', root);
    const matchQ = (t, q) => `${t.merchant_display} ${t.merchant} ${t.category}`.toLowerCase().includes(q);
    const queryIds = (q) => new Set(M.debits.filter((t) => matchQ(t, q)).map((t) => String(t.id)));
    const cal = calendar(host, {
      months: M.months, items: itemsFor(ui.view, M), aspect: 1.26, cap: RING_FROM,
      meta: (ym, its) => (ui.view === 'subs' ? `${fmt.inr(its.reduce((a, x) => a + x.amount, 0))} this month` : ui.view === 'problems' ? `${its.length} to look at` : `${its.length} payments`),
      onPick: (it) => { const k = M.rowByTx.get(it.id); if (k) select(k); },
    });
    teardown.push(cal.destroy);

    const paintStrip = (fresh = false) => {
      const cls = fresh ? 'is-new' : '';
      if (ui.selected) mount(strip, stripFor(M.rowByKey.get(ui.selected), M, ui, cls));
      else if (ui.query) mount(strip, stripSearch(ui.query, M.debits.filter((t) => matchQ(t, ui.query)), cls));
      else mount(strip, stripDefault(ui.view, M, itemsFor(ui.view, M), cls));
    };
    const markSel = () => $$('[data-item]', root).forEach((bt) => { const on1 = bt.dataset.item === ui.selected; bt.classList.toggle('is-sel', on1); bt.setAttribute('aria-pressed', String(on1)); });
    const filterList = () => {
      const q = ui.query;
      let shown = 0;
      $$('.rp-grp', root).forEach((g) => {
        const collapsed = g.dataset.group === 'subs' && !ui.more && !q;
        let n = 0;
        $$('[data-item]', g).forEach((bt) => {
          const hit = q ? bt.dataset.name.includes(q) : (!collapsed || bt.dataset.item === ui.selected);
          bt.hidden = !hit; if (hit) n++;
        });
        const hide = q ? !n : false;
        g.hidden = hide; if (q) shown += n; else shown += 1;
        const tg = $('[data-more]', g);
        if (tg) { tg.setAttribute('aria-expanded', String(!collapsed)); tg.hidden = !!q && !n; }
      });
      const empty = $('[data-empty]', root);
      if (empty) { empty.hidden = !!shown; empty.textContent = shown ? '' : q ? `Nothing to do for “${q}”. Its payments, if any, are lit up on the calendar.` : 'Nothing to do right now.'; }
    };
    const setView = (v, { keepSel = false } = {}) => {
      ui.view = v;
      $$('[data-view]', root).forEach((bt) => { const on1 = bt.dataset.view === v; bt.classList.toggle('is-active', on1); bt.setAttribute('aria-selected', String(on1)); });
      cal.update(itemsFor(v, M));
      mount(legendEl, legendFor(v, M));
      if (!keepSel) { ui.selected = null; ui.form = null; ui.error = null; markSel(); filterList(); cal.focus(ui.query ? queryIds(ui.query) : null); }
      paintStrip(true);
    };
    const showRow = (k) => {
      const bt = $(`[data-item="${k}"]`, root);
      if (!bt || !list) return;
      const a = bt.getBoundingClientRect(), l = list.getBoundingClientRect();
      if (a.top < l.top + 8) list.scrollTop -= l.top - a.top + 8;
      else if (a.bottom > l.bottom - 32) list.scrollTop += a.bottom - l.bottom + 40;
    };
    const showStrip = () => strip.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const clearSearch = () => { ui.query = ''; ui.raw = ''; const s1 = $('[data-search]', root); if (s1) s1.value = ''; };
    const select = (k) => {
      ui.selected = ui.selected === k ? null : k;
      ui.form = null; ui.error = null; ui.value = '';
      if (ui.selected) {
        const r = M.rowByKey.get(ui.selected);
        if (ui.query) clearSearch();
        if (r.ids.some((id) => !cal.has(id))) setView('all', { keepSel: true });
        cal.focus(new Set(r.ids));
      } else cal.focus(ui.query ? queryIds(ui.query) : null);
      markSel(); filterList(); paintStrip(true);
      if (ui.selected) { showRow(ui.selected); showStrip(); }
    };
    const clearAll = () => {
      ui.selected = null; ui.form = null; ui.error = null; ui.value = '';
      clearSearch(); markSel(); filterList(); cal.focus(null); paintStrip(true);
    };
    if (ui.selected) cal.focus(new Set(M.rowByKey.get(ui.selected).ids));
    else if (ui.query) cal.focus(queryIds(ui.query));
    mount(legendEl, legendFor(ui.view, M));
    markSel(); filterList(); paintStrip();
    if (list) list.scrollTop = listTop;

    /* ---------- actions: each one writes, then the page repaints from fresh data ---------- */
    const refresh = async () => {
      store.invalidate();
      let fresh;
      try { fresh = await load(); } catch { ui.busy = null; paintStrip(); return; }
      if (!alive) return;
      data = fresh;
      ui.busy = null;
      paint(fresh, true);
      const s2 = $('[data-strip]', root);
      if (s2) s2.focus({ preventScroll: true });
    };
    const act = async (name, fn, done) => {
      if (ui.busy) return;
      ui.busy = name; ui.error = null; paintStrip();
      try {
        const res = await fn();
        ui.form = null; ui.value = '';
        const msg = done && done(res);
        if (msg) toast(msg.text, { kind: msg.kind || 'good' });
      } catch (e) {
        ui.error = friendly(name, e);
      }
      if (alive) await refresh(); // even after a failure: "cancel" saves the decision before it writes the email
    };
    const emailDone = (written) => (res) => {
      if (res && res.already_sent) return { text: 'That email already went out. No new one was written.', kind: 'info' };
      if (res && res.existing) return { text: 'That email was already written. It is waiting for you.', kind: 'info' };
      return { text: `${written} It has not been sent.` };
    };
    const shop = (m) => encodeURIComponent(m);
    const doIt = {
      write: (r) => act('write', () => { const f = M.meta(r.fid); return api.post(`/api/findings/${r.fid}/draft`, f.suggested_email ? { kind: f.suggested_email } : {}); }, emailDone('Email written.')),
      cancel: (r) => act('cancel', () => api.post(`/api/subscriptions/${shop(r.merchant)}/decision`, { decision: 'cancel' }), emailDone('Cancel email written.')),
      keep: (r) => {
        if (r.holdId != null && !M.isDismissed(r.holdId) && M.meta(r.holdId).can_dismiss) { ui.form = 'keep'; ui.value = ''; ui.error = null; paintStrip(); focusForm(); return; }
        act('keep', () => api.post(`/api/subscriptions/${shop(r.merchant)}/decision`, { decision: 'keep' }), () => ({ text: `${r.name} stays. We will not suggest cancelling it again.` }));
      },
      expected: () => { ui.form = 'expected'; ui.value = ''; ui.error = null; paintStrip(); focusForm(); },
      already: () => { ui.form = 'cancelled'; ui.value = ''; ui.error = null; paintStrip(); focusForm(); },
      'form-cancel': () => { ui.form = null; ui.value = ''; ui.error = null; paintStrip(); },
      undo: (r) => act('undo', async () => { for (const [type, k] of undoTasks(r, M)) await api.post('/api/memory/forget', { type, key: k }); }, () => ({ text: 'Undone.' })),
    };
    const focusForm = () => { const i = $('[data-form] input', strip); if (i) i.focus({ preventScroll: true }); };
    teardown.push(on(root, 'click', '[data-do]', (e, bt) => { const r = M.rowByKey.get(ui.selected); const fn = doIt[bt.dataset.do]; if (r && fn) fn(r); }));
    teardown.push(on(root, 'input', '[data-form] input', (e, inp) => { ui.value = inp.value; }));
    teardown.push(on(root, 'submit', '[data-form]', (e, form) => {
      e.preventDefault();
      const r = M.rowByKey.get(ui.selected);
      if (!r) return;
      const kind = form.dataset.form, value = ui.value.trim();
      const reasonBody = value ? { reason: value } : {};
      if (kind === 'expected') {
        act('expected', () => api.post(`/api/findings/${r.fid}/dismiss`, reasonBody), () => ({ text: 'Remembered. Future audits will not flag this.' }));
      } else if (kind === 'keep') {
        act('keep', async () => {
          await api.post(`/api/subscriptions/${shop(r.merchant)}/decision`, { decision: 'keep', note: value });
          await api.post(`/api/findings/${r.holdId}/dismiss`, reasonBody);
        }, () => ({ text: `${r.name} stays. Future audits will not flag it.` }));
      } else if (kind === 'cancelled') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { ui.error = 'Pick the day you cancelled first.'; paintStrip(); focusForm(); return; }
        act('cancelled', () => api.post(`/api/subscriptions/${shop(r.merchant)}/cancelled`, { cancelled_on: value }), () => ({ text: 'Saved. Your next audit will flag any later charge.' }));
      }
    }));

    /* ---------- finding your way around ---------- */
    teardown.push(on(root, 'click', '[data-view]', (e, bt) => { if (bt.dataset.view !== ui.view) setView(bt.dataset.view); }));
    teardown.push(on(root, 'click', '[data-item]', (e, bt) => select(bt.dataset.item)));
    teardown.push(on(root, 'click', '[data-next]', (e, bt) => { const k = bt.dataset.next; if (ui.selected === k) showStrip(); else select(k); }));
    teardown.push(on(root, 'click', '[data-more]', () => { ui.more = !ui.more; filterList(); }));
    teardown.push(on(root, 'click', '[data-act="clear"]', clearAll));
    teardown.push(on(root, 'pointerover', '[data-item]', (e, bt) => { if (!ui.selected) { const a = M.rowByKey.get(bt.dataset.item); if (a) cal.hover(new Set(a.ids)); } }));
    teardown.push(on(root, 'pointerout', '[data-item]', (e, bt) => { if (!bt.contains(e.relatedTarget)) cal.hover(null); }));
    let tq = 0;
    teardown.push(on(root, 'input', '[data-search]', (e, inp) => {
      clearTimeout(tq);
      tq = setTimeout(() => {
        ui.raw = inp.value;
        ui.query = inp.value.trim().toLowerCase();
        ui.selected = null; ui.form = null; ui.error = null;
        markSel(); filterList();
        if (ui.query) {
          const ids = queryIds(ui.query);
          if ([...ids].some((id) => !cal.has(id))) setView('all', { keepSel: true });
          cal.focus(ids.size ? ids : new Set(['none']));
        } else cal.focus(null);
        paintStrip();
      }, 90);
    }));
    teardown.push(() => clearTimeout(tq));
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (ui.form) { if (!ui.busy) { ui.form = null; ui.value = ''; ui.error = null; paintStrip(); } return; }
      if (ui.selected || ui.query) clearAll();
    };
    addEventListener('keydown', onKey);
    teardown.push(() => removeEventListener('keydown', onKey));

    /* ---------- charts ---------- */
    drawCharts(root, M, teardown);

    /* numbers count up when seen (tabular digits only while they move) */
    const fmts = { inr: (n) => fmt.inr(Math.round(n)), plusinr: (n) => (n >= 0.5 ? `+${fmt.inr(Math.round(n))}` : fmt.inr(0)) };
    const formatOf = (n) => {
      if (n.dataset.fmt !== 'pct') return fmts[n.dataset.fmt] || fmts.inr;
      const dec = Math.abs((Number(n.dataset.count) || 0) % 1) > 0.001;
      return (v) => (dec ? `${v.toFixed(1)}%` : `${Math.round(v)}%`);
    };
    const counters = $$('[data-count]', root);
    const stops = new Set();
    let printing = false;
    const finalText = (n) => formatOf(n)(Number(n.dataset.count) || 0);
    counters.forEach((n) => {
      const to = Number(n.dataset.count) || 0, f = formatOf(n);
      n.setAttribute('aria-label', f(to));
      if (still) { n.textContent = f(to); return; }
      n.textContent = f(0);
      teardown.push(whenVisible(n, () => {
        if (printing) { n.textContent = finalText(n); return; }
        n.classList.add('rp-tnum');
        let stop = null, finished = false; // with reduced motion, done runs before count() returns
        stop = count(n, to, { format: f, ms: 1300, done: () => { finished = true; n.classList.remove('rp-tnum'); stops.delete(stop); } });
        if (!finished) stops.add(stop);
      }));
    });
    teardown.push(() => stops.forEach((f) => f()));

    /* ---------- page actions and print ---------- */
    teardown.push(on(root, 'click', '[data-act="print"]', () => window.print()));
    teardown.push(on(root, 'click', '[data-jump]', (e, bt) => { const t = document.getElementById(bt.dataset.jump); if (t) t.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); }));
    const allDetails = () => $$('details', root);
    let openBefore = [];
    const before = () => {
      printing = true;
      finishAll();
      stops.forEach((f) => f()); stops.clear();
      counters.forEach((n) => { n.classList.remove('rp-tnum'); n.textContent = finalText(n); });
      $$('.reveal', root).forEach((n) => n.classList.add('is-in'));
      openBefore = allDetails().map((n) => n.open);
      allDetails().forEach((n) => { n.open = true; });
    };
    const after = () => { printing = false; allDetails().forEach((n, i) => { n.open = !!openBefore[i]; }); };
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    teardown.push(() => { removeEventListener('beforeprint', before); removeEventListener('afterprint', after); });

    /* a quiet repaint: put everything back without motion, then let motion work again */
    if (still) {
      finishAll();
      root.style.minHeight = '';
      scrollTo({ top: y, behavior: 'instant' });
      requestAnimationFrame(() => requestAnimationFrame(() => { if (page) page.classList.remove('rp-still'); }));
    }
  };

  paint(data);
  return () => { alive = false; clearPaint(); };
}
