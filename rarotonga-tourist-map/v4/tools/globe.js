/* =========================================================================
   THE 3D SETTING — real photography, real elevation, painted light.

   The geometry is not invented: the surface is the satellite mosaic the flat
   map uses, and the shape under it is the Copernicus elevation grid. What is
   invented, deliberately, is the light. A satellite photograph of a tropical
   island is flat, hazy and grey-green; the illustrations this view is chasing
   are dramatic because of relief, shadow and colour, so those are added back
   on top of true geography rather than made up in place of it.

   Three things do the work:

     lift()      vertical exaggeration that scales with height, so the coast
                 stays flat and the interior gets its drama. Rarotonga really
                 rises 650 m over 11 km, which reads as a bump from the air.
     buildShade()  the sun's own shadows and the valleys' ambient occlusion,
                 both marched through the elevation grid once at load and
                 handed to the shader as a texture.
     the sea and sky   an ocean plane and a gradient horizon, so the island
                 sits in a scene rather than on a square patch of data.
   ========================================================================= */
(function(){
const KM_LAT_M = 110570, kmLonM = lat => 111320 * Math.cos(lat * Math.PI / 180);

/* ---------- the look ---------- */
const VEX_COAST = 1.8, VEX_PEAK = 3.6, PEAK_M = 520;   // exaggeration, low to high
const SUN_AZ = (315 * Math.PI) / 180;                  // out of the north-west
const SUN_EL = (40 * Math.PI) / 180;
// The open ocean has to meet the edge of the mosaic without a seam, so it is
// taken from the mosaic's own outer colour and put through the same grade the
// shader applies to water. Change the imagery and the sea follows it.
const SEA_NEAR = (() => {
  const hex = (IMAGERY.edge && IMAGERY.edge.top) || "#0a2a44";
  const n = parseInt(hex.slice(1), 16);
  let c = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  c = c.map((v, i) => (l + (v - l) * 1.20) * [0.86, 1.03, 1.18][i]);
  return c.map(v => Math.max(0, Math.min(1, v)));
})();
const SEA_FAR = SEA_NEAR.map((v, i) => v * [0.82, 0.92, 1.06][i]);   // deep ocean
const SKY_TOP  = [0.086, 0.396, 0.729];
const SKY_HAZE = [0.741, 0.867, 0.945];                // the pale band at the horizon
const CLOUDS = 11;

// heights are exaggerated more the higher they are, so the beach stays a beach
function lift(m){
  if (m <= 0) return m * 0.5;
  const t = Math.min(1, m / PEAK_M);
  return m * (VEX_COAST + (VEX_PEAK - VEX_COAST) * t);
}

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
function build(vsSrc, fsSrc){
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const terrainProg = build(`
attribute vec3 aPos; attribute vec2 aUV; attribute vec2 aTUV;
attribute vec3 aNrm; attribute float aH;
uniform mat4 uMVP;
varying vec2 vUV; varying vec2 vTUV; varying vec3 vNrm; varying vec3 vPos; varying float vH;
void main(){
  vUV = aUV; vTUV = aTUV; vNrm = aNrm; vPos = aPos; vH = aH;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`, `
precision highp float;
uniform sampler2D uTex;      // the satellite mosaic
uniform sampler2D uShade;    // r: the sun's shadows, g: ambient occlusion
uniform vec3 uSun; uniform vec3 uEye; uniform vec3 uHaze; uniform vec2 uFog;
varying vec2 vUV; varying vec2 vTUV; varying vec3 vNrm; varying vec3 vPos; varying float vH;
void main(){
  vec3 c = texture2D(uTex, vUV).rgb;
  vec2 sh = texture2D(uShade, vTUV).rg;
  float land = smoothstep(0.0, 5.0, vH);

  // Saturation and a push towards the palette of the place: the greens warm,
  // the water towards turquoise. Satellite colour is honest but washed out.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, mix(1.20, 1.34, land));
  // water towards turquoise, land towards a deeper jungle green rather than
  // the yellow-green a saturation push alone gives you
  c *= mix(vec3(0.86, 1.03, 1.18), vec3(0.88, 1.06, 0.86), land);

  vec3 n = normalize(vNrm);
  float lam = clamp(dot(n, uSun), 0.0, 1.0);
  // the sun, its own shadows, and the darkness deep in the valleys. The
  // texture already carries flat daylight, so this is shape, not exposure:
  // it stays near 1.0 on average and swings either side of it.
  float lit = 0.62 + 0.85 * lam * mix(0.30, 1.0, sh.r);
  c *= mix(1.0, lit, 0.75 * land);
  c *= mix(1.0, 0.70 + 0.30 * sh.g, 0.85 * land);
  // sunlit ridge tops, which is what actually reads as height
  c += vec3(0.11, 0.12, 0.08) * land * pow(lam, 2.5) * sh.r;

  // sun glitter on the water
  vec3 V = normalize(uEye - vPos);
  float spec = pow(max(dot(reflect(-uSun, vec3(0.0, 1.0, 0.0)), V), 0.0), 48.0);
  c += vec3(0.85, 0.92, 1.0) * spec * 0.30 * (1.0 - land);

  // a little contrast, the way a photograph is graded
  c = clamp((c - 0.5) * 1.12 + 0.5, 0.0, 1.4);

  float f = smoothstep(uFog.x, uFog.y, distance(vPos, uEye));
  float edge = min(min(vTUV.x, 1.0 - vTUV.x), min(vTUV.y, 1.0 - vTUV.y));
  // the mosaic's own ocean is a square; dissolve a wide band of it into the
  // open water so the join never shows
  f = max(f, 1.0 - smoothstep(0.0, 0.20, edge));
  gl_FragColor = vec4(mix(c, uHaze, f), 1.0);
}`);

const skyProg = build(`
attribute vec2 aP; varying float vY;
void main(){ vY = aP.y * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`, `
precision mediump float;
uniform vec3 uTop; uniform vec3 uHazeSky; uniform float uHorizon;
varying float vY;
void main(){
  float t = smoothstep(uHorizon - 0.06, uHorizon + 0.65, vY);
  gl_FragColor = vec4(mix(uHazeSky, uTop, t), 1.0);
}`);

const seaProg = build(`
attribute vec2 aP; uniform mat4 uMVP; uniform float uSize;
varying vec2 vXZ;
void main(){ vXZ = aP * uSize; gl_Position = uMVP * vec4(vXZ.x, -2.0, vXZ.y, 1.0); }`, `
precision mediump float;
uniform vec3 uNear; uniform vec3 uFar; uniform vec3 uHazeSky;
varying vec2 vXZ;
void main(){
  float d = length(vXZ);
  vec3 c = mix(uNear, uFar, smoothstep(7000.0, 45000.0, d));
  c = mix(c, uHazeSky, smoothstep(30000.0, 150000.0, d));   // into the horizon
  gl_FragColor = vec4(c, 1.0);
}`);

const cloudProg = build(`
attribute vec2 aP;
uniform mat4 uMVP; uniform vec3 uCenter; uniform vec3 uRight; uniform vec3 uUp;
uniform vec2 uSize;
varying vec2 vT;
void main(){
  vT = aP * 0.5 + 0.5;
  vec3 p = uCenter + uRight * (aP.x * uSize.x) + uUp * (aP.y * uSize.y);
  gl_Position = uMVP * vec4(p, 1.0);
}`, `
precision mediump float;
uniform sampler2D uPuff; uniform float uAlpha;
varying vec2 vT;
void main(){
  float a = texture2D(uPuff, vT).a * uAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.99, 0.97) * a, a);   // premultiplied
}`);

const T = {
  pos: gl.getAttribLocation(terrainProg, "aPos"), uv: gl.getAttribLocation(terrainProg, "aUV"),
  tuv: gl.getAttribLocation(terrainProg, "aTUV"), nrm: gl.getAttribLocation(terrainProg, "aNrm"),
  h: gl.getAttribLocation(terrainProg, "aH"),
  mvp: gl.getUniformLocation(terrainProg, "uMVP"), tex: gl.getUniformLocation(terrainProg, "uTex"),
  shade: gl.getUniformLocation(terrainProg, "uShade"), sun: gl.getUniformLocation(terrainProg, "uSun"),
  eye: gl.getUniformLocation(terrainProg, "uEye"), haze: gl.getUniformLocation(terrainProg, "uHaze"),
  fog: gl.getUniformLocation(terrainProg, "uFog") };
const S = { p: gl.getAttribLocation(skyProg, "aP"), top: gl.getUniformLocation(skyProg, "uTop"),
            haze: gl.getUniformLocation(skyProg, "uHazeSky"),
            horizon: gl.getUniformLocation(skyProg, "uHorizon") };
const O = { p: gl.getAttribLocation(seaProg, "aP"), mvp: gl.getUniformLocation(seaProg, "uMVP"),
            size: gl.getUniformLocation(seaProg, "uSize"), near: gl.getUniformLocation(seaProg, "uNear"),
            far: gl.getUniformLocation(seaProg, "uFar"), haze: gl.getUniformLocation(seaProg, "uHazeSky") };
const C = { p: gl.getAttribLocation(cloudProg, "aP"), mvp: gl.getUniformLocation(cloudProg, "uMVP"),
            center: gl.getUniformLocation(cloudProg, "uCenter"), right: gl.getUniformLocation(cloudProg, "uRight"),
            up: gl.getUniformLocation(cloudProg, "uUp"), size: gl.getUniformLocation(cloudProg, "uSize"),
            puff: gl.getUniformLocation(cloudProg, "uPuff"), alpha: gl.getUniformLocation(cloudProg, "uAlpha") };

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
window.terrainHeightAt = heightAtLL;             // true metres, never exaggerated
const worldY = (lat, lon) => lift(heightAtLL(lat, lon));

// height straight off the grid, for the shading pass
function hGrid(gx, gy){
  const x = Math.max(0, Math.min(TW - 1, gx)), y = Math.max(0, Math.min(TH - 1, gy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(TW - 1, x0 + 1), y1 = Math.min(TH - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const h = (i, j) => heights[j * TW + i];
  return (h(x0,y0) * (1-tx) + h(x1,y0) * tx) * (1-ty) +
         (h(x0,y1) * (1-tx) + h(x1,y1) * tx) * ty;
}

/* ---------- the light, marched through the grid once ---------- */
const shadeTex = gl.createTexture();
function buildShade(){
  // half the elevation grid's resolution: shadows and occlusion are smooth,
  // and this keeps the pass well under a frame's worth of work
  const SW = Math.max(64, TW >> 1), SH = Math.max(64, TH >> 1);
  const px = new Uint8Array(SW * SH * 3);
  const cellX = (TB_E - TB_W) / TW * M_LON;        // metres per grid cell
  const cellY = (TB_N - TB_S) / TH * KM_LAT_M;
  const cell = (cellX + cellY) / 2;
  const dx = Math.sin(SUN_AZ), dy = -Math.cos(SUN_AZ);   // grid steps towards the sun
  const tanSun = Math.tan(SUN_EL);
  const AO_DIRS = 8, AO_STEPS = 10, SUN_STEPS = 70;
  const dirs = [];
  for (let a = 0; a < AO_DIRS; a++){
    const t = (a / AO_DIRS) * Math.PI * 2;
    dirs.push([Math.sin(t), -Math.cos(t)]);
  }
  for (let j = 0; j < SH; j++){
    const gy = (j + 0.5) * TH / SH;
    for (let i = 0; i < SW; i++){
      const gx = (i + 0.5) * TW / SW;
      const h0 = hGrid(gx, gy);
      // how far the ridge between here and the sun rises above the sun ray
      let over = 0;
      for (let s = 1; s <= SUN_STEPS; s++){
        const x = gx + dx * s, y = gy + dy * s;
        if (x < 0 || y < 0 || x > TW - 1 || y > TH - 1) break;
        over = Math.max(over, hGrid(x, y) - (h0 + 3 + s * cell * tanSun));
      }
      const shadow = Math.max(0, Math.min(1, 1 - over / 45));
      // how much sky this point can see
      let closed = 0;
      for (let d = 0; d < AO_DIRS; d++){
        let maxTan = 0;
        for (let s = 1; s <= AO_STEPS; s++){
          const x = gx + dirs[d][0] * s, y = gy + dirs[d][1] * s;
          if (x < 0 || y < 0 || x > TW - 1 || y > TH - 1) break;
          maxTan = Math.max(maxTan, (hGrid(x, y) - h0) / (s * cell));
        }
        closed += Math.sin(Math.atan(maxTan));
      }
      const ao = Math.max(0, 1 - closed / AO_DIRS);
      const k = (j * SW + i) * 3;
      px[k] = shadow * 255; px[k+1] = ao * 255; px[k+2] = 0;
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, shadeTex);
  // three bytes a pixel and an odd width: without this GL expects each row
  // padded to four bytes, rejects the buffer, and the shader reads zeros
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, SW, SH, 0, gl.RGB, gl.UNSIGNED_BYTE, px);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

/* ---------- geometry ---------- */
let bufs = {};
function buildMesh(){
  const maxSeg = uint32 ? 512 : 254;
  const N = Math.min(maxSeg, Math.max(TW, TH) - 1);
  const n1 = N + 1;
  const pos = new Float32Array(n1 * n1 * 3);
  const uv  = new Float32Array(n1 * n1 * 2);
  const tuv = new Float32Array(n1 * n1 * 2);
  const nrm = new Float32Array(n1 * n1 * 3);
  const hgt = new Float32Array(n1 * n1);
  const llAt = (i, j) => [TB_N + (TB_S - TB_N) * j / N, TB_W + (TB_E - TB_W) * i / N];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++){
    const k = j * n1 + i;
    const [lat, lon] = llAt(i, j);
    const m = heightAtLL(lat, lon);
    pos[k*3]   = toWorldX(lon);
    pos[k*3+1] = lift(m);
    pos[k*3+2] = toWorldZ(lat);
    hgt[k] = m;
    tuv[k*2] = i / N; tuv[k*2+1] = j / N;
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
  const buf = data => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };
  bufs.pos = buf(pos); bufs.uv = buf(uv); bufs.tuv = buf(tuv);
  bufs.nrm = buf(nrm); bufs.h = buf(hgt);
  bufs.idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  // a unit quad, reused by the sky, the sea and every cloud
  bufs.quad = buf(new Float32Array([-1,-1, 1,-1, -1,1, 1,1]));
}
function attach(bufName, loc, size){
  if (loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs[bufName]);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

/* ---------- the clouds ---------- */
const puffTex = gl.createTexture();
function buildPuff(){
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const cx = c.getContext("2d");
  // a handful of overlapping soft discs, which reads as a cumulus from a
  // distance and costs nothing
  const blobs = [[64,74,34],[44,66,24],[84,66,26],[56,54,22],[76,56,20],[64,48,16]];
  for (const [x, y, r] of blobs){
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.55, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
  }
  gl.bindTexture(gl.TEXTURE_2D, puffTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}
// fixed positions, so the sky looks the same every time the page opens
const clouds = (() => {
  let seed = 20250908;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: CLOUDS }, () => ({
    x: (rnd() - 0.5) * 24000, z: (rnd() - 0.5) * 24000,
    y: 3400 + rnd() * 2000, r: 800 + rnd() * 1400,
    a: 0.65 + rnd() * 0.35, drift: 4 + rnd() * 5,
  }));
})();

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
    // the terrain-tile source carries bathymetry, and Rarotonga is the top of
    // a seamount: without this the island sits in a 3 km pit
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
    buildShade();
    buildPuff();
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
// The camera starts where those aerial illustrations put you: low enough that
// the horizon and the sky are in frame, which is most of why they read as a
// place rather than a map. The vertical field of view is 46 degrees, so the
// horizon leaves the top of the screen once the tilt passes about 23.
const view = { lat:-21.2349, lon:-159.7776, az:0.35, el:0.26, dist:11000 };
const clampV = () => {
  view.el = Math.max(0.07, Math.min(1.45, view.el));
  view.dist = Math.max(700, Math.min(40000, view.dist));
};
function eyeAndTarget(){
  const t = [toWorldX(view.lon), worldY(view.lat, view.lon), toWorldZ(view.lat)];
  const r = view.dist * Math.cos(view.el);
  const e = [t[0] + r * Math.sin(view.az), t[1] + view.dist * Math.sin(view.el),
             t[2] + r * Math.cos(view.az)];
  const eLat = C_LAT - e[2] / KM_LAT_M, eLon = C_LON + e[0] / M_LON;
  e[1] = Math.max(e[1], worldY(eLat, eLon) + 60);   // never underground
  return { e, t };
}

// where the sea meets the sky on screen, 0 at the bottom edge and 1 at the
// top: project a point on the water far out along the way the camera is
// looking, rather than guessing from the tilt
function horizonNDC(m, e, t){
  const d = norm([t[0] - e[0], 0, t[2] - e[2]]);
  const p = [e[0] + d[0] * 300000, 0, e[2] + d[2] * 300000];
  const w = m[3]*p[0] + m[7]*p[1] + m[11]*p[2] + m[15];
  if (w <= 0) return 0.5;
  const y = m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13];
  return Math.max(0, Math.min(1, y / w * 0.5 + 0.5));
}

let mvp = null;
const t0 = performance.now();
function draw(){
  if (!ready) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  clampV();
  const { e, t } = eyeAndTarget();
  const P = perspective(46 * Math.PI / 180, w / h, 20, 400000);
  mvp = mul(P, lookAt(e, t, [0, 1, 0]));
  const sun = norm([Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL),
                    -Math.cos(SUN_AZ) * Math.cos(SUN_EL)]);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (window.syncCompass) syncCompass();

  // sky first, behind everything
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  attach("quad", S.p, 2);
  gl.uniform3fv(S.top, SKY_TOP);
  gl.uniform3fv(S.haze, SKY_HAZE);
  // where the horizon falls on screen: straight down the camera's tilt
  gl.uniform1f(S.horizon, horizonNDC(mvp, e, t));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // the open ocean the island sits in
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.useProgram(seaProg);
  attach("quad", O.p, 2);
  gl.uniformMatrix4fv(O.mvp, false, new Float32Array(mvp));
  gl.uniform1f(O.size, 180000);
  gl.uniform3fv(O.near, SEA_NEAR);
  gl.uniform3fv(O.far, SEA_FAR);
  gl.uniform3fv(O.haze, SKY_HAZE);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // the island
  gl.useProgram(terrainProg);
  attach("pos", T.pos, 3); attach("uv", T.uv, 2); attach("tuv", T.tuv, 2);
  attach("nrm", T.nrm, 3); attach("h", T.h, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
  gl.uniformMatrix4fv(T.mvp, false, new Float32Array(mvp));
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(T.tex, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadeTex);
  gl.uniform1i(T.shade, 1);
  gl.uniform3f(T.sun, sun[0], sun[1], sun[2]);
  gl.uniform3f(T.eye, e[0], e[1], e[2]);
  gl.uniform3fv(T.haze, SEA_NEAR);
  gl.uniform2f(T.fog, view.dist * 2.0, view.dist * 4.5);
  gl.drawElements(gl.TRIANGLES, indexCount, uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);

  // clouds last, facing the camera, drifting west to east
  const fwd = norm(sub(t, e));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const secs = (performance.now() - t0) / 1000;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);     // premultiplied
  gl.depthMask(false);
  gl.useProgram(cloudProg);
  attach("quad", C.p, 2);
  gl.uniformMatrix4fv(C.mvp, false, new Float32Array(mvp));
  gl.uniform3f(C.right, right[0], right[1], right[2]);
  gl.uniform3f(C.up, up[0], up[1], up[2]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, puffTex);
  gl.uniform1i(C.puff, 2);
  for (const c of clouds){
    const span = 34000;
    let x = c.x + secs * c.drift;
    x = ((x + span / 2) % span + span) % span - span / 2;     // wrap around
    // a cloud right on top of the camera is a grey smear, not weather
    if (Math.hypot(x - e[0], c.y - e[1], c.z - e[2]) < 3000) continue;
    gl.uniform3f(C.center, x, c.y, c.z);
    gl.uniform2f(C.size, c.r, c.r * 0.52);
    gl.uniform1f(C.alpha, c.a);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}
window.draw3D = draw;

/* ---------- the compass ---------- */
// It turns with the camera in 3D and points north in 2D, and clicking it puts
// the camera back on north.
const compass = document.getElementById("compass");
if (compass){
  const needle = compass.querySelector("svg");
  window.syncCompass = () => {
    needle.style.transform = "rotate(" + (window.mode3d ? view.az : 0) * 180 / Math.PI + "deg)";
  };
  compass.onclick = () => {
    if (!window.mode3d) return;
    view.az = 0; camDirty = true; syncCompass(); draw();
  };
  syncCompass();
}

// the clouds drift, so the 3D setting keeps its own slow frame loop
let raf = 0;
function loop(){
  raf = 0;
  if (!window.mode3d) return;
  draw();
  raf = requestAnimationFrame(loop);
}
function startLoop(){ if (!raf && window.mode3d) raf = requestAnimationFrame(loop); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) startLoop(); });

// where a place lands on screen in 3D, or null when it is behind the camera
window.project3D = function(p){
  if (!mvp || !p.latlon) return null;
  const x = toWorldX(p.latlon.lon), z = toWorldZ(p.latlon.lat);
  const y = worldY(p.latlon.lat, p.latlon.lon);
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
  if (window.syncCompass) syncCompass();
  document.querySelector("#d3Btn .lbl").textContent = on ? "2D" : "3D";
  if (on){
    const ll = imgToLL(cam.x, cam.y);
    view.lat = ll.lat; view.lon = ll.lon;
    view.dist = Math.max(900, metresAcross() * 1.15);
    startLoop();
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
