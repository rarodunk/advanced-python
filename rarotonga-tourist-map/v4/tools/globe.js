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
const GL2 = !!(window.WebGL2RenderingContext && gl instanceof WebGL2RenderingContext);

/* ---------- handing an image to the card ----------
   WebGL 1 will not mipmap an image whose sides are not powers of two. It does
   not complain: it draws the texture black. The island mosaic is 2200 by 1860
   and every painted elevation is whatever size it was saved at, so on a phone
   that falls back to WebGL 1 — which iOS does under memory pressure — the
   whole island came out as a black silhouette in a blue sea. WebGL 2 has no
   such rule, which is why every desktop looked right.

   So on WebGL 1 the image is redrawn onto a power-of-two canvas first. The
   texture coordinates run zero to one either way, so the stretch is invisible,
   and the mipmaps that keep the island from shimmering at distance survive. */
const MAXTEX = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048);
function pot(n){
  let v = 1;
  while (v * 2 <= n) v *= 2;
  return Math.max(64, Math.min(MAXTEX, v));
}
function texSource(img){
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const two = v => (v & (v - 1)) === 0;
  if (GL2 && w <= MAXTEX && h <= MAXTEX) return img;
  if (two(w) && two(h) && w <= MAXTEX && h <= MAXTEX) return img;
  const cv = document.createElement("canvas");
  cv.width = pot(w); cv.height = pot(h);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

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
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c1 = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c1, d, f.x), f.y);
}
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
  // The overrule is for painted lagoon lying on real land, and lagoon paint is
  // brilliant: at Muri it is 4,201,220. Mountain shadow in the same painting is
  // teal too, but dark — Raemaru's flank is 19,92,107 — and treating that as
  // water turned the peaks into bald green cones. So brightness decides, and
  // only the coastal shelf and the lower slopes are in scope at all.
  float lumP = dot(c, vec3(0.299, 0.587, 0.114));
  float watery = clamp((c.b - c.r) * 2.6, 0.0, 1.0)
               * clamp((c.b - 0.32) * 4.0, 0.0, 1.0)
               * smoothstep(0.38, 0.56, lumP);
  float onLand = smoothstep(2.0, 12.0, vH) * (1.0 - smoothstep(320.0, 480.0, vH));
  vec3 bush = mix(vec3(0.33, 0.45, 0.23), vec3(0.17, 0.30, 0.15),
                  clamp(vH / 420.0, 0.0, 1.0));
  // and it keeps the painting's own light and shade rather than going flat
  bush *= 0.72 + 0.62 * lumP;
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
  c = mix(c, ground, uClose * 0.82);
  // and it is a surface, not an airbrush: two octaves of grain at a metre and
  // at three, which is the difference between grass and a green gradient
  float g1 = vnoise(vPos.xz * 0.75), g2 = vnoise(vPos.xz * 2.9);
  float grain = (g1 * 0.62 + g2 * 0.38) - 0.5;
  c *= 1.0 + grain * 0.22 * uClose * land;
  c += vec3(0.05, 0.06, 0.01) * grain * uClose * land;

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

// How far the water is, walking the bearing the coastline gave this place.
// A beachfront bar and a bar up a valley want different gardens.
function distanceToSea(lat, lon, bearing){
  const th = bearing * Math.PI / 180;
  for (let d = 25; d <= 900; d += 25){
    if (heightAtLL(lat + Math.cos(th) * d / KM_LAT_M,
                   lon + Math.sin(th) * d / M_LON) <= 0.5) return d;
  }
  return 9999;
}

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
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texSource(img));
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
// the bush is rebuilt around where you are, so it gets its own buffers
let vegGroups = [], vegAt = null, vegBusy = false;

/* ---------- geometry, gathered per material ----------
   Everything drawn on the ground goes through these: a bin per material,
   because each one wants its own tiling texture and its own draw. The bin is
   swappable so the same builders can fill the island's own static geometry
   and, separately, the bush that is rebuilt around wherever you are standing.
   MATS plus the imported island's three, which fade in on their own. */
const BINS = MATS.concat(["osmroad", "osmwall", "osmroof"]);
function newBin(){
  const b = {};
  for (const m of BINS) b[m] = { pos: [], nrm: [], col: [], uv: [] };
  return b;
}
let bin = newBin();
const SCALE = { roof: 1.15, wall: 2.4, timber: 1.5, thatch: 1.6,
                glass: 2.6, ground: 5.0, leaf: 1.6,
                osmroad: 6.0, osmwall: 2.4, osmroof: 1.6 };

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

/* ---------- the bush between the buildings ----------------------------
   Rarotonga is not a green lawn with houses on it: the coastal strip is
   palms and breadfruit all the way to the reef, and the valleys behind are
   forest. The painting says that at eight metres a pixel and says nothing
   up close, so the close view grows its own.

   Sowing the whole island at a believable density came to a million
   triangles, most of them behind you or ten kilometres away. So the bush is
   grown around wherever you are standing and resown when you have moved far
   enough to notice — dense where you can see it, absent where you cannot.

   An occupancy grid at twelve metres keeps it out of the buildings and off
   the roads, which is the whole difference between planting and litter. */
// one colour, a shade lighter or darker
const shadeOf = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));

const CELL = 12;
let occ = null, occW = 0, occH = 0;
function occupancy(){
  if (occ) return occ;
  occW = Math.ceil((TB_E - TB_W) * M_LON / CELL);
  occH = Math.ceil((TB_N - TB_S) * KM_LAT_M / CELL);
  occ = new Uint8Array(occW * occH);
  const mark = (lat, lon, spread) => {
    const cx = Math.floor((lon - TB_W) * M_LON / CELL);
    const cy = Math.floor((TB_N - lat) * KM_LAT_M / CELL);
    for (let j = -spread; j <= spread; j++) for (let i = -spread; i <= spread; i++){
      const x = cx + i, y = cy + j;
      if (x >= 0 && y >= 0 && x < occW && y < occH) occ[y * occW + x] = 1;
    }
  };
  const G = (typeof GROUND !== "undefined" && GROUND) || null;
  if (G){
    const [gw, gs] = G.bbox, q = G.q || 1e-5;
    for (const b of G.buildings){
      let x = b[1], y = b[2];
      mark(gs + y * q, gw + x * q, 1);
      for (let i = 3; i < b.length; i += 2){
        x += b[i]; y += b[i + 1];
        mark(gs + y * q, gw + x * q, 1);
      }
    }
    for (const r of G.roads){
      let x = r[1], y = r[2];
      let plat = gs + y * q, plon = gw + x * q;
      mark(plat, plon, 1);
      for (let i = 3; i < r.length; i += 2){
        x += r[i]; y += r[i + 1];
        const lat = gs + y * q, lon = gw + x * q;
        // walk the segment, so a long straight does not leave gaps
        const len = Math.hypot((lat - plat) * KM_LAT_M, (lon - plon) * M_LON);
        const n = Math.min(60, Math.max(1, Math.round(len / CELL)));
        for (let k = 1; k <= n; k++)
          mark(plat + (lat - plat) * k / n, plon + (lon - plon) * k / n, 1);
        plat = lat; plon = lon;
      }
    }
  }
  // the hand-built places keep their own gardens, so leave those alone
  for (const p of PLACES) if (MODELS[p.id] && p.latlon)
    mark(p.latlon.lat, p.latlon.lon, 3);
  return occ;
}

