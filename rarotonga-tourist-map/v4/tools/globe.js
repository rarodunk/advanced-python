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
// A painted base map arrives already lit: the artist has put the shadows in
// the picture. Shading it again as hard as a satellite photograph would
// double every valley. So the sun keeps its direction and loses most of its
// strength when the surface is a painting.
const PAINTED = /painted/i.test(IMAGERY.source || "");
const SHADE_MIX = PAINTED ? [0.34, 0.38] : [0.75, 0.85];   // sun, occlusion

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
uniform vec3 uSun; uniform vec3 uEye; uniform vec3 uHaze; uniform vec3 uAir; uniform vec2 uFog;
uniform vec2 uShadeMix; uniform float uGrade; uniform float uClose;
varying vec2 vUV; varying vec2 vTUV; varying vec3 vNrm; varying vec3 vPos; varying float vH;
void main(){
  vec3 c = texture2D(uTex, vUV).rgb;
  vec2 sh = texture2D(uShade, vTUV).rg;
  float land = smoothstep(0.0, 5.0, vH);

  // Saturation and a push towards the palette of the place: the greens warm,
  // the water towards turquoise. Satellite colour is honest but washed out.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, mix(1.0, mix(1.20, 1.34, land), uGrade));
  // water towards turquoise, land towards a deeper jungle green rather than
  // the yellow-green a saturation push alone gives you
  c *= mix(vec3(1.0), mix(vec3(0.86, 1.03, 1.18), vec3(0.88, 1.06, 0.86), land), uGrade);

  // The painting and the elevation grid disagree in places — the artist drew
  // the Muri bay further into the island than it really goes, and no fit of a
  // coastline can undo that inland. On a flat map you never notice. In three
  // dimensions the lagoon climbs a mountain. So the grid decides what is land
  // and the painting only decides what land looks like: where the ground
  // stands well above the sea and the picture insists on water, the water is
  // overruled.
  float watery = clamp((c.b - c.r) * 2.6, 0.0, 1.0) * clamp((c.b - 0.32) * 4.0, 0.0, 1.0);
  float onLand = smoothstep(2.0, 12.0, vH);
  vec3 bush = mix(vec3(0.33, 0.45, 0.23), vec3(0.17, 0.30, 0.15),
                  clamp(vH / 420.0, 0.0, 1.0));
  c = mix(c, bush, watery * onLand);

  vec3 n = normalize(vNrm);
  float lam = clamp(dot(n, uSun), 0.0, 1.0);
  // the sun, its own shadows, and the darkness deep in the valleys. The
  // texture already carries flat daylight, so this is shape, not exposure:
  // it stays near 1.0 on average and swings either side of it.
  float lit = 0.62 + 0.85 * lam * mix(0.30, 1.0, sh.r);
  c *= mix(1.0, lit, uShadeMix.x * land);
  c *= mix(1.0, 0.70 + 0.30 * sh.g, uShadeMix.y * land);
  // sunlit ridge tops, which is what actually reads as height
  c += vec3(0.11, 0.12, 0.08) * land * pow(lam, 2.5) * sh.r * uShadeMix.x;

  // sun glitter on the water
  vec3 V = normalize(uEye - vPos);
  float spec = pow(max(dot(reflect(-uSun, vec3(0.0, 1.0, 0.0)), V), 0.0), 48.0);
  c += vec3(0.85, 0.92, 1.0) * spec * 0.30 * (1.0 - land);

  // Up close the base map has nothing left to give: it is one picture at ten
  // metres a pixel, and magnifying it just smears. Past that point the ground
  // becomes ground — sand at the shore, grass above it — so the buildings
  // have something clean to stand on.
  vec3 ground = mix(vec3(0.85, 0.79, 0.63), vec3(0.42, 0.54, 0.31),
                    smoothstep(1.0, 7.0, vH));
  ground = mix(vec3(0.16, 0.42, 0.55), ground, step(0.5, vH));
  c = mix(c, ground, uClose * 0.8);

  // a little contrast, the way a photograph is graded
  c = clamp((c - 0.5) * 1.12 + 0.5, 0.0, 1.4);

  // Distance haze is atmosphere, and atmosphere is pale sky, not sea. Fading
  // a far ridge towards the water colour turns every mountain turquoise at
  // eye level, which is exactly what it looks like: a lagoon standing up.
  float f = smoothstep(uFog.x, uFog.y, distance(vPos, uEye));
  c = mix(c, uAir, f * 0.85);

  // the mosaic's own ocean is a square; dissolve a wide band of it into the
  // open water, and that one does go to the sea colour
  float edge = min(min(vTUV.x, 1.0 - vTUV.x), min(vTUV.y, 1.0 - vTUV.y));
  gl_FragColor = vec4(mix(c, uHaze, 1.0 - smoothstep(0.0, 0.20, edge)), 1.0);
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
  fog: gl.getUniformLocation(terrainProg, "uFog"),
  shadeMix: gl.getUniformLocation(terrainProg, "uShadeMix"),
  grade: gl.getUniformLocation(terrainProg, "uGrade"),
  close: gl.getUniformLocation(terrainProg, "uClose") };
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



