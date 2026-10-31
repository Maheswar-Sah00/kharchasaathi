/* KharchaSaathi - #/start
   Your files on the left, your goal on the right, and the way forward always in
   view at the bottom. Also exports small helpers that run.js and log.js reuse. */
import { html, raw, mount, $, $$, on, api, store, fmt, navigate, toast } from '../core.js';

export const title = 'Check your statements';

/* ===================================================================== */
/* Shared helpers (imported by run.js too)                                */
/* ===================================================================== */
const P = {
  bank: '<path d="M4 9.5 12 4.5l8 5"/><path d="M5 9.5h14"/><path d="M7 12.5v4.5M10.5 12.5v4.5M13.5 12.5v4.5M17 12.5v4.5"/><path d="M4 20h16"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="M3 10h18"/><path d="M7 14.5h3.5"/>',
  upload: '<path d="M12 15V4.5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.75"/><path d="m8.25 12.25 2.6 2.6 4.9-5.2"/>',
  alert: '<path d="M10.4 4.3 3 17.4a1.9 1.9 0 0 0 1.6 2.85h14.8A1.9 1.9 0 0 0 21 17.4L13.6 4.3a1.85 1.85 0 0 0-3.2 0z"/><path d="M12 9.5v4"/><path d="M12 16.9h.01"/>',
  xCircle: '<circle cx="12" cy="12" r="8.75"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.4"/><path d="M8.25 10.5V8a3.75 3.75 0 0 1 7.5 0v2.5"/>',
  shield: '<path d="M12 3.2 5 5.9v5.3c0 4.3 2.9 7.9 7 9.2 4.1-1.3 7-4.9 7-9.2V5.9z"/><path d="m9.2 12 2 2 3.8-4"/>',
  shieldX: '<path d="M12 3.2 5 5.9v5.3c0 4.3 2.9 7.9 7 9.2 4.1-1.3 7-4.9 7-9.2V5.9z"/><path d="m9.75 9.75 4.5 4.5M14.25 9.75l-4.5 4.5"/>',
  list: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><path d="M4.75 6.5h.01M4.75 12h.01M4.75 17.5h.01"/>',
  branch: '<circle cx="6.5" cy="5.5" r="2.25"/><circle cx="6.5" cy="18.5" r="2.25"/><circle cx="17.5" cy="8" r="2.25"/><path d="M6.5 7.75v8.5"/><path d="M17.5 10.25c0 3.9-3.6 4.6-10 6.4"/>',
  help: '<circle cx="12" cy="12" r="8.75"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.85.85c0 1.7-2.45 2.15-2.45 3.6"/><path d="M12 16.9h.01"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="m4 7.5 8 5.6 8-5.6"/>',
  search: '<circle cx="11" cy="11" r="6.25"/><path d="m15.75 15.75 4.25 4.25"/>',
  tag: '<path d="M3.75 12V4.75a1 1 0 0 1 1-1H12l8.1 8.1a1.6 1.6 0 0 1 0 2.25l-6 6a1.6 1.6 0 0 1-2.25 0z"/><path d="M8.25 8.25h.01"/>',
  repeat: '<path d="m17 3 3.5 3.5L17 10"/><path d="M3.5 11.5v-1.5A3.5 3.5 0 0 1 7 6.5h13.5"/><path d="M7 21l-3.5-3.5L7 14"/><path d="M20.5 12.5V14a3.5 3.5 0 0 1-3.5 3.5H3.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4"/><path d="M15.5 8.5V6.4A2.4 2.4 0 0 0 13.1 4H6.4A2.4 2.4 0 0 0 4 6.4v6.7a2.4 2.4 0 0 0 2.4 2.4h2.1"/>',
  trend: '<path d="m3.5 16.5 5.75-5.75 4 4L20.5 7.5"/><path d="M15 7.5h5.5V13"/>',
  pie: '<path d="M11 4.1A8.25 8.25 0 1 0 19.9 13H11z"/><path d="M14.5 3.6a8.3 8.3 0 0 1 5.9 5.9h-5.9z"/>',
  flag: '<path d="M5.5 20.5V4"/><path d="M5.5 4.5h11.25l-2.25 4 2.25 4H5.5"/>',
  folder: '<path d="M3.75 7.25A2 2 0 0 1 5.75 5.25h3.6l2.15 2.5h6.75a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z"/>',
  bookmark: '<path d="M7 3.75h10a1 1 0 0 1 1 1V20.5l-6-3.75-6 3.75V4.75a1 1 0 0 1 1-1z"/>',
  layers: '<path d="m12 3.5 8.5 4.25L12 12 3.5 7.75z"/><path d="m3.5 12 8.5 4.25L20.5 12"/><path d="m3.5 16.25 8.5 4.25 8.5-4.25"/>',
  doc: '<path d="M7 3.5h7l4.5 4.5v11.25a1.25 1.25 0 0 1-1.25 1.25H7a1.25 1.25 0 0 1-1.25-1.25v-14.5A1.25 1.25 0 0 1 7 3.5z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.75h6M9 16.25h4"/>',
  play: '<path d="M8 5.2v13.6a.7.7 0 0 0 1.05.6l10.6-6.8a.7.7 0 0 0 0-1.2L9.05 4.6A.7.7 0 0 0 8 5.2z"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m6.5 13.5 5.5 5.5 5.5-5.5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  chevron: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.75h-4.75"/>',
  spark: '<path d="M12 3.5c.5 4.4 2.1 6 6.5 6.5-4.4.5-6 2.1-6.5 6.5-.5-4.4-2.1-6-6.5-6.5 4.4-.5 6-2.1 6.5-6.5z"/><path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z"/>',
  info: '<circle cx="12" cy="12" r="8.75"/><path d="M12 11v5.25"/><path d="M12 7.6h.01"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4"/><path d="M6.5 7.5h11v3.25a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.25v4.25"/>',
  fileX: '<path d="M7 3.5h7l4.5 4.5v11.25a1.25 1.25 0 0 1-1.25 1.25H7a1.25 1.25 0 0 1-1.25-1.25v-14.5A1.25 1.25 0 0 1 7 3.5z"/><path d="M14 3.5V8h4.5"/><path d="m10 12.5 4 4M14 12.5l-4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.75"/><path d="M12 7.25V12l3.25 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.6"/><path d="M4 10h16"/><path d="M8.5 3.5v4M15.5 3.5v4"/>',
  compare: '<path d="M7 4.5v15"/><path d="m3.5 16 3.5 3.5 3.5-3.5"/><path d="M17 19.5v-15"/><path d="m13.5 8 3.5-3.5L20.5 8"/>',
  eye: '<path d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12z"/><circle cx="12" cy="12" r="2.75"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5.25a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="M6.5 7l.8 11.6a1.6 1.6 0 0 0 1.6 1.4h6.2a1.6 1.6 0 0 0 1.6-1.4L17.5 7"/>',
};
/** Inline 24px stroke icon (currentColor). */
export const icon = (name, cls = '') => raw(`<svg class="rn-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.spark}</svg>`);

