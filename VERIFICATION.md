# VERIFICATION — independent re-run of the Z pack's Round 2 claims

**Date:** 2026-10-11 (AKDT), on Muse's VM. **Question:** do the four audit
scripts in `briefing/` actually do what the pack says, and are they safe to
point at real data? Method: re-run them here on the pack's own synthetic data,
audit the code for synthetic-only assumptions, and check the pack's factual
claims against outside sources.

## 1. Reproduction of the synthetic self-verification

| Variant | Pack claim | My re-run | Fleet Haystack corrected spread |
|---|---|---|---|
| A — Minimal | 4/4 PASS | **4/4 PASS** (system python: numpy 1.26.4 / scipy 1.11.4) | 0.4046 fm — matches pack exactly |
| B — Scientific | 4/4 PASS | **4/4 PASS** (fresh venv: pandas 3.0.6 / numpy 2.5.4 / sklearn 1.9.1 — much newer than Z's pandas 2.2.3, still passes) | 0.4015 fm — matches |
| C — Modern | 4/4 PASS | **4/4 PASS** (venv: polars 2.0 / duckdb 1.5.6 / altair 6.3.0, same as Z's) | 0.1957 fm — matches to 4 decimals |
| D — PDAL | 4/4 PASS | **4/4 PASS** (micromamba conda env built here: PDAL 2.10.2, the same version Z used; runtime 0.29 s vs pack's 0.22 s) | 0.4475 fm — matches pack's final report exactly; COPC archives produced |

Outputs of my re-runs: `verify/output_a|b|c|d/`; kit re-runs: `verify/kit_a|b|c|d/` (kit D also 4/4, 0.4475 fm).
Verdict: **the pack's central Round 2 claim is real** — the scripts run as
shipped and reproduce their published numbers digit-for-digit.

## 2. The tide-station error (found by checking the pack against NOAA)

The pack uses three different "Sitka" station IDs. Checked against NOAA/NCEI
CO-OPS station tables (NCEI Kamchatka-tsunami station list; CO-OPS & NWS
products list — both retrieved 2026-10-11):

- **9451600 = Sitka, AK** (57.0516, −135.3416) — the real Sitka station.
  R&D-5's coords memo had this one right.
- **9452210 = Juneau, AK** (Gastineau Channel, Stephens Pass) — this is the ID
  baked into the audit spec, the generator, ground_truth.json, and all four
  scripts' recommendation text, every time labelled "Sitka". **Wrong city,
  ~85 nautical miles away.** Any real run following the pack's text would pull
  Juneau tides for Sitka soundings.
- **9451054 = Port Alexander, AK** (south Baranof Island) — the bake memo's
  "Sitka" ID; a legitimate nearby reducer station, but not Sitka.

Kit copies have the recommendation strings corrected to 9451600
(`make_kit.py` patch 4). Briefing originals are untouched. Note: whether
Casey's *TZPro* uses 9451600 is still a local-config question for the
inventory — but NOAA's answer for "which station is Sitka" is now settled.

## 3. Synthetic-only assumptions that would contaminate a real run

Found by reading all four scripts (line refs are to the briefing originals):

1. **The reference shoal is hardcoded in all four variants** (A: lines 42–46;
   B: 59–63; C: 51–54; D: 75–78). Lon −135.43, lat 57.05, true depth 5.5 m,
   radius 100 m are module constants; **no variant has a CLI option for them.**
   Units detection — the audit's first job — works by comparing soundings near
   that exact point to 5.5 m. Run as-is on real data that doesn't cross that
   point (or crosses a different shoal), units/datum detection is meaningless
   or silently wrong. → Kit patch 1: env-overridable shoal
   (`AUDIT_SHOAL_LON/LAT/DEPTH_M/RADIUS_M`), defaults unchanged.
2. **Variant C fabricates tides outside the table's range** (C: `_synth_tide_at`,
   lines ~210–227; extension invoked in `attach_tide`). It extends the tide
   table with the *synthetic generator's own sine* (amp 2.5 m, offset 1.5 m,
   period 12.4 h, epoch 2024-09-15 00:00 UTC). Measured effect: on the
   synthetic set this extension is *load-bearing for C's pass* — with it
   disabled, C's fleet corrected spread is 0.4063 fm and its verdict flips to
   `tide-noise-irreparable` (self-verification FAIL, reproduced in
   `verify/kit_c_noext/`). On real data the same code would invent Sitka tides
   from a fake sine for any sounding past the table's edge. → Kit patch 2:
   extension gated behind `AUDIT_SYNTH_TIDE_EXT=1`, default OFF; real runs
   must bring a tide table covering the full sounding range
   (`prep_noaa_tide.py`).
3. **Variant C's DuckDB SQL also hardcoded the shoal** as raw literals
   (57.05 / −135.43 / 100.0) inside the query string, separate from the Python
   constants — parameterizing only the constants would have left the SQL bonus
   pointing at Haystack. → Kit patch 3: literals now interpolate the constants.
4. **Self-verification needs a ground-truth file describing the test files.**
   All four variants accept `--ground-truth` as optional; a real run simply
   omits it (findings still produced; no pass/fail block). What a real run
   needs instead is the *shoal truth* — which is exactly what patch 1 supplies.
5. Cosmetic, left as-is: Variant B's report text prints the literal string
   "(-135.43, 57.05; true depth 5.5m…)" in one heading (its detection math uses
   the patched constants; only the printed label is stale). Noted so nobody
   mistakes a B report label for a detection error after a shoal change.

## 4. Kit equivalence proof

Kit copies (patches in §3, produced by `audit-kit/make_kit.py` with asserted
anchors) were re-run on the synthetic data: **A 4/4 (0.4046 fm), B 4/4
(0.4015 fm), C 4/4 with `AUDIT_SYNTH_TIDE_EXT=1` (0.1957 fm)** — identical to
the unpatched baselines. The patches change nothing on synthetic data and are
what make a real run possible. Env override demonstrated directly:
`AUDIT_SHOAL_LON=-135.99 AUDIT_SHOAL_LAT=57.5 AUDIT_SHOAL_DEPTH_M=9.25` loads
into Variant A's constants as given.

## 5. What is still NOT verified

- Any behaviour on real, messy data — that is precisely the gated next step.
- Variant B under Z's exact pinned versions (I tested newer; it passed —
  that's a robustness signal, not a reproduction gap that matters).
- That the PDAL conda path installs equally cleanly on Casey's ProArt WSL
  (it worked here via micromamba in ~10 minutes through the proxy; the
  NEEDS §3 check on the box remains the decider).
