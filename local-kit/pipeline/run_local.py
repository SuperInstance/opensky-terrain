#!/usr/bin/env python3
"""
run_local.py — the local pipeline orchestrator. Everything runs on THIS
machine; the only network call is the NOAA tide fetch (public data).

Modes (chosen from config.json):
  A  depthsAlreadyCorrected=true
       Your plotter software already applied tide + offsets. We grid and
       bake directly; the report says so.
  B  raw depths + a reference file
       Full joint fit (tide coefficient b + per-vessel offsets against the
       reference layer), then grid + bake. The strongest mode.
  C  raw depths, no reference
       Tide-only correction with b fixed at 1.0 (the sign convention fitted
       and verified on synthetic data). Offsets unknown -> every cell is
       baked at fleet confidence and the report says exactly that.

Outputs (all under outputs/):
  inventory.json, reports/RUN-REPORT.md (+ csb_report.json in mode B),
  pack/ (the Region Pack), and a preview (index.html + qm.js) that renders
  the pack from this folder.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
from pipeline import inventory, grid_local            # noqa: E402
from pipeline.fetch_tide import fetch_tide            # noqa: E402

FM = 1.8288
UNIT_TO_M = {"m": 1.0, "fm": FM, "ft": 0.3048}


def sub(mod_args, label):
    env = dict(__import__("os").environ)
    env["PYTHONPATH"] = str(KIT)
    r = subprocess.run([sys.executable, "-m"] + mod_args,
                       capture_output=True, text=True, env=env)
    print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr[-2500:])
        raise SystemExit(f"Stage failed: {label} (exit {r.returncode})")


def load_soundings(cfg):
    path = KIT / cfg.get("dataDir", "data-in") / cfg["soundingsFile"]
    df = pd.read_csv(path)
    c = cfg["columns"]
    out = pd.DataFrame({
        "lon": df[c["lon"]].astype(float),
        "lat": df[c["lat"]].astype(float),
        "depth_m": df[c["depth"]].astype(float) * UNIT_TO_M[cfg.get("depthUnit", "m")],
    })
    if c.get("timestamp") and c["timestamp"] in df.columns:
        out["timestamp"] = pd.to_datetime(df[c["timestamp"]])
    if c.get("vessel") and c["vessel"] in df.columns:
        out["vessel"] = df[c["vessel"]].astype(str)
    return out


def main():
    cfg = json.loads((KIT / "config.json").read_text())
    out_dir = KIT / "outputs"
    work = KIT / "work"
    work.mkdir(exist_ok=True)
    (out_dir / "reports").mkdir(parents=True, exist_ok=True)

    inv = inventory.run(KIT / cfg.get("dataDir", "data-in"), cfg,
                        out_dir / "inventory.json")
    snd = load_soundings(cfg)
    notes = []

    if cfg.get("depthsAlreadyCorrected"):
        mode = "A (already corrected by plotter software)"
        grid_npz = work / "grid.npz"
        grid_local.build_grid(snd[["lon", "lat", "depth_m"]],
                              cfg["origin"], int(cfg.get("gridCellM", 25)), grid_npz)
        notes.append("Depths taken as exported (plotter applied tide/offsets).")
    elif cfg.get("referenceFile"):
        mode = "B (joint fit vs reference)"
        ref_path = KIT / cfg.get("dataDir", "data-in") / cfg["referenceFile"]
        ref = pd.read_csv(ref_path)
        c = cfg["columns"]
        survey = pd.DataFrame({
            "lon": ref[c["lon"]].astype(float), "lat": ref[c["lat"]].astype(float),
            "depth_m": ref[c["depth"]].astype(float) * UNIT_TO_M[cfg.get("depthUnit", "m")],
        })
        survey.to_csv(work / "survey.csv", index=False)
        fleet = pd.DataFrame({
            "lon": snd["lon"], "lat": snd["lat"],
            "timestamp_iso": snd["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            "depth_fm": snd["depth_m"] / FM,
            "vessel_id": snd.get("vessel", "vessel-1"),
        })
        fleet.to_csv(work / "fleet.csv", index=False)
        fetch_tide(cfg.get("tideStation", "9451600"),
                   snd["timestamp"].min() - pd.Timedelta(days=1),
                   snd["timestamp"].max() + pd.Timedelta(days=1),
                   work / "tide.csv")
        sub(["pipeline.csb", "--survey", str(work / "survey.csv"),
             "--fleet", str(work / "fleet.csv"), "--tide", str(work / "tide.csv"),
             "--out", str(work / "csb")], "csb fit")
        rep = json.loads((work / "csb" / "csb_report.json").read_text())
        shutil.copy(work / "csb" / "csb_report.json", out_dir / "reports" / "csb_report.json")
        notes.append(f"Fitted tide coefficient b = {rep['fitted_b']:.3f}; "
                     f"vessel offsets (m): {rep['offsets_m']}; "
                     f"{rep['fleet_points_out_of_tide_range']} soundings excluded "
                     "as out-of-tide-range (never clamped).")
        grid_npz = work / "csb" / "grid.npz"
    else:
        mode = "C (tide-only, b = 1.0 fixed)"
        tide = fetch_tide(cfg.get("tideStation", "9451600"),
                          snd["timestamp"].min() - pd.Timedelta(days=1),
                          snd["timestamp"].max() + pd.Timedelta(days=1),
                          work / "tide.csv")
        t_ns = pd.to_datetime(tide["timestamp_iso"]).astype("int64").to_numpy()
        q_ns = snd["timestamp"].astype("int64").to_numpy()
        in_range = (q_ns >= t_ns.min()) & (q_ns <= t_ns.max())
        snd = snd[in_range].copy()
        snd["depth_m"] = snd["depth_m"] + np.interp(
            q_ns[in_range], t_ns, tide["tide_height_m"].to_numpy())
        notes.append("Tide-only correction with b fixed at 1.0 and no vessel "
                     "offsets (no reference file). Treat absolute depths as "
                     "±(typical transducer offset) until a Mode B run.")
        grid_npz = work / "grid.npz"
        grid_local.build_grid(snd[["lon", "lat", "depth_m"]],
                              cfg["origin"], int(cfg.get("gridCellM", 25)), grid_npz)

    pack = out_dir / "pack"
    sub(["pipeline.bake", "--grid", str(grid_npz), "--out", str(pack)], "bake")
    sub(["pipeline.validate", str(pack), "--tiles"], "validate")

    # preview: copy viewer next to the pack and point it at pack/
    for name in ("index.html", "qm.js"):
        text = (KIT / "preview" / name).read_text()
        (out_dir / name).write_text(text.replace("__PACK__", "pack"))

    (out_dir / "reports" / "RUN-REPORT.md").write_text(
        f"# Local run report\n\nMode: **{mode}**\n\n"
        f"Soundings: {inv['soundings']['rows']} rows, "
        f"depth range {inv['soundings']['depth_m_range']} m, "
        f"charts inventoried: {len(inv['charts'])}.\n\n"
        + "\n".join(f"- {n}" for n in notes)
        + "\n\nPack: outputs/pack (validated). Preview: serve outputs/ and open index.html.\n"
        "\nSend back (small files, no raw soundings): "
        "outputs/reports/RUN-REPORT.md, outputs/inventory.json, "
        "and outputs/reports/csb_report.json if present.\n")
    print(f"\nDONE. Mode {mode}. Pack at {pack}. "
          "Report: outputs/reports/RUN-REPORT.md")


if __name__ == "__main__":
    main()
