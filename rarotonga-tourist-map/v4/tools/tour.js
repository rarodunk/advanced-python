/* =========================================================================
   THE DISTRICT STRIP — a way round the island without knowing where to drag.

   Nine names, in the order the ring road passes them. Tapping one flies the
   camera there in whichever setting you are in, and the strip follows you if
   you move on your own, so it always says where you are rather than where you
   last clicked.
   ========================================================================= */
(function(){
const DISTRICTS = [
  { name:"Avarua",      lat:-21.2062, lon:-159.7748 },
  { name:"Nikao",       lat:-21.2050, lon:-159.8000 },
  { name:"Black Rock",  lat:-21.2083, lon:-159.8238 },
  { name:"Arorangi",    lat:-21.2287, lon:-159.8287 },
  { name:"Aroa",        lat:-21.2520, lon:-159.8211 },
  { name:"Vaimaanga",   lat:-21.2637, lon:-159.7935 },
  { name:"Titikaveka",  lat:-21.2716, lon:-159.7608 },
  { name:"Muri",        lat:-21.2572, lon:-159.7324 },
  { name:"Ngatangiia",  lat:-21.2470, lon:-159.7330 },
  { name:"Matavera",    lat:-21.2234, lon:-159.7329 },
];
const M_LAT = 110570, mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

const bar = document.createElement("div");
bar.id = "districts";
bar.innerHTML =
  '<button class="arw" id="dPrev" aria-label="Previous district">\u2039</button>' +
  '<div class="mid"><b id="dName"></b><div class="dots" id="dDots"></div></div>' +
  '<button class="arw" id="dNext" aria-label="Next district">\u203a</button>';
document.body.appendChild(bar);
const nameEl = bar.querySelector("#dName"), dotsEl = bar.querySelector("#dDots");
DISTRICTS.forEach(() => dotsEl.appendChild(document.createElement("i")));

let at = 0, held = 0;
function show(i){
  at = (i + DISTRICTS.length) % DISTRICTS.length;
  nameEl.textContent = DISTRICTS[at].name;
  [...dotsEl.children].forEach((d, k) => d.classList.toggle("on", k === at));
}
function go(i){
  show(i);
  const d = DISTRICTS[at];
  held = performance.now() + 1200;          // let the flight finish before following again
  if (window.mode3d && window.raro3d){
    raro3d.view.lat = d.lat; raro3d.view.lon = d.lon;
    raro3d.view.dist = Math.min(raro3d.view.dist, 2600);
    camDirty = true;
  } else {
    const im = llToImg(d.lat, d.lon);
    animateCam({ x:im.x, y:im.y, zoom: Math.max(cam.zoom, camZoomForIsland(2.6)) });
  }
}
// how far in the flat map counts as "a district fills the screen"
function camZoomForIsland(k){ return (innerWidth / (ISLAND_SPAN / k)) || cam.zoom; }

// follow the map: whichever district the middle of the screen is nearest
function follow(){
  if (performance.now() < held) return;
  const c = window.mode3d && window.raro3d
    ? { lat: raro3d.view.lat, lon: raro3d.view.lon }
    : imgToLL(cam.x, cam.y);
  let best = 0, bd = 1e18;
  DISTRICTS.forEach((d, i) => {
    const dx = (d.lon - c.lon) * mLon(c.lat), dy = (d.lat - c.lat) * M_LAT;
    const q = dx * dx + dy * dy;
    if (q < bd){ bd = q; best = i; }
  });
  if (best !== at) show(best);
}
bar.querySelector("#dPrev").onclick = () => go(at - 1);
bar.querySelector("#dNext").onclick = () => go(at + 1);
nameEl.parentElement.onclick = ev => { if (ev.target === nameEl) go(at); };
setInterval(follow, 400);
show(0);
})();
