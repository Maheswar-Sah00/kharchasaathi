/* Activity log: everything that happened, in order, in plain English.
   The agent has no tool to edit or delete this log. */
import { html, raw, mount, api, store, fmt, plain, DRAFT_KIND, on, $, $$ } from '../core.js';
import { fileBrand, periodLabel, fileProblem, rowProblem, monthsFromName } from './start.js';

export const title = 'Activity log';

const P = {
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  chev: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
};
const ic = (n, cls = '') => raw(`<svg class="rv-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`);

const ACTORS = {
  user: { label: 'You', color: 'var(--ink)' },
  agent: { label: 'Agent', color: 'var(--c-blue)' },
  tool: { label: 'The app', color: 'var(--ink-3)' },
  guard: { label: 'Safety guard', color: 'var(--c-red)' },
};
const ACTOR_ORDER = ['user', 'agent', 'tool', 'guard'];

const ui = { actor: 'all', q: '', order: 'old', open: {} };

const parse = (d) => { if (d == null || d === '') return null; try { return JSON.parse(d); } catch { return d; } };
let NAMES = new Map(); // merchant key -> shop name, from the current audit
const pretty = (key) => NAMES.get(key) || String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const clip = (s, n = 140) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/* The same words as the live run page. */
const EVENT = {
  goal: 'You set the goal',
  draft_created: 'Agent wrote an email draft',
  ask_user: 'Agent saved a question for you',
  needs_password: 'Agent asked you for a file password',
  parse_failed: 'A file could not be read',
  category_correction: 'You fixed a category',
  draft_approved: 'You approved an email',
  draft_rejected: 'You chose not to send an email',
  send_blocked: 'Safety guard blocked a send',
  refused_request: 'Safety guard refused a request',
  email_sent: 'Email sent to your demo inbox',
  send_failed: 'The email service failed',
  llm_error: 'The AI service had an error',
  finding_dismissed: 'You marked something as expected',
  subscription_decision: 'You decided about a subscription',
  memory_forgotten: 'You asked it to forget something',
  csv_format_learned: 'Agent learned a new statement layout',
  chat_question: 'You asked a question',
  chat_refused: 'Safety guard refused a chat request',
  draft_requested: 'You asked for an email draft',
  subscription_cancelled: 'You marked a subscription as cancelled',
  pdf_unlocked: 'You unlocked a statement',
  pdf_unlock_failed: 'A statement password did not work',
  reminder_settings: 'You changed your reminder settings',
  reminder_call_started: 'A reminder call started',
  reminder_call_done: 'A reminder call finished',
  reminder_call_failed: 'A reminder call failed',
  after_audit_no_call: 'No reminder call was needed',
  after_audit_call_error: 'A reminder call could not start',
  scheduled_call_error: 'A reminder call could not start',
};
/* Events that only repeat what a tool call already says. */
const SAME_AS_CALL = { draft_created: 'draft_email', ask_user: 'ask_user', needs_password: 'ask_user', parse_failed: 'parse_statement' };
const STEP = {
  categorize_transactions: 'Sorting the transactions',
  lookup_merchant: 'Looking up a shop',
  build_budget: 'Building your budget',
  draft_email: 'Writing an email',
  remember_cancellation: 'Noting a cancellation',
  upcoming_renewals: 'Checking what renews soon',
  learn_csv_format: 'Learning a new file layout',
  compare_with_last_audit: 'Comparing with your last audit',
};

const fileName = (file, months) => {
  const p = periodLabel(months && months.length ? months : monthsFromName(file));
  return `${fileBrand(file)}${p ? `, ${p}` : ''}`;
};
const emailKind = (k) => String(DRAFT_KIND[k] || 'email').toLowerCase();
const fixRupee = (s) => String(s ?? '').replace(/\?(?=\d)/g, '₹'); // an old run's goal was saved through a console that could not write ₹

