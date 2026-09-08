// Draws a north-up Web Mercator stand-in for the satellite mosaic, from the
// island model, so v4 can be built and tested before real imagery exists.
// Run through tools/img.py with any source image; the canvas is replaced.
const W = 2400, H = 2000;
const BB = [-159.870, -21.300, -159.705, -21.170];             // west, south, east, north (same margin as fetch_imagery.py)
c.width = W; c.height = H;
const mercX = lon => (lon + 180) / 360;
const mercY = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2;
const MX0 = mercX(BB[0]), MX1 = mercX(BB[2]), MY0 = mercY(BB[3]), MY1 = mercY(BB[1]);
const toPx = (lat, lon) => [(mercX(lon) - MX0) / (MX1 - MX0) * W, (mercY(lat) - MY0) / (MY1 - MY0) * H];
// the fitted island model, in real kilometres
const C = { lat:-21.242, lon:-159.780, a:5.2, b:4.3 };
const KM_LAT = 110.57, KM_LON = 111.32 * Math.cos(C.lat * Math.PI / 180);
const bump = (deg, c0, w, a) => { let d = ((deg - c0 + 540) % 360) - 180; return a * Math.exp(-(d*d)/(2*w*w)); };
const coastKm = deg => { const t = deg * Math.PI / 180, ell = C.a * C.b / Math.hypot(C.b * Math.sin(t), C.a * Math.cos(t));
  return ell * (1 + (bump(deg,313,8,14) - bump(deg,103,10,26) - bump(deg,126,16,13) + bump(deg,236,20,8) - bump(deg,352,24,10)) / 262); };
const lagoonKm = deg => (14 + bump(deg,120,26,52) + bump(deg,182,34,34) + bump(deg,236,24,17) + bump(deg,60,20,9)) / 56.2;
const ring = (kmFn) => { ctx.beginPath(); for (let deg = 0; deg <= 360; deg += 1){ const km = kmFn(deg), t = deg * Math.PI / 180;
  const [x, y] = toPx(C.lat + km * Math.cos(t) / KM_LAT, C.lon + km * Math.sin(t) / KM_LON); deg ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); };
const g = ctx.createRadialGradient(W/2, H/2, 300, W/2, H/2, 1500); g.addColorStop(0, '#0d3f6e'); g.addColorStop(1, '#061e3a');
ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
ring(d => coastKm(d) + lagoonKm(d) + 0.08); ctx.fillStyle = '#d9e9ee'; ctx.fill();           // reef surf
ring(d => coastKm(d) + lagoonKm(d)); ctx.fillStyle = '#3fbfc9'; ctx.fill();                  // lagoon
ring(d => coastKm(d) + 0.05); ctx.fillStyle = '#e8dcb0'; ctx.fill();                         // beach
ring(coastKm); ctx.fillStyle = '#3f7a3a'; ctx.fill();                                        // land
ring(d => coastKm(d) * 0.72); ctx.fillStyle = '#2d5e2c'; ctx.fill();                         // interior
ring(d => coastKm(d) - 0.12); ctx.strokeStyle = '#d8d3c2'; ctx.lineWidth = 3; ctx.stroke(); // Ara Tapu
ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
ctx.fillText('STAND-IN BASE  ·  run tools/fetch_imagery.py for satellite imagery', W/2, 90);
return JSON.stringify({ png: c.toDataURL('image/jpeg', 0.8), bbox: BB, width: W, height: H });
