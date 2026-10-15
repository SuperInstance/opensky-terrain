# AGENTS.md — Shoalwater

**What this is:** a browser game of Sitka Sound built from real
bathymetry — skipper the F/V Eileen, work a shoal, hunt a lost crab pot
by its pinger, log a wreck, come home. It is also the proving ground for
Coach Player: the runtime in `docs/coach/` is that project's M0.
Live: https://superinstance.github.io/shoalwater/explore.html

**Read order:** this file → `ONBOARDING.md` → `COORDINATION.md` (who
owns which surface, who is in flight) → `CLAIMS.md` (open lanes).
Then run the suite once before changing anything.

**Run it:** serve `docs/` statically, open `explore.html`.
**Test it** (repo root, Node ≥18, stdlib only, no install):
`node tools/sim-selftest.mjs`, `harness.mjs`, `run-controls.mjs`,
`demo-test.mjs`, `mission-test.mjs`, `boot-watchdog-test.mjs`.

## The six hard rules

1. **Main is production.** Pages deploys `main`/`docs/` automatically —
   a push is a release, live in ~a minute.
2. **The stamp rule.** Every local module import edge carries
   `?v=2026-10-14.8` (in `explore.html` + `demo.js`). Any change to the
   module set or a module's contract bumps the stamp on **all** edges
   in the same commit. A torn stamp set strands phones on a dead
   loading veil — it has happened; don't repeat it.
3. **The suite is the gate.** All six suites green + `node --check`
   on the page module before anything reaches `main`.
4. **Shared tree.** Pull and read HEAD + `COORDINATION.md` before
   touching anything; surfaces have owners (hail via the main lane).
   The untracked `one-battery/` directory is another lane's — **never
   touch it**.
5. **Watchdog contract.** Only boot-critical failures (tagged
   `bootFail`/`bootCritical`) may show the boot failure panel.
   Scenery failures (far-view skirt, harbour kit, traffic) are
   console-only, never a dead game.
6. **Mobile invariants (≤700 px).** The minichart owns a sovereign
   bottom-right box — nothing overlaps it. Informational HUD elements
   are pop-and-settle chips; warnings (keel, taking water, reserve
   battery) pin open while they hold.

**Claiming work:** see the protocol in `ONBOARDING.md` — check
`CLAIMS.md` + `git log`, mark `CLAIMED` (name + date) in your first
commit, `DONE` with a result pointer when finished.
