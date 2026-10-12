#!/usr/bin/env python3
"""
run_all.py — the one-command verification suite for opensky-terrain.

Runs every check that is self-contained in this repository and prints a
summary. Exit code 0 only if every non-skipped check passes.

  1. qm-roundtrip     Python quantized-mesh encode/decode self-test
  2. validator-demo   Region Pack validator: good manifest + 6 mutants
  3. example-pack     the shipped example pack passes the validator
  4. csb-known-answer CSB corrector recovers known tide coefficient and
                      vessel offsets from this repo's own synthetic fixtures
  5. bake-chain       fused grid -> QM tile pyramid -> validator, with the
                      bake's mandatory per-tile decode self-check
  6. ts-decoder-xcheck TypeScript decoder output == Python decoder output
                      on the example tile (cross-language format proof)
  7. lod-contract     TypeScript LOD selector contract suite
  8. copc-stage       corrected soundings -> COPC/LAZ (SKIPPED unless a
                      `pdal` binary is on PATH or PDAL_BIN is set)

Requires: python3 + numpy + pandas (checks 1-6), node >= 22 (checks 6-7).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
VENV_PY = sys.executable
RESULTS = []


def run(name, cmd, expect_in_stdout=None, cwd=None, env_extra=None):
    env = dict(os.environ)
    env["PYTHONPATH"] = str(SRC) + os.pathsep + env.get("PYTHONPATH", "")
    if env_extra:
        env.update(env_extra)
    p = subprocess.run(cmd, capture_output=True, text=True,
                       cwd=cwd or ROOT, env=env)
    ok = p.returncode == 0
    if expect_in_stdout:
        ok = ok and expect_in_stdout in p.stdout
    RESULTS.append((name, "PASS" if ok else "FAIL",
                    (p.stdout.strip().splitlines() or [""])[-1][:110]))
    if not ok:
        print(f"--- {name} FAILED ---\n{p.stdout[-1500:]}\n{p.stderr[-1500:]}")
    return ok


def main():
    tmp = Path(tempfile.mkdtemp(prefix="opensky-checks-"))
    fx = tmp / "fixtures"
    subprocess.run([VENV_PY, str(ROOT / "checks" / "gen_fixtures.py"), str(fx)],
                   check=True, capture_output=True, text=True,
                   env={**os.environ, "PYTHONPATH": str(SRC)})

    run("qm-roundtrip", [VENV_PY, "-m", "regionpack.qm"], expect_in_stdout="PASS")
    run("validator-demo", [VENV_PY, "-m", "regionpack.validate", "--demo"],
        expect_in_stdout="mutant6: PASS")
    run("example-pack", [VENV_PY, "-m", "regionpack.validate",
                         str(ROOT / "examples" / "example-pack"), "--tiles"],
        expect_in_stdout="Validation passed")

    csb_out = tmp / "csb"
    run("csb-fit", [VENV_PY, "-m", "regionpack.csb", "--survey", str(fx / "survey.csv"),
                    "--fleet", str(fx / "fleet.csv"), "--tide", str(fx / "tide.csv"),
                    "--out", str(csb_out)])
    # known-answer assertions on the report the fit produced
    try:
        rep = json.loads((csb_out / "csb_report.json").read_text())
        truth = json.loads((fx / "truth.json").read_text())
        b_ok = abs(rep["fitted_b"] - 1.0) <= 0.10
        off_ok = all(abs(rep["offsets_m"][k] - v) <= 0.35
                     for k, v in truth["offsets_m"].items())
        raw, full = rep["shoal_std_raw_fm"], rep["shoal_std_full_fm"]
        spread_ok = full < raw * 0.6
        ok = b_ok and off_ok and spread_ok
        RESULTS.append(("csb-known-answer", "PASS" if ok else "FAIL",
                        f"b={rep['fitted_b']:.3f} offsets="
                        f"{ {k: round(v, 2) for k, v in rep['offsets_m'].items()} } "
                        f"shoal {raw:.3f}->{full:.3f} fm"))
    except Exception as e:  # report file missing or malformed
        RESULTS.append(("csb-known-answer", "FAIL", f"{type(e).__name__}: {e}"))

    pack = tmp / "pack"
    run("bake-chain", [VENV_PY, "-m", "regionpack.bake", "--grid",
                       str(csb_out / "grid.npz"), "--out", str(pack)],
        expect_in_stdout="BAKE PASS")
    if pack.exists():
        run("bake-validator", [VENV_PY, "-m", "regionpack.validate", str(pack), "--tiles"],
            expect_in_stdout="Validation passed")

    tile = ROOT / "examples" / "example-pack" / "tiles" / "0" / "0" / "0.terrain"
    ts = subprocess.run(["node", str(ROOT / "runtime" / "qm_decoder.ts"), str(tile)],
                        capture_output=True, text=True)
    py = subprocess.run([VENV_PY, "-c", f"""
