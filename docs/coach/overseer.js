// overseer.js — the deciding layer.
//
// Beat order, cheapest first: possession (a human driving stands the
// whole stack down — and standing down is not a failure), rails, then
// the running tile, then decisions — and decisions happen ONLY at tile
// boundaries, holds and the offer moment, which is what keeps the
// decisions-per-minute budget honest.
//
// A decision (M1) runs three checks in the synthesis's order:
//   1. REGISTRY (structural): the leg's intention must have a
//      claimant in the intention registry, and the leg's tile must
//      be that claimant. No claimant = misfit BY CONSTRUCTION —
//      logged distinctly (structural: true), before any percentage.
//   2. PRECONDITION: the tile may decline, loudly, with its reason.
//   3. FIT (confidence): if a label store is attached and this
//      situation is FAMILIAR in it, fit is the store's empirical
//      rate (synthesis: fit lives in the label store); if the
//      situation is unfamiliar — or no store is attached — the
//      heuristic judge scores it, as in M0. Bands over the result:
//        best >= runFloor        RUN
//        misfit < best < floor   HOLD — look once more in 2 s;
//                                hold_count forces an exit: at the
//                                force count, run the most-proven
//                                eligible tile (session exploratory);
//                                at the arm count, the shadow author
//                                arms as well
//        best <= misfit          MISFIT — none of these are good
//                                enough: hold station, log a
//                                shadow-author opportunity, skip
// Every decided situation is labelled (live outcome, or a
// counterfactual replay afterwards — labels.js) when a store is
// attached. The thresholds are DATA (thresholds.json /
// thresholds.js) with provenance in coach-player
// docs/OVERSEER-NUMBERS.md; the defaults below are the M0 values,
// unchanged — no calibration gate has run yet.
//
// The shadow author is still the whole author layer: when the gates
// WOULD open, the opportunity is recorded with its reasons and NO
// model is called. The escalation-rate evidence costs zero tokens.
import { clamp, hDist } from '../core.js?v=2026-10-14.9';
import { createMakeWay, shapedSpeed, COVE_MOUTH } from './tiles.js?v=2026-10-14.9';
import { DEFAULT_THRESHOLDS, resolveThresholds } from './thresholds.js?v=2026-10-14.9';
import { checkLeg } from './registry.js?v=2026-10-14.9';
import { extractFeatures } from './labels.js?v=2026-10-14.9';

export const RUN_FLOOR = DEFAULT_THRESHOLDS.runFloor, MISFIT = DEFAULT_THRESHOLDS.misfit;

// Authored harvest values (design §2.1 — a port tax: each host game
// authors its own; these are Shoalwater's, in value-units). The
// thresholds file carries the same map; an overseer built with
// thresholds reads them from there.
export const HARVEST = { ...DEFAULT_THRESHOLDS.harvest };
export { COVE_MOUTH };

