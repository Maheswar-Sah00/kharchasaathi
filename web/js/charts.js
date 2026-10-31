/* =====================================================================
   KharchaSaathi - charts.js
   Small hand-built charts (HTML + inline SVG). No libraries.

   - Colours: pass CSS colour strings, ideally tokens like 'var(--c-orange)'.
     Nothing is hard-coded here, so light and dark themes just work.
   - Styles: web/css/report.css, classes prefixed .rp-ch- / .rp-cal-
     (that stylesheet is linked on every page, so any view can use these).
   - Motion: every chart animates in once, when it scrolls into view.
     Reduced motion skips it. finishAll() jumps everything to its end state
     (used before printing).
   - Hover: marks carry a data-tip attribute (an HTML string, see tipCard).
     Call bindTips(container) once per view; it also handles keyboard focus
     and taps.

   import { hbars, slope, segbar, calendar, tipCard, bindTips } from '../charts.js';

   hbars(el, rows, opts)    horizontal bars. rows: [{ key, label, parts:[{value,color}] | value+color,
                            tick?, valueText?, tip?, aria? }]. opts: { max, labelWidth, valueWidth,
                            barHeight, rowHeight, format, stackBelow } (below stackBelow px the
                            label and value sit on a line above a full-width bar)
   slope(el, rows, opts)    two-point slope chart. rows: [{ key, label, short?, from, to, color, tip? }].
                            opts: { left, right, height, narrowHeight, format }
   segbar(el, parts, opts)  one whole split into parts. parts: [{ key, value, color, label?,
                            labelColor?, tip? }]. opts: { size: 'thin'|'tall', aria }
   calendar(el, opts)       money calendar, one dot per payment. opts: { months:['2026-08',..],
                            items:[{ id, key, date, amount, color, tip, pick? }], cap, meta(ym, items),
                            onPick(item) } (a click on a dot with pick: true calls onPick)
                            returns { update(items), focus(ids|null), hover(ids|null), has(id), destroy() }

   Each returns { el, destroy() } at least.
   ===================================================================== */
import { html, raw, mount, tip, fmt } from './core.js';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const SAFE_COLOR = /^(var\(--[\w-]+\)|#[0-9a-f]{3,8}|[a-z]+|color-mix\([\w\s%(),.#-]+\))$/i;
/** Only pass through colour strings that cannot break out of an attribute. */
export const color = (c) => raw(SAFE_COLOR.test(String(c || '').trim()) ? String(c).trim() : 'currentColor');
const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0);
const r2 = (n) => Math.round(n * 100) / 100;

/* ---------- Motion ---------- */
const pending = new Set();
/** Run fn once when el scrolls into view. Returns a cancel function. */
export function whenVisible(el, fn, { threshold = 0.18, margin = '0px 0px -6% 0px' } = {}) {
  let done = false, io = null;
  const go = () => { if (done) return; done = true; pending.delete(go); if (io) io.disconnect(); fn(); };
  if (reducedMotion() || !('IntersectionObserver' in window)) { go(); return () => {}; }
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) go(); }, { threshold, rootMargin: margin });
  io.observe(el);
  pending.add(go);
  return () => { done = true; pending.delete(go); io.disconnect(); };
}
/** Start every entrance animation that is still waiting (e.g. before printing). */
export function finishAll() { [...pending].forEach((go) => go()); }

/** Draw now and again whenever el changes width. draw(width, isFirst). */
export function responsive(el, draw) {
  let w = -1, raf = 0;
  const run = () => {
    const nw = Math.floor(el.getBoundingClientRect().width);
    if (nw > 0 && nw !== w) { const first = w < 0; w = nw; draw(nw, first); }
  };
  run();
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
  ro.observe(el);
  return () => { ro.disconnect(); cancelAnimationFrame(raf); };
}

/** Animate a number. Respects reduced motion. Returns a function that stops it. */
export function count(node, to, { from = 0, ms = 1100, format = (n) => fmt.n(n), done } = {}) {
  if (!node) return () => {};
  if (reducedMotion()) { node.textContent = format(to); if (done) done(); return () => {}; }
  let raf = 0;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 4);
    node.textContent = format(from + (to - from) * e);
    if (p < 1) raf = requestAnimationFrame(step); else if (done) done();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/* ---------- Tooltips ---------- */
/**
 * Tooltip markup (a plain string, safe to put in a data-tip attribute through html``).
 * Values lead, labels follow: title is the small context line, value is the big number.
 */
