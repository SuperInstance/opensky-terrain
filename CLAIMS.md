# Claims — open work lanes

Who is working on what, so lanes don't collide. Protocol (full version
in `ONBOARDING.md`): read `COORDINATION.md` first, check this file +
`git log`, mark your lane `CLAIMED` with name + date in your first
commit (plus an In-flight line in `COORDINATION.md`), and `DONE` with
a result pointer when finished. Statuses: `OPEN` / `CLAIMED` / `DONE`.

| Lane | Status | Claimed by | Date | Notes |
|---|---|---|---|---|
| M1 coach surface — intention registry, label store + counterfactuals, tile chips + intent strip + order interpreter in the page, offline authoring proof on the wreck | OPEN | — | — | Lands in this repo (`docs/coach/`, `docs/explore.html`). **Read first:** `SuperInstance/coach-player` `docs/DESIGN-COMPARISON.md` (merged build order, M1 section). Some rulings there are the owner's; they are marked and are not build gates. |
| Low-tide route-finding — route `make-way` through the floatable channel at tide −1.5 instead of failing on the dry bar | OPEN | — | — | Bar: `tools/mission-test.mjs` at −1.5 completes with **no** safety assertion weakened; +1.4 stays green. Today the −1.5 failure is loud and strike-free by design — keep it honest or make it pass, never cheat it. |
| Performance on weak GPUs — profile the scene on genuinely weak hardware, then optimise | OPEN | — | — | Pixel ratio already capped at 1.5. Keep the approved look. A claim needs a measured before/after number, not a vibe. |
