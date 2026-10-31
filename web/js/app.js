/* KharchaSaathi - app shell: nav, router, footer.
   Each route lazy-loads a view module from ./views/. A view exports:
     export const title = 'Page title';
     export async function render(root, ctx) { ...; return cleanupFn?; }
   ctx = { path, query, section }                                        */
import { html, mount, $, $$, on, store, summarize, toggleTheme, toast, api, navigate } from './core.js';

const ROUTES = {
  '/':             { load: () => import('./views/landing.js') },
  '/how':          { load: () => import('./views/landing.js'), section: 'how' },
  '/start':        { load: () => import('./views/start.js'), nav: 'start' },
  '/run':          { load: () => import('./views/run.js'), nav: 'start' },
  '/report':       { load: () => import('./views/report.js'), nav: 'report' },
  '/emails':       { load: () => import('./views/emails.js'), nav: 'emails' },
  '/transactions': { load: () => import('./views/transactions.js'), nav: 'report' },
  '/ask':          { load: () => import('./views/ask.js'), nav: 'ask' },
  '/proof':        { load: () => import('./views/proof.js'), nav: 'proof' },
  '/log':          { load: () => import('./views/log.js'), nav: 'report' },
};

const NAV = [
  { key: 'how', href: '#/how', label: 'How it works' },
  { key: 'report', href: '#/report', label: 'Your report' },
  { key: 'emails', href: '#/emails', label: 'Emails' },
  { key: 'ask', href: '#/ask', label: 'Ask AI', spark: true },
  { key: 'proof', href: '#/proof', label: 'Proof' },
];

const SPARK = html`<svg class="spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5c.7 4.9 4.1 8.3 9 9-4.9.7-8.3 4.1-9 9-.7-4.9-4.1-8.3-9-9 4.9-.7 8.3-4.1 9-9Z"/></svg>`;

const MARK = html`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
  <circle cx="16" cy="16" r="15" fill="var(--ink)"/>
  <circle cx="16" cy="16" r="11.5" fill="none" stroke="var(--bg)" stroke-opacity=".35" stroke-width="1"/>
  <path d="M11.2 10.2h9.6M11.2 13.6h9.6M14 10.2c3.6 0 5.2 1.4 5.2 3.4s-1.6 3.4-5.2 3.4h-2.4l6.6 6.2" fill="none" stroke="var(--bg)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const THEME_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true">
  <mask id="moon-cut"><rect width="24" height="24" fill="#fff"/><circle class="moon-mask" cx="17" cy="7" r="6" fill="#000"/></mask>
  <circle class="core" cx="12" cy="12" r="5.2" fill="currentColor" mask="url(#moon-cut)"/>
  <g class="sun-rays" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>
  </g>
</svg>`;

function renderNav() {
  const navEl = $('#nav');
  mount(navEl, html`
    <div class="nav-inner">
      <a class="brand" href="#/" aria-label="KharchaSaathi home">${MARK}<span>KharchaSaathi</span><small>खर्चा साथी</small></a>
      <nav class="nav-pills" id="nav-pills" aria-label="Main">
        ${NAV.map((n) => html`<a href="${n.href}" data-nav="${n.key}">${n.spark ? SPARK : ''}${n.label}${n.key === 'emails' ? html`<span class="count" data-count hidden></span>` : ''}</a>`)}
      </nav>
      <div class="nav-actions">
        <button class="btn btn-ghost btn-icon nav-menu-btn" id="nav-menu" aria-label="Menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg>
        </button>
        <button class="theme-toggle" id="theme-toggle" aria-label="Switch light or dark theme">${THEME_ICON}</button>
        <a class="btn btn-primary" href="#/start" data-cta><span class="nav-cta-text">Start an audit</span><span aria-hidden="true">→</span></a>
      </div>
    </div>`);
  $('#theme-toggle').addEventListener('click', (e) => toggleTheme(e.currentTarget));
  $('#nav-menu').addEventListener('click', (e) => {
    const open = $('#nav-pills').classList.toggle('is-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  on(navEl, 'click', '.nav-pills a', () => $('#nav-pills').classList.remove('is-open'));
  const onScroll = () => navEl.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

async function refreshNavCount() {
  try {
    const s = summarize(await store.state());
    const c = $('[data-count]');
    if (c) { c.hidden = !s || !s.pendingDrafts; if (s) c.textContent = s.pendingDrafts; }
  } catch { /* server not ready */ }
}

function renderFooter() {
  mount($('#footer'), html`
    <div class="page page-wide footer-inner">
      <div class="row">${MARK}<div><div style="font-weight:600;letter-spacing:-.01em">KharchaSaathi</div>
        <div class="tiny">Demo data is made up. The agent can only draft emails. You send them.</div></div></div>
      <div class="row-wrap tiny" style="gap:20px">
        <a href="#/proof">Proof</a><a href="#/log">Activity log</a><a href="/web/call.html">Reminder calls</a><a href="/legacy">Old dashboard</a>
        <button class="tiny" id="reset-demo" style="color:var(--ink-3)">Reset demo data</button>
      </div>
    </div>`);
  $('#reset-demo').addEventListener('click', async () => {
    if (!confirm('Clear every audit, email draft and remembered fix? This cannot be undone.')) return;
    await api.post('/api/reset'); store.invalidate(); toast('Demo data cleared'); navigate('/');
  });
}

let cleanup = null, token = 0;
async function route() {
  const [pathRaw, qs = ''] = (location.hash.slice(1) || '/').split('?');
  const path = ROUTES[pathRaw] ? pathRaw : '/';
  const def = ROUTES[path];
  const my = ++token;
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === (def.nav || def.section)));
  document.body.dataset.route = path.slice(1) || 'home';
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
  cleanup = null;
  const root = $('#app');
  let mod;
  try { mod = await def.load(); } catch (e) {
    console.error(e);
    mount(root, html`<div class="route-error card card-pad"><h2 class="h3">This page could not load</h2><p class="small">Something went wrong while loading it. Details:</p><pre>${String(e && e.stack || e)}</pre></div>`);
    return;
  }
  if (my !== token) return;
  root.innerHTML = '';
  root.classList.remove('route-enter'); void root.offsetWidth; root.classList.add('route-enter');
  document.title = (mod.title ? mod.title + ' · ' : '') + 'KharchaSaathi';
  const ctx = { path, query: Object.fromEntries(new URLSearchParams(qs)), section: def.section || null };
  if (!def.section) scrollTo({ top: 0, behavior: 'instant' });
  try { cleanup = await mod.render(root, ctx); } catch (e) {
    console.error(e);
    mount(root, html`<div class="route-error card card-pad"><h2 class="h3">This page hit a problem</h2><pre>${String(e && e.stack || e)}</pre></div>`);
  }
  refreshNavCount();
}

renderNav();
renderFooter();
store.subscribe(refreshNavCount);
addEventListener('hashchange', route);
route();
