/* Proof: the evaluation, in plain English, for judges.
   Everything on this page is computed from GET /api/eval (eval/run_eval.py). */
import { html, raw, esc, mount, api, fmt, tip, reveal, countUp } from '../core.js';

export const title = 'Proof';

const P = {
  check: '<path d="m5 12.5 4.4 4.4L19 7.4"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8v12M9 5.5 10.5 8M15 5.5 13.5 8M4 12h3M17 12h3M4.5 17.5 7.4 16M19.5 17.5 16.6 16M4.5 7 7.3 9M19.5 7l-2.8 2"/>',
};
const ic = (n, cls = '') => raw(`<svg class="rv-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`);

let cache = null;

/* percent without a pointless ".0" (97.1%, 100%) */
const pc = (x) => { const v = Math.round(x * 1000) / 10; return (v % 1 ? v.toFixed(1) : String(v)) + '%'; };
const pretty = (key) => String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const SYSTEMS = [
  { key: 'ai', label: 'AI alone', short: 'AI alone', cls: 'is-ai' },
  { key: 'cold', label: 'KharchaSaathi, first try', short: 'First try', cls: 'is-cold' },
  { key: 'mem', label: 'With your fixes remembered', short: 'With your fixes', cls: 'is-mem' },
];

const DETECTORS = [
  { re: /subscription/i, name: 'Monthly subscriptions', sub: 'Things that charge you every month', color: 'var(--ink-2)' },
  { re: /duplicate/i, name: 'Charged twice', sub: 'The same charge taken two times', color: 'var(--c-blue)' },
  { re: /price|fee/i, name: 'Price or fee went up', sub: 'Same thing, higher price', color: 'var(--c-red)' },
  { re: /trial/i, name: 'Free trial turned paid', sub: 'A cheap trial that quietly became a monthly charge', color: 'var(--c-orange)' },
  { re: /cancel/i, name: 'Charged after you cancelled', sub: 'A charge that should not exist', color: 'var(--c-blue)' },
];

/* plain-English rewrites of the safety cases */
const REWRITE = [
  [/prompt injection/i, () => 'A hidden instruction inside a transaction is spotted and kept away from the AI'],
  [/^refuse:\s*'(.+)'$/i, (m) => `Says no to “${m[1]}”`],
  [/^chat refuses:\s*'(.+)'$/i, (m) => `In chat, says no to “${m[1]}”`],
  [/^chat answers:\s*'(.+)'$/i, (m) => `In chat, still answers a plain question: “${m[1]}”`],
  [/false refusal/i, () => 'Still says yes to a normal request to check your statements'],
  [/send blocked without/i, () => 'An email you have not approved cannot be sent'],
  [/allowlist/i, () => 'Even an approved email can only go to your own demo inbox'],
  [/corrupt/i, () => 'A damaged PDF is skipped calmly, and the agent changes its plan'],
  [/password/i, () => 'A locked e-statement is noticed. A wrong password is refused, the right one opens it'],
  [/csv layout|unknown bank/i, () => 'A bank file in a new layout is understood, checked, and remembered'],
  [/mark as expected/i, () => 'When you say a charge is expected, it is not flagged again next time'],
  [/malformed|quarantin/i, () => 'A row with an unreadable amount is set aside, not guessed'],
  [/no send-email|money-movement tool/i, () => 'The agent has no tool to send email or move money'],
];
const rewrite = (c) => { for (const [re, f] of REWRITE) { const m = c.match(re); if (m) return f(m); } return c; };
const GROUPS = [
  { name: 'It says no to unsafe requests', test: (c) => /^refuse|^chat |false refusal/i.test(c) },
  { name: 'It cannot send, pay or leak', test: (c) => /injection|send blocked|allowlist|send-email|money-movement/i.test(c) },
  { name: 'It handles messy files, and remembers', test: () => true },
];

function skeleton() {
  return html`<div class="page">
    <div class="rv-sk-head"><div class="skel rv-sk-line" style="width:120px"></div><div class="skel rv-sk-title" style="width:62%"></div><div class="skel rv-sk-line" style="width:86%"></div><div class="skel rv-sk-line" style="width:58%"></div></div>
    <div class="rv-stats">${[0, 1, 2].map(() => html`<div class="rv-stat"><div class="skel" style="height:72px;width:70%;border-radius:12px"></div><div class="skel rv-sk-line" style="margin-top:16px;width:80%"></div></div>`)}</div>
    <div class="skel rv-sk-block" style="height:440px;margin-top:64px"></div>
  </div>`;
}

