
/* =========================================================================
   THE MAP — real imagery, north up, Web Mercator.

   The base is a satellite mosaic whose exact bounding box is known, so every
   place is placed by its latitude and longitude with no model in between:
   a pin lands on the building, not on a stretch of coast.
   ========================================================================= */
const IMG_W = IMAGERY.width, IMG_H = IMAGERY.height;
const stage = document.getElementById("stage"), world = document.getElementById("world");
const island = document.getElementById("island");
island.src = ISLAND_JPG;

// Web Mercator, the projection every tile service uses, against the mosaic's bbox.
const mercX = lon => (lon + 180) / 360;
const mercY = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2;
const [BB_W, BB_S, BB_E, BB_N] = IMAGERY.bbox;
const MX0 = mercX(BB_W), MX1 = mercX(BB_E), MY0 = mercY(BB_N), MY1 = mercY(BB_S);
function llToImg(lat, lon){
  return { x: (mercX(lon) - MX0) / (MX1 - MX0) * IMG_W, y: (mercY(lat) - MY0) / (MY1 - MY0) * IMG_H };
}
function imgToLL(x, y){
  const mx = MX0 + x / IMG_W * (MX1 - MX0), my = MY0 + y / IMG_H * (MY1 - MY0);
  return { lon: mx * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180 / Math.PI };
}
// places without coordinates fall back to the island model
function toImg(deg, r){ const g = latLonOfModel(deg, r); return llToImg(g.lat, g.lon); }

const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const ISLAND_PX = llToImg(-21.2349, -159.7776);         // the island's centre in the mosaic
const cam = { x: ISLAND_PX.x, y: ISLAND_PX.y, zoom: 0.4 };
let camDirty = true, minZoom = 0.2, MAX_ZOOM = 2.2;   // raised once live tiles answer
const ISLAND_SPAN = llToImg(-21.2349, -159.7226).x - llToImg(-21.2349, -159.8326).x;   // ~12 km in image px
function fitZoom(){ return Math.min(innerWidth, innerHeight * 1.25) / ISLAND_SPAN * 0.84; }
// Home view: the island fills the width. In portrait that means bleeding a
// little sea off the sides rather than a small picture between two bands.
function homeZoom(){ return fitZoom(); }
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
function resize(){ minZoom = Math.max(fitZoom() * 0.55, Math.min(innerWidth / IMG_W, innerHeight / IMG_H)); if (cam.zoom < minZoom) cam.zoom = minZoom; placeCamera(); }
addEventListener("resize", resize);
const CAM_HOME = () => ({ x: ISLAND_PX.x, y: ISLAND_PX.y, zoom: homeZoom() });

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
   LIVE TILES — the baked mosaic is a floor, not a ceiling.

   The mosaic is one image at roughly 3 m per pixel, so zooming past it only
   magnifies pixels. Where the page can reach the tile service (a local file,
   your own hosting, the iOS build) it draws Esri tiles at the zoom level that
   matches the current view, which is the same imagery your phone's Maps shows
   and goes to street level. Where it cannot — the artifact host blocks
   third-party images — the probe below fails, the layer stays off and the
   mosaic carries the map exactly as before.
   ========================================================================= */
// Overridable so a different provider (or a test server) can be pointed at it.
const TILE_URL = (typeof window !== "undefined" && window.RARO_TILE_URL) ||
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_ZMAX = 18;                       // Esri's deepest reliable level here
let tilesOn = false;

const tileLayer = document.createElement("div");
Object.assign(tileLayer.style, { position:"absolute", left:"0", top:"0", width:IMG_W + "px",
                                 height:IMG_H + "px", pointerEvents:"none" });
world.appendChild(tileLayer);
const tileNodes = new Map();

