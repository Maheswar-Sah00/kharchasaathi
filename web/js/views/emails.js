/* Emails: the human approval checkpoint.
   The agent can only write drafts. Nothing is sent until the user presses Approve,
   and the server refuses any send that was not approved (the "safety test" proves it). */
import { html, raw, mount, api, store, fmt, KIND, GROUP, DRAFT_KIND, DRAFT_STATUS, toast, on, $, $$ } from '../core.js';

export const title = 'Emails';

/* ---------- icons (24 grid, 1.7 stroke) ---------- */
const P = {
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path class="rv-shackle" d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><path d="M12 14.6v2.2"/>',
  send: '<path d="M20.5 3.5 10.4 13.6"/><path d="M20.5 3.5 14.2 20.4l-3.8-6.8-6.9-3.8 17-6.3z"/>',
  check: '<path d="m5 12.5 4.4 4.4L19 7.4"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  inbox: '<path d="M3.5 13.5h4.6l1.6 2.6h4.6l1.6-2.6h4.6"/><path d="M6 5h12l2.5 8.5v5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-5L6 5z"/>',
  pencil: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10v4z"/><path d="m13.5 6.5 4 4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.6M12 15.8v.2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>',
};
const ic = (n, cls = '') => raw(`<svg class="rv-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`);

/* ---------- UI state that survives a re-render (store.invalidate) ---------- */
const ui = { sel: null, edits: {}, result: {}, busy: null };

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const word = (n) => WORDS[n] || fmt.n(n);

/** What money is involved in the finding behind a draft. */
function money(f) {
  if (!f) return null;
  const d = f.details || {};
  const g = (KIND[f.kind] || {}).group || 'keep';
  if (f.kind === 'trial_conversion') return { amt: d.paid_amount ?? f.amount, note: 'a month', g };
  if (f.kind === 'price_hike' || f.kind === 'bank_fee_hike') return { amt: d.extra_per_year ?? f.amount, note: 'extra a year', g };
  return { amt: d.amount ?? f.amount, note: 'to get back', g };
}
/** One plain sentence: why the agent wrote this email. */
function why(f) {
  if (!f) return '';
  const d = f.details || {};
  const name = d.display || f.title || f.merchant;
  switch (f.kind) {
    case 'duplicate': return `${name} charged you ${fmt.inr(d.amount)} twice on ${fmt.date(d.date)}.`;
    case 'zombie_charge': return `${name} charged you ${fmt.inr(d.amount)} on ${fmt.date(d.date)}, after you cancelled on ${fmt.date(d.cancelled_on)}.`;
    case 'trial_conversion': return `Your ${name} trial cost ${fmt.inr(d.trial_amount)}. Then it became ${fmt.inr(d.paid_amount)} a month.`;
    case 'price_hike': case 'bank_fee_hike': return `${name} went from ${fmt.inr(d.old)} to ${fmt.inr(d.new)} a month.`;
    default: return f.title || '';
  }
}
const when = (iso) => (iso ? `${fmt.date(iso, true)} at ${fmt.time(iso)}` : '');

/* ---------- templates ---------- */
function skeleton() {
  return html`<div class="page">
    <div class="rv-sk-head"><div class="skel rv-sk-line" style="width:140px"></div><div class="skel rv-sk-title"></div><div class="skel rv-sk-line" style="width:90%"></div><div class="skel rv-sk-line" style="width:64%"></div></div>
    <div class="rv-mail-layout">
      <div style="display:grid;gap:8px">${[0, 1, 2, 3].map(() => html`<div class="skel" style="height:112px;border-radius:14px"></div>`)}</div>
      <div class="skel" style="height:620px;border-radius:20px"></div>
    </div></div>`;
}

/* why = 'none' (no audit yet) | 'unfinished' (the last audit did not finish) | 'clean' (finished, nothing to send) */
function emptyView(why) {
  const COPY = {
    none: ['No emails yet.', 'Run an audit first. When KharchaSaathi finds money to get back or something to cancel, it writes the email for you. Each one waits here. Nothing is sent until you press Approve.'],
    unfinished: ['No emails yet.', 'Your last audit did not finish, so no emails were written. Run it again. Each email will wait here, and nothing is sent until you press Approve.'],
    clean: ['No emails were needed.', 'This audit found nothing to dispute or cancel, so the agent did not write any emails. When it does, each one waits here until you approve it.'],
  };
  const [head, lead] = COPY[why];
  return html`<div class="page">
    <header class="rv-head">
      <p class="rv-crumb"><span class="now">Emails</span></p>
      <h1 class="h1">${head}</h1>
      <p class="lead">${lead}</p>
      <div class="rv-empty-actions">
        ${why === 'clean' ? html`<a class="btn btn-primary" href="#/report">See your report <span aria-hidden="true">→</span></a>`
                 : html`<a class="btn btn-primary" href="#/start">Start an audit <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="#/how">How it works</a>`}
      </div>
    </header>
    <div class="rv-ghost" aria-hidden="true">
      <div class="rv-ghost-note">${ic('lock')} Drafts will appear here, locked until you approve them.</div>
      ${[0, 1, 2].map(() => html`<div class="row-g"><i></i><i></i><i></i></div>`)}
    </div></div>`;
}