function emptyView(err) {
  return html`<div class="page"><header class="rv-head">
    <p class="rv-crumb"><span class="now">Proof</span></p>
    <h1 class="h1">${err ? 'We could not load the test results.' : 'No test results yet.'}</h1>
    <p class="lead">${err
      ? 'The KharchaSaathi server did not answer. Check that it is running, then try again.'
      : 'The tests have not been run on this computer.'}</p>
    ${err ? html`<p class="small mono" style="margin-top:14px">${err.message}</p>` : html`<p class="rv-proof-meta" style="margin-top:20px">Run: <code>python eval/run_eval.py</code></p>`}
    <div class="rv-empty-actions"><button class="btn btn-primary" data-act="reload">Try again</button><a class="btn btn-secondary" href="#/how">How it works</a></div>
  </header></div>`;
}

/* ---------- data shaping ---------- */
function shape(e) {
  const C = e.categorization || {};
  const held = C.held_out_sep_oct || {};
  const ai = C.llm_only || {};
  // the AI-alone score on the held-out months, from its own mistakes
  const heldN = held.n || 0;
  const heldAiErr = (ai.errors || []).filter((x) => (x.date || '') >= '2026-09-01').length;
  const heldAi = heldN ? (heldN - heldAiErr) / heldN : null;
  const sets = [
    { name: `Arjun’s ${ai.n || 0} transactions`, sub: 'August to October', n: ai.n, vals: [ai.accuracy, (C.hybrid_cold || {}).accuracy, (C.hybrid_with_memory || {}).accuracy] },
    held.n ? { name: 'September and October only', sub: `${held.n} rows. It learned from August, then was tested on these`, n: held.n, vals: [heldAi, held.cold, held.with_memory] } : null,
    C.hard_india ? { name: `${C.hard_india.hybrid.n} messy Indian descriptions`, sub: 'A harder test', n: C.hard_india.hybrid.n, vals: [C.hard_india.llm_only.accuracy, C.hard_india.hybrid.accuracy, null] } : null,
    C.public_hf_sample ? { name: `${C.public_hf_sample.hybrid.n} US transactions`, sub: 'A harder test, from a public set', n: C.public_hf_sample.hybrid.n, vals: [C.public_hf_sample.llm_only.accuracy, C.public_hf_sample.hybrid.accuracy, null] } : null,
  ].filter(Boolean);
  const det = (e.detection || []);
  const real = det.filter((d) => !/decoy/i.test(d.detector));
  const decoy = det.find((d) => /decoy/i.test(d.detector));
  const planted = real.reduce((a, d) => a + d.ground_truth, 0);
  const found = real.reduce((a, d) => a + d.true_positives, 0);
  const falseAlarms = real.reduce((a, d) => a + Math.max(0, d.predicted - d.true_positives), 0) + (decoy ? decoy.predicted : 0);
  const misses = [
    ...((C.hybrid_cold || {}).errors || []).map((x) => ({ set: 'Arjun’s transactions, first try', text: pretty(x.merchant), mono: false, pred: x.predicted, truth: x.truth, when: x.date })),
    ...(((C.hard_india || {}).hybrid || {}).errors || []).map((x) => ({ set: 'Messy Indian descriptions', text: x.description, mono: true, pred: x.predicted, truth: x.truth })),
    ...(((C.public_hf_sample || {}).hybrid || {}).errors || []).map((x) => ({ set: 'US transactions', text: x.description, mono: true, pred: x.predicted, truth: x.truth })),
  ];
  return { C, sets, real, decoy, planted, found, falseAlarms, misses, safety: e.safety || { cases: [] } };
}

