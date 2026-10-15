// session.js — run one Coach Player session headless over the core,
// writing sessions/<id>/trace.jsonl (machine) and story.md (one
// human-readable line per event, reason first). Used by the control
// runs and the harness; the page will drive the same overseer live.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGame, STEP, SPAWN, BAYC, WRECK } from '../core.js';
import { createAdapter } from './adapter.js';
import { createOverseer, HARVEST } from './overseer.js';
import { createMakeWay, createWorkTheShoal, createHuntThePot, createWreckLook, SHOAL_POINT, SEARCH_AREA } from './tiles.js';
import { JUDGES } from './judges.js';

export function buildDefaultPlan() {
  return [
    { label: 'make way to Jamestown Bay', intention: 'reach', valueRate: HARVEST.BAYC,
      makeTile: () => createMakeWay({ x: BAYC.x, z: BAYC.z, speed: 5.4 }) },
    { label: 'work the shoal', intention: 'work-shoal', valueRate: HARVEST.shoal,
      makeTile: () => createWorkTheShoal() },
    { label: 'bring her home', intention: 'reach-home', valueRate: HARVEST.SPAWN,
      makeTile: () => createMakeWay({ x: SPAWN.x, z: SPAWN.z, speed: 5.4 }) },
  ];
}

// The full mission: the whole Scene 1 job, end to end — bay, shoal,
// the Marigold's pot, the wreck, and home. The bend/offer machinery
// still fires where it fires (home follows the wreck, so the cove
// mouth offer is scored from the cove itself — a short, honest bend).
export function buildFullMissionPlan() {
  return [
    { label: 'make way to Jamestown Bay', intention: 'reach', valueRate: HARVEST.BAYC,
      makeTile: () => createMakeWay({ x: BAYC.x, z: BAYC.z, speed: 5.4 }) },
    { label: 'work the shoal', intention: 'work-shoal', valueRate: HARVEST.shoal,
      makeTile: () => createWorkTheShoal() },
    { label: 'hunt the pot', intention: 'hunt-pot', valueRate: HARVEST.pot,
      makeTile: () => createHuntThePot() },
    { label: 'look at the wreck', intention: 'wreck-look', valueRate: HARVEST.WRECK,
      makeTile: () => createWreckLook() },
    { label: 'bring her home', intention: 'reach-home', valueRate: HARVEST.SPAWN,
      makeTile: () => createMakeWay({ x: SPAWN.x, z: SPAWN.z, speed: 5.4 }) },
  ];
}

const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export async function runSession({
  pack, judgeName = 'real', tide = 1.4, plan = null, maxMinutes = 120,
  sessionId = null, rootDir = 'sessions', writeLogs = true,
}) {
  const game = createGame(pack);
  game.state.tide = tide;
  const adapter = createAdapter(game, pack);
  // the setup assertion gates everything: unmapped water, no session
  adapter.assertSetup([
    { name: 'SPAWN', ...SPAWN }, { name: 'BAYC', ...BAYC },
    { name: 'shoal', ...SHOAL_POINT }, { name: 'pot drainage (charted search area)', ...SEARCH_AREA },
    { name: 'cove mouth', x: 8957, z: 596 }, { name: 'wreck', ...WRECK },
  ]);

  const trace = [], story = [];
  const emit = (kind, data, storyLine) => {
    trace.push({ t: +game.state.time.toFixed(2), kind, ...data });
    if (storyLine) story.push(`- [${fmtT(game.state.time)}] ${storyLine}`);
  };
  const judge = JUDGES[judgeName];
  if (!judge) throw new Error('unknown judge: ' + judgeName);
  const ov = createOverseer({ game, adapter, judge, emit });
  ov.begin(plan || buildDefaultPlan(), true);

  let groundings = 0, prevAground = false, prevHullHits = 0;
  const objectivesEver = new Set();
  const maxSteps = Math.floor(maxMinutes * 3600);
  let steps = 0;
  while (!ov.finished && steps < maxSteps) {
    ov.tick(STEP);
    game.step(STEP);
    steps++;
    for (const [name, done] of game.objectives()) if (done) objectivesEver.add(name);
    for (const e of game.events.splice(0)) {
      if (e.type === 'hullHit') emit('hull-hit', { hits: e.hits }, `Struck the bottom hard — hull hit ${e.hits}.`);
      else if (e.type === 'note') emit('game-note', { text: e.text }, e.text);
      else emit(e.type, {}, null);
    }
    const b = game.state.boat;
    if (b.aground && !prevAground) groundings++;
    prevAground = b.aground;
    prevHullHits = game.state.flags.hullHits;
  }
  const simMinutes = game.state.time / 60;
  const objectives = game.objectives().map(([name, done]) => ({ name, done }));
  const report = {
    session: sessionId, judge: judgeName, tide,
    terminated: ov.finished ? 'plan-complete' : 'timeout',
    simMinutes: +simMinutes.toFixed(1),
    objectivesCompleted: [...objectivesEver],
    objectivesFinal: objectives.filter(o => o.done).map(o => o.name),
    objectives,
    planCompletion: +ov.planCompletion().toFixed(2),
    planResults: ov.legResults,
    bends: ov.bends,
    stumbles: { groundings, hullHits: game.state.flags.hullHits },
    decisions: ov.decisions,
    decisionsPerMin: +(ov.decisions / Math.max(simMinutes, 0.01)).toFixed(2),
    holdCountMax: ov.holdCountMax,
    exploratory: ov.exploratory,
    shadowOpportunities: ov.shadowOpportunities.length,
    reserveSpent: game.state.flags.reserveSpent,
    batteryEnd: +game.state.drone.battery.toFixed(3),
  };
  if (writeLogs && sessionId) {
    const dir = join(rootDir, sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'trace.jsonl'), trace.map(e => JSON.stringify(e)).join('\n') + '\n');
    await writeFile(join(dir, 'story.md'),
      `# Session ${sessionId} — judge ${judgeName}, tide ${tide >= 0 ? '+' : ''}${tide}\n\n` + story.join('\n') + '\n');
    report.logs = dir;
  }
  return { report, game, overseer: ov, trace, story };
}
