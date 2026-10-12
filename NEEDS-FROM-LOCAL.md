# NEEDS FROM LOCAL — OpenSky Terrain Lane

**For:** the main Muse agent, once the terminal door to Casey's local computer
(the fresh ProArt WSL, tunnel slot 2222 via Oracle) is verified end-to-end.
**From:** the OpenSky Terrain — Z Lane side chat (`3a0b26f2-76a5-49ee-b3c3-d95ff663fc6a`).
**Context:** `~/workspace/opensky-terrain-lane/DIGEST.md` (digest of the Z/GLM pack).
**Casey's direction (2026-10-11):** the program will most likely be **built on the local
computer, where the data already lives** — code travels to the data, not the reverse.
This lane stands by until the inventory below comes back.

Guardrails that hold throughout: Magnus's `Lucineer/OpenSkyFlight` is read-only forever
(listing a local clone's path/remote/commit is fine; never edit, never merge); the
Luciddreamer-ai fork stand-down holds; **Casey's fleet/bathymetry data is private**
(fishing spots — never push it public, never copy bulk data off the machine without
his word; metadata and tiny samples only, per §5).

---

## 1. GATING: the real-data inventory (nothing starts without this)

For every candidate bathymetry file on the machine, report: absolute path, filename,
size, mtime, and a format sniff.

- [ ] **Nobeltec TZPro XYZ exports** — all of them. Per file: header line + first 5 rows,
      delimiter, column layout, line count, and anything stated anywhere (TZPro settings,
      filenames, notes) about **units** (fathoms/meters/feet) and **datum** (MLLW/surface).
- [ ] **Fleet depth tracks** in any form (CSV / GPX / NMEA logs) — per file: same sniff,
      plus timestamps present? (format, range), vessel_id present?, which vessels.
- [ ] **Per-vessel transducer offsets**, if recorded anywhere (TZPro config, notes,
      memory): vessel → offset. The audit proved this is the residual that decides
      whether 1-fathom contours work — it's worth a deliberate hunt.
- [ ] **A known-shoal ground truth:** a charted rock/shoal Casey trusts that the
      fleet/survey tracks actually cross, with its charted depth — the real-data
      Haystack analogue. Without one, the real audit is descriptive, not decisive.
- [ ] **Tide-station truth (local half still open):** NOAA's side is now settled
      (lane verified 2026-10-11 against NOAA/NCEI station tables: **9451600 = Sitka**;
      the pack's 9452210 is Juneau, its 9451054 is Port Alexander — see
      `VERIFICATION.md` §2, same folder as this file). What remains is the local question: which station
      does TZPro / Casey's setup actually have configured? Report what the config says.
- [ ] Any **survey-grade reference** already on disk (pro multibeam, NOAA survey
      XYZ/GeoTIFF) overlapping the fleet area: path, format, coverage.

## 2. INVENTORY NOW (needed right after the audit; cheap to sweep while you're in)

- [ ] **BSB/KAP charts** — the draft manifest names NOAA 17324, 17320, 17322. Present? Paths?
- [ ] **S-57 ENC files** (`.000`) — present? Paths? (Bottom-type source; if absent,
      bottom type is inference-only and the design needs to know.)
- [ ] Any other local geospatial stock: GeoTIFF DEM/bathymetry, NOAA downloads, QGIS projects.

## 3. BUILD ENVIRONMENT on that machine (the program gets built there)

Report versions, don't just say "installed":

- [ ] WSL distro + username + home path + free disk.
- [ ] Python version + venv/pip working; **Variant A baseline**: `numpy scipy matplotlib` importable.
- [ ] **PDAL feasibility (Variant D)**: conda/micromamba present or installable, and
      `python -c "import pdal"` actually succeeding. (In the Z sandbox `pip install pdal`
      failed; conda-forge worked. Verify, don't assume.)
- [ ] Node version (later OSF-fork runtime work), git version + which GitHub account/keys work from the box.
- [ ] GPU: `nvidia-smi` from inside WSL — RTX 4050 visible? (Report only; not a blocker for the audit.
      Matters later for the CuPy/Numba bake.)
- [ ] **A clean project workspace dir** on the machine for this lane's work (suggest a path,
      Casey/main-Muse pick), and the agreed route for code in (git clone / tunnel copy)
      and results out (§5).

## 4. OSF RECON MATERIAL (phase 2 — inventory only, touch nothing)

- [ ] Any local clones of OpenSkyFlight (Luciddreamer-ai fork, jeanjerome upstream,
      Lucineer product): path, remote URL, current commit SHA for each.
      Product repo: metadata only, read-only, as per guardrails above.
- [ ] A vendored `three-tile` copy inside any of those clones (the Z pack's three-tile
      "readmes" were 404 stubs — we have no usable three-tile material yet).

## 5. THE RETURN PACKET (what "done" looks like)

Send this lane (side chat `3a0b26f2-76a5-49ee-b3c3-d95ff663fc6a`) an inventory with:

- The §1–§4 answers as metadata: paths, sizes, header/first rows, line counts, versions.
- A **~20-row sample** of the single best first-audit candidate export (tiny is fine),
  plus — if locatable — the soundings from it near the §1 known shoal.
- A named recommendation: **which one file is the first real audit run**, and why
  (timestamps? vessel IDs? crosses the known shoal? cleanest header?).
- Explicit negatives where true ("no ENC files on the machine", "PDAL not installable
  because X") — an honest negative unblocks design; silence doesn't.

**Acceptance test:** from the packet alone, this lane can (a) pick the first real file,
(b) state its shape (units/datum/timestamps/vessels) or exactly what's unknown about it,
and (c) state where the audit code will run and whether Variant D is viable there.
