# Coordination — who is working on what

One page, kept current, so any session arriving in this repo can see the
whole board before touching anything. If you are starting work here:
**pull, read HEAD, read this file.** Then add your line to *In flight*
in your first commit and clear it in your last.

## Surfaces and who works them

| Surface | Where it lives | Worked by |
|---|---|---|
| The game — Explorer gameplay, mission, demo, chart | `docs/explore.html` | Z Lane |
| Region packs and deployment | `docs/real-pack/`, `docs/full-pack/`, `docs/deployment.html`, GPU Job 1 | Main lane |
| Coach Player | `docs/coach/`, `docs/core.js`, the boat build in `explore.html` | The Coach Player session |
| The full-fidelity viewer (z0–z3 pack) | a separate repo — this repo stays lean | Main lane |
| Ground truth — kayak survey (camera + GPS, layered passes) | `SuperInstance/shoalwater-survey` — phone field mode + viewer import (live 2026-10-14) | The captain |
| The Classroom quilt | `SuperInstance/classroom` — its own PROTOCOL.md governs turns | All lanes, one patch per turn |

## House rules

- **Pull and read HEAD before touching anything.** The shared working tree
  may carry another session's uncommitted work. Flag it to the main lane;
  never sweep it into your own commit, never clean it up for them.
- **One surface per session.** If your work needs another surface, hail its
  owner (via the main lane) instead of editing across the line.
- **Small commits; the message states intent.** The push history is the
  record — write it so the next session can reconstruct why, not just what.
- **Public by default; secrets never.** Outward pieces carry SuperInstance,
  never a personal name. The captain's home waters are real, and private
  detail (exact home location) stays out of public artifacts.
- **A test verdict of "feature absent" is not believed** until it is checked
  against the served bytes (test browsers cache hard; reload first, and
  settle disputes by hash, not by screenshot).
- **Receipts**: cross-lane work closes with a short note to the main lane —
  what landed, which commit, what is still open.

## In flight

- 2026-10-14 — Z Lane: far view + fetch-timeout landed (`edf9d5d`, `46a9077`). Nothing in flight.
- 2026-10-14 — Coach Player session: M0 landed (`0244eb2`). Session may still be active in the shared tree — its uncommitted leftovers are duplicates of committed work; leave them.

## How to hail

Through the main lane, which keeps the switchboard — or by updating this
file in a commit the others will read on their next pull. The record is
the first-class citizen; conversation points at it.
