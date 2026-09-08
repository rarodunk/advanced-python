#!/usr/bin/env python3
"""Rebuild every generated page from its inputs.

    python3 build_all.py

Run it after a `git pull`, or after changing tools/geo.py, so the cartoon, the
3D guide, the painted map and the satellite map all pick up the same data.
Each version's own build script is the authority; this only runs them in order.
"""
import pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
STEPS = [
    ("coordinates -> v1 and v2", ["tools/geo.py"]),
    ("v1 installable app",       ["build.py"]),
    ("v3 painted map",           ["v3/tools/build.py"]),
    ("v4 satellite map",         ["v4/tools/build.py"]),
]

failed = []
for label, args in STEPS:
    print(f"\n== {label} ==")
    r = subprocess.run([sys.executable, *args], cwd=HERE)
    if r.returncode:
        failed.append(label)
print()
if failed:
    sys.exit("failed: " + ", ".join(failed))
print("all pages rebuilt")
