# DIGEST — OpenSky Terrain Lane (the Z / GLM session)

**Source:** `briefing/` — 60 files exported from Casey's session with Z (GLM via Z.ai), dated in-pack 2026-10-12.
**Digested:** 2026-10-11 (AKDT). Read order used: `worklog.md` first, `round2-synthesis.md` + `README (16).md` (the human-facing summary) second, then specs/audits, then code and data.
**Standing doctrine applied:** Magnus's `Lucineer/OpenSkyFlight` is read-only forever; nothing here proposes editing it. Any product-bound idea travels only as a suggestion via the Luciddreamer-ai fork's `SUGGESTIONS/` folder, and only on Casey's explicit word. The fork's upstream-merge stand-down holds. Note the pack's own OSF evidence is about the **Luciddreamer-ai fork** (cloned by Z's agents) and the `jeanjerome` upstream — not about Magnus's product repo.

> **Pack-shape warning, up front:** the export is *flattened*. The zip's folder structure (`research/`, `scripts/audit_xyz/`, `scripts/test_data/`, `output_a–d/`) was collapsed into one directory, so files that shared a name collided and got numbered suffixes. 60 files, 58 unique hashes (2 exact-duplicate pairs). Where a file's identity matters below, I identified it by its *contents* (e.g. the `audit_version` field inside each audit report), not by its filename. Several files named in the handoff brief for this lane do **not** exist in the pack under those names — see §F.

---

## A. What the Z session set out to do, in plain words

Design — on paper only, no product code — a **bathymetric game platform for Sitka Sound**: a system that takes real seafloor depth data (a professional survey, plus depth soundings collected by fishing boats as they work) and bakes it into a self-contained **"Region Pack"** that a browser game can stream and render as true-to-scale underwater terrain, with depth contours a fisherman actually reads (the 10 / 5 / 2 / 1-fathom ladder), water you can be on or under, and camera modes for flying, boating, standing on deck, and driving an AUV.

OpenSkyFlight was the starting point and reality check: fork it, keep its terrain/water/contour machinery, replace its flight-sim terrain (land elevation over Sitka) with MLLW-referenced bathymetry, and make the whole thing portable so a second region is "drop in another pack," not a rebuild.

It ran in two rounds:

- **Round 1 — five parallel research memos:** tile format & Region Pack contract; coordinates / portability / project structure; bake pipeline; runtime engine; water + contours + camera.
- **Round 2 — one practical test, built four ways:** a script (`audit_xyz`) that inspects real-world XYZ depth exports and answers one make-or-break question — *the "1-fathom dream":* can fleet-collected soundings support trustworthy 1-fathom contours, or is their tide noise so large that the contours would be spaghetti unless a full crowd-sourced-bathymetry (CSB) correction pipeline runs first? Casey directed explicitly: **no single winner** — build the same audit on four different stacks and compare.

## B. What it actually concluded or decided, with the evidence

### B1. The premise correction everything else rests on

**OpenSkyFlight is not voxel, and does not do bathymetry.** Three separate Round 1 agents independently fetched and read the code and reached the same finding. The proof is in the pack itself: `osf_geoterrainmanager.js` imports `TileMap, TileSource, applyTerrariumElevation` from `three-tile`, uses `dataType: 'terrarium-shader'` with AWS Terrarium PNG tiles (max level 15), and converts lat/lon with an explicit Web Mercator `latLonToMercator()` (`EARTH_RAD = 6378137`). OSF is a raster-heightmap flight sim on Three.js r0.183 WebGPU/TSL. The voxel premise was retired (voxels reserved only for a possible future volumetric water-column layer).

### B2. Round 1 architecture conclusions (converged across agents, not yet built or spiked)

