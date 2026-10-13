#!/usr/bin/env python3
"""
grid_local.py — bin point soundings onto the regular local grid the bake
expects (grid.npz with survey/fleet/fused layers + ENU cell centres).

Used for Mode A (depths already corrected by the chartplotter software)
and Mode C (tide-only correction applied beforehand by run_local, which
writes a corrected CSV first). Source honesty: data cells are written to
the FLEET layer only (confidence 120 in the bake); the survey layer stays
empty unless the CSB stage produced the grid.
"""
from pathlib import Path

import numpy as np
import pandas as pd


def to_enu(lon, lat, lon0, lat0):
    mlat = 111_320.0
    mlon = 111_320.0 * np.cos(np.radians(lat0))
    return (lon - lon0) * mlon, (lat - lat0) * mlat


def build_grid(df_lonlat_depth: pd.DataFrame, origin: dict, cell_m: int,
               out_npz: Path):
    """df needs columns: lon, lat, depth_m (positive down, MLLW)."""
    x, y = to_enu(df_lonlat_depth["lon"].to_numpy(),
                  df_lonlat_depth["lat"].to_numpy(), origin["lon"], origin["lat"])
    d = df_lonlat_depth["depth_m"].to_numpy()
    xi = np.floor((x - x.min()) / cell_m).astype(int)
    yi = np.floor((y - y.min()) / cell_m).astype(int)
    nx, ny = xi.max() + 1, yi.max() + 1
    sums = np.zeros((ny, nx))
    cnts = np.zeros((ny, nx))
    np.add.at(sums, (yi, xi), d)
    np.add.at(cnts, (yi, xi), 1)
    layer = np.where(cnts > 0, sums / np.maximum(cnts, 1), np.nan)
    x_centers = x.min() + (np.arange(nx) + 0.5) * cell_m
    y_centers = y.min() + (np.arange(ny) + 0.5) * cell_m
    empty = np.full_like(layer, np.nan)
    out_npz.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out_npz, survey=empty, fleet=layer, fused=layer,
             x_centers=x_centers, y_centers=y_centers)
    print(f"Grid: {layer.shape[1]}x{layer.shape[0]} cells @ {cell_m} m, "
          f"{int((cnts > 0).sum())} filled -> {out_npz}")
    return out_npz