// cam.zoom at which one tile pixel equals one screen pixel for a given level
const camZoomForLevel = z => Math.pow(2, z) * 256 * (MX1 - MX0) / IMG_W;
function levelForCam(){
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const z = Math.log2(cam.zoom * dpr * IMG_W / ((MX1 - MX0) * 256));
  return clamp(Math.round(z), 10, TILE_ZMAX);
}
// a tile's box in mosaic-image pixels, which is the space #world is drawn in
function tileBox(z, tx, ty){
  const n = Math.pow(2, z);
  return { x: (tx / n - MX0) / (MX1 - MX0) * IMG_W,
           y: (ty / n - MY0) / (MY1 - MY0) * IMG_H,
           w: (1 / n) / (MX1 - MX0) * IMG_W,
           h: (1 / n) / (MY1 - MY0) * IMG_H };
}
function drawTiles(){
  if (!tilesOn) return;
  const z = levelForCam(), n = Math.pow(2, z);
  const hw = innerWidth / 2 / cam.zoom, hh = innerHeight / 2 / cam.zoom;
  const toMercX = ix => MX0 + ix / IMG_W * (MX1 - MX0);
  const toMercY = iy => MY0 + iy / IMG_H * (MY1 - MY0);
  const x0 = Math.floor(toMercX(Math.max(0, cam.x - hw)) * n);
  const x1 = Math.floor(toMercX(Math.min(IMG_W, cam.x + hw)) * n);
  const y0 = Math.floor(toMercY(Math.max(0, cam.y - hh)) * n);
  const y1 = Math.floor(toMercY(Math.min(IMG_H, cam.y + hh)) * n);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 240) return;      // never flood the network
  const want = new Set();
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++){
    const key = z + "/" + tx + "/" + ty;
    want.add(key);
    if (tileNodes.has(key)) continue;
    const b = tileBox(z, tx, ty), img = new Image();
    Object.assign(img.style, { position:"absolute", left:b.x + "px", top:b.y + "px",
      width:Math.ceil(b.w + 1) + "px", height:Math.ceil(b.h + 1) + "px",
      maxWidth:"none", maxHeight:"none", opacity:"0", transition:"opacity .18s" });
    img.decoding = "async"; img.loading = "eager";
    img.onload = () => { img.style.opacity = "1"; };
    img.onerror = () => { img.remove(); tileNodes.delete(key); };
    img.src = TILE_URL.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
    tileLayer.appendChild(img);
    tileNodes.set(key, img);
  }
  // keep the level below as a backdrop while this one loads, drop the rest
  for (const [key, img] of tileNodes){
    if (want.has(key)) continue;
    if (+key.split("/")[0] === z - 1) continue;
    img.remove(); tileNodes.delete(key);
  }
}
// Probe one tile over the island. Success is the only thing that turns the
// layer on, so a blocked or offline page simply keeps the mosaic.
(function probeTiles(){
  const z = 12, n = Math.pow(2, z);
  const tx = Math.floor(mercX(-159.7776) * n), ty = Math.floor(mercY(-21.2349) * n);
  const probe = new Image();
  probe.onload = () => {
    tilesOn = true;
    MAX_ZOOM = camZoomForLevel(TILE_ZMAX) * 2;          // a little upscaling past the deepest level
    camDirty = true;
  };
  probe.onerror = () => { tilesOn = false; };
  probe.src = TILE_URL.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
})();

/* =========================================================================
   MARKERS — HTML pins placed over the painting. Screen-space, so they stay
   the same size at every zoom and never blur with the image.
   ========================================================================= */
const ISLAND = { lat:-21.2349, lon:-159.7776, aKm:5.69, bKm:4.00 };
const KM_LAT = 110.57, kmLon = lat => 111.32 * Math.cos(lat * Math.PI / 180);
function latLonOf(p){
  if (p.ll) return { lat: p.ll[0], lon: p.ll[1] };
  return latLonOfModel(p.deg, p.r);
}
function latLonOfModel(deg, r){
  const p = { deg, r };
  const t = p.deg * Math.PI / 180, a = ISLAND.aKm, b = ISLAND.bKm;
  const realR = (a * b) / Math.hypot(b * Math.sin(t), a * Math.cos(t));
  const km = (p.r / coastR(p.deg)) * realR;
  return { lat: ISLAND.lat + (km * Math.cos(t)) / KM_LAT,
           lon: ISLAND.lon + (km * Math.sin(t)) / kmLon(ISLAND.lat) };
}
function fromLatLon(lat, lon){
  const dx = (lon - ISLAND.lon) * kmLon(ISLAND.lat), dy = (lat - ISLAND.lat) * KM_LAT;
  let deg = Math.atan2(dx, dy) * 180 / Math.PI; if (deg < 0) deg += 360;
  const t = deg * Math.PI / 180, a = ISLAND.aKm, b = ISLAND.bKm;
  const realR = (a * b) / Math.hypot(b * Math.sin(t), a * Math.cos(t));
  return { deg, r: Math.hypot(dx, dy) / realR * coastR(deg) };
}
PLACES.forEach(p => {
  if (p.ll){ const g = fromLatLon(p.ll[0], p.ll[1]); p.deg = g.deg; p.r = g.r; }
  p.latlon = latLonOf(p); p.img = llToImg(p.latlon.lat, p.latlon.lon);
});