function errorView(e) {
  return html`<div class="page"><header class="rv-head">
    <p class="rv-crumb"><span class="now">Emails</span></p>
    <h1 class="h1">We could not load your emails.</h1>
    <p class="lead">The KharchaSaathi server did not answer. Check that it is running, then try again.</p>
    <p class="small mono" style="margin-top:14px">${e && e.message}</p>
    <div class="rv-empty-actions"><button class="btn btn-primary" data-act="reload">Try again</button></div>
  </header></div>`;
}

function listItem(d, f) {
  const st = DRAFT_STATUS[d.status] || { label: d.status, cls: '' };
  const m = money(f);
  const g = m ? GROUP[m.g] : null;
  return html`<button class="rv-di ${d.id === ui.sel ? 'is-active' : ''} ${d.status !== 'PENDING_APPROVAL' ? 'is-done' : ''}" data-draft="${d.id}" aria-current="${d.id === ui.sel ? 'true' : 'false'}">
    <div class="rv-di-top"><span class="rv-di-kind">${DRAFT_KIND[d.kind] || d.kind}</span><span class="badge ${st.cls}"><span class="dot"></span>${st.label}</span></div>
    <div class="rv-di-subj">${(ui.edits[d.id] && ui.edits[d.id].subject) || d.subject}</div>
    <div class="rv-di-meta"><span>To ${d.intended_recipient}</span>
      ${m ? html`<span class="rv-di-amt" style="--c:${raw(g.color)}"><i></i>${fmt.inr(m.amt)}<small>${m.note === 'to get back' ? 'back' : m.note === 'a month' ? '/month' : '/year'}</small></span>` : ''}</div>
  </button>`;
}

function banner(d, s) {
  const r = ui.result[d.id];
  if (d.status === 'SENT') {
    const pid = d.provider_id || (r && r.pid);
    return html`<div class="rv-banner is-good"><span class="rv-banner-ic">${ic('check')}</span><div class="rv-banner-text">
      <b>Sent to your demo inbox.</b>
      <p>You approved it${d.decided_at ? ` on ${when(d.decided_at)}` : ''}. It went to ${s.demo_inbox || d.to_addr || 'your demo inbox'}, with the real recipient written on top.</p>
      ${pid ? html`<code>Email service id: ${pid}</code>` : ''}</div></div>`;
  }
  if (d.status === 'APPROVED') {
    let head = 'Approved, but not sent yet.';
    let text = 'Your approval is saved. Nothing has been sent so far.';
    if (r && r.type === 'error') { head = 'Approved, but the email service is not set up here.'; text = 'Your approval is saved, and nothing was sent. When the email service key is added, press Try sending again.'; }
    if (r && r.type === 'guard') {
      head = 'Approved, but the safety guard held it back.';
      text = d.to_addr && s.demo_inbox && d.to_addr.toLowerCase() !== s.demo_inbox.toLowerCase()
        ? `Emails may only go to your demo inbox (${s.demo_inbox}). This draft is addressed to ${d.to_addr}, so the guard stopped it. Nothing was sent.`
        : 'Emails may only go to your demo inbox. The guard stopped this one, and nothing was sent.';
    }
    return html`<div class="rv-banner is-warn"><span class="rv-banner-ic">${ic('alert')}</span><div class="rv-banner-text">
      <b>${head}</b><p>${text}</p>${r && r.msg ? html`<code>${r.msg}</code>` : ''}</div>
      <button class="btn btn-secondary btn-sm" data-act="retry" ${ui.busy === d.id ? 'disabled' : ''}>${ui.busy === d.id ? html`<span class="spinner"></span>` : ic('retry')}Try sending again</button></div>`;
  }
  if (d.status === 'REJECTED') {
    return html`<div class="rv-banner"><span class="rv-banner-ic">${ic('x')}</span><div class="rv-banner-text">
      <b>You chose not to send this email.</b><p>It stays here as a record${d.decided_at ? ` (decided ${when(d.decided_at)})` : ''}. Nothing was sent.</p></div></div>`;
  }
  return '';
}

