/* Transactions: every row the agent read, how it sorted each one, and the place to teach it.
   A category change is saved per shop (merchant) and remembered for the next audit. */
import { html, raw, esc, mount, api, store, fmt, plain, KIND, SOURCE_LABEL, tip, toast, on, $, $$ } from '../core.js';

export const title = 'Transactions';

const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  chat: '<path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12z"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.6v.1"/>',
  check: '<path d="m5 12.5 4.4 4.4L19 7.4"/>',
  shield: '<path d="M12 3.2 5 6v5.6c0 4.3 2.9 7.9 7 9.2 4.1-1.3 7-4.9 7-9.2V6l-7-2.8z"/><path d="M12 8.5v4M12 15.5v.1"/>',
  chev: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  brain: '<path d="M12 4.5v15"/><path d="M12 7.5A3 3 0 0 0 6.6 6 3 3 0 0 0 4.5 10.6 3.2 3.2 0 0 0 6 16.5 3 3 0 0 0 12 18"/><path d="M12 7.5A3 3 0 0 1 17.4 6a3 3 0 0 1 2.1 4.6 3.2 3.2 0 0 1-1.5 5.9A3 3 0 0 1 12 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
};
const ic = (n, cls = '') => raw(`<svg class="rv-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`);

const SRC_ORDER = ['rule', 'llm', 'memory', 'agent+web', 'safety'];
const srcCls = (k) => 'rv-src-' + String(k || '').replace(/[^a-z]/g, '');
const PICKS = [
  { label: 'Household help', cat: 'Household' },
  { label: 'Rent', cat: 'Rent' },
  { label: 'Friend or family', cat: 'Transfers' },
  { label: 'Other', cat: 'Other' },
];
const MONTH_LONG = (ym) => fmt.month(ym, true);

/* filters, pending fixes and open rows survive a re-render */
const ui = { q: '', filter: 'all', months: {}, changes: {}, open: {}, saving: false, confirm: null, forgetting: false };

const pretty = (key) => String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function skeleton() {
  return html`<div class="page">
    <div class="rv-sk-head"><div class="skel rv-sk-line" style="width:180px"></div><div class="skel rv-sk-title" style="width:58%"></div><div class="skel rv-sk-line" style="width:88%"></div><div class="skel rv-sk-line" style="width:60%"></div></div>
    <div class="skel rv-sk-block" style="height:170px"></div>
    <div class="rv-tx-top"><div class="skel rv-sk-block" style="height:190px"></div><div class="skel rv-sk-block" style="height:190px"></div></div>
    <div class="skel" style="height:40px;border-radius:99px;margin:48px 0 14px;width:70%"></div>
    <div class="card" style="padding:8px 16px">${Array.from({ length: 8 }, () => html`<div style="display:grid;grid-template-columns:80px 1fr 200px 140px 100px;gap:20px;padding:16px 0;border-bottom:1px solid var(--line)"><div class="skel rv-sk-line"></div><div class="skel rv-sk-line"></div><div class="skel rv-sk-line"></div><div class="skel rv-sk-line"></div><div class="skel rv-sk-line"></div></div>`)}</div>
  </div>`;
}