import sys, json
sys.path.insert(0, {str(SRC)!r})
import numpy as np
from regionpack.qm import decode_tile
d = decode_tile(open({str(tile)!r}, "rb").read())
bt = d["bottom_type"]
counts = {{str(int(k)): int(v) for k, v in zip(*np.unique(bt, return_counts=True))}} if len(bt) else {{}}
print(json.dumps({{"vertexCount": len(d["u"]), "triangleCount": len(d["triangles"]),
"heightMin": round(float(d["height"].min()), 4), "heightMax": round(float(d["height"].max()), 4),
"indexHead": [int(x) for x in d["triangles"].ravel()[:6]],
"bottomTypeCounts": counts,
"confidenceMean": round(float(d["confidence"].mean()), 2) if len(d["confidence"]) else None}}))
"""], capture_output=True, text=True)
    try:
        a, b = json.loads(ts.stdout), json.loads(py.stdout)
        exact = ["vertexCount", "triangleCount", "indexHead", "bottomTypeCounts"]
        xok = ts.returncode == 0 and all(a[f] == b[f] for f in exact) \
            and abs(a["heightMin"] - b["heightMin"]) < 1e-3 \
            and abs(a["heightMax"] - b["heightMax"]) < 1e-3 \
            and abs(a["confidenceMean"] - b["confidenceMean"]) < 0.01 \
            and a.get("extensionIds") == [5, 6]
        RESULTS.append(("ts-decoder-xcheck", "PASS" if xok else "FAIL",
                        "TS == Python on all compared fields" if xok else f"TS={a} PY={b}"))
    except Exception as e:
        RESULTS.append(("ts-decoder-xcheck", "FAIL", f"{type(e).__name__}: {e}"))

    run("lod-contract", ["node", str(ROOT / "runtime" / "lod_selector.ts")],
        expect_in_stdout="LOD PASS")

    pdal = os.environ.get("PDAL_BIN") or shutil.which("pdal")
    if pdal:
        run("copc-stage", [VENV_PY, "-m", "regionpack.copc", "--report",
                           str(csb_out / "csb_report.json"), "--fleet", str(fx / "fleet.csv"),
                           "--tide", str(fx / "tide.csv"), "--out", str(tmp / "copc")],
            expect_in_stdout="COPC PASS", env_extra={"PDAL_BIN": pdal})
    else:
        RESULTS.append(("copc-stage", "SKIP", "no pdal binary (set PDAL_BIN)"))

    print("\n== opensky-terrain checks ==")
    for name, status, note in RESULTS:
        print(f"{status:4}  {name:18} {note}")
    bad = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\n{len(RESULTS) - len(bad) - sum(1 for r in RESULTS if r[1] == 'SKIP')} passed, "
          f"{len(bad)} failed, {sum(1 for r in RESULTS if r[1] == 'SKIP')} skipped")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
