#!/usr/bin/env python3
"""Rebuild every generated page from its inputs.

    python3 build_all.py

Run it after a `git pull`, or after changing tools/geo.py, so the cartoon, the
3D guide, the painted map and the satellite map all pick up the same data.
Each version's own build script is the authority; this only runs them in order.
"""
import pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
# (label, script, skip if this file already exists)
STEPS = [
    ("coordinates -> v1 and v2", ["tools/geo.py"],           None),
    ("v1 installable app",       ["build.py"],               None),
    ("v3 painted map",           ["v3/tools/build.py"],      None),
    # The 3D setting needs an elevation grid. tools/fetch_terrain.py fetches the
    # real one; this only draws the stand-in when nothing is there yet, so a
    # fetched grid is never overwritten.
    ("elevation stand-in",       ["tools/standin_terrain.py"], "v4/terrain.png"),
    # and the base map it colours, when there is no satellite mosaic yet
    ("base map stand-in",        ["v4/tools/standin.py"],      "v4/imagery.jpg"),
    ("v4 satellite map",         ["v4/tools/build.py"],      None),
]

failed = []
for label, args, have in STEPS:
    if have and (HERE / have).exists():
        print(f"\n== {label}: {have} already there, skipped ==")
        continue
    print(f"\n== {label} ==")
    r = subprocess.run([sys.executable, *args], cwd=HERE)
    if r.returncode:
        failed.append(label)
print()
if failed:
    sys.exit("failed: " + ", ".join(failed))
print("all pages rebuilt")
