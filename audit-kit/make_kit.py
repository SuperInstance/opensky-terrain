#!/usr/bin/env python3
"""
make_kit.py — build the audit-kit copies of the four Z-pack audit variants.

Copies briefing/variant_*.py into this folder with MINIMAL, reviewable patches
(briefing originals are never touched):

1. Shoal constants (lon / lat / true depth MLLW / radius) become environment
   overridable, defaults unchanged:
       AUDIT_SHOAL_LON, AUDIT_SHOAL_LAT, AUDIT_SHOAL_DEPTH_M, AUDIT_SHOAL_RADIUS_M
   In the originals these are hardcoded to the SYNTHETIC Haystack Rock
   (-135.43, 57.05, 5.5 m) with no CLI option — units/datum detection compares
   soundings near that exact point against 5.5 m, so an unpatched run on real
   data from anywhere else silently produces meaningless detection.

2. Variant C only: the synthetic-tide table extension (which fabricates tide
   values outside the table's range using the GENERATOR's sine: amp 2.5 m,
   offset 1.5 m, period 12.4 h, epoch 2024-09-15) is gated behind
       AUDIT_SYNTH_TIDE_EXT=1
   Default OFF. Real runs must supply a tide table covering the full sounding
   range instead (see prep_noaa_tide.py). Enable it ONLY to reproduce the
   synthetic self-verification.

3. Variant C only: the cross-file DuckDB SQL had the shoal lon/lat/radius as
   raw literals inside an f-string; they now interpolate the constants.

4. All variants: recommendation strings citing "NOAA CO-OPS 9452210 Sitka"
   are corrected to 9451600. Verified 2026-10-11 against NOAA/NCEI station
   tables: 9451600 = Sitka, AK; 9452210 = Juneau, AK; 9451054 = Port
   Alexander, AK. (The pack's audit spec/scripts had Juneau's station ID
   labelled as Sitka; R&D-5's coords memo had the right one.)

Every patch asserts its anchor text exists, so a changed source fails loudly
instead of silently producing an unpatched copy.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / "briefing"

CONST_BLOCKS = {
    "variant_a_minimal_numpy.py": (
        "HAYSTACK_LON = -135.43\n"
        "HAYSTACK_LAT = 57.05\n"
        "HAYSTACK_TRUE_DEPTH_M = 5.5\n",
        "HAYSTACK_RADIUS_M = 100.0\n",
    ),
    "variant_b_scientific.py": (
        "HAYSTACK_LON = -135.43\n"
        "HAYSTACK_LAT = 57.05\n"
        "HAYSTACK_TRUE_DEPTH_M = 5.5\n",
        "HAYSTACK_RADIUS_M = 100.0\n",
    ),
    "variant_c_modern.py": (
        "HAYSTACK_LON = -135.43\n"
        "HAYSTACK_LAT = 57.05\n"
        "HAYSTACK_TRUE_DEPTH_M = 5.5\n",
        "HAYSTACK_RADIUS_M = 100.0\n",
    ),
    "variant_d_pdal.py": (
        "HAYSTACK_LON = -135.43\n"
        "HAYSTACK_LAT = 57.05\n"
        "HAYSTACK_TRUE_DEPTH_M = 5.5  # MLLW, per ground_truth.json\n",
        "HAYSTACK_RADIUS_M = 100.0    # spec: soundings within 100m of Haystack Rock\n",
    ),
}

REPLACEMENT = (
    "# KIT PATCH (audit-kit): shoal is parameterizable via environment.\n"
    "# Defaults are the synthetic Haystack Rock values from the Z pack.\n"
    "HAYSTACK_LON = float(os.environ.get(\"AUDIT_SHOAL_LON\", \"-135.43\"))\n"
    "HAYSTACK_LAT = float(os.environ.get(\"AUDIT_SHOAL_LAT\", \"57.05\"))\n"
    "HAYSTACK_TRUE_DEPTH_M = float(os.environ.get(\"AUDIT_SHOAL_DEPTH_M\", \"5.5\"))\n"
    "HAYSTACK_RADIUS_M = float(os.environ.get(\"AUDIT_SHOAL_RADIUS_M\", \"100.0\"))\n"
)


def patch(name: str) -> None:
    text = (SRC / name).read_text()
    orig_len = len(text)

    # 1. ensure `import os`
    if not re.search(r"^import os$", text, re.M):
        text = text.replace("import argparse\n", "import argparse\nimport os\n", 1)
        assert re.search(r"^import os$", text, re.M), f"{name}: could not add import os"

    # 2. shoal constants -> env-overridable (radius line differs per file,
    #    so replace lon/lat/depth block and radius line separately)
    block, radius_line = CONST_BLOCKS[name]
    assert block in text, f"{name}: constants block anchor missing"
    depth_fm = ""  # B keeps its derived FM line after the block; A/C/D handled below
    text = text.replace(block, REPLACEMENT, 1)
    assert radius_line in text, f"{name}: radius anchor missing"
    text = text.replace(radius_line, "", 1)
    # A and B re-derive FM / meters-per-degree from the constants after the
    # block; those lines follow the (now removed) radius line or the block —
    # they read the patched names, so no further change is needed.

    # 3. station-id correction in recommendation strings
    n_station = text.count("9452210")
    text = text.replace("9452210", "9451600")

    # 4. variant C extras
    n_ext = n_sql = 0
    if name == "variant_c_modern.py":
        anchor = "    if t_min < tide_t_min or t_max > tide_t_max:\n"
        gated = (
            "    # KIT PATCH (audit-kit): synthetic-tide extension is OFF unless\n"
            "    # AUDIT_SYNTH_TIDE_EXT=1. It fabricates tides from the synthetic\n"
            "    # generator's sine — never use it on real data; supply a full\n"
            "    # NOAA tide table instead (prep_noaa_tide.py).\n"
            "    if os.environ.get(\"AUDIT_SYNTH_TIDE_EXT\") == \"1\" and (\n"
            "            t_min < tide_t_min or t_max > tide_t_max):\n"
        )
        assert anchor in text, "C: tide-extension anchor missing"
        text = text.replace(anchor, gated, 1)
        n_ext = 1
        # SQL literals -> f-string interpolation of the constants
        for old, new in [
            ("(lat - 57.05)", "(lat - {HAYSTACK_LAT})"),
            ("cos(radians(57.05))", "cos(radians({HAYSTACK_LAT}))"),
            ("(lon - -135.43)", "(lon - {HAYSTACK_LON})"),
            ("< 100.0", "< {HAYSTACK_RADIUS_M}"),
        ]:
            c = text.count(old)
            assert c >= 1, f"C: SQL literal anchor missing: {old}"
            text = text.replace(old, new)
            n_sql += c

    out = HERE / name
    out.write_text(text)
    print(f"{name}: patched (station strings fixed: {n_station}, "
          f"tide-ext gate: {n_ext}, SQL literals: {n_sql}, "
          f"{orig_len} -> {len(text)} bytes)")


if __name__ == "__main__":
    for fname in CONST_BLOCKS:
        patch(fname)
    print("kit copies written to", HERE)
    sys.exit(0)
