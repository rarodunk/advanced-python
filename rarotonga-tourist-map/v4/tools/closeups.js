/* =========================================================================
   CLOSE-UPS — painted detail for one place, past a certain zoom.

   The island painting is one picture at roughly ten metres a pixel. It holds
   up until you go looking at a single hotel, and then there is nothing there.
   A close-up is a second, much smaller painting of one property, registered
   to its own patch of coastline, that fades in when you have zoomed far
   enough that it would fill a good part of the screen.

   It is the same idea as the base map and obeys the same rule: the picture is
   art, the position is geography. A close-up carries the bounding box it
   covers in latitude and longitude, so it lands on the ground it depicts and
   the pins keep their own coordinates on top of it.

   v4/closeups.json holds the register. Nothing here runs without it.
   ========================================================================= */
(function(){
const ART = (typeof CLOSEUP_ART !== "undefined" && CLOSEUP_ART) || {};
const KEY = "raro4.closeups";
const FADE_FROM = 0.34, FADE_TO = 0.62;   // fraction of the screen it covers

const local = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
                       catch(e){ return {}; } })();
// A record with a bbox is a top-down painting of a patch of ground and goes
// on the map. A record without one is card art — a scene, drawn from eye
// level, with signage in it — and belongs at the top of the place's card and
// nowhere near the terrain.
const boxes = {};                          // id -> {bbox, rot}
for (const id of Object.keys(ART))
  if (ART[id].bbox) boxes[id] = { bbox: ART[id].bbox.slice(), rot: ART[id].rot || 0 };
for (const id of Object.keys(local)) if (boxes[id]) Object.assign(boxes[id], local[id]);

const layer = document.createElement("div");
Object.assign(layer.style, { position:"absolute", left:"0", top:"0", width:IMG_W + "px",
                             height:IMG_H + "px", pointerEvents:"none" });
world.appendChild(layer);

const nodesFor = new Map();
function elFor(id){
  let el = nodesFor.get(id);
  if (!el){
    el = document.createElement("img");
    el.src = ART[id].src;
    el.alt = "";
    Object.assign(el.style, { position:"absolute", display:"none", maxWidth:"none",
                              transformOrigin:"50% 50%", pointerEvents:"none",
                              borderRadius:"2px", opacity:"0" });
    layer.appendChild(el);
    nodesFor.set(id, el);
  }
  return el;
}

