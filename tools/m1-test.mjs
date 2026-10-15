// m1-test.mjs — the M1 build, verified piece by piece:
//   1. thresholds as data (the JSON and the built-in defaults agree;
//      the session loader reads the file)
//   2. the intention registry (every plan leg claimed; a plan with
//      an unclaimed intention meets a STRUCTURAL misfit — logged
//      distinctly, leg settled, plan still completes)
//   3. the label store (kNN fit maths, familiarity, exclusions, the
//      JSONL round-trip) and its integration (a familiar situation
//      is scored by the store, an unfamiliar one by the judge)
//   4. counterfactual replays (a session accrues counterfactual
//      labels for stored decision snapshots)
//   5. hold-station, the authored tile (3 tides, drone out -> home
//      aboard -> watch held -> done; the authoring bar)
//   6. the order interpreter (phrase table, fuzzy, control verbs,
//      dials, the honest none, unplanned intentions)
//   7. coachGoTo (the chip press: settle, skip honestly, land, run)
// PASS/FAIL lines; exit 1 on any failure. Writes no session logs.
import { loadPackFromDisk, applyPracticeStart } from './pack-loader.mjs';
import { createGame, STEP, SPAWN, BAYC } from '../docs/core.js?v=2026-10-14.9';
import { createAdapter } from '../docs/coach/adapter.js?v=2026-10-14.9';
import { createOverseer } from '../docs/coach/overseer.js?v=2026-10-14.9';
import { JUDGES } from '../docs/coach/judges.js';
import { createMakeWay, createWorkTheShoal, createHoldStation } from '../docs/coach/tiles.js?v=2026-10-14.9';
import { runSession, buildDefaultPlan, loadThresholds } from '../docs/coach/session.js';
import { claimantsFor, checkPlan, checkLeg } from '../docs/coach/registry.js';
import { createLabelStore, extractFeatures } from '../docs/coach/labels.js?v=2026-10-14.9';
import { DEFAULT_THRESHOLDS, resolveThresholds, flattenDefaults, flattenJsonThresholds } from '../docs/coach/thresholds.js';
import { interpret } from '../docs/coach/interpreter.js?v=2026-10-14.9';
import { readFileSync } from 'node:fs';
const thresholdsJson = JSON.parse(readFileSync(new URL('../docs/coach/thresholds.json', import.meta.url), 'utf8'));

const { pack } = await loadPackFromDisk('docs/real-pack');
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const TIDES = [-1.5, 1.4, 4.0];

// ---------- 1. thresholds as data ----------
{
  const flat = flattenDefaults();
  const fromJson = flattenJsonThresholds(thresholdsJson);
  const keys = new Set([...Object.keys(flat), ...Object.keys(fromJson)]);
  const mismatches = [...keys].filter(k => flat[k] !== fromJson[k]);
  check('thresholds.json and the built-in defaults agree on every value', mismatches.length === 0,
    mismatches.length ? `mismatch: ${mismatches.map(k => `${k}: json=${fromJson[k]} default=${flat[k]}`).join('; ')}` : `${keys.size} values`);
  const loaded = await loadThresholds();
  check('the session loader reads thresholds.json (values match the defaults)',
    loaded.runFloor === DEFAULT_THRESHOLDS.runFloor && loaded.misfit === DEFAULT_THRESHOLDS.misfit && loaded.knnK === 20 && loaded.harvest.pot === 1.8,
    `runFloor=${loaded.runFloor} misfit=${loaded.misfit} knnK=${loaded.knnK} harvest.pot=${loaded.harvest.pot}`);
  const corrupt = resolveThresholds({ numbers: { runFloor: { value: 'banana' }, misfit: { value: 0.31 } }, harvest: { pot: { value: 2.5 } } });
  check('resolveThresholds takes finite numbers only, for known keys',
    corrupt.runFloor === DEFAULT_THRESHOLDS.runFloor && corrupt.misfit === 0.31 && corrupt.harvest.pot === 2.5,
    `runFloor=${corrupt.runFloor} misfit=${corrupt.misfit} pot=${corrupt.harvest.pot}`);
}