/** One tool call and its answer, as one sentence. */
function toolSentence(tool, input, output, ctx) {
  const i = input && typeof input === 'object' ? input : {};
  const o = output && typeof output === 'object' ? output : {};
  if (o.error && tool !== 'parse_statement') return { name: `${STEP[tool] || 'A step'} did not work`, summary: clip(plain(o.error), 130), bad: true };
  switch (tool) {
    case 'update_plan': {
      const steps = i.steps || [];
      return { name: ctx.plans++ ? 'Agent changed its plan' : 'Agent made a plan', summary: steps.length ? `${plural(steps.length, 'step')}. First: ${clip(plain(steps[0]), 90)}` : '' };
    }
    case 'list_statement_files': return { name: `Agent found ${plural((o.files || []).length, 'statement file')}` };
    case 'parse_statement': {
      if (o.error) return { name: `Could not open ${fileName(i.filename)}`, summary: `${fileProblem(o.error, o.error_type)} It was skipped.`, bad: true };
      const q = o.quarantined_rows || [];
      return { name: `Agent read ${fileName(o.file || i.filename, o.months)}: ${plural(o.transactions ?? 0, 'transaction')}`, summary: q.length ? `${plural(q.length, 'row')} set aside. ${rowProblem((q[0] || {}).reason)}` : '' };
    }
    case 'remember_cancellation': return { name: `Agent noted that ${i.merchant_name || 'a subscription'} was cancelled${i.cancelled_on ? ` on ${fmt.date(i.cancelled_on)}` : ''}` };
    case 'categorize_transactions': {
      const b = o.by_source || {};
      const parts = [b.rules && `${b.rules} known shops`, b.llm && `${b.llm} AI guesses`, b.memory && `${b.memory} from your fixes`, b.safety && `${b.safety} safety check`].filter(Boolean);
      return { name: `Agent sorted ${o.total ?? ''} transactions`, summary: parts.join(', ') };
    }
    case 'lookup_merchant': return { name: `Agent looked up ${i.query || pretty(i.merchant) || 'a shop'} on the web` };
    case 'set_merchant_category': return { name: `Agent sorted ${pretty(i.merchant)} as ${i.category}` };
    case 'ask_user': return { name: i.kind === 'password' ? 'Agent asked you for a file password' : 'Agent saved a question for you', summary: clip(plain(i.question), 130) };
    case 'detect_subscriptions': return { name: `Agent found ${plural((o.subscriptions || []).length, 'monthly subscription')}` };
    case 'detect_duplicates': {
      const c = (o.confirmed_duplicates || []).length, r = (o.rejected_candidates || []).length;
      return { name: `Agent found ${plural(c, 'double charge')}`, summary: r ? `${r} more looked double but were fine` : '' };
    }
    case 'detect_price_changes': {
      const parts = [
        (o.price_hikes || []).length && plural(o.price_hikes.length, 'price rise'),
        (o.trial_conversions || []).length && plural(o.trial_conversions.length, 'trial turned paid', 'trials turned paid'),
        (o.charges_after_cancellation || []).length && plural(o.charges_after_cancellation.length, 'charge after cancelling', 'charges after cancelling'),
      ].filter(Boolean);
      return { name: parts.length ? `Agent found ${parts.join(', ')}` : 'Agent found no price rises' };
    }
    case 'build_budget': return { name: 'Agent built your budget', summary: o.current_savings_pct != null ? `You save ${o.current_savings_pct}% now. The plan saves ${o.projected_savings_pct ?? o.savings_target_pct}%` : '' };
    case 'draft_email':
      if (o.not_drafted) return { name: `Agent did not write the ${emailKind(i.kind)} again`, summary: `It was already sent${o.sent_at ? ` on ${fmt.date(o.sent_at)}` : ''}` };
      return { name: `Agent wrote a ${emailKind(i.kind)} draft`, summary: o.subject ? `“${clip(o.subject, 110)}”` : '' };
    case 'finish': return { name: 'Agent finished and wrote your summary' };
    case 'upcoming_renewals': return { name: 'Agent checked what renews soon' };
    case 'learn_csv_format': return { name: 'Agent learned a new bank file layout' };
    case 'compare_with_last_audit': return { name: 'Agent compared with your last audit' };
    default: return { name: `Agent used ${String(tool).replace(/_/g, ' ')}` };
  }
}

