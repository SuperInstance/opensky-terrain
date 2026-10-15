# Onboarding — Shoalwater

For humans and agents arriving fresh. Read this, run the test suite once,
and you know enough to work here without breaking the thing that matters:
**main is production, and people's phones are the test fleet.**

Companion files: `AGENTS.md` (the one-screen version), `CLAIMS.md` (open
work lanes and who has claimed them), `COORDINATION.md` (which lane owns
which surface, and who is in flight right now). `COORDINATION.md` is the
coordination authority — this file explains, it does not overrule it.

---

## What this is

**Shoalwater** is a browser game of Sitka Sound, Alaska, built from real
exported bathymetry. You skipper the **F/V Eileen**, a Sitka power troller
(or switch to her underwater drone), on one job — Scene 1, Jamestown Bay:

1. Cast off and make Jamestown Bay.
2. Work the shoal with the drone.
3. Hunt the crabber Marigold's lost pot by its pinger — the pinger is all
   you get; there is no marker on the chart.
4. Log the wreck in the cove.
5. Bring her home, keel intact (two hard strikes and she takes water).

A captioned **autoplay demo** plays the whole mission end to end. Any key
or tap takes the wheel instantly — the demo drives the same input object
a human does, teaches while it plays, and never persists anything.

Live (GitHub Pages, from this repo's `main` / `docs/`):

- Chart / landing: https://superinstance.github.io/shoalwater/
- Deployment page ("Watch her play. Take the wheel when you're ready."):
  https://superinstance.github.io/shoalwater/play.html
- The game: https://superinstance.github.io/shoalwater/explore.html

This repo is also the proving ground for **Coach Player** (sister repo:
`SuperInstance/coach-player`) — a coachable auto-player whose human player
coaches at strategy level while an avatar executes. The coach runtime in
`docs/coach/` is Coach Player's M0: scripted **tiles** (human-size choices)
chosen by a cheap **overseer** under judges, over a fixed-step sim core.
If you are here for Coach Player, read
`SuperInstance/coach-player` `docs/DESIGN-COMPARISON.md` — it is the
merged design both that project and this runtime are built from.

Underneath the game, this repo began as the **Region Pack** project: a
data standard and verified toolchain that turns crowdsourced boat
soundings into game-ready bathymetric tiles. That work lives in `spec/`,
`src/regionpack/` (Python), `runtime/` (TypeScript decoder), `checks/`,
and `audit-kit/`, and is documented by the root `README.md`, `VISION.md`,
and `VERIFICATION.md`. The game is the standard's first real consumer.
You do not need the toolchain to work on the game — but don't be confused
that it's here, and don't break it casually.

---

## Repo map

### `docs/` — the web root AND the runtime

`docs/` is served by GitHub Pages and is the only copy of the runtime:
the browser page and the headless Node tools import the *same* files.
There is no build step and no second copy to keep in sync.

| File | What it is |
|---|---|
| `explore.html` | The game page (~94 KB, one file): three.js renderer, HUD, demo wiring, guide narrator, the boot watchdog (inline, before the module), mobile HUD behaviour. The big one — most surfaces meet here. |
| `play.html` | The deployment page: hero, launch stage (the game in an iframe), the story in three beats, the real controls, links into Coach Player. |
| `index.html` | The chart / landing page for the Region Pack side. |
| `deployment.html` | A separate deployment write-up (full-Sound bake) — distinct from `play.html`, owned by the main lane. |
| `core.js` | The extracted fixed-step simulation core: game state, pack building, `stepBoat` / `stepDrone`, vehicle switching, objective flags, `snapshot()` / `load()`. **No three.js, no DOM** — it runs identically in the browser and in Node, and replay is byte-identical (proven by `sim-selftest`). |
| `demo.js` | The demo show as a shared module: the choreography (staging, battery discipline, the wreck visit) and its own steering formulas. The page imports it; `tools/demo-test.mjs` flies it headlessly. |
| `qm.js` | Browser decoder for quantized-mesh Region Pack tiles (port of `runtime/qm_decoder.ts`). Not the minichart — the minichart is drawn inside `explore.html`. |
| `coach/` | The Coach Player runtime — see its own `coach/README.md`, and the table below. |
| `real-pack/` | The game's terrain: the real Region Pack (manifest, tile index, tiles). Default pack. |
| `demo-pack/` | The smaller demo pack, selected with `?pack=demo`. |
| `full-pack/` | The full-extent pack. The game also reads its z0 tiles as the **far-view skirt** — the low-detail horizon ring around the near terrain (`loadFarView()` in `explore.html`). |
| `boats.json`, `harbor-kit.json` | Scenery data: traffic boats and the harbour kit (buildings, props). Fail-soft scenery — see the watchdog rule below. |
| `scene-1-jamestown-bay.md` | The Scene 1 design document — what the mission is supposed to be. |
| `media/` | Media assets for the pages. |

### `docs/coach/` — the Coach Player runtime (M0)

| File | What it is |
|---|---|
| `adapter.js` | The boundary over the core. **Fail-closed**: `groundAt` returns NaN outside the pack (never a "safe" guess), `confidenceAt` exposes the pack's bathymetry confidence, `pinger()` exposes the pot hunt's sensor (bars + range ≤150 m — never the pot's coordinates), `assertSetup` runs before any tile executes. |
| `tiles.js` | The tile library — each tile is one named, human-size choice: `make-way` (transit), `work-the-shoal`, `hunt-the-pot` (pinger-only by contract), `wreck-look` (keel-guarded cove creep). A tile may *decline* with a reason; declining in impossible water is correct behaviour, not failure. |
| `judges.js` | Fit judges: the provisional `real` heuristic plus three constant controls (always-0.9 / always-0.5 / always-0.3) that exist to prove the band logic, not to steer. |
| `overseer.js` | The beat loop: possession first, then the plan's legs, banded RUN ≥0.70 / HOLD 0.30–0.70 / MISFIT <0.30 with `hold_count` forced exits (the dead-band judge completes the plan *through* the exits), the bend rule for interruptions, and a **shadow author** (M0 calls no model — it logs the opportunities where an author would be asked). |
| `session.js` | Headless session runner + `buildFullMissionPlan()`; writes `sessions/<id>/` logs. |

### `tools/` — headless Node, stdlib only, no install

| Tool | What it proves / does |
|---|---|
| `sim-selftest.mjs` | **Determinism**: same scripted inputs twice → byte-identical snapshots; snapshot mid-run, load into a fresh game, finish → identical again. |
| `bench.mjs` | Headless step speed (the core runs at tens of thousands of steps/sec — the fixed-step design is not the bottleneck). |
| `harness.mjs` | Tile verification: `make-way` and `work-the-shoal` over the real pack at tides −1.5 / +1.4 / +4.0, the setup assertion (positive and negative), the shoal decline case, the overseer's possession gate. |
| `run-controls.mjs` | The four control judges over the A-plan (writes `sessions/m0-ctrl-*/`). The constant-0.5 judge completing the plan via forced exits is the livelock cure, proven. |
| `demo-test.mjs` | Flies the **real show**: imports `docs/demo.js` + `docs/core.js` and runs the whole demo — all steps, pot found, wreck seen, zero hull hits, drone home aboard. |
| `mission-test.mjs` | The **coach runtime** flying the full mission plan at two tides: at **+1.4 all six objectives complete** (pot found by pinger, wreck logged, reserve battery unspent); at **−1.5** the safety assertions must pass — no strikes, honest failure where the water isn't there. |
| `boot-watchdog-test.mjs` | The boot watchdog's eight cases (DOM-stubbed): stall → panel; progress → no panel; boot-critical rejection → panel; scenery rejection → **no** panel; post-boot failures → no panel; resource noise → no panel; genuine script error → panel. |
| `sim.mjs` | Headless runner: load a pack, apply a start or snapshot, step the core, print the result. `--steps-per-frame N` is the page time control's analogue. |
| `pack-loader.mjs` | Shared helper: loads a pack from disk for the tools, replicating the page's zoom-level choice. Not a test. |

### `sessions/` — run logs

`sessions/<id>/story.md` (the human-readable account) + `trace.jsonl`
(the machine record). Checked in on purpose: they are the receipts.
`m0-ctrl-*` are the four control-judge runs; `mission-t14` / `mission-tm15`
are the mission test at tides +1.4 and −1.5.

### `refs/` — the boat references

Photographs the in-game boat is modelled from: `eileen-*.jpg` (the F/V
Eileen — cutaway profile, night side profile hauled out, keel) and
`sallie-*.jpg` (a sister troller fishing: trolling poles deployed in their
wide V, and the sunken aft cockpit from astern). If you touch the boat
mesh, look at these first.

### Everything else at the root

`spec/`, `src/regionpack/`, `runtime/`, `checks/`, `audit-kit/`,
`examples/`, `spike/`, `local-kit/` — the Region Pack standard and its
toolchain (see `README.md`). `VISION.md`, `DIGEST.md`, `VERIFICATION.md`,
`NEEDS-FROM-LOCAL.md` — the project's own record. `LICENSE` is Apache-2.0.

---

## How to run it

**Play it:** serve `docs/` with any static file server and open
`explore.html`:

```
cd docs && python3 -m http.server 8000
# → http://localhost:8000/explore.html
```

(Or just use the live Pages URLs above.) Useful URL parameters:
`?pack=demo` (small pack), `?start=pot|jamestown|cove` (practice starts),
`?fresh=<anything>` (cache-busting reload — the boot watchdog's retry
uses this).

**Test it:** from the repo root, Node ≥ 18, no install, all stdlib:

```
node tools/sim-selftest.mjs
node tools/harness.mjs
node tools/run-controls.mjs
node tools/demo-test.mjs
node tools/mission-test.mjs
node tools/boot-watchdog-test.mjs
node --check <the page module script, extracted>   # syntax gate for explore.html's module
```

All six suites must be green before anything reaches `main`. That is not
a suggestion — see the rules.

---

## The rules that keep it alive (hard)

### 1. Main is production

GitHub Pages deploys `main` / `docs/` automatically; anything pushed to
`main` is live worldwide within about a minute. There is no staging.
Treat every push like a release, because it is one.

### 2. The stamp rule

The page is an ES-module graph, and phones cache its pieces
*independently*. Every local import edge carries a version stamp —
currently `?v=2026-10-14.8` — on **every** edge: `explore.html`'s imports
of `qm.js` / `core.js` / `demo.js`, and `demo.js`'s import of `core.js`.
The bump rule is written at the imports in `explore.html`: **any change
to the module set or to a module's contract bumps the stamp on all edges
in the same commit.** A torn stamp set strands real phones on a dead
loading veil while every fresh test browser loads fine. This is not
theory — it is exactly how the game died on the owner's Android on
2026-10-14, and the stamps + watchdog below are the fix. Do not remove
them, do not stamp only some edges, do not get clever.

### 3. The suite is the gate

`sim-selftest`, `harness`, `run-controls`, `demo-test`, `mission-test`,
`boot-watchdog-test` — all green, plus `node --check` on the page module,
before anything reaches `main`. If a change makes a suite fail, the
change is wrong until proven otherwise; the suites fly the real show and
the real mission, so a red suite is a broken game, not a broken test.

### 4. Shared tree — pull first, respect surfaces

Multiple agent lanes commit to this repo concurrently; `main` moves
under you. **Pull and read HEAD (and `COORDINATION.md`) before touching
anything.** Per `COORDINATION.md`, surfaces have owners — the game page,
the packs/deployment, and the coach runtime are worked by different
lanes; if your work needs another lane's surface, hail its owner via the
main lane instead of editing across the line. And: the untracked
**`one-battery/` directory belongs to another lane — never touch it**:
don't read it into your work, don't stage it, don't clean it up.

### 5. The boot watchdog's contract

`explore.html` boots behind a loading veil, watched by an inline
watchdog. Its contract, enforced by `boot-watchdog-test`:

- Only **boot-critical** failures may show the failure panel. Boot-path
  code tags its errors (`bootFail` / `bootCritical`); the panel offers a
  plain-language explanation and a "Retry with a fresh copy" reload.
- **Scenery failures are console-only, forever**: the far-view skirt,
  harbour kit, traffic boats — a missing piece of scenery is a gap on
  the horizon, never a dead game. Fire-and-forget loads never panel.
- A slow-but-progressing boot never panels: progress is stamped as work
  lands, and the panel needs a genuine 20 s stall.

If you add a load to the boot path, decide which side of this contract
it lives on, and tag it accordingly.

### 6. Mobile invariants (≤700 px)

The owner's real device is a phone; desktop is the easy case.

- The **minichart owns a sovereign bottom-right box** (168 px on phones).
  Nothing overlaps it, in any state, ever. It is the impressive part of
  the bottom of the screen; keep it clear.
- Everything else informational lives in the left column in strict
  bands (TIME anchored bottom-left, readout chip above it, caption
  above that) and behaves as **pop-and-settle chips**: pop out on
  change, hold ~4 s, settle back; tap to peek.
- **Warnings pin open while they hold**: keel danger, taking water,
  drone on its reserve battery third. Safety information never
  auto-hides.
- The touch stick ghosts when idle; safe-area insets are respected.
- Stamps + watchdog (rules 2 and 5) are what keep phones alive at all.

---

## Where things stand — known honest limits

- **The full mission completes at working tides.** `mission-test` at
  tide +1.4: all six objectives, pot found by pinger alone, wreck
  logged, zero hull strikes, drone home aboard, reserve battery
  unspent. The page demo flies the same show (`demo-test`).
- **At tide −1.5, the direct bay route crosses a bar that is dry at low
  water.** `make-way` fails loudly there (keel-guarded creep, timeout,
  **zero hull strikes**) rather than cheating through. A floatable
  channel exists; *route-finding through it* is future work (below).
  `wreck-look` likewise declines, with a reason, when the cove can't be
  worked. Honest failure is a designed outcome, not a bug to paper over.
- **The demo and mission suites are the definition of "the show
  works."** If they pass, the show works; if a human report disagrees,
  suspect the delivery path (cache, clock, throttled tab) before the
  choreography — that ordering has been right every time so far.
- The coach runtime's judges are provisional heuristics and constants;
  calibration, the label store, and the author layer are M1+ work in the
  Coach Player design, not present here yet.

---

## Open work lanes (claimable)

Claiming protocol — read `COORDINATION.md` first (surfaces + who is in
flight), then:

1. Check `CLAIMS.md` and `git log` — is the lane already claimed?
2. In your **first commit**, mark the lane `CLAIMED` in `CLAIMS.md`
   with your name/handle and the date, and add an In-flight line to
   `COORDINATION.md`.
3. Work to the gate (rule 3). Small commits; the message states intent.
4. When finished, mark the lane `DONE` in `CLAIMS.md` with a pointer to
   the result (commit / session logs / test output), and clear your
   In-flight line.

The lanes:

- **M1 coach surface (lands in this repo)** — per the merged order in
  `SuperInstance/coach-player` `docs/DESIGN-COMPARISON.md`: intention
  registry, label store + counterfactual replays, the coach surface in
  the page (tile chips, intent strip, order interpreter), offline
  authoring proof on the wreck. Read the design doc first; several
  rulings there are the owner's to make and are marked as such.
- **Low-tide route-finding** — teach `make-way` (or a routing layer
  above it) to find the floatable channel at tide −1.5 instead of
  failing on the dry bar. The bar: `mission-test` at −1.5 completes
  *without* weakening a single safety assertion, and +1.4 stays green.
- **Performance on weak GPUs** — the scene already caps pixel ratio at
  1.5; profile on genuinely weak hardware before optimising, and keep
  the look the owner approved. Any win must show up as a measured
  number, not a vibe.

When in doubt: ask via the main lane, or leave the lane `OPEN` and note
what you learned in `CLAIMS.md`. A wrong attempt can be rolled back;
an undocumented one helps nobody.
