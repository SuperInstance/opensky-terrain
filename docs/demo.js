// demo.js — the autoplay demo's steering + choreography, shared by
// the page (docs/explore.html) and the headless regression test
// (tools/demo-test.mjs), so the test flies the REAL demo, not a copy.
//
// The steering helpers are the demo's own formulas, unchanged from
// the page originals: proportional heading control against the
// core's theta convention (fwd = (-sin th, -cos th)), arrival =
// within 16 m for the boat, within 5 m / 0.9 m for the drone.
//
// Choreography fix (2026-10-14): the drone steps were budgeted
// as if drone legs were cheap; they are not — at the old flat
// 0.85 throttle the effort drain (~0.005/s) makes ~200 m of
// flying cost a whole battery, and every drone phase had exactly
// one exit (arrival), so a drone that died en route hung the show
// forever. Measured on the old choreography: the pot step launched
// from 256 m out and died mid-leg; the shoal round trip (97 m
// legs) landed with 2% battery; the wreck orbit spent so much
// that the flight home died 24 m short of the boat. The steps now
// POSITION the boat close first (the drone charges on deck during
// the sail), the pot step launches only at >= 90% battery, the
// wreck orbit is one held viewpoint instead of four, and outbound
// phases carry a battery guard — turn for home while the charge
// still covers it. (Easing the drone throttle on short legs was
// tried and measured worse: the drain is per-second, so a slow
// leg costs more per metre, not less.)

import { SPAWN, POT, WRECK } from './core.js';

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
const fwdOf = (th) => ({ x: -Math.sin(th), z: -Math.cos(th) });

// Steer the boat toward (x, z) at the given target speed.
// Returns true on arrival (within 16 m).
export function boatTo(state, input, x, z, speed) {
  const b = state.boat;
  const dx = x - b.pos.x, dz = z - b.pos.z;
  if (Math.hypot(dx, dz) < 16) { input.throttle = 0; input.turn = 0; return true; }
  input.turn = clamp(wrapPi(Math.atan2(-dx, -dz) - b.theta) * 1.6, -1, 1);
  input.throttle = clamp(speed / 6, 0.16, 0.95);
  return false;
}

// Steer the drone toward (x, y, z). Returns true on arrival
// (within 5 m horizontally, 0.9 m vertically). Throttle stays at
// 0.85 underway on purpose: the battery drain is mostly a per-
// second cost (~0.003-0.005/s at working effort), so a faster leg
// is a CHEAPER leg per metre — easing off just burns the clock.
export function droneTo(state, input, x, y, z) {
  const d = state.drone;
  const dx = x - d.pos.x, dz = z - d.pos.z, distH = Math.hypot(dx, dz);
  input.turn = clamp(wrapPi(Math.atan2(-dx, -dz) - d.theta) * 1.8, -1, 1);
  input.throttle = distH > 5 ? 0.85 : 0.2;
  input.vert = clamp((y - d.pos.y) * 0.9, -1, 1);
  input.boost = distH > 50;
  return distH < 5 && Math.abs(y - d.pos.y) < 0.9;
}

// Where the boat lies for the pot dive: ~45 m west of the pot on
// the drainage — deep water (bottom ~-6 m), a ~35 s drone leg.
export const POT_STAGING = { x: 8495, z: 430 };
// Where the boat lies for the shoal dive: ~50 m from the shoal
// point — the step-2 arrival leaves her ~97 m out, a round trip
// that costs essentially a whole battery.
export const SHOAL_STAGING = { x: 8330, z: 438 };

