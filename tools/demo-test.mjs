// demo-test.mjs — the page demo, flown headlessly against the core.
//
// Imports the demo's OWN steering + choreography from docs/demo.js
// — the same module docs/explore.html imports — so this tests the
// real show, not a copy. Two scenarios at tide +1.4:
//
//   A (the reported failure): from SPAWN, demo steps 0 and 1 must
//      complete — reach (5600, 150), then (7600, 380) — with the
//      heading error converging on each leg.
//   B (the deeper break found while investigating A): the FULL
//      show must run to its final step. Pre-fix, step 4 launched
//      the drone at the pot from 256 m away; the battery died en
//      route (~180 s of boosted flight per charge at ~1.4 m/s),
//      arrival never latched, and the phase had no other exit —
//      the show hung there forever. The choreography now stages
//      the boat ~85 m out and charges on deck first; this scenario
//      is the regression proof.
//
// Usage: node tools/demo-test.mjs    (exit 0 = all assertions pass)

import { loadPackFromDisk } from './pack-loader.mjs';
import { createGame, STEP } from '../docs/core.js';
import { createDemo, wrapPi } from '../docs/demo.js';

const { pack, docsDir } = await loadPackFromDisk(new URL('../docs/real-pack', import.meta.url).pathname);

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function freshDemo() {
  const game = createGame(pack);
  game.state.tide = 1.4;
  const ctl = createDemo({
    state: game.state, input: game.input, groundAt: game.groundAt,
    say: () => {}, switchVehicle: (v) => game.switchVehicle(v, 'runtime'),
  });
  ctl.demo.on = true;
  ctl.set(0);
  return { game, demo: ctl.demo, control: ctl.control };
}

const headingErr = (state, x, z) => {
  const b = state.boat;
  return Math.abs(wrapPi(Math.atan2(-(x - b.pos.x), -(z - b.pos.z)) - b.theta));
};

// ---------- Scenario A: steps 0 and 1 from SPAWN ----------
{
  const { game, demo, control } = freshDemo();
  const legs = [
    { step: 0, x: 5600, z: 150, budgetS: 600, name: 'step-0 leg SPAWN -> (5600,150)' },
    { step: 1, x: 7600, z: 380, budgetS: 900, name: 'step-1 leg (5600,150) -> (7600,380)' },
  ];
  for (const leg of legs) {
    let t = 0, maxErrLate = 0, arrived = false;
    const errSamples = [];
    while (t < leg.budgetS * 60) {
      control(STEP);
      game.step(STEP);
      t++;
      if (t % 60 === 0) errSamples.push(headingErr(game.state, leg.x, leg.z));
      if (demo.step !== leg.step) { arrived = true; break; }
    }
    const late = errSamples.slice(-30);
    if (late.length) maxErrLate = Math.max(...late);
    check(`${leg.name} completes`, arrived, `in ${(t / 60).toFixed(0)} s (budget ${leg.budgetS} s)`);
    check(`${leg.name} heading error converges`, arrived && maxErrLate < 0.15,
      `max |heading error| over final 30 s = ${maxErrLate.toFixed(3)} rad`);
  }
  const castOff = game.objectives().find(o => o[0] === 'Cast off');
  check('cast-off objective ticked', !!(castOff && castOff[1]));
}

// ---------- Scenario B: the full show ----------
{
  const { game, demo, control } = freshDemo();
  const F = game.state.flags;
  const budget = 240 * 3600;   // 240 sim-minutes
  let t = 0, minAirBatt = 1, stalledStep = null, lastStep = 0, lastStepT = 0;
  while (t < budget) {
    control(STEP);
    game.step(STEP);
    t++;
    const d = game.state.drone;
    if (!d.aboard) minAirBatt = Math.min(minAirBatt, d.battery);
    if (demo.step !== lastStep) { lastStep = demo.step; lastStepT = t; }
    if (demo.step === 9) break;
  }
  stalledStep = demo.step === 9 ? null : demo.step;
  check('full show reaches its final step (9)', demo.step === 9,
    demo.step === 9 ? `in ${(t / 3600).toFixed(1)} sim-min` : `stuck on step ${stalledStep} for ${((t - lastStepT) / 3600).toFixed(1)} sim-min`);
  check('pot found by the demo', F.potFound === true);
  check('wreck seen by the demo', F.wreckSeen === true);
  check('hull hits == 0', F.hullHits === 0, `hullHits=${F.hullHits}`);
  check('drone aboard at the end', game.state.drone.aboard === true);
  check('drone battery never hit empty in flight', minAirBatt > 0.02, `min airborne battery = ${minAirBatt.toFixed(2)}`);
}

console.log(failures === 0 ? '\nDEMO TEST: ALL PASS' : `\nDEMO TEST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