/* ---------- materials ---------- */
// Flat colour is what makes a massing model look like a massing model. These
// are the surfaces an island building is actually made of, drawn once into
// small tiling textures: corrugated iron that catches the sun along its ribs,
// sawn timber for decks and posts, thatch, painted board, glass.
const MATS = ["roof", "wall", "timber", "thatch", "glass", "ground", "leaf"];
const matTex = {};
function paintMaterials(){
  const S = 128;
  for (const name of MATS){
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, S, S);
    if (name === "roof"){
      // corrugations: a soft rib every eight pixels, bright on the crown
      for (let i = 0; i < S; i += 8){
        const g = x.createLinearGradient(i, 0, i + 8, 0);
        g.addColorStop(0, "rgba(0,0,0,.20)"); g.addColorStop(0.45, "rgba(255,255,255,.16)");
        g.addColorStop(0.6, "rgba(255,255,255,.06)"); g.addColorStop(1, "rgba(0,0,0,.20)");
        x.fillStyle = g; x.fillRect(i, 0, 8, S);
      }
      x.fillStyle = "rgba(0,0,0,.10)";
      for (let j = 0; j < S; j += 42) x.fillRect(0, j, S, 1);      // sheet joins
    } else if (name === "timber"){
      for (let j = 0; j < S; j += 10){
        x.fillStyle = j % 20 ? "rgba(0,0,0,.10)" : "rgba(255,255,255,.10)";
        x.fillRect(0, j, S, 9);
        x.fillStyle = "rgba(0,0,0,.22)"; x.fillRect(0, j + 9, S, 1);
      }
    } else if (name === "thatch"){
      x.fillStyle = "rgba(0,0,0,.12)";
      for (let k = 0; k < 900; k++){
        const px = Math.random() * S, py = Math.random() * S;
        x.fillRect(px, py, 1 + Math.random() * 5, 1);
      }
      for (let j = 0; j < S; j += 16){ x.fillStyle = "rgba(0,0,0,.16)"; x.fillRect(0, j, S, 2); }
    } else if (name === "wall"){
      x.fillStyle = "rgba(0,0,0,.07)";
      for (let j = 0; j < S; j += 16) x.fillRect(0, j, S, 1);      // weatherboard
      x.fillStyle = "rgba(255,255,255,.06)";
      for (let j = 2; j < S; j += 16) x.fillRect(0, j, S, 2);
    } else if (name === "glass"){
      const g = x.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, "rgba(255,255,255,.45)"); g.addColorStop(0.5, "rgba(255,255,255,.05)");
      g.addColorStop(1, "rgba(255,255,255,.30)");
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = 3;
      x.strokeRect(1.5, 1.5, S - 3, S - 3); x.beginPath();
      x.moveTo(S / 2, 0); x.lineTo(S / 2, S); x.stroke();
    } else if (name === "leaf"){
      const g = x.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, "rgba(255,255,255,.25)"); g.addColorStop(1, "rgba(0,0,0,.25)");
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1;
      for (let k = 0; k < 14; k++){
        x.beginPath(); x.moveTo(S / 2, 0); x.lineTo(k * 10, S); x.stroke();
      }
    } else {
      x.fillStyle = "rgba(0,0,0,.05)";
      for (let k = 0; k < 500; k++) x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    matTex[name] = t;
  }
}

/* ---------- painted elevations ---------- */
// Where a place has been painted flat-on, the painting is hung on the
// geometry: the wall part of the front elevation goes on the front wall, the
// roof image is projected straight down onto the roof planes. A model wearing
// its own front stops looking like a model.
const FACADES = (typeof FACADE_ART !== "undefined" && FACADE_ART) || {};
const facadeTex = {};
function loadFacades(){
  const blank = gl.createTexture();          // stands in until the art arrives
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([255, 255, 255, 255]));
  for (const pid of Object.keys(FACADES)){
    for (const face of Object.keys(FACADES[pid])){
      const key = pid + ":" + face;
      facadeTex[key] = blank;
      const img = new Image();
      img.onload = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        facadeTex[key] = t;
        camDirty = true;
      };
      img.src = FACADES[pid][face].src;
    }
  }
}

/* ---------- buildings ---------- */
// A pin says where. Up close it should also say what is there, and the
// painting cannot: a picture has no back, so standing it up in the scene
// gives a cardboard cut-out the moment the camera moves. These are massing
// models — footprint, roof, veranda — sized from what kind of place it is and
// coloured from that place's own artwork. They are a sketch and they are
// meant to read as one.
const MODELS = (typeof BUILDINGS !== "undefined" && BUILDINGS) || {};
// A five-metre roof seen from two kilometres is three pixels. These only
// mean anything once the camera is close enough to walk the place.
const B_NEAR = 450, B_FAR = 1100;       // metres of camera distance: full, then gone

