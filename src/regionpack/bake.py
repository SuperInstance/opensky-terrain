#!/usr/bin/env python3
"""
bake_pyramid_ref.py — build a synthetic Region Pack (quantized-mesh tile
pyramid) from the CSB fused depth grid. Reference implementation by Muse
after the MiniMax draft failed structurally (encoder called with scalar
u/v, header in the wrong shape, contentHash over zero bytes, tiles written
to the wrong paths, and no self-check despite printing BAKE PASS).

Scheme:
- Fill the fused grid's NaNs by iterative mean-of-4-neighbours diffusion
  (padded slicing, no wraparound). Per-cell source tracked BEFORE filling:
  2 = survey, 1 = fleet-only, 0 = filled.
- Levels z=0..3 at strides 8/4/2/1 over the 25 m grid. Tiles are blocks of
  <=64x64 samples stepping 63, so neighbours SHARE border samples (no
  cracks). y=0 is the southernmost block; v=0 at a tile's southern edge.
- Heights are elevation (-depth). Bottom type from depth/slope rules;
  confidence from source (245/120/40). Headers per qm_ref.
- MANDATORY self-check: every written tile is decoded with qm_ref and
  compared against its source samples (vertex count; sorted heights within
  the tile's quantization tolerance; sorted u/v exact; extension multisets
  equal). BAKE PASS prints only if all tiles verify.
- manifest.json per the validator contract; contentHash = sha256 over the
  concatenated tile bytes in sorted path order.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

try:
    from regionpack.qm import decode_tile, encode_tile
except ImportError:  # running as a loose script inside src/regionpack
    from qm import decode_tile, encode_tile

STRIDES = [8, 4, 2, 1]
TILE_SAMPLES = 64
BLOCK_STEP = TILE_SAMPLES - 1  # shared borders


def fill_grid(fused, survey, fleet):
    source = np.zeros(fused.shape, dtype=np.uint8)
    source[~np.isnan(fleet)] = 1
    source[~np.isnan(survey)] = 2
    filled = fused.copy()
    for _ in range(5000):
        nan_mask = np.isnan(filled)
        if not nan_mask.any():
            break
        padded = np.pad(filled, 1, constant_values=np.nan)
        neigh = np.stack([
            padded[:-2, 1:-1], padded[2:, 1:-1],
            padded[1:-1, :-2], padded[1:-1, 2:],
        ])
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(neigh, axis=0)
        newly = nan_mask & ~np.isnan(mean)
        if not newly.any():
            break
        filled[newly] = mean[newly]
    assert not np.isnan(filled).any(), "fill did not converge"
    return filled, source


def sample_indices(n, stride):
    idx = list(range(0, n, stride))
    if idx[-1] != n - 1:
        idx.append(n - 1)
    return np.array(idx)


def build_tiles(depth, source, xs, ys):
    """depth/source: sampled 2D arrays (rows south->north). Yields tile dicts."""
    rows, cols = depth.shape
    tiles = []
    for by, r0 in enumerate(range(0, rows, BLOCK_STEP)):
        r1 = min(r0 + TILE_SAMPLES, rows)
        if r1 - r0 < 2:
            continue
        for bx, c0 in enumerate(range(0, cols, BLOCK_STEP)):
            c1 = min(c0 + TILE_SAMPLES, cols)
            if c1 - c0 < 2:
                continue
            tiles.append({
                "x": bx, "y": by,
                "depth": depth[r0:r1, c0:c1],
                "source": source[r0:r1, c0:c1],
                "xs": xs[c0:c1], "ys": ys[r0:r1],
            })
    return tiles


def encode_one(tile, cell_m):
    d = tile["depth"]
    rows, cols = d.shape
    heights = -d
    # slope from central differences on the sampled grid (dimensionless)
    gy, gx = np.gradient(d, cell_m, cell_m)
    slope = np.hypot(gx, gy)
    bottom = np.full(d.shape, 2, dtype=np.uint8)       # sand
    bottom[d > 35] = 3                                  # mud (deep)
    bottom[(d < 12) | (slope > 0.25)] = 1               # rock (shallow/steep)
    conf = np.where(tile["source"] == 2, 245,
                    np.where(tile["source"] == 1, 120, 40)).astype(np.uint8)
    u = np.round(np.linspace(0, 32767, cols)).astype(np.uint16)
    v = np.round(np.linspace(0, 32767, rows)).astype(np.uint16)
    uu, vv = np.meshgrid(u, v)
    tris = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            a = r * cols + c
            b = a + 1
            dd = a + cols
            e = dd + 1
            tris.append([a, b, dd])
            tris.append([b, e, dd])
    header = {
        "CenterX": float(tile["xs"].mean()), "CenterY": float(tile["ys"].mean()),
        "CenterZ": float(heights.mean()),
        "MinimumHeight": float(heights.min()), "MaximumHeight": float(heights.max()),
        "BoundingSphereCenterX": float(tile["xs"].mean()),
        "BoundingSphereCenterY": float(tile["ys"].mean()),
        "BoundingSphereCenterZ": float(heights.mean()),
        "BoundingSphereRadius": float(0.5 * np.sqrt(
            np.ptp(tile["xs"]) ** 2 + np.ptp(tile["ys"]) ** 2 + np.ptp(heights) ** 2)),
        "HorizonOcclusionPointX": float(tile["xs"].mean()),
        "HorizonOcclusionPointY": float(tile["ys"].mean()),
        "HorizonOcclusionPointZ": float(heights.mean() + 0.5 * np.sqrt(
            np.ptp(tile["xs"]) ** 2 + np.ptp(tile["ys"]) ** 2 + np.ptp(heights) ** 2)),
    }
    data = encode_tile(uu.ravel(), vv.ravel(), heights.ravel(),
                       np.array(tris), bottom.ravel(), conf.ravel(), header)
    return data, heights, uu, vv, bottom, conf


def main():
    args = sys.argv[1:]
    grid_path = Path(args[args.index("--grid") + 1])
    out = Path(args[args.index("--out") + 1])

    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default
    g = np.load(grid_path)
    survey, fleet, fused = g["survey"], g["fleet"], g["fused"]
    x_centers, y_centers = g["x_centers"], g["y_centers"]
    filled, source = fill_grid(fused, survey, fleet)

    tile_paths = []
    index = []
    total_tiles = total_bytes = 0
    failures = []
    for z, stride in enumerate(STRIDES):
        ri = sample_indices(filled.shape[0], stride)
        ci = sample_indices(filled.shape[1], stride)
        depth_s = filled[np.ix_(ri, ci)]
        source_s = source[np.ix_(ri, ci)]
        xs_s, ys_s = x_centers[ci], y_centers[ri]
        cell_m = 25.0 * stride
        level_tiles = level_bytes = 0
        for tile in build_tiles(depth_s, source_s, xs_s, ys_s):
            data, heights, uu, vv, bottom, conf = encode_one(tile, cell_m)
            rel = Path("tiles") / str(z) / str(tile["x"]) / f"{tile['y']}.terrain"
            path = out / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            tile_paths.append(rel)
            index.append({
                "z": z, "x": tile["x"], "y": tile["y"],
                "westX": float(tile["xs"][0]), "southY": float(tile["ys"][0]),
                "spanX": float(tile["xs"][-1] - tile["xs"][0]),
                "spanY": float(tile["ys"][-1] - tile["ys"][0]),
                "minHeight": float(heights.min()), "maxHeight": float(heights.max()),
            })
            level_tiles += 1
            level_bytes += len(data)
            # --- mandatory self-check -------------------------------------
            dec = decode_tile(data)
            # Tolerance budget, derived not guessed: header min/max are
            # float32 on the wire, so a decoded height can differ from the
            # float64 source by (a) half the decode quantization step,
            # plus (b) the float32 rounding of the header endpoints —
            # up to (|min| + span) * 2^-24. Two real tiles exceeded
            # narrower tolerances by 4e-9 and 2.7e-7 respectively; the
            # format's float32 header sets a hard floor (~micrometers)
            # on how exactly any tile can ever verify.
            dec_span = dec["header"]["MaximumHeight"] - dec["header"]["MinimumHeight"]
            tol = (dec_span / 32767 / 2
                   + (abs(float(heights.min())) + float(heights.max() - heights.min())) * 2**-24
                   + 1e-9)
            ok = (
                len(dec["u"]) == heights.size
                and np.max(np.abs(np.sort(dec["height"]) - np.sort(heights.ravel()))) <= tol
                and np.array_equal(np.sort(dec["u"]), np.sort(uu.ravel()))
                and np.array_equal(np.sort(dec["v"]), np.sort(vv.ravel()))
                and np.array_equal(np.sort(dec["bottom_type"]), np.sort(bottom.ravel()))
                and np.array_equal(np.sort(dec["confidence"]), np.sort(conf.ravel()))
            )
            if not ok:
                failures.append(str(rel))
        print(f"z={z} (stride {stride}): {level_tiles} tiles, {level_bytes} bytes")
        total_tiles += level_tiles
        total_bytes += level_bytes

    if failures:
        print(f"BAKE FAIL: {len(failures)} tiles failed self-check: {failures[:5]}")
        sys.exit(1)

    h = hashlib.sha256()
    for rel in sorted(tile_paths):
        h.update((out / rel).read_bytes())
    # Manifest identity comes from the bake's arguments — never hardcoded.
    # (Defect fixed 2026-10-12: the first real bake inherited the synthetic
    # template's region/provenance/privacy verbatim.)
    half = float(x_centers[1] - x_centers[0]) / 2.0 if len(x_centers) > 1 else 12.5
    mlon = 111_320.0 * np.cos(np.radians(57.05))
    grid_bbox = {"crs": "EPSG:4326",
                 "west": -135.43 + (float(x_centers.min()) - half) / mlon,
                 "south": 57.05 + (float(y_centers.min()) - half) / 111_320.0,
                 "east": -135.43 + (float(x_centers.max()) + half) / mlon,
                 "north": 57.05 + (float(y_centers.max()) + half) / 111_320.0}
    manifest = {
        "regionPackVersion": "0.1",
        "region": {"id": opt("--region-id", "sitka-sound-synthetic"),
                   "name": opt("--region-name", "Sitka Sound (SYNTHETIC test pack)")},
        "boundingBox": grid_bbox,
        "coordinateSystems": {
            "storage": {"crs": "EPSG:4326"},
            "runtime": {"frame": "ENU", "origin": {"lat": 57.05, "lon": -135.43},
                        "units": "meters"},
        },
        "verticalDatum": {"name": "MLLW", "units": "meters", "station": "9451600"},
        "layers": {
            "terrain": {"format": "quantized-mesh-1.0",
                        "url": "tiles/{z}/{x}/{y}.terrain"},
            "extensionsSupported": ["bathymetry-bottomtype", "bathymetry-confidence"],
        },
        "confidence": {"tiers": {"proMultibeam": [240, 255], "fleet": [80, 160],
                                 "interpolated": [0, 60]}},
        "contourIntervals": [10, 5, 2, 1],
        "contourIntervalLodMap": {"10": 18.288, "5": 9.144, "2": 3.6576, "1": 1.8288},
        "defaultByCameraMode": {"freeFly": 10, "boat": 5, "deck": 2, "auv": 1},
        "verticalExaggeration": {"default": 1.0},
        "sourceProvenance": [
            {"origin": opt("--provenance", "synthetic survey + fleet fixtures (checks)"),
             "confidence": "fleet", "licensing": "owner-retained"},
        ],
        "license": {"code": "Apache-2.0", "data": "owner-retained"},
        "privacy": opt("--privacy", "public"),
        "versioning": {"packVersion": opt("--pack-version", "0.0.1-synthetic"),
                       "contentHash": "sha256:" + h.hexdigest()},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (out / "tiles-index.json").write_text(json.dumps({"tiles": index}, indent=1))
    print(f"BAKE PASS: {total_tiles} tiles, {total_bytes} bytes total, "
          f"all tiles decode-verified")


if __name__ == "__main__":
    main()
