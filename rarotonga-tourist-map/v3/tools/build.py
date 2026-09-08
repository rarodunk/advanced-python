import pathlib, base64
v2 = pathlib.Path("/home/user/advanced-python/rarotonga-tourist-map/v2/index.html").read_text()
BANNER = "/* =========================================================================\n"
# slice by section banners, so edits to v2 elsewhere never shift the cut points
head = v2[:v2.index(BANNER + "   THE RENDERER")]
tail = v2[v2.index(BANNER + "   TIME, TRAVEL, FILTERS"):]
W, H = '2360', '1495'
head = head.replace('#gl{display:block;width:100%;height:100%}',
 '#world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;width:' + W + 'px;height:' + H + 'px}\n#world img{display:block;max-width:none!important;max-height:none!important;width:2360px;height:1595px;pointer-events:none;user-select:none;-webkit-user-drag:none;-webkit-mask-image:linear-gradient(#0000,#000 3%,#000 96%,#0000);mask-image:linear-gradient(#0000,#000 3%,#000 96%,#0000)}\n.mk.tiny.small .dot{width:13px;height:13px;border-width:1.5px}\n.mk.tiny .dot span{display:none}\n.mk.tiny .cap{display:none}\n#world svg{position:absolute;left:0;top:0;pointer-events:none}')
head = head.replace("background:linear-gradient(#5aa4dc 0%,#1e5f98 40%,#0f4a7a 60%,#0a3556 100%)",
                    "background:linear-gradient(#315c8e 0%,#315c8e 40%,#192733 62%,#192733 100%)")
assert "#5aa4dc" not in head
head = head.replace('  <canvas id="gl"></canvas>\n', '  <div id="world"><img id="island" alt="Rarotonga, painted from the south-west"></div>\n')
head = head.replace('<b>Rarotonga</b><small>Building the island</small>', '<b>Rarotonga</b><small>Loading the island</small>')
head = head.replace('  <button class="iconbtn" id="tiltBtn" title="Flatten to overhead"><span class="lbl">2D</span></button>\n', '')
assert '#world' in head and 'id="island"' in head and 'tiltBtn' not in head
mid = pathlib.Path("/home/user/advanced-python/rarotonga-tourist-map/v3/tools/map.js").read_text()
tail = tail.replace('''  if (fly){
    const target = { az: Math.atan2(p.world[0], p.world[2]) - 0.3, dist: 520, el: 0.55,
                     tx: p.world[0] * 0.55, tz: p.world[2] * 0.55 };
    animateCam(target, 700);
  }''', '''  if (fly){
    // land the place in the upper part of the screen, clear of the panel
    const z = Math.max(cam.zoom, 0.9), lift = innerWidth < 720 ? (innerHeight * 0.18) / z : 0;
    animateCam({ x: p.img.x, y: p.img.y + lift, zoom: z }, 700);
  }''')
tail = tail.replace('''/* ---------- boot ---------- */
resize();
placeCamera();
requestAnimationFrame(render);''', '''/* ---------- boot ---------- */
resize();
Object.assign(cam, CAM_HOME()); placeCamera();
requestAnimationFrame(render);
island.decode().catch(() => {}).then(() => document.getElementById("loading").classList.add("gone"));''')
tail = tail.replace('setTimeout(() => document.getElementById("loading").classList.add("gone"), 420);\n', '')
assert 'p.img.x' in tail and 'CAM_HOME()' in tail
for bad in ["tiltBtn", "p.world", "drawScene", "viewProj"]: assert bad not in tail, bad
jpg = base64.b64encode(pathlib.Path("/home/user/advanced-python/rarotonga-tourist-map/v3/island.jpg").read_bytes()).decode()
out = head + "\n" + 'const ISLAND_JPG = "data:image/jpeg;base64,' + jpg + '";\n' + mid + "\n" + tail
pathlib.Path("/home/user/advanced-python/rarotonga-tourist-map/v3/index.html").write_text(out)
print(len(out) // 1024, "KB", out.count("\n"), "lines")