const bldProg = build(`
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute vec2 aUV;
uniform mat4 uMVP;
varying vec3 vNrm; varying vec3 vCol; varying vec3 vPos; varying vec2 vUV;
void main(){ vNrm = aNrm; vCol = aCol; vPos = aPos; vUV = aUV;
             gl_Position = uMVP * vec4(aPos, 1.0); }`, `
precision mediump float;
uniform sampler2D uTex; uniform vec3 uSun; uniform vec3 uHaze; uniform vec2 uFog;
uniform vec3 uEye; uniform float uAlpha;
varying vec3 vNrm; varying vec3 vCol; varying vec3 vPos; varying vec2 vUV;
void main(){
  vec3 n = normalize(vNrm);
  float lam = clamp(dot(n, uSun), 0.0, 1.0);
  // the material carries the detail — corrugations, boards, thatch — and the
  // colour sampled from that place's own painting tints it
  vec3 t = texture2D(uTex, vUV).rgb;
  vec3 c = vCol * t * (0.72 + 0.55 * lam);
  float f = smoothstep(uFog.x, uFog.y, distance(vPos, uEye));
  c = mix(c, uHaze, f * 0.8);
  gl_FragColor = vec4(c * uAlpha, uAlpha);      // premultiplied, so it fades out cleanly
}`);
const BP = { pos: gl.getAttribLocation(bldProg, "aPos"), nrm: gl.getAttribLocation(bldProg, "aNrm"),
             col: gl.getAttribLocation(bldProg, "aCol"), uv: gl.getAttribLocation(bldProg, "aUV"),
             tex: gl.getUniformLocation(bldProg, "uTex"), mvp: gl.getUniformLocation(bldProg, "uMVP"),
             sun: gl.getUniformLocation(bldProg, "uSun"), haze: gl.getUniformLocation(bldProg, "uHaze"),
             fog: gl.getUniformLocation(bldProg, "uFog"), eye: gl.getUniformLocation(bldProg, "uEye"),
             alpha: gl.getUniformLocation(bldProg, "uAlpha") };
let bldCount = 0, bldGroups = [];

