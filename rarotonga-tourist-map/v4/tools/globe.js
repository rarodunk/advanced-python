/* =========================================================================
   THE 3D SETTING — real photography draped over real elevation.

   Nothing here is invented. The surface is the satellite mosaic the 2D view
   uses; the shape under it is a Terrarium elevation grid. That is the whole
   trick behind every convincing 3D map: the realism comes from the two data
   sets, not from shading. So the terrain is drawn essentially unlit — the
   imagery already carries the sun that was shining when it was taken — with
   only a whisper of slope shading so ridges read as ridges.

   Heights come from the elevation grid at close to true scale. Rarotonga rises
   about 650 m out of an 11 km island, and a 30 m grid rounds the sharp ridges
   down, so VEX puts a little of that back. Push it much past 1.5 and the
   island starts to look like a model of itself.
   ========================================================================= */
(function(){
const KM_LAT_M = 110570, kmLonM = lat => 111320 * Math.cos(lat * Math.PI / 180);
const VEX = 1.35;                      // vertical exaggeration; 1 is life-size
// the haze, and the colour behind everything: the mosaic's own top edge, so
// the 3D setting sits on exactly the sea the flat map fades into
const HAZE = (() => {
  const hex = (IMAGERY.edge && IMAGERY.edge.top) || "#0b2748";
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
})();

const canvas = document.createElement("canvas");
canvas.id = "globe";
Object.assign(canvas.style, { position:"absolute", inset:"0", width:"100%", height:"100%",
                              display:"none", touchAction:"none" });
stage.insertBefore(canvas, document.getElementById("markers"));

let gl = canvas.getContext("webgl2", { antialias:true, alpha:false });
let uint32 = !!gl;
if (!gl){
  gl = canvas.getContext("webgl", { antialias:true, alpha:false });
  uint32 = !!(gl && gl.getExtension("OES_element_index_uint"));
}
if (!gl){ console.warn("no WebGL; the 3D setting stays off"); return; }

/* ---------- small matrix helpers ---------- */
function perspective(fovy, aspect, near, far){
  const f = 1 / Math.tan(fovy / 2), d = near - far;
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/d,-1, 0,0,2*far*near/d,0];
}
function lookAt(eye, at, up){
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
          -dot(x,eye), -dot(y,eye), -dot(z,eye), 1];
}
const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
function mul(a, b){                       // a * b, both column-major
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k];
    o[c*4+r] = s;
  }
  return o;
}

/* ---------- shaders ---------- */
const VS = `
attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aNrm;
uniform mat4 uMVP; uniform vec3 uEye;
varying vec2 vUV; varying vec3 vNrm; varying float vDist;
void main(){
  vUV = aUV; vNrm = aNrm; vDist = distance(aPos, uEye);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FS = `
