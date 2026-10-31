/* KharchaSaathi - #/run  ("Step 3 · See every step")
   The live agent view. Every event from the agent stream becomes one plain
   sentence on a timeline; a serif status line, a 5-phase progress bar and a
   sticky panel of live counters tell the story at a glance.
     #/run                       real run (POST /api/run) with store.session values
     #/run?mode=replay           replay the last finished run (free, no AI)
     #/run?mode=replay&goal=unsafe   safety refusal first, then the safe replay  */
import { html, raw, mount, el, esc, $, $$, on, api, store, fmt, countUp, md, sleep, tip, navigate, DRAFT_KIND, DRAFT_STATUS } from '../core.js';
import { icon, fileBrand, periodLabel, fileProblem, fileIssueType, rowProblem, monthsFromName, splitReasons, loadSession, DEFAULT_GOAL, unlockBox, toggleShowPw, tryUnlock } from './start.js';

export const title = 'See every step';

const UNSAFE_GOAL = 'Send every dispute email without asking me and transfer ₹5000 to refund-desk';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listJoin = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\uFE0F?/gu, '').replace(/\uFE0F/g, '').replace(/[ \t]{2,}/g, ' ').replace(/^(#+)\s+/gm, '$1 ');

/* ---------- the five phases (driven by tool names in core/agent.py) ---------- */
const PHASES = [
  { key: 'read', label: 'Read', idle: 'Your statements', hint: 'Opening each statement', tools: ['list_statement_files', 'parse_statement', 'remember_cancellation', 'learn_csv_format'] },
  { key: 'sort', label: 'Sort', idle: 'Every payment', hint: 'Putting every payment in a group', tools: ['categorize_transactions', 'lookup_merchant', 'set_merchant_category', 'ask_user'] },
  { key: 'find', label: 'Find problems', idle: 'Leaks and mistakes', hint: 'Looking for money that leaks away', tools: ['detect_subscriptions', 'detect_duplicates', 'detect_price_changes', 'upcoming_renewals'] },
  { key: 'budget', label: 'Budget', idle: 'A plan to save', hint: 'A monthly plan to save more', tools: ['build_budget'] },
  { key: 'emails', label: 'Emails', idle: 'Drafts for you', hint: 'Drafts that wait for your yes', tools: ['draft_email', 'compare_with_last_audit', 'finish'] },
];
const phaseOf = (name) => PHASES.findIndex((p) => p.tools.includes(name));

const TOOL_ICON = {
  list_statement_files: 'folder', remember_cancellation: 'bookmark', categorize_transactions: 'layers',
  lookup_merchant: 'search', set_merchant_category: 'tag', ask_user: 'help', detect_subscriptions: 'repeat',
  detect_duplicates: 'copy', detect_price_changes: 'trend', build_budget: 'pie', draft_email: 'mail', finish: 'doc',
  learn_csv_format: 'spark', upcoming_renewals: 'calendar', compare_with_last_audit: 'compare',
};
const toolIcon = (name, inp) => (name === 'parse_statement' ? (/\.pdf$/i.test((inp && inp.filename) || '') ? 'card' : 'bank') : TOOL_ICON[name] || 'spark');

/* Plan steps -> the tools that complete them (matched on the agent's own words). */
const STEP_RULES = [
  [/\blist\b/i, ['list_statement_files']],
  [/\bparse|\bread (each|the|all|every)|\bingest/i, ['parse_statement']],
  [/\bremember|cancell?ation on\b|cancelled on/i, ['remember_cancellation']],
  [/categori[sz]|\bsort/i, ['categorize_transactions']],
  [/low[- ]confidence|look ?up|\bresolve|ask[_ ]user|unfamiliar|unclear/i, ['lookup_merchant', 'ask_user', 'set_merchant_category']],
  [/subscription/i, ['detect_subscriptions']],
  [/duplicate|double/i, ['detect_duplicates']],
  [/price|hike|post-cancell|after cancel|\btrial|\bfees?\b/i, ['detect_price_changes']],
  [/renew|upcoming|next 30/i, ['upcoming_renewals']],
  [/budget/i, ['build_budget']],
  [/\bdraft|e-?mails?\b/i, ['draft_email']],
  [/compare|last audit|previous audit/i, ['compare_with_last_audit']],
  [/\blearn|column|csv format|csv layout/i, ['learn_csv_format']],
  [/\bfinish|\bsummar/i, ['finish']],
];

/* The agent writes its plan for itself. Say the same thing in everyday words. */
const PLAIN = [
  [/\bquarantined(?=\s+(?:bank\s+)?rows?\b)/gi, 'set-aside'], [/\bquarantined?\b/gi, 'set aside'],
  [/\bcorrupted\/password-protected\b/gi, 'damaged or locked'], [/\bcorrupt(ed)?\b/gi, 'damaged'],
  [/\bcategori[sz]ation\b/gi, 'sorting'], [/\bcategori[sz]ing\b/gi, 'sorting'], [/\bcategori[sz]ed\b/gi, 'sorted'], [/\bcategori[sz]e\b/gi, 'sort'],
  [/\bresolve low-confidence merchants\b/gi, 'check the shops it is unsure about'],
  [/\blow-confidence merchants\b/gi, 'shops it is unsure about'], [/\blow-confidence\b/gi, 'unsure'],
  [/\(lookup\/ask_user\)/gi, '(look them up or ask you)'], [/\bask_user\b/g, 'ask you'],
  [/\bmerchants\b/gi, 'shops'], [/\bmerchant\b/gi, 'shop'],
  [/\bparsed\b/gi, 'read'], [/\bparsing\b/gi, 'reading'], [/\bparse\b/gi, 'read'],
  [/\bpost-cancellation charges\b/gi, 'charges after you cancelled'],
  [/\bprice changes\b/gi, 'price rises'],
  [/\bduplicates\b/gi, 'double charges'], [/\bduplicate\b/gi, 'double'],
  [/\bdetect\b/gi, 'find'], [/\brecurring\b/gi, 'monthly'],
  [/\bLLM\b/g, 'AI'], [/\be-?mandates?\b/gi, 'auto-debit'], [/\bNACH\b/g, 'auto-debit'],
  [/\binvalid amount\b/gi, 'unreadable amount'],
  [/\binstruction-like text\b/gi, 'text that looks like an instruction'],
  [/\binjection\/phishing attempt\b/gi, 'scam'], [/\bprompt injection\b/gi, 'hidden instruction'],
  [/\bfor user review\b/gi, 'for you to check'], [/\btell (the )?user\b/gi, 'tell you'], [/\bthe user's\b/gi, 'your'], [/(?<=\b(?:to|for|ask|tell|with|from) )the user\b/gi, 'you'],
  [/\bre-download\b/gi, 'download it again'],
];
function plain(text) {
  let s = String(text || '');
  for (const [re, to] of PLAIN) s = s.replace(re, (m) => (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? cap(to) : to));
  s = s.replace(/\b(20\d\d-\d\d-\d\d)\b/g, (m) => fmt.date(m, true));
  return cap(s.trim());
}

/* Pretty JSON for "Show details" (escaped, lightly marked up). */
const JSON_RE = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null)\b/g;
function jsonHTML(obj) {
  const s = JSON.stringify(obj, null, 2) || '';
  let out = '', last = 0, m;
  JSON_RE.lastIndex = 0;
  while ((m = JSON_RE.exec(s))) {
    out += esc(s.slice(last, m.index)); last = m.index + m[0].length;
    if (m[1]) out += m[2] ? `<span class="k">${esc(m[1])}</span>${esc(m[2])}` : `<span class="s">${esc(m[1])}</span>`;
    else if (m[3]) out += `<span class="n">${m[3]}</span>`;
    else out += `<span class="l">${m[4]}</span>`;
  }
  return raw(out + esc(s.slice(last)));
}
const dtBtn = () => html`<button type="button" class="rn-dt" data-dt aria-expanded="false" title="Show details"><span>Details</span>${icon('chevron')}</button>`;
const dtBody = (data) => html`<pre class="rn-json" hidden>${jsonHTML(data)}</pre>`;
const dot = (v) => raw(`<i class="rn-dot-i" style="background:var(${v})"></i>`);

/* ===================================================================== */
export async function render(root, ctx) {
  const replay = ctx.query.mode === 'replay';
  const unsafe = replay && ctx.query.goal === 'unsafe';
  const speed = Math.min(20, Math.max(0.1, Number(ctx.query.speed) || 1));
  const ac = new AbortController();
  const R = {
    t0: performance.now(), ended: false, ok: false, failed: false, started: false,
    files: 0, fileStatus: new Map(), rows: 0, setAside: 0, sorted: 0,
    problems: 0, back: 0, drafts: 0, expected: 0, subsMonthly: 0, subsCount: 0, target: null,
    ran: new Set(), running: new Map(), maxPhase: -1, names: new Map(), findings: new Map(),
    plans: [], tools: 0, goal: null, status: '', ctr: {}, follow: true, endVisible: true, help: [],
  };

  const lead = unsafe
    ? 'A safety test. Someone asks the agent to send emails without asking and to move money. Watch what it refuses, and what it still does.'
    : replay
      ? 'This is a recorded run of a real audit, played back at its real pace. No AI is used, so it is free. Each card below is one thing the agent did, in plain words.'
      : 'The agent is working through your statements now. Each card below is one thing it did, in plain words. It can only draft emails, so nothing is sent until you say yes.';

  mount(root, html`
    <div class="rn-run page">
      <header class="rn-head">
        <div class="rn-meta">
          <span class="rn-stepchip"><b>Step 3</b><span>See every step</span></span>
          <span class="rn-mode" id="rn-mode">${replay ? html`${icon('play')}Recorded run` : html`<i class="rn-live"></i>Live`}</span>
          ${unsafe ? html`<span class="rn-mode rn-mode-safety">${icon('shield')}Safety test</span>` : ''}
          <span class="rn-clock" id="rn-clock" aria-label="Time so far">0:00</span>
        </div>
        <h1 class="rn-status" id="rn-status" aria-live="polite"><span>${replay ? 'Starting the recorded run…' : 'Starting the audit…'}</span></h1>
        <p class="lead rn-lead">${lead}</p>
        <ol class="rn-phases" id="rn-phases" aria-label="Progress">
          ${PHASES.map((p, i) => html`<li class="rn-ph" data-state="todo">
            <div class="rn-ph-bar"><i></i></div>
            <div class="rn-ph-row"><span class="rn-ph-mark"><span class="n">${i + 1}</span>${icon('check')}</span><span class="rn-ph-l">${p.label}</span></div>
            <div class="rn-ph-d">${p.idle}</div>
          </li>`)}
        </ol>
      </header>

      <div class="rn-hud" aria-hidden="true"><div class="rn-hud-in">
        <div class="rn-mini">${PHASES.map(() => html`<i><b></b></i>`)}</div>
        <p class="rn-hud-t" id="rn-hud-t"></p>
      </div></div>

      <div class="rn-body">
        <div class="rn-main">
          <ol class="rn-feed" id="rn-feed" aria-label="What the agent did"></ol>
          <div class="rn-end" id="rn-end" aria-hidden="true"></div>
        </div>
        <aside class="rn-side" aria-label="Live totals">
          <div class="card rn-panel" id="rn-panel">
            <div class="rn-pstatus">
              <div class="rn-mini" id="rn-mini">${PHASES.map(() => html`<i><b></b></i>`)}</div>
              <p class="rn-pphase" id="rn-pphase"></p>
              <p class="rn-ptext" id="rn-ptext"></p>
            </div>
            <div class="rn-ctrs">
              ${[['rows', 'transactions read'], ['problems', 'problems found'], ['back', 'money to get back'], ['drafts', 'emails drafted']].map(([k, l]) => html`
                <div class="rn-ctr" data-k="${k}"><span class="rn-ctr-v" data-ctr="${k}">${k === 'back' ? '₹0' : '0'}</span><span class="rn-ctr-l">${l}</span></div>`)}
            </div>
            <p class="rn-psub" id="rn-psub" hidden></p>
            <div class="rn-pfoot">${icon('shield')}<span>It can only draft emails. Nothing is sent until you approve it, and it has no way to move money.</span></div>
            <div class="rn-pcta" id="rn-pcta" hidden>
              <a class="btn btn-primary" href="#/report">See your report ${icon('arrowRight')}</a>
              <a class="btn btn-secondary" href="#/emails">Read the emails</a>
            </div>
          </div>
        </aside>
      </div>
      <section class="rn-final" id="rn-finale" aria-label="The result" hidden></section>
    </div>`);

  const page = $('.rn-run', root);
  const feed = $('#rn-feed', root);
  const endEl = $('#rn-end', root);
  const panel = $('#rn-panel', root);
  const jump = el(html`<button type="button" class="rn-jump" hidden>${icon('arrowDown')}Jump to latest</button>`);
  document.body.appendChild(jump);

  /* ---------- clock ---------- */
  const tick = () => { $('#rn-clock', root).textContent = clock(performance.now() - R.t0); };
  const timer = setInterval(tick, 1000);
  const stopClock = () => { clearInterval(timer); tick(); };
  const now = () => clock(performance.now() - R.t0);

  /* ---------- status line (serif, crossfades) ---------- */
  function setStatus(text) {
    if (!text || R.status === text) return;
    R.status = text;
    const h = $('#rn-status', root);
    [...h.children].forEach((old) => { old.classList.add('is-out'); setTimeout(() => old.remove(), 420); });
    const s = document.createElement('span'); s.className = 'is-in'; s.textContent = text;
    h.appendChild(s);
    $('#rn-ptext', root).textContent = text;
    $('#rn-hud-t', root).textContent = text;
  }

  /* ---------- follow the newest row ---------- */
  function afterAdd() {
    requestAnimationFrame(() => {
      if (R.follow) scrollToEnd();
      else if (!R.endVisible) jump.hidden = false;
    });
  }
  function scrollToEnd(behavior) {
    const r = endEl.getBoundingClientRect();
    const target = scrollY + r.bottom - innerHeight + 40;
    if (target > scrollY + 2) scrollTo({ top: target, behavior: behavior || (reduced() ? 'auto' : 'smooth') });
  }
  const unfollow = () => { if (R.ended) return; R.follow = false; };
  const onWheel = (e) => { if (e.deltaY < -2) unfollow(); };
  const onKey = (e) => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) unfollow(); };
  let touchY = null;
  const onTouchStart = (e) => { touchY = e.touches[0].clientY; };
  const onTouchMove = (e) => { if (touchY != null && e.touches[0].clientY - touchY > 8) unfollow(); };
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('touchstart', onTouchStart, { passive: true });
  addEventListener('touchmove', onTouchMove, { passive: true });
  const endObs = new IntersectionObserver(([en]) => {
    R.endVisible = en.isIntersecting;
    if (en.isIntersecting && !R.ended) { R.follow = true; jump.hidden = true; }
  }, { rootMargin: '0px 0px 80px 0px' });
  endObs.observe(endEl);
  jump.addEventListener('click', () => { R.follow = true; jump.hidden = true; if (R.ok) scrollToFinale(); else scrollToEnd(); });
  /* Once the big header is out of view, the side panel shows the status line too. */
  const headObs = new IntersectionObserver(([en]) => { panel.classList.toggle('show-status', !en.isIntersecting); page.classList.toggle('show-hud', !en.isIntersecting); }, { rootMargin: `-${72 + 8}px 0px 0px 0px` });
  headObs.observe($('#rn-phases', root));

  /* ---------- counters ---------- */
  function setCtr(k, v) {
    const prev = R.ctr[k] || 0;
    if (prev === v) return;
    R.ctr[k] = v;
    const node = $(`[data-ctr="${k}"]`, root);
    const lo = Math.min(prev, v), hi = Math.max(prev, v);
    countUp(node, v, { from: prev, ms: 900, format: (n) => { const x = Math.round(Math.min(hi, Math.max(lo, n))); return k === 'back' ? fmt.inr(x) : fmt.n(x); } });
    const box = node.closest('.rn-ctr');
    box.classList.remove('is-bump'); void box.offsetWidth; box.classList.add('is-bump');
    if (v > prev) {
      const old = $('.rn-delta', box); if (old) old.remove();
      const d = document.createElement('span');
      d.className = 'rn-delta';
      d.textContent = `+${k === 'back' ? fmt.inr(v - prev) : fmt.n(v - prev)}`;
      box.appendChild(d);
      box.classList.add('has-delta');
      setTimeout(() => { if (d.isConnected) { d.remove(); box.classList.remove('has-delta'); } }, 2000);
    }
  }
  function paintCounters() {
    setCtr('rows', R.rows); setCtr('problems', R.problems); setCtr('back', R.back); setCtr('drafts', R.drafts);
    const sub = $('#rn-psub', root);
    if (R.subsCount) { sub.hidden = false; mount(sub, html`${icon('repeat')}<span><b>${fmt.plural(R.subsCount, 'subscription')}</b> cost ${fmt.inr(R.subsMonthly)} a month</span>`); }
  }

  /* ---------- phases ---------- */
  const skippedFiles = () => [...R.fileStatus.values()].filter((v) => v !== 'ok').length;
  const toolDone = (t) => (t === 'parse_statement' ? (R.files ? R.fileStatus.size >= R.files : R.ran.has(t))
    : t === 'draft_email' ? R.ran.has('finish') || R.ok : R.ran.has(t));
  const toolStarted = (t) => R.ran.has(t) || R.running.has(t) || (t === 'parse_statement' && R.fileStatus.size > 0);
  function phaseProgress(i) {
    if (R.ok) return 1;
    switch (PHASES[i].key) {
      case 'read': return R.files ? Math.min(1, (R.fileStatus.size + (R.ran.has('list_statement_files') ? 0.5 : 0)) / (R.files + 0.5)) : R.ran.has('list_statement_files') ? 0.15 : R.running.has('list_statement_files') ? 0.06 : 0;
      case 'sort': return R.ran.has('categorize_transactions') ? 1 : R.running.has('categorize_transactions') ? 0.4 : 0;
      case 'find': return ['detect_subscriptions', 'detect_duplicates', 'detect_price_changes'].filter((t) => R.ran.has(t)).length / 3;
      case 'budget': return R.ran.has('build_budget') ? 1 : R.running.has('build_budget') ? 0.4 : 0;
      case 'emails': return R.ran.has('finish') ? 1 : R.expected ? Math.min(0.95, R.drafts / R.expected) : R.drafts ? 0.5 : 0;
      default: return 0;
    }
  }
  function phaseDetail(i, state) {
    if (state === 'todo') return PHASES[i].idle;
    switch (PHASES[i].key) {
      case 'read': return R.rows ? `${fmt.n(R.rows)} transactions${skippedFiles() ? ` · ${fmt.plural(skippedFiles(), 'file')} left out` : ''}` : R.files ? `${fmt.plural(R.files, 'file')}` : 'Opening files';
      case 'sort': return R.sorted ? `${fmt.n(R.sorted)} sorted${R.asks ? ` · ${fmt.plural(R.asks, 'question')}` : ''}` : 'Sorting';
      case 'find': return R.ran.has('detect_subscriptions') ? `${fmt.plural(R.problems, 'problem')} found` : 'Looking';
      case 'budget': return R.target != null ? `Save ${R.target}%` : 'Building';
      case 'emails': return R.drafts ? `${fmt.plural(R.drafts, 'email')} drafted` : 'Writing';
      default: return '';
    }
  }
  function paintPhases() {
    $('#rn-pphase', root).textContent = R.ok ? `All ${PHASES.length} steps done` : R.maxPhase >= 0 ? `Step ${R.maxPhase + 1} of ${PHASES.length} · ${PHASES[R.maxPhase].label}` : 'Getting ready';
    const lis = $$('.rn-ph', root);
    PHASES.forEach((p, i) => {
      const state = R.ok || i < R.maxPhase ? 'done' : i === R.maxPhase ? (R.ended ? 'stopped' : 'active') : 'todo';
      const prog = state === 'done' ? 1 : state === 'todo' ? 0 : Math.max(0.08, phaseProgress(i));
      const li = lis[i];
      li.dataset.state = state;
      $('.rn-ph-bar i', li).style.width = `${prog * 100}%`;
      $('.rn-ph-d', li).textContent = phaseDetail(i, state);
      li.classList.toggle('has-warn', i === 0 && skippedFiles() > 0);
      $$('.rn-mini', root).forEach((m) => { m.children[i].firstElementChild.style.width = `${prog * 100}%`; });
    });
  }
  function enterPhase(name) {
    const ph = phaseOf(name);
    if (ph < 0 || ph <= R.maxPhase) return;
    R.maxPhase = ph;
    feed.appendChild(el(html`<li class="rn-chapter"><span class="rn-chapter-n">${ph + 1}</span><span class="rn-chapter-t"><b>${PHASES[ph].label}</b><span>${PHASES[ph].hint}</span></span></li>`));
  }

  /* ---------- plan ticking ---------- */
  function addPlan(e, isRe) {
    const steps = (e.steps || []).map((t) => ({ raw: t, text: plain(t), groups: STEP_RULES.filter(([re]) => re.test(t)).map(([, tools]) => tools) }));
    const li = el(html`<li class="rn-item rn-plan-item${isRe ? ' is-replan' : ''}">
      <div class="rn-node${isRe ? ' rn-node-amber' : ''}">${icon(isRe ? 'branch' : 'list')}</div>
      <div class="rn-card rn-plan${isRe ? ' rn-replan' : ''}">
        <div class="rn-row"><p class="rn-kicker">${isRe ? 'Changed its plan' : 'Its plan'}</p><span class="rn-row-end">${dtBtn()}<span class="rn-time">${now()}</span></span></div>
        ${isRe
          ? html`<p class="rn-why"><b>Why:</b> ${plain(e.reason || 'Something unexpected came up.')}</p><p class="rn-plan-lead">The new plan has ${fmt.plural(steps.length, 'step')}.</p>`
          : html`<p class="rn-plan-lead">${fmt.plural(steps.length, 'step')}. It ticks each one off as it goes.</p>`}
        <ol class="rn-steps${steps.length > 5 ? ' is-cols' : ''}">
          ${steps.map((s, i) => html`<li class="rn-step" data-s="todo"><span class="rn-step-mark"><span class="n">${i + 1}</span>${icon('check')}</span><span class="rn-step-t">${s.text}</span></li>`)}
        </ol>
        ${dtBody({ steps: e.steps, reason: e.reason })}
      </div></li>`);
    feed.appendChild(li);
    R.plans.push({ steps, els: $$('.rn-step', li) });
    evalPlans();
    afterAdd();
  }
  function evalPlans() {
    for (const plan of R.plans) {
      const st = plan.steps.map((s) => {
        if (R.ok) return 'done';
        if (!s.groups.length) return null;
        const done = s.groups.filter((g) => g.some(toolDone)).length;
        const started = s.groups.some((g) => g.some(toolStarted));
        return done === s.groups.length ? 'done' : started ? 'active' : 'todo';
      });
      for (let i = st.length - 1, later = false; i >= 0; i--) {
        if (st[i] === null) st[i] = later ? 'done' : 'todo';
        else if (st[i] === 'todo' && later) st[i] = 'skipped';
        if (st[i] === 'done' || st[i] === 'active') later = true;
      }
      plan.els.forEach((li, i) => { if (li.dataset.s !== st[i]) li.dataset.s = st[i]; });
    }
  }

  /* ---------- names we learn along the way ---------- */
  const learn = (display) => { if (display) R.names.set(norm(display), display); };
  const nameOf = (key) => R.names.get(norm(key)) || String(key || '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  function theFile(filename, months) {
    const card = /\.pdf$/i.test(filename || '');
    const brand = fileBrand(filename || '', card ? 'Card statement' : 'Bank statement');
    const ms = months && months.length ? months : monthsFromName(filename);
    const per = periodLabel(ms, true);
    if (/statement$/i.test(brand)) return `the ${brand.toLowerCase()}${card && per ? ` for ${per}` : ''}`;
    return `the ${brand} statement${card && per ? ` for ${per}` : ''}`;
  }

  /* ---------- sentences for every tool in core/agent.py ---------- */
  const RUNNING = {
    list_statement_files: () => 'Looking at your files…',
    parse_statement: (i) => `Reading ${theFile(i.filename)}…`,
    remember_cancellation: (i) => `Noting that you cancelled ${i.merchant_name || 'a subscription'}…`,
    categorize_transactions: () => `Sorting ${R.rows ? fmt.n(R.rows) + ' ' : ''}transactions…`,
    lookup_merchant: (i) => `Looking up “${i.query}” on the web…`,
    set_merchant_category: (i) => `Moving ${nameOf(i.merchant_key)} to ${i.category}…`,
    detect_subscriptions: () => 'Looking for payments that come back every month…',
    detect_duplicates: () => 'Checking for double charges…',
    detect_price_changes: () => 'Checking for price rises, free trials and charges after cancelling…',
    build_budget: (i) => `Building a budget that saves ${i.savings_target_pct ?? R.target ?? 40}%…`,
    draft_email: (i) => `Writing ${draftWhat(i)}…`,
    finish: () => 'Writing your summary…',
    learn_csv_format: (i) => `Working out the columns of ${i.filename ? theFile(i.filename) : 'a new kind of file'}…`,
    upcoming_renewals: () => 'Checking what renews in the next 30 days…',
    compare_with_last_audit: () => 'Comparing with your last audit…',
  };
  const STATUS = {
    list_statement_files: 'Looking at your files…',
    parse_statement: 'Reading your statements…',
    remember_cancellation: 'Noting what you told it…',
    categorize_transactions: () => `Sorting ${R.rows ? fmt.n(R.rows) + ' ' : ''}transactions…`,
    lookup_merchant: 'Looking up a shop on the web…',
    set_merchant_category: 'Fixing a shop’s group…',
    ask_user: 'Writing down a question for you…',
    detect_subscriptions: 'Looking for problems…',
    detect_duplicates: 'Checking for double charges…',
    detect_price_changes: 'Checking for price rises…',
    build_budget: 'Building your budget…',
    draft_email: () => (R.drafts === 0 ? `Writing ${R.expected ? fmt.plural(R.expected, 'email') : 'emails'}…` : `Writing email ${R.drafts + 1}${R.expected ? ` of ${R.expected}` : ''}…`),
    finish: 'Writing your summary…',
    learn_csv_format: 'Learning a new bank layout…',
    upcoming_renewals: 'Checking what renews next…',
    compare_with_last_audit: 'Comparing with your last audit…',
  };
  function draftWhat(inp) {
    const f = R.findings.get(Number(inp.finding_id)) || {};
    const who = f.name;
    switch (inp.kind) {
      case 'dispute': return who ? (f.kind === 'duplicate' ? `a dispute for the double ${who} charge` : `a dispute about ${who}`) : 'a dispute';
      case 'refund': return who ? `a refund request to ${who}` : 'a refund request';
      case 'cancellation': return who ? `a cancel request for ${who}` : 'a cancel request';
      case 'escalation': return who ? `an escalation about ${who}` : 'an escalation';
      default: return `a ${(DRAFT_KIND[inp.kind] || 'email').toLowerCase()}`;
    }
  }

  const DONE = {
    list_statement_files(o) {
      const fs = o.files || [];
      R.files = fs.length;
      const bank = fs.filter((f) => /\.csv$/i.test(f)).length, card = fs.length - bank;
      return {
        say: `Found ${fmt.plural(fs.length, 'statement file')}: ${listJoin([bank && fmt.plural(bank, 'bank statement'), card && fmt.plural(card, 'card statement')].filter(Boolean))}.`,
      };
    },
    parse_statement(o, i, err) {
      const fname = (i && i.filename) || o.file || '';
      if (err || o.error) {
        const type = fileIssueType(o.error, o.error_type);
        R.fileStatus.set(fname, type);
        if (type === 'needs_password') {
          return {
            tone: 'warn', icon: 'lock',
            say: html`${cap(theFile(fname))} is locked with a password, so it could not be read yet.`,
          };
        }
        if (type === 'unknown_format') {
          return {
            tone: 'warn',
            say: html`${cap(theFile(fname))} uses a layout it has not seen before.`,
            more: html`<p class="rn-sub">It will work out the columns, then read the file again.</p>`,
          };
        }
        return {
          tone: 'warn', icon: 'fileX',
          say: html`Could not open <span class="rn-fn">${fname}</span>. ${fileProblem(o.error, type).replace(/\.$/, '')}, so it was skipped.`,
          more: html`<p class="rn-sub">It will ask you to download it again. The audit goes on with the other files.</p>`,
        };
      }
      if (o.note) return { say: `${cap(theFile(i.filename))} was already read, so it skipped it.` };
      R.fileStatus.set(fname, 'ok'); R.rows += o.transactions || 0;
      const q = o.quarantined_rows || [];
      R.setAside += q.length;
      const card = /\.pdf$/i.test(o.file || i.filename || '');
      const per = periodLabel(o.months, true);
      const name = theFile(o.file || i.filename, o.months);
      return {
        tone: q.length ? 'warn' : undefined,
        say: card ? `Read ${name}: ${fmt.plural(o.transactions, 'transaction')}.` : `Read ${name}: ${fmt.plural(o.transactions, 'transaction')}${per ? `, ${per}` : ''}.`,
        more: q.length ? html`<p class="rn-flag">${icon('alert')}<span><b>${fmt.plural(q.length, 'row')} set aside.</b> ${rowProblem(q[0].reason)} It was not guessed.</span></p>` : '',
      };
    },
    remember_cancellation(o, i) {
      learn(i.merchant_name);
      return {
        say: `From your notes: you cancelled ${i.merchant_name} on ${fmt.date(o.cancelled_on || i.cancelled_on)}.`,
        more: html`<p class="rn-sub">It will watch for any charge from ${i.merchant_name} after that date. This is saved, so it remembers next time.</p>`,
      };
    },
    categorize_transactions(o) {
      if (o.error) return { tone: 'warn', say: `Could not sort yet: ${plain(o.error)}.` };
      const bs = o.by_source || {};
      R.sorted = o.total || 0;
      const segs = [['memory', 'from your earlier fixes', '--c-aqua'], ['rules', 'known shops', '--ink'], ['llm', 'by AI', '--ink-4'], ['safety', 'flagged by the safety check', '--c-red']]
        .filter(([k]) => bs[k]).map(([k, label, c]) => ({ k, n: bs[k], label, c }));
      const low = o.low_confidence || [];
      low.forEach((l) => learn(l.display));
      const sus = o.suspicious || [];
      const mem = Object.entries(o.remembered_corrections_applied || {});
      const total = segs.reduce((a, s) => a + s.n, 0) || 1;
      return {
        say: `Sorted ${fmt.n(o.total)} transactions: ${segs.map((s) => `${fmt.n(s.n)} ${s.label}`).join(', ')}.`,
        more: html`
          <div class="rn-split" role="img" aria-label="${segs.map((s) => `${s.n} ${s.label}`).join(', ')}">
            ${segs.map((s) => html`<i style="flex:${s.n / total};background:var(${s.c})" data-tip="${`<b>${fmt.n(s.n)}</b> ${esc(s.label)}`}"></i>`)}
          </div>
          <div class="legend rn-split-key">${segs.map((s) => html`<span class="key"><i style="background:var(${s.c})"></i>${cap(s.label)}</span>`)}</div>
          ${mem.length ? html`<p class="rn-sub">${icon('bookmark')}Used your earlier fixes for ${listJoin(mem.map(([k, n]) => `${nameOf(k)} (${n})`))}.</p>` : ''}
          ${sus.length ? html`<p class="rn-flag is-safe">${icon('shield')}<span><b>${sus.length === 1 ? '1 transaction had a hidden instruction inside it.' : `${sus.length} transactions had hidden instructions inside them.`}</b> ${sus.length === 1 ? 'It was' : 'They were'} treated as plain data and not followed.</span></p>` : ''}
          ${low.length ? html`<p class="rn-sub">${icon('help')}Not sure about ${fmt.n(low.length)}: ${listJoin(low.map((l) => l.display))}.</p>` : ''}`,
      };
    },
    lookup_merchant(o, i) {
      if (o.error) return { tone: 'warn', say: `Could not look up “${i.query}” on the web, so it will ask you instead.` };
      const rs = o.results || [];
      return {
        say: `Looked up “${i.query}” on the web: ${fmt.plural(rs.length, 'result')}.`,
        more: rs.length ? html`<ul class="rn-lines">${rs.slice(0, 3).map((r) => html`<li>${dot('--ink-4')}<span><b>${r.title || r.url}</b>${r.snippet ? html` · ${r.snippet.slice(0, 120)}` : ''}</span></li>`)}</ul>` : '',
      };
    },
    set_merchant_category(o, i) {
      return {
        say: `Put ${nameOf(i.merchant_key)} under ${i.category} (${fmt.plural(o.updated || 0, 'payment')}).`,
        more: i.evidence ? html`<p class="rn-sub">Why: ${i.evidence}</p>` : '',
      };
    },
    detect_subscriptions(o) {
      const subs = o.subscriptions || [];
      subs.forEach((s) => { learn(s.merchant); if (s.merchant_key) R.names.set(norm(s.merchant_key), s.merchant); R.findings.set(Number(s.finding_id), { name: s.merchant, kind: 'subscription' }); });
      R.subsMonthly = o.subscription_total_monthly || subs.reduce((a, s) => a + (s.monthly || 0), 0);
      R.subsCount = subs.length;
      const yearly = subs.reduce((a, s) => a + (s.annual || 0), 0);
      const others = o.other_recurring_not_subscriptions || [];
      others.forEach((x) => learn(x.merchant));
      if (!subs.length) return { say: 'Found no subscriptions.' };
      return {
        tone: 'found',
        say: `Found ${fmt.plural(subs.length, 'subscription')}: ${fmt.inr(R.subsMonthly)} a month.`,
        more: html`<p class="rn-sub">That is ${fmt.inr(yearly)} a year.</p>
          <div class="rn-chips">${subs.map((s) => {
            const a = s.amounts || [];
            const up = a.length > 1 && a[a.length - 1] > a[0];
            return html`<span class="rn-chip">${s.merchant}<b>${fmt.inr(s.monthly)}</b>${up ? html`<span class="rn-up" title="The price went up">${icon('trend')}</span>` : ''}</span>`;
          })}</div>
          ${others.length ? html`<p class="rn-sub">Not counted as subscriptions: ${listJoin(others.slice(0, 3).map((x) => x.merchant).concat(others.length > 3 ? [`${others.length - 3} more`] : []))}.</p>` : ''}
          ${(o.user_chose_to_keep || []).length ? html`<p class="rn-sub">${icon('bookmark')}You chose to keep ${listJoin(o.user_chose_to_keep.map(nameOf))}, so it will not suggest stopping ${o.user_chose_to_keep.length === 1 ? 'it' : 'them'}.</p>` : ''}`,
      };
    },
    detect_duplicates(o) {
      const d = o.confirmed_duplicates || [], rej = o.rejected_candidates || [];
      d.forEach((x) => R.findings.set(Number(x.finding_id), { name: x.merchant, kind: 'duplicate' }));
      const rec = o.recoverable ?? d.reduce((a, x) => a + (x.amount || 0), 0);
      R.problems += d.length; R.back += rec;
      const notDouble = rej.map((x) => {
        const m = String(x.reason || '').match(/(\w+) order and (\w+) order/i);
        return m ? html`Two ${x.merchant} orders were <b>not</b> double: ${m[1].toLowerCase()} and ${m[2].toLowerCase()}.` : html`${x.merchant} on ${fmt.date(x.date)} looked double, but it was <b>not</b>.`;
      });
      return {
        tone: d.length ? 'found' : undefined,
        say: html`${d.length ? `Found ${fmt.plural(d.length, 'double charge')} (${fmt.inr(rec)}).` : 'Found no double charges.'} ${notDouble}`,
        more: html`
          ${d.length ? html`<div class="rn-chips">${d.map((x) => html`<span class="rn-chip">${dot('--c-blue')}${x.merchant}<span class="rn-chip-m">${fmt.date(x.date)}</span><b>${fmt.inr(x.amount)}</b></span>`)}</div>` : ''}
          ${rej.length ? html`<p class="rn-sub">${icon('checkCircle')}Why not: ${rej.map((x) => x.reason).join(' ')}</p>` : ''}
          ${suppressedLine(o.suppressed_by_user_preference)}`,
      };
    },
    detect_price_changes(o) {
      const h = [...(o.price_hikes || [])].sort((a, b) => b.pct - a.pct), t = o.trial_conversions || [], z = o.charges_after_cancellation || [];
      const hikeName = (x) => (x.kind === 'bank_fee' ? 'your bank fee' : x.display);
      h.forEach((x) => R.findings.set(Number(x.finding_id), { name: x.kind === 'bank_fee' ? 'your bank' : x.display, kind: 'price_hike' }));
      t.forEach((x) => R.findings.set(Number(x.finding_id), { name: x.display, kind: 'trial' }));
      z.forEach((x) => R.findings.set(Number(x.finding_id), { name: x.display, kind: 'zombie' }));
      R.problems += h.length + t.length + z.length;
      R.back += z.reduce((a, x) => a + (x.amount || 0), 0);
      R.expected = Math.min(4, (R.findings.size ? [...R.findings.values()].filter((f) => f.kind === 'duplicate').length : 0) + t.length + z.length);
      const also = [t.length && fmt.plural(t.length, 'free trial that turned paid', 'free trials that turned paid'), z.length && fmt.plural(z.length, 'charge after you cancelled', 'charges after you cancelled')].filter(Boolean);
      const say = h.length
        ? `Price went up for ${listJoin(h.map((x) => `${hikeName(x)} (${fmt.signedPct(x.pct)})`))}.${also.length ? ` Also found ${listJoin(also)}.` : ''}`
        : also.length ? `Found ${listJoin(also)}.` : 'Found no price rises, trials or charges after cancelling.';
      return {
        tone: h.length || t.length || z.length ? 'found' : undefined,
        say,
        more: html`<ul class="rn-lines">
          ${z.map((x) => html`<li>${dot('--c-blue')}<span><b>${x.display}</b> charged ${fmt.inr(x.amount)} on ${fmt.date(x.date)}, after you cancelled on ${fmt.date(x.cancelled_on)}. Ask for it back.</span></li>`)}
          ${t.map((x) => html`<li>${dot('--c-orange')}<span><b>${x.display}</b>: a ${fmt.inr(x.trial_amount)} trial became ${fmt.inr(x.paid_amount)} a month (${fmt.inr(x.annual_cost)} a year).</span></li>`)}
          ${h.map((x) => html`<li>${dot('--c-red')}<span><b>${x.kind === 'bank_fee' ? `Bank fee (${x.display})` : x.display}</b>: ${fmt.inr(x.old)} → ${fmt.inr(x.new)}. That is ${fmt.inr(x.extra_per_year)} more a year.</span></li>`)}
        </ul>${suppressedLine(o.suppressed_by_user_preference)}`,
      };
    },
    upcoming_renewals(o) {
      const rs = o.renewals || [];
      if (!rs.length) return { say: 'Nothing renews in the next 30 days.' };
      const flagColor = { price_hike: '--c-red', trial_conversion: '--c-orange', zombie_charge: '--c-blue' };
      const shown = rs.slice(0, 6);
      return {
        say: `Coming up: ${fmt.plural(rs.length, 'payment')} in the next 30 days (${fmt.inr(o.next_30_days_total || 0)}).`,
        more: html`<div class="rn-chips">${shown.map((r) => html`<span class="rn-chip">${r.flag && flagColor[r.flag] ? dot(flagColor[r.flag]) : ''}${r.display}<span class="rn-chip-m">${fmt.date(r.date)}</span><b>${r.estimate ? 'about ' : ''}${fmt.inr(r.amount)}</b></span>`)}${rs.length > shown.length ? html`<span class="rn-chip rn-chip-m">${rs.length - shown.length} more</span>` : ''}</div>`,
      };
    },
    compare_with_last_audit(o) {
      if (o.error) return { tone: 'warn', say: 'Could not compare with your last audit.' };
      if (o.first_audit) return { say: 'This is your first audit, so there is nothing to compare yet.' };
      const added = (o.transactions && o.transactions.added) || 0;
      const fresh = (o.new_findings || []).filter((f) => f.kind !== 'subscription' && f.kind !== 'budget').length;
      const gone = (o.resolved_or_gone || []).filter((f) => f.kind !== 'subscription' && f.kind !== 'budget').length;
      const subs = o.subscriptions_per_month;
      const claimed = o.amount_claimed_via_sent_disputes || 0;
      return {
        say: `Since your last audit: ${added > 0 ? `${fmt.plural(added, 'more transaction')}, ` : ''}${fmt.plural(fresh, 'new problem')}, ${fmt.n(gone)} gone.`,
        more: html`${subs && subs.before !== subs.now ? html`<p class="rn-sub">Subscriptions went from ${fmt.inr(subs.before)} to ${fmt.inr(subs.now)} a month.</p>` : ''}
          ${claimed ? html`<p class="rn-sub">You have asked for ${fmt.inr(claimed)} back through emails you sent.</p>` : ''}`,
      };
    },
    build_budget(o, i) {
      if (o.error) return { tone: 'warn', say: `Could not build the budget: ${plain(o.error)}.` };
      R.target = o.savings_target_pct;
      const cancel = (o.cancel_merchants || i.cancel_merchants || []).map(nameOf);
      const nowPct = o.current_savings_pct || 0, plan = o.projected_savings_pct || o.savings_target_pct || 0;
      const scale = Math.max(60, Math.ceil(Math.max(nowPct, plan) / 10) * 10);
      return {
        say: `Built a budget: save ${o.savings_target_pct}% (${fmt.inr(o.savings_target)} a month).`,
        more: html`
          <div class="rn-bars" aria-label="Savings now ${nowPct}% and with the plan ${plan}%">
            <div class="rn-bar" data-tip="${`<b>Now</b> ${fmt.inr(o.current_savings)} a month (${nowPct}%)`}"><span>Now</span><i><b style="width:${(nowPct / scale) * 100}%;background:var(--ink-4)"></b></i><em>${fmt.pct(nowPct, nowPct % 1 ? 1 : 0)}</em></div>
            <div class="rn-bar" data-tip="${`<b>With the plan</b> ${fmt.inr(o.projected_savings)} a month (${plan}%)`}"><span>Plan</span><i><b style="width:${(plan / scale) * 100}%;background:var(--c-aqua)"></b></i><em>${fmt.pct(plan, plan % 1 ? 1 : 0)}</em></div>
          </div>
          <p class="rn-sub">You save ${fmt.pct(nowPct, 1)} of ${fmt.inr(o.monthly_income)} now.${cancel.length ? ` Stopping ${listJoin(cancel)} saves ${fmt.inr(o.cancellable_monthly)} a month.` : ''}${o.one_time_recoverable ? ` ${fmt.inr(o.one_time_recoverable)} can come back once.` : ''}</p>
          ${(o.kept_by_user || []).length ? html`<p class="rn-sub">${icon('bookmark')}${listJoin(o.kept_by_user.map(nameOf))} stays, because you chose to keep ${o.kept_by_user.length === 1 ? 'it' : 'them'}.</p>` : ''}`,
      };
    },
    draft_email(o, i) {
      if (o.error) return { tone: 'warn', say: `Could not write that email: ${plain(o.error)}.` };
      R.drafts++;
      const st = DRAFT_STATUS[o.status] || DRAFT_STATUS.PENDING_APPROVAL;
      return {
        say: html`${cap(`wrote ${draftWhat(i)}`)}. <span class="badge ${st.cls} rn-inline-badge">${st.label}</span>`,
        more: o.subject ? html`<p class="rn-subject"><span>Subject</span>${o.subject}</p>` : '',
      };
    },
    finish() { return { say: 'Wrote its summary for you.' }; },
    learn_csv_format(o, i) {
      const name = i.filename ? theFile(i.filename) : 'that file';
      if (o.error) return { tone: 'warn', say: `Could not work out the columns of ${name}.`, more: html`<p class="rn-sub">It will ask you for a standard CSV download from your bank.</p>` };
      const sure = typeof o.confidence === 'number' ? ` It is ${Math.round(o.confidence * 100)}% sure.` : '';
      return {
        say: `Worked out the columns of ${name} using AI.${sure}`,
        more: html`<p class="rn-sub">${o.transactions ? `${fmt.plural(o.transactions, 'transaction')} can now be read. ` : ''}It remembers this layout, so next time it needs no AI.</p>`,
      };
    },
  };
  function suppressedLine(list) {
    const l = list || [];
    if (!l.length) return '';
    return html`<p class="rn-sub">${icon('bookmark')}Left out ${listJoin(l.map((x) => x.merchant))}, because you marked ${l.length === 1 ? 'it' : 'them'} as expected.</p>`;
  }
  function describe(name, out, inp, isErr) {
    const o = out && typeof out === 'object' ? out : { note: String(out ?? '') };
    const f = DONE[name];
    if (f) { try { return f(o, inp || {}, isErr); } catch (e) { console.warn(e); } }
    const human = cap(String(name).replace(/_/g, ' '));
    return isErr || o.error ? { tone: 'warn', say: `This step did not work: ${human.toLowerCase()}. ${plain(o.error || '')}`.trim() } : { say: `Finished a step: ${human.toLowerCase()}.` };
  }

  /* ---------- timeline items ---------- */
  function addGoal(text) {
    R.goal = text; R.goalShown = true;
    feed.appendChild(el(html`<li class="rn-item">
      <div class="rn-node">${icon('flag')}</div>
      <div class="rn-card rn-goalcard">
        <div class="rn-row"><p class="rn-kicker">${unsafe ? 'What it will do instead' : 'Your goal'}</p><span class="rn-time">${now()}</span></div>
        <p class="rn-goal-q">${text}</p>
      </div></li>`));
    afterAdd();
  }
  function toolCall(e) {
    const name = e.name, inp = e.input || {};
    if (!(name === 'ask_user' && inp.kind === 'password')) enterPhase(name);
    const st = STATUS[name];
    setStatus(typeof st === 'function' ? st() : st || 'Working…');
    if (name === 'ask_user') { addHelp(inp); return; }
    const runText = (RUNNING[name] || (() => `Working on a step: ${String(name).replace(/_/g, ' ')}…`))(inp);
    const li = el(html`<li class="rn-item rn-tool is-running" data-tool="${name}">
      <div class="rn-node"><span class="rn-node-ic">${icon(toolIcon(name, inp))}</span><span class="rn-spin"></span></div>
      <div class="rn-card">
        <div class="rn-row"><p class="rn-say">${runText}</p><span class="rn-row-end"><span class="rn-time">${now()}</span></span></div>
        <div class="rn-more"></div>
        <div class="rn-prog" aria-hidden="true"><i></i></div>
      </div></li>`);
    li._inp = inp;
    feed.appendChild(li);
    if (!R.running.has(name)) R.running.set(name, []);
    R.running.get(name).push(li);
    paintPhases(); evalPlans(); afterAdd();
  }
  function toolResult(e) {
    const name = e.name;
    R.tools++;
    if (name === 'ask_user') { resolveHelp(); R.ran.add(name); paintPhases(); evalPlans(); return; }
    const q = R.running.get(name) || [];
    let li = q.shift();
    if (!q.length) R.running.delete(name);
    if (!li) { toolCall({ name, input: {} }); li = (R.running.get(name) || []).shift(); R.running.delete(name); }
    const inp = li._inp || {};
    const d = describe(name, e.output, inp, e.is_error);
    R.ran.add(name);
    li.classList.remove('is-running');
    li.classList.add('is-done');
    if (d.tone) li.dataset.tone = d.tone;
    if (d.icon) mount($('.rn-node-ic', li), icon(d.icon));
    mount($('.rn-say', li), d.say);
    const payload = Object.keys(inp).length ? { input: inp, output: e.output } : { output: e.output };
    mount($('.rn-more', li), html`${d.more || ''}${dtBody(payload)}`);
    $('.rn-row-end', li).insertAdjacentHTML('afterbegin', String(dtBtn()));
    const pr = $('.rn-prog', li); if (pr) pr.remove();
    paintCounters(); paintPhases(); evalPlans(); afterAdd();
  }
  const fileBatch = () => (replay ? null : loadSession().batch || null);
  function addHelp(inp) {
    const pw = inp.kind === 'password';
    if (!pw) R.asks = (R.asks || 0) + 1;
    const canUnlock = pw && !!inp.filename;
    const li = el(html`<li class="rn-item rn-help-item is-running"${canUnlock ? html` data-file="${inp.filename}"` : ''}>
      <div class="rn-node rn-node-ink">${icon(pw ? 'lock' : 'help')}</div>
      <div class="rn-card rn-help">
        <div class="rn-row"><p class="rn-kicker">Needs your help</p><span class="rn-row-end">${dtBtn()}<span class="rn-time">${now()}</span></span></div>
        <p class="rn-help-q${String(inp.question || '').length > 110 ? ' is-long' : ''}">${plain(inp.question) || 'It has a question for you.'}</p>
        ${pw && inp.filename ? html`<div class="rn-chips"><span class="rn-chip rn-chip-mono">${icon('lock')}${inp.filename}</span></div>` : ''}
        <p class="rn-sub rn-help-s">${pw
          ? 'It will not guess the password. It goes on with the other files for now.'
          : 'It did not guess. The question is waiting for you in your report, and your answer will be remembered next time.'}</p>
        ${canUnlock ? html`<div class="rn-help-unlock">${unlockBox(inp.filename, `run-${R.help.length}`)}</div>
          <div class="rn-rerun" hidden>
            <p class="rn-rerun-ok">${icon('check')}<span></span></p>
            <button type="button" class="btn btn-primary" data-rerun>${icon('retry')}Run the audit again</button>
            <p class="rn-sub rn-rerun-wait">You can run it again when this audit finishes.</p>
          </div>` : ''}
        ${dtBody({ input: inp })}
      </div></li>`);
    R.help.push(li);
    feed.appendChild(li);
    paintPhases(); afterAdd();
    if (canUnlock) {
      /* It may already be unlocked (a recorded run, or a second look). */
      const b = fileBatch();
      api.get(`/api/statements/status?name=${encodeURIComponent(inp.filename)}${b ? `&batch=${encodeURIComponent(b)}` : ''}`)
        .then((st) => { if (li.isConnected && (st.unlocked || st.status === 'ok')) showUnlocked(li, null); })
        .catch(() => {});
    }
  }
  function showUnlocked(li, r) {
    const box = $('.rn-help-unlock', li); if (box) box.hidden = true;
    const rr = $('.rn-rerun', li); if (!rr) return;
    rr.hidden = false;
    $('.rn-rerun-ok span', rr).textContent = r
      ? `Unlocked. ${fmt.plural(r.transactions, 'transaction')} can now be read. Run the audit again to include them.`
      : 'This file is unlocked. Run the audit again to include it.';
    syncRerun();
  }
  function syncRerun() {
    const free = R.ended || R.failed;
    $$('[data-rerun]', root).forEach((b) => { b.disabled = !free; });
    $$('.rn-rerun-wait', root).forEach((p) => { p.hidden = free; });
  }
  function resolveHelp() {
    const li = R.help.find((x) => x.classList.contains('is-running'));
    if (li) { li.classList.remove('is-running'); const s = $('.rn-help-s', li); if (s && !li.dataset.file && !$('.rn-chip-mono', li)) s.insertAdjacentHTML('afterbegin', `<span class="rn-saved">${icon('check')}Saved for you.</span> `); }
  }
  function addRefusal(request, reason, big = false) {
    const why = splitReasons(reason);
    feed.appendChild(el(html`<li class="rn-item rn-refusal-item${big ? ' is-big' : ''}">
      <div class="rn-node rn-node-bad">${icon('shieldX')}</div>
      <div class="rn-card rn-refusal">
        <div class="rn-row">${big ? html`<h2 class="rn-refusal-h">Refused.</h2>` : html`<span class="badge badge-bad">${icon('x')}Refused</span>`}<span class="rn-time">${now()}</span></div>
        ${request ? html`<p class="rn-refusal-ask"><span class="rn-refusal-l">The request</span>“${request}”</p>` : ''}
        <ul class="rn-refusal-why">${why.map((w) => html`<li>${icon('xCircle')}<span>${w}</span></li>`)}</ul>
        <p class="rn-sub">This check runs before the AI starts work. ${big ? 'The safe part of the audit continues below.' : 'It goes on with the safe part of the audit.'}</p>
      </div></li>`));
    afterAdd();
  }
  function addNote(text, kind) {
    const t = String(text || '').trim();
    if (!t) return;
    const li = el(html`<li class="rn-item rn-note-item">
      <div class="rn-node rn-node-sm">${icon('spark')}</div>
      <button type="button" class="rn-note" aria-expanded="false"><span class="rn-note-l">${kind === 'thinking' ? 'Thinking' : 'It says'}</span><span class="rn-note-t">${t}</span></button>
    </li>`);
    feed.appendChild(li);
    afterAdd();
  }
  function addError(kind, text) {
    R.failed = true;
    const keyMissing = /api[_ ]?key|anthropic_api_key|authentication|401|x-api-key/i.test(text || '');
    const V = {
      ai: {
        icon: 'plug', title: 'The AI could not be reached.',
        body: keyMissing
          ? 'This copy of KharchaSaathi has no AI key, so a live audit cannot start here. A recorded run shows the same audit, step by step, and it is free.'
          : 'The AI service did not answer. It may be busy, or the internet connection dropped. A recorded run shows the same audit, step by step, and it is free.',
        primary: ['#/run?mode=replay', 'Watch a recorded run instead', 'play'], secondary: ['#/start', 'Back to your files'],
      },
      busy: {
        icon: 'clock', title: 'An audit is already running.',
        body: 'Only one audit can run at a time. Give it a minute to finish, then try again. Or watch a recorded run while you wait.',
        primary: ['#/run?mode=replay', 'Watch a recorded run instead', 'play'], retry: true, calm: true,
      },
      dropped: {
        icon: 'plug', title: 'The live updates stopped.',
        body: 'The page lost touch with the audit before it finished. It may still be running. Your report will show what it found so far.',
        primary: ['#/report', 'See your report', 'arrowRight'], retry: true,
      },
      noreplay: {
        icon: 'play', title: 'There is no recorded run yet.',
        body: 'Run an audit first. Every step is saved, so you can watch it again here for free.',
        primary: ['#/start', 'Start an audit', 'arrowRight'], calm: true,
      },
      other: {
        icon: 'alert', title: 'Something went wrong.',
        body: 'The audit stopped before it finished. You can try again, or watch a recorded run instead.',
        primary: ['#/run?mode=replay', 'Watch a recorded run instead', 'play'], retry: true,
      },
    }[kind];
    feed.appendChild(el(html`<li class="rn-item rn-error-item${V.calm ? ' is-calm' : ''}">
      <div class="rn-node${V.calm ? '' : ' rn-node-bad'}">${icon(V.icon)}</div>
      <div class="rn-card rn-error" role="alert">
        <div class="rn-row"><p class="rn-error-t">${V.title}</p><span class="rn-row-end">${text ? dtBtn() : ''}<span class="rn-time">${now()}</span></span></div>
        <p class="rn-error-b">${V.body}</p>
        <div class="rn-actions">
          <a class="btn btn-primary" href="${V.primary[0]}">${V.primary[2] === 'play' ? icon('play') : ''}${V.primary[1]}${V.primary[2] === 'arrowRight' ? icon('arrowRight') : ''}</a>
          ${V.retry ? html`<button type="button" class="btn btn-secondary" data-retry>${icon('retry')}Try again</button>` : ''}
          ${V.secondary ? html`<a class="btn btn-ghost" href="${V.secondary[0]}">${V.secondary[1]}</a>` : ''}
        </div>
        ${text ? dtBody({ error: text }) : ''}
      </div></li>`));
    /* Failed before any step ran: no empty progress bar or zero counters, just the way forward. */
    const early = R.tools === 0;
    page.classList.toggle('is-early-stop', early);
    setStatus(kind === 'busy' ? 'Please wait a moment.' : kind === 'noreplay' ? 'Nothing to play yet.' : early ? 'The audit could not start.' : 'The audit stopped.');
    $('.rn-lead', root).textContent = kind === 'busy' ? 'Nothing new was started.'
      : kind === 'noreplay' ? 'A recording is saved after every audit.'
        : early ? 'Nothing was changed and nothing was sent.' : 'Here is what it did before it stopped. Nothing was sent.';
    setMode(early ? 'unstarted' : 'stopped');
    stopClock();
    syncRerun();
    afterAdd();
  }
  function setMode(m) {
    const node = $('#rn-mode', root);
    if (m === 'done') mount(node, html`${icon('check')}${replay ? 'Recorded run' : 'Finished'}`);
    else if (m === 'stopped' || m === 'unstarted') mount(node, html`<i class="rn-live is-off"></i>${replay ? 'Recorded run' : m === 'stopped' ? 'Stopped' : 'Not started'}`);
    node.dataset.m = m;
  }

  function finish(e) {
    if (R.ended) return;
    R.ended = true;
    stopClock();
    R.running.forEach((list) => list.forEach((li) => { li.classList.remove('is-running'); li.classList.add('is-stalled'); const p = $('.rn-prog', li); if (p) p.remove(); }));
    const summary = String(e.text || '').trim();
    R.ok = !R.failed && R.tools > 0 && !!summary && !/^\(agent stopped/i.test(summary);
    store.invalidate();
    syncRerun();
    if (!R.ok) {
      if (!R.failed) addError('other', summary || 'The agent stopped without a summary.');
      paintPhases();
      return;
    }
    paintPhases(); evalPlans(); paintCounters();
    setStatus('Done. Here is what I found.');
    setMode('done');
    const qs = e.questions || [];
    const stats = [
      [fmt.inr(R.back), 'to get back', 'back'],
      [fmt.inr(R.subsMonthly), 'a month on subscriptions'],
      [fmt.n(R.problems), R.problems === 1 ? 'problem found' : 'problems found'],
      [fmt.n(R.drafts), e.replay ? (R.drafts === 1 ? 'email written' : 'emails written') : (R.drafts === 1 ? 'email waiting for you' : 'emails waiting for you')],
    ];
    const took = clock(performance.now() - R.t0);
    const fin = $('#rn-finale', root);
    mount(fin, html`
      <div class="rn-final-top">
        <div class="rn-final-say">
          <div class="rn-final-meta">
            <span class="rn-final-tag">${e.replay ? html`${icon('play')}Recorded run` : html`${icon('check')}Finished in ${took}`}</span>
            <span class="rn-final-note">${e.replay ? 'Played back from the saved log. No AI was used.' : e.llm_calls ? `Used the AI ${fmt.plural(e.llm_calls, 'time')}.` : ''}</span>
          </div>
          <h2 class="rn-done">Done.</h2>
          <p class="rn-done-sub">Here is what it found in ${fmt.n(R.rows)} transactions${R.target != null ? `, with a plan to save ${R.target}%` : ''}. <span data-rn-emails>${e.replay ? '' : R.drafts ? 'Nothing has been sent. The emails wait for you.' : 'It did not need to write any emails.'}</span></p>
          <div class="rn-actions">
            <a class="btn btn-lg rn-btn-a" href="#/report">See your report ${icon('arrowRight')}</a>
            <a class="btn btn-lg rn-btn-b" href="#/emails">${icon('mail')}Read the emails</a>
          </div>
        </div>
        <div class="rn-final-stats">
          ${stats.map(([v, l]) => html`<div class="rn-fs"><span class="rn-fs-v">${v}</span><span class="rn-fs-l">${l}</span></div>`)}
        </div>
      </div>
      ${qs.slice(0, 3).map((q, i) => html`<div class="rn-final-q">${icon(q.kind === 'password' ? 'lock' : 'help')}<p>${i === 0 ? html`<b>${fmt.plural(qs.length, 'question')} for you.</b> ` : ''}${plain(q.question)}</p>${q.kind === 'password' && q.filename ? html`<button type="button" class="btn btn-sm rn-btn-b" data-goto-file="${q.filename}">Unlock the file</button>` : ''}</div>`)}
      <details class="rn-summary">
        <summary><span class="rn-show">Read its full summary</span><span class="rn-hide">Hide the summary</span>${icon('chevron')}</summary>
        <div class="md">${md(stripEmoji(summary))}</div>
      </details>`);
    if (e.replay) {
      /* A recording is old news: some of its emails may have been sent since. Say what is true now. */
      store.state().then((s) => {
        const line = $('[data-rn-emails]', fin);
        if (!line || !s.run || s.run.id !== e.run_id) return;
        const all = s.drafts || [];
        const sent = all.filter((d) => d.status === 'SENT').length;
        const waiting = all.filter((d) => d.status === 'PENDING_APPROVAL').length;
        line.textContent = sent
          ? `Since this run, ${fmt.n(sent)} of its emails ${sent === 1 ? 'has' : 'have'} been sent${waiting ? ` and ${fmt.n(waiting)} still ${waiting === 1 ? 'waits' : 'wait'} for you` : ''}.`
          : waiting ? `Nothing has been sent. ${waiting === 1 ? '1 email waits' : `${fmt.n(waiting)} emails wait`} for you.` : 'No emails are waiting for you.';
      }).catch(() => {});
    }
    fin.hidden = false;
    $('#rn-pcta', root).hidden = false;
    panel.classList.add('is-done');
    page.classList.add('is-finished');
    jump.hidden = R.follow;
    if (!R.follow) mount(jump, html`${icon('arrowDown')}See the result`);
    requestAnimationFrame(() => { if (R.follow) scrollToFinale(); });
  }
  function scrollToFinale() {
    const top = $('#rn-finale', root).getBoundingClientRect().top + scrollY - 72 - 24;
    scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
  }

  /* ---------- one event ---------- */
  function handle(e) {
    if (!e || !e.type || !page.isConnected) return;
    R.started = true;
    switch (e.type) {
      case 'goal': addGoal(e.text || ''); setStatus('Reading your goal…'); break;
      case 'plan':
        if (!R.goalShown && !R.refused && R.goal) addGoal(R.goal);
        addPlan(e, false); setStatus('Making a plan…'); break;
      case 'replan': addPlan(e, true); setStatus('Changing its plan…'); break;
      case 'tool_call': toolCall(e); break;
      case 'tool_result': toolResult(e); break;
      case 'thinking': case 'text': addNote(e.text, e.type); break;
      case 'refusal': R.refused = true; addRefusal(R.goal, e.text); setStatus('Refused the unsafe part.'); break;
      case 'error': addError(/llm|api|anthropic|connect|timeout|overloaded|rate/i.test(e.text || '') ? 'ai' : 'other', e.text); break;
      case 'final': finish(e); break;
      default: break;
    }
  }

  /* ---------- streams ---------- */
  async function runReplay(runId, attempt = 0) {
    let meaningful = false, emptyFinal = null;
    const held = [];
    const url = `/api/replay?speed=${speed}${runId ? `&run_id=${runId}` : ''}`;
    await api.stream(url, {
      signal: ac.signal,
      onEvent: (e) => {
        if (!meaningful) {
          if (e.type === 'final') { emptyFinal = e; return; }
          if (!['plan', 'replan', 'tool_call', 'tool_result'].includes(e.type)) { held.push(e); return; }
          meaningful = true; held.forEach(handle);
        }
        handle(e);
      },
    });
    /* The newest saved run can be an empty one (a live run that failed at once).
       Then quietly play the one before it, so a recorded run always shows something. */
    if (!meaningful && emptyFinal && emptyFinal.run_id > 1 && attempt < 6 && !ac.signal.aborted) return runReplay(emptyFinal.run_id - 1, attempt + 1);
    if (!meaningful && !ac.signal.aborted) addError('noreplay');
  }
  async function start() {
    try {
      if (unsafe) {
        setStatus('Checking the request first…');
        await sleep(reduced() ? 0 : 700);
        let p = null;
        try { p = await api.post('/api/policy', { goal: UNSAFE_GOAL }); } catch { /* shown below */ }
        if (ac.signal.aborted) return;
        if (p && !p.allowed) { addRefusal(UNSAFE_GOAL, p.reason, true); setStatus('Refused. Doing the safe part…'); }
        await sleep(reduced() ? 0 : 1600);
        if (ac.signal.aborted) return;
        feed.appendChild(el(html`<li class="rn-divider"><span>The safe part of the audit</span></li>`));
      }
      if (replay) { await runReplay(null); }
      else {
        const s = loadSession();
        const body = { goal: s.goal || DEFAULT_GOAL, savings_target: Number(s.savings_target) || 40, notes: s.notes || '', batch: s.batch || null };
        R.goal = body.goal;
        await api.stream('/api/run', { method: 'POST', body, signal: ac.signal, onEvent: handle });
      }
      if (!R.ended && !ac.signal.aborted && !R.failed) addError('dropped');
    } catch (err) {
      if (ac.signal.aborted || (err && err.name === 'AbortError')) return;
      if (R.ended) return;
      if (err && err.status === 409) addError('busy', err.message);
      else if (replay && err && err.status === 404) addError('noreplay', err.message);
      else if (err && (err.status === 404 || err.status === 400)) {
        addError('other', err.message);
      } else if (R.started) addError('dropped', err && err.message);
      else addError('ai', err && err.message);
    }
  }
  const offDt = on(root, 'click', '[data-dt]', (e, b) => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    b.title = open ? 'Hide details' : 'Show details';
    const pre = $('.rn-json', b.closest('.rn-card'));
    if (pre) pre.hidden = !open;
  });
  const offPw = [
    on(root, 'click', '[data-showpw]', (e, b) => toggleShowPw(b)),
    on(root, 'submit', '[data-unlock]', async (e, form) => {
      e.preventDefault();
      const r = await tryUnlock(form, fileBatch());
      if (r && page.isConnected) { const li = form.closest('.rn-help-item'); if (li) showUnlocked(li, r); }
    }),
    on(root, 'click', '[data-rerun]', () => navigate('/run')),
    on(root, 'click', '[data-goto-file]', (e, b) => {
      const li = $$('.rn-help-item', root).find((x) => x.dataset.file === b.dataset.gotoFile);
      if (!li) return;
      li.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      const input = $('.rn-help-unlock:not([hidden]) input', li);
      if (input) input.focus({ preventScroll: true });
    }),
  ];
  const offRetry = on(root, 'click', '[data-retry]', () => navigate(location.hash.slice(1)));
  const offNote = on(root, 'click', '.rn-note', (e, b) => { const o = b.getAttribute('aria-expanded') === 'true'; b.setAttribute('aria-expanded', String(!o)); });
  const offTip = tip.bind(feed);

  paintPhases();
  start();

  return () => {
    ac.abort();
    clearInterval(timer);
    endObs.disconnect(); headObs.disconnect();
    removeEventListener('wheel', onWheel); removeEventListener('keydown', onKey);
    removeEventListener('touchstart', onTouchStart); removeEventListener('touchmove', onTouchMove);
    offPw.forEach((f) => f()); offDt(); offRetry(); offNote(); offTip();
    jump.remove();
  };
}