function buildBuildings(){
  // geometry is gathered per material, because each one wants its own tiling
  // texture and its own draw
  const bin = {};
  for (const m of MATS) bin[m] = { pos: [], nrm: [], col: [], uv: [] };
  const SCALE = { roof: 1.15, wall: 2.4, timber: 1.5, thatch: 1.6,
                  glass: 2.6, ground: 5.0, leaf: 1.6 };

  // a face may carry its own painted elevation instead of a material
  const pushUV = (a, b, c, uvs, colour, key) => {
    const B = (bin[key] = bin[key] || { pos: [], nrm: [], col: [], uv: [] });
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n = norm(cross(u, v));
    [a, b, c].forEach((p, i) => {
      B.pos.push(p[0], p[1], p[2]);
      B.nrm.push(n[0], n[1], n[2]);
      B.col.push(colour[0] / 255, colour[1] / 255, colour[2] / 255);
      B.uv.push(uvs[i][0], uvs[i][1]);
    });
  };
  const quadUV = (a, b, c, d, uv, colour, key) => {
    pushUV(a, b, c, [uv[0], uv[1], uv[2]], colour, key);
    pushUV(a, c, d, [uv[0], uv[2], uv[3]], colour, key);
  };

  const push = (a, b, c, colour, mat) => {
    mat = mat || "wall";
    const B = bin[mat], k = SCALE[mat];
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n = norm(cross(u, v));
    // the texture is laid on whichever pair of axes the face most faces, so
    // a wall gets upright boards and a roof gets ribs running down it
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const uvOf = p => ay >= ax && ay >= az ? [p[0] / k, p[2] / k]
                    : ax >= az            ? [p[2] / k, p[1] / k]
                                          : [p[0] / k, p[1] / k];
    for (const p of [a, b, c]){
      B.pos.push(p[0], p[1], p[2]);
      B.nrm.push(n[0], n[1], n[2]);
      B.col.push(colour[0] / 255, colour[1] / 255, colour[2] / 255);
      const t = uvOf(p);
      B.uv.push(t[0], t[1]);
    }
  };
  const quad = (a, b, c, d, colour, mat) => { push(a, b, c, colour, mat); push(a, c, d, colour, mat); };

  // deterministic wobble, so a place looks the same every time you visit it
  const seedOf = str => { let h = 2166136261; for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  for (const p of PLACES){
    const m = MODELS[p.id];
    if (!m || !p.latlon) continue;
    const [w, d, h] = m.size;
    const e = m.eave || 1.0;
    const storeys = Math.max(1, m.storeys || 1);
    const base = worldY(p.latlon.lat, p.latlon.lon);
    const ox = toWorldX(p.latlon.lon), oz = toWorldZ(p.latlon.lat);
    const th = (m.face || 0) * Math.PI / 180;
    const ct = Math.cos(th), st = Math.sin(th);
    // local x runs along the front, local z away from it; the front looks
    // down the bearing the tool worked out from the coastline
    const P = (x, y, z) => [ox + x * ct + z * st, base + y, oz - x * st + z * ct];
    const C = m.colour;
    const wall = C.wall, roof = C.roof, trim = C.trim;
    const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
    const glass = [38, 54, 66], water = [64, 190, 200], sand = shade(trim, 0.9);
    const bark = [92, 72, 52], frond = [58, 110, 48];
    let seed = seedOf(p.id);
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    const art = FACADES[p.id] || null;
    const hw = w / 2, hd = d / 2;
    const eaveY = m.roof === "flat" ? h : h * 0.74;
    const fh = eaveY / storeys;                       // floor to floor

    // a box, given in local coordinates
    const solid = (x0, x1, y0, y1, z0, z1, colour, mat) => {
      const a = P(x0,y0,z0), b = P(x1,y0,z0), c = P(x1,y0,z1), dd = P(x0,y0,z1);
      const A = P(x0,y1,z0), B = P(x1,y1,z0), Cc = P(x1,y1,z1), D = P(x0,y1,z1);
      quad(a, b, B, A, colour, mat); quad(b, c, Cc, B, colour, mat);
      quad(c, dd, D, Cc, colour, mat); quad(dd, a, A, D, colour, mat);
      quad(A, B, Cc, D, shade(colour, 1.06), mat);
    };
    const ROOFMAT = m.thatch ? "thatch" : "roof";

    // the plot: a mown apron with a path to the front
    const pw = hw + e + 3.5, pd = hd + e + 3.5;
    quad(P(-pw, 0.10, -pd), P(pw, 0.10, -pd), P(pw, 0.10, pd), P(-pw, 0.10, pd), sand, "ground");

    if (art){
      // the painted front, hung on the wall: the elevation's own eave line
      // says which part of the picture is wall, and that part is stretched
      // over the wall height
      const white = [255, 255, 255];
      const faceQuad = (face, a, b, c, dd) => {
        const rec = art[face] || art.front;
        if (!rec) return false;
        const e0 = rec.eave != null ? rec.eave : 0.55;
        // v runs from the eave line down to the bottom of the picture
        quadUV(a, b, c, dd, [[0, e0], [1, e0], [1, 1], [0, 1]], white,
               p.id + ":" + (art[face] ? face : "front"));
        return true;
      };
      const y0 = 0.2, y1 = 0.2 + eaveY;
      faceQuad("front", P(-hw, y1, -hd), P(hw, y1, -hd), P(hw, y0, -hd), P(-hw, y0, -hd));
      faceQuad("back",  P(hw, y1, hd),  P(-hw, y1, hd), P(-hw, y0, hd), P(hw, y0, hd));
      faceQuad("side",  P(-hw, y1, hd), P(-hw, y1, -hd), P(-hw, y0, -hd), P(-hw, y0, hd));
      faceQuad("side",  P(hw, y1, -hd), P(hw, y1, hd),  P(hw, y0, hd),  P(hw, y0, -hd));
    } else
    // walls, floor by floor, with a band between them
    for (let k = 0; k < storeys; k++){
      const y0 = 0.2 + k * fh, y1 = 0.2 + (k + 1) * fh - 0.35;
      const openFront = m.open && k === 0;
      if (openFront){
        // Places like Trader Jack's have no front wall at all: a roof on
        // posts, and you see straight through to the back of the room.
        solid(-hw, hw, y0, y1, hd - 0.3, hd, shade(wall, 0.9), "wall");       // back wall
        solid(-hw, -hw + 0.3, y0, y1, -hd, hd, shade(wall, 0.94), "wall");    // the two ends
        solid(hw - 0.3, hw, y0, y1, -hd, hd, shade(wall, 0.94), "wall");
        quad(P(-hw, y0, -hd + 0.05), P(hw, y0, -hd + 0.05),
             P(hw, y1, -hd + 0.05), P(-hw, y1, -hd + 0.05), [26, 30, 32], "ground");  // the shade inside
        const posts = Math.max(4, Math.round(w / 3.4));
        for (let i = 0; i <= posts; i++){
          const x = -hw + w * i / posts;
          solid(x - 0.11, x + 0.11, y0, y1 + 0.35, -hd - 0.05, -hd + 0.17, trim, "timber");
        }
        solid(-hw, hw, y0 + 0.95, y0 + 1.08, -hd - 0.04, -hd + 0.1, trim, "timber");  // rail
      } else {
        solid(-hw, hw, y0, y1, -hd, hd, k ? shade(wall, 1.04) : wall, "wall");
      }
      solid(-hw - 0.25, hw + 0.25, y1, y1 + 0.35, -hd - 0.25, hd + 0.25, trim, "timber");
      // windows: a row front and back, shutters closed on the ends
      const n = (m.open && k === 0) ? 0 : Math.max(2, Math.round(w / 4.2));
      for (let i = 0; i < n; i++){
        const cx = -hw + w * (i + 0.5) / n, ww = Math.min(2.2, w / n * 0.55);
        const wy0 = y0 + fh * 0.28, wy1 = y0 + fh * 0.72;
        quad(P(cx - ww/2, wy0, -hd - 0.06), P(cx + ww/2, wy0, -hd - 0.06),
             P(cx + ww/2, wy1, -hd - 0.06), P(cx - ww/2, wy1, -hd - 0.06), glass, "glass");
        quad(P(cx + ww/2, wy0, hd + 0.06), P(cx - ww/2, wy0, hd + 0.06),
             P(cx - ww/2, wy1, hd + 0.06), P(cx + ww/2, wy1, hd + 0.06), glass, "glass");
      }
      // an upstairs balcony along the front, which is what these places have
      if (k > 0){
        const bz = -hd - 1.9;
        solid(-hw, hw, y0 - 0.25, y0, bz, -hd, trim, "timber");
        solid(-hw, hw, y0 + 0.95, y0 + 1.1, bz - 0.05, bz + 0.05, trim, "timber");
        const posts = Math.max(3, Math.round(w / 2.4));
        for (let i = 0; i <= posts; i++){
          const x = -hw + w * i / posts;
          solid(x - 0.06, x + 0.06, y0, y0 + 1.05, bz - 0.06, bz + 0.06, trim, "timber");
        }
      }
    }

    // roof
    const ew = hw + e, ed = hd + e, ry = 0.2 + eaveY;
    const r00 = P(-ew, ry, -ed), r10 = P(ew, ry, -ed),
          r11 = P(ew, ry, ed), r01 = P(-ew, ry, ed);
    // the fascia, which on a place with a name painted along it is the sign
    solid(-ew, ew, ry - 0.3, ry, -ed, ed, m.sign ? m.sign : shade(roof, 0.8), "wall");
    if (m.roof === "flat"){
      quad(r00, r10, r11, r01, roof, ROOFMAT);
    } else if (m.roof === "gable"){
      const a1 = P(-ew, 0.2 + h, 0), a2 = P(ew, 0.2 + h, 0);
      quad(r00, r10, a2, a1, roof, ROOFMAT);
      quad(r01, r11, a2, a1, shade(roof, 0.88), ROOFMAT);
      push(r00, a1, r01, shade(wall, 0.96), "wall"); push(r10, r11, a2, shade(wall, 0.96), "wall");
    } else {
      const rl = w * 0.2, top = 0.2 + h;
      const a1 = P(-rl, top, 0), a2 = P(rl, top, 0);
      if (art && art.roof){
        // straight down onto the roof: the painting is a plan, so the name
        // lands along the ridge exactly where it was painted
        const key = p.id + ":roof";
        // The plan is drawn as you would look at it: the front of the
        // building at the bottom of the picture, and left to right as you see
        // it standing in front. Local +x runs to the viewer's left and the
        // front is -z, so both axes turn over.
        const uv = (x, z) => [(ew - x) / (2 * ew), (ed - z) / (2 * ed)];
        const white = [255, 255, 255];
        quadUV(r00, r10, a2, a1, [uv(-ew, -ed), uv(ew, -ed), uv(rl, 0), uv(-rl, 0)], white, key);
        quadUV(r11, r01, a1, a2, [uv(ew, ed), uv(-ew, ed), uv(-rl, 0), uv(rl, 0)], white, key);
        pushUV(r00, a1, r01, [uv(-ew, -ed), uv(-rl, 0), uv(-ew, ed)], white, key);
        pushUV(r10, r11, a2, [uv(ew, -ed), uv(ew, ed), uv(rl, 0)], white, key);
      } else {
        quad(r00, r10, a2, a1, roof, ROOFMAT);
        quad(r11, r01, a1, a2, shade(roof, 0.86), ROOFMAT);
        push(r00, a1, r01, shade(roof, 0.93), ROOFMAT);
        push(r10, r11, a2, shade(roof, 0.93), ROOFMAT);
      }
    }
    // a raised centre section along the ridge, with its own little roof —
    // the thing that gives a long shallow island roof its shape
    if (m.monitor){
      const mw = hw * (m.monitor[0] || 0.4), mh = m.monitor[1] || 1.2;
      const my0 = 0.2 + h - 0.15, my1 = my0 + mh;
      solid(-mw, mw, my0, my1, -hd * 0.42, hd * 0.42, shade(wall, 1.05), "wall");
      quad(P(-mw, my1, -hd * 0.42), P(mw, my1, -hd * 0.42),
           P(mw, my1, hd * 0.42), P(-mw, my1, hd * 0.42), shade(roof, 1.04), ROOFMAT);
      solid(-mw - 0.4, mw + 0.4, my1, my1 + 0.25, -hd * 0.42 - 0.4, hd * 0.42 + 0.4,
            shade(roof, 0.85), ROOFMAT);
    }
    if (m.flag){
      const fx = hw + e + 1.2, ft = 11;
      solid(fx - 0.09, fx + 0.09, 0.2, ft, -hd * 0.2 - 0.09, -hd * 0.2 + 0.09, [235, 238, 240], "timber");
      quad(P(fx + 0.1, ft - 2.2, -hd * 0.2), P(fx + 2.4, ft - 2.0, -hd * 0.2),
           P(fx + 2.4, ft - 0.9, -hd * 0.2), P(fx + 0.1, ft - 0.8, -hd * 0.2), [26, 62, 140], "wall");
    }
    if (m.deck){
      // a deck out towards the water, on a seawall
      const dz0 = -hd - e - m.deck, dz1 = -hd - e * 0.5;
      quad(P(-hw - 1, 0.5, dz0), P(hw + 1, 0.5, dz0), P(hw + 1, 0.5, dz1), P(-hw - 1, 0.5, dz1), trim, "timber");
      solid(-hw - 1, hw + 1, 0.0, 0.55, dz0 - 0.4, dz0, shade(trim, 0.72), "ground");   // the wall itself
      const rails = Math.max(4, Math.round(w / 3));
      for (let i = 0; i <= rails; i++){
        const x = -hw - 1 + (w + 2) * i / rails;
        solid(x - 0.07, x + 0.07, 0.5, 1.5, dz0 - 0.07, dz0 + 0.07, trim, "timber");
      }
      solid(-hw - 1, hw + 1, 1.42, 1.55, dz0 - 0.06, dz0 + 0.06, trim, "timber");
    }
    if (m.spire){
      const sw = 0.9, tip = P(0, 0.2 + m.spire, -hd * 0.55);
      const b = z => [P(-sw, 0.2 + h * 0.95, -hd * 0.55 + z), P(sw, 0.2 + h * 0.95, -hd * 0.55 + z)];
      const [b1, b2] = b(-sw), [b4, b3] = b(sw);
      push(b1, b2, tip, trim, "wall"); push(b2, b3, tip, trim, "wall");
      push(b3, b4, tip, trim, "wall"); push(b4, b1, tip, trim, "wall");
    }

    // veranda along the ground floor
    if (m.veranda){
      const dz = -hd - e * 0.8;
      quad(P(-hw, 0.35, -hd), P(hw, 0.35, -hd), P(hw, 0.35, dz), P(-hw, 0.35, dz), trim, "timber");
      const n = Math.max(3, Math.round(w / 3.2));
      for (let i = 0; i <= n; i++){
        const x = -hw + (w * i / n);
        solid(x - 0.14, x + 0.14, 0.35, 0.2 + fh - 0.3, dz - 0.14, dz + 0.14, trim, "timber");
      }
    }

    // a pool in front, for the places people swim at
    if (m.pool){
      const px0 = -hw * 0.1, px1 = px0 + Math.min(10, w * 0.55);
      const pz0 = -hd - 9.0, pz1 = pz0 + 5.0;      // clear of the veranda
      quad(P(px0 - 0.5, 0.16, pz0 - 0.5), P(px1 + 0.5, 0.16, pz0 - 0.5),
           P(px1 + 0.5, 0.16, pz1 + 0.5), P(px0 - 0.5, 0.16, pz1 + 0.5), trim, "ground");
      quad(P(px0, 0.2, pz0), P(px1, 0.2, pz0), P(px1, 0.2, pz1), P(px0, 0.2, pz1), water, "glass");
    }

    // palms around the plot, never through the building
    const palms = m.palms || 4;
    for (let i = 0; i < palms; i++){
      const a = (i / palms) * Math.PI * 2 + rnd() * 0.8;
      const r = Math.max(hw, hd) + 2.5 + rnd() * 5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8;
      if (Math.abs(x) < hw + 1.2 && Math.abs(z) < hd + 1.2) continue;
      const th2 = 7 + rnd() * 5, lean = (rnd() - 0.5) * 1.6;
      const t = 0.2;
      // trunk: a tapered four-sided post
      const foot = [[-t,-t],[t,-t],[t,t],[-t,t]];
      for (let k = 0; k < 4; k++){
        const [ax, az] = foot[k], [bx, bz] = foot[(k + 1) % 4];
        quad(P(x + ax, 0.2, z + az), P(x + bx, 0.2, z + bz),
             P(x + bx * 0.45 + lean, th2, z + bz * 0.45),
             P(x + ax * 0.45 + lean, th2, z + az * 0.45), bark, "timber");
      }
      // a crown of fronds, each a long thin wedge that dips at its tip, in
      // two greens so the canopy has some depth to it from below
      const FR = 10;
      for (let k = 0; k < FR; k++){
        const fa = (k / FR) * Math.PI * 2 + rnd() * 0.25;
        const fl = 3.0 + rnd() * 1.8, dip = th2 - 0.8 - rnd() * 1.4;
        const tone = k % 2 ? frond : [78, 138, 60];
        const tipX = x + lean + Math.cos(fa) * fl, tipZ = z + Math.sin(fa) * fl;
        const midX = x + lean + Math.cos(fa) * fl * 0.5, midZ = z + Math.sin(fa) * fl * 0.5;
        push(P(x + lean - 0.3, th2 + 0.2, z), P(midX, th2 + 0.35, midZ), P(tipX, dip, tipZ), tone, "leaf");
        push(P(x + lean + 0.3, th2 + 0.2, z), P(tipX, dip, tipZ), P(midX, th2 + 0.35, midZ), tone, "leaf");
      }
    }
  }
  bldGroups = [];
  for (const name of Object.keys(bin)){
    const B = bin[name];
    if (!B || !B.pos.length) continue;
    const mk = data => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return b;
    };
    bldGroups.push({ name, count: B.pos.length / 3,
                     pos: mk(B.pos), nrm: mk(B.nrm), col: mk(B.col), uv: mk(B.uv) });
  }
  bldCount = bldGroups.reduce((n, g) => n + g.count, 0);
}

