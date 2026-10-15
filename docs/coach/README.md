# Coach Player runtime (M0)

The runtime lives here, inside `docs/`, because `docs/` is the served
root: `explore.html` imports these modules as `./coach/*.js`, and the
headless Node tools import the same files as `../docs/coach/*.js`. One
copy, both hosts. The simulation core is `../core.js`; tools are in
`../../tools/`. M0 is shipped; M1 is the next build (see the sister
repo, coach-player `docs/DESIGN-COMPARISON.md`).

- `adapter.js` — the boundary over the core. Fail-closed sampling
  (`groundAt` returns NaN outside the pack), `confidenceAt`, `pinger()`
  (the pot's sensor as bars + range ≤ 150 m — never the pot's
  coordinates), and the setup assertion that runs before any tile.
- `tiles.js` — four tiles: `make-way` (transit primitive),
  `work-the-shoal` (the objective tile, with its 2.3 m precondition —
  it declines where the shoal lacks the water, and declining is a
  harness pass, not a failure), `hunt-the-pot` (finds the lost pot by
  its pinger only, staging close and topping up the drone's battery
  before it dives), and `wreck-look` (keel-guarded creep into the cove
  to log the wreck; it declines when the cove mouth lacks the water).
- `judges.js` — the fit judges: the provisional `real` heuristic and
  the three constant controls (0.9 / 0.5 / 0.3).
- `overseer.js` — the beat loop: possession first, then rails, bands
  (RUN ≥ 0.70 / HOLD / MISFIT ≤ 0.30) with `hold_count` forced exits,
  the A-plan, the scripted offer scored by the bend rule, and the
  shadow author (opportunities logged, no model called — M0 has no
  author layer by design).
- `session.js` — runs one session headless and writes
  `sessions/<id>/trace.jsonl` + `story.md`; also builds the
  full-mission plan (bay → shoal → pot → wreck → home) that the
  mission test flies.

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

Run the verification from the repo root (all six suites are the
gate):

```
node tools/sim-selftest.mjs      # determinism: byte-identical replays
node tools/harness.mjs           # tile verification, 3 tides, decline case
node tools/run-controls.mjs      # the four control judges over the A-plan
node tools/demo-test.mjs         # the real demo show, end to end
node tools/mission-test.mjs      # full mission: six objectives at +1.4, safety at −1.5
node tools/boot-watchdog-test.mjs  # the boot failure panel's eight cases
node tools/bench.mjs             # headless step speed (a tool, not a gate)
```
