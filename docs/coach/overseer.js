// overseer.js — the deciding layer, M0 scope (design §8.1).
//
// Beat order, cheapest first: possession (a human driving stands the
// whole stack down — and standing down is not a failure), rails, then
// the running tile, then decisions — and decisions happen ONLY at tile
// boundaries, holds and the offer moment, which is what keeps the
// decisions-per-minute budget honest. Bands over the judge's fit:
//   best >= 0.70        RUN
//   0.30 < best < 0.70  HOLD — look once more in 2 s; hold_count forces
//                       an exit: at 2, run the most-proven eligible
//                       tile and mark the session exploratory; at 3,
//                       the shadow author arms as well
//   best <= 0.30        MISFIT — none of these are good enough: hold
//                       station, log a shadow-author opportunity, skip
// The thresholds are provisional (no calibration gate has run — M1).
//
// The shadow author is M0's whole author layer: when the gates WOULD
// open, the opportunity is recorded with its reasons and NO model is
// called. The escalation-rate evidence costs zero tokens.
import { clamp, hDist } from '../core.js';
import { createMakeWay, shapedSpeed, COVE_MOUTH } from './tiles.js';

export const RUN_FLOOR = 0.70, MISFIT = 0.30;

// Authored harvest values (design §2.1 — a port tax: each host game
// authors its own; these are Shoalwater's, in value-units).
export const HARVEST = { SPAWN: 0.0, BAYC: 0.6, shoal: 2.4, pot: 1.8, WRECK: 0.0, cove: 0.0 };
export { COVE_MOUTH };

export function createOverseer({ game, adapter, judge, emit }) {
  const ctx = { game, adapter };
  const ov = {
    game, adapter, judge,
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
    time: 0,
  };
  let plan = [], legIndex = 0, phase = 'decide', tile = null, tileFit = 0;
  let holdUntil = 0, pauseUntil = 0, offerPending = null, offerDone = false;

  const say = (kind, data, story) => emit(kind, data, story);
  const zeroInput = () => { const i = game.input; i.throttle = 0; i.turn = 0; i.vert = 0; i.boost = false; i.brake = false; };
  const leg = () => plan[legIndex];

  function armShadowAuthor(reason, candidates) {
    const opp = {
      t: ov.time, reason,
      situationClass: leg() ? leg().intention : 'none',
      topReasons: candidates.flatMap(c => c.reasons).slice(0, 3),
      budget: { pulsesUsed: 0, pulsesCap: 3, note: 'shadow only — M0 makes no model call' },
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
    say('tile-start', { leg: leg().label, tile: tile.id, fit: tileFit, forced: !!forced },
      `${leg().label}: running ${tile.name} — ${Math.round(tileFit * 100)}% because ${candidate.reasons[0] || 'it fits'}${forced ? ' (forced by hold_count)' : ''}.`);
  }

  function decide() {
    const L = leg();
    if (!L) { finish(); return; }
    const candidate = { tile: L.makeTile(), fit: 0, reasons: [] };
    const pre = candidate.tile.precondition ? candidate.tile.precondition(ctx) : { ok: true };
    if (!pre.ok) {
      // a tile that declines is not a candidate at all — and the
      // refusal is visible here, not buried in a zero score
      say('tile-declined', { leg: L.label, tile: candidate.tile.id, reason: pre.reason },
        `${L.label}: ${candidate.tile.name} declines — ${pre.reason}.`);
      candidate.reasons = [pre.reason];
      armShadowAuthor('tile declined: ' + pre.reason, [candidate]);
      L.result = 'declined';
      ov.legResults.push({ label: L.label, result: 'declined', inserted: !!L.inserted });
      advance();
      return;
    }
    const scored = judge.score(candidate.tile, ctx);
    candidate.fit = scored.fit; candidate.reasons = scored.reasons;
    ov.decisions++; ov.decisionTimes.push(ov.time);
    if (candidate.fit >= RUN_FLOOR) {
      ov.holdCount = 0;
      startTile(candidate, false);
    } else if (candidate.fit > MISFIT) {
      ov.holdCount++; ov.holdCountMax = Math.max(ov.holdCountMax, ov.holdCount);
      if (ov.holdCount >= 3) {
        armShadowAuthor('hold_count reached 3 — the library is not settling', [candidate]);
        ov.exploratory = true;
        say('forced-run', { leg: L.label, holdCount: ov.holdCount }, `${L.label}: held three times — forcing the most-proven eligible tile and arming the shadow author.`);
        startTile(candidate, true);
      } else if (ov.holdCount >= 2) {
        ov.exploratory = true;
        say('forced-run', { leg: L.label, holdCount: ov.holdCount }, `${L.label}: held twice — running the most-proven eligible tile; session is exploratory.`);
        startTile(candidate, true);
      } else {
        phase = 'hold'; holdUntil = ov.time + 2; zeroInput();
        say('hold', { leg: L.label, fit: candidate.fit, holdCount: ov.holdCount },
          `${L.label}: not sure enough (${Math.round(candidate.fit * 100)}%) — holding station and looking again.`);
      }
    } else {
      say('misfit', { leg: L.label, fit: candidate.fit },
        `${L.label}: no tile is good enough (${Math.round(candidate.fit * 100)}%) — holding station, skipping this leg.`);
      armShadowAuthor('misfit: best fit at or below the floor', [candidate]);
      phase = 'misfit-pause'; pauseUntil = ov.time + 5; zeroInput();
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
    const U = HARVEST.cove;                       // spectacle only — no harvest at the target
    const H = 0.9;                                // corridor BAYC -> WRECK via the shoal flank (authored)
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
    legIndex = 0; phase = 'decide';
    if (offerSpec) offerPending = offerSpec;
    say('plan-start', { legs: plan.map(l => l.label) }, `A-plan: ${plan.map(l => l.label).join(' → ')}.`);
    decide();
  };

  ov.tick = (dt) => {
    ov.time += dt;
    if (ov.finished) return;
    // 1. possession — a human driving stands everything down, and the
    //    tile's write never happens: the input stays the human's
    if (ov.possessed) return;
    // 2. rails — taking water collapses the plan to the home leg
    const F = game.state.flags;
    if (F.takingWater && leg() && leg().intention !== 'reach-home' && phase === 'running') {
      say('rail', { rule: 'takingWater' }, 'Rail: she is taking water — abandoning the leg, making for home.');
      if (tile) { ov.legResults.push({ label: leg().label, result: 'railed', inserted: !!leg().inserted }); }
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
        ov.holdCount = 0;
        advance();
      } else if (status === 'failed') {
        say('tile-failed', { leg: leg().label, tile: tile.id }, `${leg().label}: ${tile.name} failed — the plan moves on without it.`);
        ov.legResults.push({ label: leg().label, result: 'failed', inserted: !!leg().inserted });
        advance();
      }
    } else if (phase === 'hold') {
      zeroInput();
      if (ov.time >= holdUntil) decide();
    } else if (phase === 'misfit-pause') {
      zeroInput();
      if (ov.time >= pauseUntil) {
        ov.legResults.push({ label: leg().label, result: 'skipped-misfit', inserted: !!leg().inserted });
        advance();
      }
    }
  };

  ov.planCompletion = () => {
    // inserted legs (the bend's detour) are reported in legResults
    // but never inflate completion: the measure is the ORIGINAL plan
    const done = ov.legResults.filter(r => r.result === 'done' && !r.inserted).length;
    return ov.originalLegs ? done / ov.originalLegs : 0;
  };

  return ov;
}