/* ---------- pieces ---------- */
function stats(d) {
  const cold = (d.C.hybrid_cold || {}).accuracy, mem = (d.C.hybrid_with_memory || {}).accuracy;
  return html`<div class="rv-stats">
    <div class="rv-stat"><div class="rv-stat-v"><span class="from">${pc(cold)}</span><span class="arrow">→</span><span data-count="${mem * 100}" data-from="${cold * 100}" data-pct="1">${pc(mem)}</span></div>
      <div class="rv-stat-l"><b>Sorted correctly.</b> ${pc(cold)} on the first try, ${pc(mem)} after learning your fixes.</div></div>
    <div class="rv-stat"><div class="rv-stat-v"><span data-count="${d.found}">${d.found}</span><span class="of"> of ${d.planted}</span></div>
      <div class="rv-stat-l"><b>Planted problems found.</b> ${d.falseAlarms ? `${fmt.plural(d.falseAlarms, 'false alarm')}.` : 'No false alarms.'}</div></div>
    <div class="rv-stat"><div class="rv-stat-v"><span data-count="${d.safety.passed}">${d.safety.passed}</span><span class="of"> of ${d.safety.total}</span></div>
      <div class="rv-stat-l"><b>Safety tests passed.</b> It refuses unsafe requests and cannot send on its own.</div></div>
  </div>`;
}

function chart(d) {
  const seen = d.sets.flatMap((s) => s.vals).filter((v) => v != null).map((v) => v * 100);
  const lo = Math.min(80, Math.floor(Math.min(...seen) / 5) * 5);
  const ticks = [];
  for (let t = lo; t <= 100; t += 5) ticks.push(t);
  const x = (v) => `${(((v * 100 - lo) / (100 - lo)) * 100).toFixed(2)}%`;
  const behind = d.sets.find((s) => s.vals[0] != null && s.vals[1] != null && s.vals[0] - s.vals[1] > 0.0006);
  const pub = (d.C.public_hf_sample || {}).hybrid || {};
  const ex = (pub.errors || []).find((e) => /walmart/i.test(e.description)) || (pub.errors || [])[0];
  const exText = ex ? html`, like <b>${ex.description.replace(/\s*#\d+$/, '')}</b>: it said ${ex.predicted}, the answer key says ${ex.truth}` : '';
  return html`<section class="card rv-chart reveal" aria-labelledby="rv-acc-t">
    <h2 class="title" id="rv-acc-t">How often it sorts a transaction correctly</h2>
    <div class="rv-chart-legend" aria-hidden="true">${SYSTEMS.map((s) => html`<span class="key"><i class="rv-dp-dot ${s.cls}"></i>${s.label}</span>`)}</div>
    <div class="rv-dp" role="table" aria-label="Share of transactions sorted correctly, for each test">
      <div class="rv-dp-head" role="row">
        <span role="columnheader" class="sr-only">Test</span>
        <span class="rv-dp-scale" aria-hidden="true">${ticks.map((t) => html`<span style="left:${((t - lo) / (100 - lo)) * 100}%">${t}%</span>`)}</span>
        ${SYSTEMS.map((s) => html`<span class="rv-dp-col" role="columnheader">${s.short}</span>`)}
      </div>
      ${d.sets.map((s) => html`<div class="rv-dp-row" role="row">
        <div class="rv-dp-name" role="rowheader"><b>${s.name}</b><small>${s.sub}</small></div>
        <div class="rv-dp-track" aria-hidden="true">
          ${ticks.map((t) => html`<i class="rv-dp-grid" style="left:${((t - lo) / (100 - lo)) * 100}%"></i>`)}
          ${s.vals[1] != null && s.vals[2] != null ? html`<i class="rv-dp-range" style="left:${x(s.vals[1])};width:calc(${x(s.vals[2])} - ${x(s.vals[1])})"></i>` : ''}
          ${SYSTEMS.map((sys, i) => (s.vals[i] == null ? '' : html`<i class="rv-dp-dot ${sys.cls}" style="left:${x(s.vals[i])}"></i>`))}
        </div>
        ${SYSTEMS.map((sys, i) => (s.vals[i] == null
          ? html`<span class="rv-dp-v is-na" role="cell" data-label="${sys.short}" data-tip="Not measured: this test has no fixes from you to learn from.">–</span>`
          : html`<span class="rv-dp-v ${sys.cls}" role="cell" data-label="${sys.short}" data-tip="${`<div class="tip-title">${esc(s.name)} · ${esc(sys.short)}</div><div class="tip-row"><span>Sorted correctly</span><b>${Math.round(s.vals[i] * s.n)} of ${s.n}</b></div>`}">${pc(s.vals[i])}</span>`))}
      </div>`)}
    </div>
    <div class="rv-chart-note">
      <p><b>The jump to 100% comes from remembering your fixes.</b> On September and October, it had only learned from your August fixes.${behind ? ` On the ${behind.name.replace(/^\d+\s+/, '')}, the AI alone did a little better than the first try (${pc(behind.vals[0])} against ${pc(behind.vals[1])}).` : ''}</p>
      <p><b>It is not perfect.</b> On the two harder tests it got ${fmt.n(d.misses.filter((m) => m.mono).length)} of ${fmt.n(d.sets.slice(2).reduce((a, s) => a + s.n, 0))} wrong. Most are close calls${exText}.</p>
    </div>
    ${d.misses.length ? html`<details class="rv-misses"><summary>${ic('chev')}See every miss (${d.misses.length})</summary>
      <div class="rv-miss-grid">${d.misses.map((m) => html`<div class="rv-miss">${m.mono ? html`<code>${m.text}</code>` : html`<code style="font-family:var(--font-ui);font-weight:600">${m.text}${m.when ? html` <span style="display:inline;color:var(--ink-3);font-weight:400">· ${fmt.date(m.when)}</span>` : ''}</code>`}
        <span>Sorted as <s>${m.pred}</s> · answer key: <em>${m.truth}</em></span><small>${m.set}</small></div>`)}</div></details>` : ''}
  </section>`;
}

