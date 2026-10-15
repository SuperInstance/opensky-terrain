// plans.js — the A-plans: legs the same runner executes, in the
// day's order. A leg is { label, intention, valueRate, makeTile } —
// the intention is what the registry checks, the valueRate is what
// the bend rule spends against, makeTile builds the runner.
//
// Extracted from session.js in M1 so the page's coach surface can
// run the very same plans the headless sessions verify — one plan
// definition, two hosts, no drift.
import { SPAWN, BAYC } from '../core.js?v=2026-10-14.9';
import { HARVEST } from './overseer.js?v=2026-10-14.9';
import { createMakeWay, createWorkTheShoal, createHuntThePot, createWreckLook, createHoldStation } from './tiles.js?v=2026-10-14.9';

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

// Fresh tile factories by tile id, for counterfactual replays: a
// replay needs to build the tile that CLAIMS a stored situation's
// intention without the leg that happened to run it. make-way is
// parameterised by its leg, so its factory defers to the leg's own
// builder; the rest build bare. (With one claimant per intention
// the cross-tile replay set is empty today — the registry is the
// worklist that changes that; the tide-variant replays in
// session.js are what accrue labels meanwhile.)
export const TILE_FACTORIES = {
  'make-way': (leg) => leg.makeTile(),
  'work-the-shoal': () => createWorkTheShoal(),
  'hunt-the-pot': () => createHuntThePot(),
  'wreck-look': () => createWreckLook(),
  'hold-station': () => createHoldStation({}),
};