// sow the ground within `radius` metres of a point, into whichever bin is
// current. Returns how many plants went in.
function plantNear(cLat, cLon, radius){
  occupancy();
  const STEP = 8;                                   // one candidate per 64 m2
  const half = Math.ceil(radius / STEP);
  let planted = 0;
  const PALM = [[62, 112, 52], [78, 138, 60]], BUSH = [[58, 104, 48], [86, 132, 56]];
  for (let j = -half; j <= half; j++){
    for (let i = -half; i <= half; i++){
      if (i * i + j * j > half * half) continue;
      // a hash of the cell, so the same ground grows the same trees however
      // often you fly past it
      let seed = ((i + 4096) * 7919 + (j + 4096) * 104729) >>> 0;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      rnd();
      const lat = cLat + (j * STEP + (rnd() - 0.5) * STEP) / KM_LAT_M;
      const lon = cLon + (i * STEP + (rnd() - 0.5) * STEP) / M_LON;
      const cx = Math.floor((lon - TB_W) * M_LON / CELL);
      const cy = Math.floor((TB_N - lat) * KM_LAT_M / CELL);
      if (cx < 0 || cy < 0 || cx >= occW || cy >= occH || occ[cy * occW + cx]) continue;
      const hgt = heightAtLL(lat, lon);
      if (hgt < 1.2) continue;                      // sea, lagoon, sand flat
      // the coast is planted, the valleys are forest, the ridges are thin
      const want = hgt < 90 ? 0.62 : hgt < 260 ? 0.5 : hgt < 420 ? 0.34 : 0.2;
      if (rnd() > want) continue;
      const base = worldY(lat, lon);
      const ox = toWorldX(lon), oz = toWorldZ(lat);
      const P = (x, y, z) => [ox + x, base + y, oz + z];
      const pick = rnd();
      if (hgt < 70 && pick > 0.55){
        // a coconut palm: a leaning trunk and a crown of four fronds
        const ht = 8 + rnd() * 7, lean = (rnd() - 0.5) * 1.4, tone = PALM[pick > 0.78 ? 1 : 0];
        quad(P(-0.28, 0, 0), P(0.28, 0, 0), P(lean + 0.2, ht, 0), P(lean - 0.2, ht, 0),
             [92, 72, 52], "timber");
        for (let k = 0; k < 4; k++){
          const a = (k / 4) * Math.PI * 2 + rnd(), fl = 3.2 + rnd() * 1.6;
          push(P(lean - 0.3, ht - 0.2, 0), P(lean + 0.3, ht - 0.2, 0),
               P(lean + Math.cos(a) * fl, ht - 1.4 - rnd(), Math.sin(a) * fl),
               k % 2 ? tone : shadeOf(tone, 0.84), "leaf");
        }
      } else {
        // forest: a crown on a short trunk, which is all that reads from here
        const ht = 4 + rnd() * (hgt > 200 ? 5 : 8), r = 1.6 + rnd() * 2.2;
        const tone = BUSH[pick > 0.5 ? 1 : 0];
        quad(P(-0.22, 0, 0), P(0.22, 0, 0), P(0.22, ht * 0.6, 0), P(-0.22, ht * 0.6, 0),
             [86, 68, 50], "timber");
        for (let k = 0; k < 2; k++){
          const a = k ? Math.PI / 2.2 : 0, dx = Math.cos(a) * r, dz = Math.sin(a) * r;
          quad(P(-dx, ht * 0.42, -dz), P(dx, ht * 0.42, dz),
               P(dx * 0.55, ht, dz * 0.55), P(-dx * 0.55, ht, -dz * 0.55),
               k ? shadeOf(tone, 0.88) : tone, "leaf");
        }
      }
      planted++;
    }
  }
  return planted;
}

