import os, pathlib, base64
# Paths are derived from this file, so the tree works wherever it is cloned.
HERE = pathlib.Path(__file__).resolve().parent      # <version>/tools
VER  = HERE.parent                                  # <version>
ROOT = VER.parent                                   # rarotonga-tourist-map
import json, sys
V4 = VER

def read_meta():
    """imagery.json, with a readable failure. It is written by the fetch and by
    the stand-in, and it is the one file a bad merge can leave with conflict
    markers in it, which json will not explain."""
    path = V4 / "imagery.json"
    if not path.exists():
        sys.exit("v4/imagery.json is missing. Run tools/fetch_imagery.py, or "
                 "v4/tools/standin.py for the offline base.")
    text = path.read_text()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        if "<<<<<<<" in text or ">>>>>>>" in text:
            sys.exit("v4/imagery.json still has merge conflict markers in it.\n"
                     "  git checkout -- v4/imagery.json v4/imagery.jpg v4/terrain.png\n"
                     "then re-run tools/fetch_terrain.py and tools/fetch_imagery.py.")
        sys.exit(f"v4/imagery.json is not valid JSON ({e}).\n"
                 "Re-run tools/fetch_imagery.py to rewrite it.")

meta = read_meta()
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
                    '<button class="iconbtn" id="d3Btn" title="3D setting (press 3)" disabled><span class="lbl">3D</span></button>\n'
                    '  <button class="iconbtn" id="editBtn" title="Adjust pins (press e)">\u2725</button>')
head = head.replace('#world svg{', '''#closeupPanel{position:fixed;left:16px;top:104px;z-index:60;
  width:min(330px,calc(100vw - 32px));background:#101d2b;border:1px solid #24384c;border-radius:14px;
  padding:13px 15px;color:#eaf4f5;font-size:12.5px;line-height:1.5;box-shadow:0 18px 50px rgba(0,0,0,.5)}
#closeupPanel b{display:block;font-size:13.5px;margin-bottom:5px}
#closeupPanel p{margin:0 0 9px;color:#9fb8c2}
#closeupPanel code{background:#08131d;padding:1px 5px;border-radius:4px}
#closeupPanel pre{margin:0;padding:9px 10px;background:#08131d;border-radius:9px;overflow:auto;
  max-height:200px;font-size:11.5px;color:#bfe4d8;white-space:pre}
body.placing .cats,body.placing .isle{opacity:.25;pointer-events:none}
#fixPanel{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:60;
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
#globe{display:block}
.iconbtn:disabled{opacity:.4;cursor:default}
.iconbtn.on{background:#1d6fd0;color:#fff}
#world svg{''')
assert "editBtn" in head and "fixPanel" in head

# ---------------------------------------------------------------------------
# The chrome from the illustrations: a script wordmark, the categories as a
# left rail rather than a strip of chips, an island card, and a compass that
# turns with the 3D camera. Layout only; nothing here invents content.
head = head.replace(
    'family=Outfit:wght@300;400;500;600;700',
    'family=Kaushan+Script&family=Outfit:wght@300;400;500;600;700')