/* =========================================================================
   ADJUST PINS — correct a coordinate against the imagery you are looking at.

   Coordinates for small island businesses are not reliably published, so some
   pins start off by a block or two. Rather than guess from a desk, this lets
   whoever is looking at the map drag a pin onto the right roof and hands the
   corrected numbers back as a snippet for tools/geo.py, which is the single
   source every version of the guide is built from.

   Press "e", or the ✥ button, to turn it on. Edits are kept in this browser
   until you paste them back.
   ========================================================================= */
const FIX_KEY = "raro4.pinfix";
let editing = false;
const fixes = new Map(Object.entries(load(FIX_KEY, {})));

// anything corrected in a previous session applies before the first draw
for (const [id, ll] of fixes){
  const p = PLACES.find(q => q.id === id);
  if (p){ p.latlon = { lat: ll[0], lon: ll[1] }; p.img = llToImg(ll[0], ll[1]); }
}

const screenToImg = (sx, sy) => ({ x: (sx - innerWidth / 2) / cam.zoom + cam.x,
                                   y: (sy - innerHeight / 2) / cam.zoom + cam.y });

const fixPanel = document.createElement("div");
fixPanel.id = "fixPanel"; fixPanel.hidden = true;
document.body.appendChild(fixPanel);

function renderFixPanel(){
  if (!editing){ fixPanel.hidden = true; return; }
  fixPanel.hidden = false;
  const rows = [...fixes].map(([id, ll]) =>
    `    "${id}": (${ll[0].toFixed(4)}, ${ll[1].toFixed(4)}),`).join("\n");
  fixPanel.innerHTML = `
    <b>Adjust pins</b>
    <p>Drag any pin onto the right spot. Paste the result into
       <code>tools/geo.py</code> and rebuild.</p>
    ${fixes.size ? `<pre>${rows}</pre>
      <div class="fixbtns"><button id="fixCopy">Copy</button>
      <button id="fixClear">Reset all</button></div>`
     : `<p class="muted">Nothing moved yet.</p>`}
    <div class="fixbtns"><button id="fixDone">Done</button></div>`;
  const c = document.getElementById("fixCopy");
  if (c) c.onclick = () => {
    navigator.clipboard?.writeText(rows + "\n").then(() => toast("Copied"), () => toast("Copy failed"));
  };
  const r = document.getElementById("fixClear");
  if (r) r.onclick = () => {
    for (const id of [...fixes.keys()]){
      const p = PLACES.find(q => q.id === id);
      if (p && p.ll){ p.latlon = { lat: p.ll[0], lon: p.ll[1] }; p.img = llToImg(p.ll[0], p.ll[1]); }
    }
    fixes.clear(); save(FIX_KEY, {}); camDirty = true; renderFixPanel();
  };
  document.getElementById("fixDone").onclick = () => setEditing(false);
}
function setEditing(on){
  editing = on;
  document.body.classList.toggle("editing", on);
  renderFixPanel();
  if (on) toast("Drag a pin to correct it");
}
document.getElementById("editBtn").onclick = () => setEditing(!editing);
addEventListener("keydown", e => {
  if (e.key === "e" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) setEditing(!editing);
  if (e.key === "Escape" && editing) setEditing(false);
});

