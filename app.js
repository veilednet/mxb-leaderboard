/* MX Bikes server dashboard — single-page app, no dependencies.
 *
 * Data sources:
 *   api/data  (live site)  or data.json (GitHub Pages mirror)  — history & stats
 *   api/live  (live site, polled every second) or live.json    — what's happening now
 */
"use strict";

// ------------------------------------------------------------------ state
const S = {
  data: null, live: null, mode: "loading", etag: null,
  route: { name: "home", args: [] },
  prefs: Object.assign({ units: "us", cls: "", perBike: false, q: "", track: "", sort: "laps" },
    JSON.parse(localStorage.getItem("mxb_prefs") || "{}")),
  liveFail: 0,
};
const savePrefs = () => localStorage.setItem("mxb_prefs", JSON.stringify(S.prefs));

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attr = esc;
const by = (f, dir = 1) => (a, b) => { const x = f(a), y = f(b); return x < y ? -dir : x > y ? dir : 0; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

function lap(ms) {
  if (ms == null || ms <= 0) return "—";
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return m ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}
const secT = (ms) => (ms == null || ms <= 0 ? "—" : (ms / 1000).toFixed(3));
const gapT = (ms) => (ms == null ? "" : ms === 0 ? "" : (ms > 0 ? "+" : "−") + (Math.abs(ms) / 1000).toFixed(3));
function dur(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function clock(ms) {
  const s = Math.floor((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
function ago(ts) {
  if (!ts) return "never";
  const d = Date.now() / 1000 - ts;
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)} d ago`;
  return date(ts);
}
const date = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts * 1000).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
const dateTime = (ts) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeOnly = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function speed(ms) {
  if (!ms) return "—";
  return S.prefs.units === "us" ? `${(ms * 2.23694).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`;
}
function dist(m) {
  return S.prefs.units === "us" ? `${(m / 1609.34).toFixed(m > 16093 ? 0 : 1)} mi` : `${(m / 1000).toFixed(m > 10000 ? 0 : 1)} km`;
}
const n = (x) => (x ?? 0).toLocaleString();
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
function sectors(ms, s1, s2) { return s1 && s2 && s1 < s2 && s2 < ms ? [s1, s2 - s1, ms - s2] : null; }

// ---------------------------------------------------------------- entities
const D = () => S.data;
const riderMap = () => (S._rm ||= Object.fromEntries(D().riders.map((r) => [r.rid, r])));
const trackMap = () => (S._tm ||= Object.fromEntries(D().tracks.map((t) => [t.id, t])));
function riderColor(rid) {
  const i = D().index.riders.indexOf(rid);
  return i >= 0 && i < 8 ? `var(--s${i + 1})` : "var(--muted)";
}
function initials(name) {
  const p = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p.length > 1 ? p[1][0] : (p[0] || "")[1] || "")).toUpperCase();
}
const avatar = (rid, name, cls = "") => `<span class="avatar ${cls}" style="background:${riderColor(rid)}" aria-hidden="true">${esc(initials(name))}</span>`;
function onlineRids() {
  const s = new Set();
  if (S.live && S.live.status?.state === "online" && !S.live.snapshot) (S.live.entries || []).forEach((e) => s.add(e.rid));
  return s;
}
function riderLink(rid, name, withAvatar = true) {
  const on = onlineRids().has(rid);
  return `<a class="rider" href="#/rider/${rid}">${withAvatar ? avatar(rid, name) : ""}<span class="nm">${esc(name)}</span>${on ? '<span class="live-dot on" title="Riding now"></span>' : ""}</a>`;
}
const trackLink = (id, name) => `<a href="#/track/${encodeURIComponent(id)}">${esc(name)}</a>`;
const cls = (c) => (c ? `<span class="cls">${esc(c)}</span>` : "");

/** Lap rows as objects (cached per data load). */
function laps() {
  if (S._laps) return S._laps;
  const I = D().index;
  S._laps = D().laps.rows.map((r) => ({
    ts: r[0], rid: I.riders[r[1]], track: I.tracks[r[2]], bike: I.bikes[r[3]], ms: r[4],
    s1: r[5], s2: r[6], speed: r[7], flag: r[8], timed: r[8] === 0 && r[4] > 0,
  }));
  return S._laps;
}

// ------------------------------------------------------------------ fetch
async function getJSON(url, opts = {}) {
  const r = await fetch(url, Object.assign({ cache: "no-cache" }, opts));
  if (r.status === 304) return null;
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function loadData() {
  try {
    let d;
    if (S.mode === "static") d = await getJSON("data.json");
    else {
      const r = await fetch("api/data", { headers: S.etag ? { "If-None-Match": S.etag } : {} });
      if (r.status === 304) return false;
      if (!r.ok) throw new Error(r.status);
      S.etag = r.headers.get("ETag");
      d = await r.json();
    }
    if (!d) return false;
    S.data = d; S._rm = S._tm = S._laps = null;
    return true;
  } catch (e) {
    if (S.mode !== "static") { S.mode = "static"; return loadData(); }
    throw e;
  }
}

async function detectMode() {
  try {
    const l = await getJSON("api/live");
    if (l && l.status) { S.mode = "live"; S.live = l; return; }
  } catch (e) { /* not the live site */ }
  S.mode = "static";
  try { S.live = await getJSON("live.json"); } catch (e) { S.live = null; }
}

async function pollLive() {
  if (document.hidden) return;
  try {
    const l = await getJSON(S.mode === "live" ? "api/live" : "live.json");
    if (!l) return;
    const trackChanged = l.track?.id !== S.live?.track?.id;
    S.live = l; S.liveFail = 0;
    if (trackChanged) { await loadData(); render(); } else updateLive();
  } catch (e) {
    S.liveFail++;
    if (S.liveFail === 3) updateLive();
  }
}

// ------------------------------------------------------------------ tooltip
const tip = $("#tip");
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) { tip.classList.remove("on"); return; }
  tip.innerHTML = t.getAttribute("data-tip");
  tip.classList.add("on");
});
document.addEventListener("mousemove", (e) => {
  if (!tip.classList.contains("on")) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
});
document.addEventListener("focusin", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return;
  const r = t.getBoundingClientRect();
  tip.innerHTML = t.getAttribute("data-tip"); tip.classList.add("on");
  tip.style.left = Math.min(r.left, innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = r.bottom + 8 + "px";
});
document.addEventListener("focusout", () => tip.classList.remove("on"));
document.addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-href]");
  if (row && !e.target.closest("a,button,select,input")) location.hash = row.dataset.href;
});
document.addEventListener("keydown", (e) => {
  const row = e.target.closest?.("tr[data-href]");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = row.dataset.href; }
});

// ------------------------------------------------------------------ charts
const NICE = [1, 2, 5, 10];
function niceStep(range, target) {
  const raw = range / Math.max(target, 1), mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const k of NICE) if (k * mag >= raw) return k * mag;
  return 10 * mag;
}
function ticks(min, max, target = 5, minStep = 0) {
  if (min === max) { min -= 1; max += 1; }
  const st = Math.max(niceStep(max - min, target), minStep), out = [];
  for (let v = Math.ceil(min / st) * st; v <= max + 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}

/** Scatter of laps over time + step line of the running best, per series. */
function progressChart(series, { height = 260, label = "Lap time" } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (pts.length < 2) return `<div class="empty"><b>Not enough laps yet</b>Ride a few more timed laps to see a trend.</div>`;
  const W = 760, H = height, L = 58, R = 14, T = 12, B = 30;
  let x0 = Math.min(...pts.map((p) => p.ts)), x1 = Math.max(...pts.map((p) => p.ts));
  if (x1 - x0 < 60) { x0 -= 300; x1 += 300; }
  const ys = pts.map((p) => p.ms).sort((a, b) => a - b);
  let y0 = ys[0], y1 = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))];
  if (y1 - y0 < 2000) y1 = y0 + 2000;
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (Math.min(v, y1) - y0) / (y1 - y0)) * (H - T - B);
  const yt = ticks(y0 / 1000, y1 / 1000, 5).map((v) => v * 1000);
  const xt = ticks(x0, x1, 5);
  const spanDays = (x1 - x0) / 86400;
  const xl = (v) => (spanDays > 2 ? date(v) : timeOnly(v));
  let g = `<g class="grid">${yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>`;
  const axisLap = (v) => { const m = Math.floor(v / 60000), s = (v % 60000) / 1000, ss = Number.isInteger(+s.toFixed(3)) ? String(Math.round(s)).padStart(2, "0") : s.toFixed(1).padStart(4, "0"); return m ? `${m}:${ss}` : `${ss}s`; };
  g += yt.map((v) => `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${axisLap(v)}</text>`).join("");
  g += xt.map((v) => `<text x="${X(v)}" y="${H - 8}" text-anchor="middle">${esc(xl(v))}</text>`).join("");
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  for (const s of series) {
    const sorted = [...s.points].sort(by((p) => p.ts));
    let best = Infinity, d = "";
    for (const p of sorted) {
      if (p.ms < best) { d += d ? `H${X(p.ts).toFixed(1)}V${Y(p.ms).toFixed(1)}` : `M${X(p.ts).toFixed(1)},${Y(p.ms).toFixed(1)}`; best = p.ms; }
    }
    if (d) d += `H${X(x1).toFixed(1)}`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    g += sorted.map((p) => `<circle cx="${X(p.ts).toFixed(1)}" cy="${Y(p.ms).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" ${p.ms > y1 ? 'opacity=".35"' : ""}/>`).join("");
    // generous invisible hit targets
    g += sorted.map((p) => `<circle cx="${X(p.ts).toFixed(1)}" cy="${Y(p.ms).toFixed(1)}" r="10" fill="transparent" data-tip="${attr(`<b>${esc(s.name)}</b> · ${lap(p.ms)}<br>${esc(p.bike || "")}<br><span class=muted>${dateTime(p.ts)}</span>`)}"/>`).join("");
  }
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i class="swatch" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}<span class="muted">· line = best so far</span></div>` : `<div class="legend"><span class="muted">Dots are timed laps · line is the best so far</span></div>`;
  return `${legend}<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(label)} over time">${g}</svg>`;
}

/** Vertical bars. items: [{label, value, tip}] */
function barChart(items, { height = 200, fmt = n, color = "var(--s1)", every = 1 } = {}) {
  if (!items.length || !items.some((i) => i.value)) return `<div class="empty"><b>No data yet</b></div>`;
  const W = 760, H = height, L = 40, R = 8, T = 10, B = 28;
  const max = Math.max(...items.map((i) => i.value)), yt = ticks(0, max, 4, fmt === n ? 1 : 0);
  const top = yt[yt.length - 1] || 1;
  const bw = (W - L - R) / items.length, gap = Math.min(2 + bw * 0.2, 8);
  const Y = (v) => T + (1 - v / top) * (H - T - B);
  let g = `<g class="grid">${yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>`;
  g += yt.map((v) => `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`).join("");
  items.forEach((it, i) => {
    const x = L + i * bw + gap / 2, w = Math.max(bw - gap, 1), y = Y(it.value), h = H - B - y;
    if (it.value) g += `<path d="M${x},${H - B}V${y + Math.min(4, h)}a4,4 0 0 1 4,-4h${Math.max(w - 8, 0)}a4,4 0 0 1 4,4V${H - B}z" fill="${color}"/>`;
    g += `<rect x="${x}" y="${T}" width="${w}" height="${H - B - T}" fill="transparent" data-tip="${attr(it.tip || `${esc(it.label)}: ${esc(fmt(it.value))}`)}"/>`;
    if (i % every === 0) g += `<text x="${x + w / 2}" y="${H - 9}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

function histogram(values, { height = 190, color = "var(--s1)", mark = null } = {}) {
  if (values.length < 3) return `<div class="empty"><b>Not enough timed laps yet</b></div>`;
  const v = [...values].sort((a, b) => a - b);
  const lo = v[0], hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.97))];
  const span = Math.max(hi - lo, 1000);
  const step = [250, 500, 1000, 2000, 5000, 10000].find((s) => span / s <= 16) || 20000;
  const start = Math.floor(lo / step) * step, bins = [];
  for (let b = start; b <= hi; b += step) bins.push({ from: b, to: b + step, c: 0 });
  for (const x of v) { const i = Math.min(Math.floor((x - start) / step), bins.length - 1); if (i >= 0) bins[i].c++; }
  const items = bins.map((b) => ({ label: lap(b.from).replace(/\.\d+$/, (m) => (step < 1000 ? m.slice(0, 2) : "")), value: b.c,
    tip: `${lap(b.from)} – ${lap(b.to)}<br><b>${b.c}</b> lap${b.c === 1 ? "" : "s"}` }));
  return barChart(items, { height, color, every: Math.ceil(items.length / 8) });
}

function heatmap(grid, { label = "laps" } = {}) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const max = Math.max(1, ...grid.flat());
  const W = 760, L = 40, T = 6, cw = (W - L - 4) / 24, ch = 22, H = T + ch * 7 + 24;
  let g = "";
  grid.forEach((row, d) => {
    g += `<text x="${L - 8}" y="${T + d * ch + ch / 2 + 4}" text-anchor="end">${days[d]}</text>`;
    row.forEach((c, h) => {
      const lvl = c ? 1 + Math.min(4, Math.floor((c / max) * 4.999)) : 0;
      g += `<rect x="${L + h * cw + 1}" y="${T + d * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="var(--seq-${lvl})" data-tip="${attr(`${days[d]} ${h}:00–${h + 1}:00<br><b>${c}</b> ${label}`)}"/>`;
    });
  });
  for (let h = 0; h < 24; h += 3) g += `<text x="${L + h * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p"}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity by weekday and hour">${g}</svg>
    <div class="legend" style="margin-top:6px"><span class="muted">Fewer</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i class="swatch" style="background:var(--seq-${i})"></i>`).join("")}<span class="muted">More · your local time</span></div>`;
}

function hbars(items, { fmt = n, color = "var(--s1)" } = {}) {
  if (!items.length) return `<div class="empty"><b>No data yet</b></div>`;
  const max = Math.max(...items.map((i) => i.value), 1);
  return items.map((i) => `<div class="bar-row" data-tip="${attr(i.tip || `${esc(i.label)}: ${esc(fmt(i.value))}`)}"><span class="lbl">${i.html || esc(i.label)}</span><span class="track"><span class="fill" style="width:${(100 * i.value) / max}%;background:${i.color || color}"></span></span><span class="val">${esc(fmt(i.value))}</span></div>`).join("");
}

// ------------------------------------------------------------------ maps
function mapPath(m) {
  return "M" + m.line.map((p) => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`).join("L") + "Z";
}
function mapBox(m, pad = 12) {
  const [x0, z0, x1, z1] = m.bounds;
  return `${x0 - pad} ${-z1 - pad} ${x1 - x0 + pad * 2} ${z1 - z0 + pad * 2}`;
}
function miniMap(m, { markers = false, size = "" } = {}) {
  if (!m) return `<div class="empty small" style="padding:30px 10px">Map appears after the server sends the track layout</div>`;
  // Everything is in track metres, so scale strokes and text to the track's size.
  const span = Math.max(m.bounds[2] - m.bounds[0], m.bounds[3] - m.bounds[1]), u = span / 260;
  const mk = (p, label, color) => (p ? `<circle cx="${p[0]}" cy="${-p[1]}" r="${4.5 * u}" fill="${color}" stroke="var(--surface)" stroke-width="${1.5 * u}"/><text x="${p[0] + 7 * u}" y="${-p[1] - 6 * u}" style="fill:var(--ink);font-size:${9 * u}px;font-weight:600;paint-order:stroke;stroke:var(--surface);stroke-width:${3 * u}px">${label}</text>` : "");
  return `<svg class="mini-map" viewBox="${mapBox(m, (markers ? 22 : 8) * u)}" ${size} role="img" aria-label="Track layout">
    <path d="${mapPath(m)}" style="stroke:var(--surface-3);stroke-width:${(markers ? 9 : 8) * u}"/>
    <path d="${mapPath(m)}" style="stroke-width:${2.4 * u}"/>
    ${m.sf && !markers ? `<circle class="sf" cx="${m.sf[0]}" cy="${-m.sf[1]}" r="${4.5 * u}"/>` : ""}
    ${markers ? mk(m.hs, "Holeshot", "var(--s5)") + mk(m.s1, "Split 1", "var(--s1)") + mk(m.s2, "Split 2", "var(--s3)") + mk(m.sf, "Start / finish", "var(--accent)") : ""}
  </svg>`;
}

