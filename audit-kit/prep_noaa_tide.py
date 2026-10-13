#!/usr/bin/env python3
"""
prep_noaa_tide.py — convert a NOAA CO-OPS water-level CSV download into the
tide-table schema all four audit variants expect:

    timestamp_iso,tide_height_m
    2024-09-15 00:00:00+00:00,1.234
    ...

Input: a CSV from the CO-OPS datagetter API, e.g.
    https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
        ?product=water_level&station=9451600&datum=MLLW
        &time_zone=gmt&units=metric&format=csv
        &begin_date=YYYYMMDD&end_date=YYYYMMDD&application=shoalwater_audit

    Station 9451600 is SITKA, AK (verified against NOAA station tables
    2026-10-11; 9452210 is Juneau, 9451054 is Port Alexander).

CO-OPS CSV quirks handled: a leading space in header names (" Water Level"),
blank/gappy rows, and both the API column layout (Date Time, Water Level, ...)
and the older "t"/"v" layout. Output timestamps are UTC ISO with +00:00,
matching the synthetic table the variants were tested against — so download
with time_zone=gmt. If the input was downloaded in local time, this tool
cannot tell; it refuses nothing but prints the assumption loudly.

Datum: heights pass through unchanged. They are only meaningful for the audit
if the download used datum=MLLW. This tool cannot see which datum you picked
(the CSV does not say), so YOU must download with datum=MLLW and pass
--datum MLLW to acknowledge it. Anything else warns.

Usage:
    python3 prep_noaa_tide.py noaa_raw.csv --datum MLLW -o tide_table_sitka.csv
"""
import argparse
import csv
import sys
from datetime import datetime, timezone


def parse_ts(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("input", help="NOAA CO-OPS water_level CSV")
    ap.add_argument("-o", "--out", required=True, help="output tide table CSV")
    ap.add_argument("--datum", default="UNKNOWN",
                    help="datum the download used (must be MLLW for the audit)")
    args = ap.parse_args()

    if args.datum.upper() != "MLLW":
        print(f"WARNING: datum is '{args.datum}', not MLLW. Audit tide heights "
              f"are interpreted as meters above MLLW; a different datum "
              f"silently shifts every corrected depth.", file=sys.stderr)

    with open(args.input, newline="") as fh:
        reader = csv.reader(fh)
        rows = [r for r in reader if any(c.strip() for c in r)]
    if not rows:
        print("ERROR: empty input", file=sys.stderr)
        return 1

    header = [c.strip().lower() for c in rows[0]]
    def find(*names):
        for n in names:
            if n in header:
                return header.index(n)
        return None

    t_idx = find("date time", "t", "datetime", "date")
    v_idx = find("water level", "v", "water_level")
    if t_idx is None or v_idx is None:
        print(f"ERROR: cannot find time/water-level columns in header: {rows[0]}",
              file=sys.stderr)
        return 1

    out_rows, skipped = [], 0
    for r in rows[1:]:
        if len(r) <= max(t_idx, v_idx):
            skipped += 1
            continue
        ts = parse_ts(r[t_idx])
        try:
            val = float(r[v_idx].strip())
        except ValueError:
            skipped += 1  # gap row ('-' or blank in CO-OPS output)
            continue
        if ts is None:
            skipped += 1
            continue
        out_rows.append((ts, val))

    out_rows.sort()
    with open(args.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["timestamp_iso", "tide_height_m"])
        for ts, val in out_rows:
            w.writerow([ts.strftime("%Y-%m-%d %H:%M:%S+00:00"), f"{val:.3f}"])

    if out_rows:
        span = f"{out_rows[0][0].isoformat()} .. {out_rows[-1][0].isoformat()}"
    else:
        span = "(no usable rows!)"
    print(f"wrote {len(out_rows)} rows to {args.out} "
          f"({skipped} skipped), span {span}")
    print("ASSUMPTION: input timestamps are UTC (download used time_zone=gmt). "
          "Make sure the table COVERS the full timestamp range of every "
          "sounding file you audit — the variants interpolate inside the "
          "table and cannot correct outside it.")
    return 0 if out_rows else 1


if __name__ == "__main__":
    sys.exit(main())
