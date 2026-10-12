# Region Pack Spec v0.1 (DRAFT — assembled 2026-10-11)

**Provenance:** drafted by MiniMax (two passes: full draft + deepened §§2/4/5),
assembled and corrected by Muse against the lane's *verified implementations*.
Where a draft disagreed with working code, the code won. Reviewer corrections:

1. **Extension IDs** — drafts swapped them twice. Settled by `fleet/qm_ref.py`
   (roundtrip-verified): **id 5 = bottom-type, id 6 = confidence**.
2. **Extension byte layouts** — drafts specified uint16 confidence + reserved
   padding. The implemented, tested format is **uint8 per vertex, no padding**.
3. **Manifest schema** — the draft's example did not match any checkable
   contract. §3 now points at `example-pack/manifest.json`, which **passes**
   `fleet/validate_pack.py --tiles` (and the validator was itself fixed once:
   it read the LodMap's values, not its keys, as the contour ladder).
4. **§5 altitude bands** — draft bands overlapped across modes; replaced with
   non-overlapping bands. Budgets remain draft values pending the fork spike.
5. **§6 invariants** — two added from the 2026-10-11 CSB verification:
   the tide-coverage rule and the flat-bottom calibration rule (§6.2).

---

## 1. Purpose and Scope

A **Region Pack** is a self-contained, standardized data package encapsulating
everything the runtime needs to render and interact with one geographic region
of seafloor: terrain tiles, metadata, and configuration. A Region Pack is:

- **Not a live data feed** — a static, versioned, content-hashed snapshot.
- **Not a global dataset** — one pack per region; multi-region comes from many
  packs, each with its own local frame.
- **Not user-generated content** — packs are produced only by the bake pipeline
  (§6) and must pass conformance (§7) before the runtime will load them.

## 2. The Tile-Format Decision

### 2.1 Decision matrix

| Metric | Option 1: Quantized-Mesh + local ENU + extensions | Option 2: Terrarium PNG / Web Mercator | Option 3: Hybrid (QM + 3D Tiles/glTF + Terrarium overview) |
|---|---|---|---|
| Metric correctness at 57°N | **High** — local ENU eliminates Mercator's 1.836× E-W stretch | **Low** — 1.836× distortion built in | High |
| Decode cost | Medium — custom JS decoder (~250 LOC est.) | Low — existing path | High — three formats |
| LOD fit to 10/5/2/1 fm ladder | **Excellent** — geometric-error tiers bind directly to the ladder | Poor — distortion fights the ladder | Good |
| Secondary-channel carriage | **Good** — extensions id 5/6, measured +2 B/vertex raw (~190 B gz per 225-vertex tile) | Poor — parallel PNG layers | Excellent |
| Implementation risk | Medium — decoder + three-tile fork (~950–1,250 LOC per fork report) | Low — zero-change reuse | High |
| Multi-region portability | **High** — per-pack ENU origin in manifest | Low — distortion varies by latitude | High |

### 2.2 Recommendation (v1 freeze)

**Option 1: quantized-mesh-1.0 with local-ENU vertex storage and the two
custom extensions.** Metric correctness is the product (contours a fisherman
can trust); the LOD ladder binds natively; the extensions carry bottom-type
and confidence at measured, trivial cost; the fork risk is bounded and now
scoped by a source-level report (`THREETILE-FORK-REPORT.md`).

### 2.3 Revisit triggers

- Decoder or fork performance proves a bottleneck on target hardware
  [NEEDS REAL DATA — iPad].
- The three-tile fork proves unmaintainable in the spike (see fork report
  go/no-go).
- A global/ECEF mode becomes a requirement (deferred to v2+ regardless).

## 3. Manifest Schema

The canonical, machine-checked example is **`example-pack/manifest.json`**
(Sitka Sound v1): it declares region + EPSG:4326 bounding box; storage CRS
WGS84 with a runtime ENU frame whose origin (−135.43, 57.05) lies inside the
box; vertical datum MLLW at NOAA station **9451600** (Sitka — 9452210 is
Juneau and validators must reject it); the terrain layer
(`quantized-mesh-1.0`, `tiles/{z}/{x}/{y}.terrain`) and supported extensions;
confidence tiers (pro multibeam 240–255, fleet 80–160, interpolated 0–60);
the contour ladder in both forms (`contourIntervals: [10,5,2,1]` and
`contourIntervalLodMap` mapping each interval to its max geometric error in
meters, §5.2); `defaultByCameraMode` (freeFly 10, boat 5, deck 2, auv 1);
render-only `verticalExaggeration`; per-source provenance with confidence
and licensing; license block (code Apache-2.0, data CC-BY-4.0 — share-alike
data licenses are rejected); a `privacy` flag (`public`/`private`, for fleet
data); and versioning with a real `sha256:` content hash. The example pack's
root tile is a genuine tile encoded by the reference implementation.

## 4. Custom Quantized-Mesh Extensions (as implemented in `fleet/qm_ref.py`)

Wire order per tile: standard QM-1.0 header (struct `<3dff4d3d`; coordinates
interpreted in the pack's local ENU frame as declared by the manifest — the
documented local deviation), delta+zigzag uint16 u/v/height arrays (heights
quantized 0..32767 between header min/max), high-water-mark triangle indices
(encoders MUST relabel vertices by first-occurrence order), four edge-index
lists, then extensions, each framed as **uint8 id + uint32 length + payload**:

| ID | Name | Payload | Notes |
|---|---|---|---|
| 5 | bathymetry-bottomtype | uint8 × vertexCount | Enum: 0 unknown, 1 rock, 2 sand, 3 mud, 4 gravel, 5 cobble, 6 coral/sponge, 7 kelp. Categorical: **nearest-neighbour** sampling only, never blended. |
| 6 | bathymetry-confidence | uint8 × vertexCount | 0–255. Tiers: pro multibeam 240–255, fleet 80–160, interpolated 0–60. Scalar: may interpolate. |

Decoders MUST skip unknown extension IDs by length without failing.
Extensions are versioned as a set via the manifest's `extensionsSupported`
list; adding an ID never changes existing payloads.

## 5. Runtime LOD Selector Contract

### 5.1 Camera modes → target contour interval

| Mode | Interval | | Mode | Interval |
|---|---|---|---|---|
| freeFly | 10 fm | | deck | 2 fm |
| boat | 5 fm | | auv | 1 fm |

### 5.2 Interval → maximum geometric error

10 fm → 18.288 m; 5 fm → 9.144 m; 2 fm → 3.6576 m; 1 fm → 1.8288 m
(the interval itself, in meters: a mesh may not be asked to draw a contour
finer than its own error bound).

### 5.3 Altitude bands and tile budgets (draft values)

| Mode | Altitude band | Budget low/balanced/high |
|---|---|---|
| freeFly | 800–6000 m | 80/200/500 |
| boat | 150–800 m | 100/300/800 |
| deck | 30–150 m | 200/500/1500 |
| auv | 3–30 m | 300/800/3000 |

### 5.4 Hysteresis

A LOD transition requires the selection metric to move 10% past the
threshold (in interval units) before switching, preventing thrash.

### 5.5 Mode-switch rule

The selector must never render a contour finer than the loaded mesh can
resolve (§5.2); on mode switch it requests the finer interval and holds the
coarser rendering until tiles at the required error bound are resident.

## 6. Bake Pipeline Stage Contract

Stages: (1) ingest XYZ → COPC/LAZ archive (the audit stage *is* this stage);
(2) per-source gridding; (3) **CSB correction** (fleet soundings);
(4) fusion (survey preferred, fleet fills, confidence recorded per vertex);
(5) derived surfaces; (6) tile pyramid (quantized-mesh, local ENU, extensions
5/6); (7) pack assembly + manifest; (8) QC via the §7 conformance suite.

### 6.2 Invariants

- **Sign-agnostic tide rule** — the tide correction sign is FITTED per dataset
  (joint least squares), never hardcoded; conventions differ by source.
- **Per-vessel offset rule** — every vessel's transducer offset is estimated
  and corrected individually; there is no fleet-wide constant.
- **Tide-coverage rule** (added 2026-10-11) — the tide table must cover the
  full timestamp range of every sounding file. Interpolation must NEVER
  silently clamp out-of-range soundings; they are excluded from fits and
  flagged in QC. (On the synthetic set, clamping ~300 out-of-range soundings
  dragged a fitted offset from 0.5 m to −0.1 m and capped every audit
  variant's shoal spread near 0.40 fm.)
- **Calibration-terrain rule** (added 2026-10-11) — vessel offsets are only as
  good as the reference surface beneath them: on the synthetic set the
  smooth-ramp vessel recovered to 3.7 cm while the steep-shoal vessel
  carried a 24 cm residual fully explained by survey interpolation bias.
  Offset estimation should prefer low-gradient, well-surveyed ground —
  operationally, a calibration pass over flat charted bottom.
- **Exaggeration is render-only** — it appears nowhere in physics or data.
- **Datum contract** — bake emits static MLLW seafloor; runtime owns tide.

## 7. Conformance Tests

Executable today (`fleet/validate_pack.py`, self-demo: a valid manifest
passes; six sabotaged mutants — Juneau station, origin outside bbox,
CC-BY-SA data license, missing ladder rung, placeholder hash, exaggeration
in physics — are all rejected): manifest schema, station ID, ladder
completeness, license screen, hash format, root-tile existence.
Partially executable since 2026-10-12: tile integrity across the pyramid is
enforced at bake time by `fleet/bake_pyramid_ref.py`'s mandatory self-check
(every tile decoded and compared against source samples; a synthetic
22-tile pack it produced passes the validator above). Still specified-only:
contour accuracy vs source grid, CSB correction report attached per pack
(fitted b, per-vessel offsets, coverage exclusions), extension payload
lengths = vertexCount (implicitly covered by decoder roundtrips),
confidence-tier sanity.

## 8. Deferred and Open

Deferred: ECEF/globe mode, FFT water, voxel water column, multiplayer.
Open (added from the 2026-10-11 red-team, see REDTEAM-REVIEW.md):
**ENU construction + pack extent** — ingest must build the ENU frame via an
ECEF rotation (never flat equirectangular x/y with z = depth), and the
runtime sea surface cannot be a single flat plane over a large pack: earth
curvature drops 208 m at the corner of a 90×50 km pack (12 m at 12.5 km,
0.5 m at 2.5 km). Options: cap pack extent (~25 km across keeps corner sag
≈12 m — still material for a flat sea), render the sea as a segmented curved
surface in-frame, or sector the pack. Decision open; the synthetic work to
date (5 km) is unaffected. Also: our own QM decoder is required — NASA's
loader has no unknown-extension skip and breaks on ids 5/6 (source-verified).
Open: custom-decoder + fork performance on iPad [NEEDS REAL DATA];
underwater (AUV) rendering against the iPad bar — partially de-risked
2026-10-11 (the base water plane is already DoubleSide; fog/ceiling/
lighting behavior unspiked); per-region tile budgets (§5.3 draft);
licensing decision (Casey) on the Apache-2.0 / CC0 / CC-BY-4.0 split.