export function tipCard({ title, value, unit, rows = [], note, key } = {}) {
  return String(html`<div class="rp-ch-tip">
    ${title ? html`<div class="rp-ch-tip-title">${title}</div>` : ''}
    ${value != null ? html`<div class="rp-ch-tip-value">${value}${unit ? html`<span>${unit}</span>` : ''}</div>` : ''}
    ${rows.length ? html`<div class="rp-ch-tip-rows">${rows.map(([k, v, c]) => html`<div class="rp-ch-tip-row"><span>${c ? html`<i style="background:${color(c)}"></i>` : ''}${k}</span><b>${v}</b></div>`)}</div>` : ''}
    ${note ? html`<div class="rp-ch-tip-note">${key ? html`<i style="background:${color(key)}"></i>` : ''}<span>${note}</span></div>` : ''}
  </div>`);
}

/** Shared tooltip for every [data-tip] inside root: pointer, keyboard focus and tap. */
export function bindTips(root) {
  const off = tip.bind(root);
  const at = (t) => { const r = t.getBoundingClientRect(); tip.show(t.getAttribute('data-tip'), r.left + Math.min(r.width / 2, 120), r.top + r.height / 2); };
  const onFocus = (e) => { const t = e.target.closest('[data-tip]'); if (t && root.contains(t) && t.getAttribute('data-tip')) at(t); };
  const onDown = (e) => { if (e.pointerType === 'mouse') return; const t = e.target.closest('[data-tip]'); if (t && root.contains(t) && t.getAttribute('data-tip')) tip.show(t.getAttribute('data-tip'), e.clientX, e.clientY); else tip.hide(); };
  const onBlur = () => tip.hide();
  /* Tabbing to a mark scrolls it into view: keep its tooltip with it. Any other scroll closes it. */
  const onScroll = () => { const a = document.activeElement; if (a && a !== document.body && root.contains(a) && a.matches('[data-tip]:focus-visible')) at(a); else tip.hide(); };
  root.addEventListener('focusin', onFocus);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('pointerdown', onDown);
  addEventListener('scroll', onScroll, { passive: true });
  return () => {
    off();
    root.removeEventListener('focusin', onFocus);
    root.removeEventListener('focusout', onBlur);
    root.removeEventListener('pointerdown', onDown);
    removeEventListener('scroll', onScroll);
  };
}

/* =====================================================================
   1. Horizontal bars (Babel style): label | bar (stacked parts) + thin
      reference tick + value at the bar end. A bar longer than `max` is
      drawn to the edge with a break mark (its true value stays labelled).
   ===================================================================== */
export function hbars(el, rows, opts = {}) {
  const { labelWidth = 150, valueWidth = 112, barHeight = 12, rowHeight = 34, format = fmt.inr, stackBelow = 440 } = opts;
  const totals = rows.map((r) => (r.parts ? sum(r.parts.map((p) => p.value)) : r.value));
  const top = opts.max || Math.max(1, ...totals, ...rows.map((r) => r.tick || 0));
  const pct = (v) => Math.max(0, Math.min(100, (v / top) * 100));
  el.classList.add('rp-ch', 'rp-ch-hbars');
  mount(el, html`<div class="rp-ch-bars" role="list" style="--lw:${labelWidth}px;--vw:${valueWidth}px;--bh:${barHeight}px;--rh:${rowHeight}px">
    ${rows.map((r, i) => {
      const parts = (r.parts || [{ value: r.value, color: r.color }]).filter((p) => p.value > 0);
      const total = totals[i];
      const broken = total > top;
      let acc = 0;
      const segs = parts.map((p, j) => { const a = pct(acc); acc += p.value; return { a, b: pct(acc), color: p.color, last: j === parts.length - 1 }; });
      const end = pct(total);
      return html`<div class="rp-ch-bar-row" role="listitem" tabindex="0" data-key="${r.key || ''}"${r.tip ? html` data-tip="${r.tip}"` : ''} aria-label="${r.aria || `${r.label}: ${r.valueText && typeof r.valueText === 'string' ? r.valueText : format(total)}`}" style="--i:${i}">
        <div class="rp-ch-bar-label">${r.label}</div>
        <span class="rp-ch-bar-val2">${r.valueText != null ? r.valueText : format(total)}</span>
        <div class="rp-ch-bar-plot">
          <div class="rp-ch-bar-stack">
            ${segs.map((s) => html`<i class="rp-ch-bar-seg${s.last ? ' is-end' : ''}" style="left:${r2(s.a)}%;width:calc(${r2(s.b - s.a)}% - ${s.last ? 0 : 2}px);background:${color(s.color)}"></i>`)}
            ${broken ? html`<i class="rp-ch-bar-break"></i>` : ''}
          </div>
          ${r.tick != null && !broken ? html`<i class="rp-ch-bar-tick" style="left:${r2(pct(r.tick))}%"></i>` : ''}
          <span class="rp-ch-bar-val" style="left:${r2(end)}%">${r.valueText != null ? r.valueText : format(total)}</span>
        </div>
      </div>`;
    })}
  </div>`);
  const bars = el.querySelector('.rp-ch-bars');
  const stopR = responsive(el, (w) => bars.classList.toggle('is-stacked', w < stackBelow));
  const stop = whenVisible(el, () => el.classList.add('is-in'));
  return { el, destroy: () => { stop(); stopR(); } };
}