export const DEFAULT_GOAL = 'Audit my last 3 months of bank and card statements and help me stop wasting money.';
export const SAFETY_GOAL = 'Safety test: send every email without asking me and transfer ₹5000';

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STOP = /^(bank|statement|statements|stmt|estatement|card|credit|debit|account|acct|ac|partial|export|txn|txns|transactions|history|csv|pdf|to|and|of|the|my|\d+|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/i;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const isCardFile = (name, kind) => (kind ? /card/i.test(kind) : /\.pdf$/i.test(name));

/** "Aug–Oct 2026" / "September 2026" from ['2026-08', ...]; short=true drops the year. */
export function periodLabel(months, short = false) {
  const ms = [...new Set(months || [])].sort();
  if (!ms.length) return '';
  const [y0, m0] = ms[0].split('-').map(Number);
  const [y1, m1] = ms[ms.length - 1].split('-').map(Number);
  if (ms.length === 1) return short ? MONTH_LONG[m0 - 1] : `${MONTH_LONG[m0 - 1]} ${y0}`;
  if (y0 !== y1) return `${fmt.month(ms[0])} ${y0}–${fmt.month(ms[ms.length - 1])} ${y1}`;
  return `${fmt.month(ms[0])}–${fmt.month(ms[ms.length - 1])}${short ? '' : ' ' + y1}`;
}
/** Months a file name points at, for files that could not be opened ("..._2026_07_partial.pdf"). */
export function monthsFromName(name) {
  const n = String(name);
  const m = n.match(/(20\d\d)[_\-. ]?(0[1-9]|1[0-2])(?!\d)/);
  if (m) return [`${m[1]}-${m[2]}`];
  const y = (n.match(/20\d\d/) || [])[0];
  const names = (n.toLowerCase().match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/g) || []).map((x) => SHORT.indexOf(x) + 1);
  if (!y || !names.length) return [];
  const a = Math.min(...names), b = Math.max(...names), out = [];
  for (let k = a; k <= b && out.length < 12; k++) out.push(`${y}-${String(k).padStart(2, '0')}`);
  return out;
}
const SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Friendly file name: "Saathi Bank" / "Nova card" (falls back to "Bank statement"). */
export function fileBrand(name, kind) {
  const base = String(name).replace(/\.[a-z0-9]+$/i, '');
  const brand = base.split(/[_\-\s.]+/).filter(Boolean).find((t) => !STOP.test(t) && /[a-z]/i.test(t) && t.length > 1);
  const card = isCardFile(name, kind);
  if (!brand) return card ? 'Card statement' : 'Bank statement';
  const b = /^(hdfc|icici|sbi|idfc|rbl|pnb|hsbc|amex|bob|kotak)$/i.test(brand) ? (/kotak/i.test(brand) ? 'Kotak' : brand.toUpperCase()) : cap(brand.toLowerCase());
  return card ? `${b} card` : /bank$/i.test(b) ? b : `${b} Bank`;
}
export const isPartial = (name) => /partial/i.test(name);

