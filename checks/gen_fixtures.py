#!/usr/bin/env python3
"""
gen_fixtures.py — generate a small, fully self-contained synthetic CSB
fixture set (this repository's own generator and data; no external inputs).

Truth model: depth_true(x, y) = N-S ramp 18->46 m minus a Gaussian shoal
rising to 5.5 m at the local origin; tide = 1.4 + 2.3*sin(2*pi*h/12.4);
fleet soundings follow depth_surf = depth_true - tide + vessel_offset.
The tide table deliberately covers the FULL sounding timestamp range plus
margin (the project's never-clamp invariant).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

LON0, LAT0 = -135.43, 57.05
MLAT = 111_320.0
MLON = 111_320.0 * np.cos(np.radians(LAT0))
FM = 1.8288
SHOAL_DEPTH = 5.5
OFFSETS = {"fv-north": 1.1, "fv-shoal": 0.45}


def true_depth(x_m, y_m):
    ramp = 32.0 + 14.0 * (y_m / 5500.0)
    shoal = (50.0 - SHOAL_DEPTH) * np.exp(-(x_m ** 2 + y_m ** 2) / (2 * 280.0 ** 2))
    return np.maximum(ramp - shoal, 3.0)


def tide_m(hours):
    return 1.4 + 2.3 * np.sin(2 * np.pi * hours / 12.4)


def main(out_dir):
    rng = np.random.default_rng(20261012)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    t0 = pd.Timestamp("2024-09-15T00:00:00Z")

    # tide table: -1 h .. +37 h at 6-minute steps (covers all soundings)
    th = np.arange(-1.0, 37.01, 0.1)
    def ts(hours):
        return (t0 + pd.Timedelta(seconds=int(round(hours * 3600)))).strftime(
            "%Y-%m-%dT%H:%M:%S+00:00")
    tide = pd.DataFrame({
        "timestamp_iso": [ts(float(h)) for h in th],
        "tide_height_m": tide_m(th),
    })
    tide.to_csv(out / "tide.csv", index=False)

    # survey: uniform over the 5.5 km box
    n = 1500
    sx = rng.uniform(-2750, 2750, n)
    sy = rng.uniform(-2750, 2750, n)
    survey = pd.DataFrame({
        "lon": LON0 + sx / MLON, "lat": LAT0 + sy / MLAT,
        "depth_m": true_depth(sx, sy) + rng.normal(0, 0.08, n),
    })
    survey.to_csv(out / "survey.csv", index=False)

    # fleet: shoal-clustered vessel + anchorage-clustered vessel
    rows = []
    for vessel, (cx, cy, spread, count) in {
        "fv-shoal": (0.0, 0.0, 350.0, 900),
        "fv-north": (1400.0, -1600.0, 500.0, 800),
    }.items():
        x = rng.normal(cx, spread, count)
        y = rng.normal(cy, spread, count)
        hours = rng.uniform(0, 36, count)
        surf_m = (true_depth(x, y) - tide_m(hours) + OFFSETS[vessel]
                  + rng.normal(0, 0.1 * FM, count))
        for xi, yi, h, d in zip(x, y, hours, surf_m):
            rows.append({
                "lon": LON0 + xi / MLON, "lat": LAT0 + yi / MLAT,
                "timestamp_iso": ts(float(h)),
                "depth_fm": d / FM, "vessel_id": vessel,
            })
    pd.DataFrame(rows).to_csv(out / "fleet.csv", index=False)
    (out / "truth.json").write_text(json.dumps({
        "offsets_m": OFFSETS, "shoal_depth_m": SHOAL_DEPTH, "tide_b_true": 1.0,
    }, indent=2))
    print(f"fixtures written to {out}")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
