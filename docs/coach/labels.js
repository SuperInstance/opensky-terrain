// labels.js — the label store: where fit lives (Coach Player
// synthesis ruling: fit is an empirical rate over labelled
// situations, not a model judge's mood; the heuristic judge
// survives only as the fallback for the UNFAMILIAR state).
//
// Every decided situation leaves a row: the tile, the intention,
// the situation's features, and what happened — done, failed,
// declined, misfit, coach-skip, or a takeover-tainted run. Rows
// come from live runs and from counterfactual replays (a stored
// snapshot re-run against a tile that was never picked, or the
// picked tile under shifted water). Fit for a familiar situation
// is the smoothed empirical rate over the k nearest labelled
// neighbours for the same (tile, intention):
//
//   P = (successes + α · p0) / (n + α),   p0 = the tile's overall rate
//
// with k and α from thresholds (CL §6.2: k=20, α=4, both guesses).
// Fewer than familiarMinNeighbours (5) neighbours inside the
// radius ⇒ the situation is UNFAMILIAR and the caller falls back
// to the heuristic judge; a high read on thin evidence is treated
// as shaky however it scores (§6.2).
//
// Only done/failed rows without a takeover count as neighbours:
// declines and misfits are planner evidence, not tile evidence,
// and a takeover says something about the coach, not the tile.
import { hDist } from '../core.js?v=2026-10-14.9';
import { createAdapter } from './adapter.js?v=2026-10-14.9';

// The situation signature a label carries. Everything here is
// adapter- or state-visible at decision time — the same discipline
// as the tiles: no hidden state in a feature.
export function extractFeatures({ game, tile, pre }) {
  const s = game.state;
  return {
    tide: s.tide,
    battery: s.drone.battery,
    // the precondition's own measurement, when it makes one (the
    // water over the work, in metres); null for tiles that don't
    depth: pre && typeof pre.depth === 'number' && Number.isFinite(pre.depth) ? pre.depth : null,
    // transit distance for target tiles, km
    distKm: tile && tile.target ? hDist(s.boat.pos, tile.target) / 1000 : null,
  };
}

// Normalised feature distance: each axis scaled to roughly its
// operating span, so one metre of tide and one battery-third don't
// pretend to be the same unit. Null axes are skipped; two rows
// sharing fewer than two axes are infinitely far apart.
const AXES = [
  ['tide', 5.5],      // the game's tide range, -1.5 .. 4.0
  ['battery', 1],
  ['depth', 5],
  ['distKm', 5],
];
export function featureDistance(a, b) {
  let sum = 0, n = 0;
  for (const [key, span] of AXES) {
    if (typeof a[key] !== 'number' || typeof b[key] !== 'number') continue;
    const d = (a[key] - b[key]) / span;
    sum += d * d; n++;
  }
  return n >= 2 ? Math.sqrt(sum) : Infinity;
}

export function createLabelStore({ knnK = 20, alpha = 4, familiarMin = 5, radius = 0.35, maxRows = 2000, onAdd = null } = {}) {
  const rows = [];
  const store = {
    rows,
    add(row) {
      rows.push(row);
      if (rows.length > maxRows) rows.splice(0, rows.length - maxRows);
      if (onAdd) onAdd(row);
      return row;
    },
    size() { return rows.length; },
    // the tile's overall empirical rate across all its settled
    // runs (the prior p0 for the smoothing formula)
    tileRate(tileId) {
      let n = 0, s = 0;
      for (const r of rows) {
        if (r.tile !== tileId || r.takeover) continue;
        if (r.outcome === 'done') { n++; s++; }
        else if (r.outcome === 'failed') n++;
      }
      return n ? { n, rate: s / n } : { n: 0, rate: 0.5 };
    },
    neighbours(tileId, intention, features) {
      const out = [];
      for (const r of rows) {
        if (r.tile !== tileId || r.intention !== intention || r.takeover) continue;
        if (r.outcome !== 'done' && r.outcome !== 'failed') continue;
        const d = featureDistance(r.features, features);
        if (d <= radius) out.push({ row: r, d });
      }
      out.sort((a, b) => a.d - b.d);
      return out.slice(0, knnK);
    },
    // fit for (tile, intention) in this situation, from evidence.
    // familiar=false is a first-class answer: it means "no honest
    // number exists yet — ask the fallback judge".
    fit(tileId, intention, features) {
      const near = store.neighbours(tileId, intention, features);
      if (near.length < familiarMin) return { familiar: false, n: near.length, fit: null, reasons: [] };
      const successes = near.filter(x => x.row.outcome === 'done').length;
      const p0 = store.tileRate(tileId).rate;
      const fit = (successes + alpha * p0) / (near.length + alpha);
      const cf = near.filter(x => x.row.source === 'counterfactual').length;
      return {
        familiar: true, n: near.length, successes, fit,
        reasons: [`${successes} of the ${near.length} most similar runs worked${cf ? ` (${cf} of them counterfactual replays)` : ''} — the label store's rate`],
      };
    },
    counts() {
      const byOutcome = {}, bySource = {};
      for (const r of rows) {
        byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
        bySource[r.source] = (bySource[r.source] || 0) + 1;
      }
      return { total: rows.length, byOutcome, bySource };
    },
    toJSONL() { return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''); },
    loadJSONL(text) {
      let n = 0;
      for (const line of String(text).split('\n')) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); n++; } catch (e) { /* a torn line is skipped, never fatal */ }
      }
      return n;
    },
  };
  return store;
}

// Counterfactual replay: re-run ONE situation from its snapshot
// against a tile, in a fresh game, and return the outcome — a
// label for a run that never happened live (CL §6.2). The snapshot
// is the core's own (snapshot/load: the same state a live decision
// faced). A tile that declines the replayed water settles as
// 'declined', exactly as it would live. Bounded by maxSeconds of
// sim; a tile still running at the bound settles 'failed' (its own
// timeout discipline should have fired first — every tile in the
// library is capped).
export function replaySituation({ pack, createGame, snapshot, tide, tile, maxSeconds = 2700 }) {
  const game = createGame(pack);
  game.load(typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot);
  if (typeof tide === 'number') game.state.tide = tide;
  const adapter = createAdapter(game, pack);
  const ctx = { game, adapter };
  const pre = tile.precondition ? tile.precondition(ctx) : { ok: true };
  if (!pre.ok) return { outcome: 'declined', reason: pre.reason };
  tile.start(ctx);
  const STEP = 1 / 60;
  const maxSteps = Math.floor(maxSeconds * 60);
  let status = 'running';
  for (let i = 0; i < maxSteps && status === 'running'; i++) {
    status = tile.tick(ctx, STEP);
    game.step(STEP);
  }
  return { outcome: status === 'done' ? 'done' : 'failed', simSeconds: game.state.time - (snapshot.time || 0) };
}
