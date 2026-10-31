/* Activity log: everything that happened, in order, in plain English.
   The agent has no tool to edit or delete this log. */
import { html, raw, mount, api, store, fmt, on, $, $$ } from '../core.js';

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
  tool: { label: 'Tools', color: 'var(--ink-4)' },
  guard: { label: 'Safety guard', color: 'var(--c-red)' },
};
const ACTOR_ORDER = ['user', 'agent', 'tool', 'guard'];

const ui = { actor: 'all', q: '', order: 'old', open: {} };

const parse = (d) => { if (d == null || d === '') return null; try { return JSON.parse(d); } catch { return d; } };
let NAMES = new Map(); // merchant key -> shop name, from the current audit
const pretty = (key) => NAMES.get(key) || String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const clip = (s, n = 140) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/* tool name -> what the agent asked for, in plain words */
const CALL = {
  update_plan: 'Agent made a plan',
  list_statement_files: 'Agent looked at your statement files',
  parse_statement: 'Agent asked to read a statement',
  remember_cancellation: 'Agent noted a cancellation',
  categorize_transactions: 'Agent asked to sort the transactions',
  lookup_merchant: 'Agent looked up a shop on the web',
  set_merchant_category: 'Agent set a shop’s category',
  ask_user: 'Agent asked you a question',
  detect_subscriptions: 'Agent looked for monthly subscriptions',
  detect_duplicates: 'Agent looked for double charges',
  detect_price_changes: 'Agent looked for price rises',
  build_budget: 'Agent built your budget',
  draft_email: 'Agent asked to write an email draft',
  finish: 'Agent finished and wrote your summary',
  upcoming_renewals: 'Agent checked what renews soon',
  learn_csv_format: 'Agent learned a new bank file layout',
  compare_with_last_audit: 'Agent compared with your last audit',
};
const EVENT = {
  goal: 'You set the goal',
  draft_created: 'Agent wrote an email draft',
  ask_user: 'Agent saved a question for you',
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
  memory_forgotten: 'You asked it to forget a fix',
  csv_format_learned: 'Agent learned a new statement layout',
  chat_question: 'You asked a question',
  chat_refused: 'Safety guard refused a chat request',
  draft_requested: 'You asked for an email draft',
  subscription_cancelled: 'You marked a subscription as cancelled',
  pdf_unlocked: 'You unlocked a statement',
  pdf_unlock_failed: 'A statement password did not work',
};