function emptyView(hasRun) {
  return html`<div class="page"><header class="rv-head">
      <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Transactions</span></p>
      <h1 class="h1">No transactions yet.</h1>
      <p class="lead">${hasRun ? 'Your last audit did not read any transactions, so there is nothing to show here. Run it again.' : 'Run an audit first.'}</p>
      <div class="rv-empty-actions"><a class="btn btn-primary" href="#/start">Start an audit <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="#/how">How it works</a></div>
    </header>
    <div class="rv-ghost" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<div class="row-g"><i></i><i></i><i></i></div>`)}</div>
  </div>`;
}

function errorView(e) {
  return html`<div class="page"><header class="rv-head">
    <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Transactions</span></p>
    <h1 class="h1">We could not load your transactions.</h1>
    <p class="lead">The KharchaSaathi server did not answer. Check that it is running, then try again.</p>
    <p class="small mono" style="margin-top:14px">${e && e.message}</p>
    <div class="rv-empty-actions"><button class="btn btn-primary" data-act="reload">Try again</button></div>
  </header></div>`;
}

/* ---------- the agent's question ("Who is Ramesh Kumar?") ---------- */
/* Not every question is about a shop (a locked file, a suspicious row). Those have no quick answers, but must still show. */
function plainAskCard(q, s) {
  if (!q.question) return '';
  const canShow = q.kind !== 'password' && (s.transactions || []).some((t) => t.flags || (t.confidence ?? 1) < 0.7);
  return html`<section class="rv-ask" aria-label="A question from the agent">
    <span class="rv-bubble">${ic('chat')}</span>
    <div>
      <div class="rv-ask-over">The agent asked you</div>
      <p class="rv-ask-facts rv-ask-plain">${plain(q.question)}</p>
      ${canShow ? html`<div class="rv-picks"><button class="rv-pick" data-show-look>Show what needs a look</button></div>` : ''}
    </div>
  </section>`;
}

function askCard(q, s) {
  const keys = q.merchant_keys || [];
  const rows = (s.transactions || []).filter((t) => keys.includes(t.merchant));
  if (!rows.length) return plainAskCard(q, s);
  const name = rows[0].merchant_display || pretty(keys[0]);
  const first = q.question.split('?')[0];
  const head = first.replace(/\s*\([^)]*\)/g, '').trim() + '?';
  const upi = (first.match(/\(([^)]*)\)/) || [])[1];
  const amts = [...new Set(rows.map((t) => t.amount))];
  const dates = rows.map((t) => fmt.date(t.date));
  const dateText = dates.length > 1 ? `${dates.slice(0, -1).join(', ')} and ${dates.slice(-1)}` : dates[0];
  const remembered = keys.every((k) => (s.corrections || []).some((c) => c.merchant === k));
  const answered = remembered && rows.every((t) => t.cat_source === 'memory');
  const forgotten = !remembered && rows.every((t) => t.cat_source === 'memory');
  const pending = keys.map((k) => ui.changes[k]).find(Boolean);
  const current = pending || rows[0].category;
  return html`<section class="rv-ask" aria-label="A question from the agent">
    <span class="rv-bubble">${ic('chat')}</span>
    <div>
      <div class="rv-ask-over">The agent asked you</div>
      <h2>${head}</h2>
      <p class="rv-ask-facts">You paid ${name} ${amts.length === 1 ? html`<b>${fmt.inr(amts[0])}</b>` : html`<b>${fmt.inr(rows.reduce((a, t) => a + t.amount, 0))}</b> in total`}
        ${rows.length > 1 ? `${rows.length} times, on ${dateText}` : `on ${dateText}`}${upi ? html`, by ${upi.replace(/^UPI\s*/i, 'UPI to ')}` : ''}. The agent could not tell what this is for. Your answer sorts all of them, now and in every future audit.</p>
      <div class="rv-picks" role="group" aria-label="Pick what ${name} is">
        ${PICKS.map((p) => html`<button class="rv-pick ${answered && current === p.cat ? 'is-active' : ''}" data-pick="${p.cat}" data-merchants="${keys.join(',')}">
          ${answered && current === p.cat ? ic('check') : ''}${p.label}${p.label !== p.cat && p.cat !== 'Household' ? html`<small>${p.cat}</small>` : ''}</button>`)}
      </div>
      ${answered
        ? html`<div class="rv-ask-state is-done">${ic('check')}You answered: ${current}. KharchaSaathi will remember this for ${name}.</div>`
        : forgotten
          ? html`<div class="rv-ask-state">You asked it to forget this answer. It stays as ${current} in this audit. The next audit will work it out again.</div>`
          : html`<div class="rv-ask-state">For now it is sorted as ${current}. Pick the right one and it is saved straight away.</div>`}
    </div>
  </section>`;
}

/* ---------- how each one was sorted (slim stacked bar) ---------- */
function sourceCard(tx) {
  const n = tx.length || 1;
  const counts = Object.fromEntries(SRC_ORDER.map((k) => [k, 0]));
  tx.forEach((t) => { counts[t.cat_source] = (counts[t.cat_source] || 0) + 1; });
  const keys = [...SRC_ORDER, ...Object.keys(counts).filter((k) => !SRC_ORDER.includes(k))];
  const shown = keys.filter((k) => counts[k] > 0);
  const top = shown.slice().sort((a, b) => counts[b] - counts[a])[0];
  return html`<div class="card">
    <div class="rv-card-head"><div><h2 class="title">How each one was sorted</h2>
      <p>Your own fixes always come first.</p></div></div>
    <div class="rv-stack" role="img" aria-label="${shown.map((k) => `${SOURCE_LABEL[k] || k}: ${counts[k]}`).join(', ')}">
      ${shown.map((k, i) => html`<i class="${srcCls(k)}" style="flex:${counts[k]} 1 0;--d:${i * 90}ms" data-tip="${`<div class="tip-title">${esc(SOURCE_LABEL[k] || k)}</div><div class="tip-row"><span>Transactions</span><b>${counts[k]}</b></div><div class="tip-row"><span>Share</span><b>${fmt.pct((counts[k] / n) * 100, 1)}</b></div>`}"></i>`)}
    </div>
    <div class="rv-srclegend">
      ${keys.map((k) => html`<div class="${srcCls(k)} ${counts[k] ? '' : 'is-zero'}"><i></i><b>${SOURCE_LABEL[k] || k}</b>
        <span><strong>${fmt.n(counts[k])}</strong>${counts[k] ? fmt.pct((counts[k] / n) * 100, counts[k] / n < 0.01 ? 1 : 0) : 'none'}</span></div>`)}
    </div>
  </div>`;
}

/* ---------- what it remembers ---------- */
const FORGET_NOTE = {
  corrections: 'Next audit, it will sort this shop on its own again.',
  cancellations: 'It will stop flagging charges made after this date.',
  dismissals: 'It may flag this again on your next audit.',
  sub_decisions: 'It will treat this subscription as undecided on your next audit.',
  csv_formats: 'It will have to learn this file layout again.',
};

/** Everything it keeps about the user, as plain rows. Passwords never appear here. */
function memoryGroups(s, mem) {
  const nm = new Map((s.transactions || []).map((t) => [t.merchant, t.merchant_display]));
  const name = (k) => nm.get(k) || pretty(k);
  const m = mem || { corrections: s.corrections || [] };
  const uses = (n) => (n ? `used ${fmt.plural(n, 'time')} so far` : 'used from your next audit');
  return [
    { title: 'Your category fixes', items: (m.corrections || []).map((c) => ({
      type: 'corrections', key: c.merchant, name: name(c.merchant), tag: c.category,
      meta: `Saved ${fmt.date(c.created_at)} · ${uses(c.times_applied)}` })) },
    { title: 'Things you cancelled', items: (m.cancellations || []).map((c) => ({
      type: 'cancellations', key: c.merchant, name: name(c.merchant), tag: `Cancelled ${fmt.date(c.cancelled_on)}`,
      meta: 'Any charge after this date gets flagged' })) },
    { title: 'Marked as expected', items: (m.dismissals || []).map((d) => ({
      type: 'dismissals', key: d.key, name: name(d.merchant), tag: (KIND[d.kind] || {}).short || 'Expected',
      meta: [d.amount ? fmt.inr(d.amount) : '', d.created_at ? `Marked ${fmt.date(d.created_at)}` : '', d.reason || ''].filter(Boolean).join(' · ') })) },
    { title: 'Your subscription choices', items: (m.subscription_decisions || []).map((d) => ({
      type: 'sub_decisions', key: d.merchant, name: name(d.merchant), tag: d.decision === 'keep' ? 'Keep it' : d.decision === 'cancel' ? 'Stop paying' : pretty(d.decision),
      meta: [d.created_at ? `Chosen ${fmt.date(d.created_at)}` : '', d.note || ''].filter(Boolean).join(' · ') })) },
    { title: 'Bank file layouts it learned', items: (m.csv_formats || []).map((f) => ({
      type: 'csv_formats', key: f.signature, name: f.example_file || 'A bank file layout', tag: 'Layout',
      meta: `Learned ${fmt.date(f.created_at)} · ${uses(f.times_used)}` })) },
  ].filter((g) => g.items.length);
}

function memoryList(s, mem) {
  const groups = memoryGroups(s, mem);
  if (!groups.length) return html`<div class="rv-mem-empty">Nothing yet. When you change a category or mark something as expected, it shows up here.</div>`;
  return html`<div class="rv-mem-list">${groups.map((g) => html`<div class="rv-mem-group">${g.title}</div>
    ${g.items.map((it) => {
      const id = `${it.type}|${it.key}`;
      const asking = ui.confirm === id;
      return html`<div class="rv-mem-item">
        <span class="rv-mem-name"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.name}</span></span>
        <span class="rv-mem-cat badge badge-good">${it.tag}</span>
        <div class="rv-mem-actions"><span class="rv-mem-meta">${it.meta}</span>
          ${asking ? '' : html`<button class="rv-mem-forget" data-forget="${id}" aria-label="Forget ${it.name}">Forget</button>`}</div>
        ${asking ? html`<div class="rv-mem-confirm" role="group" aria-label="Confirm forgetting ${it.name}">${FORGET_NOTE[it.type]} You cannot undo this here.
          <div class="rv-mem-confirm-btns"><button class="btn btn-secondary btn-sm" data-forget-yes="${id}" ${ui.forgetting ? 'disabled' : ''}>${ui.forgetting ? html`<span class="spinner"></span>` : ''}Yes, forget it</button>
          <button class="btn btn-ghost btn-sm" data-forget-no ${ui.forgetting ? 'disabled' : ''}>Keep it</button></div></div>` : ''}
      </div>`;
    })}`)}</div>`;
}

function memoryCard(s, mem) {
  return html`<div class="card">
    <div class="rv-card-head"><div><h2 class="title">What it remembers</h2>
      <p>Saved on this computer. Forget anything you like.</p></div></div>
    <div data-mem>${memoryList(s, mem)}</div>
    ${mem && mem.pdf_passwords ? html`<p class="rv-mem-pw" style="margin-bottom:0">${ic('lock')}<span>Statement passwords are never saved. An unlocked file stays open only until the app restarts.</span></p>` : ''}
  </div>`;
}

/* ---------- table ---------- */
function needsLook(t, askKeys) {
  return (t.confidence ?? 1) < 0.7 || askKeys.has(t.merchant) || !!t.flags;
}

function filterRows(tx, askKeys) {
  const q = ui.q.trim().toLowerCase();
  return tx.filter((t) => {
    if (ui.filter === 'look' && !needsLook(t, askKeys)) return false;
    if (ui.filter === 'in' && t.direction !== 'CR') return false;
    if (ui.filter === 'out' && t.direction !== 'DR') return false;
    if (q && !`${t.merchant_display} ${t.display_description} ${t.category}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function catSelect(t, cats) {
  const cur = ui.changes[t.merchant] ?? t.category;
  const list = cats.includes(cur) ? cats : [...cats, cur];
  return html`<select class="rv-cat" data-merchant="${t.merchant}" data-orig="${t.category}" aria-label="Category for ${t.merchant_display} on ${fmt.date(t.date)}">
    ${list.map((c) => html`<option ${c === cur ? 'selected' : ''}>${c}</option>`)}</select>`;
}