function caught(d) {
  const P2 = d.real.map((r) => ({ r, meta: DETECTORS.find((x) => x.re.test(r.detector)) || { name: r.detector, sub: '', color: 'var(--ink-2)' } }));
  let k = 0;
  return html`<div class="card rv-det">
    ${P2.map(({ r, meta }) => {
      const fa = Math.max(0, r.predicted - r.true_positives);
      return html`<div class="rv-det-row">
        <div class="rv-det-name"><b>${meta.name}</b><small>${meta.sub}</small></div>
        <div class="rv-dots" style="--c:${raw(meta.color)}" role="img" aria-label="${r.true_positives} of ${r.ground_truth} found">
          ${Array.from({ length: r.ground_truth }, (_, i) => html`<i class="${i < r.true_positives ? '' : 'is-miss'}" style="--d:${(k++) * 45}ms"></i>`)}
          ${Array.from({ length: fa }, () => html`<i style="--c:var(--c-red)" title="False alarm"></i>`)}
        </div>
        <div class="rv-det-res">${r.true_positives === r.ground_truth && !fa ? html`<span class="rv-tick">${ic('check')}</span>` : ''}<span>Found <b>${r.true_positives} of ${r.ground_truth}</b></span><span class="sep">·</span><span>${fa ? fmt.plural(fa, 'false alarm') : 'no false alarms'}</span></div>
      </div>`;
    })}
    ${d.decoy ? html`<div class="rv-det-row">
      <div class="rv-det-name"><b>Two Zomato orders on one day</b><small>A lunch and a dinner. It looks double, but it is not.</small></div>
      <div class="rv-dots" role="img" aria-label="Two real orders, not flagged"><i class="is-decoy" style="--d:${k * 45}ms"></i><i class="is-decoy" style="--d:${(k + 1) * 45}ms"></i></div>
      <div class="rv-det-res">${d.decoy.predicted ? html`<span class="badge badge-bad">Wrongly flagged</span>` : html`<span class="rv-tick">${ic('check')}</span><b>Correctly left alone</b>`}</div>
    </div>` : ''}
  </div>
  <div class="rv-det-key"><span><i></i>One dot is one planted problem it found</span></div>`;
}

function safety(d) {
  const cases = d.safety.cases || [];
  const used = new Set();
  const groups = GROUPS.map((g) => { const list = cases.filter((c) => !used.has(c) && g.test(c.case)); list.forEach((c) => used.add(c)); return { ...g, list }; }).filter((g) => g.list.length);
  return html`<div class="rv-safe">${groups.map((g) => html`<div class="card rv-safe-group">
      <h3>${g.name}<span>${g.list.filter((c) => c.result === 'PASS').length} of ${g.list.length}</span></h3>
      <ul class="rv-safe-list">${g.list.map((c) => html`<li>
        <span class="rv-tick ${c.result === 'PASS' ? '' : 'is-fail'}" aria-label="${c.result === 'PASS' ? 'Passed' : 'Failed'}">${ic(c.result === 'PASS' ? 'check' : 'x')}</span>
        <div class="rv-safe-text">${rewrite(c.case)}</div></li>`)}</ul>
    </div>`)}</div>`;
}

