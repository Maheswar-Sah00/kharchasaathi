/* =====================================================================
   KharchaSaathi - core.js
   Shared helpers for every view. Import what you need:
     import { html, raw, mount, api, store, fmt, KIND, GROUP, tip, toast,
              reveal, countUp, md, cssVar, navigate, on } from '../core.js';
   ===================================================================== */

/* ---------- Safe HTML templating ----------
   html`...` escapes every interpolated value unless it is itself html`` or raw().
   Arrays are joined. null/false/undefined render as nothing.               */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const renderVal = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(renderVal).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += renderVal(vals[i]); });
  return new Raw(out);
}
/** Replace an element's content with a template. Returns the element. */
export function mount(el, tpl) { el.innerHTML = tpl instanceof Raw ? tpl.s : String(tpl); return el; }
/** Make a DOM node from a template (first element). */
export function el(tpl) { const t = document.createElement('template'); t.innerHTML = String(tpl).trim(); return t.content.firstElementChild; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
/** Delegated event: on(root, 'click', '[data-act=save]', (e, target) => ...) */
export function on(root, type, selector, fn, opts) {
  const h = (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(e, t); };
  root.addEventListener(type, h, opts);
  return () => root.removeEventListener(type, h, opts);
}

/* ---------- Formatting (Indian conventions, simple English) ---------- */
const inrFmt0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFmt2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmt = {
  /** ₹1,499  (fmt.inr(1499.5, 2) -> ₹1,499.50) */
  inr: (n, decimals = 0) => (n < 0 ? '−' : '') + '₹' + (decimals ? inrFmt2 : inrFmt0).format(Math.abs(Number(n) || 0)),
  /** plain number with Indian grouping: 1,23,456 */
  n: (n) => inrFmt0.format(Number(n) || 0),
  /** ₹63k / ₹1.2L - for tight chart labels only */
  inrShort: (n) => {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr';
    if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(1).replace(/\.0$/, '') + 'L';
    if (a >= 1e3) return s + '₹' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return s + '₹' + Math.round(a);
  },
  pct: (n, d = 0) => `${Number(n).toFixed(d)}%`,
  signedPct: (n, d = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Number(n)).toFixed(d)}%`,
  /** '2026-09-05' -> '5 Sep' ; long=true -> '5 Sep 2026' */
  date: (iso, long = false) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]}${long ? ' ' + y : ''}`; },
  /** '2026-08' -> 'Aug' ; long -> 'August 2026' */
  month: (ym, long = false) => { const [y, m] = ym.split('-').map(Number); return long ? `${MONTHS_LONG[m - 1]} ${y}` : MONTHS[m - 1]; },
  plural: (n, one, many) => `${fmt.n(n)} ${n === 1 ? one : (many || one + 's')}`,
  time: (iso) => (iso || '').slice(11, 16),
};

/* ---------- Plain-English names for what the agent finds ----------
   Use these labels everywhere. Never show raw kinds like "zombie_charge". */
export const KIND = {
  duplicate:          { label: 'Charged twice',               short: 'Double charge',   group: 'back' },
  zombie_charge:      { label: 'Charged after you cancelled', short: 'After cancelling', group: 'back' },
  trial_conversion:   { label: 'Free trial turned paid',      short: 'Trial turned paid', group: 'stop' },
  price_hike:         { label: 'Price went up',               short: 'Price up',        group: 'up' },
  bank_fee_hike:      { label: 'Bank fee went up',            short: 'Bank fee up',     group: 'up' },
  subscription:       { label: 'Monthly subscription',        short: 'Subscription',    group: 'keep' },
  duplicate_rejected: { label: 'Looked double, but it is fine', short: 'Not a double charge', group: 'keep' },
  budget:             { label: 'Monthly budget',              short: 'Budget',          group: 'keep' },
};
/* Action groups: the colour code used across the app (like Babel's
   blue = translate / orange = store page / grey = skip).                  */
export const GROUP = {
  back: { label: 'Get money back', hint: 'Money taken by mistake. Ask for it back.', color: 'var(--c-blue)', soft: 'var(--c-blue-soft)', text: 'var(--t-blue)' },
  stop: { label: 'Stop paying',    hint: 'Things to cancel to save every month.',     color: 'var(--c-orange)', soft: 'var(--c-orange-soft)', text: 'var(--t-bad)' },
  up:   { label: 'Price went up',  hint: 'Same thing, higher price. Check it is still worth it.', color: 'var(--c-red)', soft: 'var(--c-red-soft)', text: 'var(--t-bad)' },
  keep: { label: 'Fine for now',   hint: 'Nothing to do.',                              color: 'var(--ink-4)', soft: 'var(--bg-sunk)', text: 'var(--ink-3)' },
};
/* ---------- Plain English ----------
   The agent writes its plans, questions and errors for itself. plain() says the same thing in everyday words. */