/** Turn one raw log row (that is not a tool call or answer) into {name, summary}. */
function describe(ev, ctx) {
  const d = parse(ev.detail);
  const o = d && typeof d === 'object' ? d : {};
  const [type, tool] = ev.event.includes(':') ? ev.event.split(':') : [ev.event, null];
  if (type === 'chat_tool') {
    const CHAT = { query_transactions: 'Looked through your transactions', spend_summary: 'Added up your spending', get_findings: 'Checked the problems it found', get_renewals: 'Checked what renews soon', get_budget: 'Read your budget', get_memory: 'Checked what it remembers', compare_with_last_audit: 'Compared with your last audit', request_email_draft: 'Wrote an email draft' };
    return { name: `Ask AI: ${(CHAT[tool] || `used ${tool}`).replace(/_/g, ' ').replace(/^\w/, (c) => c.toLowerCase())}`, summary: '' };
  }
  const subject = (id) => { const x = ctx.drafts.get(id); return x ? `“${clip(x.subject, 110)}”` : 'An email draft'; };
  const name = EVENT[type] || pretty(type);
  let sum = '';
  switch (type) {
    case 'goal': sum = typeof d === 'string' ? `“${clip(fixRupee(d), 140)}”` : ''; break;
    case 'category_correction': sum = `${pretty(o.merchant)} is now ${o.category}`; break;
    case 'draft_approved': case 'draft_rejected': case 'email_sent': sum = subject(o.draft_id); break;
    case 'draft_requested': sum = o.kind ? `A ${emailKind(o.kind)}` : ''; break;
    case 'send_blocked': sum = `${subject(o.draft_id)}: ${o.reason === 'not approved' ? 'you had not approved it' : 'it was not going to your demo inbox'}`; break;
    case 'refused_request': sum = clip(fixRupee(o.goal || o.reason), 130); break;
    case 'send_failed': sum = `${subject(o.draft_id)}. Nothing was sent`; break;
    case 'chat_question': sum = o.text ? `“${clip(o.text, 130)}”` : ''; break;
    case 'chat_refused': sum = clip(o.reason, 130); break;
    case 'pdf_unlocked': case 'pdf_unlock_failed': sum = o.file ? fileName(o.file) : ''; break;
    case 'memory_forgotten': sum = pretty(String(o.key || '').split(':').pop()); break;
    case 'finding_dismissed': sum = [pretty(String(o.key || '').split(':').pop()), o.reason ? `“${clip(o.reason, 90)}”` : ''].filter(Boolean).join(': '); break;
    case 'subscription_decision': sum = `${pretty(o.merchant)}: ${o.decision === 'keep' ? 'keep it' : 'stop paying'}`; break;
    case 'subscription_cancelled': sum = `${pretty(o.merchant)}${o.cancelled_on ? `, on ${fmt.date(o.cancelled_on)}` : ''}`; break;
    case 'csv_format_learned': sum = o.file ? fileName(o.file) : ''; break;
    case 'parse_failed': sum = fileName(o.file || ''); break;
    case 'llm_error': sum = 'It may be busy, or the internet connection dropped'; break;
    default: sum = '';
  }
  return { name, summary: sum };
}

/** Oldest first. A tool call and its answer become one row, and events that only repeat them disappear. */
function buildRows(rawAsc, ctx) {
  const rows = [];
  const waiting = new Map(); // tool -> its rows still waiting for an answer
  rawAsc.forEach((ev, i) => {
    const [type, tool] = ev.event.includes(':') ? ev.event.split(':') : [ev.event, null];
    if (type === 'tool_call') {
      const row = { ...ev, tool, input: parse(ev.detail), output: undefined, key: `${ev.ts}|${ev.event}|${i}` };
      rows.push(row);
      if (!waiting.has(tool)) waiting.set(tool, []);
      waiting.get(tool).push(row);
      return;
    }
    if (type === 'result') {
      const list = waiting.get(tool);
      const row = list && list.shift();
      if (row) { row.output = parse(ev.detail); return; }
      rows.push({ ...ev, tool, input: undefined, output: parse(ev.detail), key: `${ev.ts}|${ev.event}|${i}` });
      return;
    }
    if (SAME_AS_CALL[type] && (waiting.get(SAME_AS_CALL[type]) || []).length) return;
    rows.push({ ...ev, key: `${ev.ts}|${ev.event}|${i}` });
  });
  return rows.map((r) => {
    const s = r.tool && !r.event.startsWith('chat_tool') ? toolSentence(r.tool, r.input, r.output, ctx) : describe(r, ctx);
    return { ...r, ...s, actor: r.tool && !r.event.startsWith('chat_tool') ? 'agent' : r.actor, hay: `${s.name} ${s.summary || ''} ${r.event} ${r.detail || ''}`.toLowerCase() };
  });
}