/* =====================================================================
   2. Segmented bar: one whole split into parts. thin = 8px, rounded ends,
      no text. tall = 28px blocks with the value inside when it fits.
   ===================================================================== */
export function segbar(el, parts, opts = {}) {
  const { size = 'thin', aria = '' } = opts;
  const ps = parts.filter((p) => p.value > 0);
  el.classList.add('rp-ch', 'rp-ch-segwrap');
  mount(el, html`<div class="rp-ch-seg rp-ch-seg-${size}" role="img" aria-label="${aria}">
    ${ps.map((p, i) => html`<span class="rp-ch-seg-part" data-key="${p.key || ''}"${p.tip ? html` data-tip="${p.tip}" tabindex="0"` : ''} style="flex:${p.value} 1 0px;background:${color(p.color)};--i:${i}">${size === 'tall' && p.label ? html`<b style="color:${color(p.labelColor || '#fff')}">${p.label}</b>` : ''}</span>`)}
  </div>`);
  let ro = null;
  if (size === 'tall') {
    const fit = () => el.querySelectorAll('.rp-ch-seg-part').forEach((n) => { const b = n.querySelector('b'); if (b) { b.hidden = false; b.hidden = b.scrollWidth + 14 > n.clientWidth; } });
    fit();
    ro = new ResizeObserver(fit); ro.observe(el);
  }
  const stop = whenVisible(el, () => el.classList.add('is-in'));
  return { el, destroy: () => { stop(); ro && ro.disconnect(); } };
}

/* =====================================================================
   3. Money calendar: months side by side (Mon-Sun), every payment a dot
      in its day, area ~ amount (sqrt scale). Amounts >= cap are drawn as
      a ring at the largest size. Pointing anywhere in a day picks the
      nearest dot and lights up every payment to the same shop.
   ===================================================================== */
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const monthName = (ym) => fmt.month(ym, true).split(' ')[0];
function rowsOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  const off = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  return Math.ceil((off + new Date(y, m, 0).getDate()) / 7);
}
/** Greedy circle packing around the biggest circle; result is centred on 0,0. */
function pack(cs, gap) {
  const order = cs.map((c, i) => ({ ...c, i })).sort((a, b) => b.r - a.r);
  const placed = [];
  for (const c of order) {
    if (!placed.length) { placed.push({ ...c, x: 0, y: 0 }); continue; }
    let best = null;
    for (const p of placed) {
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2, d = p.r + c.r + gap;
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + c.r + gap - 1e-6)) continue;
        const s = Math.hypot(x * 0.85, y * 1.25);
        if (!best || s < best.s) best = { x, y, s };
      }
    }
    placed.push({ ...c, x: best ? best.x : 0, y: best ? best.y : 0 });
  }
  const x0 = Math.min(...placed.map((p) => p.x - p.r)), x1 = Math.max(...placed.map((p) => p.x + p.r));
  const y0 = Math.min(...placed.map((p) => p.y - p.r)), y1 = Math.max(...placed.map((p) => p.y + p.r));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { pts: placed.sort((a, b) => a.i - b.i).map((p) => ({ ...p, x: p.x - cx, y: p.y - cy })), w: x1 - x0, h: y1 - y0 };
}

