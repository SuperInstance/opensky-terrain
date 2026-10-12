#!/usr/bin/env python3
"""
copc_dump.py — bake stages 1–3 proof (Muse): take the fitted CSB
correction from csb_ref's report (b + per-vessel offsets), apply it to the
fleet soundings, and write the corrected cloud as COPC/LAZ via PDAL —
the same archive form the bake pipeline specifies as its stage-1 output.
Out-of-tide-range soundings are written EXCLUDED (flagged in the summary),
never silently clamped.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
PDAL = Path(__import__("os").environ.get("PDAL_BIN", "pdal"))
FM = 1.8288


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True, help="csb_report.json from regionpack.csb")
    ap.add_argument("--fleet", required=True)
    ap.add_argument("--tide", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    report = json.loads(Path(a.report).read_text())
    b = report["fitted_b"]
    offsets = report["offsets_m"]

    fleet = pd.read_csv(a.fleet)
    tide = pd.read_csv(a.tide).sort_values("timestamp_iso")
    t_ns = pd.to_datetime(tide["timestamp_iso"]).astype("int64").to_numpy()
    q_ns = pd.to_datetime(fleet["timestamp_iso"]).astype("int64").to_numpy()
    in_range = (q_ns >= t_ns.min()) & (q_ns <= t_ns.max())
    tide_m = np.interp(q_ns, t_ns, tide["tide_height_m"].to_numpy())

    fleet["depth_mllw_m"] = fleet["depth_fm"] * FM + b * tide_m - fleet["vessel_id"].map(offsets)
    kept = fleet[in_range].copy()
    excluded = int((~in_range).sum())

    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    xyz = out_dir / "fleet_corrected_mllw.xyz"
    kept[["lon", "lat", "depth_mllw_m"]].to_csv(xyz, index=False, header=False)

    pipeline = {
        "pipeline": [
            {"type": "readers.text", "filename": str(xyz),
             "header": "X,Y,Z", "spatialreference": "EPSG:4326"},
            {"type": "writers.copc", "filename": str(out_dir / "fleet_corrected.copc.laz")},
        ]
    }
    pipe_path = out_dir / "pipeline.json"
    pipe_path.write_text(json.dumps(pipeline, indent=2))
    r = subprocess.run([str(PDAL), "pipeline", str(pipe_path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:])
        sys.exit(1)
    info = subprocess.run([str(PDAL), "info", "--summary",
                           str(out_dir / "fleet_corrected.copc.laz")],
                          capture_output=True, text=True)
    summary = json.loads(info.stdout)["summary"]
    xyz_size = xyz.stat().st_size
    copc_size = (out_dir / "fleet_corrected.copc.laz").stat().st_size
    print(f"COPC PASS: kept {len(kept)} soundings, excluded {excluded} "
          f"out-of-tide-range; pdal count={summary['num_points']}; "
          f"XYZ {xyz_size} B -> COPC {copc_size} B "
          f"({xyz_size / max(copc_size,1):.1f}x)")


if __name__ == "__main__":
    main()