function buildBuildings(){
  // geometry is gathered per material, because each one wants its own tiling
  // texture and its own draw
  bin = newBin();

  // deterministic wobble, so a place looks the same every time you visit it
  const seedOf = str => { let h = 2166136261; for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // Three upright panels crossed through each other: from any angle that is a
  // mound of leaves, and it costs eight triangles. Flat blades laid from the
  // ground to a point read as splashes of paint instead.
  function leafClump(P, rnd, x, z, r, tall, tone){
    for (let i = 0; i < 3; i++){
      const a = (i / 3) * Math.PI + rnd() * 0.3;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      const t = shadeOf(tone, 0.86 + i * 0.09);
      // widest at knee height, narrowing twice on the way up, which rounds the
      // silhouette off instead of leaving a paper tent
      quad(P(x - dx, 0.12, z - dz), P(x + dx, 0.12, z + dz),
           P(x + dx * 0.92, tall * 0.45, z + dz * 0.92),
           P(x - dx * 0.92, tall * 0.45, z - dz * 0.92), t, "leaf");
      quad(P(x - dx * 0.92, tall * 0.45, z - dz * 0.92), P(x + dx * 0.92, tall * 0.45, z + dz * 0.92),
           P(x + dx * 0.5, tall * 0.82, z + dz * 0.5), P(x - dx * 0.5, tall * 0.82, z - dz * 0.5),
           shadeOf(t, 1.06), "leaf");
      push(P(x - dx * 0.5, tall * 0.82, z - dz * 0.5), P(x + dx * 0.5, tall * 0.82, z + dz * 0.5),
           P(x, tall, z), shadeOf(t, 1.1), "leaf");
    }
  }
  // a trunk with a crown: banana and tree fern droop, breadfruit and pandanus
  // hold their leaves up
  function leafTree(P, rnd, x, z, ht, spread, tone, droop){
    const t = 0.16 + ht * 0.02, trunk = [92, 72, 52];
    const box = (x0, x1, y0, y1, z0, z1, col) => {
      const a = P(x0,y0,z0), b = P(x1,y0,z0), c = P(x1,y0,z1), d2 = P(x0,y0,z1);
      const A = P(x0,y1,z0), B = P(x1,y1,z0), C2 = P(x1,y1,z1), D = P(x0,y1,z1);
      quad(a, b, B, A, col, "timber"); quad(b, c, C2, B, col, "timber");
      quad(c, d2, D, C2, col, "timber"); quad(d2, a, A, D, col, "timber");
    };
    box(x - t, x + t, 0.15, ht, z - t, z + t, trunk);
    for (let i = 0; i < 6; i++){
      const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
      const dx = Math.cos(a) * spread, dz = Math.sin(a) * spread;
      push(P(x - 0.25, ht - 0.3, z), P(x + 0.25, ht - 0.3, z),
           P(x + dx, ht + (droop ? -spread * 0.5 : 0.6), z + dz),
           i % 2 ? tone : shadeOf(tone, 0.86), "leaf");
    }
  }
  /* ---------- the island as it is actually built ----------------------
     The base map is a painting at about eight metres a pixel: lovely from a
     hillside, mush from a rooftop, and no amount of sharpening invents a road
     that was never painted. So the close view stops leaning on it. These are
     Overture's own footprints and roads — seven thousand buildings and the
     roads between them, the real ones — drawn as massing, and faded in as you
     come down so the far view stays the painting. */
  function buildGround(){
    const G = (typeof GROUND !== "undefined" && GROUND) || null;
    if (!G || !G.roads) return;
    const [gw, gs] = G.bbox, q = G.q || 1e-5;
    const ll = (x, y) => [gs + y * q, gw + x * q];          // back to degrees
    // where the hand-built places stand, so the two never sit inside each other
    const taken = [];
    for (const p of PLACES) if (MODELS[p.id] && p.latlon)
      taken.push([p.latlon.lat, p.latlon.lon, Math.max(...MODELS[p.id].size) * 0.6 + 6]);

    const world = (lat, lon, up) => [toWorldX(lon), worldY(lat, lon) + up, toWorldZ(lat)];
    // Roads ride the ground with a little clearance: the terrain grid is
    // twenty metres across, so a ribbon laid exactly on it dips through the
    // surface between posts.
    const ROAD = [
      { w: 7.0, c: [78, 76, 74] }, { w: 6.0, c: [80, 78, 76] },
      { w: 5.0, c: [84, 82, 79] }, { w: 4.2, c: [88, 85, 81] },
      { w: 3.6, c: [96, 92, 86] }, { w: 3.0, c: [122, 114, 102] },
      { w: 2.4, c: [156, 142, 120] }, { w: 1.4, c: [168, 156, 134] }
    ];
    for (const r of G.roads){
      const spec = ROAD[r[0]] || ROAD[4];
      const hw2 = spec.w / 2;
      let x = r[1], y = r[2];
      const pts = [ll(x, y)];
      for (let i = 3; i < r.length; i += 2){ x += r[i]; y += r[i + 1]; pts.push(ll(x, y)); }
      for (let i = 0; i + 1 < pts.length; i++){
        const a = pts[i], b = pts[i + 1];
        const ax = toWorldX(a[1]), az = toWorldZ(a[0]);
        const bx = toWorldX(b[1]), bz = toWorldZ(b[0]);
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 0.6 || len > 400) continue;
        const nx = -dz / len * hw2, nz = dx / len * hw2;
        const ay = worldY(a[0], a[1]) + 0.9, by = worldY(b[0], b[1]) + 0.9;
        quad([ax - nx, ay, az - nz], [ax + nx, ay, az + nz],
             [bx + nx, by, bz + nz], [bx - nx, by, bz - nz], spec.c, "osmroad");
      }
    }

    // Roofs on this island are painted tin: red, green, blue, and the pale
    // grey of new steel. Which one a house gets is fixed by where it stands.
    const ROOFS = [[176, 66, 54], [58, 104, 74], [62, 96, 132], [150, 150, 146],
                   [176, 66, 54], [122, 116, 108], [58, 104, 74], [190, 180, 164]];
    const WALLS = [[236, 232, 222], [222, 214, 198], [206, 202, 196], [232, 224, 206]];
    for (const b of G.buildings){
      let x = b[1], y = b[2];
      const ring = [[x, y]];
      for (let i = 3; i < b.length; i += 2){ x += b[i]; y += b[i + 1]; ring.push([x, y]); }
      if (ring.length < 3) continue;
      const pts = ring.map(([px, py]) => ll(px, py));
      let lat = 0, lon = 0;
      for (const p2 of pts){ lat += p2[0]; lon += p2[1]; }
      lat /= pts.length; lon /= pts.length;
      if (heightAtLL(lat, lon) < 0.4) continue;             // stray footprint in the lagoon
      let skip = false;
      for (const [tlat, tlon, rad] of taken){
        const d = Math.hypot((lat - tlat) * KM_LAT_M, (lon - tlon) * M_LON);
        if (d < rad){ skip = true; break; }
      }
      if (skip) continue;                                   // a hand-built place stands here
      // footprint area, so a shed is not given two storeys
      let area = 0;
      for (let i = 0; i < pts.length; i++){
        const a = pts[i], c2 = pts[(i + 1) % pts.length];
        area += (toWorldX(a[1]) * toWorldZ(c2[0]) - toWorldX(c2[1]) * toWorldZ(a[0]));
      }
      area = Math.abs(area) / 2;
      if (area < 9) continue;
      const seed2 = seedOf(String(b[1]) + "," + String(b[2]));
      let h = b[0] / 10;
      if (!h) h = area > 400 ? 6.5 : area > 120 ? 4.2 : 3.1;
      // On a slope the ground under one corner is metres below another, so a
      // box hung from the middle floats at the bottom end. The walls start at
      // the lowest corner and the floor line sits at the highest.
      let lo = 1e9, hi = -1e9;
      for (const [plat, plon] of pts){
        const gy = worldY(plat, plon);
        if (gy < lo) lo = gy;
        if (gy > hi) hi = gy;
      }
      const base = hi;
      const roof = ROOFS[seed2 % ROOFS.length], wall = WALLS[(seed2 >>> 5) % WALLS.length];
      const eave = base + h, ridge = eave + Math.min(2.4, Math.sqrt(area) * 0.22);
      const P3 = [];
      for (const [plat, plon] of pts) P3.push([toWorldX(plon), 0, toWorldZ(plat)]);
      for (let i = 0; i < P3.length; i++){
        const a = P3[i], c2 = P3[(i + 1) % P3.length];
        quad([a[0], lo - 0.8, a[2]], [c2[0], lo - 0.8, c2[2]],
             [c2[0], eave, c2[2]], [a[0], eave, a[2]], wall, "osmwall");
      }
      // a low pyramid for a roof: at this size it is the pitch that reads,
      // not the shape, and it costs one triangle a side
      const cx = P3.reduce((t, p2) => t + p2[0], 0) / P3.length;
      const cz = P3.reduce((t, p2) => t + p2[2], 0) / P3.length;
      for (let i = 0; i < P3.length; i++){
        const a = P3[i], c2 = P3[(i + 1) % P3.length];
        push([a[0], eave, a[2]], [c2[0], eave, c2[2]], [cx, ridge, cz], roof, "osmroof");
      }
    }
  }

  // A place with no building — a summit, a lagoon, a beach, a stretch of road —
  // still stands in something. Without this the pin hovers over bare paint.
  // shift a local frame up or down onto the ground under that spot
  const P2 = (P, dy) => (x, y, z) => P(x, y + dy, z);
  function scatterWild(p){
    const h = heightAtLL(p.latlon.lat, p.latlon.lon);
    const base = worldY(p.latlon.lat, p.latlon.lon);
    const ox = toWorldX(p.latlon.lon), oz = toWorldZ(p.latlon.lat);
    const P = (x, y, z) => [ox + x, base + y, oz + z];
    let seed = seedOf(p.id + ":wild");
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const high = h > 90, shore = h < 6;
    const tone = high ? [64, 104, 48] : shore ? [104, 148, 76] : [82, 128, 56];
    // A lagoon or a passage is itself water: the planting goes on whatever
    // land is within sight of it, which is how a motu gets its palms.
    for (let i = 0; i < 30; i++){
      const a = rnd() * Math.PI * 2, r = 14 + rnd() * 86;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const at = heightAtLL(p.latlon.lat - z / KM_LAT_M, p.latlon.lon + x / M_LON);
      if (at <= 0.6) continue;                  // never plant in the sea
      const y = lift(at) - base;                // sit it on the ground, not the pin's
      const pick = rnd();
      if (pick > 0.72) leafTree(P2(P, y), rnd, x, z, 7 + rnd() * 5, 4.4, tone, high);
      else if (pick > 0.55 && at < 8) leafTree(P2(P, y), rnd, x, z, 6 + rnd() * 3, 3.6, [96, 140, 70], false);
      else leafClump(P2(P, y), rnd, x, z, 2.2 + rnd() * 1.6, 2.2 + rnd() * 1.8, tone);
    }
  }

  for (const p of PLACES){
    const m = MODELS[p.id];
    if (!p.latlon) continue;
    if (!m){ scatterWild(p); continue; }
    const [w, d, h] = m.size;
    const e = m.eave || 1.0;
    const storeys = Math.max(1, m.storeys || 1);
    const base = worldY(p.latlon.lat, p.latlon.lon);
    const ox = toWorldX(p.latlon.lon), oz = toWorldZ(p.latlon.lat);
    // Local -z is the front, and it has to look down the bearing the coastline
    // gave this place. Rotating by the bearing itself pointed it at 360 minus
    // that instead, so every building whose water was not due north or south
    // showed the camera its back: Trader Jack's faced its own car park.
    const th = -(m.face || 0) * Math.PI / 180;
    const ct = Math.cos(th), st = Math.sin(th);
    // local x runs along the front, local z away from it
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

    // the plot: paving tight around the walls, no wider than a place actually
    // paves, with the garden taking everything beyond it
    const pw = hw + e + 1.2, pd = hd + e + 1.2;
    quad(P(-pw, 0.10, -pd), P(pw, 0.10, -pd), P(pw, 0.10, pd), P(-pw, 0.10, pd), sand, "ground");

    if (art){
      // the painted front, hung on the wall: the elevation's own eave line
      // says which part of the picture is wall, and that part is stretched
      // over the wall height
      const white = [255, 255, 255];
      // How much of the picture belongs on the wall. Under a pitched roof,
      // only the part below the eave: the roof itself is geometry and would
      // otherwise be drawn twice. Under a flat roof there is nothing to
      // clash with, so the whole elevation goes up — which is the only way a
      // sign board standing above the parapet ever gets drawn.
      const flatRoof = m.roof === "flat";
      const faceQuad = (face, x0, x1, z0, z1) => {
        const rec = art[face] || art.front;
        if (!rec) return false;
        const e0 = rec.eave != null ? rec.eave : 0.55;
        const yBase = 0.2, yEave = 0.2 + eaveY;
        // the picture is hung at its own scale: the wall part fills the wall,
        // and whatever sits above the eave keeps its proportion above it
        const perFraction = eaveY / Math.max(0.15, 1 - e0);
        const top = flatRoof ? yEave + perFraction * e0 : yEave;
        const v0 = flatRoof ? 0 : e0;
        // u runs the other way: local +x is to the viewer's left when they are
        // standing in front of the building, so the picture would otherwise
        // hang back to front — invisible on a shelf of pies, obvious the
        // moment there is lettering on it
        // A back with no elevation of its own borrows the front. Hung the same
        // way round it would show the sign in mirror writing, so the borrowed
        // picture is flipped: PALACE TAKEAWAYS reads as itself from behind.
        const borrowed = !art[face];
        const uv = borrowed ? [[0, v0], [1, v0], [1, 1], [0, 1]]
                            : [[1, v0], [0, v0], [0, 1], [1, 1]];
        quadUV(P(x0, top, z0), P(x1, top, z1), P(x1, yBase, z1), P(x0, yBase, z0),
               uv, white, p.id + ":" + (borrowed ? "front" : face));
        return true;
      };
      faceQuad("front", -hw, hw, -hd, -hd);
      faceQuad("back",   hw, -hw, hd,  hd);
      faceQuad("side",  -hw, -hw, hd, -hd);
      faceQuad("side",   hw,  hw, -hd, hd);
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

    /* ---- the garden it stands in ----------------------------------------
       A building dropped on bare ground reads as a model kit on a table. Every
       place on this island stands in something: a mown yard with a hibiscus
       hedge, a sand apron with pandanus and a canoe pulled up, taro and banana
       up a valley. None of it is invented per place — it is what the setting
       would carry, chosen from where the place actually is. */
    const trueH = heightAtLL(p.latlon.lat, p.latlon.lon);
    const seaM = distanceToSea(p.latlon.lat, p.latlon.lon, m.face || 0);
    const beach = seaM < 130, hillside = trueH > 55 || seaM > 900;
    const lawn = hillside ? [84, 116, 56] : [96, 138, 62];
    const scrub = [74, 110, 54], leafDark = [48, 92, 46], leafMid = [72, 126, 56];
    const gravel = [150, 145, 134], sandy = [228, 210, 172];
    const petals = [[214, 58, 52], [246, 236, 198], [206, 72, 140], [242, 190, 70]];
    // unsigned: a signed shift can land the index the wrong side of zero
    const petal = petals[(seedOf(p.id) >>> 3) % petals.length];
    const yard = beach ? sandy : hillside ? scrub : lawn;

    // the garden's own outline: a ragged ring, because nothing on this island
    // is mown to a rectangle
    const gr = Math.max(hw, hd) + (beach ? 12 : 9);
    const N = 16, ring = [];
    for (let i = 0; i < N; i++){
      const a = (i / N) * Math.PI * 2;
      const k = gr * (0.72 + rnd() * 0.5);
      ring.push([Math.cos(a) * k, Math.sin(a) * k * 0.86]);
    }
    for (let i = 0; i < N; i++){
      const a = ring[i], b = ring[(i + 1) % N];
      push(P(0, 0.05, 0), P(a[0], 0.05, a[1]), P(b[0], 0.05, b[1]), yard, "ground");
    }
    // a second, deeper patch of ground under the planting, so the yard is not
    // one flat wash of colour
    for (let i = 0; i < N; i += 2){
      const a = ring[i], b = ring[(i + 1) % N], c = ring[(i + 2) % N];
      push(P(a[0] * 0.55, 0.06, a[1] * 0.55), P(b[0] * 0.9, 0.06, b[1] * 0.9),
           P(c[0] * 0.6, 0.06, c[1] * 0.6), shade(yard, hillside ? 1.12 : 0.88), "ground");
    }
    // the way in, from the front of the building out to the road or the beach
    const path = beach ? sandy : gravel;
    quad(P(-1.4, 0.08, -hd - e), P(1.4, 0.08, -hd - e),
         P(1.9, 0.08, -gr - 2), P(-1.9, 0.08, -gr - 2), path, "ground");

    // a clump of leaves: crossed blades, which is all a shrub needs to be at
    // the distance you ever see one from
    const clump = (x, z, r, tall, tone) => leafClump(P, rnd, x, z, r, tall, tone);
    // flowers stand up in the bush rather than lying on the grass, where at
    // this scale they would never be seen
    const bloom = (x, z, y) => {
      const r = 0.42;
      quad(P(x - r, y - r, z), P(x + r, y - r, z), P(x + r, y + r, z), P(x - r, y + r, z),
           petal, "leaf");
    };
    const tree = (x, z, ht, spread, tone, droop) => leafTree(P, rnd, x, z, ht, spread, tone, droop);
    // is this spot clear of the building and the path?
    const clear = (x, z) => Math.abs(x) > hw + 1.4 || Math.abs(z) > hd + e + 1.2;

    // the hedge and the bed along the front, which is where a garden goes
    if (!hillside){
      const hz = -hd - e - 2.6;
      for (let x = -hw - 1; x <= hw + 1; x += 1.5){
        const hh2 = 1.1 + rnd() * 0.7;
        clump(x + (rnd() - 0.5) * 0.4, hz + (rnd() - 0.5) * 0.5, 0.9, hh2, leafMid);
        if (rnd() > 0.45) bloom(x, hz - 0.5, hh2 * 0.85);
      }
      quad(P(-hw - 1.4, 0.09, hz - 1.1), P(hw + 1.4, 0.09, hz - 1.1),
           P(hw + 1.4, 0.09, hz + 1.1), P(-hw - 1.4, 0.09, hz + 1.1), shade(yard, 0.82), "ground");
    }
    // and beds down the sides, kept low so they never hide the elevation
    for (const sx of [-1, 1]){
      for (let i = 0; i < 4; i++){
        const x = sx * (hw + 1.9 + rnd() * 1.6), z = (rnd() - 0.5) * d * 0.9;
        if (!clear(x, z)) continue;
        const th3 = 1.2 + rnd() * 0.9;
        clump(x, z, 1.0 + rnd() * 0.5, th3, i % 2 ? leafDark : leafMid);
        if (rnd() > 0.6) bloom(x, z - 0.6, th3 * 0.8);
      }
    }

    // what grows here beyond the plot
    const wild = beach ? 5 : hillside ? 7 : 4;
    for (let i = 0; i < wild; i++){
      const a = rnd() * Math.PI * 2, r = Math.max(hw, hd) + 3 + rnd() * (gr - Math.max(hw, hd) - 2);
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.85;
      if (!clear(x, z)) continue;
      const pick = rnd();
      if (beach){
        // pandanus and naupaka, which is what actually holds a Rarotongan beach
        if (pick > 0.6) tree(x, z, 4 + rnd() * 2, 2.6, [86, 132, 62], false);
        else clump(x, z, 1.6, 1.5 + rnd() * 0.9, [104, 146, 78]);
      } else if (hillside){
        if (pick > 0.7) tree(x, z, 5 + rnd() * 3, 3.4, leafDark, true);        // tree fern
        else if (pick > 0.4) tree(x, z, 3.4 + rnd(), 2.8, [96, 150, 62], true); // banana
        else clump(x, z, 1.9, 1.8 + rnd() * 1.2, scrub);
      } else {
        if (pick > 0.72){ tree(x, z, 6 + rnd() * 2, 3.6, leafMid, false);      // breadfruit
                          if (rnd() > 0.5) bloom(x + 1, z, 6.4); }
        else if (pick > 0.45) tree(x, z, 3.6 + rnd(), 2.6, [96, 150, 62], true);
        else { const t3 = 1.4 + rnd() * 1.0; clump(x, z, 1.3, t3, leafMid);
               bloom(x, z - 0.5, t3 * 0.8); }
      }
    }

    /* ---- what the place itself puts outside ---- */
    const teak = [138, 100, 64], canvas = [246, 244, 236];
    const lounger = (x, z) => {
      solid(x - 0.95, x + 0.95, 0.35, 0.5, z - 0.4, z + 0.4, canvas, "timber");
      solid(x - 0.95, x - 0.5, 0.5, 1.2, z - 0.4, z + 0.4, canvas, "timber");
      solid(x - 0.2, x + 0.5, 0.5, 0.56, z - 0.34, z + 0.34, petal, "timber");   // a towel
      solid(x - 0.12, x + 0.12, 0.15, 0.35, z - 0.34, z + 0.34, teak, "timber");
    };
    const parasol = (x, z, tone) => {
      solid(x - 0.09, x + 0.09, 0.15, 2.6, z - 0.09, z + 0.09, teak, "timber");
      for (let i = 0; i < 8; i++){
        const a = (i / 8) * Math.PI * 2, b = ((i + 1) / 8) * Math.PI * 2;
        push(P(x, 3.2, z), P(x + Math.cos(a) * 2.2, 2.45, z + Math.sin(a) * 2.2),
             P(x + Math.cos(b) * 2.2, 2.45, z + Math.sin(b) * 2.2),
             i % 2 ? tone : shade(tone, 0.88), "thatch");
      }
    };
    const table = (x, z) => {
      solid(x - 0.11, x + 0.11, 0.15, 0.74, z - 0.11, z + 0.11, teak, "timber");
      solid(x - 0.85, x + 0.85, 0.74, 0.84, z - 0.85, z + 0.85, teak, "timber");
      for (const [cx, cz] of [[-1.4, 0], [1.4, 0]]){
        solid(x + cx - 0.3, x + cx + 0.3, 0.15, 0.5, z + cz - 0.3, z + cz + 0.3, teak, "timber");
        solid(x + cx - 0.3, x + cx - 0.16, 0.5, 1.05, z + cz - 0.3, z + cz + 0.3, teak, "timber");
      }
    };
    const canoe = (x, z, a) => {
      const c = Math.cos(a), sn = Math.sin(a), L = 4.2;
      const hull = (ox2, oz2, wdt, col) => {
        const ax = x + ox2 - c * L / 2, az2 = z + oz2 - sn * L / 2;
        const bx = x + ox2 + c * L / 2, bz = z + oz2 + sn * L / 2;
        quad(P(ax - sn * wdt, 0.2, az2 + c * wdt), P(bx - sn * wdt, 0.2, bz + c * wdt),
             P(bx + sn * wdt, 0.75, bz - c * wdt), P(ax + sn * wdt, 0.75, az2 - c * wdt), col, "timber");
      };
      hull(0, 0, 0.42, trim);
      hull(-sn * 1.8, c * 1.8, 0.16, bark);        // the outrigger float
    };
    const scooter = (x, z) => {
      solid(x - 0.5, x + 0.5, 0.35, 0.7, z - 0.18, z + 0.18, [186, 62, 52], "wall");
      solid(x - 0.62, x - 0.42, 0.1, 0.5, z - 0.06, z + 0.06, [28, 28, 30], "timber");
      solid(x + 0.42, x + 0.62, 0.1, 0.5, z - 0.06, z + 0.06, [28, 28, 30], "timber");
      solid(x + 0.3, x + 0.42, 0.7, 1.05, z - 0.22, z + 0.22, [40, 44, 48], "timber");
    };
    const front = -(hd + e + 4.2);      // out on the grass, clear of the paving
    if (p.cat === "stay"){
      for (let i = 0; i < 3; i++) lounger(-hw * 0.5 + i * 2.4, front + (rnd() - 0.5));
      parasol(hw * 0.6, front, petal);
    } else if (p.cat === "eat" || p.cat === "drink"){
      for (let i = 0; i < 3; i++){
        const x = -hw * 0.7 + i * (w * 0.6) / 2;
        table(x, front + (rnd() - 0.5) * 1.2);
        if (i !== 1) parasol(x, front - 0.1, i ? petal : shade(petal, 1.25));
      }
    } else if (p.cat === "swim" || p.cat === "adventure"){
      if (beach) canoe(hw + 4, front + 2, 0.4 + rnd());
      for (let i = 0; i < 2; i++)                       // kayaks on a rack
        solid(-hw - 3.2, -hw - 0.4, 0.5 + i * 0.55, 0.9 + i * 0.55, 2 + i * 0.2, 2.7 + i * 0.2,
              i ? [232, 168, 60] : [58, 150, 196], "wall");
    } else if (p.cat === "culture"){
      // a low white boundary and, at a church, the headstones that go with it
      for (let x = -hw - 2; x <= hw + 2; x += 2.4)
        solid(x - 0.9, x + 0.9, 0.15, 0.55, front - 0.3, front + 0.3, [236, 232, 220], "wall");
      if (/church|cicc|himene/i.test(p.name + p.id))
        for (let i = 0; i < 6; i++){
          const x = hw + 3 + (i % 3) * 1.6, z = -2 + Math.floor(i / 3) * 2.2;
          solid(x - 0.3, x + 0.3, 0.15, 0.85, z - 0.12, z + 0.12, [232, 228, 216], "wall");
        }
    } else if (p.cat === "knowhow"){
      quad(P(-hw - 2, 0.09, front - 2), P(hw + 2, 0.09, front - 2),
           P(hw + 2, 0.09, front + 2), P(-hw - 2, 0.09, front + 2), gravel, "ground");
      for (let i = 0; i < 3; i++) scooter(-hw + 1 + i * 2.2, front);
    }
  }
  buildGround();

  bldGroups = upload(bin);
  bldCount = bldGroups.reduce((n, g) => n + g.count, 0);
}

// hand a bin to the card
function upload(b){
  const out = [];
  for (const name of Object.keys(b)){
    const B = b[name];
    if (!B || !B.pos.length) continue;
    const mk = data => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return buf;
    };
    out.push({ name, count: B.pos.length / 3,
               pos: mk(B.pos), nrm: mk(B.nrm), col: mk(B.col), uv: mk(B.uv) });
  }
  return out;
}

