#!/usr/bin/env python3
"""
fetch_tide.py — pull predicted/verified water levels for the configured
NOAA station from the public CO-OPS API and write the audit-schema tide
table (timestamp_iso, tide_height_m), datum MLLW, GMT, metric.

The range covers the soundings' full timestamp span plus a 1-day margin on
both ends — the project's never-clamp invariant is enforced by
construction here, and the CSB stage double-checks it.
Requests are chunked at 30 days (CO-OPS per-call limit for 6-minute data).
"""
import io
import urllib.request
from pathlib import Path

import pandas as pd

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


def fetch_tide(station: str, begin: pd.Timestamp, end: pd.Timestamp,
               out_csv: Path) -> pd.DataFrame:
    chunks = []
    cur = begin
    while cur <= end:
        chunk_end = min(cur + pd.Timedelta(days=30), end)
        url = (f"{API}?product=water_level&application=shoalwater"
               f"&begin_date={cur.strftime('%Y%m%d')}&end_date={chunk_end.strftime('%Y%m%d')}"
               f"&datum=MLLW&station={station}&time_zone=gmt&units=metric&format=csv")
        with urllib.request.urlopen(url, timeout=120) as resp:
            text = resp.read().decode()
        df = pd.read_csv(io.StringIO(text))
        df.columns = [c.strip() for c in df.columns]
        chunks.append(df)
        cur = chunk_end + pd.Timedelta(minutes=6)
    raw = pd.concat(chunks, ignore_index=True)
    out = pd.DataFrame({
        "timestamp_iso": pd.to_datetime(raw["Date Time"]).dt.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "tide_height_m": raw[" Water Level"].astype(float) if " Water Level" in raw
        else raw["Water Level"].astype(float),
    }).drop_duplicates("timestamp_iso").sort_values("timestamp_iso")
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_csv, index=False)
    print(f"Tide: station {station}, {len(out)} rows, "
          f"{out['timestamp_iso'].iloc[0]} .. {out['timestamp_iso'].iloc[-1]} -> {out_csv}")
    return out
