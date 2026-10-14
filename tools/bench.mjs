// bench.mjs — how fast does the core step headless? Physics + adapter
// sampling only (no rendering exists down here to slow it down).
import { loadPackFromDisk, applyPracticeStart } from './pack-loader.mjs';
import { createGame, STEP, SPAWN, BAYC } from '../docs/core.js';
import { createAdapter } from '../docs/coach/adapter.js';

const { pack } = await loadPackFromDisk('docs/real-pack');
const game = createGame(pack);
const adapter = createAdapter(game, pack);
applyPracticeStart(game, 'spawn');
game.input.throttle = 0.9;   // underway: every step does real sampling work

const N = 200000;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  game.step(STEP);
  if (i % 600 === 0) {   // an adapter read at beat rate, as the runtime does
    adapter.groundAt(game.state.boat.pos.x, game.state.boat.pos.z);
    adapter.confidenceAt(SPAWN.x, SPAWN.z);
  }
}
const wall = (performance.now() - t0) / 1000;
const simSeconds = N * STEP;
console.log(`steps=${N} wall=${wall.toFixed(2)}s sim=${simSeconds.toFixed(0)}s`);
console.log(`speed: ${(N / wall).toFixed(0)} steps/s = ${(simSeconds / wall).toFixed(0)}x real time`);
console.log(`end state: boat at (${game.state.boat.pos.x.toFixed(0)}, ${game.state.boat.pos.z.toFixed(0)}), bay reached: ${Math.hypot(game.state.boat.pos.x - BAYC.x, game.state.boat.pos.z - BAYC.z) < 350}`);