// ---------- 2. the intention registry ----------
{
  const rows = checkPlan(buildDefaultPlan());
  check('every default-plan leg is claimed', rows.every(r => r.claimed), rows.map(r => `${r.intention}:${r.claimants.join('/')}`).join(' '));
  check('registry: no claimant for an undeclared intention', claimantsFor('survey-the-harbour').length === 0);
  const bad = checkLeg({ intention: 'work-shoal' }, createMakeWay({ x: BAYC.x, z: BAYC.z }));
  check('registry: a tile that does not claim the intention is refused structurally', !bad.ok && bad.structural === true, bad.reason || '');

  // a whole session whose plan asks for an intention nobody claims
  const plan = [
    { label: 'survey the harbour', intention: 'survey-the-harbour', valueRate: 0, makeTile: () => createMakeWay({ x: BAYC.x, z: BAYC.z }) },
    { label: 'make way to Jamestown Bay', intention: 'reach', valueRate: 0.6, makeTile: () => createMakeWay({ x: BAYC.x, z: BAYC.z, speed: 5.4 }) },
  ];
  const { report, trace } = await runSession({ pack, judgeName: 'real', tide: 1.4, plan, writeLogs: false, counterfactuals: false, maxMinutes: 60 });
  const sm = trace.find(e => e.kind === 'misfit' && e.structural === true);
  check('structural misfit is logged distinctly in the trace', !!sm, sm ? sm.reason : 'no structural misfit event');
  check('structural misfit settles its leg and the plan moves on',
    report.planResults[0] && report.planResults[0].result === 'skipped-structural-misfit' && report.structuralMisfits === 1 && report.terminated === 'plan-complete',
    JSON.stringify(report.planResults));
}

// ---------- 3. the label store ----------
{
  const feats = { tide: 1.4, battery: 1.0, depth: 11.8, distKm: null };
  const store = createLabelStore({});
  check('an empty store calls every situation unfamiliar', store.fit('work-the-shoal', 'work-shoal', feats).familiar === false);
  for (let i = 0; i < 4; i++) store.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: feats, outcome: 'failed', takeover: false, source: 'live', t: i });
  check('four neighbours is still unfamiliar (familiarMin = 5)', store.fit('work-the-shoal', 'work-shoal', feats).familiar === false,
    `n=${store.fit('work-the-shoal', 'work-shoal', feats).n}`);
  store.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: feats, outcome: 'failed', takeover: false, source: 'live', t: 5 });
  store.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: feats, outcome: 'done', takeover: false, source: 'live', t: 6 });
  const f = store.fit('work-the-shoal', 'work-shoal', feats);
  // p0 = tile rate = 1/6; fit = (1 + 4*(1/6)) / (6 + 4) = 0.1667
  check('a familiar fit is the smoothed empirical rate', f.familiar && Math.abs(f.fit - (1 + 4 / 6) / 10) < 1e-9, `fit=${f.fit && f.fit.toFixed(4)} n=${f.n}`);
  check('fit reasons name the evidence', f.familiar && /1 of the 6/.test(f.reasons[0]), f.reasons[0] || '');
  // exclusions: takeover and declined rows are not tile evidence
  const s2 = createLabelStore({});
  for (let i = 0; i < 6; i++) s2.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: feats, outcome: 'done', takeover: true, source: 'live', t: i });
  for (let i = 0; i < 6; i++) s2.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: feats, outcome: 'declined', takeover: false, source: 'live', t: i });
  check('takeover and declined rows never count as neighbours', s2.fit('work-the-shoal', 'work-shoal', feats).familiar === false);
  // far water is not a neighbour: a different tide is out of radius
  const s3 = createLabelStore({});
  for (let i = 0; i < 6; i++) s3.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: { ...feats, tide: -1.5 }, outcome: 'done', takeover: false, source: 'live', t: i });
  check('labels from different water do not leak across the radius', s3.fit('work-the-shoal', 'work-shoal', feats).familiar === false);
  // JSONL round-trip
  const s4 = createLabelStore({});
  s4.loadJSONL(store.toJSONL());
  check('the JSONL round-trip preserves the store', s4.size() === store.size() && s4.fit('work-the-shoal', 'work-shoal', feats).fit === f.fit, `${s4.size()} rows`);

  // integration: seeded failures make the overseer take its fit
  // from the store (and misfit on it); an empty store leaves the
  // heuristic judge in charge and the tile runs
  const mkOv = (labels) => {
    const game = createGame(pack);
    game.state.tide = 1.4;
    applyPracticeStart(game, 'jamestown');
    const adapter = createAdapter(game, pack);
    const ov = createOverseer({ game, adapter, judge: JUDGES.real, emit: () => {}, labels });
    ov.begin([{ label: 'work the shoal', intention: 'work-shoal', valueRate: 2.4, makeTile: () => createWorkTheShoal() }], false);
    return ov;
  };
  const seeded = createLabelStore({});
  {
    const game = createGame(pack); game.state.tide = 1.4; applyPracticeStart(game, 'jamestown');
    const adapter = createAdapter(game, pack);
    const tile = createWorkTheShoal();
    const pre = tile.precondition({ game, adapter });
    const atDecision = extractFeatures({ game, tile, pre });
    for (let i = 0; i < 6; i++) seeded.add({ tile: 'work-the-shoal', intention: 'work-shoal', features: atDecision, outcome: 'failed', takeover: false, source: 'live', t: i });
  }
  const ovSeeded = mkOv(seeded);
  check('a familiar situation is scored by the label store', ovSeeded.read().fitSrc === 'labels' && ovSeeded.read().misfit !== null,
    `fitSrc=${ovSeeded.read().fitSrc} fit=${ovSeeded.read().fit}`);
  const ovEmpty = mkOv(createLabelStore({}));
  check('an unfamiliar situation falls back to the heuristic judge', ovEmpty.read().fitSrc === 'judge' && ovEmpty.read().phase === 'running',
    `fitSrc=${ovEmpty.read().fitSrc} phase=${ovEmpty.read().phase}`);
}