export function createDemo({ state, input, groundAt, say, switchVehicle }) {
  const demo = { on: false, step: 0, phase: 'go', wait: 0, stuck: 0, unstick: 0, orbit: 0, cap: '' };
  const set = (step) => { demo.step = step; demo.phase = 'go'; demo.wait = 0; demo.stuck = 0; demo.orbit = 0; };
  const boat = (x, z, s) => boatTo(state, input, x, z, s);
  const drone = (x, y, z) => droneTo(state, input, x, y, z);
  // Battery guard for drone outbound phases: turn for home while
  // the remaining charge still covers the flight back.
  const lowBatt = () => state.drone.battery < 0.35;

  function control(dt) {
    input.brake = false;
    const b = state.boat, d = state.drone;
    // unstick: if she grounded or hung up under way, back off the way the game teaches
    if (state.vehicle === 'boat' && demo.step !== 5 && demo.step !== 9) {
      if (demo.unstick > 0) { demo.unstick -= dt; input.throttle = -0.5; input.turn = 0; return; }
      if (Math.abs(b.speed) < 0.05 && input.throttle > 0) { demo.stuck += dt; if (demo.stuck > 2) { demo.unstick = 1.2; demo.stuck = 0; } }
      else if (Math.abs(b.speed) >= 0.05) demo.stuck = 0;
    }
    switch (demo.step) {
      case 0: say('Casting off — the Western Anchorage');
        if (boat(5600, 150, 5.4)) set(1); break;
      case 1: say('Making Jamestown Bay — four kilometres east');
        if (boat(7600, 380, 5.4)) set(2); break;
      case 2: say('Into the bay — the pale patch is the shoal');
        if (boat(8300, 445, 3.2)) { set(3); demo.phase = 'position'; } break;
      case 3: {   // work the shoal: close the range first, then dive
        say('Working the shoal — the drone goes down to look');
        const ty = groundAt(8380, 430) + 1.2;
        if (demo.phase === 'position') {
          if (boat(SHOAL_STAGING.x, SHOAL_STAGING.z, 2.0)) demo.phase = 'go';
        }
        else if (demo.phase === 'go') { switchVehicle('drone'); const arrived = drone(8380, ty, 430); if (arrived) demo.phase = 'hold'; else if (lowBatt()) demo.phase = 'back'; }
        else if (demo.phase === 'hold') {
          input.throttle = 0.12; input.turn = 0.1; input.boost = false;
          input.vert = clamp((ty - d.pos.y) * 0.9, -1, 1);
          demo.wait += dt; if (demo.wait > 7) demo.phase = 'back';
        } else if (drone(b.pos.x, state.tide - 2, b.pos.z)) { switchVehicle('boat'); set(4); demo.phase = 'position'; }
        break; }
      case 4: {   // the pot: position the boat, charge, then hunt the pinger down
        say('The lost pot — hunting the pinger');
        const py = groundAt(POT.x, POT.z) + 1.2;
        if (demo.phase === 'position') {
          // the drone charges on deck while the boat closes the range
          if (boat(POT_STAGING.x, POT_STAGING.z, 3.2)) demo.phase = 'charge';
        } else if (demo.phase === 'charge') {
          input.throttle = 0; input.turn = 0;
          if (d.battery >= 0.9) demo.phase = 'go';
        } else if (demo.phase === 'go') { switchVehicle('drone'); if (drone(POT.x, py, POT.z)) demo.phase = 'hold'; else if (lowBatt()) demo.phase = 'back'; }
        else if (demo.phase === 'hold') {
          drone(POT.x, py, POT.z);
          demo.wait += dt; if (demo.wait > 4.5) demo.phase = 'back';
        } else if (drone(b.pos.x, state.tide - 2, b.pos.z)) { switchVehicle('boat'); set(5); }
        break; }
      case 5: {   // the cove creep: feel in until the keel says stop
        say('Feeling her way into the cove — watch the keel');
        const bf = fwdOf(b.theta); const bow = { x: b.pos.x + bf.x * 3.4, z: b.pos.z + bf.z * 3.4 };
        const keelBow = state.tide - groundAt(bow.x, bow.z);
        const arrived = boat(8957, 596, 1.3);
        if (Math.abs(b.speed) < 0.05 && input.throttle > 0) demo.stuck += dt; else demo.stuck = 0;
        if (arrived || keelBow < 1.35 || demo.stuck > 2.5) { input.throttle = 0; set(6); demo.phase = 'charge'; }
        break; }
      case 6: {   // the wreck: charge at anchor, one held look, home
        say('The wreck — a small ship in the shallows');
        const wy = groundAt(WRECK.x, WRECK.z) + 1.4;
        // one viewpoint, not an orbit: from the keel-limited park
        // (~76 m out) the four-point orbit's flying cost more
        // battery than the flight home, and the drone died 24 m
        // short of the boat (measured). One careful look, then
        // home while there's charge to spare. The viewpoint is
        // 10 m west of the wreck, not 15: the seen-latch needs
        // < 18 m and the arrival bubble adds up to 5 — at 15 m
        // the drone could settle 20 m out and never latch
        // (measured: one run latched at 17.9 m, the next sat at
        // 19-20 m and missed). The hold below keeps steering to
        // the point, so the latch is guaranteed, not luck.
        const orbitPts = [[WRECK.x - 10, WRECK.z]];
        if (demo.phase === 'charge') {
          // the creep's length varies with the water, so the
          // charge it gave the drone varies too — top up at
          // anchor before spending on the look
          input.throttle = 0; input.turn = 0;
          if (d.battery >= 0.9) demo.phase = 'go';
        }
        else if (demo.phase === 'go') { switchVehicle('drone'); demo.phase = 'orbit'; }
        else if (demo.phase === 'orbit') {
          const [ox, oz] = orbitPts[demo.orbit];
          if (drone(ox, wy, oz)) { demo.orbit++; if (demo.orbit >= orbitPts.length) demo.phase = 'hold'; }
          else if (state.drone.battery < 0.40) demo.phase = 'back';
        } else if (demo.phase === 'hold') {
          // hold POSITION on the viewpoint (the old hold only
          // gazed, throttle 0, and let the drone sit wherever the
          // arrival bubble left it) and gaze at the wreck
          const [hx, hz] = orbitPts[orbitPts.length - 1];
          drone(hx, wy, hz);
          input.turn = clamp(wrapPi(Math.atan2(-(WRECK.x - d.pos.x), -(WRECK.z - d.pos.z)) - d.theta) * 1.8, -1, 1);
          demo.wait += dt; if (demo.wait > 4) demo.phase = 'back';
        } else if (drone(b.pos.x, state.tide - 2, b.pos.z)) { switchVehicle('boat'); set(7); }
        break; }
      case 7: say('Bringing her home');
        if (boat(7600, 380, 5.4)) set(8); break;
      case 8:
        if (boat(SPAWN.x, SPAWN.z, 5.4)) set(9); break;
      case 9: say('Shoalwater — this harbour is yours. Take control any time.');
        input.throttle = 0; input.turn = 0;
        demo.wait += dt; if (demo.wait > 12) set(0); break;
    }
  }
  return { demo, control, set };
}
