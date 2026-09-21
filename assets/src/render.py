"""Render a seekable scene to PNG frames, or a static page to one PNG.

usage: render.py frames <scene.html> <out_dir> <width> <height> <fps> [t1,t2,...]
       render.py still  <page.html>  <out.png> <width> <height> <scale>
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

mode, src, out, width, height = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
url = pathlib.Path(src).resolve().as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch()
    scale = float(sys.argv[6]) if mode == "still" else 2
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=scale)
    page.goto(url)
    page.evaluate("document.fonts.ready")
    if mode == "still":
        page.screenshot(path=out)
    else:
        fps = int(sys.argv[6])
        page.wait_for_function("window.READY === true")
        duration = page.evaluate("DURATION")
        out_dir = pathlib.Path(out)
        out_dir.mkdir(parents=True, exist_ok=True)
        if len(sys.argv) > 7:
            for t in [float(x) for x in sys.argv[7].split(",")]:
                page.evaluate(f"seek({t})")
                page.screenshot(path=str(out_dir / f"t_{t:05.2f}.png"))
        else:
            for old in out_dir.glob("f_*.png"):
                old.unlink()
            total = int(duration * fps)
            for i in range(total):
                page.evaluate(f"seek({i / fps})")
                page.screenshot(path=str(out_dir / f"f_{i:04d}.png"))
            print(total, "frames")
    browser.close()