// ---------- 4. counterfactual replays ----------
{
  const plan = [{ label: 'work the shoal', intention: 'work-shoal', valueRate: 2.4, makeTile: () => createWorkTheShoal() }];
  const { report, labels } = await runSession({ pack, judgeName: 'real', tide: 1.4, plan, writeLogs: false, maxMinutes: 120 });
  const counts = labels.counts();
  check('the session labels its live outcome', (counts.byOutcome.done || 0) + (counts.byOutcome.failed || 0) >= 1, JSON.stringify(counts.byOutcome));
  check('the counterfactual pass replays the decision under shifted water',
    report.counterfactuals >= 1 && (counts.bySource.counterfactual || 0) === report.counterfactuals,
    `replays=${report.counterfactuals} cfLabels=${counts.bySource.counterfactual || 0}`);
}

// ---------- 5. hold-station: the authored tile, 3 tides ----------
for (const tide of TIDES) {
  const game = createGame(pack);
  game.state.tide = tide;
  applyPracticeStart(game, 'jamestown');
  const adapter = createAdapter(game, pack);
  // put the drone out, 60 m east, on 80%: the situation the tile is for
  game.switchVehicle('drone', 'runtime');
  const d = game.state.drone;
  d.pos.x += 60; d.pos.y = tide - 2; d.battery = 0.8;
  game.switchVehicle('boat', 'runtime');   // >15 m away: she stays out
  const anchor = { x: game.state.boat.pos.x, z: game.state.boat.pos.z };
  const tile = createHoldStation({ watchS: 5 });
  const ctx = { game, adapter };
  tile.start(ctx);
  let status = 'running';
  for (let i = 0; i < 600 * 60 && status === 'running'; i++) { status = tile.tick(ctx, STEP); game.step(STEP); }
  const drift = Math.hypot(game.state.boat.pos.x - anchor.x, game.state.boat.pos.z - anchor.z);
  check(`hold-station @ tide ${tide}: drone recovered, watch held, done`,
    status === 'done' && d.aboard && drift <= 30 && game.state.flags.hullHits === 0 && !game.state.flags.reserveSpent,
    `status=${status} aboard=${d.aboard} drift=${drift.toFixed(0)}m hullHits=${game.state.flags.hullHits} reserveSpent=${game.state.flags.reserveSpent}`);
}
{
  // and the quiet case: everything already aboard — just the watch
  const game = createGame(pack);
  game.state.tide = 1.4;
  const adapter = createAdapter(game, pack);
  const tile = createHoldStation({ watchS: 5 });
  const ctx = { game, adapter };
  tile.start(ctx);
  let status = 'running';
  for (let i = 0; i < 60 * 60 && status === 'running'; i++) { status = tile.tick(ctx, STEP); game.step(STEP); }
  check('hold-station with everything aboard is a pure watch', status === 'done' && game.state.drone.aboard, `status=${status} simT=${game.state.time.toFixed(0)}s`);
}

