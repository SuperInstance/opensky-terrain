// mission-test.mjs — the full Scene 1 mission, headless, at two
// tides. The plan: make-way(bay) -> work-the-shoal -> hunt-the-pot
// (pinger only) -> wreck-look -> make-way(home), driven by the real
// judge through the overseer, on the real pack.
//
// Tide +1.4: the whole job must complete — all six objective flags
// achieved at some point, pot found, wreck logged, no hull hits,
// the drone home aboard, and the battery's reserve third never
// spent (the game's own ledger: flags.reserveSpent, set the moment
// any dive that dipped below 1/3 is recovered, plus the last dive's
// diveMin and the drone never dead).
//
// Tide -1.5: the direct transit crosses a bar that is dry at low
// water (measured in M0) and the cove itself is dry — the mission
// is NOT expected to complete, and this test does not pretend
// otherwise. What must hold at -1.5 is the safety contract: zero
// hull hits, the plan still settles (every leg resolves — done,
// failed or declined — and the overseer finishes), the drone ends
// aboard, the reserve is unspent. Completion is reported as an INFO
// line naming the first leg that did not complete.
import { loadPackFromDisk } from './pack-loader.mjs';
import { runSession, buildFullMissionPlan } from '../docs/coach/session.js';

const { pack } = await loadPackFromDisk('docs/real-pack');
let failures = 0;
const line = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); if (!ok) failures++; };
const info = (text) => console.log(`INFO ${text}`);

const SIX = ['Cast off', 'Jamestown Bay', 'Work the shoal', 'Find the pot', 'Bring her home', 'Log the wreck'];

async function run(tide, sessionId) {
  const { report, game } = await runSession({
    pack, judgeName: 'real', tide, plan: buildFullMissionPlan(),
    maxMinutes: 180, sessionId,
  });
  const F = game.state.flags;
  return { report, game, F,
    achieved: new Set(report.objectivesCompleted),
    missing: SIX.filter(n => !report.objectivesCompleted.includes(n)),
    firstIncompleteLeg: report.planResults.find(r => r.result !== 'done') || null,
  };
}

// ---------- tide +1.4: the whole job ----------
{
  const { report, game, F, achieved, missing } = await run(1.4, 'mission-t14');
  console.log(`\n=== full mission @ tide +1.4 (${report.simMinutes} sim-min, ${report.decisions} decisions) ===`);
  line(report.terminated === 'plan-complete', `plan settles — terminated=${report.terminated}`);
  line(report.planCompletion === 1, `all 5 plan legs done — completion=${report.planCompletion} (${report.planResults.map(r => `${r.label}=${r.result}`).join('; ')})`);
  for (const name of SIX) line(achieved.has(name), `objective achieved: ${name}`);
  line(F.potFound === true, `potFound — ${F.potFound}`);
  line(F.wreckSeen === true, `wreckSeen — ${F.wreckSeen}`);
  line(report.stumbles.hullHits === 0, `hullHits == 0 — ${report.stumbles.hullHits} hits, ${report.stumbles.groundings} groundings`);
  line(game.state.drone.aboard === true, `drone aboard at end — aboard=${game.state.drone.aboard} dead=${game.state.drone.dead}`);
  line(F.reserveSpent === false && game.state.drone.diveMin >= 1 / 3 && !game.state.drone.dead,
    `reserve third never spent — reserveSpent=${F.reserveSpent} lastDiveMin=${game.state.drone.diveMin.toFixed(2)} batteryEnd=${report.batteryEnd}`);
  if (missing.length) info(`missing objectives: ${missing.join(', ')}`);
}

// ---------- tide -1.5: the safety contract ----------
{
  const { report, game, F, firstIncompleteLeg } = await run(-1.5, 'mission-tm15');
  console.log(`\n=== full mission @ tide -1.5 (${report.simMinutes} sim-min, ${report.decisions} decisions) ===`);
  line(report.stumbles.hullHits === 0, `hullHits == 0 — ${report.stumbles.hullHits} hits, ${report.stumbles.groundings} groundings`);
  line(report.terminated === 'plan-complete', `plan settles — terminated=${report.terminated} (${report.planResults.map(r => `${r.label}=${r.result}`).join('; ')})`);
  line(game.state.drone.aboard === true, `drone aboard at end — aboard=${game.state.drone.aboard} dead=${game.state.drone.dead}`);
  line(F.reserveSpent === false && !game.state.drone.dead,
    `reserve third never spent — reserveSpent=${F.reserveSpent} lastDiveMin=${game.state.drone.diveMin.toFixed(2)} batteryEnd=${report.batteryEnd}`);
  info(`completion=${report.planCompletion === 1} at tide -1.5 — objectives achieved: ${report.objectivesCompleted.join(', ') || 'none'}` +
    (firstIncompleteLeg ? `; first incomplete leg: "${firstIncompleteLeg.label}" (${firstIncompleteLeg.result})` : ''));
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