function detailText(ev) {
  const shown = ev.tool && !ev.event.startsWith('chat_tool') ? { asked: ev.input ?? null, answer: ev.output ?? null } : parse(ev.detail);
  if (shown == null) return 'No details.';
  return typeof shown === 'string' ? shown : JSON.stringify(shown, null, 2);
}

/* ---------- templates ---------- */
function skeleton() {
  return html`<div class="page">
    <div class="rv-sk-head"><div class="skel rv-sk-line" style="width:180px"></div><div class="skel rv-sk-title" style="width:76%"></div><div class="skel rv-sk-line" style="width:84%"></div></div>
    <div class="skel" style="height:40px;border-radius:99px;width:64%;margin:24px 0 32px"></div>
    ${Array.from({ length: 7 }, () => html`<div style="display:grid;grid-template-columns:148px 1fr;gap:28px;padding:10px 0"><div></div><div class="skel" style="height:52px;border-radius:12px"></div></div>`)}
  </div>`;
}

function emptyView() {
  return html`<div class="page"><header class="rv-head">
    <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Activity log</span></p>
    <h1 class="h1">Nothing has happened yet.</h1>
    <p class="lead">Every step of your next audit will be written here.</p>
    <div class="rv-empty-actions"><a class="btn btn-primary" href="#/start">Start an audit <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="#/how">How it works</a></div>
  </header>
  <div class="rv-ghost" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<div class="row-g"><i></i><i></i><i></i></div>`)}</div>
  </div>`;
}

function errorView(e) {
  return html`<div class="page"><header class="rv-head">
    <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Activity log</span></p>
    <h1 class="h1">We could not load the log.</h1>
    <p class="lead">The KharchaSaathi server did not answer. Check that it is running, then try again.</p>
    <p class="small mono" style="margin-top:14px">${e && e.message}</p>
    <div class="rv-empty-actions"><button class="btn btn-primary" data-act="reload">Try again</button></div>
  </header></div>`;
}

const PROBLEM_KINDS = ['duplicate', 'zombie_charge', 'trial_conversion', 'price_hike', 'bank_fee_hike'];
const RUNS_SHOWN = 6;

/** /api/runs has no problem count, so count them from each audit's findings. */
async function loadRuns() {
  const r = await api.get('/api/runs');
  const all = (r && r.runs) || [];
  const shown = all.slice(0, RUNS_SHOWN);
  const counts = await Promise.all(shown.map((x) => api.get(`/api/findings?run_id=${x.id}`)
    .then((f) => (f.findings || []).filter((k) => PROBLEM_KINDS.includes(k.kind) && k.status !== 'dismissed').length)
    .catch(() => null)));
  return { total: all.length, list: shown.map((x, i) => ({ ...x, problems: counts[i] })) };
}

/* A run that dies stays "running" in the database forever, so an old one counts as not finished. */
function runState(r) {
  if (r.status === 'done') return '';
  const fresh = r.status === 'running' && Date.now() - Date.parse(r.started_at) < 15 * 60 * 1000;
  return fresh ? 'Still running' : 'Did not finish';
}

function runsCard(runs, shownId) {
  if (!runs || !runs.list.length) return '';
  return html`<section class="card rv-runs" aria-labelledby="rv-runs-t">
    <h2 class="title" id="rv-runs-t">Past audits</h2>
    <div class="rv-runs-wrap">
      <div class="rv-runs-row is-head" aria-hidden="true"><span>When</span><span>What you asked for</span><span class="n">Transactions</span><span class="n">Problems</span><span class="n">To get back</span><span class="n">Emails</span></div>
      ${runs.list.map((r) => html`<div class="rv-runs-row">
        <span class="rv-runs-when">${fmt.date(r.started_at)}, ${fmt.time(r.started_at)}</span>
        <span class="rv-runs-goal" title="${fixRupee(r.goal)}">${r.id === shownId ? html`<span class="rv-runs-latest">Shown below</span>` : ''}${runState(r) ? html`<span class="rv-runs-state">${runState(r)}</span>` : ''}${fixRupee(r.goal) || 'No goal given'}</span>
        <span class="n">${fmt.n(r.transactions)}<small>transactions</small></span>
        <span class="n">${r.problems == null ? '–' : fmt.n(r.problems)}<small>problems</small></span>
        <span class="n">${fmt.inr(r.recoverable)}<small>to get back</small></span>
        <span class="n">${fmt.n(r.drafts)}<small>emails</small></span>
      </div>`)}
    </div>
    ${runs.total > runs.list.length ? html`<p class="rv-runs-more">Showing the latest ${runs.list.length} of ${runs.total}.</p>` : ''}
  </section>`;
}

function eventRow(e) {
  const a = ACTORS[e.actor] || { label: pretty(e.actor), color: 'var(--ink-3)' };
  const open = !!ui.open[e.key];
  return html`<li class="rv-ev ${e.actor === 'guard' ? 'is-guard' : ''} ${e.bad ? 'is-bad' : ''} ${open ? 'is-open' : ''}" style="--c:${raw(a.color)}">
    <span class="rv-ev-dot" aria-hidden="true"></span>
    <button class="rv-ev-btn" data-ev="${e.key}" aria-expanded="${open}">
      <span class="rv-ev-name">${e.name}</span>
      <span class="rv-ev-meta"><span class="rv-ev-actor"><i></i>${a.label}</span><span class="rv-ev-time">${fmt.time(e.ts)}${e.ts.length > 16 ? e.ts.slice(16, 19) : ''}</span>${ic('chev', 'rv-ev-chev')}</span>
      ${e.summary ? html`<span class="rv-ev-sum">${e.summary}</span>` : ''}
    </button>
    ${open ? html`<div class="rv-ev-detail"><pre>${detailText(e)}</pre><div class="rv-ev-raw">${e.event} · ${e.ts.replace('T', ' ')}</div></div>` : ''}
  </li>`;
}

function timeline(events) {
  if (!events.length) return html`<div class="rv-tl-empty">Nothing matches. <button data-act="clear">Show everything</button></div>`;
  const groups = [];
  for (const e of events) {
    const k = e.ts.slice(0, 16);
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, list: [] });
    groups[groups.length - 1].list.push(e);
  }
  return html`${groups.map((g) => html`<section class="rv-tl-group" aria-label="${fmt.time(g.k + ':00')}">
    <div class="rv-tl-when"><b>${fmt.time(g.k + ':00')}</b><small>${fmt.date(g.k, true)} · ${plural(g.list.length, 'event')}</small></div>
    <ol class="rv-tl-list">${g.list.map(eventRow)}</ol>
  </section>`)}`;
}

/* ---------- view ---------- */
export async function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'rv rv-log';
  root.appendChild(wrap);
  mount(wrap, skeleton());
  let alive = true, ALL = [];

  const filtered = () => {
    const q = ui.q.trim().toLowerCase();
    let list = ALL.filter((e) => (ui.actor === 'all' || e.actor === ui.actor) && (!q || e.hay.includes(q)));
    if (ui.order === 'new') list = list.slice().reverse();
    return list;
  };
  const renderList = () => {
    const host = $('[data-tl]', wrap);
    if (host) mount(host, timeline(filtered()));
  };

  const paint = async () => {
    let s;
    let runs = null;
    try {
      // past audits are extra: if they fail, the timeline still shows
      [s, runs] = await Promise.all([store.state(), loadRuns().catch(() => null)]);
    } catch (e) { if (alive) mount(wrap, errorView(e)); return; }
    if (!alive) return;
    const raw0 = (s.audit || []).slice().reverse(); // server sends newest first
    if (!s.run && !raw0.length) { mount(wrap, emptyView()); return; }
    NAMES = new Map((s.transactions || []).map((t) => [t.merchant, t.merchant_display]));
    ALL = buildRows(raw0, { plans: 0, drafts: new Map((s.drafts || []).map((x) => [x.id, x])) });
    const counts = Object.fromEntries(ACTOR_ORDER.map((k) => [k, ALL.filter((e) => e.actor === k).length]));
    const blocked = ALL.filter((e) => e.actor === 'guard').length;
    const first = ALL[0], last = ALL[ALL.length - 1];
    mount(wrap, html`<div class="page">
      <header class="rv-head">
        <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Activity log</span></p>
        <h1 class="h1">Everything that happened, in order.</h1>
        <p class="lead">Every step the agent took and every choice you made. The agent cannot delete this log.</p>
        <div class="rv-log-sum">
          <span><b>${ALL.length}</b> events</span>
          ${first && last ? html`<span>From <b>${fmt.time(first.ts)}</b> to <b>${fmt.time(last.ts)}</b> on ${fmt.date(last.ts, true)}</span>` : ''}
          <span><b>${blocked}</b> ${blocked === 1 ? 'action' : 'actions'} stopped by the safety guard</span>
        </div>
      </header>
      ${runsCard(runs, s.run && s.run.id)}
      <div class="rv-log-ctl">
        <button class="chip ${ui.actor === 'all' ? 'is-active' : ''}" data-actor="all">Everyone <span class="rv-n">${ALL.length}</span></button>
        ${ACTOR_ORDER.filter((k) => counts[k]).map((k) => html`<button class="chip ${ui.actor === k ? 'is-active' : ''}" data-actor="${k}" style="--c:${raw(ACTORS[k].color)}"><span class="dot"></span>${ACTORS[k].label} <span class="rv-n">${counts[k]}</span></button>`)}
        <label class="rv-search">${ic('search')}<span class="sr-only">Search the log</span><input type="search" data-q placeholder="Search the log" value="${ui.q}" autocomplete="off" /></label>
        <div class="seg" role="tablist" aria-label="Order">
          <button class="${ui.order === 'old' ? 'is-active' : ''}" data-order="old">Oldest first</button>
          <button class="${ui.order === 'new' ? 'is-active' : ''}" data-order="new">Newest first</button>
        </div>
      </div>
      <div class="rv-tl" data-tl></div>
    </div>`);
    renderList();
  };

  const offs = [
    on(wrap, 'click', '[data-actor]', (e, t) => {
      ui.actor = t.dataset.actor;
      $$('[data-actor]', wrap).forEach((b) => b.classList.toggle('is-active', b === t));
      renderList();
    }),
    on(wrap, 'click', '[data-order]', (e, t) => {
      ui.order = t.dataset.order;
      $$('[data-order]', wrap).forEach((b) => b.classList.toggle('is-active', b === t));
      renderList();
    }),
    on(wrap, 'input', '[data-q]', (e, t) => { ui.q = t.value; renderList(); }),
    on(wrap, 'click', '[data-ev]', (e, t) => { const k = t.dataset.ev; ui.open[k] = !ui.open[k]; renderList(); const b = wrap.querySelector(`[data-ev="${CSS.escape(k)}"]`); b && b.focus({ preventScroll: true }); }),
    on(wrap, 'click', '[data-act]', (e, t) => {
      if (t.dataset.act === 'reload') store.invalidate();
      if (t.dataset.act === 'clear') {
        ui.actor = 'all'; ui.q = '';
        const q = $('[data-q]', wrap); if (q) q.value = '';
        $$('[data-actor]', wrap).forEach((b) => b.classList.toggle('is-active', b.dataset.actor === 'all'));
        renderList();
      }
    }),
    store.subscribe(() => { if (alive) paint(); }),
  ];

  await paint();
  return () => { alive = false; offs.forEach((f) => f()); };
}