function flagDetail(t) {
  return html`<tr class="rv-flagdetail"><td colspan="5"><div class="rv-flagbox">
    <div><span class="k">What happened</span>
      <p>This ${fmt.inr(t.amount)} ${t.merchant_display} request had <b>an instruction hidden in its description</b>. It tried to tell the AI to mark everything as safe and email your full statement to a stranger.</p>
      <p>KharchaSaathi spotted it before the AI saw it, hid the text, and treated the row as plain data. <b>Nothing was emailed.</b> Never accept unknown collect requests.</p></div>
    <div><span class="k">What the AI was shown</span><code>${t.display_description}</code>
      <span class="k" style="display:block;margin-top:14px">The original text (shown to you only)</span><code>${t.description}</code></div>
  </div></td></tr>`;
}

function rowsHtml(rows, cats) {
  if (!rows.length) return html`<tr class="rv-noresults"><td colspan="5">Nothing matches these filters. <button data-act="clear">Clear filters</button></td></tr>`;
  const months = [...new Set(rows.map((t) => t.date.slice(0, 7)))];
  const narrowed = !!ui.q.trim() || ui.filter !== 'all';
  return html`${months.map((m, mi) => {
    const open = narrowed || (ui.months[m] ?? mi === 0);
    const list = rows.filter((t) => t.date.slice(0, 7) === m);
    const out = list.filter((t) => t.direction === 'DR').reduce((a, t) => a + t.amount, 0);
    const inn = list.filter((t) => t.direction === 'CR').reduce((a, t) => a + t.amount, 0);
    return html`<tr class="rv-monthrow"><td colspan="5"><button class="rv-mrow-in" data-month="${m}" aria-expanded="${open}" ${narrowed ? 'disabled' : ''}><b>${MONTH_LONG(m)}</b>
        <span>${fmt.plural(list.length, 'transaction')} · ${fmt.inr(out)} out${inn ? ` · ${fmt.inr(inn)} in` : ''}</span>${narrowed ? '' : ic('chev', 'rv-mrow-chev')}</button></td></tr>
      ${!open ? '' : list.map((t) => {
        const flag = t.flags === 'prompt_injection';
        const changed = ui.changes[t.merchant] != null;
        const conf = Math.round((t.confidence ?? 1) * 100);
        const tipTxt = `<div class="tip-title">${esc(SOURCE_LABEL[t.cat_source] || t.cat_source)}</div><div>${esc(t.reason || '')}</div><div class="tip-row" style="margin-top:6px"><span>How sure</span><b>${conf}%</b></div>`;
        return html`<tr class="${changed ? 'is-changed' : ''} ${flag ? 'is-flag' : ''}" data-row="${t.id}" data-m="${t.merchant}">
          <td class="rv-td-date">${fmt.date(t.date)}<small>${t.source === 'card' ? 'Card' : 'Bank'}</small></td>
          <td class="rv-td-shop"><div class="rv-shop"><span>${t.merchant_display}</span>
            ${flag ? html`<button class="rv-flagbtn" data-act="flag" data-id="${t.id}" aria-expanded="${ui.open[t.id] ? 'true' : 'false'}" data-tip="${'<b>Hidden instruction ignored</b><br>Click to see what it said and what KharchaSaathi did.'}">${ic('shield')}Hidden instruction ignored${ic('chev', 'rv-chev')}</button>` : ''}</div>
            <span class="rv-raw" title="${t.display_description}">${t.display_description}</span></td>
          <td class="rv-td-cat">${catSelect(t, cats)}</td>
          <td class="rv-td-src"><span class="rv-dotlabel ${srcCls(t.cat_source)}" data-tip="${tipTxt}"><i></i>${SOURCE_LABEL[t.cat_source] || t.cat_source}</span></td>
          <td class="rv-amt ${t.direction === 'CR' ? 'is-in' : ''}">${t.direction === 'CR' ? '+' : ''}${fmt.inr(t.amount, t.amount % 1 ? 2 : 0)}</td>
        </tr>${flag && ui.open[t.id] ? flagDetail(t) : ''}`;
      })}`;
  })}`;
}

