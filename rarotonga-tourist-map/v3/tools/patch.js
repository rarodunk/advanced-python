const W = c.width, H = c.height;
const id = ctx.getImageData(0, 0, W, H), d = id.data;
const px = (x, y) => { x = Math.max(0, Math.min(W-1, x)); y = Math.max(0, Math.min(H-1, y)); const i = (y * W + x) * 4; return [d[i], d[i+1], d[i+2]]; };
// Diffusion inpaint: solve Laplace's equation inside the box with the pixels
// just outside it as the boundary, at quarter resolution, then upsample. Gives
// a smooth 2D fill with no directional streaks.
function diffuse(x0, y0, x1, y1){
  const f = 4, w = x1 - x0, h = y1 - y0, bw = Math.ceil(w / f) + 2, bh = Math.ceil(h / f) + 2;
  const g = new Float32Array(bw * bh * 3), fixed = new Uint8Array(bw * bh);
  let ar = 0, ag = 0, ab = 0, an = 0;
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++){
    const border = i === 0 || j === 0 || i === bw - 1 || j === bh - 1;
    if (!border) continue;
    const sx = i === 0 ? x0 - 4 : i === bw - 1 ? x1 + 4 : x0 + (i - 1) * f + f / 2;
    const sy = j === 0 ? y0 - 4 : j === bh - 1 ? y1 + 4 : y0 + (j - 1) * f + f / 2;
    const p = px(Math.round(sx), Math.round(sy)), k = (j * bw + i) * 3;
    g[k] = p[0]; g[k+1] = p[1]; g[k+2] = p[2]; fixed[j * bw + i] = 1; ar += p[0]; ag += p[1]; ab += p[2]; an++;
  }
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++){ const k = (j * bw + i) * 3; if (!fixed[j * bw + i]){ g[k] = ar/an; g[k+1] = ag/an; g[k+2] = ab/an; } }
  const iters = Math.min(6000, 8 * (bw + bh) * 4), om = 1.85;
  for (let it = 0; it < iters; it++) for (let j = 1; j < bh - 1; j++) for (let i = 1; i < bw - 1; i++){
    const k = (j * bw + i) * 3;
    for (let ch = 0; ch < 3; ch++){ const v = 0.25 * (g[k - 3 + ch] + g[k + 3 + ch] + g[k - bw * 3 + ch] + g[k + bw * 3 + ch]); g[k + ch] += om * (v - g[k + ch]); }
  }
  const t = document.createElement('canvas'); t.width = bw; t.height = bh;
  const tc = t.getContext('2d'), tid = tc.createImageData(bw, bh);
  for (let n = 0; n < bw * bh; n++){ tid.data[n*4] = g[n*3]; tid.data[n*4+1] = g[n*3+1]; tid.data[n*4+2] = g[n*3+2]; tid.data[n*4+3] = 255; }
  tc.putImageData(tid, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(t, 1, 1, bw - 2, bh - 2, x0, y0, w, h);
}
// Feathered rectangular clone: full cover inside, fading only over the last few pixels.
function cloneRect(x0, y0, x1, y1, sx, sy, fe = 10){
  const w = x1 - x0, h = y1 - y0, t = document.createElement('canvas'); t.width = w; t.height = h;
  const g = t.getContext('2d'); g.drawImage(c, sx, sy, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  for (const [gx0, gy0, gx1, gy1] of [[0,0,w,0],[w,0,0,0],[0,0,0,h],[0,h,0,0]]){}
  // build mask via four linear gradients multiplied together
  const m = document.createElement('canvas'); m.width = w; m.height = h; const mc = m.getContext('2d');
  mc.fillStyle = '#000'; mc.fillRect(0, 0, w, h); mc.globalCompositeOperation = 'destination-in';
  const grads = [[0,0,fe,0],[w,0,w-fe,0],[0,0,0,fe],[0,h,0,h-fe]];
  for (const [ax, ay, bx, by] of grads){ const lg = mc.createLinearGradient(ax, ay, bx, by); lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,1)'); mc.fillStyle = lg; mc.fillRect(0, 0, w, h); }
  g.drawImage(m, 0, 0); ctx.drawImage(t, x0, y0);
}
function grain(x0, y0, x1, y1, sx, sy, a){
  ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'overlay';
  for (let y = y0; y < y1; y += 120) for (let x = x0; x < x1; x += 120) ctx.drawImage(c, sx, sy, 120, 120, x, y, Math.min(120, x1 - x), Math.min(120, y1 - y));
  ctx.restore();
}
// chrome over sky and sea (order matters: later fills read earlier results)
diffuse(585, 1125, 810, 1210);     // Black Rock label + arrow
diffuse(10, 5, 540, 370);          // logo + close
diffuse(790, 45, 1565, 150);       // search bar
diffuse(1685, 45, 2235, 150);      // favourites, plan my trip
diffuse(1135, 5, 1215, 42);        // dots
diffuse(1955, 5, 2355, 110);       // icons, share
// Wigmore's inset: real sea from the strip between it and the card, before the card is filled
cloneRect(1556, 380, 1652, 610, 1754, 380, 12); cloneRect(1650, 380, 1746, 610, 1754, 380, 12);
diffuse(1860, 160, 2355, 258);     // business card: sky
// the horizon strip varies top to bottom, not left to right: each row takes
// the colour just left of the card
{ const sx0 = 1856, sw = W - sx0, strip = ctx.getImageData(sx0, 258, sw, 39), sd = strip.data;
  for (let y = 0; y < 39; y++){ let r=0,g=0,bb=0,n=0; for (let x = 548; x < 560; x++){ const q = px(x, 258 + y); r+=q[0]; g+=q[1]; bb+=q[2]; n++; }
    for (let x = 0; x < sw; x++){ const i = (y * sw + x) * 4; sd[i] = r/n; sd[i+1] = g/n; sd[i+2] = bb/n; } }
  ctx.putImageData(strip, sx0, 258); }
diffuse(1860, 297, 2355, 880);     // business card: sea
diffuse(15, 395, 290, 1055);       // category rail
diffuse(10, 1325, 550, 1585);      // minimap + Edit
diffuse(825, 1410, 955, 1580);     // Comment
diffuse(1405, 1410, 1530, 1580);   // Resize
diffuse(1975, 1410, 2110, 1580);   // Remove
diffuse(2195, 1165, 2355, 1580);   // compass, plus, minus
// Black Rock inset: clone along the reef arc so the surf line carries through
cloneRect(660, 1220, 900, 1460, 430, 1030, 16);
// Wigmore's inset handled below by clone (coast behind it)
diffuse(1000, 160, 1190, 250);     // Te Manga label
diffuse(1215, 250, 1365, 335);     // Raemaru label
diffuse(1590, 315, 1780, 405);     // Wigmore's label

function noise(x0, y0, x1, y1, amp){
  const im = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), q = im.data;
  for (let i = 0; i < q.length; i += 4){ const n = (Math.random() - 0.5) * amp; q[i] += n; q[i+1] += n; q[i+2] += n; }
  ctx.putImageData(im, x0, y0);
}
noise(15, 395, 290, 1055, 10); noise(10, 1325, 550, 1585, 10); noise(1860, 290, 2355, 880, 10); noise(2195, 1165, 2355, 1580, 10); 
// pins and labels over land: covered by neighbouring texture
cloneRect(472, 632, 552, 732, 560, 632);     // purple bed, Arorangi
cloneRect(518, 848, 606, 956, 612, 848);     // orange fork, Arorangi
cloneRect(998, 1040, 1092, 1165, 1100, 1040); // yellow car + tail
cloneRect(1018, 1150, 1128, 1300, 1132, 1150); // blue snorkel + tail
cloneRect(1500, 1030, 1590, 1145, 1500, 1150); // pink bag (source: beach below)
cloneRect(1688, 918, 1777, 1037, 1590, 918);   // green palm, Muri
cloneRect(1843, 1183, 1937, 1297, 1740, 1183); // green palm, south-east
cloneRect(1513, 803, 1597, 902, 1420, 803);    // blue camera
cloneRect(1636, 686, 1729, 789, 1636, 580);    // purple bed, Muri (source: above)
cloneRect(1693, 743, 1782, 847, 1790, 743);    // orange fork, Muri
cloneRect(468, 458, 578, 528, 468, 540);       // Avatiu label
cloneRect(448, 718, 608, 798, 612, 718);       // Arorangi label
cloneRect(1255, 1005, 1490, 1095, 1255, 900);  // Titikaveka label
cloneRect(1526, 700, 1656, 775, 1660, 700);    // Muri label (lagoon from the right)
const out = document.createElement('canvas'); out.width = W; out.height = 1595;
out.getContext('2d').drawImage(c, 0, 0);
return out.toDataURL('image/jpeg', 0.86);