function blockedOverlay(d) {
  const r = ui.result[d.id];
  if (!r || r.type !== 'blocked') return '';
  const anim = !r.played; r.played = true;
  return html`<div class="rv-block ${anim ? '' : 'is-static'}" role="alertdialog" aria-labelledby="rv-block-t" aria-describedby="rv-block-d">
    <div class="rv-block-card">
      <div class="rv-lock">${ic('lock')}</div>
      <div class="rv-block-eyebrow">Safety test passed</div>
      <h3 id="rv-block-t">Blocked. Nothing was sent.</h3>
      <div class="rv-block-msg">${r.msg || 'Blocked: this email has not been approved by the user.'}</div>
      <p id="rv-block-d">This is the lock working. The server refuses to send any email you have not approved, even if the app or the agent asks it to. The attempt was written to the activity log.</p>
      <div class="rv-block-actions">
        <button class="btn btn-primary" data-act="dismiss">Back to the draft</button>
        <a class="btn btn-ghost" href="#/log">See it in the log <span aria-hidden="true">→</span></a>
      </div>
    </div></div>`;
}

function editor(d, f, s) {
  const editable = d.status === 'PENDING_APPROVAL';
  const e = ui.edits[d.id] || {};
  const subject = e.subject ?? d.subject;
  const body = e.body ?? d.body;
  const edited = editable && (subject !== d.subject || body !== d.body);
  const m = money(f);
  const g = m ? GROUP[m.g] : GROUP.keep;
  const k = f ? KIND[f.kind] : null;
  const deliver = s.demo_inbox || d.to_addr; // a send is only allowed when these match
  const busy = ui.busy === d.id;
  const nextPending = (s.drafts || []).find((x) => x.status === 'PENDING_APPROVAL' && x.id !== d.id);
  return html`<article class="card rv-mail" aria-label="Email draft">
    ${f ? html`<div class="rv-why" style="--c:${raw(g.color)};--soft:${raw(g.soft)};--txt:${raw(g.text)}">
      <span class="rv-why-tag"><i></i>${k ? k.label : 'Finding'}</span>
      <span class="rv-why-text">${why(f)}</span>
      ${m ? html`<span class="rv-why-amt">${fmt.inr(m.amt)} <small>${m.note}</small></span>` : ''}
    </div>` : ''}
    ${banner(d, s)}
    <div class="rv-mhead">
      <div class="rv-mrow"><span class="k">To</span><span class="v"><span class="rv-to">${d.intended_recipient}</span>
        <span class="rv-deliver" title="In this demo, emails never reach the real company. They go to your own inbox, with the real recipient written on top.">${ic('inbox')}<span>Delivered to: <b>your demo inbox</b>${deliver ? ` · ${deliver}` : ''}</span></span></span></div>
      <div class="rv-mrow"><span class="k">From</span><span class="v">${(s.profile && s.profile.name) || 'You'}, sent by KharchaSaathi</span></div>
      <div class="rv-mrow is-subject"><label class="k" for="rv-subj">Subject</label>
        <textarea id="rv-subj" class="rv-subject" data-field="subject" rows="1" ${editable ? '' : 'readonly'} spellcheck="true">${subject}</textarea></div>
    </div>
    <div class="rv-mbody">
      <div class="rv-stamp"><code>[Demo send - intended recipient: ${d.intended_recipient}]</code><small>Added on top when it is sent</small></div>
      <label class="sr-only" for="rv-body">Email text</label>
      <textarea id="rv-body" class="textarea rv-body" data-field="body" rows="8" ${editable ? '' : 'readonly'} spellcheck="true">${body}</textarea>
      ${editable ? html`<div class="rv-edit-hint">${edited
        ? html`<span class="rv-edited"><i></i>You edited this draft.</span><button data-act="undo">Undo my changes</button>`
        : html`${ic('pencil')}<span>Click the subject or the text to change anything before you approve.</span>`}</div>` : ''}
    </div>
    ${editable ? html`<div class="rv-mfoot">
      <button class="rv-test" data-act="test" ${busy ? 'disabled' : ''} title="Asks the server to send this email without your approval. It should refuse.">
        <span class="rv-test-tag">${ic('lock')}Safety test</span>Try to send without approving</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-act="reject" ${busy ? 'disabled' : ''}>Don't send</button>
      <button class="btn btn-primary" data-act="approve" ${busy ? 'disabled' : ''}>${busy ? html`<span class="spinner"></span>Sending…` : html`${ic('send')}Approve and send`}</button>
    </div>` : nextPending ? html`<div class="rv-mfoot"><span class="small">${word((s.drafts || []).filter((x) => x.status === 'PENDING_APPROVAL').length)} still waiting for you.</span><span class="spacer"></span>
      <button class="btn btn-secondary" data-draft="${nextPending.id}">Next email <span aria-hidden="true">→</span></button></div>` : ''}
    ${blockedOverlay(d)}
  </article>`;
}