/* ---------- the bush around where you are ----------
   Rebuilt when you have moved a quarter of the radius, and thrown away
   entirely once you are far enough out that the painting reads better than
   ten thousand little trees would. */
const VEG_R = 780;
function tendVegetation(){
  if (!ready) return;
  if (view.dist > 2200){
    if (vegGroups.length){
      for (const g of vegGroups) for (const k of ["pos", "nrm", "col", "uv"]) gl.deleteBuffer(g[k]);
      vegGroups = []; vegAt = null;
    }
    return;
  }
  if (vegAt){
    const moved = Math.hypot((view.lat - vegAt[0]) * KM_LAT_M, (view.lon - vegAt[1]) * M_LON);
    if (moved < VEG_R * 0.38) return;     // resowing costs a frame, so not often
  }
  if (vegBusy) return;
  vegBusy = true;
  const keep = bin;
  bin = newBin();
  try {
    plantNear(view.lat, view.lon, VEG_R);
    const fresh = upload(bin);
    for (const g of vegGroups) for (const k of ["pos", "nrm", "col", "uv"]) gl.deleteBuffer(g[k]);
    vegGroups = fresh;
    vegAt = [view.lat, view.lon];
  } finally {
    bin = keep;
    vegBusy = false;
  }
}

function drawBuildings(mvp, e, sun){
  if (!bldCount) return;
  tendVegetation();
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
  // The imported footprints and roads are for the close view: they arrive as
  // you come down and are gone by the time the island is a whole shape, where
  // the painting says it better than seven thousand grey boxes would.
  const osmA = a * (1 - Math.max(0, Math.min(1, (view.dist - 900) / 1800)));
  const OSMTEX = { osmroad: "ground", osmwall: "wall", osmroof: "roof" };
  for (const g of bldGroups.concat(vegGroups)){
    const isOsm = OSMTEX[g.name] !== undefined;
    if (isOsm && osmA <= 0.01) continue;
    gl.uniform1f(BP.alpha, isOsm ? osmA : a);
    gl.bindTexture(gl.TEXTURE_2D, matTex[OSMTEX[g.name]] || matTex[g.name] || facadeTex[g.name] || matTex.wall);
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
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, texSource(img));
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
// The height the camera hangs from. Reading it straight off the ground under
// the focus makes the whole view jolt every time you cross a ridge or a
// building's terrace, which is what the bouncing was: at speed the ground
// under you is a staircase. So the camera rides an average of the ground
// around it, eased towards rather than snapped to.
let camY = null, camLift = 0, lastFrame = 0;
function groundNear(lat, lon){
  const r = Math.min(90, Math.max(12, view.dist * 0.06));
  let sum = worldY(lat, lon) * 2, wt = 2;
  for (let i = 0; i < 6; i++){
    const a = (i / 6) * Math.PI * 2;
    sum += worldY(lat + Math.cos(a) * r / KM_LAT_M, lon + Math.sin(a) * r / M_LON);
    wt += 1;
  }
  return sum / wt;
}
function settleCamera(now){
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0.016;
  lastFrame = now;
  const raw = groundNear(view.lat, view.lon);
  // a quarter of a second to catch up, which is quick enough to follow a
  // hillside and slow enough that a kerb does not throw you
  const k = 1 - Math.exp(-dt / 0.25);
  camY = camY == null ? raw : camY + (raw - camY) * k;
  const t = [toWorldX(view.lon), camY, toWorldZ(view.lat)];
  const r = view.dist * Math.cos(view.el);
  const eY = t[1] + view.dist * Math.sin(view.el);
  const e = [t[0] + r * Math.sin(view.az), eY, t[2] + r * Math.cos(view.az)];
  const eLat = C_LAT - e[2] / KM_LAT_M, eLon = C_LON + e[0] / M_LON;
  const need = Math.max(0, worldY(eLat, eLon) + 12 - eY);     // never underground
  camLift += (need - camLift) * (1 - Math.exp(-dt / 0.2));
  // the pins are only redrawn on a dirty camera, and the camera is still
  // moving while it settles
  if (Math.abs(raw - camY) > 0.05 || Math.abs(need - camLift) > 0.05) camDirty = true;
}
function eyeAndTarget(){
  if (camY == null) settleCamera(performance.now());
  const t = [toWorldX(view.lon), camY, toWorldZ(view.lat)];
  const r = view.dist * Math.cos(view.el);
  const e = [t[0] + r * Math.sin(view.az), t[1] + view.dist * Math.sin(view.el) + camLift,
             t[2] + r * Math.cos(view.az)];
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
  stepFlight();
  settleCamera(performance.now());
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
  // the painting hands over to real ground earlier now that there is real
  // ground to hand over to: roads, footprints and bush all arrive by 2.2 km
  gl.uniform1f(T.close, 1 - Math.max(0, Math.min(1, (view.dist - 420) / 1300)));
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
window.raro3d = { view, centre: [C_LAT, C_LON],
                  get buildings(){ return bldCount / 3; },
                  get dist(){ return view.dist; },
                  get camY(){ return camY; },
                  get glVersion(){ return GL2 ? 2 : 1; },
                  // where a screen pixel lands on the ground the camera is
                  // looking at, which is also how the drag is worked out
                  groundLL(sx, sy){
                    const { e, t } = eyeAndTarget();
                    const g = groundAt(sx, sy, e, t);
                    return g && { lat: C_LAT - g[2] / KM_LAT_M, lon: C_LON + g[0] / M_LON };
                  } };

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

/* ---------- arriving at a place ---------- */
// A place is worth seeing from the water: that is the angle every postcard of
// this island is taken from, and it puts the mountains behind the roof instead
// of the roof against a hillside. Still looking down on it, just from the
// ocean side. Which side that is gets tried rather than assumed: walk the
// compass round and take the bearing whose viewpoint stands over water.
function seaSideAz(lat, lon, dist, el, prefer){
  const r0 = dist * Math.cos(el);
  // A place set back from the beach has no water at arm's length, so look
  // further out for the sea and then come back in on that bearing.
  for (const reach of [1, 2.5, 6, 14]){
    const az = seaSideAtRadius(lat, lon, r0 * reach, false, prefer);
    if (az != null) return az;
  }
  return seaSideAtRadius(lat, lon, r0, true, prefer);
}
function seaSideAtRadius(lat, lon, r, orDry, prefer){
  const wet = [], dry = [];
  for (let i = 0; i < 72; i++){
    const az = i / 72 * Math.PI * 2;
    const ex = toWorldX(lon) + r * Math.sin(az), ez = toWorldZ(lat) + r * Math.cos(az);
    const eLat = C_LAT - ez / KM_LAT_M, eLon = C_LON + ex / M_LON;
    // the viewpoint itself, and the water between it and the place: looking
    // across a headland is not looking from the sea
    let land = Math.max(0, heightAtLL(eLat, eLon));
    for (let k = 0.5; k < 1; k += 0.25){
      land += Math.max(0, heightAtLL(lat + (eLat - lat) * k, lon + (eLon - lon) * k)) * 0.5;
    }
    // among the bearings that work, the one nearest the way you already face,
    // so opening a second place along the same beach is a small move
    // measured from where the building's own front looks, when it has one, so
    // you arrive facing the painted elevation rather than a corner of it
    const from = prefer == null ? view.az : prefer;
    let turn = Math.abs(((az - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    (land < 0.6 ? wet : dry).push({ az, land, turn });
  }
  if (wet.length){
    wet.sort((a, b) => a.turn - b.turn);
    return wet[0].az;
  }
  if (!orDry) return null;
  // nothing round here is water: inland places get the lowest ground instead,
  // which is the valley rather than the ridge behind them
  dry.sort((a, b) => (a.land - b.land) || (a.turn - b.turn));
  return dry[0].az;
}
let flight = null;
function flyTo(to, ms){
  const from = { lat:view.lat, lon:view.lon, az:view.az, el:view.el, dist:view.dist };
  let d = to.az - from.az;                      // turn the short way round
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  flight = { from, to, d, t0: performance.now(), ms };
  camDirty = true;
}
function stepFlight(){
  if (!flight) return;
  const k = Math.min(1, (performance.now() - flight.t0) / flight.ms);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease in and out
  const f = flight.from, t = flight.to;
  view.lat = f.lat + (t.lat - f.lat) * e;
  view.lon = f.lon + (t.lon - f.lon) * e;
  view.az  = f.az + flight.d * e;
  view.el  = f.el + (t.el - f.el) * e;
  // distance moves geometrically, so a long approach does not crawl at the end
  view.dist = f.dist * Math.pow(t.dist / f.dist, e);
  camDirty = true;
  if (k >= 1) flight = null;
}
// How far back to stand: a shopfront wants ninety metres, the airport wants
// three hundred, and a lagoon or a mountain is not a building at all.
function arrivalDist(id){
  const m = MODELS[id];
  if (!m || !m.size) return 260;
  return Math.max(85, Math.min(420, Math.max(m.size[0], m.size[1]) * 4.2));
}
// dist and tilt for arriving somewhere: close enough to read the building,
// high enough to still be looking down on it
window.flyTo3D = function(lat, lon, dist, el, faceDeg){
  if (!window.mode3d) return false;
  dist = dist || 260;
  el = el == null ? 0.42 : el;
  // the eye wants to stand where the building is looking: bearing b sits at
  // an azimuth of pi minus b
  const prefer = faceDeg == null ? null : Math.PI - faceDeg * Math.PI / 180;
  flyTo({ lat, lon, az: seaSideAz(lat, lon, dist, el, prefer), el, dist }, 900);
  return true;
};

/* ---------- gestures, only while the 3D setting is on ---------- */
// Dragging moves you across the island, because that is what dragging does on
// every other map anybody has ever used. Turning is a deliberate act: twist
// two fingers, spin two fingers sideways on a trackpad, or hold shift and
// drag. Orbiting on a plain drag is what made this so hard to fly: you could
// never get to a place, only spin past it.
const pts = new Map();
let pinch = null, twoMid = null, twist = null, orbiting = false, moved3d = 0;
// what the two-finger gesture turned out to be, and where it started
let gate = 0, twoKey = "", pinch0 = 0, twist0 = 0, mid0 = null;

function groundPerPixel(){
  return (2 * view.dist * Math.tan(46 * Math.PI / 360)) / Math.max(1, innerHeight);
}
function moveFocus(dx, dz){
  flight = null;
  view.lon += dx / M_LON;
  view.lat -= dz / KM_LAT_M;
  view.lat = Math.max(TB_S + 0.004, Math.min(TB_N - 0.004, view.lat));
  view.lon = Math.max(TB_W + 0.004, Math.min(TB_E - 0.004, view.lon));
  camDirty = true;
}
// Screen pixels are not metres on a tilted view: the same drag covers a
// street at the bottom of the screen and a kilometre near the horizon, and
// the direction depends on where the camera is looking. Guessing at it is
// what made the drag feel wrong. So aim the actual ray through the pointer
// at the ground plane the camera is looking at, and move the world so the
// spot you grabbed stays under your finger.
function groundAt(sx, sy, e, t){
  const f = norm(sub(t, e));
  const right = norm(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const tanY = Math.tan(46 * Math.PI / 360), aspect = innerWidth / Math.max(1, innerHeight);
  const nx = (2 * sx / Math.max(1, innerWidth) - 1) * tanY * aspect;
  const ny = (1 - 2 * sy / Math.max(1, innerHeight)) * tanY;
  const d = norm([f[0] + right[0]*nx + up[0]*ny,
                  f[1] + right[1]*nx + up[1]*ny,
                  f[2] + right[2]*nx + up[2]*ny]);
  if (d[1] > -1e-4) return null;                       // that ray is sky
  const k = (t[1] - e[1]) / d[1];
  if (k <= 0 || k > view.dist * 3.0) return null;      // near the horizon, unusable
  return [e[0] + d[0]*k, t[1], e[2] + d[2]*k];
}
// Zoom towards a point on the screen rather than the middle of it: pinching
// the corner of the map and watching the island rush past the middle is most
// of why this was hard to fly. Held to a leash, though — at a shallow tilt the
// ray through the middle of the screen lands kilometres away, near the
// horizon, and chasing that point turns a pinch into a flight across the
// island. So the aim drifts you towards what you pinched rather than
// flying you to it: a third of the camera's distance, no further.
function zoomAt(ratio, sx, sy){
  const g = groundUnder(sx, sy);
  const was = view.dist;
  view.dist = Math.max(45, Math.min(40000, view.dist * ratio));
  const closed = 1 - view.dist / was;              // how much of the way we came in
  if (g && closed > 0){
    let dx = g[0] - toWorldX(view.lon), dz = g[2] - toWorldZ(view.lat);
    const len = Math.hypot(dx, dz), leash = view.dist * 0.35;
    if (len > leash){ dx *= leash / len; dz *= leash / len; }
    moveFocus(dx * closed, dz * closed);
  }
  camDirty = true;
}
function groundUnder(sx, sy){
  const { e, t } = eyeAndTarget();
  return groundAt(sx, sy, e, t);
}
function panBy(dxPx, dyPx, fromX, fromY){
  const { e, t } = eyeAndTarget();
  if (fromX != null){
    const a = groundAt(fromX, fromY, e, t);
    const b = groundAt(fromX + dxPx, fromY + dyPx, e, t);
    if (a && b){
      // Perspective means a pixel near the top of the screen covers far more
      // ground than one near the bottom. Held to exactly, a drag that starts
      // up by the horizon throws you across the island; this keeps the ground
      // under your finger without letting one flick become a flight.
      let dx = a[0] - b[0], dz = a[2] - b[2];
      const len = Math.hypot(dx, dz), cap = view.dist * 0.08;
      if (len > cap){ dx *= cap / len; dz *= cap / len; }
      moveFocus(dx, dz);
      return;
    }
  }
  // fallback for the flat case and for drags that started against the sky
  const mpp = groundPerPixel();
  const rx = Math.cos(view.az), rz = -Math.sin(view.az);      // screen right
  const fx = -Math.sin(view.az), fz = -Math.cos(view.az);     // into the screen
  moveFocus(-(rx * dxPx + fx * dyPx) * mpp, (rz * dxPx + fz * dyPx) * mpp);
}
// A twist turns you around the island, not around your own feet: the island
// is the thing you are looking at. Down among the buildings that would fling
// you across the lagoon, so close in the turn becomes a look around instead.
function turnBy(dAz, dEl){
  view.az += dAz;
  const k = Math.max(0, Math.min(1, (view.dist - 800) / 1500));
  if (k > 0){
    const cx = toWorldX(view.lon) - toWorldX(C_LON);
    const cz = toWorldZ(view.lat) - toWorldZ(C_LAT);
    const a = dAz * k, c = Math.cos(a), sn = Math.sin(a);
    const nx = cx * c + cz * sn, nz = -cx * sn + cz * c;
    view.lon = C_LON + nx / M_LON;
    view.lat = C_LAT - nz / KM_LAT_M;
  }
  if (dEl) view.el += dEl;
  camDirty = true;
}
const orbitBy = turnBy;
window.pan3D = panBy;

stage.addEventListener("contextmenu", ev => { if (window.mode3d) ev.preventDefault(); });
// touch-action keeps Android from scrolling the page under the gesture, but
// Safari on iOS zooms the page on a pinch regardless of it. Two fingers on the
// island are for the island: without this the browser zooms the whole page at
// the same time as the camera zooms, and the two together are unflyable.
stage.addEventListener("touchmove", ev => {
  if (window.mode3d && ev.touches && ev.touches.length > 1) ev.preventDefault();
}, { passive: false, capture: true });
function endGesture(id){
  // the pair is gone or changed either way: measure the next one afresh
  pinch = null; twist = null; twoMid = null; twoKey = ""; gate = 0;
  if (id == null){
    for (const k of pts.keys()) try { stage.releasePointerCapture(k); } catch(e){}
    pts.clear();
  } else {
    try { if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id); } catch(e){}
    pts.delete(id);
  }
  if (!pts.size) orbiting = false;
}
stage.addEventListener("pointerdown", ev => {
  if (!window.mode3d) return;
  pts.set(ev.pointerId, { x:ev.clientX, y:ev.clientY });
  flight = null;
  orbiting = ev.button === 2 || ev.button === 1 || ev.shiftKey || ev.altKey;
  pinch = null; twoMid = null; twist = null; moved3d = 0;
}, true);
stage.addEventListener("pointermove", ev => {
  if (!window.mode3d) return;
  // A mouse that is moving with no button down is not dragging, whatever we
  // think we heard: a pointerup swallowed by another element, a drag that
  // ended outside the window, an alt-tab mid-drag. Believe the mouse.
  if (ev.pointerType === "mouse" && ev.buttons === 0 && pts.has(ev.pointerId)){
    endGesture(ev.pointerId);
    return;
  }
  const prev = pts.get(ev.pointerId); if (!prev) return;
  const cur = { x:ev.clientX, y:ev.clientY };
  moved3d += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
  pts.set(ev.pointerId, cur);
  // Hold the pointer once this is plainly a drag, so a release off the window
  // or over another element still reports back. Capturing on the press
  // instead would make every tap land on the canvas, and the pins would stop
  // opening: a captured pointer sends its click to the element holding it.
  if (moved3d > 6 && !stage.hasPointerCapture(ev.pointerId)){
    try { stage.setPointerCapture(ev.pointerId); } catch(e){}
  }
  if (pts.size >= 2){
    // Always the same two fingers, in the same order: taking whichever two the
    // map happens to hold means a third finger landing, or one of three
    // lifting, silently swaps the pair and the distance between them jumps
    // from one frame to the next. That jump went straight into the zoom.
    const ids = [...pts.keys()].sort((x, y) => x - y).slice(0, 2);
    const a = pts.get(ids[0]), b = pts.get(ids[1]);
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x:(a.x + b.x) / 2, y:(a.y + b.y) / 2 };
    if (pinch == null || twoKey !== ids.join()){
      // a new pair: start measuring from here rather than from the old one
      pinch = d; twist = ang; twoMid = mid; twoKey = ids.join();
      pinch0 = d; twist0 = ang; mid0 = mid; gate = 0;
    } else {
      // Zoom always follows the fingers: that is the one thing a pinch is for,
      // and gating it made the map feel dead. Turning needs to be asked for,
      // because nobody spreads two fingers without rolling their hand a few
      // degrees. Tilting is the two fingers travelling together, up or down,
      // which is a different shape of gesture again.
      const spread = Math.abs(Math.log(d / pinch0));
      let turned = ang - twist0;
      while (turned > Math.PI) turned -= 2 * Math.PI;
      while (turned < -Math.PI) turned += 2 * Math.PI;
      const dmid = { x: mid.x - twoMid.x, y: mid.y - twoMid.y };
      const ratio = pinch / d;

      if (spread > 0.1) zoomAt(Math.max(0.7, Math.min(1.45, ratio)), mid.x, mid.y);
      if (Math.abs(turned) > 0.3){                    // about seventeen degrees
        let dt = ang - twist;
        while (dt > Math.PI) dt -= 2 * Math.PI;
        while (dt < -Math.PI) dt += 2 * Math.PI;
        turnBy(-dt, 0);
      }
      // both fingers travelling the same way, and not spreading: a tilt
      if (spread < 0.06 && Math.abs(turned) < 0.25 &&
          Math.abs(mid.y - mid0.y) > 18 && Math.abs(dmid.y) > Math.abs(dmid.x)){
        view.el += dmid.y * 0.0035;
      }
      pinch = d; twist = ang; twoMid = mid;
      camDirty = true;
    }
  } else if (orbiting){
    turnBy(-(cur.x - prev.x) * 0.005, (cur.y - prev.y) * 0.004);
  } else {
    panBy(cur.x - prev.x, cur.y - prev.y, prev.x, prev.y);
  }
  camDirty = true;
}, true);
let tapAt = 0, tapX = 0, tapY = 0, tapCount = 0;
function flyZoom(ratio, sx, sy){
  // the same aim as a pinch, but eased, because a tap has no travel to follow
  const g = groundUnder(sx, sy);
  const to = { lat: view.lat, lon: view.lon, az: view.az, el: view.el,
               dist: Math.max(45, Math.min(40000, view.dist * ratio)) };
  const closed = 1 - to.dist / view.dist;
  if (g && closed > 0){
    let dx = g[0] - toWorldX(view.lon), dz = g[2] - toWorldZ(view.lat);
    const len = Math.hypot(dx, dz), leash = view.dist * 0.5;
    if (len > leash){ dx *= leash / len; dz *= leash / len; }
    to.lon += dx * closed / M_LON;
    to.lat -= dz * closed / KM_LAT_M;
    to.lat = Math.max(TB_S + 0.004, Math.min(TB_N - 0.004, to.lat));
    to.lon = Math.max(TB_W + 0.004, Math.min(TB_E - 0.004, to.lon));
  }
  flyTo(to, 320);
}
["pointerup","pointercancel","lostpointercapture"].forEach(e =>
  stage.addEventListener(e, ev => {
    if (window.mode3d && e === "pointerup" && moved3d < 12){
      const now = performance.now();
      const near = Math.abs(ev.clientX - tapX) < 44 && Math.abs(ev.clientY - tapY) < 44;
      if (pts.size >= 2){
        // two fingers tapped together: back out one step
        if (!tapCount){ tapCount = 1; setTimeout(() => { tapCount = 0; }, 60); flyZoom(1.9, innerWidth / 2, innerHeight / 2); }
      } else if (now - tapAt < 320 && near){
        flyZoom(0.5, ev.clientX, ev.clientY);        // double tap: one step in
        tapAt = 0;
      } else {
        tapAt = now; tapX = ev.clientX; tapY = ev.clientY;
      }
    }
    endGesture(ev.pointerId);
  }, true));
// and if the page loses the plot entirely, drop every pointer we are holding
addEventListener("blur", () => endGesture(null));
document.addEventListener("visibilitychange", () => { if (document.hidden) endGesture(null); });
// a drag that began on a pin must not also open that pin when it ends
stage.addEventListener("click", ev => {
  if (window.mode3d && moved3d > 8){ ev.preventDefault(); ev.stopPropagation(); moved3d = 0; }
}, true);
stage.addEventListener("wheel", ev => {
  if (!window.mode3d) return;
  ev.preventDefault(); ev.stopPropagation();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  // sideways on a trackpad turns the island; that is the desktop twist
  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)){
    orbitBy(ev.deltaX * unit * 0.004, 0);
    return;
  }
  if (ev.shiftKey){ orbitBy(ev.deltaY * unit * 0.004, 0); return; }
  zoomAt(Math.exp(ev.deltaY * unit * 0.0016), ev.clientX, ev.clientY);
}, { passive:false, capture:true });

// Safari hands trackpad and touch rotation over directly, which is the
// gesture people actually reach for on a Mac
let gStart = 0;
addEventListener("gesturestart", ev => {
  if (!window.mode3d) return;
  ev.preventDefault(); gStart = view.az;
}, { passive:false });
addEventListener("gesturechange", ev => {
  if (!window.mode3d) return;
  ev.preventDefault();
  view.az = gStart - (ev.rotation || 0) * Math.PI / 180;
  if (ev.scale) zoomAt(1 / Math.max(0.5, Math.min(2, ev.scale)), innerWidth / 2, innerHeight / 2);
  camDirty = true;
}, { passive:false });

// the arrow keys move you about, which is the one control everybody tries
addEventListener("keydown", ev => {
  if (!window.mode3d) return;
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
  const step = 90;
  const k = { ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[ev.key];
  if (k){
    ev.preventDefault();
    if (ev.shiftKey) orbitBy(k[0] * 0.004, k[1] * 0.003);
    else panBy(-k[0], -k[1], innerWidth / 2, innerHeight / 2);
  }
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
  view.lat = C_LAT; view.lon = C_LON; view.az = 0.35;
  view.el = innerWidth < 900 ? 0.44 : 0.26;
  view.dist = 11000 * frameScale();
  camDirty = true; draw();
}, true);

/* ---------- switching between the two settings ---------- */
// The 2D view is a plan at a known scale, so the tilt can start from the same
// ground the map was showing rather than jumping somewhere else.
function metresAcross(){ return innerWidth / cam.zoom / IMG_W * (TB_E - TB_W) * M_LON; }
// The field of view is vertical, so a tall narrow screen sees far less ground
// across than a wide one at the same distance. Without this the island arrives
// wider than the phone and half of it is off the sides.
function frameScale(){
  const a = innerWidth / Math.max(1, innerHeight);
  return a < 1.35 ? 1.35 / a : 1;
}
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
    view.dist = Math.max(150, metresAcross() * 1.15 * frameScale());
    // looking down more on a phone: at a shallow angle the island is all horizon
    if (innerWidth < 900) view.el = Math.max(view.el, 0.44);
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
hint.textContent = "Drag to move \u00b7 pinch or double-tap to zoom \u00b7 twist two fingers to turn";
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

// Opening a place while the island is tilted flies you out to the water and
// looks back at it. The re-renders that pass fly=false (favouriting, a
// submission being approved) leave the camera where it is.
const openBefore = window.openPlace;
window.openPlace = function(id, fly){
  const r = openBefore.apply(this, arguments);
  if (window.mode3d && fly !== false){
    // PLACES is a script-level const, so it is not a property of window
    const list = typeof PLACES !== "undefined" ? PLACES : [];
    const p = list.find(q => q.id === id);
    if (p && p.ll){
      const m = MODELS[p.id];
      window.flyTo3D(p.ll[0], p.ll[1], arrivalDist(p.id), 0.42, m && m.face);
    }
  }
  return r;
};

document.getElementById("d3Btn").onclick = () => setMode3D(!window.mode3d);
addEventListener("keydown", e => {
  if (e.key === "3" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || ""))
    setMode3D(!window.mode3d);
});
})();