function controls(tx, askKeys) {
  const cnt = {
    all: tx.length,
    look: tx.filter((t) => needsLook(t, askKeys)).length,
    in: tx.filter((t) => t.direction === 'CR').length,
    out: tx.filter((t) => t.direction === 'DR').length,
  };
  return html`<div class="rv-ctl" role="search">
    <label class="rv-search">${ic('search')}<span class="sr-only">Search</span><input type="search" data-q placeholder="Search a shop or description" value="${ui.q}" autocomplete="off" /></label>
    <div class="seg" role="tablist" aria-label="Show">
      ${[['all', 'All'], ['look', 'Needs a look'], ['in', 'Money in'], ['out', 'Money out']].map(([k, l]) => html`<button role="tab" aria-selected="${ui.filter === k}" class="${ui.filter === k ? 'is-active' : ''}" data-filter="${k}">${l}<span class="rv-n">${cnt[k]}</span></button>`)}
    </div>
    <span class="rv-ctl-meta" data-meta></span>
  </div>`;
}

function pageView(s, mem) {
  const tx = s.transactions || [];
  return html`<div class="page">
    <header class="rv-head">
      <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Transactions</span></p>
      <h1 class="h1">${fmt.n(tx.length)} transactions, sorted.</h1>
      <p class="lead">Change any category and it is remembered next time.</p>
    </header>
    ${(s.questions || []).map((q) => askCard(q, s))}
    <div class="rv-tx-top">${sourceCard(tx)}${memoryCard(s, mem)}</div>
    ${controls(tx, new Set((s.questions || []).flatMap((q) => q.merchant_keys || [])))}
    <div class="card rv-tx-card">
      <table class="table rv-table">
        <colgroup><col class="c-date"><col><col class="c-cat"><col class="c-src"><col class="c-amt"></colgroup>
        <thead><tr><th scope="col">Date</th><th scope="col">Shop</th><th scope="col">Category</th><th scope="col">How it was sorted</th><th scope="col" class="r">Amount</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>
    <div class="rv-tx-foot">
      <span>${(s.quarantine || []).length || (s.parse_failures || []).length
        ? `Not in this list: ${[(s.quarantine || []).length ? fmt.plural(s.quarantine.length, 'row') + ' set aside because the amount could not be read' : '', (s.parse_failures || []).length ? fmt.plural(s.parse_failures.length, 'damaged file') + ' skipped' : ''].filter(Boolean).join(', and ')}.`
        : 'Every row in your statements is listed here.'}</span>
      <span>Amounts with a + are money that came in.</span>
    </div>
  </div>`;
}

