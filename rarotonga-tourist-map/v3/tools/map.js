
/* =========================================================================
   THE MAP — a painted island, navigated like a photograph.

   The earlier versions computed the island from noise. This one shows a
   painting of it, because realism in a map comes from the picture, not the
   geometry: every place is positioned by its real bearing and distance from
   the island's centre, mapped onto the painting's perspective.
   ========================================================================= */
const IMG_W = 2360, IMG_H = 1595;
const stage = document.getElementById("stage"), world = document.getElementById("world");
const island = document.getElementById("island");
island.src = ISLAND_JPG;

// Model → painting. The painting looks north across the island with the far
// side foreshortened, so x and y scale change with how far north a point is.
const MAP = { cx:1192, cy:880, sx:2.85, sy:2.225, kx:0.0, ky:0.0 };
function toImg(deg, r){
  const t = deg * Math.PI / 180, xm = r * Math.sin(t), ym = -r * Math.cos(t), f = ym / B_UNITS;
  return { x: MAP.cx + xm * MAP.sx * (1 + MAP.kx * f), y: MAP.cy + ym * MAP.sy * (1 + MAP.ky * f) };
}

const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const cam = { x: IMG_W / 2, y: IMG_H / 2 + 20, zoom: 0.4 };
let camDirty = true, minZoom = 0.2, MAX_ZOOM = 2.6;
function fitZoom(){ return Math.min(innerWidth / IMG_W, innerHeight / IMG_H) * 0.98; }
// Home view: the island fills the width. In portrait that means bleeding a
// little sea off the sides rather than a small picture between two bands.
function homeZoom(){ const contain = fitZoom(); return innerHeight > innerWidth ? Math.min(contain * 1.45, innerHeight / IMG_H) : contain; }
function placeCamera(){
  cam.zoom = clamp(cam.zoom, minZoom, MAX_ZOOM);
  // the painting always fills the screen: no bare stage at the edges
  const hw = innerWidth / 2 / cam.zoom, hh = innerHeight / 2 / cam.zoom;
  cam.x = hw * 2 >= IMG_W ? IMG_W / 2 : clamp(cam.x, hw, IMG_W - hw);
  cam.y = hh * 2 >= IMG_H ? IMG_H / 2 : clamp(cam.y, hh, IMG_H - hh);
  const tx = innerWidth / 2 - cam.x * cam.zoom, ty = innerHeight / 2 - cam.y * cam.zoom;
  world.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${cam.zoom})`;
  camDirty = true;
}
function resize(){ minZoom = fitZoom() * 0.92; if (cam.zoom < minZoom) cam.zoom = minZoom; placeCamera(); }
addEventListener("resize", resize);
const CAM_HOME = () => ({ x: IMG_W / 2 - 10, y: IMG_H / 2 + 40, zoom: homeZoom() });

/* ---------- gestures: drag to pan, pinch or wheel to zoom about the fingers ---------- */
const ptrs = new Map();
let pinchPrev = null, moved = false, downAt = null, vel = { x:0, y:0 }, glide = 0, lastMove = 0;
let tapOnMap = false;
function zoomAt(factor, sx, sy){
  const z0 = cam.zoom, z1 = clamp(z0 * factor, minZoom, MAX_ZOOM);
  // keep the image point under (sx, sy) fixed
  cam.x += (sx - innerWidth / 2) * (1 / z0 - 1 / z1);
  cam.y += (sy - innerHeight / 2) * (1 / z0 - 1 / z1);
  cam.zoom = z1;
  placeCamera();
}
stage.addEventListener("pointerdown", e => {
  if (e.target.closest(".mk")) return;
  ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
  if (ptrs.size === 1){ downAt = { x:e.clientX, y:e.clientY }; moved = false; vel = { x:0, y:0 };
                        tapOnMap = true; cancelAnimationFrame(glide); }
  pinchPrev = null;
});
addEventListener("pointermove", e => {
  const prev = ptrs.get(e.pointerId); if (!prev) return;
  const cur = { x:e.clientX, y:e.clientY };
  ptrs.set(e.pointerId, cur);
  if (ptrs.size >= 2){
    const [a, b] = [...ptrs.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const m = { x:(a.x + b.x)/2, y:(a.y + b.y)/2 };
    if (pinchPrev){
      cam.x -= (m.x - pinchPrev.m.x) / cam.zoom; cam.y -= (m.y - pinchPrev.m.y) / cam.zoom;
      zoomAt(dist / pinchPrev.dist, m.x, m.y);
    }
    pinchPrev = { dist, m }; moved = true; return;
  }
  const dx = cur.x - prev.x, dy = cur.y - prev.y;
  if (!moved && downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) >= 4) moved = true;
  cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom;
  const now = performance.now(), dt = Math.max(8, now - lastMove); lastMove = now;
  vel = { x: vel.x * 0.5 + (dx / dt) * 0.5, y: vel.y * 0.5 + (dy / dt) * 0.5 };
  placeCamera();
});
function endPtr(e){
  if (!ptrs.delete(e.pointerId)) return;
  if (ptrs.size < 2) pinchPrev = null;
  if (ptrs.size) return;
  if (moved && Math.hypot(vel.x, vel.y) > 0.15 && performance.now() - lastMove < 80) coast();
  if (!moved && tapOnMap && sheet.classList.contains("up")) closeSheet();
  tapOnMap = false;
}
["pointerup","pointercancel"].forEach(ev => addEventListener(ev, endPtr));
function coast(){
  cancelAnimationFrame(glide);
  let last = performance.now();
  const step = now => {
    const dt = now - last; last = now;
    cam.x -= vel.x * dt / cam.zoom; cam.y -= vel.y * dt / cam.zoom;
    vel.x *= Math.pow(0.994, dt); vel.y *= Math.pow(0.994, dt);
    placeCamera();
    if (Math.hypot(vel.x, vel.y) > 0.02) glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}
stage.addEventListener("wheel", e => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  zoomAt(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.008 : 0.0022)), e.clientX, e.clientY);
}, { passive:false });
stage.addEventListener("dblclick", e => { if (!e.target.closest(".mk")) zoomAt(1.8, e.clientX, e.clientY); });

function animateCam(to, dur = 620){
  cancelAnimationFrame(glide);
  const from = { ...cam }, t0 = performance.now();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches){ Object.assign(cam, to); placeCamera(); return; }
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    for (const k in to) cam[k] = k === "zoom" ? from.zoom * Math.pow(to.zoom / from.zoom, e) : from[k] + (to[k] - from[k]) * e;
    placeCamera();
    if (t < 1) glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}
document.getElementById("zin").onclick   = () => animateCam({ zoom: cam.zoom * 1.5 }, 280);
document.getElementById("zout").onclick  = () => animateCam({ zoom: cam.zoom / 1.5 }, 280);
document.getElementById("reset").onclick = () => animateCam(CAM_HOME());

/* =========================================================================
   MARKERS — HTML pins placed over the painting. Screen-space, so they stay
   the same size at every zoom and never blur with the image.
   ========================================================================= */
const ISLAND = { lat:-21.2330, lon:-159.7820, aKm:5.18, bKm:4.14 };
const KM_LAT = 110.57, kmLon = lat => 111.32 * Math.cos(lat * Math.PI / 180);
function latLonOf(p){
  const t = p.deg * Math.PI / 180, a = ISLAND.aKm, b = ISLAND.bKm;
  const realR = (a * b) / Math.hypot(b * Math.sin(t), a * Math.cos(t));
  const km = (p.r / coastR(p.deg)) * realR;
  return { lat: ISLAND.lat + (km * Math.cos(t)) / KM_LAT,
           lon: ISLAND.lon + (km * Math.sin(t)) / kmLon(ISLAND.lat) };
}
PLACES.forEach(p => { p.img = toImg(p.deg, p.r); p.latlon = latLonOf(p); });

const layer = document.getElementById("markers");
const nodes = new Map();
PLACES.forEach(p => {
  const el = document.createElement("button");
  el.className = "mk";
  el.innerHTML = `<span class="dot" style="background:${CATS[p.group].color}">
      <span>${CATS[p.group].icon}</span></span><span class="cap">${p.name}</span>`;
  el.onclick = ev => { ev.stopPropagation(); openPlace(p.id); };
  layer.appendChild(el);
  nodes.set(p.id, el);
});
function project(pt){ return { x: (pt.x - cam.x) * cam.zoom + innerWidth / 2, y: (pt.y - cam.y) * cam.zoom + innerHeight / 2 }; }
function drawMarkers(){
  const w = innerWidth, h = innerHeight, order = [];
  const shown = visibleSet();
  // Zoomed in, every pin carries its name; zoomed out only the heroes do, so
  // the island reads at a glance instead of arriving as a wall of labels.
  const near = cam.zoom > 0.85, mid = cam.zoom > 0.42, tiny = cam.zoom < 0.34;
  for (const p of PLACES){
    const el = nodes.get(p.id), s = project(p.img);
    if (s.x < -80 || s.x > w + 80 || s.y < -60 || s.y > h + 60){ el.style.display = "none"; continue; }
    el.style.display = "";
    el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
    el.style.zIndex = String(1000 + Math.round(s.y));      // lower on screen draws on top, like depth
    el.classList.toggle("dim", !shown.has(p.id));
    el.classList.toggle("sel", state.sel === p.id);
    el.classList.toggle("tiny", tiny && !p.hero && state.sel !== p.id);
    order.push({ el, p, sx:s.x, sy:s.y, big: p.hero ? mid : near });
  }
  const boxes = order.map(o => [o.sx - 15, o.sy - 34, o.sx + 15, o.sy + 2]);
  order.sort((a, b) => (b.p.hero ? 1 : 0) - (a.p.hero ? 1 : 0) || b.sy - a.sy);
  for (const o of order){
    let named = o.big && (shown.has(o.p.id) || state.sel === o.p.id);
    if (named){
      const wpx = o.p.name.length * 6.4 + 16;
      const box = [o.sx - wpx/2, o.sy - 4, o.sx + wpx/2, o.sy + 20];
      if (boxes.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) named = false;
      else boxes.push(box);
    }
    o.el.classList.toggle("small", !named);
  }
}
function render(){
  if (camDirty){ drawMarkers(); camDirty = false; }
  requestAnimationFrame(render);
}

// ?fit=1 draws the geographic coastline over the painting, for aligning MAP.
if (location.search.includes("fit=1")){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", IMG_W); svg.setAttribute("height", IMG_H);
  let d = "";
  for (let deg = 0; deg <= 360; deg += 2){ const q = toImg(deg, coastR(deg)); d += (deg ? "L" : "M") + q.x.toFixed(1) + " " + q.y.toFixed(1); }
  const marks = [0, 90, 180, 270].map(deg => { const q = toImg(deg, coastR(deg)); return `<circle cx="${q.x}" cy="${q.y}" r="14" fill="yellow"/><text x="${q.x + 18}" y="${q.y}" fill="yellow" font-size="40">${deg}</text>`; }).join("");
  const c0 = toImg(0, 0);
  svg.innerHTML = `<path d="${d}Z" fill="none" stroke="magenta" stroke-width="5"/>${marks}<circle cx="${c0.x}" cy="${c0.y}" r="12" fill="magenta"/>`;
  world.appendChild(svg);
}