1. **Runtime: fork OpenSkyFlight; Three.js r0.183 (pinned) + WebGPURenderer/TSL + vendored three-tile.** Babylon rejected (no three-tile equivalent); CesiumJS rejected decisively — Cesium's own team has said since 2013 that subsurface rendering is unsupported, and its bathymetry issue has been open since 2018, which kills it for an AUV product. OSF already contains most of what's needed: the `fwidth`/`smoothstep` contour-isoline shader (today at 50/100/500 m — rebinding it to 10/5/2/1 fm is a uniform change), depth-coloured water, capability tiers, a games-as-pages catalogue.
2. **Coordinates: per-Region-Pack local ENU tangent plane; WGS84 lat/lon only at ingest/storage.** The decisive number: Web Mercator stretches east–west by `1/cos(57°) = 1.836×` at Sitka's latitude — tolerable for a flight sim that never touches the water, a correctness bug for depth, drift, collision and contour spacing. ENU origin, datum and geoid are declared in each pack's `manifest.json`; each pack is self-contained; ECEF "globe mode" for cross-region flight is a v2+ additive layer, not v1.
3. **Tile format (R&D-1's recommendation): hybrid.** Quantized-mesh-1.0 as the terrain pyramid, extended with two custom per-vertex extensions — `bathymetry-bottomtype` (id 5) and `bathymetry-confidence` (id 6) — plus 3D Tiles 1.1/glTF for non-terrain features (soundings, fleet tracks, harbour structures), plus a Terrarium-PNG layer as low-LOD fallback / minimap / overview. The full draft Sitka `manifest.json` (bbox, `contourIntervalLodMap`, per-source `sourceProvenance` with confidence tiers pro-multibeam 240–255 / fleet 80–160 / interpolated 0–60) is in `round1-tile-format-and-region-pack.md`. **This is a recommendation, not a freeze — see the open tension in §D.**
4. **Datum contract: the bake emits a static seafloor referenced to MLLW; the runtime owns the tide.** Bake stays deterministic; sea surface = MLLW + tide(t) at runtime (v1: tide = 0; v2: single-station harmonics; v3+: spatial tide field). Internal units meters, display fathoms.
5. **Vertical exaggeration is a render-only shader uniform, never physics.** Physics always runs on the true depth field. (The actual per-mode *values* contradict each other across memos — §D.)
6. **Bake pipeline: Python** (rasterio/GDAL + pyproj + CuPy + Numba-CUDA hot kernels, Click CLI, declarative `region.yaml`), baking on the RTX 4050 class box; regular grid at bake time (UTM 8N in R&D-2's design), quadtree is a runtime primitive only; per-cell provenance + confidence grids carried alongside depth.
7. **Water/contours/camera are additive to OSF, staged:** v1 extend OSF's flat water plane (transparency/roughness, DoubleSide, a shared `WaterInterface` submersion abstraction), v2 Gerstner waves, v3+ optional FFT; contours purely as fragment-shader isolines owned by an `LODCoordinator` (mesh / chart / contour are three independent LOD axes, each with hysteresis); camera as a formal State-pattern FSM (FreeFly / Boat / Deck / AUV) with character-on-deck as a lazy-loaded module v1 can ship without.
8. **Licensing recommendation:** code Apache-2.0; NOAA-derived data CC0; fleet/community-derived data CC-BY-4.0, declared per pack; CC-BY-SA and GPLv3 explicitly rejected as poisoning the commercial-fleet use case. **Recommendation only — `README (16).md` states final licensing is still pending Casey's decision.**

### B3. Round 2 audit conclusions (the only part that was built and run)

All four variants implemented the same `AUDIT_SPEC.md`, ran against the same **synthetic** test set (5,250 soundings: clean survey in meters/MLLW, fleet tracks in fathoms/surface-datum with tide noise injected, a headerless legacy file; a known test shoal, "Haystack Rock" at −135.43, 57.05, true depth 5.5 m MLLW = 3.007 fm), and **all four passed self-verification 4/4** — units 3/3, datum 3/3, Haystack diagnostic correct, the 50 injected duplicates found. Verified here against the audit reports actually in the pack (each report's internal `audit_version` matches its memo).

Findings all four agree on:

1. **The 1-fathom dream requires the full CSB pipeline.** Tide correction alone collapses fleet Haystack spread from **0.976 fm to 0.20–0.45 fm** (per variant, see table) — a big drop, but **not** to the fleet noise floor (the pack variously states that floor as ~0.1 fm, ~0.3 fm, or 0.2 fm depending on file; the *direction* is unanimous). The residual is per-vessel transducer-offset bias (synthetic offsets: 0.5 m skiff, 1.2 m troller), which no tide lookup removes. So: per-sounding tide lookup + per-vessel offset correction + MLLW gridding, or no trustworthy 1-fm contours in fleet data.
2. **Tide-sign convention is a genuine trap, caught only because four variants ran.** The synthetic generator uses the *inverted* convention `depth_surf = true_mllw − tide + offset` (depth/tide correlation r ≈ −0.91 to −0.98). Variants B and D both shipped a textbook-sign correction first, watched spread get *worse*, and fixed it with sign-agnostic fitting (OLS regression: `corrected = depth − b·tide`, `b` fitted). **Design rule carried forward: the bake's tide stage must fit the sign, never hardcode it.**
3. **COPC is the bake's storage/ingest layer, empirically.** Variant D's audit emitted COPC/LAZ archives at **20–25× compression** (262 KB → 10.4 KB fleet; 459 KB total → 22.7 KB), beating the ~10× estimate, with spatial random access verified (bbox query returned 1,230 of 2,700 fleet points without a full scan). The audit *is* a dry run of bake Stage 1.
4. **Pluralistic verdict, per Casey's directive — no winner.** The four variants compose into roles (table in §C). The synthesis recommends shipping all four, each in its lane.

### B4. Contradictions inside the pack — which file wins, and why

- **Tide station ID — three different "Sitka" stations.** The audit spec, generator, ground truth, all four scripts and all four reports use **9452210**; R&D-5 (coords) uses **9451600**; R&D-2 (bake) uses **9451054** (Sitka) / 9451660 (Wrangell). *Winner inside the pack: 9452210* — it's the load-bearing, repeated, tested one. *But none of the three is verified against real NOAA CO-OPS data anywhere in the pack,* so no ID should be baked until it's checked against NOAA. Flagged open in §D.
- **Variant D's corrected spread: worklog vs its own report.** The worklog's R2-VD entry quotes 0.197 fm (an interim debugging number); D's final `audit_report.json`/`.md` say **0.4475 fm**. *Winner: the final report* (it's the artifact the self-verification ran on), and the synthesis table agrees with it. Same pattern, smaller: variant C's report prose claims a drop "to ~0.1 fm" while its own JSON says **0.1957 fm** — JSON wins.
- **Variant B's survey datum field.** B's JSON lists `survey_mllw.csv` datum as `unknown` (only 2 Haystack soundings — Pearson is degenerate at n=2) while its memo claims datum 3/3. Both are "true" under the spec's loose matching, but the honest reading is: **B's Haystack-only datum detection failed on the sparse survey file and was rescued by other signals in the other variants** (A: corrected-used fallback; C: whole-file fallback; D: low-sample assumed-MLLW). Sparse-anchor fragility is a real finding, not a pass to file away.
- **Legacy-file datum.** Ground truth says MLLW; the spec says report `unknown` without timestamps. Variants split (unknown / MLLW-assumed) and all were accepted. Not a disagreement about the data — a spec that deliberately accepts either answer.
- **Bake vs tile/runtime on the runtime tile encoding.** R&D-2 initially recommended EPSG:3857 Terrarium tiles for OSF compatibility, then *in its own memo* flagged that as directly conflicting with R&D-1/R&D-5's ENU rejection of Mercator and **leaned to ENU (option b)**. R&D-3 simultaneously claims a Terrarium-baked pack "plugs in with zero terrain-engine changes." Both can't be the plan: ENU quantized-mesh means a custom decoder (~150–250 LOC) and forking three-tile off Mercator; Terrarium/Mercator means zero-change reuse and 1.84× distortion. *No winner was declared — this was explicitly deferred to a Round 2 decision that the audit round never took.* It's the largest unresolved fork in the design (§D).

## C. The four audit variants compared — what each one is FOR

| | A — Minimal | B — Scientific | C — Modern | D — PDAL |
|---|---|---|---|---|
| **Stack** | numpy + scipy + matplotlib, stdlib ingest | pandas + scipy + scikit-learn + matplotlib | polars + DuckDB + altair (+ vl-convert) | PDAL C++ 2.10 via conda/micromamba + Python wrapper, matplotlib for PNGs only |
| **Install** | `pip`, 3 wheels, ~50 MB | `pip`, ~250 MB of wheels | `pip`, ~80 MB incl. a 30 MB Rust binary | `pip install pdal` **fails** (needs system libpdal); micromamba + conda-forge env, ~250 MB |
| **Runtime, 5,250 pts** | 2.13 s | 4.9 s | 4.5 s | **0.22 s** |
| **Fleet Haystack spread after tide correction** | 0.976 → 0.405 fm | 0.976 → 0.402 fm | 0.976 → **0.196 fm** | 0.976 → 0.448 fm |
| **Self-verification** | 4/4 | 4/4 | 4/4 | 4/4 |
| **Bonus delivered** | none | GPR variance-map PNG | Single DuckDB SQL query does the whole cross-file Haystack diagnostic | COPC archives per file (20–25× compression, spatial-indexed) |
| **What it's FOR** | **The field tool.** The one Casey runs at the dock on a Windows laptop, no internet, no conda — single ~620-line-readable script (file in pack is 1,279 lines with comments/docstrings), spot-check a TZPro export on the boat. | **The confidence layer.** Its GPR variance map is a literal mock-up of the per-vertex `bathymetry-confidence` channel the tile format wants to carry — the only variant that demos that end-to-end. | **Fleet-wide scaling.** Polars lazy + DuckDB disk-spilling is the pattern that survives 100M+ soundings across Southeast Alaska where pandas runs out of memory; SQL makes new audit questions cheap to add. | **The bake pipeline's ingest stage.** Outlier removal, stats and COPC output *are* bake Stage 1; its output files are drop-in Region Pack assets, not throwaway reports. |
| **Key weakness** | No streaming (~100k pts/file ceiling), equirectangular not ENU, datum detection falls back to a weak signal when Haystack samples are sparse | No real kriging (GPR is a generic regressor), heaviest pure-Python install for a small problem | Hardcoded synthetic-tide extension for out-of-range timestamps (production needs a real NOAA fetch); altair PNG depends on vl-convert | Needs a ~20-line Python normalisation shim before PDAL can touch heterogeneous CSVs; PDAL metadata quirks across versions; conda is mandatory; the tide diagnostic itself is necessarily Python-side |

## D. State of the design

### Settled (converged, and where tested, evidence-backed)

- OSF's real architecture (Terrarium + three-tile + Three.js/TSL, not voxels) — proven from source in the pack.
- Runtime direction: fork OSF, pin Three.js r0.183, reject Babylon and Cesium (subsurface gap).
- Web Mercator rejected for bathymetric work at 57°N (1.836×); ENU per pack, WGS84 at ingest, meters internal / fathoms displayed.
- Bake/runtime datum contract: static MLLW seafloor from the bake, runtime owns tide; exaggeration render-only, physics on true depths.
- Contour interval *is* the LOD metric: 10/5/2/1 fm ladder, shader isolines, three independent LOD axes.
- The audit's core answer: **1-fathom contours from fleet data require the full CSB pipeline**; tide correction must be sign-agnostic.
- COPC as the ingest/storage format for soundings (20–25×, spatially indexed) — measured, not claimed.
- Audit tooling shape: four variants, four lanes, no winner — they compose.

### Still open

- **Tile-format freeze** (the big one): ENU-local quantized-mesh (R&D-1's hybrid, custom decoder + three-tile fork) vs Terrarium/Mercator compatibility (R&D-3's zero-change path). R&D-2 leans ENU; nobody spiked the 2-tile ENU prototype R&D-2 proposed, and Round 2 never took the decision. Everything downstream — manifest final form, contour-baking frame, tile encoder — waits on this.
- **Real data shape.** Everything in Round 2 ran on synthetic data built to a guessed spec. The real Nobeltec TZPro export — units, datum, header, messiness — has never been seen by any agent here. Until it is, Stage-1 normalisation cannot actually be written.
- **Which Sitka tide station** (9452210 vs 9451600 vs 9451054, §B4) — unverified against NOAA.
- **Underwater rendering at the iPad bar.** AUV water-from-below (DoubleSide water, fog, ceiling) is unproven at OSF's performance target; two memos call for the same Round-2 spike (extend `OceanSurface.js`, 2-tile test region, measure on target iPad). It was not done.
- **Vertical-exaggeration values & the tide interaction.** R&D-1's manifest: fly 2.0×, everything else 1.0. R&D-5: fishing 1.0–1.2×, Sail-and-Sink 2–3×, AUV 4–6×, fly 1.5×. Round 2 synthesis claims pins "already locked": fly 3–8×, AUV 1.0. Three incompatible tables, plus the unanswered question of whether tide gets exaggerated with the seafloor or stays true-scale.
- Secondary-channel encoding: per-vertex bottom-type on a simplified TIN (boundary smearing) vs a parallel PNG layer; three-way land/intertidal/submerged watermask vs the binary standard extension; chart-raster ↔ terrain LOD alignment.
- Precision/geometry details: float32 at 90 km (~6 mm at the far edge — RTC rendering or float64 CPU side?), baking the ~196 m ENU curvature bulge across the region and round-trip-testing it, quantized-mesh header staying ECEF-for-spec-compliance while vertices are local.
- Project-level: licensing (recommendation made, Casey's decision pending), fleet-data privacy flag for trade-secret spots (a contract question that gates commercial use), governance (BDFL suggested), WebGL2 fallback scope, whether PDAL/conda installs cleanly on Casey's actual hardware, sidescan "evocative vs authentic" (a product question for Casey, flagged by R&D-4).

### The single next decision Casey faces

**Put a real XYZ export in the lane's hands — point to (or drop in) an actual Nobeltec TZPro / fleet export to run all four audits against.**

Every document in the pack sequences it this way (synthesis next-step 1; zip README next-step 1): the synthetic run was a dry run, the Region Pack spec is explicitly *third* (after the real-data audit and a time-boxed OSF recon), and the tile-format freeze needs the real data's units/datum/shape as an input. Nothing else on the open list can be honestly settled first — and nobody but Casey holds the real data. One export is enough to start; a known real shoal in it (a local Haystack equivalent) would make the run decisive rather than merely descriptive.

## E. File map of the briefing pack (60 files)

Load-bearing = the session's own decisions, code, data or proof. Reference = fetched upstream material / generated output kept for provenance.

| File | What it is | Kind |
|---|---|---|
| `worklog.md` | The session's spine: all 9 task entries (R&D-1–5, R2-VA/VB/VC/VD, R2-SYNTH) with decisions and numbers | Load-bearing |
| `README (16).md` | The zip's top-level README: contents, how to read it, variant-picker, key findings, next steps | Load-bearing |
| `round2-synthesis.md` | Orchestrator's Round 2 synthesis: side-by-side table, 3 cross-variant findings, pluralistic roles, next steps | Load-bearing |
| `round1-tile-format-and-region-pack.md` | R&D-1 memo: hybrid tile format, full draft Sitka `manifest.json`, ENU case, 8 open questions | Load-bearing |
| `round1-coords-portability-project.md` | R&D-5 memo: ENU/datum/tides, portability, monorepo structure, Apache-2.0 + CC0/CC-BY licensing | Load-bearing |
| `round1-bake-pipeline.md` | R&D-2 memo: Python/GPU bake stack, 10-stage flow, CLI sketch; flags its own Mercator↔ENU conflict | Load-bearing |
| `round1-runtime-engine.md` | R&D-3 memo: fork-OSF / Three.js verdict, Cesium & Babylon rejections, runtime sketch | Load-bearing |
| `round1-water-contour-camera.md` | R&D-4 memo (longest, 48 KB): water v1→v3, `WaterInterface`, `LODCoordinator`, camera FSM, deck separation | Load-bearing |
| `round2-audit-variant-a-minimal.md` | Variant A memo: stack, the two self-verify fixes (sparse-Haystack fallback, correctable-ratio path), results | Load-bearing |
| `round2-audit-variant-b-scientific.md` | Variant B memo: OLS sign-agnostic fix, GPR variance-map bonus, results | Load-bearing |
| `round2-audit-variant-c-modern.md` | Variant C memo: dual-ASOF tide interpolation fix, DuckDB SQL bonus, results | Load-bearing |
| `round2-audit-variant-d-pdal.md` | Variant D memo: conda install path that worked, 5 PDAL API quirks, COPC demonstration | Load-bearing |
| `AUDIT_SPEC.md` | The shared Round 2 spec all four variants implemented (requirements, JSON schema, CLI, self-verification) | Load-bearing |
| `opensky_quantized_mesh_spec.md` | Cesium quantized-mesh-1.0 spec, fetched in full (header/vertex/extension layouts; ids 1, 2, 4 taken, 5/6 free) | Reference |
| `variant_a_minimal_numpy.py` | Variant A code, 1,279 lines, single file | Load-bearing |
| `variant_b_scientific.py` | Variant B code, 1,362 lines | Load-bearing |
| `variant_c_modern.py` | Variant C code, 1,399 lines | Load-bearing |
| `variant_d_pdal.py` | Variant D code, 1,583 lines (Python wrapper around PDAL) | Load-bearing |
| `variant_d_pdal_pipeline.json` | D's reference PDAL pipeline (readers.text → stats → outlier → stats → writers.copc) | Load-bearing |
| `generate_synthetic_xyz.py` | Generator for all synthetic test data (seed 42); line 124 holds the inverted tide-sign convention | Load-bearing |
| `ground_truth.json` | Expected audit findings + Haystack truth (5.5 m MLLW) the self-verifications ran against | Load-bearing |
| `README.md` | Test-data README: per-file truth table, the 1-fathom-dream diagnostic explained | Load-bearing |
| `survey_mllw.csv` | Synthetic clean survey: 2,050 pts, meters, MLLW, 50 injected duplicates | Load-bearing (data) |
| `fleet_tracks.csv` | Synthetic fleet tracks: 2,700 pts, fathoms, surface datum, 2 vessels, tide noise | Load-bearing (data) |
| `legacy.xyz` | Synthetic legacy file: 500 pts, whitespace, no header/timestamps, fathoms | Load-bearing (data) |
| `synthetic_tide_table_sitka.csv` | Synthetic tide table: 24 h at 6-min intervals, 5 m range (stands in for NOAA station data) | Load-bearing (data) |
| `survey_mllw.copc.laz` | Variant D output: COPC archive of the survey file (~10 KB) | Reference (output) |
| `fleet_tracks.copc.laz` | Variant D output: COPC archive of fleet tracks (~10 KB, 25× compression) | Reference (output) |
| `legacy.copc.laz` | Variant D output: COPC archive of legacy file (2.7 KB) | Reference (output) |
| `audit_report.md` | Variant **D** report (identified by internal `audit_version: R2-variant-D`) | Reference (output) |
| `audit_report.json` | Variant **D** report JSON, overall_pass = true | Reference (output) |
| `audit_report (9).md` | Variant **A** report | Reference (output) |
| `audit_report (6).json` | Variant **A** report JSON (435 KB — embeds the full 50×50 density grids) | Reference (output) |
| `audit_report (14).md` | Variant **B** report | Reference (output) |
| `audit_report (11).json` | Variant **B** report JSON | Reference (output) |
| `audit_report (4).md` | Variant **C** report | Reference (output) |
| `audit_report (1).json` | Variant **C** report JSON | Reference (output) |
| `gpr_variance_map.png` | Variant B's bonus: GPR predicted-depth + predictive-std map around Haystack — unique to B | Reference (output) |
| `density_heatmap (10).png` | Variant A density heatmap (960×840, dimensions match A's memo) | Reference (output) |
| `tide_state_distribution (8).png` | Variant A tide-state distribution (1080×720, matches A's memo) | Reference (output) |
| `haystack_spread (7).png` | Variant A Haystack spread plot (1200×720, matches A's memo) | Reference (output) |
| `density_heatmap (5).png` | Variant C density heatmap (1430×928; size matches C's memo) | Reference (output) |
| `tide_state_distribution (3).png` | Variant C tide-state distribution (1618×1400; size matches C's memo) | Reference (output) |
| `haystack_spread (2).png` | Variant C Haystack spread plot (1468×1054; size matches C's memo) | Reference (output) |
| `density_heatmap.png` | One of variants B/D density heatmaps (1800×600) — flattening destroyed the attribution | Reference (output) |
| `density_heatmap (15).png` | The other of B/D density heatmaps (1779×596) — attribution not recoverable | Reference (output) |
| `tide_state_distribution.png` | One of B/D tide-state distributions (1800×480) — attribution not recoverable | Reference (output) |
| `tide_state_distribution (13).png` | The other of B/D tide-state distributions (1189×478) — attribution not recoverable | Reference (output) |
| `haystack_spread.png` | One of B/D Haystack spread plots (960×600) — attribution not recoverable | Reference (output) |
| `haystack_spread (12).png` | The other of B/D Haystack spread plots (1069×581) — attribution not recoverable | Reference (output) |
| `osf_geoterrainmanager.js` | OSF (Luciddreamer-ai fork) terrain manager source — the in-pack proof of Terrarium + TSL + Mercator, not voxels | Load-bearing (evidence) |
| `osf_terrain_dir.json` | GitHub API listing of OSF's `js/terrain/` dir (GeoTerrainManager + OceanSurface entries) | Reference |
| `openskyflight_readme_main.md` | Luciddreamer-ai fork README ("Sitka Skies — OpenSkyFlight") | Reference |
| `openskyflight_readme_master.md` | Byte-identical duplicate of the above (same hash) | Reference (duplicate) |
| `osf_upstream_readme.md` | jeanjerome upstream OpenSkyFlight README — a different, older document than the fork's | Reference |
| `cesium_3dtiles_readme.md` | Cesium 3D Tiles repo README, fetched as spec reference | Reference |
| `joerd_formats.md` | Mapzen/Tilezen joerd formats doc: Terrarium decode `(r*256+g+b/256)−32768`, plus Normal/GeoTIFF/Skadi | Reference |
| `three_tile_readme.md` | **Not a readme — a 14-byte `404: Not Found` stub** (failed fetch) | Reference (broken) |
| `three_tile_readme_main.md` | Byte-identical duplicate of the same 404 stub | Reference (broken) |
| `three_tile_repo_meta.json` | GitHub API **404 JSON** for a three-tile repo lookup — another failed fetch, kept as-is | Reference (broken) |

## F. Referenced by the pack but NOT in the pack (missing pieces)

1. **The real data — the biggest gap.** No actual Nobeltec TZPro export, no real fleet tracks/GPX, no real NOAA tide table (only the 24-hour synthetic one — which doesn't even cover the fleet file's timestamps, forcing variant C's hardcoded harmonic-extension workaround). Everything the next step needs is absent by design: it's Casey's data, still on his side.
2. **The raw Z conversation.** The pack has the worklog and memos, not the transcript. Anything Casey said that didn't make a memo — including the **full text of his "Round 2 critique"** — survives only as paraphrase (the two "locked pins" in the synthesis, the ~10× COPC estimate, the no-winner directive, PDAL/GPR/DuckDB lane suggestions all cite a critique that isn't in the pack).
3. **The handoff brief's filenames that don't exist here.** No `threetile.py` / `pipelining.py` / `config.py` / `main.py` / `state.py` (the Python in the pack is the four audit variants + the generator), no `countdowntoolkit.md`, `stac-itinerary.md`, `stac-catalog.json`, `the-md-file-standard.md`, no `basin_reflow_legacy.*`, no `round2-plan-audit-orchestrated.md` or `round2-audit-summary-for-human.md` (their role is played by `round2-synthesis.md` + `README (16).md`), and the extra round-1 files in the brief correspond to the five `round1-*.md` memos actually present. Either those names belong to a different/larger export, or the brief was written from memory of the conversation rather than from this zip.
4. **OpenSkyFlight source beyond one file.** Memos cite having read `OceanSurface.js`, `SceneSetup.js`, both camera controllers, `GameRuntime.js`, `games.js`, `app.js`, `package.json`, `BENCHMARKS.md`, and three-tile's `TileMaterial.ts` / `TerrariumTSL.ts` / `Martini.ts`. **None are in the pack** — only `GeoTerrainManager.js` is, plus a directory *listing* (`osf_terrain_dir.json`) that names `OceanSurface.js` without containing it. Claims about OceanSurface's internals and the contour shader rest on the memos alone.
5. **three-tile documentation/code.** Both "readmes" are 404 stubs and the repo-meta file is a 404 response (§E). There is no usable three-tile material in the pack at all.
6. **Raw research provenance.** The web-search result sets the memos cite as saved (`research/ws_*.json`, `research/_search_*.json`, `/tmp/search_*.json`) are not included.
7. **The original folder structure / per-variant output dirs.** `output_a–d/` were flattened into one folder; report identities were recoverable from file contents, but six of the twelve PNGs can no longer be attributed to a variant with confidence (§E).
8. **Inputs the design assumes but nobody has supplied yet:** BSB/KAP chart files (NOAA 17324/17320 named in the draft manifest), S-57 ENCs for bottom type, a real Region Pack (no `layer.json`, no `.terrain` tiles, no baked pack of any kind exists), and the proposed `region-pack-spec/tile-format.md` and governance docs — all referenced as future work, none present.
9. **Any runtime or bake code for the new platform.** Round 1 is memos only; the only runnable code in the pack is the Round 2 audit set and its synthetic-data generator.

---

## Addendum — 2026-10-11 evening (independent verification pass)

Full detail in `VERIFICATION.md`; kit in `audit-kit/`. Three results change the picture above:

1. **The station question in §B4/§D is now settled from NOAA's side.** Checked against NOAA/NCEI CO-OPS station tables: **9451600 = Sitka** (R&D-5 was right); **9452210 = Juneau** — the ID the audit spec, generator, ground truth and all four scripts call "Sitka" is the wrong city; **9451054 = Port Alexander** (the bake memo's "Sitka"). Still open: which station Casey's TZPro is configured to use (a local-config item in the inventory). Every "9452210 = Sitka" statement in §§B–D above should be read with this correction.
2. **The pack's Round 2 numbers reproduce — all four variants.** Re-run here on the synthetic data, all pass 4/4 with their published corrected spreads to the digit (A 0.4046, B 0.4015, C 0.1957, D 0.4475 fm; D on a locally built PDAL 2.10.2 conda env, COPC archives produced). The kit copies pass identically.
3. **The scripts as shipped cannot audit real data correctly** — two synthetic-only traps, both fixed in `audit-kit/` copies (briefing originals untouched): the reference shoal is hardcoded in all four variants with no CLI option (kit: `AUDIT_SHOAL_*` env vars), and Variant C fabricates out-of-range tides from the test generator's sine — measured to be load-bearing for C's synthetic pass and disqualifying for real data (kit: gated off by default; real runs bring a full NOAA table via `prep_noaa_tide.py`).

---

*Digest ends. No build work was done; Magnus's product repo was not touched, proposed for editing, or contacted. This lane stands by for Casey's steer — the gating item is §D's next decision (a real XYZ export to audit).*
