# Audit Kit — ready-to-run real-data audit for Shoalwater

Everything in this folder runs on Casey's local machine (ProArt WSL), where the
real data lives. Built and verified 2026-10-11 — see `../VERIFICATION.md` for
the reproduction results and `../DIGEST.md` for the design background.

## Contents

| File | What |
|---|---|
| `variant_a_minimal_numpy.py` | Kit copy of Variant A (field tool) — patched, see below |
| `variant_b_scientific.py` | Kit copy of Variant B (confidence layer / GPR) — patched |
| `variant_c_modern.py` | Kit copy of Variant C (polars + DuckDB) — patched |
| `variant_d_pdal.py` | Kit copy of Variant D (PDAL ingest) — patched |
| `variant_d_pdal_pipeline.json` | D's reference PDAL pipeline (unchanged from pack) |
| `make_kit.py` | The patcher that produced the kit copies from `../briefing/` originals — re-run it to regenerate; every patch asserts its anchor, so drift fails loudly |
| `prep_noaa_tide.py` | Converts a NOAA CO-OPS water-level CSV (station **9451600 Sitka**, datum MLLW, time_zone gmt) into the audit's tide-table schema |

**Patches vs the briefing originals** (originals are never modified):
1. Reference shoal via environment: `AUDIT_SHOAL_LON`, `AUDIT_SHOAL_LAT`,
   `AUDIT_SHOAL_DEPTH_M`, `AUDIT_SHOAL_RADIUS_M` (defaults = synthetic Haystack).
2. Variant C's synthetic-tide extension gated behind `AUDIT_SYNTH_TIDE_EXT=1`
   (default **off** — it fabricates tides from the test generator's sine).
3. Variant C's SQL shoal literals now use the same constants.
4. Recommendation strings corrected: NOAA station **9451600** (Sitka), not the
   pack's 9452210 (that's Juneau).

## Setup (WSL, once)

```bash
# Variants A/B/C — one venv
python3 -m venv ~/opensky-audit-venv
~/opensky-audit-venv/bin/pip install numpy scipy matplotlib pandas scikit-learn \
    polars duckdb altair pyarrow vl-convert-python

# Variant D — conda (pip install pdal does NOT work; needs system libpdal)
micromamba create -y -p ~/pdal-env -c conda-forge pdal python=3.11 numpy matplotlib
```

## The real run (in order)

1. **Get the tide table for the sounding dates** (station 9451600, MLLW, GMT,
   metric, covering the FULL timestamp range of every file — plus a day of
   margin each side), then convert:
   ```bash
   python3 prep_noaa_tide.py noaa_9451600_raw.csv --datum MLLW -o tide_sitka.csv
   ```
   API pattern (verify in a browser when downloading):
   `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&station=9451600&datum=MLLW&time_zone=gmt&units=metric&format=csv&begin_date=YYYYMMDD&end_date=YYYYMMDD&application=opensky_audit`
2. **Set the shoal** to the trusted charted shoal the data actually crosses
   (from the inventory's ground-truth item):
   ```bash
   export AUDIT_SHOAL_LON=<lon> AUDIT_SHOAL_LAT=<lat> AUDIT_SHOAL_DEPTH_M=<charted depth in meters MLLW>
   # optional: export AUDIT_SHOAL_RADIUS_M=100
   ```
3. **Run each variant WITHOUT `--ground-truth`** (there is no ground-truth
   file for real data; self-verification is a synthetic-test feature):
   ```bash
   ~/opensky-audit-venv/bin/python variant_a_minimal_numpy.py <files...> --tide-table tide_sitka.csv --out out_a/
   ~/opensky-audit-venv/bin/python variant_b_scientific.py     <files...> --tide-table tide_sitka.csv --out out_b/
   ~/opensky-audit-venv/bin/python variant_c_modern.py         <files...> --tide-table tide_sitka.csv --out out_c/
   ~/pdal-env/bin/python           variant_d_pdal.py           <files...> --tide-table tide_sitka.csv --out out_d/
   ```
   Do **not** set `AUDIT_SYNTH_TIDE_EXT` for real data. If soundings fall
   outside the tide table, re-download a wider table (step 1), don't enable
   the extension.
4. **Read `out_*/audit_report.md`.** The numbers that matter: per-file units +
   datum, and the shoal spread before/after tide correction (fm). If the fleet
   file lands "correctable" like the synthetic one (~0.98 → 0.2–0.45 fm), the
   CSB pipeline requirement is confirmed on real data and the Region Pack spec
   work can start. Send the four reports (they're small) back to the lane —
   the sounding data itself stays on this machine.

## Sanity check (optional, 1 minute)

Reproduce the synthetic pass with the kit copies before trusting a real run:
point them at the pack's test CSVs with `--ground-truth` and
`AUDIT_SYNTH_TIDE_EXT=1` for variant C only. Expected: all 4/4, fleet
corrected spreads A 0.4046 / B 0.4015 / C 0.1957 / D 0.4475 fm.