function drawBuildings(mvp, e, sun){
  if (!bldCount) return;
  const a = 1 - Math.max(0, Math.min(1, (view.dist - B_NEAR) / (B_FAR - B_NEAR)));
  if (a <= 0.01) return;
  gl.useProgram(bldProg);
  gl.uniformMatrix4fv(BP.mvp, false, new Float32Array(mvp));
  gl.uniform3f(BP.sun, sun[0], sun[1], sun[2]);
  gl.uniform3f(BP.eye, e[0], e[1], e[2]);
  gl.uniform3fv(BP.haze, SKY_HAZE);
  gl.uniform2f(BP.fog, Math.max(5000, view.dist * 2.0), Math.max(22000, view.dist * 5.0));
  gl.uniform1f(BP.alpha, a);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE3);
  gl.uniform1i(BP.tex, 3);
  const bindTo = (buf, loc, size) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  for (const g of bldGroups){
    gl.bindTexture(gl.TEXTURE_2D, matTex[g.name] || facadeTex[g.name] || matTex.wall);
    bindTo(g.pos, BP.pos, 3); bindTo(g.nrm, BP.nrm, 3);
    bindTo(g.col, BP.col, 3); bindTo(g.uv, BP.uv, 2);
    gl.drawArrays(gl.TRIANGLES, 0, g.count);
  }
  gl.disable(gl.BLEND);
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
    paintMaterials();
    loadFacades();
    buildMesh();
    buildBuildings();
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
  // 45 m is standing across the road from the place, which is the distance
  // at which a building stops being a marker and starts being a building.
  view.dist = Math.max(45, Math.min(40000, view.dist));
};
function eyeAndTarget(){
  const t = [toWorldX(view.lon), worldY(view.lat, view.lon), toWorldZ(view.lat)];
  const r = view.dist * Math.cos(view.el);
  const e = [t[0] + r * Math.sin(view.az), t[1] + view.dist * Math.sin(view.el),
             t[2] + r * Math.cos(view.az)];
  const eLat = C_LAT - e[2] / KM_LAT_M, eLon = C_LON + e[0] / M_LON;
  e[1] = Math.max(e[1], worldY(eLat, eLon) + 12);   // never underground
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
  gl.uniform3fv(T.air, SKY_HAZE);
  // haze belongs to the air, so it is measured in kilometres of it, not in
  // how far the camera happens to be sitting back
  gl.uniform2f(T.fog, Math.max(5000, view.dist * 2.0), Math.max(22000, view.dist * 5.0));
  gl.uniform2f(T.shadeMix, SHADE_MIX[0], SHADE_MIX[1]);
  gl.uniform1f(T.grade, PAINTED ? 0.35 : 1.0);
  // fully painted ground below 220 m, fully the base map above 700
  gl.uniform1f(T.close, 1 - Math.max(0, Math.min(1, (view.dist - 220) / 480)));
  gl.drawElements(gl.TRIANGLES, indexCount, uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);

  drawBuildings(mvp, e, sun);

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
// a handle for the tests, and for anyone poking at the scene from a console
window.raro3d = { view, get buildings(){ return bldCount / 3; },
                  get dist(){ return view.dist; } };

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
// Orbiting alone is not navigation: it spins you round a fixed point, so
// getting to a particular beach means orbiting until it drifts past. Dragging
// with two fingers, with the right button, or with shift held moves the point
// you are orbiting, which is how you actually get somewhere.
const pts = new Map();
let pinch = null, panning = false, twoMid = null;

// metres of ground per pixel of screen, at the distance you are standing off
function groundPerPixel(){
  return (2 * view.dist * Math.tan(46 * Math.PI / 360)) / Math.max(1, innerHeight);
}
function panBy(dxPx, dyPx){
  const mpp = groundPerPixel();
  const rx = Math.cos(view.az), rz = -Math.sin(view.az);      // screen right
  const fx = -Math.sin(view.az), fz = -Math.cos(view.az);     // into the screen
  const wx = -(rx * dxPx + fx * dyPx) * mpp;
  const wz = -(rz * dxPx + fz * dyPx) * mpp;
  view.lon += wx / M_LON;
  view.lat -= wz / KM_LAT_M;
  // stay over the ground the data covers
  view.lat = Math.max(TB_S + 0.004, Math.min(TB_N - 0.004, view.lat));
  view.lon = Math.max(TB_W + 0.004, Math.min(TB_E - 0.004, view.lon));
  camDirty = true;
}
window.pan3D = panBy;

// The gestures listen on the whole stage, in the capture phase, because the
// pins sit on top of the canvas and there are seventy of them: a drag that
// happens to start on one used to do nothing at all, which is most of what
// made this hard to fly. A pin still opens on a tap — a press that never
// moves — and swallows nothing else.
let moved3d = 0;
stage.addEventListener("contextmenu", ev => { if (window.mode3d) ev.preventDefault(); });
stage.addEventListener("pointerdown", ev => {
  if (!window.mode3d) return;
  pts.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });
  panning = ev.button === 2 || ev.button === 1 || ev.shiftKey;
  pinch = null; twoMid = null; moved3d = 0;
}, true);
stage.addEventListener("pointermove", ev => {
  if (!window.mode3d) return;
  const prev = pts.get(ev.pointerId); if (!prev) return;
  const cur = { x:ev.clientX, y:ev.clientY };
  moved3d += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
  pts.set(ev.pointerId, cur);
  if (pts.size >= 2){
    // two fingers: pinch to come closer, slide to move across the island
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x:(a.x + b.x) / 2, y:(a.y + b.y) / 2 };
    if (pinch) view.dist *= pinch / d;
    if (twoMid) panBy(mid.x - twoMid.x, mid.y - twoMid.y);
    pinch = d; twoMid = mid;
  } else if (panning || ev.shiftKey){
    panBy(cur.x - prev.x, cur.y - prev.y);
  } else {
    view.az -= (cur.x - prev.x) * 0.005;
    view.el += (cur.y - prev.y) * 0.004;
  }
  camDirty = true;
}, true);
["pointerup","pointercancel"].forEach(e => stage.addEventListener(e, ev => {
  pts.delete(ev.pointerId);
  if (pts.size < 2){ pinch = null; twoMid = null; }
  if (!pts.size) panning = false;
}, true));
// a drag that began on a pin must not also open that pin when it ends
stage.addEventListener("click", ev => {
  if (window.mode3d && moved3d > 8){ ev.preventDefault(); ev.stopPropagation(); moved3d = 0; }
}, true);
stage.addEventListener("wheel", ev => {
  if (!window.mode3d) return;
  ev.preventDefault(); ev.stopPropagation();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  if (ev.shiftKey){ panBy(-ev.deltaX * unit, -ev.deltaY * unit); return; }
  view.dist *= Math.exp(ev.deltaY * unit * 0.0016);
  camDirty = true;
}, { passive:false });