/* ---------- view ---------- */
export async function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'rv rv-tx';
  root.appendChild(wrap);
  mount(wrap, skeleton());
  let alive = true, S = null, MEM = null, askKeys = new Set();
  // the save bar lives on <body>: #app animates a transform on route change, which would trap position:fixed
  const bar = document.createElement('div');
  bar.className = 'rv-save';
  bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Unsaved fixes'); bar.setAttribute('aria-live', 'polite');
  document.body.appendChild(bar);

  const names = () => new Map((S.transactions || []).map((t) => [t.merchant, t.merchant_display]));

  const renderRows = () => {
    if (!S) return;
    const rows = filterRows(S.transactions || [], askKeys);
    const body = $('[data-rows]', wrap);
    if (body) mount(body, rowsHtml(rows, S.categories || []));
    const meta = $('[data-meta]', wrap);
    const filtered = ui.q || ui.filter !== 'all';
    if (meta) mount(meta, html`Showing ${fmt.n(rows.length)} of ${fmt.n((S.transactions || []).length)}${filtered ? html`<button data-act="clear">Clear</button>` : ''}`);
  };

  const renderSave = () => {
    const ms = Object.keys(ui.changes);
    if (!ms.length) { bar.classList.remove('is-on'); return; }
    const nm = names();
    const list = ms.map((m) => nm.get(m) || pretty(m));
    const who = list.length <= 2 ? list.join(' and ') : `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
    mount(bar, html`<span class="dot"></span>
      <span class="rv-save-text"><b>Save ${fmt.plural(ms.length, 'fix', 'fixes')}.</b> <span>KharchaSaathi will remember ${ms.length === 1 ? 'this' : 'these'} for ${who} next time.</span></span>
      <span class="rv-save-actions"><button class="btn btn-ghost rv-btn-dim" data-act="discard" ${ui.saving ? 'disabled' : ''}>Undo</button>
      <button class="btn rv-btn-light" data-act="save" ${ui.saving ? 'disabled' : ''}>${ui.saving ? html`<span class="spinner"></span>Saving…` : `Save ${ms.length === 1 ? 'fix' : 'fixes'}`}</button></span>`);
    bar.classList.add('is-on');
  };

  const paintMem = () => { const host = $('[data-mem]', wrap); if (host && S) mount(host, memoryList(S, MEM)); };

  const paint = async () => {
    let s;
    let mem = null;
    try {
      // the memory list is extra: if it fails, the page still works and shows the fixes from the audit
      [s, mem] = await Promise.all([store.state(), api.get('/api/memory').catch(() => null)]);
    } catch (e) { if (alive) mount(wrap, errorView(e)); return; }
    if (!alive) return;
    S = s; MEM = mem; ui.confirm = null;
    if (!s.run || !(s.transactions || []).length) { mount(wrap, emptyView(!!s.run)); return; }
    askKeys = new Set((s.questions || []).flatMap((q) => q.merchant_keys || []));
    // drop pending fixes that are already true
    Object.keys(ui.changes).forEach((m) => { const t = s.transactions.find((x) => x.merchant === m); if (!t || t.category === ui.changes[m]) delete ui.changes[m]; });
    mount(wrap, pageView(s, mem));
    renderRows();
    renderSave();
  };

  const saveCorrections = async (pairs) => {
    for (const [merchant, category] of pairs) await api.post('/api/correction', { merchant, category });
  };

  async function onAct(t) {
    const act = t.dataset.act;
    if (act === 'reload') { store.invalidate(); return; }
    if (act === 'clear') {
      Object.assign(ui, { q: '', filter: 'all' });
      const q = $('[data-q]', wrap); if (q) q.value = '';
      $$('[data-filter]', wrap).forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'all'));
      renderRows(); return;
    }
    if (act === 'flag') { const id = t.dataset.id; ui.open[id] = !ui.open[id]; tip.hide(); renderRows(); return; }
    if (act === 'discard') { ui.changes = {}; renderRows(); renderSave(); return; }
    if (act === 'save') {
      const pairs = Object.entries(ui.changes);
      if (!pairs.length) return;
      ui.saving = true; renderSave();
      try {
        await saveCorrections(pairs);
        const nm = names();
        toast(pairs.length === 1 ? `Saved. ${nm.get(pairs[0][0]) || pretty(pairs[0][0])} is now ${pairs[0][1]}.` : `Saved ${pairs.length} fixes. They will be used first next time.`, { kind: 'good' });
        ui.changes = {};
      } catch (err) { toast(`Could not save: ${err.message}`, { kind: 'bad' }); }
      ui.saving = false;
      store.invalidate();
    }
  }

  const offs = [
    tip.bind(wrap),
    on(wrap, 'input', '[data-q]', (e, t) => { ui.q = t.value; renderRows(); }),
    on(wrap, 'click', '[data-filter]', (e, t) => {
      ui.filter = t.dataset.filter;
      $$('[data-filter]', wrap).forEach((b) => { const a = b === t; b.classList.toggle('is-active', a); b.setAttribute('aria-selected', String(a)); });
      renderRows();
    }),
    on(wrap, 'click', '[data-month]', (e, t) => {
      const m = t.dataset.month;
      ui.months[m] = t.getAttribute('aria-expanded') !== 'true';
      renderRows();
      const again = $(`[data-month="${m}"]`, wrap); if (again) again.focus({ preventScroll: true });
    }),
    on(wrap, 'change', '.rv-cat', (e, t) => {
      const m = t.dataset.merchant;
      const orig = (S.transactions.find((x) => x.merchant === m) || {}).category;
      if (t.value === orig) delete ui.changes[m]; else ui.changes[m] = t.value;
      // a fix applies to every row from the same shop
      $$(`tr[data-m="${CSS.escape(m)}"]`, wrap).forEach((tr) => {
        tr.classList.toggle('is-changed', ui.changes[m] != null);
        const sel = $('.rv-cat', tr); if (sel && sel !== t) sel.value = t.value;
      });
      renderSave();
    }),
    on(bar, 'click', '[data-act]', (e, t) => onAct(t)),
    on(wrap, 'click', '[data-act]', (e, t) => onAct(t)),
    on(wrap, 'click', '[data-show-look]', () => {
      const seg = $('[data-filter="look"]', wrap);
      if (seg) seg.click();
      const ctl = $('.rv-ctl', wrap);
      if (ctl) ctl.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }),
    on(wrap, 'click', '[data-forget]', (e, t) => { ui.confirm = t.dataset.forget; paintMem(); }),
    on(wrap, 'click', '[data-forget-no]', () => { ui.confirm = null; paintMem(); }),
    on(wrap, 'click', '[data-forget-yes]', async (e, t) => {
      if (ui.forgetting) return;
      const raw0 = t.dataset.forgetYes;
      const cut = raw0.indexOf('|');
      ui.forgetting = true; paintMem();
      try {
        await api.post('/api/memory/forget', { type: raw0.slice(0, cut), key: raw0.slice(cut + 1) });
        toast('Forgotten. This applies from your next audit.', { kind: 'good' });
      } catch (err) { toast(`Could not forget that: ${err.message}`, { kind: 'bad' }); }
      ui.forgetting = false; ui.confirm = null;
      store.invalidate();
    }),
    on(wrap, 'click', '[data-pick]', async (e, t) => {
      if (ui.saving) return;
      const cat = t.dataset.pick;
      const ms = (t.dataset.merchants || '').split(',').filter(Boolean);
      ui.saving = true;
      $$('[data-pick]', wrap).forEach((b) => { b.disabled = true; });
      t.classList.add('is-active');
      try {
        await saveCorrections(ms.map((m) => [m, cat]));
        ms.forEach((m) => delete ui.changes[m]);
        const nm = names();
        toast(`Saved. ${nm.get(ms[0]) || pretty(ms[0])} is now ${cat}. It will be remembered.`, { kind: 'good' });
      } catch (err) { toast(`Could not save: ${err.message}`, { kind: 'bad' }); }
      ui.saving = false;
      store.invalidate();
    }),
    store.subscribe(() => { if (alive) paint(); }),
  ];

  await paint();
  return () => { alive = false; offs.forEach((f) => f()); bar.remove(); };
}
