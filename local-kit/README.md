# Shoalwater — Local Kit (runs on your laptop, next to your data)

This kit processes **your** bathymetric data on **your** machine. Nothing is
uploaded anywhere. The only network call is fetching the public NOAA tide
table. At the end you get a validated Region Pack of your own bottom plus a
browser preview of it — and three small report files to send back.

## 1. Put your files in `data-in/`

- **Your soundings export** (CSV) — from TZ Pro or wherever your tracks live.
  One row per sounding. Rename it (or set `soundingsFile` in `config.json`)
  so the kit finds it. If it's XYZ with a different extension, CSV content
  with a header row is what the kit reads.
- **Your raster charts** (`.kap` / `.bsb`) — optional. The kit inventories
  them (name, number, scale, bounds) in this version; full chart rendering
  is a later stage.
- **A reference file** (optional, CSV) — your most trusted depth layer over
  the same water (a careful survey export, or chart-derived soundings).
  Providing it enables the full correction fit (Mode B below).

## 2. Edit `config.json` (two minutes)

- `columns` — the names YOUR file uses for longitude, latitude, depth,
  timestamp, vessel. The defaults (`Lon`, `Lat`, `Depth`, `DateTime`,
  `Vessel`) are guesses; match them to your header row exactly.
- `depthUnit` — `"m"`, `"fm"` (fathoms), or `"ft"` — the unit of your depth
  column as exported.
- `depthsAlreadyCorrected` — **the one that matters most.**
  - `true` if your software already applied tide and transducer offsets
    when exporting (TZ Pro does this when tide is configured). The kit then
    grids and bakes what you exported (Mode A).
  - `false` if the depths are raw surface soundings. Then:
    - with a reference file → Mode B: the kit fetches the NOAA tide table
      for station **9451600 (Sitka — not 9452210, that's Juneau)** and fits
      the tide coefficient and each vessel's transducer offset against
      your reference.
    - without one → Mode C: tide-only correction, offsets unknown; the
      report says so and depths carry that caveat.
- `timestamp` values must be **GMT/UTC**. If your export is local time,
  say so when you send the report back — don't silently convert.
- `origin` — the pack centre (default: Sitka Sound). Version 1 of the kit
  targets Sitka Sound; leave it unless your data is elsewhere in the Sound.

## 3. Run it (PowerShell, in this folder)

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

First run creates a private Python environment and installs numpy/pandas/
scipy (needs internet once). Later runs are quick. The pipeline refuses to
guess: if a column name doesn't match, it stops and tells you exactly which
one and what your file actually has.

## 4. See your bottom

When it finishes:

```powershell
.\.venv\Scripts\python.exe -m http.server 8765 --directory outputs
```

Then open <http://localhost:8765/> — orbit your own seafloor, raise the
tide, switch contour modes. Same viewer as the public demo, pointed at
your pack.

## 5. Send back (small files only — never your raw soundings)

- `outputs/reports/RUN-REPORT.md`
- `outputs/inventory.json`
- `outputs/reports/csb_report.json` (Mode B only)

That's enough to verify the run, compare against the charts, and plan the
next stage. Your raw data, your pack, and your fishing spots stay on this
laptop.

## Notes / current limits

- Raster charts are inventoried, not yet rendered into the world (next
  stage). The BSB/KAP headers alone already confirm chart numbers, scales,
  and coverage against your soundings.
- The COPC archive stage from the public pipeline is not in this kit yet
  (PDAL on Windows is its own project); the pack does not depend on it.
- The RTX GPU is not used by this pipeline — it's CPU-light. The GPU's turn
  comes with the render/performance work in the sim itself.
