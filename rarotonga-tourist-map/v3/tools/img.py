# Canvas-based image ops through headless Chromium (no PIL/numpy here).
import sys, json, base64, pathlib
from playwright.sync_api import sync_playwright
def run(js, src="src.png", out=None):
    data = base64.b64encode(pathlib.Path(src).read_bytes()).decode()
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        pg = b.new_page()
        pg.set_content("<canvas id=c></canvas>")
        res = pg.evaluate("""async ([data, js]) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
          const c = document.getElementById('c'); c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
          const fn = new Function('img','c','ctx', js); return await fn(img, c, ctx);
        }""", [data, js])
        b.close()
    if out and isinstance(res, str) and res.startswith("data:"):
        pathlib.Path(out).write_bytes(base64.b64decode(res.split(",",1)[1])); return out
    return res
if __name__ == "__main__":
    print(run(pathlib.Path(sys.argv[1]).read_text(), sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