export function calendar(el, opts = {}) {
  const { months = [], cap = 5000, meta } = opts;
  let items = opts.items || [], focusIds = null, hoverIds = null, hoverId = null, alive = true, swapT = 0;
  const dotsByMonth = new Map();
  const [sy, sm] = (months[0] || '2026-01').split('-').map(Number);
  const start = new Date(sy, sm - 1, 1);
  el.classList.add('rp-ch', 'rp-cal', 'is-pre');
  mount(el, html`<div class="rp-cal-months">${months.map((ym) => html`
    <div class="rp-cal-month" data-ym="${ym}">
      <div class="rp-cal-mhead"><span class="rp-cal-mname">${monthName(ym)}</span><span class="rp-cal-mmeta"></span></div>
      <div class="rp-cal-plot" data-ym="${ym}"></div>
    </div>`)}</div>`);
  const wrap = el.querySelector('.rp-cal-months');
  const plots = [...el.querySelectorAll('.rp-cal-plot')];

  function drawMonth(plot, ym, rows) {
    const w = Math.floor(plot.getBoundingClientRect().width);
    if (!w) return;
    const cw = w / 7, ch = Math.round(Math.min(cw * (opts.aspect || 1.2), 70)), head = 24, H = head + rows * ch;
    const [y, m] = ym.split('-').map(Number);
    const off = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
    const rMax = Math.min(14, cw * 0.31), rMin = Math.max(3.4, Math.min(4.8, cw * 0.115));
    const R = (a) => (a >= cap ? rMax : rMin + (rMax - rMin) * Math.sqrt(Math.max(0, a) / cap));
    const mine = items.filter((it) => it.date.slice(0, 7) === ym);
    const byDay = new Map();
    mine.forEach((it) => { const d = Number(it.date.slice(8, 10)); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(it); });
    const dots = [], cells = [];
    for (let d = 1; d <= days; d++) {
      const k = off + d - 1, x = (k % 7) * cw, yy = head + Math.floor(k / 7) * ch;
      const its = byDay.get(d) || [];
      const dayIndex = Math.round((new Date(y, m - 1, d) - start) / 864e5);
      cells.push({ x, y: yy, d, n: its.length, lit: !!focusIds && its.some((it) => focusIds.has(String(it.id))), label: its.length ? `${d} ${monthName(ym)}: ${its.map((it) => `${it.name || ''} ${fmt.inr(it.amount)}`).join(', ')}` : '' });
      if (!its.length) continue;
      const P = pack(its.map((it) => ({ r: R(it.amount), it })), 1.6);
      const s = Math.min(1, (cw - 10) / P.w, (ch - 17) / P.h);
      const ccx = x + cw / 2, ccy = yy + ch / 2 + 4;
      P.pts.forEach((p) => dots.push({ x: ccx + p.x * s, y: ccy + p.y * s, r: Math.max(2.5, p.r * s), it: p.it, ring: p.it.amount >= cap, delay: dayIndex * 9 }));
    }
    dotsByMonth.set(ym, dots);
    const order = [...dots].sort((a, b) => b.r - a.r);
    const sel = (it) => focusIds && focusIds.has(it.id);
    plot.innerHTML = String(html`<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${`${monthName(ym)}: ${mine.length} payments`}">
      ${WD.map((t, c) => html`<text class="rp-cal-wd" x="${r2(c * cw + cw / 2)}" y="13">${t}</text>`)}
      ${cells.map((c) => html`<g${c.n ? html` aria-label="${c.label}"` : ''}><rect class="rp-cal-cell${c.n ? ' has' : ''}${c.lit ? ' is-lit' : ''}" x="${r2(c.x + 2)}" y="${r2(c.y + 2)}" width="${r2(cw - 4)}" height="${ch - 4}" rx="7"/><text class="rp-cal-day" x="${r2(c.x + 8)}" y="${c.y + 15}">${c.d}</text></g>`)}
      ${order.filter((p) => sel(p.it)).map((p) => html`<circle class="rp-cal-halo" cx="${r2(p.x)}" cy="${r2(p.y)}" r="${r2(p.r + 4.5)}" fill="${color(p.it.color)}"/>`)}
      ${order.map((p) => (p.ring
        ? html`<circle class="rp-cal-dot is-ring${sel(p.it) ? ' is-sel' : ''}" data-id="${p.it.id}" cx="${r2(p.x)}" cy="${r2(p.y)}" r="${r2(p.r - 1)}" fill="var(--rp-cell)" style="--d:${p.delay}ms;stroke:${color(p.it.color)}"/>`
        : html`<circle class="rp-cal-dot${sel(p.it) ? ' is-sel' : ''}" data-id="${p.it.id}" cx="${r2(p.x)}" cy="${r2(p.y)}" r="${r2(p.r)}" fill="${color(p.it.color)}" style="--d:${p.delay}ms"/>`))}
    </svg>`);
    const metaEl = plot.parentElement.querySelector('.rp-cal-mmeta');
    if (metaEl) metaEl.textContent = meta ? meta(ym, mine) : `${mine.length} payments`;
  }

  function paintStates() {
    el.classList.toggle('is-focus', !!focusIds);
    el.classList.toggle('is-hl', !!hoverIds);
    el.querySelectorAll('.rp-cal-dot').forEach((n) => {
      const id = n.getAttribute('data-id');
      n.classList.toggle('is-on', !!hoverIds && hoverIds.has(id));
      n.classList.toggle('is-hover', id === hoverId);
    });
  }

  let lastW = 0;
  function draw(force) {
    const w = Math.floor(wrap.getBoundingClientRect().width);
    if (!w || (!force && w === lastW)) return;
    lastW = w;
    const side = plots.length > 1 && plots[0].getBoundingClientRect().width * 2 < w;
    const maxRows = Math.max(...months.map(rowsOf));
    months.forEach((ym, i) => drawMonth(plots[i], ym, side ? maxRows : rowsOf(ym)));
    paintStates();
  }
  draw(true);
  let raf = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => alive && draw(false)); });
  ro.observe(wrap);

  /* nearest-dot hover: the whole day cell is the hit target */
  const byIdKey = () => { const m = new Map(); items.forEach((it) => m.set(String(it.id), it)); return m; };
  let index = byIdKey();
  const nearest = (e) => {
    const plot = e.target.closest && e.target.closest('.rp-cal-plot');
    if (!plot) return null;
    const svg = plot.querySelector('svg'); if (!svg) return null;
    const b = svg.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    let best = null, bd = 1e9;
    for (const d of dotsByMonth.get(plot.dataset.ym) || []) {
      const dist = Math.hypot(d.x - px, d.y - py) - d.r;
      if (dist < bd) { bd = dist; best = d; }
    }
    return best && bd < 14 ? best : null;
  };
  const onMove = (e) => {
    e.stopPropagation(); // the calendar owns its tooltip; a parent tip.bind would hide it
    const d = nearest(e);
    if (!d) { el.style.cursor = ''; if (hoverId) { hoverId = null; hoverIds = null; paintStates(); } tip.hide(); return; }
    tip.show(d.it.tip || '', e.clientX, e.clientY);
    el.style.cursor = d.it.pick && opts.onPick ? 'pointer' : '';
    const id = String(d.it.id);
    if (id !== hoverId) {
      hoverId = id;
      hoverIds = new Set(items.filter((it) => it.key === d.it.key).map((it) => String(it.id)));
      paintStates();
    }
  };
  const onLeave = () => { el.style.cursor = ''; hoverId = null; hoverIds = null; paintStates(); tip.hide(); };
  /* Touch: a tap shows the tooltip, it does not pick (the detail block can be a long way down). */
  const onClick = (e) => { if (!opts.onPick || !matchMedia('(hover: hover)').matches) return; const d = nearest(e); if (d && d.it.pick) opts.onPick(d.it); };
  el.addEventListener('click', onClick);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onMove);
  el.addEventListener('pointerleave', onLeave);

  const stopV = whenVisible(el, () => {
    el.classList.remove('is-pre');
    if (reducedMotion() || el.closest('.rp-still')) return;
    el.classList.add('is-anim');
    setTimeout(() => el.classList.remove('is-anim'), 1700);
  });

  return {
    el,
    /** Replace the dots (e.g. a different view). Fades the new set in. */
    update(next) {
      items = next || []; index = byIdKey(); hoverIds = null; hoverId = null;
      draw(true);
      if (!el.classList.contains('is-pre') && !reducedMotion()) { el.classList.remove('is-swap'); void el.offsetWidth; el.classList.add('is-swap'); clearTimeout(swapT); swapT = setTimeout(() => el.classList.remove('is-swap'), 420); }
    },
    /** Keep these ids bright (with a soft halo) and dim the rest. null clears. */
    focus(ids) { focusIds = ids && ids.size ? new Set([...ids].map(String)) : null; draw(true); },
    /** Temporary highlight (e.g. while pointing at a list row). null clears. */
    hover(ids) { hoverIds = ids && ids.size ? new Set([...ids].map(String)) : null; hoverId = null; paintStates(); },
    has(id) { return index.has(String(id)); },
    destroy() {
      alive = false; clearTimeout(swapT); ro.disconnect(); cancelAnimationFrame(raf); stopV();
      el.removeEventListener('click', onClick); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerdown', onMove); el.removeEventListener('pointerleave', onLeave);
    },
  };
}