/** Live canvas map: smooth dots between the ~1 s position updates. */
const LiveMap = {
  el: null, ctx: null, map: null, dots: {}, raf: 0, hover: null,
  mount(canvas, map, maxH = 0.72) {
    this.el = canvas; this.map = map; this.dots = {};
    if (!canvas || !map) return;
    this.ctx = canvas.getContext("2d");
    const resize = () => {
      const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      const [x0, z0, x1, z1] = map.bounds, aspect = (z1 - z0 + 40) / (x1 - x0 + 40);
      canvas.style.height = Math.min(r.width * aspect, innerHeight * maxH) + "px";
      const r2 = canvas.getBoundingClientRect();
      canvas.width = r2.width * dpr; canvas.height = r2.height * dpr;
    };
    resize();
    this._resize = resize; addEventListener("resize", resize);
    canvas.onmousemove = (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 18;
      for (const d of Object.values(this.dots)) { const dd = Math.hypot(d.sx - x, d.sy - y); if (dd < bd) { bd = dd; best = d; } }
      if (best) { tip.innerHTML = best.tip; tip.classList.add("on"); } else if (this.hover) tip.classList.remove("on");
      this.hover = best;
    };
    canvas.onmouseleave = () => { tip.classList.remove("on"); this.hover = null; };
    cancelAnimationFrame(this.raf);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  },
  unmount() { cancelAnimationFrame(this.raf); if (this._resize) removeEventListener("resize", this._resize); this.el = null; },
  update(entries) {
    const now = performance.now();
    const seen = new Set();
    for (const e of entries) {
      if (!e.pos) continue;
      seen.add(e.num);
      const d = this.dots[e.num] || (this.dots[e.num] = { x: e.pos.x, z: e.pos.z, fx: e.pos.x, fz: e.pos.z, t0: now });
      if (d.tx !== e.pos.x || d.tz !== e.pos.z) {
        const k = Math.min((now - d.t0) / 1000, 1);
        d.fx = d.fx + ((d.tx ?? d.fx) - d.fx) * k; d.fz = d.fz + ((d.tz ?? d.fz) - d.fz) * k;
        d.tx = e.pos.x; d.tz = e.pos.z; d.t0 = now;
      }
      d.num = e.num; d.color = riderColor(e.rid); d.name = e.name; d.pit = e.status === "PIT";
      d.tip = `<b>#${esc(e.num)} ${esc(e.name)}</b><br>${esc(e.bike)}<br>Best ${lap(e.session_best || e.pb)} · Last ${lap(e.last?.ms)}`;
    }
    for (const k of Object.keys(this.dots)) if (!seen.has(k)) delete this.dots[k];
  },
  draw() {
    const c = this.el, ctx = this.ctx, m = this.map;
    if (!c || !ctx || !m) return;
    const W = c.width, H = c.height, dpr = devicePixelRatio || 1;
    const [x0, z0, x1, z1] = m.bounds, pad = 20;
    const sc = Math.min(W / (x1 - x0 + pad * 2), H / (z1 - z0 + pad * 2));
    const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (z1 - z0) * sc) / 2;
    const P = (x, z) => [ox + (x - x0) * sc, oy + (z1 - z) * sc];
    const css = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = ctx.lineCap = "round";
    const path = () => { ctx.beginPath(); m.line.forEach((p, i) => { const q = P(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); };
    path(); ctx.strokeStyle = css.getPropertyValue("--surface-3"); ctx.lineWidth = 14 * dpr; ctx.stroke();
    path(); ctx.strokeStyle = css.getPropertyValue("--line-strong"); ctx.lineWidth = 3 * dpr; ctx.stroke();
    const mark = (p, color, label) => {
      if (!p) return; const q = P(p[0], p[1]);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q[0], q[1], 5 * dpr, 0, 7); ctx.fill();
      ctx.fillStyle = css.getPropertyValue("--muted"); ctx.font = `${11 * dpr}px system-ui`; ctx.fillText(label, q[0] + 8 * dpr, q[1] - 7 * dpr);
    };
    mark(m.sf, css.getPropertyValue("--accent"), "S/F"); mark(m.s1, css.getPropertyValue("--s1"), "S1"); mark(m.s2, css.getPropertyValue("--s3"), "S2");
    const now = performance.now();
    for (const d of Object.values(this.dots)) {
      const k = Math.min((now - d.t0) / 1000, 1);
      const x = d.fx + ((d.tx ?? d.fx) - d.fx) * k, z = d.fz + ((d.tz ?? d.fz) - d.fz) * k;
      const q = P(x, z); d.sx = q[0] / dpr; d.sy = q[1] / dpr;
      const col = d.color.startsWith("var(") ? css.getPropertyValue(d.color.slice(4, -1)) : d.color;
      ctx.globalAlpha = d.pit ? 0.5 : 1;
      ctx.fillStyle = col; ctx.strokeStyle = css.getPropertyValue("--surface"); ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.arc(q[0], q[1], 11 * dpr, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `700 ${10.5 * dpr}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(d.num, q[0], q[1] + 0.5);
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
    }
  },
};

// ------------------------------------------------------------- live bits
function liveState() {
  const l = S.live;
  if (!l) return { cls: "off", text: "No connection", on: false };
  if (S.mode === "live" && S.liveFail >= 3) return { cls: "off", text: "Dashboard offline", on: false };
  const st = l.status?.state;
  if (l.snapshot) return { cls: "warn", text: `Snapshot · ${ago(l.now)}`, on: false };
  if (st === "online") return { cls: "on", text: "Live", on: true };
  if (st === "reconnecting" || st === "starting") return { cls: "warn", text: "Connecting…", on: false };
  return { cls: "off", text: "Server offline", on: false };
}

function weatherText(w) {
  if (!w || !w.conditions) return "";
  const t = S.prefs.units === "us" ? `${Math.round(w.air_c * 9 / 5 + 32)}°F` : `${Math.round(w.air_c)}°C`;
  const c = { CLEAR: "Clear", CLOUDY: "Cloudy", RAINY: "Rain" }[w.conditions] || w.conditions;
  return `${c}, ${t}`;
}
function sessionText(l) {
  const ev = l.event || {}, se = l.session || {};
  const type = { OPENPRACTICE: "Open practice", RACE: "Race", STRAIGHTRHYTHM: "Straight rhythm" }[ev.type] || ev.type || "";
  const name = { OPENPRACTICE: "", WAITING: "Waiting for riders", PRACTICE: "Practice", PREQUALIFY: "Pre-qualifying",
    QUALIFYPRACTICE: "Qualifying", QUALIFY: "Qualifying race", WARMUP: "Warm-up", RACE1: "Race 1", RACE2: "Race 2" }[se.name] ?? se.name;
  return [type, name].filter(Boolean).join(" · ");
}

/** Slim one-row server status shown above the leaderboard. */
function statusHero() {
  const l = S.live, ls = liveState(), d = D();
  const ents = l && (ls.on || l.snapshot) ? l.entries || [] : [];
  const tr = l?.track?.id ? trackMap()[l.track.id] : null;
  const onTrack = ents.filter((e) => e.status === "TRK").length;
  return `<section class="card status-strip" id="status-hero" aria-live="polite">
    <span class="pill"><span class="live-dot ${ls.cls}"></span>${esc(ls.text)}</span>
    <div class="ss-main">
      <div class="ss-track">${l?.event?.track ? (tr ? trackLink(tr.id, l.event.track) : esc(l.event.track)) : esc(d.site?.name || "MX Bikes server")}</div>
      <div class="status-meta">
        ${l?.event ? `<span>${esc(sessionText(l))}</span>` : ""}
        ${l?.weather?.conditions ? `<span>${esc(weatherText(l.weather))}</span>` : ""}
        ${l?.event?.length ? `<span>${esc(dist(l.event.length))} lap</span>` : ""}
        ${l?.classification?.timer_ms && ls.on ? `<span>Session <b class="num">${clock(l.classification.timer_ms)}</b></span>` : ""}
        ${ls.on || l?.snapshot ? `<span>${ents.length ? `<b>${ents.length}</b> online · ${onTrack} on track${l.snapshot ? " at last update" : ""}` : l.snapshot ? "Nobody online at last update" : "Nobody online"}</span>` : ""}
      </div>
    </div>
    <div class="online">${ents.map((e) => `<a class="chip" href="#/rider/${e.rid}" data-tip="${attr(`${esc(e.bike)}${e.category ? " · " + esc(e.category) : ""}<br>${e.status === "PIT" ? "In the pits" : "On track"}`)}">${avatar(e.rid, e.name)}${esc(e.name)}${e.status === "PIT" ? ' <span class="muted tiny">PIT</span>' : ""}</a>`).join("")}
      ${S.mode !== "live" && d.site?.live_url ? `<a class="small" style="color:var(--accent);font-weight:600" href="${attr(d.site.live_url)}">Live dashboard →</a>` : ents.length ? `<a class="small" style="color:var(--accent);font-weight:600" href="#/live">Live timing →</a>` : ""}</div>
  </section>`;
}

function totalsTiles() {
  const t = D().totals;
  return `<div class="tiles">
    <div class="tile"><div class="k">Laps ridden</div><div class="v num">${n(t.laps)}</div><div class="d">${n(t.timed)} timed (${pct(t.timed, t.laps)}%)</div></div>
    <div class="tile"><div class="k">Time on the server</div><div class="v">${dur(t.ride_s)}</div><div class="d">${dist(t.distance_m)} covered</div></div>
    <div class="tile"><div class="k">Riders</div><div class="v num">${n(t.riders)}</div><div class="d">${n(t.bikes)} different bikes</div></div>
    <div class="tile"><div class="k">Tracks</div><div class="v num">${n(t.tracks)}</div><div class="d">since ${date(t.since)}</div></div>
  </div>`;
}

function sectorChips(sec, trackBest, riderBest) {
  if (!sec) return `<span class="secs"><span class="sec na">—</span><span class="sec na">—</span><span class="sec na">—</span></span>`;
  return `<span class="secs">${sec.map((v, i) => {
    const tb = trackBest?.[i]?.ms ?? trackBest?.[i], rb = riderBest?.[i];
    const c = tb && v <= tb ? "best" : rb && v <= rb ? "pb" : "slow";
    const lbl = c === "best" ? "fastest on this track" : c === "pb" ? "rider's best" : "slower than rider's best";
    return `<span class="sec ${c}" data-tip="${attr(`Sector ${i + 1}: <b>${secT(v)}</b><br>${lbl}${tb ? `<br>Track best ${secT(tb)}` : ""}`)}">${secT(v)}</span>`;
  }).join("")}</span>`;
}

function feedItem(it) {
  const who = it.rid ? `<a href="#/rider/${it.rid}"><b>${esc(it.name)}</b></a>` : `<b>${esc(it.name || "")}</b>`;
  const trk = it.track_name ? ` <span class="muted">· ${esc(it.track_name)}</span>` : "";
  let ic = "•", icc = "", tx = "";
  switch (it.kind) {
    case "lap": {
      const f = it.flags || [];
      if (f.includes("record")) { ic = "★"; icc = "rec"; tx = `${who} set a new <b>track record</b>: <b>${lap(it.ms)}</b>${it.prev_record ? ` <span class="muted">(${gapT(it.ms - it.prev_record)})</span>` : ""}`; }
      else if (f.includes("class_record")) { ic = "★"; icc = "rec"; tx = `${who} set the ${esc(it.category)} record: <b>${lap(it.ms)}</b>`; }
      else if (f.includes("pb")) { ic = "↑"; icc = "pb"; tx = `${who} improved their best to <b>${lap(it.ms)}</b>${it.prev_pb ? ` <span class="muted">(${gapT(it.ms - it.prev_pb)})</span>` : ""}`; }
      else { ic = "⏱"; tx = `${who} ran a <b>${lap(it.ms)}</b>`; }
      tx += `<div class="muted">${esc(it.bike)}${it.speed ? " · " + speed(it.speed) : ""}${it.late ? " · ridden before the logger connected" : ""}</div>`;
      break;
    }
    case "record": ic = "★"; icc = "rec"; tx = `${who} set the track record: <b>${lap(it.ms)}</b>${it.prev ? ` <span class="muted">(${gapT(it.ms - it.prev)})</span>` : ""}${trk}<div class="muted">${esc(it.bike)}</div>`; break;
    case "pb": ic = "↑"; icc = "pb"; tx = `${who} new personal best <b>${lap(it.ms)}</b> <span class="muted">(${gapT(it.ms - it.prev)})</span>${trk}<div class="muted">${esc(it.bike)}</div>`; break;
    case "first": ic = "1"; tx = `${who} first timed lap: <b>${lap(it.ms)}</b>${trk}<div class="muted">${esc(it.bike)}</div>`; break;
    case "untimed": ic = "!"; icc = "warn"; tx = `${who} lap not timed <span class="muted">(crash, reset or cut)</span>`; break;
    case "invalid": ic = "!"; icc = "warn"; tx = `${who} lap invalidated <span class="muted">${lap(it.ms)}</span>`; break;
    case "join": ic = "→"; icc = "pb"; tx = `${who} joined on the ${esc(it.bike)}`; break;
    case "leave": ic = "←"; tx = `${who} left the server`; break;
    case "bike": ic = "⇄"; tx = `${who} switched to the ${esc(it.bike)}`; break;
    case "contact": ic = "✕"; icc = "bad"; tx = it.wall ? `${who} hit a wall <span class="muted">(${speed(it.v)} impact)</span>` : `${who} and <b>${esc(it.with_name || "?")}</b> collided <span class="muted">(${speed(it.v)})</span>`; tx += trk; break;
    case "penalty": ic = "P"; icc = "bad"; tx = `${who} penalty: ${esc(it.seconds)}s for ${esc(String(it.offence || "").toLowerCase())}`; break;
    case "holeshot": ic = "H"; icc = "pb"; tx = `${who} took the holeshot <span class="muted">(${secT(it.ms)}s)</span>${trk}`; break;
    case "status": ic = "!"; icc = "bad"; tx = `${who} ${esc(it.state)}${it.reason ? " · " + esc(it.reason.toLowerCase()) : ""}`; break;
    case "track": ic = "⚑"; tx = `Track changed to <b>${esc(it.track)}</b>`; break;
    case "session": ic = "⚑"; tx = `Session: <b>${esc(it.session)}</b>`; break;
    default: tx = esc(it.kind);
  }
  return `<li><span class="ic ${icc}" aria-hidden="true">${ic}</span><div class="tx">${tx}</div><span class="when" title="${attr(dateTime(it.ts))}">${ago(it.ts)}</span></li>`;
}

// -------------------------------------------------------------- leaderboard
function boardRows(t, { perBike = S.prefs.perBike, cls: c = S.prefs.cls, q = S.prefs.q } = {}) {
  let rows = t.board.filter((b) => (!c || b.category === c));
  if (!perBike) { const seen = new Set(); rows = rows.filter((b) => !seen.has(b.rid) && seen.add(b.rid)); }
  if (q) { const s = q.toLowerCase(); rows = rows.filter((b) => b.name.toLowerCase().includes(s) || b.bike.toLowerCase().includes(s)); }
  return rows;
}
function leaderboardTable(t, opts = {}) {
  const rows = boardRows(t, opts);
  if (!t.board.length) return `<div class="empty"><b>No timed laps on this track yet</b>Laps show up here as soon as someone finishes a clean lap.</div>`;
  if (!rows.length) return `<div class="empty"><b>No laps match</b>Try another class or clear the search.</div>`;
  const rm = riderMap(), lead = rows[0].ms;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>Pos</th><th>Rider</th><th class="r">Best lap</th><th class="r hide-sm">Gap</th><th class="hide-md">Sectors</th><th class="hide-sm">Bike</th><th class="r hide-md">Speed</th><th class="r hide-sm">Laps</th><th class="r hide-sm">Set</th>
  </tr></thead><tbody>${rows.map((b, i) => {
    const pb = rm[b.rid]?.pbs.find((p) => p.track === t.id);
    return `<tr class="link" tabindex="0" data-href="#/rider/${b.rid}">
      <td class="pos p${i + 1}">${i + 1}</td>
      <td>${riderLink(b.rid, b.name)}<div class="show-sm tiny muted" style="margin:2px 0 0 33px">${esc(b.bike)}</div></td>
      <td class="r time">${lap(b.ms)}<div class="show-sm tiny gap">${i ? gapT(b.ms - lead) : ""}</div></td>
      <td class="r gap hide-sm">${i ? gapT(b.ms - lead) : '<span class="badge rec">Leader</span>'}</td>
      <td class="hide-md">${sectorChips(b.sec, t.sector_best, pb?.best_sec)}</td>
      <td class="bike hide-sm">${esc(b.bike)}${cls(b.category)}</td>
      <td class="r hide-md ink2">${speed(b.speed)}</td>
      <td class="r hide-sm ink2">${n(b.laps)}</td>
      <td class="r hide-sm muted nowrap" title="${attr(dateTime(b.ts))}">${ago(b.ts)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function boardControls(id) {
  const cats = D().categories;
  return `<div class="controls" data-board="${attr(id)}">
    <div class="seg" role="group" aria-label="Rows">
      <button data-pb="0" class="${S.prefs.perBike ? "" : "on"}">Best per rider</button>
      <button data-pb="1" class="${S.prefs.perBike ? "on" : ""}">Best per bike</button>
    </div>
    ${cats.length > 1 ? `<select class="sel" data-cls aria-label="Class"><option value="">All classes</option>${cats.map((c) => `<option ${c === S.prefs.cls ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>` : ""}
    <input class="search" type="search" placeholder="Search rider or bike" value="${attr(S.prefs.q)}" data-q aria-label="Search rider or bike">
  </div>`;
}
function bindBoard(root, rerender) {
  root.querySelectorAll("[data-pb]").forEach((b) => (b.onclick = () => { S.prefs.perBike = b.dataset.pb === "1"; savePrefs(); rerender(); }));
  const sel = root.querySelector("[data-cls]"); if (sel) sel.onchange = () => { S.prefs.cls = sel.value; savePrefs(); rerender(); };
  const q = root.querySelector("[data-q]");
  if (q) q.oninput = () => { S.prefs.q = q.value; savePrefs(); const body = root.querySelector("[data-board-body]"); if (body) body.innerHTML = leaderboardTable(trackMap()[body.dataset.boardBody]); };
}

function trackSummary(t) {
  const theo = t.theo && t.record ? t.theo : null;
  return `<div class="tiles t4" style="border:0;border-top:1px solid var(--line);border-radius:0">
    <div class="tile"><div class="k">Track record</div><div class="v">${lap(t.record?.ms)}</div><div class="d">${t.record ? esc(t.record.name) + " · " + esc(t.record.bike) : "—"}</div></div>
    <div class="tile"><div class="k" data-tip="Best sector 1 + best sector 2 + best sector 3 from any rider">Theoretical best ⓘ</div><div class="v">${lap(theo)}</div><div class="d">${theo ? (theo < t.record.ms ? gapT(theo - t.record.ms) + " vs record" : "the record is already perfect") : "needs split times"}</div></div>
    <div class="tile"><div class="k">Typical lap</div><div class="v">${lap(t.median)}</div><div class="d">median of ${n(t.timed)} timed laps</div></div>
    <div class="tile"><div class="k">Top lap speed</div><div class="v">${t.top_speed ? speed(t.top_speed.speed) : "—"}</div><div class="d">${t.top_speed ? esc(t.top_speed.name) : ""}</div></div>
  </div>`;
}

// ------------------------------------------------------------------ pages
const pages = {};

pages.home = () => {
  const d = D();
  const liveTrack = S.live?.track?.id;
  // Track on the server now first, then most recently ridden.
  const ordered = [...d.tracks].sort((a, b) => (b.id === liveTrack) - (a.id === liveTrack) || (b.last || 0) - (a.last || 0));
  const sel = S._pickedTrack && trackMap()[S._pickedTrack] ? S._pickedTrack : ordered[0]?.id;
  const t = trackMap()[sel];
  const recent = d.history.slice(0, 8);
  const ents = S.live && !S.live.snapshot ? S.live.entries || [] : [];
  return `
  ${staticNotice()}
  ${statusHero()}
  <section class="card" id="lb">
    <div class="card-h"><div><h2>Leaderboard</h2><div class="sub">Fastest clean lap per rider on each track</div></div>${t ? boardControls(t.id) : ""}</div>
    ${ordered.length ? `<div class="tabs" role="tablist" aria-label="Tracks">${ordered.map((x) => `<button class="tab ${x.id === sel ? "on" : ""}" role="tab" aria-selected="${x.id === sel}" data-track="${attr(x.id)}">${x.id === liveTrack && liveState().on ? '<span class="live-dot on"></span>' : ""}${esc(x.name)}<span class="muted tiny">${n(x.timed)}</span></button>`).join("")}</div>` : ""}
    <div class="card-b flush" style="margin-top:12px" data-board-body="${attr(sel || "")}">${t ? leaderboardTable(t) : `<div class="empty"><b>No laps yet</b>The board fills in as soon as someone rides.</div>`}</div>
    ${t ? trackSummary(t) : ""}
    ${t ? `<div class="card-f"><a href="#/track/${encodeURIComponent(t.id)}" style="color:var(--accent);font-weight:600">Full track stats, charts and history →</a></div>` : ""}
  </section>
  <div class="grid g-main mt">
    <div class="stack">
      ${ents.length && S.live.track?.has_map ? `<section class="card"><div class="card-h"><h2><span class="live-dot on" style="margin-right:8px"></span>On track now</h2><a class="sub" href="#/live" style="color:var(--accent);font-weight:600">Open live timing →</a></div><div class="map-wrap"><canvas id="live-map" aria-label="Live track map"></canvas></div></section>` : ""}
      <section class="card"><div class="card-h"><h2>Recent highlights</h2><span class="sub">Records, personal bests and big moments</span></div>
        ${recent.length ? `<ul class="feed">${recent.map(feedItem).join("")}</ul>` : `<div class="empty"><b>Nothing yet</b></div>`}
      </section>
    </div>
    <div class="stack">
      ${totalsTiles()}
      ${awardsPreview()}
      ${sessionsCard(d.sessions.slice(0, 4), "Recent sessions")}
    </div>
  </div>`;
};
pages.home.mount = (root) => {
  const lb = $("#lb", root);
  if (lb) {
    lb.querySelectorAll("[data-track]").forEach((b) => (b.onclick = () => { S._pickedTrack = b.dataset.track; render(true); }));
    bindBoard(lb, render);
  }
  const c = $("#live-map", root);
  if (c) { LiveMap.mount(c, trackMap()[S.live.track.id]?.map, 0.45); LiveMap.update(S.live.entries || []); }
};

function staticNotice() {
  if (S.mode !== "static") return "";
  const url = D().site?.live_url;
  return `<div class="notice"><span class="live-dot warn"></span><span>This is the backup copy, updated every few minutes.${url ? ` For live timing and the moving track map, open <a href="${attr(url)}">${esc(url.replace(/^https?:\/\//, ""))}</a>.` : ""}</span></div>`;
}

function awardsPreview() {
  const a = D().awards.slice(0, 4);
  if (!a.length) return "";
  return `<section class="card"><div class="card-h"><h2>Awards</h2><a class="sub" href="#/awards" style="color:var(--accent);font-weight:600">All awards →</a></div>
    <div class="card-b" style="display:grid;gap:10px">${a.map((x) => `<div style="display:flex;align-items:center;gap:10px">${avatar(x.top[0].rid, x.top[0].name)}<div style="min-width:0;flex:1"><div class="small muted">${esc(x.title)}</div><div style="font-weight:600">${esc(x.top[0].name)}</div></div><div style="font-weight:700">${esc(awardVal(x, x.top[0].value))}</div></div>`).join("")}</div></section>`;
}
function awardVal(a, v) {
  return { count: n, duration: dur, speed, delta: (x) => "−" + (x / 1000).toFixed(3) + "s", spread: (x) => "±" + (x / 1000).toFixed(2) + "s", impact: (x) => speed(x) }[a.fmt]?.(v) ?? v;
}

function sessionsCard(list, title) {
  return `<section class="card"><div class="card-h"><h2>${esc(title)}</h2><a class="sub" href="#/activity" style="color:var(--accent);font-weight:600">Activity →</a></div>
  ${list.length ? `<ul class="feed">${list.map((s) => `<li><span class="ic" aria-hidden="true">${s.riders.length}</span><div class="tx"><b>${esc(s.name)}</b><div class="muted">${s.riders.map((r) => esc(r.name)).join(", ")} · ${n(s.laps)} laps · ${dur(s.end - s.start)}</div>${s.riders[0]?.best ? `<div class="small">Fastest ${lap(s.riders[0].best)} · ${esc(s.riders[0].name)}</div>` : ""}</div><span class="when">${ago(s.end)}</span></li>`).join("")}</ul>` : `<div class="empty"><b>No sessions yet</b></div>`}</section>`;
}

// ---- live
pages.live = () => {
  const l = S.live;
  const tr = l?.track?.id ? trackMap()[l.track.id] : null;
  return `${staticNotice()}
  <div class="page-head"><div><h1>Live timing</h1><p id="live-sub">${l?.event?.track ? esc(l.event.track) + " · " + esc(sessionText(l)) : "Waiting for the server…"}</p></div>
    <div class="controls"><span class="pill" id="live-pill"><span class="live-dot ${liveState().cls}"></span>${esc(liveState().text)}</span>${l?.weather?.conditions ? `<span class="pill">${esc(weatherText(l.weather))}</span>` : ""}<span class="pill num" id="live-clock">${l?.classification?.timer_ms ? "Session " + clock(l.classification.timer_ms) : ""}</span></div></div>
  <div class="grid g-live">
    <section class="card"><div class="card-h"><h2>Track map</h2><span class="sub">${tr?.record ? `Record ${lap(tr.record.ms)} · ${esc(tr.record.name)}` : ""}</span></div>
      <div class="map-wrap">${tr?.map ? `<canvas id="live-map" aria-label="Live track map with rider positions"></canvas>` : `<div class="empty"><b>No map yet</b>The map appears once the server sends the track layout.</div>`}</div>
      <div class="map-legend" id="map-legend"></div></section>
    <div class="stack">
      <section class="card"><div class="card-h"><h2>Standings</h2><span class="sub">Sectors: <span class="sec best" style="min-width:0">best</span> <span class="sec pb" style="min-width:0">rider best</span> <span class="sec slow" style="min-width:0">slower</span></span></div><div id="live-table"></div></section>
      <section class="card"><div class="card-h"><h2>Live feed</h2><span class="sub">Since the dashboard connected</span></div><ul class="feed" id="live-feed"></ul></section>
    </div>
  </div>`;
};
pages.live.mount = (root) => {
  const c = $("#live-map", root);
  if (c) LiveMap.mount(c, trackMap()[S.live.track.id]?.map);
  updateLive();
};

function liveTable() {
  const l = S.live;
  if (!l || l.snapshot || l.status?.state !== "online") return `<div class="empty"><b>${l?.snapshot ? "Live timing is on the live site" : "Not connected to the server"}</b>${l?.snapshot ? "" : "It reconnects automatically."}</div>`;
  const ents = l.entries || [];
  if (!ents.length) return `<div class="empty"><b>Nobody's riding right now</b>Riders appear here the moment they join.</div>`;
  const order = l.order || [];
  const sorted = [...ents].sort(by((e) => { const i = order.indexOf(e.num); return i < 0 ? 999 : i; }));
  const tb = l.track?.sector_best || [];
  const leader = sorted.find((e) => e.session_best)?.session_best;
  return `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Pos</th><th>Rider</th><th class="r">Best</th><th class="r">Last</th><th class="hide-sm">Current lap</th><th class="r hide-sm">Laps</th></tr></thead><tbody>
  ${sorted.map((e, i) => {
    const cur = e.current || {}, s1 = cur.s1, s2 = cur.s2 && cur.s1 ? cur.s2 - cur.s1 : null;
    const chip = (v, k) => { if (!v) return `<span class="sec na">S${k + 1}</span>`; const c = tb[k] && v <= tb[k] ? "best" : e.pb_sectors?.[k] && v <= e.pb_sectors[k] ? "pb" : "slow"; return `<span class="sec ${c}">${secT(v)}</span>`; };
    const last = e.last;
    const lastTxt = last ? (last.untimed ? '<span class="badge warn">untimed</span>' : last.invalid ? '<span class="badge warn">invalid</span>' : lap(last.ms)) : "—";
    return `<tr class="link" tabindex="0" data-href="#/rider/${e.rid}"><td class="pos p${i + 1}">${i + 1}</td>
      <td>${riderLink(e.rid, e.name)}<div class="tiny muted">#${esc(e.num)} · ${esc(e.bike_short || e.bike)}${e.status === "PIT" ? ' · <span class="badge mute">PIT</span>' : ""}</div></td>
      <td class="r time">${lap(e.session_best)}<div class="tiny gap">${e.pb && e.session_best && e.session_best <= e.pb ? '<span class="badge pb">PB</span>' : e.session_best && leader && e.session_best !== leader ? gapT(e.session_best - leader) : ""}</div></td>
      <td class="r">${lastTxt}</td>
      <td class="hide-sm"><span class="secs">${chip(s1, 0)}${chip(s2, 1)}</span></td>
      <td class="r hide-sm ink2">${e.laps ?? "—"}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function updateLive() {
  const ls = liveState();
  const nd = $("#nav-live"); if (nd) nd.className = "live-dot " + ls.cls;
  const l = S.live;
  if (!l) return;
  const hero = $("#status-hero"); if (hero) hero.outerHTML = statusHero();
  const lt = $("#live-table"); if (lt) lt.innerHTML = liveTable();
  const lf = $("#live-feed");
  if (lf) lf.innerHTML = (l.feed || []).length && !l.snapshot ? l.feed.map(feedItem).join("") : `<li><div></div><div class="tx muted">Laps, joins and crashes appear here as they happen.</div><span></span></li>`;
  const pill = $("#live-pill"); if (pill) pill.innerHTML = `<span class="live-dot ${ls.cls}"></span>${esc(ls.text)}`;
  const lc = $("#live-clock"); if (lc) lc.textContent = l.classification?.timer_ms && ls.on ? "Session " + clock(l.classification.timer_ms) : "";
  const leg = $("#map-legend");
  if (leg) leg.innerHTML = (l.entries || []).filter((e) => e.pos).map((e) => `<span><i class="swatch" style="background:${riderColor(e.rid)}"></i>#${esc(e.num)} ${esc(e.name)}</span>`).join("") || `<span class="muted">Rider dots appear here while people are on track</span>`;
  if (LiveMap.el) {
    if (!document.body.contains(LiveMap.el)) LiveMap.unmount();
    else LiveMap.update(l.snapshot ? [] : l.entries || []);
  }
  renderFoot();
}

// ---- records
pages.records = () => {
  const d = D();
  if (!d.tracks.length) return `<div class="page-head"><div><h1>Records</h1></div></div><div class="card empty"><b>No records yet</b></div>`;
  return `<div class="page-head"><div><h1>Records</h1><p>Track records, class and bike records, sector bests and how each record fell</p></div></div>
  <div class="stack">${d.tracks.filter((t) => t.record).map((t) => {
    const byCat = {}, byBike = {};
    t.board.forEach((b) => { if (!byCat[b.category] || b.ms < byCat[b.category].ms) byCat[b.category] = b; if (!byBike[b.bike] || b.ms < byBike[b.bike].ms) byBike[b.bike] = b; });
    return `<section class="card"><div class="card-h"><div><h2>${trackLink(t.id, t.name)}</h2><div class="sub">${n(t.timed)} timed laps · ${t.riders} riders</div></div><span class="time big">${lap(t.record.ms)}</span></div>
    <div class="card-b grid g3">
      <div><div class="small muted" style="margin-bottom:6px">Overall record</div>${riderLink(t.record.rid, t.record.name)}<div class="small ink2" style="margin-top:4px">${esc(t.record.bike)}${cls(t.record.category)} · ${date(t.record.ts)}</div><div style="margin-top:8px">${sectorChips(t.record.sec, t.sector_best)}</div></div>
      <div><div class="small muted" style="margin-bottom:6px">Sector records</div>${t.sector_best.map((s, i) => s ? `<div class="small" style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>S${i + 1} · ${esc(s.name)}</span><b class="num">${secT(s.ms)}</b></div>` : "").join("") || '<span class="muted small">No split times yet</span>'}
        ${t.theo ? `<div class="small" style="display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><span data-tip="Sum of the three best sectors">Theoretical best ⓘ</span><b>${lap(t.theo)}</b></div>` : ""}</div>
      <div><div class="small muted" style="margin-bottom:6px">Class records</div>${Object.entries(byCat).sort(by(([, b]) => b.ms)).map(([c, b]) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>${esc(c || "—")} · ${esc(b.name)}</span><b class="num">${lap(b.ms)}</b></div>`).join("")}</div>
    </div>
    <div class="card-b" style="border-top:1px solid var(--line)"><div class="small muted" style="margin-bottom:6px">Fastest lap on each bike</div>${Object.values(byBike).sort(by((b) => b.ms)).map((b, i, a) => `<div class="small" style="display:grid;grid-template-columns:minmax(0,1fr) auto 70px;gap:12px;padding:3px 0"><span>${esc(b.bike)} <span class="muted">· ${esc(b.name)}</span></span><b class="num">${lap(b.ms)}</b><span class="gap r num" style="text-align:right">${i ? gapT(b.ms - a[0].ms) : ""}</span></div>`).join("")}</div>
    ${t.history.length > 1 ? `<div class="card-b" style="border-top:1px solid var(--line)"><div class="small muted" style="margin-bottom:8px">How the record fell</div><ul class="feed" style="margin:0 -18px">${[...t.history].reverse().map((h) => feedItem({ kind: "record", ...h })).join("")}</ul></div>` : ""}
    </section>`;
  }).join("")}</div>`;
};

// ---- riders
pages.riders = () => {
  const d = D(), sort = S.prefs.sort;
  const keys = { laps: (r) => -r.laps, time: (r) => -r.ride_s, records: (r) => -r.records * 1e6 - r.laps, last: (r) => -r.last, name: (r) => r.name.toLowerCase() };
  const list = [...d.riders].sort(by(keys[sort] || keys.laps));
  const on = onlineRids();
  return `<div class="page-head"><div><h1>Riders</h1><p>${d.riders.length} riders have been on the server</p></div>
    <div class="controls"><span class="small muted">Sort</span><div class="seg" id="rsort">${[["laps", "Laps"], ["time", "Time"], ["records", "Records"], ["last", "Recent"], ["name", "Name"]].map(([k, v]) => `<button data-s="${k}" class="${sort === k ? "on" : ""}">${v}</button>`).join("")}</div></div></div>
  <div class="cards">${list.map((r) => `<a class="card lift" href="#/rider/${r.rid}"><div class="card-b" style="display:grid;gap:14px">
    <div style="display:flex;gap:12px;align-items:center">${avatar(r.rid, r.name, "lg")}<div style="min-width:0"><div style="font-weight:700;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</div>
      <div class="small muted">${on.has(r.rid) ? '<span class="badge live">Riding now</span>' : "Last seen " + ago(r.last)}</div></div></div>
    <div class="kv"><div><div class="k">Laps</div><div class="v">${n(r.laps)}</div></div><div><div class="k">Riding</div><div class="v">${dur(r.ride_s)}</div></div><div><div class="k">Records</div><div class="v">${n(r.records)}</div></div></div>
    <div class="small ink2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.fav_bike ? "Usually on the " + esc(r.fav_bike) : ""}</div>
  </div></a>`).join("")}</div>`;
};
pages.riders.mount = (root) => $$("#rsort button", root).forEach((b) => (b.onclick = () => { S.prefs.sort = b.dataset.s; savePrefs(); render(); }));

pages.rider = ([id]) => {
  const r = riderMap()[id];
  if (!r) return notFound("rider");
  const mine = laps().filter((l) => l.rid === id);
  const timedPbs = r.pbs.filter((p) => p.ms);
  const selT = S._riderTrack && r.pbs.some((p) => p.track === S._riderTrack) ? S._riderTrack : r.pbs[0]?.track;
  const tl = mine.filter((l) => l.track === selT && l.timed);
  const live = S.live && !S.live.snapshot ? (S.live.entries || []).find((e) => e.rid === id) : null;
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  mine.forEach((l) => { const dt = new Date(l.ts * 1000); heat[(dt.getDay() + 6) % 7][dt.getHours()]++; });
  const recent = [...mine].reverse().slice(0, 25);
  const tm = trackMap();
  const others = D().riders.filter((x) => x.rid !== id);
  return `<div class="crumb"><a href="#/riders">Riders</a> /</div>
  <div class="page-head"><div class="profile-head">${avatar(r.rid, r.name, "lg")}<div><h1>${esc(r.name)}</h1><p>${live ? `<span class="badge live">Riding now</span> on the ${esc(live.bike)}` : `Last seen ${ago(r.last)}`} · first seen ${date(r.first)}</p></div></div>
    ${others.length ? `<a class="icon-btn" style="display:inline-flex;align-items:center" href="#/compare/${r.rid}/${others[0].rid}">Compare with…</a>` : ""}</div>
  <div class="tiles t4">
    <div class="tile"><div class="k">Laps</div><div class="v num">${n(r.laps)}</div><div class="d">${n(r.timed)} timed · ${pct(r.timed, r.laps)}% clean</div></div>
    <div class="tile"><div class="k">Time on server</div><div class="v">${dur(r.ride_s)}</div><div class="d">${dur(r.track_s)} on track · ${n(r.days)} day${r.days === 1 ? "" : "s"}</div></div>
    <div class="tile"><div class="k">Track records</div><div class="v num">${n(r.records)}</div><div class="d">${n(r.tracks)} track${r.tracks === 1 ? "" : "s"} ridden</div></div>
    <div class="tile"><div class="k">Top lap speed</div><div class="v">${speed(r.top_speed)}</div><div class="d">${r.contacts.n ? `${n(r.contacts.n)} contacts` : "no contacts logged"}</div></div>
  </div>
  <section class="card mt"><div class="card-h"><h2>Personal bests</h2><span class="sub">Rank, gap to the record and sector times on every track</span></div>
    ${timedPbs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Track</th><th class="r">Best</th><th class="c">Rank</th><th class="r hide-sm">To record</th><th class="hide-md">Sectors</th><th class="r hide-md" data-tip="Your best sector 1 + 2 + 3">Theoretical</th><th class="r hide-sm" data-tip="Spread of your clean laps (within 15% of your best). Lower is steadier.">Consistency</th><th>Bike</th><th class="r hide-sm">Laps</th></tr></thead><tbody>
    ${r.pbs.map((p) => `<tr class="link" tabindex="0" data-href="#/track/${encodeURIComponent(p.track)}"><td>${esc(p.name)}</td><td class="r time">${lap(p.ms)}</td>
      <td class="c">${p.rank ? `<span class="badge ${p.rank === 1 ? "rec" : "mute"}">P${p.rank}<span style="opacity:.6;font-weight:500">/${p.of}</span></span>` : "—"}</td>
      <td class="r gap hide-sm">${p.ms ? (p.gap ? gapT(p.gap) : '<span class="badge rec">Record</span>') : ""}</td>
      <td class="hide-md">${p.ms ? sectorChips(p.sec, tm[p.track]?.sector_best, p.best_sec) : ""}</td>
      <td class="r hide-md ink2">${lap(p.theo)}</td>
      <td class="r hide-sm ink2">${p.stdev != null ? "±" + (p.stdev / 1000).toFixed(2) + "s" : "—"}</td>
      <td class="bike">${esc(p.bike || "")}</td><td class="r hide-sm ink2">${n(p.timed)}<span class="muted">/${n(p.laps)}</span></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><b>No timed laps yet</b>${n(r.laps)} laps ridden, but none were clean enough to be timed.</div>`}
  </section>
  ${r.pbs.length ? `<section class="card mt"><div class="card-h"><h2>Lap times</h2><select class="sel" id="rtrack" aria-label="Track">${r.pbs.map((p) => `<option value="${attr(p.track)}" ${p.track === selT ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="card-b grid g2"><div><div class="small muted" style="margin-bottom:6px">Every timed lap</div>${progressChart([{ name: r.name, color: riderColor(r.rid), points: tl }])}</div>
    <div><div class="small muted" style="margin-bottom:6px">How your laps are spread</div>${histogram(tl.map((l) => l.ms), { color: riderColor(r.rid) })}</div></div></section>` : ""}
  <div class="grid g2 mt">
    <section class="card"><div class="card-h"><h2>Bikes</h2><span class="sub">Laps on each bike</span></div><div class="card-b">${hbars(r.bikes.map((b) => ({ label: b.bike, value: b.laps })), { color: riderColor(r.rid) })}</div></section>
    <section class="card"><div class="card-h"><h2>When ${esc(r.name)} rides</h2></div><div class="card-b">${heatmap(heat)}</div></section>
  </div>
  <section class="card mt"><div class="card-h"><h2>Recent laps</h2><span class="sub">Last ${recent.length}</span></div>
    ${recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Track</th><th class="r">Lap</th><th class="hide-md">Sectors</th><th class="hide-sm">Bike</th><th class="r hide-sm">Speed</th></tr></thead><tbody>
    ${recent.map((l) => `<tr><td class="nowrap ink2">${dateTime(l.ts)}</td><td>${esc(tm[l.track]?.name || l.track)}</td>
      <td class="r ${l.timed ? "time" : ""}">${l.timed ? lap(l.ms) : `<span class="badge warn">${l.flag === 1 ? "untimed" : "invalid"}</span>`}</td>
      <td class="hide-md">${l.timed ? sectorChips(sectors(l.ms, l.s1, l.s2), tm[l.track]?.sector_best, r.pbs.find((p) => p.track === l.track)?.best_sec) : ""}</td>
      <td class="hide-sm ink2">${esc(l.bike)}</td><td class="r hide-sm ink2">${l.timed ? speed(l.speed) : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>No laps yet</b></div>`}
  </section>
  ${r.contacts.n ? `<section class="card mt"><div class="card-h"><h2>Contact report</h2></div><div class="card-b kv"><div><div class="k">Contacts</div><div class="v">${n(r.contacts.n)}</div></div><div><div class="k">Wall hits</div><div class="v">${n(r.contacts.walls)}</div></div><div><div class="k">Hardest hit</div><div class="v">${r.contacts.hardest ? speed(r.contacts.hardest.v) : "—"}</div></div></div></section>` : ""}`;
};
pages.rider.mount = (root) => { const s = $("#rtrack", root); if (s) s.onchange = () => { S._riderTrack = s.value; render(); }; };

// ---- tracks
pages.tracks = () => {
  const d = D(), live = S.live?.track?.id;
  return `<div class="page-head"><div><h1>Tracks</h1><p>Every track the server has run</p></div></div>
  <div class="cards">${d.tracks.map((t) => `<a class="card lift" href="#/track/${encodeURIComponent(t.id)}">
    <div style="padding:14px 18px 0;height:170px;display:grid;place-items:center">${miniMap(t.map, { size: 'style="max-height:150px;max-width:100%"' })}</div>
    <div class="card-b" style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</b>${t.id === live && liveState().on ? '<span class="badge live">Live</span>' : ""}</div>
    <div class="kv"><div><div class="k">Record</div><div class="v">${lap(t.record?.ms)}</div></div><div><div class="k">Laps</div><div class="v">${n(t.laps)}</div></div><div><div class="k">Length</div><div class="v">${t.length ? dist(t.length) : "—"}</div></div></div>
    <div class="small muted">${t.record ? esc(t.record.name) + " · " : ""}last ridden ${ago(t.last)}</div></div></a>`).join("")}</div>`;
};

pages.track = ([id]) => {
  id = decodeURIComponent(id || "");
  const t = trackMap()[id];
  if (!t) return notFound("track");
  const tl = laps().filter((l) => l.track === id && l.timed);
  const byR = {};
  tl.forEach((l) => (byR[l.rid] ||= []).push(l));
  const rm = riderMap();
  const series = Object.entries(byR).sort(by(([rid]) => D().index.riders.indexOf(rid))).map(([rid, pts]) => ({ name: rm[rid]?.name || rid, color: riderColor(rid), points: pts }));
  const sess = D().sessions.filter((s) => s.track === id).slice(0, 6);
  return `<div class="crumb"><a href="#/tracks">Tracks</a> /</div>
  <div class="page-head"><div><h1>${esc(t.name)}</h1><p>${t.length ? dist(t.length) + " lap · " : ""}${n(t.laps)} laps by ${t.riders} rider${t.riders === 1 ? "" : "s"} · first ridden ${date(t.first)}</p></div></div>
  <section class="card" id="lb"><div class="card-h"><h2>Leaderboard</h2>${boardControls(t.id)}</div><div class="card-b flush" data-board-body="${attr(t.id)}">${leaderboardTable(t)}</div>${trackSummary(t)}</section>
  <div class="grid g-main mt">
    <section class="card"><div class="card-h"><h2>Lap times over time</h2><span class="sub">Every timed lap, all riders</span></div><div class="card-b">${progressChart(series, { height: 300 })}</div></section>
    <section class="card"><div class="card-h"><h2>Layout</h2><span class="sub">${t.map ? `${dist(t.map.length)} · ${t.map.elev[1] - t.map.elev[0] > 0 ? Math.round(t.map.elev[1] - t.map.elev[0]) + " m elevation change" : "flat"}` : ""}</span></div><div class="card-b" style="display:grid;place-items:center">${miniMap(t.map, { markers: true, size: 'style="width:100%;max-height:340px"' })}</div>
      <div class="card-b" style="border-top:1px solid var(--line)"><div class="small muted" style="margin-bottom:6px">Sector records</div>${t.sector_best.map((s, i) => s ? `<div class="small" style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>Sector ${i + 1} · ${esc(s.name)} <span class="muted">${esc(s.bike)}</span></span><b class="num">${secT(s.ms)}</b></div>` : "").join("") || '<span class="small muted">No split times yet</span>'}</div></section>
  </div>
  <div class="grid g2 mt">
    <section class="card"><div class="card-h"><h2>Lap time spread</h2><span class="sub">How fast laps usually are here</span></div><div class="card-b">${histogram(tl.map((l) => l.ms))}</div></section>
    <section class="card"><div class="card-h"><h2>Bikes used</h2><span class="sub">Laps per bike</span></div><div class="card-b">${hbars(t.bikes.map((b) => ({ label: b.bike, value: b.laps, tip: `${esc(b.bike)}<br>${n(b.laps)} laps${b.best ? "<br>Best " + lap(b.best) : ""}` })))}</div></section>
  </div>
  <div class="grid g2 mt">
    <section class="card"><div class="card-h"><h2>Record history</h2></div>${t.history.length ? `<ul class="feed">${[...t.history].reverse().map((h) => feedItem({ kind: "record", ...h })).join("")}</ul>` : '<div class="empty"><b>No record yet</b></div>'}</section>
    ${sessionsCard(sess, "Sessions on this track")}
  </div>`;
};
pages.track.mount = (root) => { const lb = $("#lb", root); if (lb) bindBoard(lb, render); };

// ---- bikes
pages.bikes = () => {
  const d = D();
  if (!d.bikes.length) return `<div class="page-head"><div><h1>Bikes</h1></div></div><div class="card empty"><b>No bikes yet</b></div>`;
  const total = sum(d.bikes.map((b) => b.laps)) || 1;
  return `<div class="page-head"><div><h1>Bikes</h1><p>What everyone rides, and what's fastest where</p></div></div>
  <div class="grid g2"><section class="card"><div class="card-h"><h2>Most ridden</h2><span class="sub">Share of all laps</span></div><div class="card-b">${hbars(d.bikes.slice(0, 12).map((b) => ({ label: b.bike, value: b.laps, tip: `${esc(b.bike)}<br>${n(b.laps)} laps (${pct(b.laps, total)}%)<br>${b.riders} rider${b.riders === 1 ? "" : "s"}` })))}</div></section>
  <section class="card"><div class="card-h"><h2>Time ridden</h2><span class="sub">Hours on the server per bike</span></div><div class="card-b">${hbars([...d.bikes].sort(by((b) => -b.ride_s)).slice(0, 12).map((b) => ({ label: b.bike, value: b.ride_s })), { fmt: dur, color: "var(--s3)" })}</div></section></div>
  <section class="card mt"><div class="card-h"><h2>All bikes</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bike</th><th>Class</th><th class="r">Laps</th><th class="r hide-sm">Riders</th><th class="r hide-sm">Time</th><th class="r hide-md">Top speed</th><th>Best laps</th></tr></thead><tbody>
  ${d.bikes.map((b) => `<tr><td><b>${esc(b.bike)}</b></td><td>${cls(b.category)}</td><td class="r">${n(b.laps)}</td><td class="r hide-sm">${b.riders}</td><td class="r hide-sm ink2">${dur(b.ride_s)}</td><td class="r hide-md ink2">${speed(b.top_speed)}</td>
    <td>${b.best.length ? b.best.map((x) => `<div class="small"><a href="#/track/${encodeURIComponent(x.track)}">${esc(x.name)}</a> <b class="num">${lap(x.ms)}</b> <span class="muted">${esc(x.rider)}</span></div>`).join("") : '<span class="muted small">no timed laps</span>'}</td></tr>`).join("")}
  </tbody></table></div></section>`;
};

// ---- activity
pages.activity = () => {
  const L = laps(), d = D();
  const days = 45, today = new Date(); today.setHours(0, 0, 0, 0);
  const perDay = Array.from({ length: days }, (_, i) => { const dt = new Date(today); dt.setDate(dt.getDate() - (days - 1 - i)); return { dt, c: 0, riders: new Set() }; });
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  L.forEach((l) => {
    const dt = new Date(l.ts * 1000); heat[(dt.getDay() + 6) % 7][dt.getHours()]++;
    const k = Math.floor((new Date(dt).setHours(0, 0, 0, 0) - perDay[0].dt) / 86400000 + 0.5);
    if (k >= 0 && k < days) { perDay[k].c++; perDay[k].riders.add(l.rid); }
  });
  const rm = riderMap();
  return `<div class="page-head"><div><h1>Activity</h1><p>When the server gets ridden, and who showed up</p></div></div>
  ${totalsTiles().replace('class="tiles"', 'class="tiles t4"')}
  <section class="card mt"><div class="card-h"><h2>Laps per day</h2><span class="sub">Last ${days} days</span></div><div class="card-b">${barChart(perDay.map((p) => ({ label: p.dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: p.c, tip: `${p.dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}<br><b>${p.c}</b> laps${p.riders.size ? "<br>" + [...p.riders].map((r) => esc(rm[r]?.name)).join(", ") : ""}` })), { every: 7 })}</div></section>
  <section class="card mt"><div class="card-h"><h2>Busiest times</h2><span class="sub">Laps by weekday and hour</span></div><div class="card-b">${heatmap(heat)}</div></section>
  <section class="card mt"><div class="card-h"><h2>Sessions</h2><span class="sub">A session ends after 40 minutes without a lap</span></div>
  ${d.sessions.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Track</th><th class="r hide-sm">Length</th><th class="r">Laps</th><th>Riders</th><th class="r">Fastest</th></tr></thead><tbody>
  ${d.sessions.map((s) => `<tr><td class="nowrap">${dateTime(s.start)}</td><td><a href="#/track/${encodeURIComponent(s.track)}">${esc(s.name)}</a></td><td class="r hide-sm ink2">${dur(s.end - s.start)}</td><td class="r">${n(s.laps)}</td>
    <td>${s.riders.map((r) => `<a href="#/rider/${r.rid}" class="chip plain" style="margin:1px" data-tip="${attr(`${esc(r.name)}<br>${n(r.laps)} laps · best ${lap(r.best)}<br>${esc(r.bike)}`)}">${esc(r.name)} <span class="muted tiny">${r.laps}</span></a>`).join("")}</td>
    <td class="r">${s.riders[0]?.best ? `<b>${lap(s.riders[0].best)}</b><div class="tiny muted">${esc(s.riders[0].name)}</div>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>No sessions yet</b></div>`}</section>
  ${d.results.length ? `<section class="card mt"><div class="card-h"><h2>Race results</h2></div>${d.results.map((res) => `<div class="card-b" style="border-bottom:1px solid var(--line)"><b>${esc(res.track_name)}</b> <span class="muted">· ${esc(res.session)} · ${dateTime(res.ts)}</span><ol style="margin:8px 0 0;padding-left:22px">${res.rows.map((r) => `<li>${r.rid ? `<a href="#/rider/${r.rid}">${esc(r.name)}</a>` : esc(r.name)} <span class="muted small">${esc(r.bike)} ${esc(r.gap || "")}</span></li>`).join("")}</ol></div>`).join("")}</section>` : ""}`;
};

// ---- awards
pages.awards = () => {
  const a = D().awards;
  return `<div class="page-head"><div><h1>Awards</h1><p>Bragging rights, recalculated after every lap</p></div></div>
  ${a.length ? `<div class="cards">${a.map((x) => `<section class="card award"><h3>${esc(x.title)}</h3><div class="desc">${esc(x.desc)}</div>
    <a class="first" href="#/rider/${x.top[0].rid}">${avatar(x.top[0].rid, x.top[0].name, "lg")}<div style="min-width:0"><div style="font-weight:700">${esc(x.top[0].name)}</div><div class="v">${esc(awardVal(x, x.top[0].value))}</div>${x.top[0].detail ? `<div class="small muted">${esc(x.top[0].detail)}</div>` : ""}</div></a>
    ${x.top.length > 1 ? `<ol>${x.top.slice(1).map((t, i) => `<li><span class="muted">${i + 2}</span><a href="#/rider/${t.rid}">${esc(t.name)}</a><span class="v">${esc(awardVal(x, t.value))}</span></li>`).join("")}</ol>` : ""}</section>`).join("")}</div>` : `<div class="card empty"><b>No awards yet</b>They appear once people start riding.</div>`}`;
};

// ---- compare
pages.compare = ([a, b, tid]) => {
  const d = D(), rm = riderMap();
  if (d.riders.length < 2) return `<div class="page-head"><div><h1>Compare</h1></div></div><div class="card empty"><b>Needs at least two riders</b></div>`;
  a = rm[a] ? a : d.riders[0].rid; b = rm[b] && b !== a ? b : d.riders.find((r) => r.rid !== a).rid;
  const A = rm[a], B = rm[b];
  const common = A.pbs.filter((p) => p.ms && B.pbs.some((q) => q.track === p.track && q.ms));
  const tmap = trackMap();
  tid = decodeURIComponent(tid || "");
  const t = common.some((p) => p.track === tid) ? tid : common[0]?.track;
  const pa = A.pbs.find((p) => p.track === t), pb = B.pbs.find((p) => p.track === t);
  const opt = (sel) => d.riders.map((r) => `<option value="${r.rid}" ${r.rid === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("");
  const wins = [common.filter((p) => p.ms < B.pbs.find((q) => q.track === p.track).ms).length, 0];
  wins[1] = common.length - wins[0];
  const row = (label, va, vb, fmt, lowerBetter = true) => {
    const better = va == null || vb == null || va === vb ? 0 : (va < vb) === lowerBetter ? 1 : 2;
    return `<tr><td class="ink2">${label}</td><td class="r ${better === 1 ? "time" : ""}">${fmt(va)}</td><td class="r ${better === 2 ? "time" : ""}">${fmt(vb)}</td><td class="r gap">${va != null && vb != null && typeof va === "number" ? (fmt === lap || fmt === secT ? gapT(va - vb) : "") : ""}</td></tr>`;
  };
  const tl = laps().filter((l) => l.track === t && l.timed && (l.rid === a || l.rid === b));
  return `<div class="page-head"><div><h1>Head to head</h1><p>Pick two riders and a track</p></div>
    <div class="controls"><select class="sel" id="ca" aria-label="Rider A">${opt(a)}</select><span class="muted">vs</span><select class="sel" id="cb" aria-label="Rider B">${opt(b)}</select>
    ${common.length ? `<select class="sel" id="ct" aria-label="Track">${common.map((p) => `<option value="${attr(p.track)}" ${p.track === t ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : ""}</div></div>
  <div class="tiles t4">
    <div class="tile"><div class="k">${esc(A.name)}</div><div class="v">${wins[0]} track${wins[0] === 1 ? "" : "s"}</div><div class="d">faster on</div></div>
    <div class="tile"><div class="k">${esc(B.name)}</div><div class="v">${wins[1]} track${wins[1] === 1 ? "" : "s"}</div><div class="d">faster on</div></div>
    <div class="tile"><div class="k">Laps</div><div class="v">${n(A.laps)} · ${n(B.laps)}</div><div class="d">${esc(A.name)} · ${esc(B.name)}</div></div>
    <div class="tile"><div class="k">Time on server</div><div class="v">${dur(A.ride_s)} · ${dur(B.ride_s)}</div><div class="d">${esc(A.name)} · ${esc(B.name)}</div></div>
  </div>
  ${t ? `<div class="grid g2 mt"><section class="card"><div class="card-h"><h2>${esc(tmap[t]?.name || t)}</h2><span class="sub">Bold = faster</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="r">${esc(A.name)}</th><th class="r">${esc(B.name)}</th><th class="r">Gap</th></tr></thead><tbody>
    ${row("Best lap", pa.ms, pb.ms, lap)}
    ${[0, 1, 2].map((i) => row(`Sector ${i + 1} (best)`, pa.best_sec?.[i], pb.best_sec?.[i], secT)).join("")}
    ${row("Theoretical best", pa.theo, pb.theo, lap)}
    ${row("Average clean lap", pa.avg, pb.avg, lap)}
    ${row("Consistency", pa.stdev, pb.stdev, (v) => (v == null ? "—" : "±" + (v / 1000).toFixed(2) + "s"))}
    ${row("Top lap speed", pa.speed, pb.speed, speed, false)}
    ${row("Rank", pa.rank, pb.rank, (v) => (v ? "P" + v : "—"))}
    <tr><td class="ink2">Bike</td><td class="r small">${esc(pa.bike)}</td><td class="r small">${esc(pb.bike)}</td><td></td></tr>
    </tbody></table></div></section>
    <section class="card"><div class="card-h"><h2>Every timed lap</h2></div><div class="card-b">${progressChart([{ name: A.name, color: riderColor(a), points: tl.filter((l) => l.rid === a) }, { name: B.name, color: riderColor(b), points: tl.filter((l) => l.rid === b) }])}</div></section></div>
  <section class="card mt"><div class="card-h"><h2>Every shared track</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Track</th><th class="r">${esc(A.name)}</th><th class="r">${esc(B.name)}</th><th class="r">Gap</th></tr></thead><tbody>
    ${common.map((p) => { const q = B.pbs.find((x) => x.track === p.track); return `<tr class="link" tabindex="0" data-href="#/compare/${a}/${b}/${encodeURIComponent(p.track)}"><td>${esc(p.name)}</td><td class="r ${p.ms < q.ms ? "time" : ""}">${lap(p.ms)}</td><td class="r ${q.ms < p.ms ? "time" : ""}">${lap(q.ms)}</td><td class="r gap">${gapT(p.ms - q.ms)}</td></tr>`; }).join("")}
  </tbody></table></div></section>` : `<div class="card empty mt"><b>No shared tracks yet</b>Both riders need a timed lap on the same track.</div>`}`;
};
pages.compare.mount = (root) => {
  const go = () => { location.hash = `#/compare/${$("#ca").value}/${$("#cb").value}/${encodeURIComponent($("#ct")?.value || "")}`; };
  ["#ca", "#cb", "#ct"].forEach((s) => { const el = $(s, root); if (el) el.onchange = go; });
};

// ---- help
pages.about = () => `<div class="page-head"><div><h1>How this works</h1><p>Where the numbers come from and what they mean</p></div></div>
  <section class="card"><div class="card-b prose">
  <p>A small computer (a Raspberry Pi) stays connected to the server's <b>live timing</b> feed around the clock. Every lap, split, join, crash and bike swap the server reports is saved, and this site is built from that history. Nobody needs to install anything; just ride.</p>
  <h2>Two addresses</h2>
  <ul><li><b>Live site</b>${D().site?.live_url ? ` (<a href="${attr(D().site.live_url)}">${esc(D().site.live_url.replace(/^https?:\/\//, ""))}</a>)` : ""}: updates every second, with the moving track map and live standings.</li>
  <li><b>Backup copy</b>${D().site?.pages_url ? ` (<a href="${attr(D().site.pages_url)}">${esc(D().site.pages_url.replace(/^https?:\/\//, ""))}</a>)` : ""}: the same stats, refreshed every ten minutes or so. Use it if the live site is down.</li></ul>
  <h2>Glossary</h2>
  <dl>
    <dt>Timed lap</dt><dd>A complete lap the server put a time on. Only these count for records.</dd>
    <dt>Untimed lap</dt><dd>The server reported the lap with no time, usually after a crash or reset, a track cut, or a trip through the pits.</dd>
    <dt>Sectors</dt><dd>The server times two split points per lap, which splits each lap into three sectors. <span class="sec best" style="min-width:0">Purple</span> is the fastest anyone has done that sector on this track, <span class="sec pb" style="min-width:0">green</span> is the rider's own best, and <span class="sec slow" style="min-width:0">yellow</span> is slower than their best.</dd>
    <dt>Theoretical best</dt><dd>The best sector 1, sector 2 and sector 3 added together: the lap that's possible if every part goes perfectly.</dd>
    <dt>Consistency</dt><dd>How much a rider's clean laps (within 15% of their best) vary, shown as ± seconds. Smaller is steadier.</dd>
    <dt>Lap speed</dt><dd>Average speed over the whole lap (track length ÷ lap time), not top speed.</dd>
    <dt>Session</dt><dd>A stretch of riding on one track; it ends after 40 minutes with no laps.</dd>
    <dt>Time on server</dt><dd>From joining to leaving. "On track" leaves out time sitting in the pits.</dd>
  </dl>
  <h2>Privacy</h2><p>Only in-game names, bikes and times are shown. Steam IDs are never published.</p>
  </div></section>`;

function notFound(what) {
  return `<div class="card empty" style="margin-top:20px"><b>That ${what} isn't here</b><a href="#/" style="color:var(--accent)">Back to the leaderboards</a></div>`;
}

// ---------------------------------------------------------------- router
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, ...args] = h.split("/");
  return { name: pages[name] ? name : "home", args };
}
function render(keepScroll = false) {
  if (!S.data) return;
  const y = scrollY;
  S.route = parseRoute();
  const root = $("#app");
  if (LiveMap.el) LiveMap.unmount();
  root.innerHTML = pages[S.route.name](S.route.args);
  pages[S.route.name].mount?.(root);
  const nav = { rider: "riders", track: "tracks" }[S.route.name] || S.route.name;
  $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === nav));
  document.title = `${({ home: "Leaderboards", live: "Live timing", rider: riderMap()[S.route.args[0]]?.name, track: trackMap()[decodeURIComponent(S.route.args[0] || "")]?.name }[S.route.name]) || S.route.name[0].toUpperCase() + S.route.name.slice(1)} · ${D().site?.name || "MX Bikes"}`;
  if (keepScroll) scrollTo(0, y);
  updateLive();
}
function renderFoot() {
  const d = D(); if (!d) return;
  $("#foot").innerHTML = `<span>Stats updated ${ago(d.generated)} · ${S.mode === "live" ? "live site" : "backup copy"}</span>
    <span>${d.site?.live_url && S.mode !== "live" ? `<a href="${attr(d.site.live_url)}">Live site</a> · ` : ""}${d.site?.pages_url && S.mode === "live" ? `<a href="${attr(d.site.pages_url)}">Backup copy</a> · ` : ""}<a href="#/about">How this works</a></span>`;
}

window.addEventListener("hashchange", () => { render(); scrollTo(0, 0); $("#app").focus({ preventScroll: true }); });
$("#theme").onclick = () => {
  const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = t; localStorage.setItem("mxb_theme", t); render(true);
};
const unitsBtn = $("#units");
const setUnitsLabel = () => (unitsBtn.textContent = S.prefs.units === "us" ? "mph" : "km/h");
unitsBtn.onclick = () => { S.prefs.units = S.prefs.units === "us" ? "metric" : "us"; savePrefs(); setUnitsLabel(); render(true); };

// ------------------------------------------------------------------ boot
(async function boot() {
  setUnitsLabel();
  await detectMode();
  try { await loadData(); } catch (e) {
    $("#app").innerHTML = `<div class="card empty"><b>Couldn't load the stats</b>Try refreshing in a minute.</div>`; return;
  }
  if (D().site?.name) $("#brand-name").textContent = D().site.name;
  if (!S.prefs.units_set && D().site?.units) { S.prefs.units = D().site.units === "metric" ? "metric" : "us"; S.prefs.units_set = true; savePrefs(); setUnitsLabel(); }
  render();
  setInterval(pollLive, S.mode === "live" ? 1000 : 60000);
  setInterval(async () => { if (!document.hidden && (await loadData().catch(() => false))) render(true); }, S.mode === "live" ? 15000 : 120000);
  setInterval(renderFoot, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); });
})();
