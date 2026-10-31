/* Ask AI: a calm question-and-answer page over the user's own audit.
   POST /api/chat is a stream of tool_call / tool_result / refusal events, then one final answer.
   The conversation lives in this module, so it survives a trip to #/emails and back. */
import { html, raw, mount, api, store, fmt, md, on, $ } from '../core.js';

export const title = 'Ask AI';

const P = {
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  check: '<path d="m5 12.5 4.4 4.4L19 7.4"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.6M12 15.8v.2"/>',
  shield: '<path d="M12 3.2 5 6v5.6c0 4.3 2.9 7.9 7 9.2 4.1-1.3 7-4.9 7-9.2V6l-7-2.8z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const ic = (n, cls = '') => raw(`<svg class="rv-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`);
const SPARK = raw('<svg class="rv-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5c.7 4.9 4.1 8.3 9 9-4.9.7-8.3 4.1-9 9-.7-4.9-4.1-8.3-9-9 4.9-.7 8.3-4.1 9-9Z"/></svg>');

/* What each tool did, in plain words: [while it runs, once it is done] */
const TOOLS = {
  query_transactions: ['Looking through your transactions', 'Looked through your transactions'],
  spend_summary: ['Adding up your spending', 'Added up your spending'],
  get_findings: ['Checking the problems it found', 'Checked the problems it found'],
  get_renewals: ['Checking what renews soon', 'Checked what renews soon'],
  get_budget: ['Reading your budget', 'Read your budget'],
  get_memory: ['Checking what it remembers', 'Checked what it remembers'],
  compare_with_last_audit: ['Comparing with your last audit', 'Compared with your last audit'],
  request_email_draft: ['Writing an email draft', 'Wrote an email draft'],
};
const words = (n) => String(n || 'something').replace(/_/g, ' ');
const stepWords = (name) => {
  if (TOOLS[name]) return TOOLS[name];
  return [`Using ${words(name)}`, `Used ${words(name)}`];
};
const titleCase = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** A short plain note about what a step looked at, for example "Food & Dining, September 2026". */
function stepNote(s) {
  const i = s.input || {}, o = s.output && typeof s.output === 'object' ? s.output : {};
  const bits = [];
  if (i.merchant) bits.push(titleCase(i.merchant));
  if (i.category) bits.push(i.category);
  if (/^\d{4}-\d{2}$/.test(i.month || '')) bits.push(fmt.month(i.month, true));
  if (s.done && !s.isError && s.name === 'query_transactions' && typeof o.count === 'number') bits.push(fmt.plural(o.count, 'found', 'found'));
  return bits.join(' · ');
}

/* ---------- the conversation ---------- */
const chat = { sessionId: null, turns: [], busy: false, seq: 0 };
let notify = null; // set while this page is on screen
const changed = (t) => { if (notify) notify(t); };

/* The server can stay silent for a long time (it waits on the AI with no limit of its own),
   so the page keeps its own clock. Each event from the server restarts both. */
const SLOW_NOTICE_MS = 15000; // say so when it is taking longer than usual
const GIVE_UP_MS = 120000;    // stop waiting, so a spinner can never run forever

const fail = (t, kind, detail) => { t.status = 'error'; t.failure = kind; t.failureDetail = String(detail || ''); };

function handleEvent(t, e) {
  if (e.type === 'tool_call') t.steps.push({ name: e.name, input: e.input, done: false });
  else if (e.type === 'tool_result') {
    const s = [...t.steps].reverse().find((x) => x.name === e.name && !x.done);
    if (s) { s.done = true; s.isError = !!e.is_error || !!(e.output && e.output.error); s.output = e.output; }
    if (e.name === 'request_email_draft' && e.output && e.output.draft_id) {
      t.drafts.push({ id: e.output.draft_id, subject: e.output.subject, existed: !!e.output.already_existed });
      store.invalidate(); // the Emails count in the nav goes up
    }
  } else if (e.type === 'refusal') { t.refusal = e.text; t.status = 'refused'; }
  else if (e.type === 'error') fail(t, 'ai', e.text);
  else if (e.type === 'answer') {
    if (e.session_id) chat.sessionId = e.session_id;
    // when the AI fails, the server still sends HTTP 200 and an "answer": only the error field gives it away
    if (e.error) fail(t, 'ai', e.error);
    else if (t.refusal) t.status = 'refused'; // this answer only repeats the refusal
    else if (!String(e.text || '').trim()) fail(t, 'empty');
    else { t.status = 'done'; t.text = e.text; }
  }
}

/** Runs one question to the end. Whatever happens, the turn finishes settled: no spinner is left running. */
async function runTurn(t) {
  Object.assign(t, { status: 'pending', steps: [], drafts: [], refusal: null, text: '', failure: null, failureDetail: '', slow: false });
  chat.busy = true;
  const ctl = new AbortController();
  let gaveUp = false, over = false, slowTimer = 0, stopTimer = 0;
  // settle on abort even if the connection itself never reacts to it
  const stopped = new Promise((_, reject) => {
    ctl.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
  });
  const restartClock = () => {
    clearTimeout(slowTimer); clearTimeout(stopTimer);
    t.slow = false;
    slowTimer = setTimeout(() => { t.slow = true; changed(t); }, SLOW_NOTICE_MS);
    stopTimer = setTimeout(() => { gaveUp = true; ctl.abort(); }, GIVE_UP_MS);
  };
  try {
    changed(t);
    restartClock();
    const body = { message: t.q };
    if (chat.sessionId) body.session_id = chat.sessionId;
    await Promise.race([stopped, api.stream('/api/chat', {
      method: 'POST', body, signal: ctl.signal,
      onEvent: (e) => {
        if (over) return; // a late event from an attempt we already gave up on
        restartClock();
        handleEvent(t, e);
        changed(t);
        if (e.type === 'answer') ctl.abort(); // the answer is always last, so do not wait for the connection to close
      },
    })]);
    if (t.status === 'pending') fail(t, 'cut'); // includes a 200 whose body was not events at all
  } catch (err) {
    // err.status means the server answered with a non-200; no status means we never got through
    if (t.status === 'pending') fail(t, gaveUp ? 'slow' : err && err.status ? 'server' : 'offline', err && err.message);
  } finally {
    over = true;
    clearTimeout(slowTimer); clearTimeout(stopTimer);
    ctl.abort(); // release the connection, however this ended
    t.slow = false;
    t.steps.forEach((s) => { if (!s.done) { s.done = true; s.isError = true; } });
    // a draft may exist even though we never heard the result
    if (!t.drafts.length && t.steps.some((s) => s.name === 'request_email_draft')) store.invalidate();
    chat.busy = false;
    changed(t);
  }
}

function ask(text) {
  const q = String(text || '').trim();
  if (!q || chat.busy) return false;
  const t = { id: ++chat.seq, q, isNew: true };
  chat.turns.push(t);
  runTurn(t);
  return true;
}

/* ---------- templates ---------- */
function stepsTpl(t) {
  if (!t.steps.length) return '';
  return html`<ul class="rv-ask-steps" aria-label="What it checked">${t.steps.map((s) => {
    const [doing, did] = stepWords(s.name);
    const note = stepNote(s);
    return html`<li class="rv-ask-step ${s.done ? 'is-done' : 'is-running'} ${s.isError ? 'is-bad' : ''}">
      <span class="rv-ask-step-ic">${!s.done ? html`<span class="spinner"></span>` : ic(s.isError ? 'alert' : 'check')}</span>
      <span>${s.done ? (s.isError ? `Could not finish: ${doing.toLowerCase()}` : did) : doing}${note ? html`<span class="rv-ask-step-note"> · ${note}</span>` : ''}</span></li>`;
  })}</ul>`;
}

function errorText(t) {
  switch (t.failure) {
    case 'offline': return ['We could not reach KharchaSaathi.', 'Check that the server is running, then try again.'];
    case 'server': return ['KharchaSaathi hit a problem.', 'The server sent back an error instead of an answer. It is safe to try again.'];
    case 'slow': return ['This took too long, so we stopped waiting.', 'No answer came back for two minutes. It is safe to try again.'];
    case 'cut': return ['The answer stopped before it finished.', 'The connection closed early. It is safe to try again.'];
    case 'empty': return ['The answer came back empty.', 'It is safe to try again.'];
    default: break;
  }
  if (/api.?key|auth|credential/i.test(t.failureDetail)) return ['The AI service is not set up here.', 'So this question could not be answered. Your report and emails still work. Try again once the AI key has been added.'];
  const wrote = t.steps.some((s) => s.name === 'request_email_draft');
  return ['That did not work.', `Something went wrong while answering. ${wrote ? '' : 'Nothing was changed. '}It is safe to try again.`];
}

const draftsTpl = (t) => html`${t.drafts.map((d) => html`<a class="rv-ask-draft" href="#/emails?id=${d.id}"><span class="rv-ask-badge">${ic('mail')}</span>
  <span class="rv-ask-draft-text"><b>${d.existed ? 'This draft was already waiting for you.' : 'A draft is waiting for you in Emails.'}</b>
  <small>${d.subject ? `“${d.subject}”. ` : ''}Nothing is sent until you approve it.</small></span>${ic('arrow')}</a>`)}`;

function bodyTpl(t) {
  if (t.status === 'pending') {
    const waiting = t.steps.some((s) => !s.done);
    if (t.slow) return html`<div class="rv-ask-wait" role="status">${waiting ? '' : html`<span class="spinner"></span>`}This is taking longer than usual. Still working.</div>`;
    if (waiting) return '';
    return html`<div class="rv-ask-wait" role="status"><span class="spinner"></span>${t.steps.length ? 'Writing your answer…' : 'Reading your question…'}</div>`;
  }
  if (t.status === 'refused') {
    return html`<div class="rv-ask-refusal"><span class="rv-ask-badge">${ic('shield')}</span><div>
      <b>This is something it will not do.</b>
      <p>${t.refusal}</p>
      <small>A safety rule stopped this before the AI saw it. Nothing happened.</small></div></div>`;
  }
  if (t.status === 'error') {
    const [head, text] = errorText(t);
    return html`<div class="rv-ask-err" role="alert"><span class="rv-ask-badge">${ic('alert')}</span><div>
      <b>${head}</b><p>${text}</p>
      <button class="btn btn-secondary btn-sm" data-retry="${t.id}" ${chat.busy ? 'disabled' : ''}>${ic('retry')}Try again</button></div></div>
      ${draftsTpl(t)}`;
  }
  return html`<div class="md rv-ask-md">${md(t.text)}</div>${draftsTpl(t)}`;
}

const LONG_QUESTION = 140; // a pasted paragraph should not become a wall of big serif type
const turnInner = (t) => html`${stepsTpl(t)}${bodyTpl(t)}`;
/* the question sits outside the part that re-renders, so a screen reader does not repeat it on every step */
const turnTpl = (t) => html`<article class="rv-ask-turn" data-turn="${t.id}">
  <h2 class="rv-ask-q ${t.q.length > LONG_QUESTION ? 'is-long' : ''}">${t.q}</h2>
  <div data-turn-body>${turnInner(t)}</div></article>`;

function noAuditView() {
  return html`<div class="page rv-ask-page"><header class="rv-ask-hero">
    <p class="rv-ask-eyebrow">${SPARK}Ask AI</p>
    <h1 class="h1">Nothing to ask about yet.</h1>
    <p class="lead">Run an audit first. Then you can ask about your spending, your subscriptions and your budget, in your own words.</p>
    <div class="rv-ask-cta"><a class="btn btn-primary" href="#/start">Start an audit <span aria-hidden="true">→</span></a></div>
  </header></div>`;
}

function skeleton() {
  return html`<div class="page rv-ask-page"><div class="rv-ask-hero">
    <div class="skel rv-sk-line" style="width:90px;margin:0 auto"></div>
    <div class="skel rv-sk-title" style="width:70%;margin:20px auto 0"></div>
    <div class="skel rv-sk-line" style="width:84%;margin:24px auto 0"></div>
  </div><div class="skel" style="height:96px;border-radius:20px"></div></div>`;
}

const STARTERS_SKEL = html`${[0, 1, 2, 3, 4, 5].map(() => html`<div class="skel" style="height:52px;border-radius:12px"></div>`)}`;

function pageView() {
  return html`<div class="page rv-ask-page">
    <header class="rv-ask-hero">
      <p class="rv-ask-eyebrow">${SPARK}Ask AI</p>
      <h1 class="h1">Ask about your money.</h1>
      <p class="lead">Ask anything about your spending, subscriptions and budget. It only reads your data. It can write a draft email, but it can never send one.</p>
      <button class="btn btn-ghost btn-sm rv-ask-new" data-new>New question</button>
    </header>
    <div class="rv-ask-thread" data-thread role="log" aria-live="polite" aria-label="Your questions and answers"></div>
    <div class="rv-ask-dock">
      <form class="rv-ask-composer" data-form>
        <label class="sr-only" for="rv-ask-box">Your question</label>
        <textarea id="rv-ask-box" class="rv-ask-input" rows="1" maxlength="2000" placeholder="Ask anything about your money" autocomplete="off"></textarea>
        <button class="rv-ask-send" type="submit" aria-label="Send your question" disabled>${ic('up')}</button>
      </form>
      <div class="rv-ask-hint"><span class="rv-ask-keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span>
        <span class="rv-ask-safe">${ic('lock')}Reads your data. Drafts only, never sends.</span></div>
    </div>
    <section class="rv-ask-starters" data-starters aria-label="Questions to start with">
      <h2 class="rv-ask-starters-t">Try one of these</h2>
      <div class="rv-ask-starter-grid" data-grid>${STARTERS_SKEL}</div>
    </section>
  </div>`;
}

/* ---------- view ---------- */
export async function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'rv rv-ask-view';
  root.appendChild(wrap);
  mount(wrap, skeleton());

  // Without an audit there is nothing to read. If the check itself fails, let them try anyway.
  let state = null;
  try { state = await store.state(); } catch { /* the composer shows a clear error on send */ }
  if (!wrap.isConnected) return undefined;
  if (state && !state.run) {
    // no audit (for example after "Reset demo data"): the old conversation no longer means anything
    Object.assign(chat, { sessionId: null, turns: [] });
    mount(wrap, noAuditView());
    return undefined;
  }

  mount(wrap, pageView());
  const box = $('.rv-ask-input', wrap);
  const sendBtn = $('.rv-ask-send', wrap);
  const thread = $('[data-thread]', wrap);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = () => matchMedia('(hover: none)').matches;

  const syncComposer = () => {
    wrap.classList.toggle('is-chat', chat.turns.length > 0);
    sendBtn.disabled = chat.busy || !box.value.trim();
    sendBtn.classList.toggle('is-busy', chat.busy);
    const n = $('[data-new]', wrap); if (n) n.disabled = chat.busy;
    wrap.querySelectorAll('[data-retry]').forEach((b) => { b.disabled = chat.busy; });
  };
  const growBox = () => { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 180) + 'px'; };
  const showTurn = (el, smooth) => el && el.scrollIntoView({ behavior: smooth && !reduced() ? 'smooth' : 'auto', block: 'start' });

  const paintTurn = (t) => {
    let el = thread.querySelector(`[data-turn="${t.id}"]`);
    if (el) mount(el.querySelector('[data-turn-body]'), turnInner(t));
    else { thread.insertAdjacentHTML('beforeend', String(turnTpl(t))); el = thread.lastElementChild; }
    syncComposer(); // first: this collapses the header, which moves the question up the page
    if (t.isNew) { t.isNew = false; showTurn(el, true); }
  };
  notify = paintTurn;

  // coming back to the page: show the conversation as it stands
  if (chat.turns.length) {
    mount(thread, html`${chat.turns.map(turnTpl)}`);
    chat.turns.forEach((t) => { t.isNew = false; });
    showTurn(thread.lastElementChild, false);
  }
  syncComposer();
  if (!touch()) box.focus({ preventScroll: true });

  const submit = () => {
    if (!ask(box.value)) return;
    box.value = ''; growBox(); syncComposer();
    if (!touch()) box.focus({ preventScroll: true });
  };

  const offs = [
    on(wrap, 'submit', '[data-form]', (e) => { e.preventDefault(); submit(); }),
    on(wrap, 'input', '.rv-ask-input', () => { growBox(); syncComposer(); }),
    on(wrap, 'keydown', '.rv-ask-input', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    }),
    on(wrap, 'click', '[data-starter]', (e, t) => { ask(t.dataset.starter); if (!touch()) box.focus({ preventScroll: true }); }),
    on(wrap, 'click', '[data-retry]', (e, t) => {
      if (chat.busy) return;
      const turn = chat.turns.find((x) => x.id === Number(t.dataset.retry));
      if (turn) runTurn(turn);
      if (!touch()) box.focus({ preventScroll: true }); // the button that had focus is about to go away
    }),
    on(wrap, 'click', '[data-new]', () => {
      if (chat.busy) return;
      Object.assign(chat, { sessionId: null, turns: [] });
      mount(thread, '');
      syncComposer();
      scrollTo({ top: 0, behavior: 'auto' });
      box.focus({ preventScroll: true });
    }),
  ];

  // starter questions come from the server; without them the composer is still enough
  api.get('/api/chat-suggestions').then((r) => {
    if (!wrap.isConnected) return;
    const list = (r && r.suggestions) || [];
    const grid = $('[data-grid]', wrap);
    if (!list.length) { $('[data-starters]', wrap).hidden = true; return; }
    mount(grid, html`${list.map((q) => html`<button class="rv-ask-starter" type="button" data-starter="${q}"><span>${q}</span>${ic('arrow')}</button>`)}`);
  }).catch(() => { const st = $('[data-starters]', wrap); if (st) st.hidden = true; });

  return () => { notify = null; offs.forEach((f) => f()); };
}