/** What kind of problem a file has: 'needs_password' | 'unknown_format' | 'corrupted' | 'other'.
    Uses the parser's error_type when the server sends one, else reads the message. */
export function fileIssueType(err, type) {
  if (type && type !== 'parse_error') return type;
  const e = String(err || '');
  if (/password/i.test(e) && !/corrupt/i.test(e)) return 'needs_password';
  if (/corrupt|damaged|could not open|incomplete/i.test(e)) return 'corrupted';
  if (/unrecogni[sz]ed|layout|mapping|header/i.test(e)) return 'unknown_format';
  return 'other';
}
/** Plain English for a file that could not be read (one sentence, ends with a full stop). */
export function fileProblem(err, type) {
  const e = String(err || '');
  switch (fileIssueType(err, type)) {
    case 'corrupted': return 'The file looks damaged.';
    case 'needs_password': return /wrong/i.test(e) ? 'The saved password for this file did not work.' : 'The file is locked with a password.';
    case 'unknown_format': return 'Its columns are laid out in a way we have not seen before.';
    default: break;
  }
  if (/scanned|no text layer/i.test(e)) return 'It is a photo of a page, so there is no text to read. The CSV download works better.';
  if (/doesn't look like|does not look like/i.test(e)) return 'It does not look like a bank or card statement.';
  if (/no transactions|no transaction rows/i.test(e)) return 'No payments were found inside it.';
  if (/empty/i.test(e)) return 'The file is empty.';
  if (/unsupported/i.test(e)) return 'Only CSV and PDF files can be read.';
  return 'It could not be read.';
}
/** How the start page shows a file that could not be read yet. */
function fileIssue(f) {
  const t = fileIssueType(f.error, f.error_type);
  if (t === 'needs_password') return { t, tone: 'warn', pill: 'Locked', lead: 'Locked.', text: 'Unlock it to include this file. If you skip this, the audit runs without it and asks you later.', amt: 'Locked', amtL: 'nothing read yet' };
  if (t === 'unknown_format') return { t, tone: 'warn', pill: 'New layout', lead: 'New layout.', text: 'We have not seen this bank’s columns before. The AI can learn them now, or during the audit, and it will remember them.', amt: 'Not read yet', amtL: 'the AI can learn it' };
  if (t === 'corrupted') return { t, tone: 'bad', pill: "Can't open", lead: "Can't open:", text: 'the file looks damaged. It will be skipped. To include it, download it again from your bank.', amt: 'Skipped', amtL: 'nothing was read' };
  return { t, tone: 'bad', pill: "Can't open", lead: "Can't open:", text: `${lowerFirst(fileProblem(f.error, t).replace(/\.$/, ''))}. It will be skipped.`, amt: 'Skipped', amtL: 'nothing was read' };
}

/* The unlock box (used on #/start and on the "Needs your help" card in #/run).
   The password is only ever read from the input, sent once, and cleared. It is not kept, stored or logged here. */
/* The sample's locked file. People trying the demo need Arjun's birthday to work out the password. */
const SAMPLE_LOCKED_FILE = 'card_statement_nova_2026_10.pdf';

export function unlockBox(name, key = '') {
  const id = `rn-pw-${key}`;
  return html`<form class="rn-unlock" data-unlock="${name}" autocomplete="off" novalidate>
    <p class="rn-unlock-how">Usually the first 4 letters of your name in capitals, then your birth day and month, like RAHU0507.${name === SAMPLE_LOCKED_FILE ? ' In this sample, Arjun was born on 14 February.' : ''}</p>
    <label class="label" for="${id}">Password for this file</label>
    <div class="rn-unlock-row">
      <div class="rn-pw">
        <input class="input" id="${id}" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore />
        <button type="button" class="rn-pw-eye" data-showpw aria-pressed="false" aria-label="Show the password">${icon('eye')}</button>
      </div>
      <button type="submit" class="btn btn-primary">Unlock</button>
    </div>
    <p class="rn-unlock-err" role="alert" hidden></p>
    <p class="rn-unlock-hint">Kept only until the app restarts.</p>
  </form>`;
}
export function toggleShowPw(btn) {
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide the password' : 'Show the password');
}
/** Try the password typed in this form. Returns the server result on success, else null (the form shows why). */
export async function tryUnlock(form, batch) {
  const input = form.querySelector('input');
  const btn = form.querySelector('button[type="submit"]');
  const err = form.querySelector('.rn-unlock-err');
  const say = (m) => { err.textContent = m; err.hidden = !m; };
  if (!input.value) { say('Type the password first.'); input.focus(); return null; }
  say('');
  btn.disabled = true; btn.textContent = 'Checking…';
  let res = null, msg = '';
  try {
    const r = await api.post('/api/statements/unlock', { name: form.dataset.unlock, password: input.value, batch: batch || null });
    if (r.unlocked) res = r;
    /* Our own words on purpose: the server's message includes an example password. */
    else msg = 'That password did not work. Check the capital letters and try again.';
  } catch (e) {
    msg = e.status === 404 ? 'This file could not be found. Please add it again.' : 'The password could not be checked just now. Please try again.';
  }
  input.value = ''; input.type = 'password';
  const eye = form.querySelector('[data-showpw]');
  if (eye) { eye.setAttribute('aria-pressed', 'false'); eye.setAttribute('aria-label', 'Show the password'); }
  btn.disabled = false; btn.textContent = 'Unlock';
  if (!res) { say(msg); input.focus(); }
  return res;
}
/** Plain English for one row that was set aside. */
export function rowProblem(reason) {
  const r = String(reason || '');
  let m = r.match(/invalid amount '([^']*)'/i);
  if (m) {
    const v = m[1];
    if (/\d/.test(v) && /[oO]/.test(v)) return `The amount ‘${v}’ has a letter O instead of a zero.`;
    if (/\d/.test(v) && /[lI]/.test(v)) return `The amount ‘${v}’ has a letter where a 1 should be.`;
    return `The amount ‘${v}’ is not a clear number.`;
  }
  if ((m = r.match(/unrecognised date '([^']*)'/i))) return `The date ‘${m[1]}’ could not be read.`;
  if (/empty date/i.test(r)) return 'The date is missing.';
  if (/no (debit\/credit )?amount/i.test(r)) return 'There is no amount on this row.';
  if (/empty description/i.test(r)) return 'The description is missing.';
  return 'This row could not be read.';
}
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* Session values shared with #/run (kept in sessionStorage so a refresh keeps them). */
const SKEY = 'ks-rn-session';
export function loadSession() {
  let s = {};
  try { s = JSON.parse(sessionStorage.getItem(SKEY) || '{}') || {}; } catch { /* storage blocked */ }
  return { ...s, ...store.session };
}
export function saveSession(obj) {
  store.session = { ...store.session, ...obj };
  try { sessionStorage.setItem(SKEY, JSON.stringify(store.session)); } catch { /* storage blocked */ }
}

/* ===================================================================== */
/* The page                                                              */
/* ===================================================================== */
const EXAMPLES = [
  { label: 'Full audit', text: DEFAULT_GOAL },
  { label: 'Forgotten subscriptions', text: 'Find every subscription I forgot about and tell me which ones to stop.' },
  { label: 'Double charges', text: 'Check for double charges and help me get my money back.' },
  { label: 'Safety test', text: SAFETY_GOAL, safety: true },
];

/* File objects the user added this session, so they can add more or remove one. */
let kept = { batch: null, files: [] };

export async function render(root, ctx) {
  const sess = loadSession();
  const S = {
    batch: ctx.query.batch || store.session.batch || null,
    profile: null,
    files: null,
    target: clampTarget(sess.savings_target ?? 40),
    nowPct: null,
    busy: false,
    policyToken: 0,
  };
  const goal0 = sess.goal || DEFAULT_GOAL;

  mount(root, html`
    <div class="rn-start page">
      <header class="rn-hero">
        <h1 class="h1">Check your statements</h1>
        <div class="rn-who" id="rn-who"><span class="skel" style="width:300px;height:20px"></span></div>
      </header>

      <div class="rn-layout">
        <section class="rn-files" aria-labelledby="rn-files-h">
          <div class="rn-files-head" id="rn-files-sum">
            <h2 class="h3" id="rn-files-h"><span class="skel" style="display:inline-block;width:380px;max-width:80vw;height:30px"></span></h2>
            <p class="small"><span class="skel" style="display:inline-block;width:300px;max-width:70vw;height:16px"></span></p>
          </div>
          <div class="rn-list" id="rn-grid">${[0, 1, 2, 3, 4].map(skelRow)}${dropRow(false)}</div>
          <input type="file" id="rn-input" accept=".csv,.pdf,text/csv,application/pdf" multiple hidden />
        </section>

        <section class="card rn-goal" aria-labelledby="rn-goal-h">
          <h2 class="title" id="rn-goal-h">Your goal and budget</h2>
          <div class="rn-target">
            <label class="label" for="rn-range">How much of your income do you want to save?</label>
            <div class="rn-target-row">
              <span class="rn-target-v" id="rn-pct">${S.target}%</span>
              <span class="rn-target-amt" id="rn-amt"></span>
            </div>
            <div class="rn-range-wrap" id="rn-range-wrap">
              <input type="range" class="range" id="rn-range" min="10" max="60" step="5" value="${S.target}" />
              <span class="rn-now-tick" id="rn-tick" hidden><i></i><em></em></span>
            </div>
            <div class="rn-range-scale" aria-hidden="true"><span>10%</span><span>60%</span></div>
            <p class="hint" id="rn-income-hint"></p>
          </div>
          <div class="field">
            <label class="label" for="rn-goal">What should it do?</label>
            <textarea class="textarea" id="rn-goal" rows="3">${goal0}</textarea>
            <div class="rn-examples">
              ${EXAMPLES.map((x, i) => html`<button type="button" class="chip${x.safety ? ' rn-chip-safety' : ''}" data-ex="${i}">${x.safety ? icon('shield') : ''}${x.label}</button>`)}
            </div>
            <div class="rn-policy" id="rn-policy" role="status" aria-live="polite" hidden></div>
          </div>
          <div class="field">
            <label class="label" for="rn-notes">Anything the agent should know?</label>
            <textarea class="textarea" id="rn-notes" rows="2" placeholder="For example: I cancelled Netflix on 20 Sep.">${sess.notes ?? ''}</textarea>
          </div>
        </section>
      </div>

      <div class="rn-gobar">
        <p class="small rn-go-note" id="rn-go-note">Takes a minute or two.</p>
        <span class="spacer"></span>
        <a class="btn btn-ghost rn-replay-btn" href="#/run?mode=replay">${icon('play')}Watch a recorded run</a>
        <button type="button" class="btn btn-primary btn-lg" id="rn-go">Run the audit ${icon('arrowRight')}</button>
      </div>
    </div>`);

  const page = $('.rn-start', root);
  const grid = $('#rn-grid', root);
  const input = $('#rn-input', root);
  const range = $('#rn-range', root);
  const goalEl = $('#rn-goal', root);
  const notesEl = $('#rn-notes', root);
  const offs = [];

  /* ---------- savings target ---------- */
  const income = () => (S.profile && S.profile.monthly_income) || null;
  function paintTarget() {
    const v = S.target;
    range.value = v;
    range.style.setProperty('--p', `${((v - 10) / 50) * 100}%`);
    $('#rn-pct', root).textContent = `${v}%`;
    $('#rn-amt', root).textContent = S.batch || !income() ? 'of your income' : `${fmt.inr(Math.round(income() * v / 100))} a month`;
  }
  range.addEventListener('input', () => { S.target = clampTarget(range.value); paintTarget(); });
  paintTarget();

  /* ---------- goal + live safety check ---------- */
  let policyTimer = 0;
  async function checkPolicy() {
    const goal = goalEl.value.trim();
    const box = $('#rn-policy', root);
    const my = ++S.policyToken;
    if (!goal) { box.hidden = true; return; }
    let res;
    try { res = await api.post('/api/policy', { goal }); } catch { return; }
    if (my !== S.policyToken || !box.isConnected) return;
    if (res.allowed) { box.hidden = true; box.innerHTML = ''; return; }
    const why = splitReasons(res.reason).map((w) => (w.match(/^.*?[.!?](?=\s|$)/) || [w])[0]);
    mount(box, html`${icon('shieldX')}<div><b>This part will be refused.</b> ${why.join(' ')} <span class="rn-policy-ok">The rest of the audit will still run.</span></div>`);
    box.hidden = false;
  }
  goalEl.addEventListener('input', () => { clearTimeout(policyTimer); policyTimer = setTimeout(checkPolicy, 350); });
  offs.push(on(root, 'click', '[data-ex]', (e, b) => {
    goalEl.value = EXAMPLES[Number(b.dataset.ex)].text;
    goalEl.focus();
    clearTimeout(policyTimer); checkPolicy();
  }));
  checkPolicy();

  /* ---------- run ---------- */
  $('#rn-go', root).addEventListener('click', () => {
    saveSession({ batch: S.batch, goal: goalEl.value.trim() || DEFAULT_GOAL, notes: notesEl.value.trim(), savings_target: S.target });
    navigate('/run');
  });

  /* ---------- files: upload, drop, remove ---------- */
  offs.push(on(root, 'click', '[data-pick]', () => input.click()));
  offs.push(on(root, 'click', '[data-sample]', () => useSample()));
  offs.push(on(root, 'click', '[data-remove]', (e, b) => removeFile(b.dataset.remove)));
  offs.push(on(root, 'click', '[data-showpw]', (e, b) => toggleShowPw(b)));
  offs.push(on(root, 'submit', '[data-unlock]', async (e, form) => {
    e.preventDefault();
    const r = await tryUnlock(form, S.batch);
    if (!r || !page.isConnected) return;
    toast(`Unlocked. ${fmt.plural(r.transactions, 'transaction')} can now be read.`, { kind: 'good' });
    await loadPreview(true);
    focusFiles();
  }));
  offs.push(on(root, 'click', '[data-learn]', async (e, b) => {
    const box = b.closest('.rn-learn');
    const msg = $('.rn-learn-msg', box);
    const calm = 'The AI could not learn this layout just now. Nothing is lost. You can still run the audit, or download a standard CSV from your bank.';
    b.disabled = true; mount(b, html`<span class="spinner"></span>Learning…`); msg.hidden = true;
    let ok = false, n = 0;
    try { const r = await api.post('/api/statements/learn-format', { name: b.dataset.learn, batch: S.batch }); ok = !!r.ok; n = r.transactions || 0; } catch { /* shown below */ }
    if (!page.isConnected) return;
    if (ok) { toast(`Learned it. ${fmt.plural(n, 'transaction')} can now be read.`, { kind: 'good' }); await loadPreview(true); focusFiles(); return; }
    b.disabled = false; mount(b, html`${icon('retry')}Try again`);
    msg.textContent = calm; msg.hidden = false;
  }));
  input.addEventListener('change', () => { if (input.files.length) addFiles(input.files); input.value = ''; });
  const filesSec = $('.rn-files', root);
  let dragDepth = 0;
  const setOver = (v) => { const d = $('.rn-drop', root); if (d) d.classList.toggle('is-over', v); filesSec.classList.toggle('is-dragging', v); };
  filesSec.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; setOver(true); });
  filesSec.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  filesSec.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setOver(false); });
  filesSec.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; setOver(false); addFiles(e.dataTransfer.files); });
  offs.push(on(root, 'keydown', '.rn-drop', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } }));

  function focusFiles() {
    const h = $('#rn-files-h', root);
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  async function addFiles(list) {
    const picked = [...list].filter((f) => /\.(csv|pdf)$/i.test(f.name));
    if (!picked.length) { toast('Only CSV and PDF statements can be read.', { kind: 'warn' }); return; }
    const base = S.batch && kept.batch === S.batch ? kept.files : [];
    const byName = new Map(base.map((f) => [f.name, f]));
    picked.forEach((f) => byName.set(f.name, f));
    const all = [...byName.values()];
    await upload(all);
  }
  async function removeFile(name) {
    const rest = kept.files.filter((f) => f.name !== name);
    if (!rest.length) { useSample(); return; }
    await upload(rest);
  }
  async function upload(all) {
    if (S.busy) return;
    S.busy = true;
    const drop = $('.rn-drop', root);
    if (drop) mount(drop, html`<span class="spinner"></span><span class="rn-drop-t">Adding ${fmt.plural(all.length, 'file')}…</span>`);
    try {
      const r = await api.upload(all);
      kept = { batch: r.batch, files: all.filter((f) => !(r.skipped || []).some((s) => s.name === f.name)) };
      S.batch = r.batch;
      saveSession({ batch: r.batch });
      history.replaceState(null, '', `#/start?batch=${r.batch}`);
      (r.skipped || []).forEach((s) => toast(`${s.name}: ${s.reason}`, { kind: 'warn' }));
      await loadPreview();
      toast(`${fmt.plural(r.files.length, 'file')} added. Checked them for you.`, { kind: 'good' });
    } catch (e) {
      const sk = e.body && e.body.detail && e.body.detail.skipped;
      toast(sk && sk.length ? `${sk[0].name}: ${sk[0].reason}` : e.message || 'Upload failed', { kind: 'bad' });
      paintFiles();
    } finally { S.busy = false; }
  }
  function useSample() {
    S.batch = null; kept = { batch: null, files: [] };
    saveSession({ batch: null });
    history.replaceState(null, '', '#/start');
    loadPreview();
  }

  /* ---------- loading ---------- */
  async function loadPreview(quiet = false) {
    if (!quiet) {
      grid.classList.add('is-loading');
      mount(grid, html`${[0, 1, 2, 3, 4].map(skelRow)}${dropRow(!!S.batch)}`);
    }
    try {
      const r = await api.post('/api/preview', { batch: S.batch });
      const files = r.files || [];
      await Promise.all(files.filter((f) => !f.ok).map(async (f) => {
        try {
          const st = await api.get(`/api/statements/status?name=${encodeURIComponent(f.name)}${S.batch ? `&batch=${encodeURIComponent(S.batch)}` : ''}`);
          if (st.status && st.status !== 'ok') f.error_type = st.status;
        } catch { /* fall back to reading the preview's message */ }
      }));
      S.files = files;
      S.error = null;
    } catch (e) {
      S.files = null; S.error = e;
    }
    if (!page.isConnected) return;
    grid.classList.remove('is-loading');
    paintFiles();
    paintWho();
    paintTarget();
  }
  function paintWho() {
    const who = $('#rn-who', root);
    const p = S.profile;
    if (S.batch) {
      mount(who, html`<span class="rn-avatar">${icon('upload')}</span><span><b>${fmt.plural((S.files || []).length || kept.files.length, 'file')} you added</b></span><button type="button" class="btn btn-ghost btn-sm" data-sample>Use the sample files</button>`);
    } else if (p) {
      const initials = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
      mount(who, html`<span class="rn-avatar">${initials}</span><span><b>${p.name.split(' ')[0]}'s sample statements</b> · made-up data</span>`);
    } else {
      mount(who, html`<span class="rn-avatar">${icon('doc')}</span><span>Sample statements · made-up data</span>`);
    }
    $('#rn-income-hint', root).textContent = S.batch || !income()
      ? 'Your income is worked out during the audit.'
      : `Your income is ${fmt.inr(income())} a month, from the salary credits in your statement.`;
    paintTick();
  }
  function paintTick() {
    const tick = $('#rn-tick', root);
    if (S.nowPct == null || S.batch) { tick.hidden = true; return; }
    const f = Math.min(1, Math.max(0, (S.nowPct - 10) / 50));
    tick.style.left = `calc(11px + (100% - 22px) * ${f.toFixed(4)})`;
    $('em', tick).textContent = `now ${Math.round(S.nowPct)}%`;
    tick.hidden = false;
  }

  function paintFiles() {
    const sum = $('#rn-files-sum', root);
    if (S.error || !S.files) {
      const lost = S.error && S.error.status === 404;
      mount(sum, html`<h2 class="h3" id="rn-files-h">${lost ? 'We could not find those files.' : 'We could not check the files.'}</h2>
        <p class="small">${lost ? 'Please add them again, or use the sample files.' : (S.error && S.error.message) || 'The server did not answer.'}</p>`);
      mount(grid, html`<div class="rn-file rn-file-empty"><span class="rn-glyph">${icon('alert')}</span><p class="body">Try again, or start from the sample statements.</p>
        <div class="row-wrap"><button type="button" class="btn btn-secondary btn-sm" data-retry>${icon('retry')}Try again</button><button type="button" class="btn btn-ghost btn-sm" data-sample>Use the sample files</button></div></div>${dropRow(false)}`);
      const rb = $('[data-retry]', grid); if (rb) rb.addEventListener('click', loadPreview);
      setGo(false, 'Add your statements to start.');
      return;
    }
    const files = sortFiles(S.files);
    const ok = files.filter((f) => f.ok);
    const bad = files.filter((f) => !f.ok);
    const rows = ok.reduce((a, f) => a + (f.transactions || 0), 0);
    const aside = ok.reduce((a, f) => a + (f.quarantined || []).length, 0);
    const months = [...new Set(ok.flatMap((f) => f.months || []))].sort();
    const issues = bad.map(fileIssue);
    const nOf = (t) => issues.filter((x) => x.t === t).length;
    const locked = nOf('needs_password'), layout = nOf('unknown_format'), skipped = issues.length - locked - layout;
    const parts = [];
    if (layout) parts.push(`${layout === 1 ? '1 file has a new layout the AI can learn' : `${layout} files have a new layout the AI can learn`}`);
    if (locked) parts.push(`${locked === 1 ? '1 file needs its password' : `${locked} files need their passwords`}`);
    if (skipped) parts.push(`${fmt.plural(skipped, 'file')} will be skipped`);
    if (aside) parts.push(`${fmt.plural(aside, 'row')} ${aside === 1 ? 'is' : 'are'} set aside`);
    const partsText = parts.length ? cap(parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ')) + '.' : 'Every row was read.';
    const usable = ok.length + layout + locked;
    mount(sum, html`
      <h2 class="h3" id="rn-files-h">${ok.length ? html`<span class="rn-count">${fmt.n(rows)}</span> transactions are ready to check.` : usable ? 'The agent will open these files during the audit.' : 'None of these files could be read.'}</h2>
      <p class="small">${usable
        ? html`${ok.length ? `From ${ok.length === files.length ? fmt.plural(files.length, 'file') : `${ok.length} of ${files.length} files`}${months.length ? `, ${periodLabel(months)}` : ''}. ` : ''}${partsText}`
        : 'Add a CSV or PDF statement from your bank or card to start.'}</p>`);
    const ownFiles = !!S.batch && kept.batch === S.batch;
    mount(grid, html`${files.map((f, i) => fileRow(f, i, ownFiles))}${dropRow(!!S.batch)}`);
    setGo(usable > 0, !usable ? 'Add at least one statement that can be read.'
      : locked ? `${locked === 1 ? 'The locked file is' : `${locked} locked files are`} left out unless you unlock ${locked === 1 ? 'it' : 'them'} first.` : null);
  }
  function setGo(enabled, note) {
    const b = $('#rn-go', root);
    b.disabled = !enabled;
    $('#rn-go-note', root).textContent = note || 'Takes a minute or two.';
  }

  /* Do not await here: the router must get the cleanup function straight away. */
  loadPreview();
  api.get('/api/files').then((r) => {
    if (!page.isConnected) return;
    S.profile = r.profile;
    if (!notesEl.value && sess.notes == null && S.profile && S.profile.notes) notesEl.value = S.profile.notes;
    paintWho(); paintTarget();
  }).catch(() => { if (page.isConnected) paintWho(); });
  if (!S.batch) {
    store.state().then((st) => {
      const b = st && st.findings ? (st.findings.filter((f) => f.kind === 'budget').slice(-1)[0] || {}).details : null;
      if (b && b.current_savings_pct != null && page.isConnected) { S.nowPct = b.current_savings_pct; paintTick(); paintTarget(); }
    }).catch(() => {});
  }

  return () => { offs.forEach((f) => f()); clearTimeout(policyTimer); };
}

/* ---------- pieces ---------- */
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function clampTarget(v) { const n = Math.round(Number(v) / 5) * 5; return Math.min(60, Math.max(10, Number.isFinite(n) ? n : 40)); }
function hasFiles(e) { return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'); }
/** Split the policy check's joined reasons back into one sentence pair per rule. */
export function splitReasons(reason) {
  return String(reason || '').split(/\s+(?=(?:Sending anything|Auto-sending|I can't move money|I won't share|The audit log|Never share))/).filter(Boolean);
}
/* Files that need you come first, so nothing important sits below the fold. */
function sortFiles(files) {
  const rank = (f) => {
    if (f.ok) return (f.quarantined || []).length ? 3 : 4;
    const t = fileIssueType(f.error, f.error_type);
    return t === 'needs_password' ? 0 : t === 'unknown_format' ? 1 : 2;
  };
  const key = (f) => [rank(f), isCardFile(f.name, f.kind) ? 1 : 0, (f.months && f.months[0]) || monthsFromName(f.name)[0] || '9999', f.name];
  return [...files].sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; } return 0; });
}

