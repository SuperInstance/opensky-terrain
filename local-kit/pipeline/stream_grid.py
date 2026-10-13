#!/usr/bin/env python3
"""
stream_grid.py — fast path for very large gridded XYZ exports (e.g. a
TimeZero bathy surface export with header "long, lat, elevation", where
elevation is negative below the datum and positive on land).

One streaming pass (the file is never fully loaded):
  * global stats (rows, lon/lat/elevation bounds, land/water split)
  * Sitka Sound clip -> 25 m grid in the bake's grid.npz format
    (water cells only; depth = -elevation, positive down, metres)
  * shallowest depth found within 300 m of the pack origin (sanity datum)

Usage: python -m pipeline.stream_grid --xyz FILE --out WORKDIR
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

CLIP = {"west": -135.70, "east": -135.10, "south": 56.95, "north": 57.20}
ORIGIN = {"lat": 57.05, "lon": -135.43}
CELL = 25.0
MLON = 111_320.0 * math.cos(math.radians(ORIGIN["lat"]))
MLAT = 111_320.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xyz", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    x_lo = math.floor((CLIP["west"] - ORIGIN["lon"]) * MLON / CELL) * CELL
    x_hi = math.ceil((CLIP["east"] - ORIGIN["lon"]) * MLON / CELL) * CELL
    y_lo = math.floor((CLIP["south"] - ORIGIN["lat"]) * MLAT / CELL) * CELL
    y_hi = math.ceil((CLIP["north"] - ORIGIN["lat"]) * MLAT / CELL) * CELL
    nx = int(round((x_hi - x_lo) / CELL))
    ny = int(round((y_hi - y_lo) / CELL))
    sums = np.zeros((ny, nx))
    cnts = np.zeros((ny, nx))

    stats = {"rows_total": 0, "rows_in_clip": 0, "water_in_clip": 0,
             "land_in_clip": 0, "lon_min": 1e9, "lon_max": -1e9,
             "lat_min": 1e9, "lat_max": -1e9,
             "elev_min": 1e9, "elev_max": -1e9}
    shoal_min = {"depth_m": 1e9, "lon": None, "lat": None}

    for chunk in pd.read_csv(a.xyz, chunksize=2_000_000):
        chunk.columns = [c.strip() for c in chunk.columns]
        lon = chunk["long"].to_numpy()
        lat = chunk["lat"].to_numpy()
        elev = chunk["elevation"].to_numpy()
        stats["rows_total"] += len(chunk)
        stats["lon_min"] = min(stats["lon_min"], float(lon.min()))
        stats["lon_max"] = max(stats["lon_max"], float(lon.max()))
        stats["lat_min"] = min(stats["lat_min"], float(lat.min()))
        stats["lat_max"] = max(stats["lat_max"], float(lat.max()))
        stats["elev_min"] = min(stats["elev_min"], float(elev.min()))
        stats["elev_max"] = max(stats["elev_max"], float(elev.max()))
        m = ((lon >= CLIP["west"]) & (lon <= CLIP["east"])
             & (lat >= CLIP["south"]) & (lat <= CLIP["north"]))
        if not m.any():
            continue
        clon, clat, celev = lon[m], lat[m], elev[m]
        stats["rows_in_clip"] += int(m.sum())
        water = celev < 0
        stats["land_in_clip"] += int((~water).sum())
        stats["water_in_clip"] += int(water.sum())
        if water.any():
            wlon, wlat, welev = clon[water], clat[water], celev[water]
            x = (wlon - ORIGIN["lon"]) * MLON
            y = (wlat - ORIGIN["lat"]) * MLAT
            xi = ((x - x_lo) / CELL).astype(int)
            yi = ((y - y_lo) / CELL).astype(int)
            ok = (xi >= 0) & (xi < nx) & (yi >= 0) & (yi < ny)
            np.add.at(sums, (yi[ok], xi[ok]), -welev[ok])
            np.add.at(cnts, (yi[ok], xi[ok]), 1)
            # shallowest point within 300 m of the origin (sanity datum)
            d2 = x ** 2 + y ** 2
            near = d2 <= 300.0 ** 2
            if near.any():
                j = int(np.argmin(np.where(near, -welev, 1e18)))
                if -welev[j] < shoal_min["depth_m"]:
                    shoal_min = {"depth_m": float(-welev[j]),
                                 "lon": float(wlon[j]), "lat": float(wlat[j])}

    layer = np.where(cnts > 0, sums / np.maximum(cnts, 1), np.nan)
    x_centers = x_lo + (np.arange(nx) + 0.5) * CELL
    y_centers = y_lo + (np.arange(ny) + 0.5) * CELL
    empty = np.full_like(layer, np.nan)
    np.savez(out / "grid.npz", survey=empty, fleet=layer, fused=layer,
             x_centers=x_centers, y_centers=y_centers)
    stats.update({"clip": CLIP, "grid_shape": [int(nx), int(ny)],
                  "cells_filled": int((cnts > 0).sum()),
                  "depth_m_min": float(np.nanmin(layer)),
                  "depth_m_max": float(np.nanmax(layer)),
                  "shoal_near_origin_300m": shoal_min})
    (out / "clip-inventory.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats, indent=2))
    print(f"grid.npz -> {out / 'grid.npz'}")


if __name__ == "__main__":
    main()
