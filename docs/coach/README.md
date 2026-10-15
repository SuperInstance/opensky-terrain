# Coach Player runtime (M0 + M1)

The runtime lives here, inside `docs/`, because `docs/` is the served
root: `explore.html` imports these modules as `./coach/*.js`, and the
headless Node tools import the same files as `../docs/coach/*.js`. One
copy, both hosts. The simulation core is `../core.js`; tools are in
`../../tools/`. M0 is shipped; M1 landed on top of it (spec: the
sister repo, coach-player `docs/DESIGN-COMPARISON.md` + OVERSEER-
NUMBERS.md + TILE-CONTRACT.md).

- `adapter.js` — the boundary over the core. Fail-closed sampling
  (`groundAt` returns NaN outside the pack), `confidenceAt`, `pinger()`
  (the pot's sensor as bars + range ≤ 150 m — never the pot's
  coordinates), and the setup assertion that runs before any tile.
- `tiles.js` — five tiles: `make-way` (transit primitive),
  `work-the-shoal` (the objective tile, with its 2.3 m precondition —
  it declines where the shoal lacks the water, and declining is a
  harness pass, not a failure), `hunt-the-pot` (finds the lost pot by
  its pinger only, staging close and topping up the drone's battery
  before it dives), `wreck-look` (keel-guarded creep into the cove
  to log the wreck; it declines when the cove mouth lacks the water),
  and `hold-station` (M1's authored tile — drone home aboard, boat
  on station, watch kept; see `authored/hold-station.packet.json`).
- `judges.js` — the fit judges: the provisional `real` heuristic and
  the three constant controls (0.9 / 0.5 / 0.3).
- `registry.js` (M1) — the intention registry: which tile claims
  which intention, as data. The overseer checks it before any
  percentage; an intention with no claimant is a misfit BY
  CONSTRUCTION, logged distinctly (`structural: true`).
- `labels.js` (M1) — the label store: decided situations with their
  outcomes (live or counterfactual), fit for a familiar situation as
  the smoothed empirical rate over nearest labelled neighbours
  (k=20, α=4, <5 neighbours = unfamiliar → the heuristic judge), and
  `replaySituation` — re-run the sim from a stored snapshot against
  a tile, for counterfactual labels.
- `thresholds.json` + `thresholds.js` (M1) — the overseer's operative
  numbers as data, each with its provenance status, mirroring
  coach-player `docs/OVERSEER-NUMBERS.md`. Defaults are the values
  M0 shipped; nothing was retuned.
- `interpreter.js` (M1) — the order interpreter: typed coach orders
  resolved against a closed vocabulary (phrase table, then a fuzzy
  pass over the same vocabulary), always echoed as a template for
  confirmation. Its LLM seam is a stub that returns null — nothing
  typed leaves the device in this build (privacy ruling pending).
- `plans.js` (M1) — the A-plans (default + full mission), shared by
  the session runner and the page's coach surface.
- `overseer.js` — the beat loop: possession first, then rails, then
  the decision checks in order — registry (structural), the tile's
  precondition, fit (the label store's rate when the situation is
  familiar in it, else the judge) — bands (RUN ≥ 0.70 / HOLD /
  MISFIT ≤ 0.30) with `hold_count` forced exits, the A-plan, the
  scripted offer scored by the bend rule, and the shadow author
  (opportunities logged, no model called). M1 adds the coach verbs
  (`coachGoTo`, `holdStation`, `read()` — the intent strip's diet,
  fit always as a word) and labels every decided situation.
- `session.js` — runs one session headless and writes
  `sessions/<id>/trace.jsonl` + `story.md` + `labels.jsonl`; after
  the run, a bounded counterfactual pass replays stored decision
  snapshots under shifted water for extra labels.

The page (`../explore.html`) now runs on the core: fixed 1/60 steps
from an accumulator, rendering once per frame, with the takeover
scope fix (control keys only; form fields are not the game's) and
`switchVehicle(v, source)` — only `'player'` triggers takeover.
Three playtest additions live in the page: a time control (1×/2×/4×/8×
segmented buttons, bottom centre on desktop — it scales the
accumulator feed, never the step, and applies under demo, runtime and
human alike); a
local guide narrator (state-derived lines on the caption pill —
objective + bearing in plain words, keel warnings, battery thirds,
pinger warmer/colder — with optional speechSynthesis voice, default
off, gesture-gated); and the player's boat reskinned as F/V Eileen
with animated trolling poles (T key or the HUD button, purely
visual). `tools/sim.mjs --steps-per-frame N` is the time control's
headless analogue. On narrow screens (≤700 px) the HUD rearranges
around the chart: the minichart owns a sovereign bottom-right box
nothing overlaps, the time control anchors bottom-left in a strict
left column under the readout and caption, the readout and caption are
pop-and-settle chips (they open on change, hold, then tuck back to a
tap-to-peek chip), and warnings — keel, taking water, reserve battery
— pin their element open while they hold.

The page also carries the M1 coach surface: a Coach toggle in the
control column runs this runtime live over the full-mission plan —
tile chips (press = send the plan there; the current chip carries
the fit as a word — sure / trying / no move yet — never a number),
the intent strip (the overseer's current read), and an order box
(the interpreter above; the interpreted order is echoed and applies
only on confirmation). The moment the player drives, the overseer
stands down until the coach is resumed. On narrow screens the
section is a pop-and-settle tenant like the other chips; the chart
keeps its sovereign box. Coach and demo never run at once. Coach
labels persist in the browser (`localStorage`, capped) — the
Node sessions write theirs beside their traces.

Run the verification from the repo root (all seven suites are the
gate — the six from M0 plus m1-test):

```
node tools/sim-selftest.mjs      # determinism: byte-identical replays
node tools/harness.mjs           # tile verification, 3 tides, decline case
node tools/run-controls.mjs      # the four control judges over the A-plan
node tools/demo-test.mjs         # the real demo show, end to end
node tools/mission-test.mjs      # full mission: six objectives at +1.4, safety at −1.5
node tools/boot-watchdog-test.mjs  # the boot failure panel's eight cases
node tools/m1-test.mjs           # M1: registry, labels, thresholds, interpreter, hold-station, coach verbs
node tools/bench.mjs             # headless step speed (a tool, not a gate)
```