export function createOverseer({ game, adapter, judge, emit, thresholds = null, labels = null }) {
  const T = resolveThresholds(thresholds);
  const HARV = T.harvest;
  const ctx = { game, adapter };
  const ov = {
    game, adapter, judge, thresholds: T, labels,
    possessed: false,               // a human has the wheel: stand down
    finished: false,
    decisions: 0,
    decisionTimes: [],
    holdCount: 0, holdCountMax: 0,
    exploratory: false,
    shadowOpportunities: [],
    bends: [],
    legResults: [],
    originalLegs: 0,
    structuralMisfits: 0,
    decisionPoints: [],            // snapshots at each started tile (counterfactual feedstock)
    time: 0,
  };
  let plan = [], legIndex = 0, phase = 'decide', tile = null, tileFit = 0;
  let holdUntil = 0, pauseUntil = 0, offerPending = null, offerDone = false;
  let legStatus = [];               // per-plan-leg display status for the coach surface
  let lastDecision = null;          // { tileId, fit, reasons, src } of the most recent decision
  let lastMisfit = null;            // { structural, reason } while a misfit pause runs
  let pendingResult = 'skipped-misfit';
  let pendingLabel = null, pendingFeatures = null, runTookOver = false;

  const say = (kind, data, story) => emit(kind, data, story);
  const zeroInput = () => { const i = game.input; i.throttle = 0; i.turn = 0; i.vert = 0; i.boost = false; i.brake = false; };
  const leg = () => plan[legIndex];
  const fitWord = (fit) => fit == null ? 'no move yet' : fit >= T.runFloor ? 'sure' : fit > T.misfit ? 'trying' : 'no move yet';

  function recordLabel(row) { if (labels) labels.add({ t: ov.time, source: 'live', takeover: false, ...row }); }
  function recordOutcome(outcome) {
    if (pendingLabel) recordLabel({ ...pendingLabel, outcome, takeover: runTookOver });
    pendingLabel = null; runTookOver = false;
  }

  function armShadowAuthor(reason, candidates) {
    const opp = {
      t: ov.time, reason,
      situationClass: leg() ? leg().intention : 'none',
      topReasons: candidates.flatMap(c => c.reasons).slice(0, 3),
      budget: { pulsesUsed: 0, pulsesCap: T.shadowPulsesCap, note: 'shadow only — no model call' },
      holdCount: ov.holdCount,
    };
    ov.shadowOpportunities.push(opp);
    say('shadow-author', opp, `No move good enough — an authoring opportunity was logged (${reason}); no call made.`);
  }

  function startTile(candidate, forced) {
    tile = candidate.tile;
    tileFit = candidate.fit;
    tile.start(ctx);
    phase = 'running';
    legStatus[legIndex] = 'running';
    if (labels) {
      pendingLabel = { tile: tile.id, intention: leg().intention, features: pendingFeatures };
      ov.decisionPoints.push({
        snapshot: game.snapshot(), intention: leg().intention, tileId: tile.id,
        features: pendingFeatures, makeTile: leg().makeTile, t: ov.time,
      });
    }
    say('tile-start', { leg: leg().label, tile: tile.id, fit: tileFit, forced: !!forced },
      `${leg().label}: running ${tile.name} — ${Math.round(tileFit * 100)}% because ${candidate.reasons[0] || 'it fits'}${forced ? ' (forced by hold_count)' : ''}.`);
  }

  function settleMisfitLeg() {
    ov.legResults.push({ label: leg().label, result: pendingResult, inserted: !!leg().inserted });
    legStatus[legIndex] = pendingResult;
    if (pendingLabel) recordLabel({ ...pendingLabel, outcome: 'misfit' });
    pendingLabel = null;
    lastMisfit = null;
  }

  function decide() {
    const L = leg();
    if (!L) { finish(); return; }
    legStatus[legIndex] = 'deciding';
    const candidate = { tile: L.makeTile(), fit: 0, reasons: [] };
    // 1. the registry check — structural, before any percentage
    const reg = checkLeg(L, candidate.tile);
    if (!reg.ok) {
      ov.structuralMisfits++;
      lastMisfit = { structural: true, reason: reg.reason };
      pendingResult = 'skipped-structural-misfit';
      candidate.reasons = [reg.reason];
      say('misfit', { leg: L.label, structural: true, intention: L.intention, reason: reg.reason },
        `${L.label}: no tile claims "${L.intention}" — a structural misfit, not a judgement call. ${reg.reason}`);
      recordLabel({ tile: candidate.tile.id, intention: L.intention, features: extractFeatures({ game, tile: candidate.tile, pre: null }), outcome: 'misfit', structural: true });
      armShadowAuthor('structural misfit: ' + reg.reason, [candidate]);
      phase = 'misfit-pause'; pauseUntil = ov.time + T.misfitPauseS; zeroInput();
      say('hold-station', { leg: L.label }, 'Holding station — safe default while the plan re-thinks.');
      return;
    }
    // 2. the tile's own precondition — a decline is not a candidate
    const pre = candidate.tile.precondition ? candidate.tile.precondition(ctx) : { ok: true };
    if (!pre.ok) {
      // a tile that declines is not a candidate at all — and the
      // refusal is visible here, not buried in a zero score
      say('tile-declined', { leg: L.label, tile: candidate.tile.id, reason: pre.reason },
        `${L.label}: ${candidate.tile.name} declines — ${pre.reason}.`);
      candidate.reasons = [pre.reason];
      recordLabel({ tile: candidate.tile.id, intention: L.intention, features: extractFeatures({ game, tile: candidate.tile, pre }), outcome: 'declined' });
      armShadowAuthor('tile declined: ' + pre.reason, [candidate]);
      L.result = 'declined';
      ov.legResults.push({ label: L.label, result: 'declined', inserted: !!L.inserted });
      legStatus[legIndex] = 'declined';
      advance();
      return;
    }
    // 3. fit — the label store's empirical rate when the situation
    // is familiar in it; the heuristic judge otherwise
    pendingFeatures = extractFeatures({ game, tile: candidate.tile, pre });
    let scored = null, fitSrc = 'judge';
    if (labels && judge && judge.name === 'real') {
      const lf = labels.fit(candidate.tile.id, L.intention, pendingFeatures);
      if (lf.familiar) { scored = { fit: lf.fit, reasons: lf.reasons }; fitSrc = 'labels'; }
    }
    if (!scored) scored = judge.score(candidate.tile, ctx);
    candidate.fit = scored.fit; candidate.reasons = scored.reasons;
    lastDecision = { tileId: candidate.tile.id, fit: candidate.fit, reasons: candidate.reasons, src: fitSrc };
    ov.decisions++; ov.decisionTimes.push(ov.time);
    if (candidate.fit >= T.runFloor) {
      ov.holdCount = 0;
      startTile(candidate, false);
    } else if (candidate.fit > T.misfit) {
      ov.holdCount++; ov.holdCountMax = Math.max(ov.holdCountMax, ov.holdCount);
      if (ov.holdCount >= T.holdCountArmAuthor) {
        armShadowAuthor('hold_count reached the arm count — the library is not settling', [candidate]);
        ov.exploratory = true;
        say('forced-run', { leg: L.label, holdCount: ov.holdCount }, `${L.label}: held ${ov.holdCount} times — forcing the most-proven eligible tile and arming the shadow author.`);
        startTile(candidate, true);
      } else if (ov.holdCount >= T.holdCountForceRun) {
        ov.exploratory = true;
        say('forced-run', { leg: L.label, holdCount: ov.holdCount }, `${L.label}: held twice — running the most-proven eligible tile; session is exploratory.`);
        startTile(candidate, true);
      } else {
        phase = 'hold'; holdUntil = ov.time + T.holdRelookS; zeroInput();
        legStatus[legIndex] = 'holding';
        say('hold', { leg: L.label, fit: candidate.fit, holdCount: ov.holdCount },
          `${L.label}: not sure enough (${Math.round(candidate.fit * 100)}%) — holding station and looking again.`);
      }
    } else {
      lastMisfit = { structural: false, reason: candidate.reasons[0] || 'best fit at or below the floor' };
      pendingResult = 'skipped-misfit';
      pendingLabel = { tile: candidate.tile.id, intention: L.intention, features: pendingFeatures };
      say('misfit', { leg: L.label, fit: candidate.fit, structural: false },
        `${L.label}: no tile is good enough (${Math.round(candidate.fit * 100)}%) — holding station, skipping this leg.`);
      armShadowAuthor('misfit: best fit at or below the floor', [candidate]);
      phase = 'misfit-pause'; pauseUntil = ov.time + T.misfitPauseS; zeroInput();
      legStatus[legIndex] = 'misfit';
      say('hold-station', { leg: L.label }, 'Holding station — safe default while the plan re-thinks.');
    }
  }

  // The scripted offer, scored by the bend rule (design §6.2):
  //   bend when (U*P - C)/minutes + H > value_rate(current leg)
  // H is the corridor's harvest value — a beeline samples no corridor
  // and scores H = 0. The detour inserts a leg; it never drops one.
  function scoreOffer() {
    const target = COVE_MOUTH;
    const b = game.state.boat;
    const dist = hDist(b.pos, target);
    // P: corridor clearance from the adapter — unmapped water counts 0
    const n = Math.max(1, Math.ceil(dist / 100));
    let good = 0;
    for (let i = 0; i <= n; i++) {
      const x = b.pos.x + (target.x - b.pos.x) * i / n, z = b.pos.z + (target.z - b.pos.z) * i / n;
      const g = adapter.groundAt(x, z);
      if (Number.isFinite(g) && game.state.tide - g >= 1.0) good++;
    }
    const P = good / (n + 1);
    const U = HARV.cove;                          // spectacle only — no harvest at the target
    const H = T.corridorHarvestH;                 // corridor BAYC -> WRECK via the shoal flank (authored)
    const currentRate = leg() ? leg().valueRate : 0;
    const C = 0;                                  // an inserted leg defers nothing of value; the home leg rates 0
    const minutes = dist / Math.max(0.3, shapedSpeed(1.3)) / 60;
    const score = (U * P - C) / minutes + H;
    const bent = score > currentRate;
    const rec = { t: ov.time, offer: 'detour to the cove mouth (toward the wreck)', U, P: +P.toFixed(2), C, H, minutes: +minutes.toFixed(1), score: +score.toFixed(2), threshold: currentRate, bent };
    ov.bends.push(rec);
    say('offer', rec, bent
      ? `Offer: the cove mouth, on the way home — bend score ${rec.score} beats the home leg's ${currentRate} (harvest en route ${H}, arrival chance ${rec.P}); bending through the good water.`
      : `Offer: the cove mouth — bend score ${rec.score} does not beat the home leg's ${currentRate}; staying with the plan.`);
    if (bent) {
      plan.splice(legIndex, 0, {
        label: 'detour — cove mouth', intention: 'detour', valueRate: H, inserted: true,
        makeTile: () => createMakeWay({ x: target.x, z: target.z, speed: 1.3 }),
      });
      legStatus.splice(legIndex, 0, 'pending');
    }
  }

  function advance() {
    tile = null;
    legIndex++;
    // the offer moment: the shoal leg has completed, home is next
    if (!offerDone && leg() && leg().intention === 'reach-home') {
      offerDone = true;
      scoreOffer();
    }
    if (legIndex >= plan.length) { finish(); return; }
    phase = 'decide';
    decide();
  }

  function finish() {
    phase = 'done'; ov.finished = true; zeroInput();
    const completed = ov.legResults.filter(r => r.result === 'done' && !r.inserted).length;
    say('plan-complete', { completed, of: ov.originalLegs },
      `Plan complete: ${completed} of ${ov.originalLegs} original legs done.`);
  }

  ov.begin = (planLegs, offerSpec) => {
    plan = planLegs;
    ov.originalLegs = planLegs.length;
    legStatus = planLegs.map(() => 'pending');
    legIndex = 0; phase = 'decide';
    if (offerSpec) offerPending = offerSpec;
    say('plan-start', { legs: plan.map(l => l.label) }, `A-plan: ${plan.map(l => l.label).join(' → ')}.`);
    decide();
  };

  ov.tick = (dt) => {
    ov.time += dt;
    if (ov.finished) return;
    // 1. possession — a human driving stands everything down, and the
    //    tile's write never happens: the input stays the human's. A
    //    run the human interrupted is labelled takeover-tainted, so
    //    its outcome never counts as the tile's evidence.
    if (ov.possessed) { if (phase === 'running' && tile) runTookOver = true; return; }
    // 2. rails — taking water collapses the plan to the home leg
    const F = game.state.flags;
    if (F.takingWater && leg() && leg().intention !== 'reach-home' && phase === 'running') {
      say('rail', { rule: 'takingWater' }, 'Rail: she is taking water — abandoning the leg, making for home.');
      if (tile) {
        ov.legResults.push({ label: leg().label, result: 'railed', inserted: !!leg().inserted });
        legStatus[legIndex] = 'railed';
        recordOutcome('railed');
      }
      legIndex = plan.findIndex(l => l.intention === 'reach-home');
      tile = null; phase = 'decide';
      decide();
      return;
    }
    // 3. the running tile / the pauses
    if (phase === 'running' && tile) {
      const status = tile.tick(ctx, dt);
      if (status === 'done') {
        say('tile-done', { leg: leg().label, tile: tile.id }, `${leg().label}: ${tile.name} — done.`);
        ov.legResults.push({ label: leg().label, result: 'done', inserted: !!leg().inserted });
        legStatus[legIndex] = 'done';
        recordOutcome('done');
        ov.holdCount = 0;
        advance();
      } else if (status === 'failed') {
        say('tile-failed', { leg: leg().label, tile: tile.id }, `${leg().label}: ${tile.name} failed — the plan moves on without it.`);
        ov.legResults.push({ label: leg().label, result: 'failed', inserted: !!leg().inserted });
        legStatus[legIndex] = 'failed';
        recordOutcome('failed');
        advance();
      }
    } else if (phase === 'hold') {
      zeroInput();
      if (ov.time >= holdUntil) decide();
    } else if (phase === 'coach-hold') {
      zeroInput();
      if (ov.time >= holdUntil) { phase = 'decide'; decide(); }
    } else if (phase === 'misfit-pause') {
      zeroInput();
      if (ov.time >= pauseUntil) { settleMisfitLeg(); advance(); }
    }
  };

  // ---- the coach surface's verbs ----
  // coachGoTo(i): the chip press. Send the plan to leg i: a running
  // tile is settled as a coach-skip (never silently dropped), legs
  // leapt over without a result are recorded as coach-skips, the
  // cove-mouth offer is scored when the jump lands on the home leg
  // exactly as advance() scores it, and the target leg is decided
  // now. Pressing the current leg while it waits (hold / misfit
  // pause) re-decides it immediately.
  ov.coachGoTo = (i) => {
    if (ov.finished || i < 0 || i >= plan.length) return false;
    if (i === legIndex) {
      if (phase === 'running') return true;             // already there
      if (phase === 'misfit-pause') { settleMisfitLeg(); advance(); return true; }   // the press is the pause expiring, on demand
      phase = 'decide'; decide();                       // hold / coach-hold: re-decide now
      return true;
    }
    if (phase === 'running' && tile) {
      ov.legResults.push({ label: leg().label, result: 'coach-skip', inserted: !!leg().inserted });
      legStatus[legIndex] = 'coach-skip';
      recordOutcome('coach-skip');
      tile = null;
    } else if (phase === 'misfit-pause') {
      settleMisfitLeg();
    }
    const from = legIndex;
    for (let k = from + 1; k < i; k++) {
      if (legStatus[k] === 'pending' || legStatus[k] === 'deciding') {
        ov.legResults.push({ label: plan[k].label, result: 'coach-skip', inserted: !!plan[k].inserted });
        legStatus[k] = 'coach-skip';
      }
    }
    legIndex = i;
    say('coach-goto', { leg: leg().label, from }, `Coach's call: to "${leg().label}" — the plan jumps.`);
    if (!offerDone && leg() && leg().intention === 'reach-home') { offerDone = true; scoreOffer(); }
    phase = 'decide';
    decide();
    return true;
  };

  // holdStation(seconds): the coach's "hold on" — decisions pause,
  // input zeroed, for a bounded spell, then the current leg is
  // re-decided. A running tile is NOT interrupted (that is what
  // possession is for); returns false then.
  ov.holdStation = (seconds = 60) => {
    if (ov.finished || phase === 'running' || phase === 'done') return false;
    phase = 'coach-hold'; holdUntil = ov.time + seconds; zeroInput();
    legStatus[legIndex] = 'holding';
    say('coach-hold', { seconds }, `Coach's order: hold station for ${Math.round(seconds)} seconds.`);
    return true;
  };

  // read(): the intent strip's whole diet — the overseer's current
  // read, in words. Fit is shown as a WORD (sure / trying / no move
  // yet): no judge has passed a calibration gate, so no number is
  // shown on the coach surface (synthesis convergence #1).
  ov.read = () => ({
    phase, finished: ov.finished, possessed: ov.possessed,
    legIndex, legLabel: leg() ? leg().label : null,
    intention: leg() ? leg().intention : null,
    tileId: tile ? tile.id : (lastDecision ? lastDecision.tileId : null),
    tileName: tile ? tile.name : null,
    fit: lastDecision ? lastDecision.fit : null,
    fitWord: fitWord(lastDecision ? lastDecision.fit : null),
    fitSrc: lastDecision ? lastDecision.src : null,
    reasons: lastDecision ? lastDecision.reasons : [],
    misfit: phase === 'misfit-pause' ? lastMisfit : null,
    holdCount: ov.holdCount, exploratory: ov.exploratory,
    plan: plan.map((l, i) => ({ label: l.label, intention: l.intention, status: legStatus[i] || 'pending' })),
  });

  ov.planCompletion = () => {
    // inserted legs (the bend's detour) are reported in legResults
    // but never inflate completion: the measure is the ORIGINAL plan
    const done = ov.legResults.filter(r => r.result === 'done' && !r.inserted).length;
    return ov.originalLegs ? done / ov.originalLegs : 0;
  };

  return ov;
}
