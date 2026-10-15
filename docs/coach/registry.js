// registry.js — the intention registry: the structural half of
// misfit (Coach Player synthesis ruling: registry check first,
// confidence bands second).
//
// Every intention a plan can ask for is declared here, with the
// tile(s) that claim it. An intention with NO claimant is a misfit
// BY CONSTRUCTION — a checkable fact the overseer establishes
// before any percentage is computed, not a judge's mood. The
// overseer consults this registry at every decision: a leg whose
// intention is unclaimed, or whose tile does not claim it, never
// reaches the judge at all; it is logged as a structural misfit
// (trace kind 'misfit', structural: true) and the shadow author
// arms with the gap named — the registry is also the author's
// worklist, since an unclaimed intention is precisely a tile
// waiting to be written.
//
// This file is data + pure checks. Construction of tiles lives in
// plans.js / tiles.js; the registry declares, it does not build.
export const REGISTRY = [
  {
    tileId: 'make-way',
    intentions: ['reach', 'reach-home', 'detour'],
    name: 'make way',
    premise: 'Take her to the named water at a working speed, keel-guarded the whole way.',
  },
  {
    tileId: 'work-the-shoal',
    intentions: ['work-shoal'],
    name: 'work the shoal',
    premise: 'Put the drone over the pale patch, hold her close over the bottom for ten seconds, and bring her back with a third still in the bank.',
  },
  {
    tileId: 'hunt-the-pot',
    intentions: ['hunt-pot'],
    name: 'hunt the pot',
    premise: "Find the Marigold's pot by its pinger alone — short hops, range samples, a trilaterated fix — and hold the find.",
  },
  {
    tileId: 'wreck-look',
    intentions: ['wreck-look'],
    name: 'look at the wreck',
    premise: 'Creep the cove under the keel guard and let the drone look at the wreck — or decline a dry cove, loudly.',
  },
  {
    tileId: 'hold-station',
    intentions: ['hold-station'],
    name: 'hold station',
    premise: 'Bring everything to a safe held state — the drone home aboard, the boat on station — and watch for a spell.',
  },
];

export const claimantsFor = (intention) => REGISTRY.filter(e => e.intentions.includes(intention));
export const entryForTile = (tileId) => REGISTRY.find(e => e.tileId === tileId) || null;
export const isClaimed = (intention) => claimantsFor(intention).length > 0;

// The registry check for one leg + the tile the leg built.
// ok when the intention has at least one claimant AND this tile is
// one of them; otherwise a structural refusal with the reason a
// human can read.
export function checkLeg(leg, tile) {
  const claimants = claimantsFor(leg.intention);
  if (!claimants.length) {
    return { ok: false, structural: true, reason: `no tile in the library claims the intention "${leg.intention}"` };
  }
  if (!claimants.some(e => e.tileId === tile.id)) {
    return { ok: false, structural: true, reason: `the tile "${tile.id}" does not claim the intention "${leg.intention}" (claimed by ${claimants.map(e => e.tileId).join(', ')})` };
  }
  return { ok: true, claimants };
}

// Plan-level view: one row per leg, for the coach surface and the
// session report — which legs are covered, which are gaps.
export function checkPlan(plan) {
  return plan.map(leg => {
    const claimants = claimantsFor(leg.intention);
    return { label: leg.label, intention: leg.intention, claimed: claimants.length > 0, claimants: claimants.map(e => e.tileId) };
  });
}
