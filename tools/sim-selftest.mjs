// sim-selftest.mjs — determinism proof for the extracted core.
// Same seed (practice start), same scripted inputs, twice -> the two
// snapshot() strings must be byte-identical. Also: run half, snapshot,
// load into a fresh game, run the rest -> identical to the straight run.
// The scripted input is a pure function of the step index (a "seed" in
// everything but name — the core itself contains no RNG).
import { loadPackFromDisk, applyPracticeStart } from './pack-loader.mjs';
import { createGame, STEP } from '../docs/core.js';

const { pack } = await loadPackFromDisk('docs/real-pack');
const STEPS = 3600;   // 60 s of game time: transit, a drone dive, recovery

function scriptedInput(game, i) {
  const inp = game.input;
  const phase = Math.floor(i / 600) % 6;
  inp.throttle = [1, 1, 0.6, 0, 0, 0][phase];
  inp.turn = [0, 0.3, -0.2, 0, 0.4, 0][phase];
  inp.vert = [0, 0, 0, -0.6, 0.4, 0][phase];
  inp.boost = phase === 3;
  inp.brake = phase === 5;
  if (i === 1200) game.switchVehicle('drone', 'runtime');
  if (i === 3000) game.switchVehicle('boat', 'runtime');
}

function run(steps, fromSnap = null) {
  const game = createGame(pack);
  game.state.tide = 1.4;
  if (fromSnap) game.load(fromSnap);
  else applyPracticeStart(game, 'jamestown');
  for (let i = 0; i < steps; i++) { scriptedInput(game, fromSnap ? i + steps : i); game.step(STEP); }
  return { game, snap: JSON.stringify(game.snapshot()) };
}

const a = run(STEPS);
const b = run(STEPS);
const half = run(STEPS / 2);
const resumed = run(STEPS / 2, half.snap);

let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) fail++; };
check('two fresh runs are byte-identical', a.snap === b.snap);
check('snapshot -> load -> continue equals the straight run', resumed.snap === a.snap);
check('the run actually went somewhere (boat moved, shoal time accrued or drone flew)',
  Math.abs(a.game.state.boat.pos.x - 8200) > 50 || a.game.state.flags.shoalTime > 0 || !a.game.state.drone.aboard);
console.log(`snapshot bytes: ${a.snap.length}`);
process.exit(fail ? 1 : 0);
