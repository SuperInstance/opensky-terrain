#!/usr/bin/env python3
"""
inventory.py — Stage 0 of the local pipeline. Scans the data-in folder,
describes every file (metadata only), parses the soundings + reference CSVs
per config column mapping, and reports: row counts, lon/lat bounds, depth
range (converted to metres), timestamp range, vessel list. Also inventories
raster charts (BSB/KAP) by parsing their ASCII headers (scale, reference
points, approximate bounds) — full raster decode is a later stage.

Writes outputs/inventory.json and prints a human summary. Raises SystemExit
with a clear message when the soundings file is missing or unmapped.
"""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

UNIT_TO_M = {"m": 1.0, "fm": 1.8288, "ft": 0.3048}


def parse_kap_header(path: Path):
    """Extract scale + reference points from a KAP file's ASCII header."""
    info = {"file": path.name, "bytes": path.stat().st_size, "kind": "BSB/KAP raster chart"}
    try:
        raw = path.read_bytes()[:65536].decode("latin-1", errors="replace")
        header = raw.split("\x1a")[0]
        m = re.search(r"KNP/.*?SC=(\d+)", header, re.S)
        if m:
            info["scale"] = int(m.group(1))
        refs = re.findall(r"REF/(\d+),([\d.]+),([\d.]+),(-?[\d.]+),(-?[\d.]+)", header)
        if refs:
            lats = [float(r[3]) for r in refs]
            lons = [float(r[4]) for r in refs]
            info["ref_points"] = len(refs)
            info["approx_bounds"] = {
                "west": min(lons), "east": max(lons),
                "south": min(lats), "north": max(lats),
            }
        m = re.search(r"BSB/NA=([^,\r\n]+)", header)
        if m:
            info["chart_name"] = m.group(1).strip()
        m = re.search(r"BSB/NU=([^,\r\n]+)", header)
        if m:
            info["chart_number"] = m.group(1).strip()
    except Exception as e:  # header parse is best-effort
        info["header_error"] = f"{type(e).__name__}: {e}"
    return info


def describe_soundings(csv_path: Path, columns: dict, unit: str, label: str):
    df = pd.read_csv(csv_path)
    out = {"label": label, "file": csv_path.name, "rows": int(len(df)),
           "columns_found": list(df.columns)}
    missing = [k for k, v in columns.items() if v and v not in df.columns]
    if missing:
        out["missing_config_columns"] = {k: columns[k] for k in missing}
        return out, None
    lon = df[columns["lon"]].astype(float)
    lat = df[columns["lat"]].astype(float)
    depth_m = df[columns["depth"]].astype(float) * UNIT_TO_M[unit]
    out.update({
        "lon_range": [float(lon.min()), float(lon.max())],
        "lat_range": [float(lat.min()), float(lat.max())],
        "depth_m_range": [float(depth_m.min()), float(depth_m.max())],
    })
    if columns.get("timestamp") and columns["timestamp"] in df.columns:
        ts = pd.to_datetime(df[columns["timestamp"]])
        out["timestamp_range"] = [str(ts.min()), str(ts.max())]
    if columns.get("vessel") and columns["vessel"] in df.columns:
        out["vessels"] = sorted(df[columns["vessel"]].astype(str).unique().tolist())
    return out, df


def run(data_dir: Path, cfg: dict, out_path: Path):
    data_dir = Path(data_dir)
    inv = {"data_dir": str(data_dir), "files": [], "charts": []}
    for f in sorted(data_dir.iterdir()):
        if f.is_file():
            inv["files"].append({"name": f.name, "bytes": f.stat().st_size})
            if f.suffix.lower() in (".kap", ".bsb"):
                inv["charts"].append(parse_kap_header(f))

    snd_name = cfg.get("soundingsFile", "")
    snd_path = data_dir / snd_name if snd_name else None
    if not snd_path or not snd_path.exists():
        raise SystemExit(
            f"Soundings file not found: {snd_path}. Put your export in data-in/ "
            "and set \"soundingsFile\" in config.json to its name.")
    desc, df = describe_soundings(snd_path, cfg["columns"],
                                  cfg.get("depthUnit", "m"), "soundings")
    inv["soundings"] = desc
    if df is None:
        raise SystemExit(
            "Config column mapping does not match the soundings CSV. "
            f"Missing: {desc.get('missing_config_columns')}. "
            f"Columns actually in the file: {desc['columns_found']}. "
            "Fix the \"columns\" section of config.json to name your file's columns.")

    ref_name = cfg.get("referenceFile", "")
    if ref_name:
        ref_path = data_dir / ref_name
        if not ref_path.exists():
            raise SystemExit(f"referenceFile set but not found: {ref_path}")
        ref_columns = {k: cfg["columns"][k] for k in ("lon", "lat", "depth")}
        rdesc, rdf = describe_soundings(ref_path, ref_columns,
                                         cfg.get("depthUnit", "m"), "reference")
        inv["reference"] = rdesc
        if rdf is None:
            raise SystemExit("Reference file column mapping failed — same "
                             "columns mapping is used for both files.")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(inv, indent=2))
    print(f"Inventory: {inv['soundings']['rows']} soundings, "
          f"depth {inv['soundings']['depth_m_range']} m, "
          f"{len(inv['charts'])} chart(s), "
          f"{len(inv['files'])} file(s) total -> {out_path}")
    return inv