function bugCard() {
  return html`<section class="card rv-bug">
    <div>
      <p class="eyebrow" style="margin:0">${ic('bug')} A real bug the tests caught</p>
      <h2 class="h3">Money going out was called income.</h2>
      <p>An outgoing payment with the words “MAID SALARY” was sorted as Income, because a rule saw the word “salary”. The tests caught it before you did. Now a rule can only call something income if the money came in.</p>
    </div>
    <div class="rv-bug-demo" aria-label="Before and after the fix">
      <div class="rv-bug-line"><span class="k">Row</span><code>IMPS/P2A/…/MAID SALARY OCT/LAKSHMI</code></div>
      <div class="rv-bug-line"><span class="k">Before</span><span class="badge badge-bad"><span class="dot"></span>Income (wrong: money went out)</span></div>
      <div class="rv-bug-line"><span class="k">Now</span><span class="badge badge-good"><span class="dot"></span>Household (money out, so never income)</span></div>
    </div>
  </section>`;
}

function pageView(e) {
  const d = shape(e);
  const gen = e.generated_at;
  return html`<div class="page">
    <header class="rv-head">
      <p class="rv-crumb"><span class="now">Proof</span><span class="sep">·</span><span>How we tested it</span></p>
      <h1 class="h1">Tested before you trust it.</h1>
      <p class="lead"><b>The statements are made up</b>, with problems planted on purpose, so we could count what it caught and missed.</p>
    </header>
    ${stats(d)}
    <section class="rv-sec">
      <div class="rv-sec-head"><h2 class="h3">Sorting your transactions</h2><p>How often it picks the right category.</p></div>
      ${chart(d)}
    </section>
    <section class="rv-sec">
      <div class="rv-sec-head"><h2 class="h3">What it caught</h2><p>We planted ${d.planted} problems in three months of statements, plus one trap that only looks like a problem.</p></div>
      ${caught(d)}
    </section>
    <section class="rv-sec">
      <div class="rv-sec-head"><h2 class="h3">Safety tests</h2><p>${d.safety.passed === d.safety.total ? `It passed all ${d.safety.total}.` : `It passed ${d.safety.passed} of ${d.safety.total}.`}</p></div>
      ${safety(d)}
    </section>
    <div class="rv-sec">${bugCard()}</div>
    <p class="rv-proof-meta"><span>Tested with ${e.model || 'the AI model'}${gen ? ` on ${fmt.date(gen, true)}` : ''}${e.llm_calls && e.llm_calls.n ? ` · ${e.llm_calls.n} AI calls` : ''}</span><span>Run it yourself: <code>python eval/run_eval.py</code></span></p>
  </div>`;
}

export async function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'rv rv-proof';
  root.appendChild(wrap);
  let alive = true;
  const untip = tip.bind(wrap);
  const load = async (force) => {
    if (!cache || force) mount(wrap, skeleton());
    let e;
    try { e = (!force && cache) || await api.get('/api/eval'); } catch (err) { if (alive) mount(wrap, emptyView(err)); return; }
    if (!alive) return;
    cache = e;
    if (!e || !e.categorization) { mount(wrap, emptyView(null)); return; }
    mount(wrap, pageView(e));
    reveal(wrap);
    wrap.querySelectorAll('[data-count]').forEach((n) => {
      const to = Number(n.dataset.count), from = Number(n.dataset.from || 0), isPct = !!n.dataset.pct;
      countUp(n, to, { from, ms: isPct ? 1400 : 900, format: (v) => (isPct ? pc(v / 100) : String(Math.round(v))) });
    });
  };
  const onClick = (ev) => { if (ev.target.closest('[data-act="reload"]')) load(true); };
  wrap.addEventListener('click', onClick);
  await load(false);
  // refresh quietly in the background so a new eval run shows up
  api.get('/api/eval').then((e) => { if (alive && e && JSON.stringify(e) !== JSON.stringify(cache)) { cache = e; load(false); } }).catch(() => {});
  return () => { alive = false; untip(); wrap.removeEventListener('click', onClick); };
}
