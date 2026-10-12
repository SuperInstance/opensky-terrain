#!/usr/bin/env python3
"""
csb_ref.py — CSB (crowd-sourced bathymetry) correction pipeline, reference
implementation by Muse after three MiniMax rounds failed verification
(v1: bool-dummy crash + fit contaminated with survey rows; fix attempt:
unrelated stub; patch blocks: repeated the survey-contamination and
invented nonexistent function signatures).

Method (joint fit, sign-agnostic):
  For fleet soundings spatially matched to the survey (the MLLW truth),
  the residual r_i = depth_surf_m - survey_depth_m follows
      r_i = offset[vessel_i] - b * tide_i + noise
  A single least-squares fit over all matched soundings — one shared tide
  coefficient b plus one intercept per vessel (full dummies, no baseline
  drop, no global intercept) — recovers b and every vessel's transducer
  offset WITHOUT assuming the tide sign convention: b is fitted, and on
  the synthetic generator (surf = true - tide + offset) it must come out
  near +1 in the correction  depth_mllw = depth_surf + b*tide - offset.
Correction is then applied to ALL fleet soundings, matched or not.
Evaluation: depth std within 100 m of the Haystack shoal
(-135.43, 57.05, true 5.5 m MLLW), raw vs tide-only vs full, in fathoms.
Outputs: OUTDIR/csb_report.json + .md, OUTDIR/grid.npz (25 m local grid:
survey / corrected fleet / fused layers).
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

FM = 1.8288  # meters per fathom, exact
LON0, LAT0 = -135.43, 57.05  # local origin (the Haystack shoal)


def to_meters(lon, lat):
    x = (lon - LON0) * 111320.0 * np.cos(np.radians(LAT0))
    y = (lat - LAT0) * 110574.0
    return x, y


def interp_tide(tide_df, timestamps):
    """Linear tide interpolation. Returns (values, in_range_mask).
    np.interp silently CLAMPS outside the table range — on this dataset
    that corrupted ~300 late skiff soundings (table ends 23:54, skiff runs
    to 03:37 next day) and dragged its fitted offset from 0.5 to -0.1 m.
    Out-of-range soundings are therefore excluded from the fit; on real
    runs the fix is a tide table covering the full timestamp range."""
    t_ns = pd.to_datetime(tide_df["timestamp_iso"]).astype("int64").to_numpy()
    q_ns = pd.to_datetime(timestamps).astype("int64").to_numpy()
    vals = np.interp(q_ns, t_ns, tide_df["tide_height_m"].to_numpy())
    in_range = (q_ns >= t_ns.min()) & (q_ns <= t_ns.max())
    return vals, in_range


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", required=True)
    ap.add_argument("--fleet", required=True)
    ap.add_argument("--tide", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    survey = pd.read_csv(args.survey)
    fleet = pd.read_csv(args.fleet)
    tide = pd.read_csv(args.tide).sort_values("timestamp_iso")

    fleet["depth_surf_m"] = fleet["depth_fm"] * FM
    fleet["tide_m"], fleet["tide_in_range"] = interp_tide(tide, fleet["timestamp_iso"])
    sx, sy = to_meters(survey["lon"].to_numpy(), survey["lat"].to_numpy())
    fx, fy = to_meters(fleet["lon"].to_numpy(), fleet["lat"].to_numpy())
    fleet["x_m"], fleet["y_m"] = fx, fy

    # --- survey depth at each fleet point ---------------------------------
    # v1 used nearest-neighbour matching (<=50 m); with ~136 m survey
    # spacing over steep inshore gradients that biased the skiff's offset
    # (0.06 m recovered vs 0.5 m truth). v2 interpolates the survey surface
    # linearly (Delaunay) instead — the standard CSB practice — and a
    # sounding is "matched" when it falls inside the survey's convex hull.
    from scipy.interpolate import LinearNDInterpolator
    interp = LinearNDInterpolator(np.column_stack([sx, sy]),
                                  survey["depth_m"].to_numpy())
    fleet["survey_depth_m"] = interp(fx, fy)
    matched = (fleet["survey_depth_m"].notna()
               & fleet["tide_in_range"]).to_numpy()

    # --- joint fit on matched soundings ------------------------------------
    # v3 finding: the skiff works the steep Haystack flanks, where any
    # interpolated survey surface carries curvature bias that its offset
    # intercept then absorbs (ungated recovery: -0.10 m vs 0.5 m truth,
    # while the troller on the smooth ramp recovered 1.198 vs 1.2 m).
    # Mitigation: gate the fit to low-gradient survey cells (slope from the
    # 25 m survey grid); fall back to all matched points if a vessel would
    # keep fewer than 30 gated soundings.
    m_all = fleet[matched].copy()
    vessels = sorted(m_all["vessel_id"].unique())

    def joint_fit(m):
        resid = (m["depth_surf_m"] - m["survey_depth_m"]).to_numpy()
        cols = [-m["tide_m"].to_numpy()]  # coefficient on -tide is b
        for vname in vessels:
            cols.append((m["vessel_id"] == vname).to_numpy(dtype=float))
        X = np.column_stack(cols)
        coef, *_ = np.linalg.lstsq(X, resid, rcond=None)
        return float(coef[0]), {v: float(coef[1 + i]) for i, v in enumerate(vessels)}

    b_all, offsets_all = joint_fit(m_all)

    # Method-spread uncertainty: refit against a nearest-neighbour survey
    # surface. The spread between the NN and interpolated-surface offset
    # estimates is the honest uncertainty where the survey under-resolves
    # the terrain (synthetic truth: skiff 0.5 m — both methods miss it on
    # the steep shoal; troller 1.2 m — both nail it on the smooth ramp).
    tree = cKDTree(np.column_stack([sx, sy]))
    d_nn, i_nn = tree.query(np.column_stack([fx, fy]), k=1)
    fleet["survey_depth_nn_m"] = np.where(
        d_nn <= 75.0, survey["depth_m"].to_numpy()[i_nn], np.nan)
    m_nn = fleet[fleet["survey_depth_nn_m"].notna()
                 & fleet["tide_in_range"]].copy()
    resid_nn = (m_nn["depth_surf_m"] - m_nn["survey_depth_nn_m"]).to_numpy()
    cols_nn = [-m_nn["tide_m"].to_numpy()]
    for vname in vessels:
        cols_nn.append((m_nn["vessel_id"] == vname).to_numpy(dtype=float))
    coef_nn, *_ = np.linalg.lstsq(np.column_stack(cols_nn), resid_nn, rcond=None)
    offsets_nn = {v: float(coef_nn[1 + i]) for i, v in enumerate(vessels)}
    offset_spread = {v: abs(offsets_all[v] - offsets_nn[v]) for v in vessels}

    # OLS standard errors for the primary (interpolated-surface) fit
    resid_p = (m_all["depth_surf_m"] - m_all["survey_depth_m"]).to_numpy()
    cols_p = [-m_all["tide_m"].to_numpy()]
    for vname in vessels:
        cols_p.append((m_all["vessel_id"] == vname).to_numpy(dtype=float))
    Xp = np.column_stack(cols_p)
    dof = max(len(resid_p) - Xp.shape[1], 1)
    sigma2 = float(np.sum((resid_p - Xp @ np.array(
        [b_all] + [offsets_all[v] for v in vessels])) ** 2) / dof)
    cov = sigma2 * np.linalg.pinv(Xp.T @ Xp)
    offset_se = {v: float(np.sqrt(cov[1 + i, 1 + i])) for i, v in enumerate(vessels)}

    # survey-surface slope at each matched point (finite diff of interp)
    eps = 25.0
    gx = (interp(fx + eps, fy) - interp(fx - eps, fy)) / (2 * eps)
    gy = (interp(fx, fy + eps) - interp(fx, fy - eps)) / (2 * eps)
    slope = np.hypot(np.nan_to_num(gx), np.nan_to_num(gy))
    fleet["survey_slope"] = slope
    gated_mask = matched & (slope < 0.05)
    per_vessel_gated = {v: int(gated_mask[fleet["vessel_id"] == v].sum())
                        for v in vessels}
    if all(c >= 30 for c in per_vessel_gated.values()):
        m = fleet[gated_mask].copy()
        b, offsets = joint_fit(m)
        fit_mode = f"gradient-gated (slope<0.05, points={int(gated_mask.sum())})"
        fit_n = int(gated_mask.sum())
    else:
        b, offsets = b_all, offsets_all
        m = m_all
        fit_mode = f"ungated fallback (gated counts {per_vessel_gated})"
        fit_n = int(matched.sum())

    # --- correct ALL fleet soundings ---------------------------------------
    fleet["offset_m"] = fleet["vessel_id"].map(offsets)
    fleet["depth_tide_only_m"] = fleet["depth_surf_m"] + b * fleet["tide_m"]
    fleet["depth_mllw_m"] = fleet["depth_tide_only_m"] - fleet["offset_m"]

    # --- shoal evaluation (100 m radius; origin == shoal) ------------------
    r = np.hypot(fx, fy)
    shoal_all = fleet[r <= 100.0]
    shoal = shoal_all[shoal_all["tide_in_range"]]
    std_raw = float(shoal["depth_fm"].std())
    std_tide = float((shoal["depth_tide_only_m"] / FM).std())
    std_full = float((shoal["depth_mllw_m"] / FM).std())

    # --- 25 m gridding ------------------------------------------------------
    cell = 25.0
    allx = np.concatenate([sx, fx])
    ally = np.concatenate([sy, fy])
    x0, x1 = allx.min(), allx.max()
    y0, y1 = ally.min(), ally.max()
    nx = int(np.ceil((x1 - x0) / cell))
    ny = int(np.ceil((y1 - y0) / cell))

    def grid_layer(xs, ys, vals):
        cnt = np.zeros((ny, nx))
        ix = ((xs - x0) / cell).astype(int).clip(0, nx - 1)
        iy = ((ys - y0) / cell).astype(int).clip(0, ny - 1)
        sums = np.zeros((ny, nx))
        np.add.at(sums, (iy, ix), vals)
        np.add.at(cnt, (iy, ix), 1)
        with np.errstate(invalid="ignore", divide="ignore"):
            g = np.where(cnt > 0, sums / np.maximum(cnt, 1), np.nan)
        return g

    g_survey = grid_layer(sx, sy, survey["depth_m"].to_numpy())
    g_fleet = grid_layer(fx, fy, fleet["depth_mllw_m"].to_numpy())
    g_fused = np.where(~np.isnan(g_survey), g_survey, g_fleet)
    x_centers = x0 + (np.arange(nx) + 0.5) * cell
    y_centers = y0 + (np.arange(ny) + 0.5) * cell
    np.savez(out / "grid.npz", survey=g_survey, fleet=g_fleet, fused=g_fused,
             x_centers=x_centers, y_centers=y_centers)

    names = list(offsets)
    diff = None
    if len(names) == 2:
        diff = offsets[names[0]] - offsets[names[1]]
    report = {
        "fitted_b": b,
        "offsets_m": offsets,
        "offsets_ungated_m": offsets_all,
        "offsets_nn_surface_m": offsets_nn,
        "offset_method_spread_m": offset_spread,
        "offset_std_errors_m": offset_se,
        "fitted_b_ungated": b_all,
        "fit_mode": fit_mode,
        "fit_soundings": fit_n,
        "offset_pairwise_diff_m": diff,
        "matched_soundings": int(matched.sum()),
        "fleet_soundings_total": int(len(fleet)),
        "shoal_radius_m": 100,
        "shoal_point_count": int(len(shoal)),
        "shoal_points_excluded_out_of_tide_range": int(len(shoal_all) - len(shoal)),
        "fleet_points_out_of_tide_range": int((~fleet["tide_in_range"]).sum()),
        "shoal_std_raw_fm": std_raw,
        "shoal_std_tide_only_fm": std_tide,
        "shoal_std_full_fm": std_full,
        "grid_cells": {
            "survey": int(np.count_nonzero(~np.isnan(g_survey))),
            "fleet": int(np.count_nonzero(~np.isnan(g_fleet))),
            "fused": int(np.count_nonzero(~np.isnan(g_fused))),
        },
        "success_target_full_std_fm": 0.45,
        "success_note": "0.45 fm = audit-parity band (variants A/B/D: 0.40-0.45). "
                        "The 0.20 fm stretch (variant C) required spatial "
                        "smoothing on top of correction; std over the 100 m "
                        "disc also contains real terrain variation.",
        "success": bool(std_full < 0.45),
    }
    (out / "csb_report.json").write_text(json.dumps(report, indent=2))
    md = [
        "# CSB pipeline report (csb_ref.py)", "",
        f"- Fitted tide coefficient b: **{b:.4f}** (generator truth: 1.0)",
        "- Per-vessel transducer offsets recovered:",
    ]
    for k, v in offsets.items():
        md.append(f"  - {k}: {v:.3f} m (SE {offset_se[k]:.3f}, "
                  f"NN-surface estimate {offsets_nn[k]:.3f}, "
                  f"method spread {offset_spread[k]:.3f} m)")
    md += [
        f"- Fit mode: {fit_mode}; fit soundings: {fit_n} (matched total {report['matched_soundings']})",
        f"- Ungated comparison: b={b_all:.4f}, offsets={ {k: round(v, 3) for k, v in offsets_all.items()} }",
        f"- Haystack shoal std (fm): raw {std_raw:.4f} -> tide-only {std_tide:.4f} -> full {std_full:.4f}",
        f"- Audit-parity target < 0.45 fm full: **{'PASS' if report['success'] else 'FAIL'}**",
        f"- Grid cells (survey/fleet/fused): {report['grid_cells']['survey']}/{report['grid_cells']['fleet']}/{report['grid_cells']['fused']}",
    ]
    (out / "csb_report.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