function headline(drafts) {
  const pending = drafts.filter((d) => d.status === 'PENDING_APPROVAL').length;
  if (pending === 1) return 'One email is waiting for you.';
  if (pending > 1) return `${word(pending)} emails are waiting for you.`;
  return drafts.some((d) => d.status === 'SENT' || d.status === 'APPROVED') ? 'All done. Nothing is waiting.' : 'Nothing is waiting for you.';
}

function pageView(s) {
  const drafts = s.drafts || [];
  const pending = drafts.filter((d) => d.status === 'PENDING_APPROVAL');
  const done = drafts.filter((d) => d.status !== 'PENDING_APPROVAL');
  const F = new Map((s.findings || []).map((f) => [f.id, f]));
  const cur = drafts.find((d) => d.id === ui.sel);
  return html`<div class="page">
    <header class="rv-head">
      <p class="rv-crumb"><a href="#/report">Your report</a><span class="sep">/</span><span class="now">Emails</span></p>
      <h1 class="h1">${headline(drafts)}</h1>
      <p class="lead">The agent can only write drafts. <b>Nothing leaves until you press Approve.</b> In this demo, every email goes only to your own demo inbox${s.demo_inbox ? ` (${s.demo_inbox})` : ''}, with the real recipient written on top.</p>
      <div class="rv-steps" aria-label="How sending works">
        <span class="rv-step"><b>${ic('pencil')}</b>The agent writes a draft</span><span class="rv-step-sep"></span>
        <span class="rv-step"><b>${ic('eye')}</b>You read it and edit it</span><span class="rv-step-sep"></span>
        <span class="rv-step is-you"><b>${ic('send')}</b>Only your click sends it</span>
      </div>
    </header>
    <div class="rv-mail-layout">
      <nav class="rv-dlist" aria-label="Email drafts">
        ${pending.length ? html`<div class="rv-dgroup"><span>Waiting for you</span><span>${pending.length}</span></div>${pending.map((d) => listItem(d, F.get(d.finding_id)))}` : ''}
        ${done.length ? html`<div class="rv-dgroup"><span>Done</span><span>${done.length}</span></div>${done.map((d) => listItem(d, F.get(d.finding_id)))}` : ''}
      </nav>
      <div class="rv-editor" data-editor>${cur ? editor(cur, F.get(cur.finding_id), s) : ''}</div>
    </div></div>`;
}

