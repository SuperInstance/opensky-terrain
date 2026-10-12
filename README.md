# OpenSky Terrain

A bathymetric game platform for Sitka Sound, Alaska. Real seafloor depth
data — professional survey soundings plus depth tracks contributed by the
local fishing fleet — is baked into self-contained "Region Packs" that a
browser game renders as true-to-scale underwater terrain: a 10/5/2/1-fathom
contour ladder, water you can be on or under, and camera modes for flying,
boating, standing on deck, or piloting an AUV.

The programme forks OpenSkyFlight and keeps its terrain/water/contour
machinery, replacing flight terrain with bathymetry referenced to MLLW
(mean lower low water). A second region is a second pack, not a second
codebase.

## What's here

- **DIGEST.md** — the programme digest: the design rounds, the agreed
  architecture (region packs, ENU local tangent plane, tide handled at
  runtime against a static MLLW bake), and the open decisions.
- **VERIFICATION.md** — an independent verification pass over the source
  pack's sounding-audit claims, with the corrections it produced.
- **NEEDS-FROM-LOCAL.md** — the metadata-only inventory checklist to run
  on the machine where the real data lives, before the first real audit.
- **audit-kit/** — the lane's own tools: `prep_noaa_tide.py` (converts a
  NOAA CO-OPS download into the audit's tide-table schema) and
  `make_kit.py` (generates the patched audit kit), with the kit README.

## Headline verification result

Checked against NOAA/NCEI station tables: **Sitka's tide station is
9451600.** The source pack's audit spec, scripts, and ground truth all
called 9452210 "Sitka" — 9452210 is Juneau. The bake memo's third
candidate, 9451054, is Port Alexander. Every tide correction in the pack
therefore hung off the wrong city's tide until this was caught.

All four of the pack's audit variants (four independent implementations
of one audit spec, run on synthetic data with a known reference shoal)
were independently re-run: **4/4 pass, corrected spreads reproduced
digit-for-digit** (0.4046 / 0.4015 / 0.1957 / 0.4475 fathoms). Two latent
defects were found in the scripts that would have bitten on the first
real run — the reference shoal was hardcoded with no way to set it, and
one variant fabricated tide values outside its table's range from the
test generator's own sine wave. Both are fixed in the local kit; the
patched copies also reproduce 4/4.

## What is not here

- **The audit variant sources.** The four implementations were written by
  a collaborator; the programme's licence decision is still pending, so
  their code stays local for now. The verification results above stand
  on their own.
- **The original briefing pack.** The collaborator's memos and the
  third-party source material pasted into it are not ours to publish.
- **Real fleet data — none, ever.** Fleet soundings are private
  (they chart working fishing spots). No real data appears in this
  repository; everything verified so far ran on synthetic data.

## Status

Design and verification are complete on synthetic data. The next step is
the first real-data inventory on the local machine where the fleet data
already lives (metadata and small samples only — the data does not move),
followed by the first audit run against a real charted shoal.
