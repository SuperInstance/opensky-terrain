# Claims — open work lanes

Who is working on what, so lanes don't collide. Protocol (full version
in `ONBOARDING.md`): read `COORDINATION.md` first, check this file +
`git log`, mark your lane `CLAIMED` with name + date in your first
commit (plus an In-flight line in `COORDINATION.md`), and `DONE` with
a result pointer when finished. Statuses: `OPEN` / `CLAIMED` / `DONE`.

| Lane | Status | Claimed by | Date | Notes |
|---|---|---|---|---|
| M1 coach surface — intention registry, label store + counterfactuals, tile chips + intent strip + order interpreter in the page, offline authoring proof on the wreck | DONE | Muse (Coach Player lane) | 2026-10-14 | Shipped in main `3de9588`: registry (structural misfit), label store + counterfactual pass, coach chips/intent strip/order interpreter (template echo, on-device), hold-station authored tile, thresholds.json. Gate: `tools/m1-test.mjs` (37 checks) + all six prior suites green; live coach playtest passed (typed "hunt the pot" → echo → confirm → pot hunted to 7 m). Known gap: counterfactuals accrue tide variants only until a second claimant per intention is authored. |
| Low-tide route-finding — route `make-way` through the floatable channel at tide −1.5 instead of failing on the dry bar | OPEN | — | — | Bar: `tools/mission-test.mjs` at −1.5 completes with **no** safety assertion weakened; +1.4 stays green. Today the −1.5 failure is loud and strike-free by design — keep it honest or make it pass, never cheat it. |
| Performance on weak GPUs — profile the scene on genuinely weak hardware, then optimise | OPEN | — | — | Pixel ratio already capped at 1.5. Keep the approved look. A claim needs a measured before/after number, not a vibe. |