GALLERY_CSS = """
/* ---------- the wordmark ---------- */
.logo{background:none;border:0;backdrop-filter:none;padding:2px 0 0;display:block}
.logo .mark{display:none}
.logo b{font-family:"Kaushan Script","Snell Roundhand","Brush Script MT",cursive;font-size:clamp(26px,3.4vw,38px);
  font-weight:400;line-height:1;letter-spacing:0;display:block;
  text-shadow:0 3px 18px rgba(0,0,0,.55)}
.logo small{letter-spacing:.30em;font-size:9px;margin-top:5px;color:#c9e3f0;
  text-shadow:0 1px 8px rgba(0,0,0,.6)}
.bar{max-width:1240px;align-items:flex-start}
.searchbox{margin-top:4px}

/* ---------- categories down the left ---------- */
.cats{position:fixed;left:16px;top:104px;z-index:20;flex-direction:column;align-items:stretch;
  width:184px;max-width:none;margin:0;padding:0;gap:9px;overflow:visible}
.cat{width:100%;justify-content:flex-start;gap:11px;padding:8px 14px 8px 8px;border-radius:16px;
  background:rgba(8,22,36,.74);font-size:14px;box-shadow:0 10px 26px rgba(0,0,0,.28)}
.cat i{width:30px;height:30px;border-radius:11px;font-size:14px}
.cat .n{margin-left:auto}
.cat.on{background:#fff;color:#08202c}

/* ---------- the island card ---------- */
.isle{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:20;
  display:flex;align-items:center;gap:14px;padding:11px 18px 11px 11px;border-radius:20px;
  background:rgba(8,22,36,.78);backdrop-filter:blur(14px);border:1px solid var(--line);
  box-shadow:0 16px 40px rgba(0,0,0,.42)}
.isle .thumb{width:96px;height:64px;border-radius:14px;background:#0b2740 center/170% no-repeat;
  flex:0 0 auto;border:1px solid rgba(255,255,255,.14)}
.isle .who b{display:block;font-size:15px;font-weight:600;line-height:1.1}
.isle .who small{display:block;font-size:11.5px;color:var(--ink-3);margin-top:3px}
.isle .stats{display:flex;gap:16px;padding-left:16px;border-left:1px solid var(--line)}
.isle .stats span{display:block;font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-3);font-weight:700}
.isle .stats b{display:block;font-size:16px;font-weight:600;margin-top:2px}
.isle.hide{display:none}

/* ---------- pins, the way a map app draws them ---------- */
.mk .dot{
  width:38px;height:38px;border:0;border-radius:50% 50% 50% 50% / 58% 58% 42% 42%;
  transform:none;box-shadow:0 6px 16px rgba(0,0,0,.42);position:relative;
}
.mk .dot::after{
  content:"";position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);
  border-left:8px solid transparent;border-right:8px solid transparent;
  border-top:11px solid currentColor;
}
.mk .dot span{transform:none;font-size:17px;filter:grayscale(1) brightness(3)}
.mk:hover .dot,.mk.sel .dot{transform:scale(1.12)}
.mk .cap{
  background:none;border:0;backdrop-filter:none;padding:2px 0 0;
  font-size:13px;font-weight:600;color:#fff;letter-spacing:.01em;
  text-shadow:0 1px 3px rgba(0,0,0,.75),0 0 12px rgba(0,0,0,.35);
}
.mk.small .dot{width:26px;height:26px}
.mk.small .dot::after{bottom:-4px;border-left-width:5px;border-right-width:5px;border-top-width:8px}
.mk.small .dot span{font-size:12px}
.mk.tiny .dot{width:15px;height:15px}
.mk.tiny .dot::after{display:none}

/* ---------- the district strip ---------- */
#districts{
  position:fixed;left:50%;transform:translateX(-50%);z-index:20;
  bottom:calc(18px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:6px;
  padding:8px 10px;border-radius:999px;background:rgba(8,22,36,.82);backdrop-filter:blur(14px);
  border:1px solid var(--line);box-shadow:0 16px 40px rgba(0,0,0,.42)
}
#districts .arw{width:34px;height:34px;border-radius:50%;font-size:19px;line-height:1;color:var(--ink-2)}
#districts .arw:hover{background:var(--panel-2);color:#fff}
#districts .mid{min-width:150px;text-align:center;cursor:pointer}
#districts b{display:block;font-size:15px;font-weight:600}
#districts .dots{display:flex;gap:5px;justify-content:center;margin-top:5px}
#districts .dots i{width:5px;height:5px;border-radius:50%;background:var(--panel-3)}
#districts .dots i.on{background:var(--good)}
@media (max-width:860px){ #districts{bottom:calc(86px + env(safe-area-inset-bottom))} }

/* ---------- compass ---------- */
#compass svg{width:22px;height:22px;transition:transform .18s ease-out}
.credit{left:16px;bottom:calc(122px + env(safe-area-inset-bottom));max-width:52vw}

@media (max-width:860px){
  .cats{position:static;flex-direction:row;width:auto;overflow-x:auto;padding:12px 2px 4px}
  .cat{width:auto}
  .isle .stats{display:none}
  .isle .thumb{width:64px;height:44px}
  .credit{bottom:calc(88px + env(safe-area-inset-bottom))}
}
"""
head = head.replace("</style>", GALLERY_CSS + "\n</style>", 1)