// the arrow keys move you about, which is the one control everybody tries
addEventListener("keydown", ev => {
  if (!window.mode3d) return;
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
  const step = 90;
  const k = { ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[ev.key];
  if (k){ ev.preventDefault(); panBy(-k[0], -k[1]); }
});

// the zoom buttons belong to the flat map; in the 3D setting they have to
// move the camera in and out instead, or they simply appear broken
for (const [id, k] of [["zin", 0.65], ["zout", 1.55]]){
  const btn = document.getElementById(id);
  if (!btn) continue;
  btn.addEventListener("click", ev => {
    if (!window.mode3d) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    view.dist *= k; camDirty = true; draw();
  }, true);
}
const reset = document.getElementById("reset");
if (reset) reset.addEventListener("click", ev => {
  if (!window.mode3d) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  view.lat = C_LAT; view.lon = C_LON; view.az = 0.35; view.el = 0.26; view.dist = 11000;
  camDirty = true; draw();
}, true);

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
    view.dist = Math.max(150, metresAcross() * 1.15);
    startLoop();
    showHint();
  } else {
    const im = llToImg(view.lat, view.lon);
    cam.x = im.x; cam.y = im.y;
    placeCamera();
  }
  camDirty = true;
};
// Nobody guesses a control they cannot see. This says what the gestures are,
// the first few times you switch over, and then stops.
const hint = document.createElement("div");
hint.id = "navHint";
hint.textContent = "Drag to orbit \u00b7 two fingers, shift-drag or right-drag to move \u00b7 scroll to zoom";
hint.hidden = true;
document.body.appendChild(hint);
let hintTimer = 0;
function showHint(){
  let seen = 0;
  try { seen = +(localStorage.getItem("raro4.navhint") || 0); } catch(e){}
  if (seen > 4) return;
  try { localStorage.setItem("raro4.navhint", seen + 1); } catch(e){}
  hint.hidden = false; hint.classList.add("on");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.classList.remove("on");
    setTimeout(() => { hint.hidden = true; }, 400); }, 5200);
}

document.getElementById("d3Btn").onclick = () => setMode3D(!window.mode3d);
addEventListener("keydown", e => {
  if (e.key === "3" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || ""))
    setMode3D(!window.mode3d);
});
})();