// Dragging is wired per pin in drawMarkers' creation loop below via this helper.
function makeDraggable(el, p){
  el.addEventListener("pointerdown", ev => {
    if (!editing) return;
    ev.preventDefault(); ev.stopPropagation();
    el.setPointerCapture(ev.pointerId);
    const start = screenToImg(ev.clientX, ev.clientY);
    const grab = { dx: p.img.x - start.x, dy: p.img.y - start.y };
    let dragged = false;
    const move = m => {
      const q = screenToImg(m.clientX, m.clientY);
      p.img = { x: q.x + grab.dx, y: q.y + grab.dy };
      const ll = imgToLL(p.img.x, p.img.y);
      p.latlon = ll;
      dragged = true;
      camDirty = true;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (!dragged) return;
      fixes.set(p.id, [p.latlon.lat, p.latlon.lon]);
      save(FIX_KEY, Object.fromEntries(fixes));
      renderFixPanel();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

const layer = document.getElementById("markers");
const nodes = new Map();
PLACES.forEach(p => {
  const el = document.createElement("button");
  el.className = "mk";
  el.innerHTML = `<span class="dot" style="background:${CATS[p.group].color}">
      <span>${CATS[p.group].icon}</span></span><span class="cap">${p.name}</span>`;
  el.onclick = ev => { ev.stopPropagation(); if (!editing) openPlace(p.id); };
  makeDraggable(el, p);
  layer.appendChild(el);
  nodes.set(p.id, el);
});
function project(pt){ return { x: (pt.x - cam.x) * cam.zoom + innerWidth / 2, y: (pt.y - cam.y) * cam.zoom + innerHeight / 2 }; }
function drawMarkers(){
  const w = innerWidth, h = innerHeight, order = [];
  const shown = visibleSet();
  // Zoomed in, every pin carries its name; zoomed out only the heroes do, so
  // the island reads at a glance instead of arriving as a wall of labels.
  const zi = cam.zoom * ISLAND_SPAN / 2000;             // 1 = island 2000 px wide, whatever the mosaic's resolution
  const near = window.mode3d ? false : zi > 0.9,
        mid  = window.mode3d ? true  : zi > 0.45,
        tiny = window.mode3d ? false : zi < 0.33;
  for (const p of PLACES){
    const el = nodes.get(p.id);
    // in the 3D setting a place sits on the terrain, so it projects through
    // that camera instead of the plan view's flat transform
    const s = (window.mode3d && window.project3D) ? project3D(p) : project(p.img);
    if (!s || s.x < -80 || s.x > w + 80 || s.y < -60 || s.y > h + 60){ el.style.display = "none"; continue; }
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
  if (camDirty){
    if (window.mode3d) draw3D(); else drawTiles();
    drawMarkers(); camDirty = false;
  }
  requestAnimationFrame(render);
}

// ?fit=1 draws the geographic coastline over the painting, for aligning MAP.
if (location.search.includes("fit=1")){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", IMG_W); svg.setAttribute("height", IMG_H);
  let d = "";
  for (let deg = 0; deg <= 360; deg += 2){ const q = toImg(deg, coastR(deg)); d += (deg ? "L" : "M") + q.x.toFixed(1) + " " + q.y.toFixed(1); }
  for (const [la, lo, n] of [[-21.2027,-159.7942,"airport"],[-21.2300,-159.7608,"Te Manga"],[-21.2625,-159.7300,"Muri"],[-21.2168,-159.8195,"Black Rock"]]){ const q = llToImg(la, lo); d += `M${q.x-20} ${q.y}L${q.x+20} ${q.y}M${q.x} ${q.y-20}L${q.x} ${q.y+20}`; }
  const marks = [0, 90, 180, 270].map(deg => { const q = toImg(deg, coastR(deg)); return `<circle cx="${q.x}" cy="${q.y}" r="14" fill="yellow"/><text x="${q.x + 18}" y="${q.y}" fill="yellow" font-size="40">${deg}</text>`; }).join("");
  const c0 = toImg(0, 0);
  svg.innerHTML = `<path d="${d}Z" fill="none" stroke="magenta" stroke-width="5"/>${marks}<circle cx="${c0.x}" cy="${c0.y}" r="12" fill="magenta"/>`;
  world.appendChild(svg);
}