head = head.replace('<div class="rail" id="rail">',
  '''<div class="isle" id="isle">
  <div class="thumb" id="isleThumb"></div>
  <div class="who"><b>Rarotonga</b><small>Cook Islands</small></div>
  <div class="stats">
    <div><span>Circumference</span><b>32 km</b></div>
    <div><span>Area</span><b>67 km&sup2;</b></div>
  </div>
</div>

<div class="rail" id="rail">
  <button class="iconbtn" id="compass" title="Face north">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 15 13 12 11 9 13Z" fill="#ff5f5f"></path>
      <path d="M12 21 9 11 12 13 15 11Z" fill="#e9f2f6"></path>
    </svg>
  </button>''')
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
terr = base64.b64encode((VER / "terrain.png").read_bytes()).decode()

# Close-ups: one small painting per place, each registered to the patch of
# coastline it depicts. Embedded like everything else, because the page has to
# work as a single file; the build says how much they cost.
# Embedding keeps the page a single file, which is what an artifact needs and
# what makes it work from a Downloads folder. A folder-served copy (Netlify,
# your own hosting) is better off linking them: the browser caches each image
# and the first paint is not carrying seventy of them.
LINK_ASSETS = os.environ.get("RARO_LINK_ASSETS") == "1"
closeups, cu_bytes = {}, 0
cu_manifest = VER / "closeups.json"
if cu_manifest.exists():
    for pid, rec in json.loads(cu_manifest.read_text()).items():
        f = VER / "closeups" / rec["file"]
        if not f.exists():
            print(f"  closeup for {pid}: {f.name} is missing, skipped")
            continue
        raw = f.read_bytes()
        cu_bytes += len(raw)
        mime = {".png": "image/png", ".webp": "image/webp"}.get(f.suffix.lower(), "image/jpeg")
        src = ("closeups/" + rec["file"]) if LINK_ASSETS else \
              ("data:" + mime + ";base64," + base64.b64encode(raw).decode())
        closeups[pid] = { "file": rec["file"], "bbox": rec.get("bbox"),
                          "rot": rec.get("rot", 0), "src": src }
    if closeups:
        how = "linked" if LINK_ASSETS else "embedded"
        print(f"  {len(closeups)} close-ups {how} ({cu_bytes / 1e6:.1f} MB before encoding)")
        if not LINK_ASSETS and cu_bytes * 4 / 3 > 9e6:
            print("  that is a heavy page for a phone; set RARO_LINK_ASSETS=1 to serve\n"
                  "  them as files instead (tools/make_site.py copies them into dist/)")
CLOSEUPS_JS = (pathlib.Path(HERE / "closeups.js").read_text())
TOUR_JS = (pathlib.Path(HERE / "tour.js").read_text())

# The massing models the 3D setting stands on the ground up close.
models = {}
if (VER / "models.json").exists():
    models = json.loads((VER / "models.json").read_text())
    print(f"  {len(models)} buildings")
globe = (HERE / "globe.js").read_text()
# The 3D setting goes in last, wrapped, and after the rest of the page has
# already run. A WebGL driver that refuses a shader must cost you the 3D
# button, not the whole guide: before this, a throw here left the page sitting
# on its loading curtain forever.
GLOBE = """
try {
""" + globe + """
} catch (err) {
  const why = (err && err.message) || String(err);
  console.error("the 3D setting failed to start:", err);
  const btn = document.getElementById("d3Btn");
  if (btn){ btn.disabled = true; btn.title = "3D unavailable: " + why; }
  const credit = document.getElementById("credit");
  if (credit) credit.textContent = (credit.textContent || "") + "  \u00b7  3D unavailable: " + why;
}
"""

out = (head + "\n"
       + 'const ISLAND_JPG = "data:image/jpeg;base64,' + jpg + '";\n'
       + 'const TERRAIN_PNG = "data:image/png;base64,' + terr + '";\n'
       + 'const IMAGERY = ' + json.dumps(meta) + ';\n'
       + 'const TERRAIN = IMAGERY.terrain;\n'
       + 'const CLOSEUP_ART = ' + json.dumps(closeups) + ';\n'
       + 'const BUILDINGS = ' + json.dumps(models) + ';\n'
       + mid + "\n" + tail          # tail closes the page's <script>
       + "\n<script>\n" + CLOSEUPS_JS + "\n</script>\n"
       + "\n<script>\n" + TOUR_JS + "\n</script>\n"
       + "\n<script>\n" + GLOBE + "\n</script>\n")
(VER / "index.html").write_text('<meta charset="utf-8">\n' + out)
print(len(out) // 1024, "KB", out.count("\n"), "lines")