/** One short plain sentence about what a tool answered. */
function resultSummary(tool, o) {
  if (o == null) return '';
  if (typeof o !== 'object') return clip(o);
  if (o.error) return `Could not do it: ${clip(o.error, 110)}`;
  switch (tool) {
    case 'parse_statement': {
      const q = (o.quarantined_rows || []).length;
      return `Read ${plural(o.transactions ?? 0, 'transaction')} from ${o.file}${q ? `. ${plural(q, 'row')} set aside` : ''}`;
    }
    case 'list_statement_files': return `Found ${plural((o.files || []).length, 'file')}`;
    case 'categorize_transactions': {
      const b = o.by_source || {};
      const parts = [b.rules && `${b.rules} known shops`, b.llm && `${b.llm} AI guesses`, b.memory && `${b.memory} from your fixes`, b.safety && `${b.safety} safety check`].filter(Boolean);
      return `Sorted ${o.total ?? ''} transactions${parts.length ? ': ' + parts.join(', ') : ''}`;
    }
    case 'detect_subscriptions': return `Found ${plural((o.subscriptions || []).length, 'monthly subscription')}`;
    case 'detect_duplicates': {
      const c = (o.confirmed_duplicates || []).length, r = (o.rejected_candidates || []).length;
      return `${plural(c, 'double charge')} confirmed${r ? `, ${r} looked double but were fine` : ''}`;
    }
    case 'detect_price_changes': {
      const parts = [
        (o.price_hikes || []).length && plural(o.price_hikes.length, 'price rise'),
        (o.trial_conversions || []).length && plural(o.trial_conversions.length, 'trial turned paid', 'trials turned paid'),
        (o.charges_after_cancellation || []).length && plural(o.charges_after_cancellation.length, 'charge after cancelling', 'charges after cancelling'),
      ].filter(Boolean);
      return parts.length ? `Found ${parts.join(', ')}` : 'No price rises found';
    }
    case 'build_budget': return o.current_savings_pct != null ? `You save ${o.current_savings_pct}% now. The plan saves ${o.projected_savings_pct ?? o.savings_target_pct}%` : 'Budget ready';
    case 'draft_email': return `Draft saved, waiting for you: “${clip(o.subject, 80)}”`;
    case 'ask_user': return 'Question saved for you';
    case 'remember_cancellation': return o.saved ? `Saved: cancelled on ${fmt.date(o.cancelled_on)}` : 'Saved';
    case 'update_plan': return 'Plan saved';
    case 'finish': return 'Done';
    default: return clip(Object.entries(o).slice(0, 3).map(([k, v]) => `${pretty(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '), 120);
  }
}

/** Turn one raw log row into {name, summary, kind}. */
function describe(ev, ctx) {
  const d = parse(ev.detail);
  const o = d && typeof d === 'object' ? d : {};
  const [type, tool] = ev.event.includes(':') ? ev.event.split(':') : [ev.event, null];
  if (type === 'tool_call') {
    let name = CALL[tool] || `Agent used ${pretty(tool)}`;
    if (tool === 'update_plan') { name = ctx.plans++ ? 'Agent changed its plan' : 'Agent made a plan'; }
    let sum = '';
    if (tool === 'parse_statement') sum = o.filename || '';
    else if (tool === 'update_plan') sum = (o.steps || []).length ? `${plural(o.steps.length, 'step')}: ${clip(o.steps[0], 90)}` : '';
    else if (tool === 'remember_cancellation') sum = `${o.merchant_name || ''}${o.cancelled_on ? `, cancelled on ${fmt.date(o.cancelled_on)}` : ''}`;
    else if (tool === 'ask_user') sum = clip(o.question, 120);
    else if (tool === 'build_budget') sum = o.savings_target_pct ? `Savings target ${o.savings_target_pct}%${(o.cancel_merchants || []).length ? `, stop ${o.cancel_merchants.map(pretty).join(' and ')}` : ''}` : '';
    else if (tool === 'draft_email') sum = o.kind ? `${pretty(o.kind)} email` : '';
    else if (tool === 'lookup_merchant') sum = o.query || o.merchant || '';
    else if (tool === 'set_merchant_category') sum = o.merchant ? `${pretty(o.merchant)} → ${o.category}` : '';
    else if (tool === 'finish') sum = 'Wrote the summary on your report page';
    return { name, summary: sum, kind: 'call' };
  }
  if (type === 'chat_tool') {
    const CHAT = { query_transactions: 'Looked through your transactions', spend_summary: 'Added up your spending', get_findings: 'Checked the problems it found', get_renewals: 'Checked what renews soon', get_budget: 'Read your budget', get_memory: 'Checked what it remembers', compare_with_last_audit: 'Compared with your last audit', request_email_draft: 'Wrote an email draft' };
    return { name: `Ask AI: ${(CHAT[tool] || `used ${tool}`).replace(/_/g, ' ').replace(/^\w/, (c) => c.toLowerCase())}`, summary: '', kind: 'call' };
  }
  if (type === 'result') {
    return { name: 'Tool answered', summary: resultSummary(tool, d), kind: 'result', bad: !!(o && o.error) };
  }
  const name = EVENT[type] || pretty(type);
  let sum = '';
  switch (type) {
    case 'goal': sum = typeof d === 'string' ? `“${clip(d, 140)}”` : ''; break;
    case 'draft_created': sum = o.subject ? `“${clip(o.subject, 110)}”` : ''; break;
    case 'ask_user': sum = clip(o.question, 130); break;
    case 'parse_failed': sum = `${o.file || ''}: ${clip(o.error, 90)}`; break;
    case 'category_correction': sum = `${pretty(o.merchant)} is now ${o.category}`; break;
    case 'draft_approved': case 'draft_rejected': sum = o.draft_id ? `Email draft #${o.draft_id}` : ''; break;
    case 'send_blocked': sum = `Email draft #${o.draft_id ?? '?'}: ${o.reason === 'not approved' ? 'you had not approved it' : o.reason || 'blocked'}`; break;
    case 'refused_request': sum = clip(o.reason || o.goal, 130); break;
    case 'email_sent': sum = `Email draft #${o.draft_id ?? '?'}${o.to ? ` to ${o.to}` : ''}`; break;
    case 'send_failed': sum = clip(o.error, 120); break;
    case 'chat_question': sum = o.text ? `“${clip(o.text, 130)}”` : ''; break;
    case 'chat_refused': sum = clip(o.reason, 130); break;
    case 'pdf_unlocked': case 'pdf_unlock_failed': sum = o.file || ''; break;
    case 'memory_forgotten': sum = pretty(o.key); break;
    case 'llm_error': sum = clip(typeof d === 'string' ? d : o.error, 120); break;
    default: sum = typeof d === 'string' ? clip(d) : clip(Object.entries(o).map(([k, v]) => `${pretty(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '), 120);
  }
  return { name, summary: sum, kind: 'event' };
}

function detailText(ev) {
  const d = parse(ev.detail);
  if (d == null) return 'No details.';
  if (typeof d === 'string') return d;
  return JSON.stringify(d, null, 2);
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
    <p class="lead">When you run an audit, every step the agent takes is written here, in order. The agent cannot delete this log. It is how you check what it did.</p>
    <div class="rv-empty-actions"><a class="btn btn-primary" href="#/start">Start an audit <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="#/how">How it works</a></div>
  </header>
  <div class="rv-ghost" aria-hidden="true"><div class="rv-ghost-note">${ic('lock')} Every step will appear here, and stay here.</div>${[0, 1, 2, 3].map(() => html`<div class="row-g"><i></i><i></i><i></i></div>`)}</div>
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
    <p>Each audit you have run. The one marked “Shown below” is in the timeline.</p>
    <div class="rv-runs-wrap">
      <div class="rv-runs-row is-head" aria-hidden="true"><span>When</span><span>What you asked for</span><span class="n">Transactions</span><span class="n">Problems</span><span class="n">To get back</span><span class="n">Emails</span></div>
      ${runs.list.map((r) => html`<div class="rv-runs-row">
        <span class="rv-runs-when">${fmt.date(r.started_at)}, ${fmt.time(r.started_at)}</span>
        <span class="rv-runs-goal" title="${r.goal || ''}">${r.id === shownId ? html`<span class="rv-runs-latest">Shown below</span>` : ''}${runState(r) ? html`<span class="rv-runs-state">${runState(r)}</span>` : ''}${r.goal || 'No goal given'}</span>
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
  return html`<li class="rv-ev ${e.kind === 'result' ? 'is-result' : ''} ${e.actor === 'guard' ? 'is-guard' : ''} ${open ? 'is-open' : ''}" style="--c:${raw(a.color)}">
    <span class="rv-ev-dot" aria-hidden="true"></span>
    <button class="rv-ev-btn" data-ev="${e.key}" aria-expanded="${open}">
      <span class="rv-ev-name">${e.name}</span>
      <span class="rv-ev-meta"><span class="rv-ev-actor"><i></i>${a.label}</span><span class="rv-ev-time">${fmt.time(e.ts)}${e.ts.length > 16 ? e.ts.slice(16, 19) : ''}</span>${ic('chev', 'rv-ev-chev')}</span>
      ${e.summary ? html`<span class="rv-ev-sum">${e.summary}</span>` : ''}
    </button>
    ${open ? html`<div class="rv-ev-detail"><pre>${detailText(e)}</pre><div class="rv-ev-raw">${e.actor} · ${e.event} · ${e.ts.replace('T', ' ')}</div></div>` : ''}
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
    const ctx = { plans: 0 };
    ALL = raw0.map((ev, i) => {
      const d = describe(ev, ctx);
      return { ...ev, ...d, key: `${ev.ts}|${ev.event}|${i}`, hay: `${d.name} ${d.summary} ${ev.event} ${ev.detail || ''}`.toLowerCase() };
    });
    const counts = Object.fromEntries(ACTOR_ORDER.map((k) => [k, ALL.filter((e) => e.actor === k).length]));
    const blocked = ALL.filter((e) => e.actor === 'guard').length;
    const first = ALL[0], last = ALL[ALL.length - 1];
    mount(wrap, html`<div class="page">
      <header class="rv-head">
        <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Activity log</span></p>
        <h1 class="h1">Everything that happened, in order.</h1>
        <p class="lead">Every step the agent took, every answer its tools gave, and every choice you made. <b>This log cannot be deleted by the agent.</b> It is how you check what it did.</p>
        <div class="rv-log-sum">
          <span><b>${ALL.length}</b> events</span>
          ${first && last ? html`<span>From <b>${fmt.time(first.ts)}</b> to <b>${fmt.time(last.ts)}</b> on ${fmt.date(last.ts, true)}</span>` : ''}
          <span><b>${blocked}</b> ${blocked === 1 ? 'action' : 'actions'} stopped by the safety guard</span>
        </div>
      </header>
      ${runsCard(runs, s.run && s.run.id)}
      <div class="rv-log-ctl">
        <button class="chip ${ui.actor === 'all' ? 'is-active' : ''}" data-actor="all">Everyone <span class="rv-n">${ALL.length}</span></button>
        ${ACTOR_ORDER.map((k) => html`<button class="chip ${ui.actor === k ? 'is-active' : ''}" data-actor="${k}" style="--c:${raw(ACTORS[k].color)}" ${counts[k] ? '' : 'disabled'}><span class="dot"></span>${ACTORS[k].label} <span class="rv-n">${counts[k]}</span></button>`)}
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