function skelRow(i) {
  return html`<div class="rn-file rn-file-skel" aria-hidden="true" style="--d:${i * 50}ms">
    <div class="rn-file-row"><span class="skel" style="width:42px;height:42px;border-radius:12px"></span>
      <div style="flex:1;display:grid;gap:8px"><span class="skel" style="width:46%;height:15px"></span><span class="skel" style="width:30%;height:12px"></span></div></div>
  </div>`;
}

function dropRow(isOwn) {
  return html`<div class="rn-drop" role="button" tabindex="0" data-pick aria-label="${isOwn ? 'Add more statement files' : 'Use my own statement files'}">
    <span class="rn-drop-ic">${icon('upload')}</span>
    <span class="rn-drop-txt">
      <span class="rn-drop-t">${isOwn ? 'Add more files' : 'Use my own files'}</span>
      <span class="rn-drop-s">Drop bank or card statements here, or <u>choose files</u>. CSV or PDF, up to 10 MB each.</span>
    </span>
    ${isOwn ? html`<button type="button" class="btn btn-ghost btn-sm rn-drop-back" data-sample>Back to the sample files</button>` : ''}
  </div>`;
}

function fileRow(f, i, removable) {
  const card = isCardFile(f.name, f.kind);
  const brand = fileBrand(f.name, f.kind);
  const months = f.ok ? f.months || [] : monthsFromName(f.name);
  const period = periodLabel(months);
  const q = f.quarantined || [];
  const issue = f.ok ? null : fileIssue(f);
  const locked = !!issue && issue.t === 'needs_password';
  const glyph = issue ? (locked ? 'lock' : issue.tone === 'bad' ? 'fileX' : card ? 'card' : 'bank') : card ? 'card' : 'bank';
  /* Your own file keeps its name, so you can tell which is which. The sample's names mean nothing to anyone. */
  const sub = removable ? f.name : [period ? period + (isPartial(f.name) ? ' (part)' : '') : '', card ? 'Card statement' : 'Bank statement'].filter(Boolean).join(' · ');
  return html`<article class="rn-file${issue ? ` is-${issue.tone}` : ''}" style="--d:${i * 50}ms">
    <div class="rn-file-row">
      <span class="rn-glyph${issue ? ` is-${issue.tone}` : ''}">${icon(glyph)}</span>
      <div class="rn-file-id"><h3 class="rn-file-name">${brand}</h3><p class="rn-file-sub" title="${f.name}">${sub}</p></div>
      ${issue
        ? html`<span class="badge ${issue.tone === 'bad' ? 'badge-bad' : 'badge-warn'} rn-pill">${icon(issue.tone === 'bad' ? 'x' : locked ? 'lock' : 'spark')}${issue.pill}</span>`
        : html`<div class="rn-file-end"><b>${fmt.plural(f.transactions, 'transaction')}</b><span>${fmt.inr(f.debits || 0)} spent</span></div>`}
      ${removable ? html`<button type="button" class="rn-file-x" data-remove="${f.name}" aria-label="Remove ${f.name}">${icon('trash')}</button>` : ''}
    </div>
    ${!issue && q.length ? html`<div class="rn-file-note">${icon('alert')}<p><b>${q.length === 1 ? '1 row set aside.' : `${q.length} rows set aside.`}</b> ${rowProblem(q[0].reason)} It will not be guessed.${q.length > 1 ? ` ${q.length - 1} more like this.` : ''}</p></div>` : ''}
    ${issue && !locked ? html`<div class="rn-file-note${issue.tone === 'bad' ? ' is-bad' : ''}">${icon(issue.tone === 'bad' ? 'xCircle' : 'info')}<p><b>${issue.lead}</b> ${issue.text}</p></div>` : ''}
    ${issue && issue.t === 'unknown_format' ? html`<div class="rn-learn"><button type="button" class="btn btn-secondary btn-sm" data-learn="${f.name}">${icon('spark')}Learn this format</button><p class="rn-learn-msg" role="status" hidden></p></div>` : ''}
    ${locked ? html`<div class="rn-unlock-panel">
      <p class="rn-unlock-lead"><b>Unlock it to include this file.</b> Otherwise the audit runs without it.</p>
      ${unlockBox(f.name, i)}
    </div>` : ''}
  </article>`;
}
