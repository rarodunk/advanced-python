import pathlib, base64
# Paths are derived from this file, so the tree works wherever it is cloned.
HERE = pathlib.Path(__file__).resolve().parent      # <version>/tools
VER  = HERE.parent                                  # <version>
ROOT = VER.parent                                   # rarotonga-tourist-map
import json
V4 = VER
meta = json.loads((V4 / "imagery.json").read_text())
v2 = (ROOT / "v2" / "index.html").read_text()
BANNER = "/* =========================================================================\n"
# slice by section banners, so edits to v2 elsewhere never shift the cut points
head = v2[:v2.index(BANNER + "   THE RENDERER")]
tail = v2[v2.index(BANNER + "   TIME, TRAVEL, FILTERS"):]
W, H = str(meta['width']), str(meta['height'])
head = head.replace('#gl{display:block;width:100%;height:100%}',
 '#world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;width:' + W + 'px;height:' + H + 'px}\n#world img{display:block;max-width:none!important;max-height:none!important;width:' + str(meta['width']) + 'px;height:' + str(meta['height']) + 'px;pointer-events:none;user-select:none;-webkit-user-drag:none;-webkit-mask-image:linear-gradient(#0000,#000 5%,#000 94%,#0000);mask-image:linear-gradient(#0000,#000 5%,#000 94%,#0000)}\n.mk.tiny.small .dot{width:13px;height:13px;border-width:1.5px}\n.mk.tiny .dot span{display:none}\n.mk.tiny .cap{display:none}\n#world svg{position:absolute;left:0;top:0;pointer-events:none}')
EDGE = meta.get('edge') or {}
TOP, BOT = EDGE.get('top', '#082748'), EDGE.get('bottom', '#082748')
head = head.replace("background:linear-gradient(#5aa4dc 0%,#1e5f98 40%,#0f4a7a 60%,#0a3556 100%)",
                    "background:linear-gradient(" + TOP + " 0%," + TOP + " 38%," + BOT + " 62%," + BOT + " 100%)")
assert "#5aa4dc" not in head
head = head.replace('  <canvas id="gl"></canvas>\n', '  <div id="world"><img id="island" alt="Rarotonga, painted from the south-west"></div>\n')
head = head.replace('<b>Rarotonga</b><small>Building the island</small>', '<b>Rarotonga</b><small>Loading the island</small>')
# the 3D tilt has no meaning on a north-up photo; the slot becomes "adjust pins"
head = head.replace('<button class="iconbtn" id="tiltBtn" title="Flatten to overhead"><span class="lbl">2D</span></button>',
                    '<button class="iconbtn" id="editBtn" title="Adjust pins (press e)">\u2725</button>')
head = head.replace('#world svg{', '''#fixPanel{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:60;
  width:min(350px,calc(100vw - 28px));background:#101d2b;border:1px solid #24384c;border-radius:14px;
  padding:14px 15px;color:#eaf4f5;font-size:12.5px;line-height:1.5;box-shadow:0 18px 50px rgba(0,0,0,.5)}
#fixPanel b{display:block;font-size:13.5px;margin-bottom:5px}
#fixPanel p{margin:0 0 9px;color:#9fb8c2}
#fixPanel p.muted{font-style:italic}
#fixPanel code{background:#08131d;padding:1px 5px;border-radius:4px}
#fixPanel pre{margin:0 0 10px;padding:9px 10px;background:#08131d;border-radius:9px;overflow:auto;
  max-height:190px;font-size:11.5px;color:#bfe4d8;white-space:pre;-webkit-overflow-scrolling:touch}
#fixPanel .fixbtns{display:flex;gap:7px;margin-top:7px}
#fixPanel button{flex:1;padding:8px;border-radius:9px;background:#1d3247;color:#eaf4f5;
  font:inherit;font-weight:600;border:0;cursor:pointer}
#fixPanel button:hover{background:#26415c}
body.editing .mk{cursor:grab}
body.editing .mk:active{cursor:grabbing}
body.editing .mk .dot{box-shadow:0 0 0 3px rgba(255,210,90,.75)}
#world svg{''')
assert "editBtn" in head and "fixPanel" in head
head = head.replace('<div class="modal" id="modal">', '<div class="credit" id="credit"></div>\n<div class="modal" id="modal">')
head = head.replace('#world svg{', '.credit{position:fixed;left:8px;bottom:calc(6px + env(safe-area-inset-bottom));z-index:6;font-size:10px;color:#cfd8e3;background:rgba(6,20,36,.55);padding:3px 7px;border-radius:6px;pointer-events:none;max-width:70vw}\n#world svg{')
assert '#world' in head and 'id="island"' in head and 'tiltBtn' not in head
mid = (HERE / "map.js").read_text()
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
island.decode().catch(() => {}).then(() => document.getElementById("loading").classList.add("gone"));\ndocument.getElementById("credit").textContent = IMAGERY.attribution || "";''')
tail = tail.replace('setTimeout(() => document.getElementById("loading").classList.add("gone"), 420);\n', '')
assert 'p.img.x' in tail and 'CAM_HOME()' in tail
for bad in ["tiltBtn", "p.world", "drawScene", "viewProj"]: assert bad not in tail, bad
jpg = base64.b64encode((V4 / "imagery.jpg").read_bytes()).decode()
out = head + "\n" + 'const ISLAND_JPG = "data:image/jpeg;base64,' + jpg + '";\nconst IMAGERY = ' + json.dumps(meta) + ';\n' + mid + "\n" + tail
(VER / "index.html").write_text(out)
print(len(out) // 1024, "KB", out.count("\n"), "lines")