function rectOf(id){
  const [w, s, e, n] = boxes[id].bbox;
  const tl = llToImg(n, w), br = llToImg(s, e);
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

window.drawCloseups = function(){
  if (window.mode3d) { layer.style.display = "none"; return; }
  layer.style.display = "";
  for (const id of Object.keys(boxes)){
    const el = elFor(id), r = rectOf(id);
    // how much of the screen this close-up would cover at the current zoom
    const cover = (r.w * cam.zoom) / innerWidth;
    const op = Math.max(0, Math.min(1, (cover - FADE_FROM) / (FADE_TO - FADE_FROM)));
    if (op <= 0 && !editing()){ el.style.display = "none"; continue; }
    el.style.display = "";
    el.style.left = r.x + "px"; el.style.top = r.y + "px";
    el.style.width = r.w + "px"; el.style.height = r.h + "px";
    el.style.transform = boxes[id].rot ? `rotate(${boxes[id].rot}deg)` : "";
    el.style.opacity = String(editing() ? Math.max(0.5, op) : op);
  }
};

/* ---------- the card's picture ---------- */
// A place with a close-up shows it at the top of its card, so the sheet is
// looking at the same painting the map is.
const openPlaceInner = window.openPlace;
if (typeof openPlaceInner === "function"){
  window.openPlace = function(id, fly){
    const out = openPlaceInner.apply(this, arguments);
    const art = ART[id];
    if (art){
      const band = document.querySelector("#sheetBody .hero .band");
      if (band){
        // The renderings are upright, and what matters in them — the sign, the
        // roof, the boat — sits above the middle, so the crop is taken from
        // the upper third rather than the centre, and the band is given more
        // height to show it in.
        band.style.background = `#0b2740 center 30%/cover no-repeat url(${art.src})`;
        band.style.height = "172px";
        band.textContent = "";
      }
    }
    return out;
  };
}

/* ---------- placing one by hand ---------- */
// Registering a close-up by typing coordinates is miserable. Select a place,
// press c, then drag it into position, wheel to size it and [ ] to turn it.
// The panel gives you the numbers to paste back into v4/closeups.json.
let mode = null;
const editing = () => mode !== null;
const panel = document.createElement("div");
panel.id = "closeupPanel";
panel.hidden = true;
document.body.appendChild(panel);

function save(){
  const out = {};
  for (const id of Object.keys(boxes)) out[id] = boxes[id];
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch(e){}
  panel.innerHTML = "<b>Placing " + mode + "</b>" +
    "<p>Drag to move, wheel to resize, <code>[</code> and <code>]</code> to turn. " +
    "Paste this into <code>v4/closeups.json</code>.</p><pre>" +
    JSON.stringify({ [mode]: { file: (ART[mode] && ART[mode].file) || mode + ".jpg",
                               bbox: boxes[mode].bbox.map(v => +v.toFixed(5)),
                               rot: +boxes[mode].rot.toFixed(1) } }, null, 1) +
    "</pre>";
}

function startEdit(id){
  if (!boxes[id]) return;        // card art has no place on the map to adjust
  mode = id; panel.hidden = false; document.body.classList.add("placing");
  save(); camDirty = true;
}
function stopEdit(){ mode = null; panel.hidden = true;
                     document.body.classList.remove("placing"); camDirty = true; }

addEventListener("keydown", ev => {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
  if (ev.key === "c"){
    if (editing()) stopEdit();
    else if (state.sel) startEdit(state.sel);
  } else if (editing() && (ev.key === "[" || ev.key === "]")){
    boxes[mode].rot += ev.key === "[" ? -0.5 : 0.5;
    save(); camDirty = true;
  } else if (editing() && ev.key === "Escape") stopEdit();
});

// dragging and sizing, in degrees, straight on the bounding box
stage.addEventListener("pointerdown", ev => {
  if (!editing() || ev.target.closest("#closeupPanel")) return;
  const start = { x: ev.clientX, y: ev.clientY, bbox: boxes[mode].bbox.slice() };
  const move = e => {
    const dx = (e.clientX - start.x) / cam.zoom, dy = (e.clientY - start.y) / cam.zoom;
    const a = imgToLL(0, 0), b = imgToLL(dx, dy);
    const dlon = b.lon - a.lon, dlat = b.lat - a.lat;
    boxes[mode].bbox = [start.bbox[0] + dlon, start.bbox[1] + dlat,
                        start.bbox[2] + dlon, start.bbox[3] + dlat];
    save(); camDirty = true;
  };
  const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  addEventListener("pointermove", move); addEventListener("pointerup", up);
}, true);

stage.addEventListener("wheel", ev => {
  if (!editing()) return;
  ev.preventDefault(); ev.stopPropagation();
  const k = Math.exp(ev.deltaY * 0.0015);
  const [w, s, e, n] = boxes[mode].bbox;
  const cx = (w + e) / 2, cy = (s + n) / 2;
  boxes[mode].bbox = [cx + (w - cx) * k, cy + (s - cy) * k,
                      cx + (e - cx) * k, cy + (n - cy) * k];
  save(); camDirty = true;
}, { capture:true, passive:false });

// The painted base runs out of detail long before a close-up would fill the
// screen, so the zoom ceiling has to make room for the closest one.
if (Object.keys(boxes).length){
  let need = MAX_ZOOM;
  for (const id of Object.keys(boxes)){
    const r = rectOf(id);
    need = Math.max(need, innerWidth / Math.max(1, r.w) * 1.8);
  }
  MAX_ZOOM = need;
  drawCloseups();
}
})();