precision highp float;
uniform sampler2D uTex; uniform vec3 uSun; uniform vec3 uHaze; uniform vec2 uFog;
varying vec2 vUV; varying vec3 vNrm; varying float vDist;
void main(){
  vec3 c = texture2D(uTex, vUV).rgb;
  // The photograph already contains the light. Only a whisper of slope shading
  // goes on top, enough that a ridge reads as a ridge when the camera tilts.
  float sh = clamp(dot(normalize(vNrm), uSun) * 0.5 + 0.5, 0.0, 1.0);
  c *= mix(1.0, 0.72 + 0.55 * sh, 0.22);
  // Sea haze, which also does the quiet job of dissolving the square edge of
  // the data before you ever see it.
  float f = smoothstep(uFog.x, uFog.y, vDist);
  // and the same haze eats the last few per cent of the grid, so the square
  // edge of the data never shows as a horizon of its own
  float edge = min(min(vUV.x, 1.0 - vUV.x), min(vUV.y, 1.0 - vUV.y));
  f = max(f, 1.0 - smoothstep(0.0, 0.06, edge));
  gl_FragColor = vec4(mix(c, uHaze, f), 1.0);
}`;
function compile(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const A = { pos: gl.getAttribLocation(prog, "aPos"), uv: gl.getAttribLocation(prog, "aUV"),
            nrm: gl.getAttribLocation(prog, "aNrm") };
const U = { mvp: gl.getUniformLocation(prog, "uMVP"), tex: gl.getUniformLocation(prog, "uTex"),
            sun: gl.getUniformLocation(prog, "uSun"), eye: gl.getUniformLocation(prog, "uEye"),
            haze: gl.getUniformLocation(prog, "uHaze"), fog: gl.getUniformLocation(prog, "uFog") };

/* ---------- the elevation grid ---------- */
const TB = TERRAIN.bbox, TW = TERRAIN.width, TH = TERRAIN.height;
const [TB_W, TB_S, TB_E, TB_N] = TB;
let heights = null, ready = false, indexCount = 0;
const C_LAT = (TB_N + TB_S) / 2, C_LON = (TB_W + TB_E) / 2;
const M_LON = kmLonM(C_LAT);

// metres east/north of the grid's centre, which is the world space of the mesh
const toWorldX = lon => (lon - C_LON) * M_LON;
const toWorldZ = lat => -(lat - C_LAT) * KM_LAT_M;

function heightAtLL(lat, lon){
  if (!heights) return 0;
  const fx = (lon - TB_W) / (TB_E - TB_W) * (TW - 1);
  const fy = (lat - TB_N) / (TB_S - TB_N) * (TH - 1);
  const x = Math.max(0, Math.min(TW - 1, fx)), y = Math.max(0, Math.min(TH - 1, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(TW - 1, x0 + 1), y1 = Math.min(TH - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const h = (i, j) => heights[j * TW + i];
  return (h(x0,y0) * (1-tx) + h(x1,y0) * tx) * (1-ty) +
         (h(x0,y1) * (1-tx) + h(x1,y1) * tx) * ty;
}
window.terrainHeightAt = heightAtLL;

function buildMesh(){
  // one vertex per grid sample, capped so 16-bit indices still work if the
  // context cannot do better
  const maxSeg = uint32 ? 512 : 254;
  const N = Math.min(maxSeg, Math.max(TW, TH) - 1);
  const n1 = N + 1;
  const pos = new Float32Array(n1 * n1 * 3);
  const uv  = new Float32Array(n1 * n1 * 2);
  const nrm = new Float32Array(n1 * n1 * 3);
  const llAt = (i, j) => [TB_N + (TB_S - TB_N) * j / N, TB_W + (TB_E - TB_W) * i / N];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++){
    const k = j * n1 + i;
    const [lat, lon] = llAt(i, j);
    pos[k*3]   = toWorldX(lon);
    pos[k*3+1] = heightAtLL(lat, lon) * VEX;
    pos[k*3+2] = toWorldZ(lat);
    // texture coordinates come from the imagery's own bbox, so the picture
    // lands on the terrain without any hand calibration
    const im = llToImg(lat, lon);
    uv[k*2]   = im.x / IMG_W;
    uv[k*2+1] = im.y / IMG_H;
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++){
    const k = j * n1 + i;
    const L = pos[(j*n1 + Math.max(0,i-1))*3+1], R = pos[(j*n1 + Math.min(N,i+1))*3+1];
    const D = pos[(Math.max(0,j-1)*n1 + i)*3+1], Uu = pos[(Math.min(N,j+1)*n1 + i)*3+1];
    const sx = (toWorldX(llAt(Math.min(N,i+1),j)[1]) - toWorldX(llAt(Math.max(0,i-1),j)[1])) || 1;
    const sz = (toWorldZ(llAt(i,Math.min(N,j+1))[0]) - toWorldZ(llAt(i,Math.max(0,j-1))[0])) || 1;
    const nv = norm([-(R - L) / sx, 1, -(Uu - D) / sz]);
    nrm[k*3] = nv[0]; nrm[k*3+1] = nv[1]; nrm[k*3+2] = nv[2];
  }
  const Idx = uint32 ? Uint32Array : Uint16Array;
  const idx = new Idx(N * N * 6);
  let o = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b;
    idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  indexCount = idx.length;
  const bind = (data, loc, size) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  bind(pos, A.pos, 3); bind(uv, A.uv, 2); bind(nrm, A.nrm, 3);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return N;
}

/* ---------- load elevation, then the texture ---------- */
function decodeTerrain(img){
  const c = document.createElement("canvas");
  c.width = TW; c.height = TH;
  const cx = c.getContext("2d", { willReadFrequently:true });
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, TW, TH).data;
  heights = new Float32Array(TW * TH);
  for (let i = 0, k = 0; i < heights.length; i++, k += 4){
    const m = d[k] * 256 + d[k+1] + d[k+2] / 256 - 32768;
    // Rarotonga is the top of a seamount: the real grid falls past 2800 m a
    // few kilometres offshore. There is no water surface to hide that, so the
    // sea floor is compressed into a shallow shelf. The reef edge still reads,
    // the island does not sit in a pit.
    heights[i] = m < 0 ? Math.max(-9, m * 0.03) : m;
  }
}
const tex = gl.createTexture();
function uploadTexture(img){
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
                              Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
}
const tImg = new Image();
tImg.onload = () => {
  decodeTerrain(tImg);
  const sat = new Image();
  sat.onload = () => {
    uploadTexture(sat);
    buildMesh();
    ready = true;
    document.getElementById("d3Btn").disabled = false;
    if (window.mode3d) draw();
  };
  sat.src = ISLAND_JPG;
};
tImg.onerror = () => console.warn("terrain.png missing; run tools/fetch_terrain.py");
tImg.src = TERRAIN_PNG;

/* ---------- camera ---------- */
const view = { lat:-21.2349, lon:-159.7776, az:0.35, el:0.42, dist:11000 };
const clampV = () => {
  view.el = Math.max(0.10, Math.min(1.45, view.el));
  view.dist = Math.max(700, Math.min(40000, view.dist));
};
function eyeAndTarget(){
  const ty = heightAtLL(view.lat, view.lon) * VEX;
  const t = [toWorldX(view.lon), ty, toWorldZ(view.lat)];
  const r = view.dist * Math.cos(view.el);
  const e = [t[0] + r * Math.sin(view.az), t[1] + view.dist * Math.sin(view.el),
             t[2] + r * Math.cos(view.az)];
  // never put the eye underground
  const eLat = C_LAT - e[2] / KM_LAT_M, eLon = C_LON + e[0] / M_LON;
  e[1] = Math.max(e[1], heightAtLL(eLat, eLon) * VEX + 60);
  return { e, t };
}
let mvp = null;
function draw(){
  if (!ready) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(HAZE[0], HAZE[1], HAZE[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  clampV();
  const { e, t } = eyeAndTarget();
  const P = perspective(48 * Math.PI / 180, w / h, 20, 120000);
  mvp = mul(P, lookAt(e, t, [0, 1, 0]));
  gl.useProgram(prog);
  gl.uniformMatrix4fv(U.mvp, false, new Float32Array(mvp));
  gl.uniform1i(U.tex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const s = norm([-0.42, 0.80, 0.34]);
  gl.uniform3f(U.sun, s[0], s[1], s[2]);
  gl.uniform3f(U.eye, e[0], e[1], e[2]);
  gl.uniform3f(U.haze, HAZE[0], HAZE[1], HAZE[2]);
  gl.uniform2f(U.fog, view.dist * 1.6, view.dist * 3.4);
  gl.drawElements(gl.TRIANGLES, indexCount, uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
}
window.draw3D = draw;

// where a place lands on screen in 3D, or null when it is behind the camera
window.project3D = function(p){
  if (!mvp || !p.latlon) return null;
  const x = toWorldX(p.latlon.lon), z = toWorldZ(p.latlon.lat);
  const y = heightAtLL(p.latlon.lat, p.latlon.lon) * VEX;
  const cw = mvp[3]*x + mvp[7]*y + mvp[11]*z + mvp[15];
  if (cw <= 0) return null;
  const cx = mvp[0]*x + mvp[4]*y + mvp[8]*z  + mvp[12];
  const cy = mvp[1]*x + mvp[5]*y + mvp[9]*z  + mvp[13];
  return { x: (cx / cw * 0.5 + 0.5) * innerWidth,
           y: (-cy / cw * 0.5 + 0.5) * innerHeight, w: cw };
};

/* ---------- gestures, only while the 3D setting is on ---------- */
const pts = new Map();
let pinch = null;
canvas.addEventListener("pointerdown", ev => {
  if (ev.target.closest(".mk")) return;
  canvas.setPointerCapture(ev.pointerId);
  pts.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });
  pinch = null;
});
canvas.addEventListener("pointermove", ev => {
  const prev = pts.get(ev.pointerId); if (!prev) return;
  const cur = { x:ev.clientX, y:ev.clientY };
  pts.set(ev.pointerId, cur);
  if (pts.size >= 2){
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    if (pinch) view.dist *= pinch / d;
    pinch = d;
  } else {
    view.az -= (cur.x - prev.x) * 0.005;
    view.el += (cur.y - prev.y) * 0.004;
  }
  camDirty = true;
});
["pointerup","pointercancel"].forEach(e => canvas.addEventListener(e, ev => {
  pts.delete(ev.pointerId); if (pts.size < 2) pinch = null;
}));
canvas.addEventListener("wheel", ev => {
  ev.preventDefault();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  view.dist *= Math.exp(ev.deltaY * unit * 0.0016);
  camDirty = true;
}, { passive:false });

/* ---------- switching between the two settings ---------- */
// The 2D view is a plan at a known scale, so the tilt can start from the same
// ground the map was showing rather than jumping somewhere else.
function metresAcross(){ return innerWidth / cam.zoom / IMG_W * (TB_E - TB_W) * M_LON; }
window.setMode3D = function(on){
  window.mode3d = on;
  canvas.style.display = on ? "" : "none";
  world.style.display = on ? "none" : "";
  document.getElementById("d3Btn").classList.toggle("on", on);
  document.querySelector("#d3Btn .lbl").textContent = on ? "2D" : "3D";
  if (on){
    const ll = imgToLL(cam.x, cam.y);
    view.lat = ll.lat; view.lon = ll.lon;
    view.dist = Math.max(900, metresAcross() * 1.15);
  } else {
    const im = llToImg(view.lat, view.lon);
    cam.x = im.x; cam.y = im.y;
    placeCamera();
  }
  camDirty = true;
};
document.getElementById("d3Btn").onclick = () => setMode3D(!window.mode3d);
addEventListener("keydown", e => {
  if (e.key === "3" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || ""))
    setMode3D(!window.mode3d);
});
})();