// ---------- 6. the order interpreter ----------
{
  const planIntentions = ['reach', 'work-shoal', 'hunt-pot', 'wreck-look', 'reach-home'];
  const a = interpret('hunt the pot', { planIntentions });
  check('phrase table: "hunt the pot"', a.kind === 'intention' && a.intention === 'hunt-pot' && a.via === 'phrase' && a.inPlan, JSON.stringify(a));
  const b = interpret('bring her home', { planIntentions });
  check('phrase table: "bring her home"', b.kind === 'intention' && b.intention === 'reach-home', JSON.stringify(b));
  const c = interpret('hold station', { planIntentions });
  check('"hold station" applies even with no hold leg in the plan', c.kind === 'intention' && c.intention === 'hold-station' && c.applicable === true && !c.inPlan, JSON.stringify(c));
  const d2 = interpret('work the shoal', { planIntentions: ['reach'] });
  check('an intention outside the plan resolves but cannot apply', d2.kind === 'intention' && d2.inPlan === false && d2.applicable === false && /no such leg/.test(d2.template), d2.template);
  const e = interpret('slow down', { planIntentions });
  check('dial: "slow down" is the clock at 1×', e.kind === 'dial' && e.name === 'time' && e.value === 1, JSON.stringify(e));
  const f2 = interpret('stop', { planIntentions });
  check('control: "stop" stands the coach down', f2.kind === 'control' && f2.verb === 'stand-down', JSON.stringify(f2));
  const g = interpret('hunt the pott', { planIntentions });
  check('fuzzy pass stays inside the vocabulary', g.kind === 'intention' && g.intention === 'hunt-pot' && g.via === 'fuzzy', JSON.stringify(g));
  const h = interpret('take me to the moon', { planIntentions });
  check('an unmatched order is an honest none, with the vocabulary named', h.kind === 'none' && /moves I know/.test(h.template), h.template);
  const i2 = interpret('   ', { planIntentions });
  check('an empty order is a none, not an error', i2.kind === 'none');
}

// ---------- 7. coachGoTo: the chip press ----------
{
  const game = createGame(pack);
  game.state.tide = 1.4;
  const adapter = createAdapter(game, pack);
  const ov = createOverseer({ game, adapter, judge: JUDGES.real, emit: () => {} });
  ov.begin(buildDefaultPlan(), false);
  for (let i = 0; i < 30; i++) { ov.tick(STEP); game.step(STEP); }
  const wasRunning = ov.read().phase === 'running';
  const ok = ov.coachGoTo(2);
  const r = ov.read();
  check('coachGoTo settles the running leg and the leapt leg as coach-skips',
    ok && wasRunning && ov.legResults.filter(x => x.result === 'coach-skip').length === 2,
    JSON.stringify(ov.legResults.map(x => x.result)));
  check('coachGoTo lands and decides (the offer may insert its detour first)',
    (r.legIndex === 2) && (r.phase === 'running' || r.phase === 'hold'),
    `legIndex=${r.legIndex} phase=${r.phase} legs=${r.plan.map(p => p.label).join(' | ')}`);
  check('read() speaks in words, never a raw percentage',
    ['sure', 'trying', 'no move yet'].includes(r.fitWord) && r.reasons.length >= 1, `fitWord=${r.fitWord}`);
  check('holdStation refuses to interrupt a running tile', ov.holdStation(30) === false);
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
