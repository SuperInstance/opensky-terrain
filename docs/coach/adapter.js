// adapter.js — the Coach Player runtime's boundary over the game core.
//
// Location choice: the runtime lives in docs/coach/ (not a repo-root
// coach/) because docs/ is the served root — explore.html imports these
// modules as ./coach/*.js, and Node tools import the same files as
// ../docs/coach/*.js. One copy, both hosts.
//
// The adapter is where fail-closed lives. The core keeps the game's
// historical behaviour (sampleBottom assumes -60 m outside the pack);
// the adapter returns NaN for unmapped water, so a tile precondition
// reading NaN is false, a corridor through NaN has probability 0, and
// no safety signal can inherit the "assume deep" lie (HOST-DEFECT-01).
import { SPAWN } from '../core.js';

export function createAdapter(game, pack) {
  const tileAt = (x, z) => pack.tileAt(x, -z);
  return {
    game, pack,
    // bottom height at (x, z) in game coords; NaN outside the pack
    groundAt(x, z) {
      if (tileAt(x, z) < 0) return NaN;
      return game.groundAt(x, z);
    },
    // bathymetry confidence 0..1, or null where the pack carries none
    // (or the point is unmapped) — HOST-DEFECT-02's consumer side
    confidenceAt(x, z) {
      if (tileAt(x, z) < 0) return null;
      return pack.sampleConfidence(x, -z);
    },
    isMapped(x, z) { return tileAt(x, z) >= 0; },

    // Setup assertion (design §5.6): before any tile executes, every
    // anchor the library references must resolve to a real bottom, and
    // a direct line from SPAWN to it must stay inside mapped terrain.
    // (The design's third clause — tide sweep — cannot move an anchor;
    // anchors are xz-fixed, so it is vacuous here and not faked.)
    // Throws loudly on failure: a run on unmapped water does not start.
    assertSetup(anchors) {
      for (const a of anchors) {
        const g = this.groundAt(a.x, a.z);
        if (!Number.isFinite(g)) {
          throw new Error(`SETUP ASSERTION FAILED: anchor "${a.name || a.id || '?'}" (${a.x}, ${a.z}) has no mapped bottom — refusing to run tiles over unmapped water`);
        }
        const dist = Math.hypot(a.x - SPAWN.x, a.z - SPAWN.z);
        const n = Math.max(1, Math.ceil(dist / 20));
        for (let i = 1; i < n; i++) {
          const x = SPAWN.x + (a.x - SPAWN.x) * i / n;
          const z = SPAWN.z + (a.z - SPAWN.z) * i / n;
          if (!this.isMapped(x, z)) {
            throw new Error(`SETUP ASSERTION FAILED: the direct line from SPAWN to anchor "${a.name || a.id || '?'}" leaves mapped terrain at (${x.toFixed(0)}, ${z.toFixed(0)})`);
          }
        }
      }
      return true;
    },
  };
}
