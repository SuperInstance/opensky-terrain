// session.js — run one Coach Player session headless over the core,
// writing sessions/<id>/trace.jsonl (machine) and story.md (one
// human-readable line per event, reason first). Used by the control
// runs and the harness; the page drives the same overseer live.
//
// M1: the session loads its thresholds from thresholds.json (the
// data of record; built-in defaults if the file can't be read),
// attaches a label store to the overseer (every decided situation
// is labelled with its outcome), and afterwards runs a bounded
// COUNTERFACTUAL pass: stored decision snapshots are replayed —
// the picked tile under shifted water (±0.3 m of tide), and any
// other claimant of the same intention the registry names — so
// tiles and conditions never lived still earn labels. Labels land
// in sessions/<id>/labels.jsonl beside the trace.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGame, STEP, SPAWN, BAYC, WRECK } from '../core.js?v=2026-10-14.9';
import { createAdapter } from './adapter.js?v=2026-10-14.9';
import { createOverseer } from './overseer.js?v=2026-10-14.9';
import { SHOAL_POINT, SEARCH_AREA } from './tiles.js?v=2026-10-14.9';
import { JUDGES } from './judges.js?v=2026-10-14.9';
import { buildDefaultPlan, buildFullMissionPlan, TILE_FACTORIES } from './plans.js?v=2026-10-14.9';
import { resolveThresholds } from './thresholds.js?v=2026-10-14.9';
import { createLabelStore, replaySituation } from './labels.js?v=2026-10-14.9';
import { claimantsFor } from './registry.js?v=2026-10-14.9';

export { buildDefaultPlan, buildFullMissionPlan };

const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// The thresholds data of record, read from beside this module.
// Any failure (missing file, bad JSON) falls back to the built-in
// defaults — resolveThresholds only takes finite numbers for known
// keys, so a corrupt file retunes nothing it shouldn't.
export async function loadThresholds() {
  try {
    const text = await readFile(new URL('./thresholds.json', import.meta.url), 'utf8');
    return resolveThresholds(JSON.parse(text));
  } catch (e) {
    return resolveThresholds(null);
  }
}

export async function runSession({
  pack, judgeName = 'real', tide = 1.4, plan = null, maxMinutes = 120,
  sessionId = null, rootDir = 'sessions', writeLogs = true,
  labels = null, counterfactuals = true,
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

  const thresholds = await loadThresholds();
  const store = labels || createLabelStore({
    knnK: thresholds.knnK, alpha: thresholds.knnAlpha,
    familiarMin: thresholds.familiarMinNeighbours, radius: thresholds.knnRadius,
  });

  const trace = [], story = [];
  const emit = (kind, data, storyLine) => {
    trace.push({ t: +game.state.time.toFixed(2), kind, ...data });
    if (storyLine) story.push(`- [${fmtT(game.state.time)}] ${storyLine}`);
  };
  const judge = JUDGES[judgeName];
  if (!judge) throw new Error('unknown judge: ' + judgeName);
  const ov = createOverseer({ game, adapter, judge, emit, thresholds, labels: store });
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

  // ---- counterfactual pass (bounded by thresholds) ----
  // For each decision snapshot: replay the picked tile under
  // shifted water, and replay any OTHER claimant of the intention
  // (the registry names them; with one claimant per intention that
  // set is empty today, and the tide variants are what accrue).
  let cfCount = 0;
  if (counterfactuals) {
    const cap = thresholds.counterfactualMaxReplays;
    for (const dp of ov.decisionPoints) {
      if (cfCount >= cap) break;
      const ranFeatures = dp.features;
      const jobs = [];
      for (const dt of [0.3, -0.3]) {
        jobs.push({ makeTile: dp.makeTile, tide: +(tide + dt).toFixed(2), features: { ...ranFeatures, tide: +(tide + dt).toFixed(2) } });
      }
      for (const claimant of claimantsFor(dp.intention)) {
        if (claimant.tileId === dp.tileId) continue;
        const factory = TILE_FACTORIES[claimant.tileId];
        if (factory) jobs.push({ makeTile: () => factory({ makeTile: dp.makeTile }), tide, features: ranFeatures, tileId: claimant.tileId });
      }
      for (const job of jobs) {
        if (cfCount >= cap) break;
        const tile = job.makeTile();
        const res = replaySituation({ pack, createGame, snapshot: dp.snapshot, tide: job.tide, tile });
        store.add({
          tile: tile.id, intention: dp.intention, features: job.features,
          outcome: res.outcome, takeover: false, source: 'counterfactual', t: dp.t,
        });
        cfCount++;
        emit('counterfactual', { tile: tile.id, intention: dp.intention, tide: job.tide, outcome: res.outcome },
          `Counterfactual: ${tile.name} from the "${dp.intention}" decision at tide ${job.tide >= 0 ? '+' : ''}${job.tide} — ${res.outcome}.`);
      }
    }
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
    structuralMisfits: ov.structuralMisfits,
    labels: store.counts(),
    counterfactuals: cfCount,
    reserveSpent: game.state.flags.reserveSpent,
    batteryEnd: +game.state.drone.battery.toFixed(3),
  };
  if (writeLogs && sessionId) {
    const dir = join(rootDir, sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'trace.jsonl'), trace.map(e => JSON.stringify(e)).join('\n') + '\n');
    await writeFile(join(dir, 'story.md'),
      `# Session ${sessionId} — judge ${judgeName}, tide ${tide >= 0 ? '+' : ''}${tide}\n\n` + story.join('\n') + '\n');
    await writeFile(join(dir, 'labels.jsonl'), store.toJSONL());
    report.logs = dir;
  }
  return { report, game, overseer: ov, trace, story, labels: store };
}
