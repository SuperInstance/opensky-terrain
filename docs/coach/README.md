# Coach Player runtime (M0)

The runtime lives here, inside `docs/`, because `docs/` is the served
root: `explore.html` imports these modules as `./coach/*.js`, and the
headless Node tools import the same files as `../docs/coach/*.js`. One
copy, both hosts. The simulation core is `../core.js`; tools are in
`../../tools/`.

- `adapter.js` — the boundary over the core. Fail-closed sampling
  (`groundAt` returns NaN outside the pack), `confidenceAt`, and the
  setup assertion that runs before any tile.
- `tiles.js` — the first two tiles: `make-way` (transit primitive) and
  `work-the-shoal` (the objective tile, with its 2.3 m precondition —
  it declines where the shoal lacks the water, and declining is a
  harness pass, not a failure).
- `judges.js` — the fit judges: the provisional `real` heuristic and
  the three constant controls (0.9 / 0.5 / 0.3).
- `overseer.js` — the beat loop: possession first, then rails, bands
  (RUN ≥ 0.70 / HOLD / MISFIT ≤ 0.30) with `hold_count` forced exits,
  the A-plan, the scripted offer scored by the bend rule, and the
  shadow author (opportunities logged, no model called — M0 has no
  author layer by design).
- `session.js` — runs one session headless and writes
  `sessions/<id>/trace.jsonl` + `story.md`.

The page (`../explore.html`) now runs on the core: fixed 1/60 steps
from an accumulator, rendering once per frame, with the takeover
scope fix (control keys only; form fields are not the game's) and
`switchVehicle(v, source)` — only `'player'` triggers takeover.
Three playtest additions live in the page: a time control (1×/2×/4×/8×
segmented buttons, bottom centre — it scales the accumulator feed,
never the step, and applies under demo, runtime and human alike); a
local guide narrator (state-derived lines on the caption pill —
objective + bearing in plain words, keel warnings, battery thirds,
pinger warmer/colder — with optional speechSynthesis voice, default
off, gesture-gated); and the player's boat reskinned as F/V Eileen
with animated trolling poles (T key or the HUD button, purely
visual). `tools/sim.mjs --steps-per-frame N` is the time control's
headless analogue.

Run the verification from the repo root:

```
node tools/sim-selftest.mjs   # determinism: byte-identical replays
node tools/bench.mjs          # headless step speed
node tools/harness.mjs        # tile verification, 3 tides, decline case
node tools/run-controls.mjs   # the four control judges over the A-plan
```