/* ---------- view ---------- */
export async function render(root, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'rv rv-emails';
  root.appendChild(wrap);
  if (ctx.query && ctx.query.id) ui.sel = Number(ctx.query.id);
  mount(wrap, skeleton());
  let alive = true, S = null;

  const grow = () => $$('.rv-body, .rv-subject', wrap).forEach((ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
  const pickDefault = (drafts) => {
    if (drafts.some((d) => d.id === ui.sel)) return;
    const p = drafts.find((d) => d.status === 'PENDING_APPROVAL');
    ui.sel = (p || drafts[0] || {}).id ?? null;
  };
  const paintEditor = () => {
    if (!S) return;
    const d = (S.drafts || []).find((x) => x.id === ui.sel);
    const F = new Map((S.findings || []).map((f) => [f.id, f]));
    const host = $('[data-editor]', wrap);
    if (!host) return;
    mount(host, d ? editor(d, F.get(d.finding_id), S) : '');
    $$('.rv-di', wrap).forEach((b) => { const on_ = Number(b.dataset.draft) === ui.sel; b.classList.toggle('is-active', on_); b.setAttribute('aria-current', String(on_)); });
    grow();
  };
  const paint = async () => {
    let s;
    try { s = await store.state(); } catch (e) { if (alive) mount(wrap, errorView(e)); return; }
    if (!alive) return;
    S = s;
    const drafts = s.drafts || [];
    if (!s.run || !drafts.length) { mount(wrap, emptyView(!s.run ? 'none' : s.run.status === 'done' ? 'clean' : 'unfinished')); return; }
    pickDefault(drafts);
    mount(wrap, pageView(s));
    grow();
    if (ui.focusMail) {
      ui.focusMail = false;
      const card = $('.rv-mail', wrap);
      const top = card ? card.getBoundingClientRect().top : 0;
      if (card && (top < 80 || top > 140)) card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      const first = $('.rv-block [data-act="dismiss"]', wrap);
      if (first) first.focus({ preventScroll: true });
    }
  };

  const select = (id) => {
    ui.sel = id;
    try { history.replaceState(null, '', `#/emails?id=${id}`); } catch { /* ignore */ }
    paintEditor();
    if (matchMedia('(max-width: 1020px)').matches) { const ed = $('[data-editor]', wrap); ed && ed.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };

  const offs = [
    on(wrap, 'click', '[data-draft]', (e, t) => select(Number(t.dataset.draft))),
    on(wrap, 'input', '[data-field]', (e, t) => {
      const id = ui.sel; ui.edits[id] = ui.edits[id] || {};
      ui.edits[id][t.dataset.field] = t.value;
      grow();
      if (t.dataset.field === 'subject') { const li = $(`.rv-di[data-draft="${id}"] .rv-di-subj`, wrap); if (li) li.textContent = t.value; }
      // refresh just the hint line (keep focus in the field)
      const d = S && S.drafts.find((x) => x.id === id);
      const hint = $('.rv-edit-hint', wrap);
      if (d && hint) {
        const e2 = ui.edits[id];
        const changed = (e2.subject ?? d.subject) !== d.subject || (e2.body ?? d.body) !== d.body;
        hint.innerHTML = changed
          ? '<span class="rv-edited"><i></i>You edited this draft.</span><button data-act="undo">Undo my changes</button>'
          : `${ic('pencil')}<span>Click the subject or the text to change anything before you approve.</span>`;
      }
    }),
    on(wrap, 'click', '[data-act]', async (e, t) => {
      const act = t.dataset.act;
      const id = ui.sel;
      if (act === 'reload') { store.invalidate(); return; }
      if (act === 'undo') { delete ui.edits[id]; paintEditor(); return; }
      if (act === 'dismiss') { delete ui.result[id]; paintEditor(); const b = $('[data-act="test"]', wrap); b && b.focus(); return; }
      const d = S && S.drafts.find((x) => x.id === id);
      if (!d || ui.busy) return;

      if (act === 'test') {
        ui.busy = id; paintEditor();
        try {
          const r = await api.post(`/api/drafts/${id}/send`);
          ui.result[id] = r && r.blocked ? { type: 'blocked', msg: r.error } : r && r.sent ? { type: 'sent', pid: r.id } : { type: 'error', msg: (r && r.error) || 'Unknown answer from the server.' };
          if (r && r.sent) toast('That should not happen: the email was sent.', { kind: 'bad' });
        } catch (err) { ui.result[id] = { type: 'blocked', msg: err.message }; }
        ui.busy = null; ui.focusMail = true;
        store.invalidate(); // the attempt is in the activity log now
        return;
      }
      if (act === 'approve' || act === 'retry') {
        const ed = ui.edits[id] || {};
        ui.busy = id; paintEditor();
        let r;
        try {
          r = act === 'approve'
            ? await api.post(`/api/drafts/${id}/approve`, { subject: ed.subject ?? d.subject, body: ed.body ?? d.body })
            : await api.post(`/api/drafts/${id}/send`);
        } catch (err) { r = { ok: false, error: err.message }; }
        ui.busy = null;
        if (r.sent) { ui.result[id] = { type: 'sent', pid: r.id }; toast('Sent to your demo inbox', { kind: 'good' }); }
        else if (r.blocked) { ui.result[id] = { type: 'guard', msg: r.error }; toast('Approved. The safety guard held it back.', { kind: 'warn' }); }
        else { ui.result[id] = { type: 'error', msg: r.error }; toast('Approved. Not sent: the email service is not set up here.', { kind: 'warn' }); }
        delete ui.edits[id]; ui.focusMail = true;
        store.invalidate();
        return;
      }
      if (act === 'reject') {
        ui.busy = id; paintEditor();
        try { await api.post(`/api/drafts/${id}/reject`); toast('Okay. This email will not be sent.'); }
        catch (err) { toast(`Could not save that: ${err.message}`, { kind: 'bad' }); }
        ui.busy = null; delete ui.edits[id];
        store.invalidate();
      }
    }),
    on(wrap, 'keydown', '.rv-subject', (e) => { if (e.key === 'Enter') e.preventDefault(); }),
    store.subscribe(() => { if (alive) paint(); }),
  ];
  const onResize = () => grow();
  addEventListener('resize', onResize, { passive: true });

  await paint();
  return () => { alive = false; offs.forEach((f) => f()); removeEventListener('resize', onResize); };
}
