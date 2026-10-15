# Shoalwater

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**A browser game of Sitka Sound, Alaska — sailed over real bathymetry.**

You skipper the F/V *Eileen*, a Sitka power troller, in a harbour built from
measured seafloor instead of invented terrain. The work is slow and close:
cross four kilometres of real water, work a shoal with an underwater drone,
and hunt a lost crab pot by the sound of its pinger — no marker, just a
readout counting the metres down. Mind the keel. The tide is not
decoration; it decides which water you may use.

Underneath the game sits the thing it grew from: the **Region Pack** — a
data standard and verified toolchain that turns boat soundings into
game-ready bathymetric terrain tiles. The game is the standard's first
real consumer, and its strictest critic: every depth the player reads has
to be a depth the pipeline can defend (the receipts live under
*Verification*, below).

## Play

No install, no account — it runs in the browser, phones included.

- **The game**: https://superinstance.github.io/shoalwater/explore.html
  Open it and the autoplay demo plays the mission while captioned notes
  teach the controls. Any key or tap takes the wheel instantly.
- **Practice starts**: start at the [lost pot](https://superinstance.github.io/shoalwater/explore.html?start=pot),
  the [wreck cove](https://superinstance.github.io/shoalwater/explore.html?start=cove),
  or [inside Jamestown Bay](https://superinstance.github.io/shoalwater/explore.html?start=jamestown).
- **The chart**: https://superinstance.github.io/shoalwater/ — the same
  terrain in chart register; the game's corner chart opens it in one tap.
- **The deployment page**: https://superinstance.github.io/shoalwater/play.html
- **Deployment 1, the full-Sound bake**: https://superinstance.github.io/shoalwater/deployment.html

## Scene 1 — a job of work

Cast off from the Western Anchorage and make Jamestown Bay. Work the shoal
with the underwater drone. Then hunt the crabber *Marigold*'s lost pot: it
sits somewhere on the drainage east of the shoal, and all you get is its
pinger — the readout counts the metres down as you close, and there is
deliberately no marker on the chart. Log the wreck in the cove if you can
find it, and bring her home with the keel intact: two hard strikes and she
takes water, and the drone flies on a battery governed by the rule of
thirds — a third out, a third back, a third in reserve, or you go and
fetch it in the boat.

It plays at boat speed, close to the water, looking into little nooks
and crannies — and every number in that paragraph is a measured number. The shoal is the pale
patch the chart shows at the bay's mouth; the wreck cove is shallow enough
that at a low tide the approach is a keel-reading exercise, not a drive.

## The world is measured, not imagined

- `docs/real-pack/` — the game's terrain: Sitka Sound clipped to the
  operating area, baked from a real 2.2 GB bathymetry export into
  quantized-mesh tiles.
- `docs/full-pack/` — the whole Sound (198 overview tiles, unified
  land + sea). The game reads its coarsest level as the **far view**: the
  horizon beyond the clip is real data too. The full-resolution pack
  (z0–z3) lives in a separate heavy repo with its own viewer, by design —
  this repo stays lean enough to run on a phone.
- `docs/demo-pack/` — a small synthetic pack (`?pack=demo`), licence-clean
  fixture data for trying the machinery anywhere.

The vertical datum is stated honestly wherever it matters: the export was
taken as MLLW; the source plotter's tide configuration is unverified, so
the pack says *assumed*, in writing, in its own manifest.

## The standard underneath

A Region Pack is quantized-mesh-1.0 terrain in a local ENU frame (WGS84 at
ingest, metres inside, fathoms on display), with per-vertex extensions for
bottom type and confidence, a static MLLW seafloor baked in, and the tide
owned by the runtime — the bake is static; the water is alive, because the
tide moves on top of a seafloor that doesn't.

### The tide-station trap

A widely-copied research pack called NOAA station 9452210 "Sitka" — that
station is Juneau. Sitka is **9451600**; Port Alexander is 9451054 (all
verified against NOAA/NCEI CO-OPS tables). The error was a catalyst for
building a toolchain that verifies instead of copying.

### Verified results

| Metric                          | Value          |
|---------------------------------|----------------|
| Tide coefficient recovery       | 0.9984 (vs 1.0) |
| Test shoal disagreement        | 0.996 → 0.203 fathoms |
| Compression vs XYZ              | 21.7×          |
| Synthetic Region Pack size      | 1.35 MB        |
| LOD levels                      | 4              |
| Tide table coverage invariant   | Full timestamp range required |

Four independent tide-correction implementations initially plateaued at
~0.40 fathoms of disagreement. The root cause was the tide table ending
before the sounding tracks, so the interpolator silently *clamped* ~300
out-of-range soundings. The invariant that came out of it: tide tables
must cover the full timestamp range of every sounding file — never clamp;
exclude and flag.

Format decisions, briefly: quantized mesh over Terrarium PNG (per-vertex
data carriage, true triangulation, LOD error binding); local ENU over Web
Mercator at 57°N; the tide fitted, never hardcoded, because the sign
convention is exactly the kind of thing that gets copied wrong.

## The constellation

Shoalwater is worked on by several agent lanes and one captain, in the
open, and it does not stand alone:

- **Coach Player** — [`SuperInstance/coach-player`](https://github.com/SuperInstance/coach-player):
  a coachable auto-player (the human coaches strategy; the avatar
  executes). Its M0 runtime lives in this repo (`docs/coach/` over the
  extracted fixed-step core in `docs/core.js`) and flies the *Eileen*
  here first.
- **Ground truth** — [`SuperInstance/shoalwater-survey`](https://github.com/SuperInstance/shoalwater-survey):
  kayak-borne camera + GPS passes that grow the world's shallow detail,
  kept as layered versions over time — watch a reef change across a
  season.
- **The full-fidelity viewer** — the z0–z3 pack's own home (separate repo),
  with the survey layer and its time slider.
- **The Classroom** — [`SuperInstance/classroom`](https://github.com/SuperInstance/classroom):
  a shared quilt the lanes paint one patch per turn under an append-only
  protocol. Its second patch is this project's shoal.

Working here? Read [`ONBOARDING.md`](ONBOARDING.md) first, then
[`COORDINATION.md`](COORDINATION.md) — the board of record for who owns
which surface and who is in flight — and [`CLAIMS.md`](CLAIMS.md) for
open lanes.

## Verification

Trust is earned in this repo the same way it is on the water: receipts.

- `checks/run_all.py` — the toolchain suite (10/10 on the reference
  implementations, cross-language decode byte-identical).
- `tools/` — the game's headless suites: `sim-selftest` (replays are
  byte-identical), `mission-test` (Scene 1 is completable, reserve third
  unspent), `demo-test` (the autoplay show flies the whole mission and
  brings the drone home), `boot-watchdog-test`. **The suite is the gate:**
  if it isn't green, it doesn't ship.
- [`VERIFICATION.md`](VERIFICATION.md) — the audit record behind the
  numbers above.

## Status and open decisions

- **Specification**: v0.1 with verified reference implementations
  (`spec/`); amendments tracked alongside.
- **Open — pack extent vs curved sea**: a flat local frame drifts from
  the real earth as a pack grows — earth-curvature sag is 208 m at the
  corner of a full-extent pack. The fix (ECEF-rotation ingest, or capped
  extents) is a real decision, still open.
- **Open — licensing split**: recommended Apache-2.0 for code, CC-BY-4.0
  for contributed data, CC0 where the data is NOAA's. Recommended, not
  yet ruled.
- **Assumed — the Sitka pack's datum** (above): one configuration fact
  away from verified.

## Repository layout

- **docs/** — the web root and the runtime (GitHub Pages serves `main`):
  the game, the chart, the packs, the coach runtime. No build step.
- **spec/** — the Region Pack standard.
- **src/regionpack/** — the Python reference toolchain.
- **runtime/** — the TypeScript decoder and LOD selector.
- **local-kit/** — run the pipeline on your own machine, against your own
  soundings, in private if you prefer.
- **examples/** — a minimal pack; its tile is the conformance fixture for
  cross-language decode checks.
- **spike/** — the three-tile loader spike, verified headless.
- **audit-kit/** — the original four-variant audit kit and NOAA tide prep.
- **tools/** — the game's headless test suites and sim drivers.

## Audience

Engineers, and the dad-and-kid workshop behind OpenSkyFlight — in whose
spirit this is built, over a real harbour, one verified depth at a time.
The tone is scientific and plain: receipts over claims.