const PLAIN = [
  [/\btreated as data only and marked suspicious\b/gi, 'only read, not obeyed, and it is flagged for you'], [/\btreated as data only\b/gi, 'only read, not obeyed'],
  [/\breview it in the app\b/gi, 'look at it'],
  [/\bquarantined(?=\s+(?:bank\s+)?rows?\b)/gi, 'set-aside'], [/\bquarantined?\b/gi, 'set aside'],
  [/\bcorrupted\/password-protected\b/gi, 'damaged or locked'], [/\bcorrupt(ed)?\b/gi, 'damaged'],
  [/\bcategori[sz]ation\b/gi, 'sorting'], [/\bcategori[sz]ing\b/gi, 'sorting'], [/\bcategori[sz]ed\b/gi, 'sorted'], [/\bcategori[sz]e\b/gi, 'sort'],
  [/\bresolve low-confidence merchants\b/gi, 'check the shops it is unsure about'],
  [/\blow-confidence merchants\b/gi, 'shops it is unsure about'], [/\blow-confidence\b/gi, 'unsure'],
  [/\(lookup\/ask_user\)/gi, '(look them up or ask you)'], [/\bask_user\b/g, 'ask you'], [/\bask user\b/gi, 'ask you'], [/\bdetectors\b/gi, 'checks'], [/\bdetector\b/gi, 'check'], [/\bre-?run (the|this) audit\b/gi, 'run the audit again'],
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
export function plain(text) {
  let s = String(text || '');
  for (const [re, to] of PLAIN) s = s.replace(re, (m) => (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to));
  s = s.replace(/\b(20\d\d-\d\d-\d\d)\b/g, (m) => fmt.date(m, true));
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export const SOURCE_LABEL = { memory: 'Your earlier fix', rule: 'Known shop', llm: 'AI guess', 'agent+web': 'Web lookup', safety: 'Safety check' };
export const DRAFT_KIND = { dispute: 'Dispute', refund: 'Refund request', cancellation: 'Cancel request', escalation: 'Escalation' };
export const DRAFT_STATUS = {
  PENDING_APPROVAL: { label: 'Waiting for you', cls: 'badge-warn' },
  APPROVED: { label: 'Approved', cls: 'badge-blue' },
  SENT: { label: 'Sent', cls: 'badge-good' },
  REJECTED: { label: 'Not sending', cls: '' },
};

/* ---------- API ---------- */
async function jsonOrThrow(r) {
  let body = null;
  try { body = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    const d = body && body.detail;
    const msg = typeof d === 'string' ? d : d && d.message ? d.message : `Request failed (${r.status})`;
    const err = new Error(msg); err.status = r.status; err.body = body; throw err;
  }
  return body;
}
export const api = {
  get: (path) => fetch(path, { headers: { Accept: 'application/json' } }).then(jsonOrThrow),
  post: (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(jsonOrThrow),
  /** Upload File objects. Returns {batch, files, skipped}. */
  upload: (files) => { const fd = new FormData(); [...files].forEach((f) => fd.append('files', f)); return fetch('/api/upload', { method: 'POST', body: fd }).then(jsonOrThrow); },
  /**
   * Read a Server-Sent-Events stream (works for POST too).
   * stream('/api/run', {method:'POST', body:{goal,...}, onEvent: e => ..., signal})
   * stream('/api/replay?speed=1.5', {onEvent})
   * Event types: goal, plan, replan, tool_call, tool_result, thinking, text, refusal, error, final.
   * Resolves with the final event.
   */
  async stream(path, { method = 'GET', body, onEvent, signal } = {}) {
    const r = await fetch(path, { method, signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) await jsonOrThrow(r);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', last = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!line) continue;
        try { last = JSON.parse(line); onEvent && onEvent(last); } catch (e) { console.warn('bad event', line); }
      }
    }
    return last;
  },
};

/* ---------- Store: cached /api/state + simple pub/sub ---------- */
const listeners = new Set();
let statePromise = null;
export const store = {
  /** Latest audit state (cached). force=true refetches. */
  state(force = false) {
    if (force || !statePromise) statePromise = api.get('/api/state').catch((e) => { statePromise = null; throw e; });
    return statePromise;
  },
  invalidate() { statePromise = null; listeners.forEach((fn) => fn()); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Session values shared between views (e.g. upload batch id, goal, target). */
  session: {},
};

/** Derived numbers for a finished audit, so every view says the same thing. */
export function summarize(s) {
  if (!s || !s.run) return null;
  const F = (k) => (s.findings || []).filter((f) => f.kind === k);
  const budget = (F('budget').slice(-1)[0] || {}).details || null;
  const subs = F('subscription').map((f) => f.details);
  const dups = F('duplicate').map((f) => ({ ...f.details, id: f.id }));
  const zombies = F('zombie_charge').map((f) => ({ ...f.details, id: f.id }));
  const trials = F('trial_conversion').map((f) => ({ ...f.details, id: f.id }));
  const hikes = [...F('price_hike'), ...F('bank_fee_hike')].map((f) => ({ ...f.details, id: f.id, kind: f.kind }));
  const notDups = F('duplicate_rejected').map((f) => f.details);
  const drafts = s.drafts || [];
  const months = budget ? budget.months : [...new Set((s.transactions || []).map((t) => t.date.slice(0, 7)))].sort();
  return {
    budget, subs, dups, zombies, trials, hikes, notDups, drafts, months,
    subsMonthly: subs.reduce((a, x) => a + x.latest_amount, 0),
    subsYearly: subs.reduce((a, x) => a + x.annual_cost, 0),
    moneyBack: dups.reduce((a, x) => a + x.amount, 0) + zombies.reduce((a, x) => a + x.amount, 0),
    hikesYearly: hikes.reduce((a, x) => a + x.extra_per_year, 0),
    cancelMerchants: budget ? budget.cancel_merchants || [] : [],
    pendingDrafts: drafts.filter((d) => d.status === 'PENDING_APPROVAL').length,
    suspicious: (s.transactions || []).filter((t) => t.flags === 'prompt_injection'),
    needsReview: (s.transactions || []).filter((t) => (t.confidence ?? 1) < 0.7),
  };
}

/* ---------- Tiny markdown (agent summary). Escapes first, then formats. ---------- */
export function md(src) {
  const lines = esc(src || '').split(/\r?\n/);
  let out = '', list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { close(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+\.\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (l.trim() === '') { close(); }
    else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return raw(out);
}

/* ---------- CSS variable reader (for canvas/SVG that needs real colours) ---------- */
export const cssVar = (name, elx = document.documentElement) => getComputedStyle(elx).getPropertyValue(name).trim();

/* ---------- Tooltip: one shared floating element ----------
   tip.show(htmlString | html``, clientX, clientY); tip.hide();
   Or declaratively: give elements data-tip="<b>Netflix</b> ₹649" and call tip.bind(container). */
let tipEl = null;
export const tip = {
  show(content, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'ks-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.innerHTML = String(content);
    const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > innerWidth - 8) left = x - w - pad;
    if (top + h > innerHeight - 8) top = y - h - pad;
    tipEl.style.left = Math.max(8, left) + 'px'; tipEl.style.top = Math.max(8, top) + 'px';
    tipEl.classList.add('is-on');
  },
  hide() { tipEl && tipEl.classList.remove('is-on'); },
  bind(root) {
    const move = (e) => { const t = e.target.closest('[data-tip]'); if (t && root.contains(t)) tip.show(t.getAttribute('data-tip'), e.clientX, e.clientY); else tip.hide(); };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', tip.hide);
    return () => { root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', tip.hide); tip.hide(); };
  },
};

/* ---------- Toast ---------- */
export function toast(message, { kind = 'info', ms = 3200 } = {}) {
  let host = document.querySelector('.ks-toasts');
  if (!host) { host = document.createElement('div'); host.className = 'ks-toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const color = { info: 'var(--on-inverse)', good: 'var(--s-good)', bad: 'var(--s-critical)', warn: 'var(--s-warn)' }[kind];
  const t = el(html`<div class="ks-toast"><span class="dot" style="background:${raw(color)}"></span><span>${message}</span></div>`);
  host.appendChild(t);
  setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Motion helpers ---------- */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let revealObs = null;
/** Fade-up elements with class .reveal inside root as they scroll into view. Optional --d delay via style. */
export function reveal(root = document) {
  if (!revealObs) {
    revealObs = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); revealObs.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }
  $$('.reveal:not(.is-in)', root).forEach((n) => (reduced() ? n.classList.add('is-in') : revealObs.observe(n)));
}
/** Animate a number into an element. format: (n) => string */
export function countUp(node, to, { from = 0, ms = 1100, format = (n) => fmt.n(n) } = {}) {
  if (!node) return;
  if (reduced()) { node.textContent = format(to); return; }
  const t0 = performance.now();
  /* A requestAnimationFrame timestamp can be earlier than performance.now() above, so clamp at 0 too. */
  const step = (t) => { const p = Math.max(0, Math.min(1, (t - t0) / ms)); const e = 1 - Math.pow(1 - p, 4); node.textContent = format(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Theme: circle reveal from the toggle button ---------- */
export function currentTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ks-theme', t); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('ks:theme', { detail: t }));
}
export function toggleTheme(originEl) {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const r0 = originEl ? originEl.getBoundingClientRect() : { left: innerWidth - 60, top: 20, width: 40, height: 40 };
  const x = r0.left + r0.width / 2, y = r0.top + r0.height / 2;
  if (!document.startViewTransition || reduced()) { applyTheme(next); return; }
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const rootEl = document.documentElement;
  rootEl.classList.add('ks-theming');
  const t = document.startViewTransition(() => applyTheme(next));
  t.finished.finally(() => rootEl.classList.remove('ks-theming'));
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
}

/* ---------- Router hooks (implemented in app.js) ---------- */
export function navigate(path) { if (location.hash !== '#' + path) location.hash = path; else window.dispatchEvent(new HashChangeEvent('hashchange')); }
export function query() { const q = location.hash.split('?')[1] || ''; return Object.fromEntries(new URLSearchParams(q)); }
