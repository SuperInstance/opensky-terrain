// tiles.js — the first two Coach Player tiles.
//
// A tile is a verified script exposed upward as ONE named choice the
// size of a human intention. Its only sink is the game's input object —
// the same object the keyboard, the touch stick and the demo write.
// Ports of the demo's own steering (demoBoatTo / demoDroneTo and the
// demo's shoal step), with the M0 changes the design called for:
// make-way's arrival is scale-relative, and work-the-shoal declares
// its precondition and refuses where the water isn't there.
import { BAYC, WRECK, clamp, fwdOf, hDist } from '../core.js';

const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// the boat's real speed under demoBoatTo's throttle mapping for a
// requested speed — used for ETAs and timeouts
export const shapedSpeed = (speed) => {
  const t = clamp(speed / 6, 0.16, 0.95);
  const s = Math.sign(t) * Math.pow(Math.abs(t), 1.4);
  return s * (s > 0 ? 6 : 2);
};

function zeroInput(game) {
  const i = game.input;
  i.throttle = 0; i.turn = 0; i.vert = 0; i.boost = false; i.brake = false;
}

// Port of demoBoatTo, plus the demo's unstick reflex (demoControl):
// hung up under way for > 2 s -> back off at -0.5 for 1.2 s.
function boatTo(game, x, z, speed, st) {
  const b = game.state.boat;
  const dx = x - b.pos.x, dz = z - b.pos.z;
  if (Math.hypot(dx, dz) < 16) { game.input.throttle = 0; game.input.turn = 0; return true; }
  game.input.turn = clamp(wrapPi(Math.atan2(-dx, -dz) - b.theta) * 1.6, -1, 1);
  game.input.throttle = clamp(speed / 6, 0.16, 0.95);
  return false;
}

// Port of demoDroneTo.
function droneTo(game, x, y, z) {
  const d = game.state.drone;
  const dx = x - d.pos.x, dz = z - d.pos.z, distH = Math.hypot(dx, dz);
  game.input.turn = clamp(wrapPi(Math.atan2(-dx, -dz) - d.theta) * 1.8, -1, 1);
  game.input.throttle = distH > 5 ? 0.85 : 0.2;
  game.input.vert = clamp((y - d.pos.y) * 0.9, -1, 1);
  game.input.boost = distH > 50;
  return distH < 5 && Math.abs(y - d.pos.y) < 0.9;
}

// Recovery, by the game's own rule: switchVehicle('boat') takes the
// drone aboard whenever she is within 15 m of the boat, at ANY
// height. droneTo's arrival test (|dy| < 0.9 as well) is stricter
// than the rule — in water too thin for the drone's band to exist
// (floor above ceiling) she can be alongside and still never
// "arrive", and a tile that waits for arrival waits forever while
// the battery dies. So recovery = fly toward the boat, and switch
// the moment she is inside the game's own recovery distance.
function tryRecover(game) {
  const d = game.state.drone, b = game.state.boat;
  if (game.state.vehicle !== 'drone') return true;
  if (hDist(d.pos, b.pos) < 12) { zeroInput(game); game.switchVehicle('boat', 'runtime'); return d.aboard; }
  return false;
}

// Keel look-ahead (claude-v1's make-for fixture rule, first built
// into make-way): when the water 10 m ahead of the bow shoals under
// 2.0 m of clearance, cap at creep speed. A touch under 2.2 m/s is
// not a hull strike — so where the water isn't there, a boat tile
// slows, feels the bottom gently and fails loudly on timeout instead
// of wrecking the boat. Unmapped ahead (adapter NaN) counts as
// shoal: fail closed. Shared by every boat-driving phase in this
// library, so the rail applies throughout, not just in make-way.
function keelCappedSpeed(game, adapter, speed) {
  const b = game.state.boat;
  const f = fwdOf(b.theta);
  const aheadBottom = adapter
    ? adapter.groundAt(b.pos.x + f.x * 10, b.pos.z + f.z * 10)
    : game.groundAt(b.pos.x + f.x * 10, b.pos.z + f.z * 10);
  const clearance = game.state.tide - aheadBottom;
  return (!Number.isFinite(clearance) || clearance < 2.0) ? Math.min(speed, 1.5) : speed;
}

// ---------- make-way: the transit primitive ----------
export function createMakeWay({ x, z, speed = 5.4 }) {
  const st = { stuck: 0, unstick: 0, elapsed: 0, startDist: null, timeout: 0 };
  return {
    id: 'make-way',
    name: `make for (${x}, ${z})`,
    claims: 'reach',
    target: { x, z }, speed,
    precondition() { return { ok: true }; },
    start({ game }) {
      st.startDist = hDist(game.state.boat.pos, { x, z });
      // 2.5x the shaped ETA + slack, but hard-capped: at creep
      // speed (the cove detour inserts at 1.3) the raw formula
      // prices a 3 km leg at ~179 minutes — longer than a whole
      // session budget, so a leg that can never arrive (dry cove
      // at low tide) held the plan open past every bound instead
      // of failing (measured at tide -1.5). A leg that cannot
      // arrive in 45 minutes is a failed leg; the plan moves on.
      st.timeout = Math.min(st.startDist / Math.max(0.4, shapedSpeed(speed)) * 2.5 + 120, 2700);
    },
    tick(ctx, dt) {
      const { game, adapter } = ctx;
      st.elapsed += dt;
      if (st.elapsed > st.timeout) { zeroInput(game); return 'failed'; }
      const b = game.state.boat;
      if (st.unstick > 0) {
        st.unstick -= dt;
        game.input.throttle = -0.5; game.input.turn = 0;
        return 'running';
      }
      const dist = hDist(b.pos, { x, z });
      // arrival is scale-relative (design §5.1): a fixed 16 m window is
      // 3 s at transit speed and 12 s at the cove creep
      if (dist < Math.max(16, Math.abs(b.speed) * 3)) { zeroInput(game); return 'done'; }
      const effSpeed = keelCappedSpeed(game, adapter, speed);
      if (boatTo(game, x, z, effSpeed, st)) { zeroInput(game); return 'done'; }
      if (Math.abs(b.speed) < 0.05 && game.input.throttle > 0) {
        st.stuck += dt;
        if (st.stuck > 2) { st.unstick = 1.2; st.stuck = 0; }
      } else if (Math.abs(b.speed) >= 0.05) st.stuck = 0;
      return 'running';
    },
  };
}

// ---------- work-the-shoal: the objective tile ----------
export const SHOAL_POINT = { x: 8380, z: 430 };   // the demo's work point, over the pale patch
export const BOTTOM_BELOW_TIDE_M = 2.3;           // design §0.2: the objective band exists iff the water is deeper than this

export function createWorkTheShoal() {
  const st = { phase: 'position', elapsed: 0, shoalStart: 0, compromised: false };
  // the height inside the objective band: above the drone's floor
  // (bottom + 0.8), below both ceilings (bottom + 2.5, tide - 1.5)
  const bandY = ({ game, adapter }) => {
    const gnd = adapter.groundAt(SHOAL_POINT.x, SHOAL_POINT.z);
    const depth = game.state.tide - gnd;
    return gnd + 0.8 + 0.5 * Math.min(1.7, depth - BOTTOM_BELOW_TIDE_M);
  };
  return {
    id: 'work-the-shoal',
    name: 'work the shoal',
    claims: 'work-shoal',
    // The tile refuses where the shoal lacks 2.3 m of water under the
    // tide — it does not run and score zero. The failure moves to the
    // planner, where it is visible.
    precondition({ game, adapter }) {
      const gnd = adapter.groundAt(SHOAL_POINT.x, SHOAL_POINT.z);
      const depth = game.state.tide - gnd;
      if (!Number.isFinite(depth)) return { ok: false, depth, reason: 'the shoal is over unmapped water' };
      if (depth <= BOTTOM_BELOW_TIDE_M) {
        return { ok: false, depth, reason: `the shoal carries only ${depth.toFixed(1)} m of water at this tide (needs > ${BOTTOM_BELOW_TIDE_M} m)` };
      }
      return { ok: true, depth };
    },
    start({ game }) { st.shoalStart = game.state.flags.shoalTime; },
    tick(ctx, dt) {
      const { game } = ctx;
      const d = game.state.drone, b = game.state.boat, F = game.state.flags;
      st.elapsed += dt;
      if (st.elapsed > 600) return 'failed';
      if (d.battery < 0.36 && st.phase !== 'back' && st.phase !== 'position') { st.phase = 'back'; st.compromised = true; }
      // 'position': the boat carries the drone to the work — a drone
      // tile is a positioning tile with a payload (design §5.2). The
      // drone's own legs stay short hops, which is what keeps the
      // battery's reserve third intact.
      if (st.phase === 'position') {
        if (game.state.vehicle !== 'boat') return 'running';
        if (boatTo(game, SHOAL_POINT.x, SHOAL_POINT.z, keelCappedSpeed(game, ctx.adapter, 3.2), st)) st.phase = 'go';
        return 'running';
      }
      if (st.phase === 'go') {
        if (game.state.vehicle !== 'drone') { game.switchVehicle('drone', 'runtime'); return 'running'; }
        if (droneTo(game, SHOAL_POINT.x, bandY(ctx), SHOAL_POINT.z)) st.phase = 'hold';
        return 'running';
      }
      if (st.phase === 'hold') {
        // the demo's slow circle over the patch, holding the band height
        game.input.throttle = 0.12; game.input.turn = 0.1; game.input.boost = false;
        game.input.vert = clamp((bandY(ctx) - d.pos.y) * 0.9, -1, 1);
        if (F.shoalTime - st.shoalStart >= 10) st.phase = 'back';
        return 'running';
      }
      // back: fly to the boat and be recovered aboard
      if (game.state.vehicle !== 'drone') {   // already recovered
        return (F.shoalTime - st.shoalStart >= 10 && !st.compromised) ? 'done' : 'failed';
      }
      droneTo(game, b.pos.x, game.state.tide - 2, b.pos.z);
      if (tryRecover(game)) {
        return (F.shoalTime - st.shoalStart >= 10 && !st.compromised) ? 'done' : 'failed';
      }
      return 'running';
    },
  };
}

// ---------- hunt-the-pot: find the Marigold's pot by its pinger ----------
// Observation contract: this tile NEVER reads the pot's position —
// it is not imported here and no anchor in this tile is the pot. Its
// only fix on the pot is the pinger instrument (adapter.pinger():
// integer-metre range + bars inside 150 m, no return beyond), the
// same readout the game's HUD prints for a human player. What the
// chart legitimately says (the game's own fiction, on its help
// panel): the pot lies on the drainage east of the shoal, pinger
// live — SEARCH_AREA is that charted drainage, not the fix. The fix
// comes from the pinger alone: the boat carries the drone east in
// short hops (a drone tile is a positioning tile with a payload —
// drone flight is dear and slow, the boat is the legs) until the
// pinger answers, then three range samples at known drone positions
// trilaterate the source the way a real pinger-and-GPS hunt does,
// and the drone descends and holds the find the game's rules ask
// for: within 10 m, within 3 m of the bottom, for a slow count of 3.
// Failure discipline: every abort path flies the drone home to the
// boat BEFORE the tile reports failure — a failed hunt never strands
// the drone.
export const SEARCH_AREA = { x: 8460, z: 430 };   // the charted drainage east of the shoal

function trilaterate(p) {
  // p: three {x, z, r} range samples. Subtract the circle equations
  // pairwise and solve the 2x2 linear system for the source.
  const [a, b, c] = p;
  const A1 = 2 * (b.x - a.x), B1 = 2 * (b.z - a.z), C1 = a.r * a.r - b.r * b.r + (b.x * b.x + b.z * b.z) - (a.x * a.x + a.z * a.z);
  const A2 = 2 * (c.x - a.x), B2 = 2 * (c.z - a.z), C2 = a.r * a.r - c.r * c.r + (c.x * c.x + c.z * c.z) - (a.x * a.x + a.z * a.z);
  const det = A1 * B2 - A2 * B1;
  if (Math.abs(det) < 1e-6) return null;   // collinear probes: no fix
  return { x: (C1 * B2 - C2 * B1) / det, z: (A1 * C2 - A2 * C1) / det };
}

export function createHuntThePot() {
  const st = {
    phase: 'charge', elapsed: 0, result: null, why: '',
    readT: 0, hopTarget: null, carries: 0, carryT: 0, carryRef: null, backT: 0,
    probes: [], probeIdx: 0, probeTarget: null, probeWaits: 0,
    fix: null, refined: false, holdT: 0,
  };
  const cruiseY = (game) => game.state.tide - 2.0;
  const abort = (why) => { st.why = why; st.phase = 'back'; };
  return {
    id: 'hunt-the-pot',
    name: 'hunt the pot',
    claims: 'hunt-pot',
    precondition({ game, adapter }) {
      const gnd = adapter.groundAt(SEARCH_AREA.x, SEARCH_AREA.z);
      if (!Number.isFinite(gnd)) return { ok: false, reason: 'the drainage east of the shoal is over unmapped water' };
      const depth = game.state.tide - gnd;
      // the drone needs a working column: its floor (bottom + 0.8)
      // must sit under its ceiling (tide - 0.4) with room to hunt
      if (depth <= 2.0) return { ok: false, depth, reason: `the drainage carries only ${depth.toFixed(1)} m of water at this tide — too thin to hunt in` };
      return { ok: true, depth };
    },
    start() {},
    tick(ctx, dt) {
      const { game, adapter } = ctx;
      const d = game.state.drone, b = game.state.boat, F = game.state.flags;
      st.elapsed += dt;
      if (st.phase !== 'back' && st.elapsed > 1500) abort('the hunt ran past its 25 minutes');
      // battery guard: head home while the return is comfortably
      // affordable — the geometry (boat carried close before the
      // dive) keeps the return leg under ~70 m
      if (st.phase !== 'back' && st.phase !== 'charge' && game.state.vehicle === 'drone' && d.battery < 0.5 && !F.potFound) {
        abort(`drone battery at ${Math.round(d.battery * 100)}% — heading home before the reserve is threatened`);
      }
      if (F.potFound && st.phase !== 'back') { st.result = 'done'; st.phase = 'back'; }

      // charge: the tile's first act is patience — the drone tops up
      // aboard (0.05/s) before anyone spends it. But first, the
      // launch check: the drone's band (floor bottom+0.8, ceiling
      // tide-0.4) must exist in the water the boat is lying in. A
      // boat pressed onto a bar at low tide floats in less water
      // than the drone needs to swim — launching there pins her to
      // the bottom beside the boat until the battery dies. Refuse
      // fast, before she ever leaves the deck.
      if (st.phase === 'charge') {
        zeroInput(game);
        if (game.state.vehicle !== 'boat') { game.switchVehicle('boat', 'runtime'); return 'running'; }
        const boatDepth = game.state.tide - adapter.groundAt(b.pos.x, b.pos.z);
        if (!Number.isFinite(boatDepth) || boatDepth < 1.3) {
          st.result = 'failed';
          st.why = `the boat is lying in ${Number.isFinite(boatDepth) ? boatDepth.toFixed(1) : 'unmapped'} m of water — too thin to launch the drone`;
          st.phase = 'back';
          return 'running';
        }
        if (d.battery >= 0.97) st.phase = 'listen-read';
        return 'running';
      }
      // listen-read: launch the drone at the boat and take a reading
      if (st.phase === 'listen-read') {
        if (game.state.vehicle !== 'drone') { game.switchVehicle('drone', 'runtime'); return 'running'; }
        st.readT += dt;
        droneTo(game, b.pos.x, cruiseY(game), b.pos.z);   // hover at the boat while the reading settles
        if (st.readT > 2) {
          st.readT = 0;
          const ping = adapter.pinger();
          if (ping.hasReturn && ping.rangeM <= 48) {
            st.probes = [{ x: d.pos.x, z: d.pos.z, r: ping.rangeM }];
            st.probeIdx = 1; st.probeTarget = null; st.probeWaits = 0;
            st.phase = 'probe';
          } else if (ping.hasReturn) {
            st.phase = 'carry';   // a return, but far: close the distance with the boat first
          } else {
            st.phase = 'carry';
          }
        }
        return 'running';
      }
      // carry: recover the drone, move the BOAT 45 m east along the
      // drainage, listen again. Bounded: five carries, then the hunt
      // admits the pinger never answered. A boat that cannot move
      // (pressed on a bar) cannot carry — a watchdog admits that in
      // a minute instead of grinding until the tile's cap.
      if (st.phase === 'carry') {
        if (game.state.vehicle === 'drone') {
          droneTo(game, b.pos.x, game.state.tide - 2, b.pos.z);
          tryRecover(game);
          return 'running';
        }
        if (st.carries >= 5) { st.result = 'failed'; st.why = 'five carries east and the pinger never came within range'; st.phase = 'back'; return 'running'; }
        if (!st.hopTarget) { st.hopTarget = { x: b.pos.x + 45, z: SEARCH_AREA.z }; st.carryRef = { x: b.pos.x, z: b.pos.z }; st.carryT = 0; }
        st.carryT += dt;
        if (boatTo(game, st.hopTarget.x, st.hopTarget.z, keelCappedSpeed(game, adapter, 3.0), st)) {
          st.hopTarget = null; st.carries++;
          st.phase = 'charge';   // re-check launch depth + top up at the new lie
        } else if (st.carryT > 60 && hDist(b.pos, st.carryRef) < 5) {
          st.result = 'failed'; st.why = 'the boat cannot move to carry the hunt east';
          st.hopTarget = null; st.phase = 'back';
        }
        return 'running';
      }
      // probe: two more range samples on a 16 m triangle around the
      // first return, then trilaterate
      if (st.phase === 'probe') {
        const base = st.probes[0];
        const offsets = st.refined ? [[17, 0], [8.5, 15]] : [[16, 0], [8, 14]];
        if (!st.probeTarget) {
          const [ox, oz] = offsets[st.probeIdx - 1];
          st.probeTarget = { x: base.x + ox, z: base.z + oz };
        }
        if (droneTo(game, st.probeTarget.x, cruiseY(game), st.probeTarget.z)) {
          st.probeWaits += dt;
          if (st.probeWaits > 1) {
            st.probeWaits = 0;
            const ping = adapter.pinger();
            if (ping.hasReturn) {
              st.probes.push({ x: d.pos.x, z: d.pos.z, r: ping.rangeM });
              st.probeTarget = null; st.probeIdx++;
              if (st.probeIdx > 2) {
                st.fix = trilaterate(st.probes);
                if (!st.fix) { abort('the probe triangle was degenerate — no fix'); return 'running'; }
                st.phase = 'fix';
              }
            } else {
              // at the edge of range: halve the step back toward the
              // base sample and read again from there (bounded)
              st.probeRetry = (st.probeRetry || 0) + 1;
              if (st.probeRetry > 2) abort('the pinger kept dropping at the probe points');
              else st.probeTarget = { x: (st.probeTarget.x + base.x) / 2, z: (st.probeTarget.z + base.z) / 2 };
            }
          }
        }
        return 'running';
      }
      // fix: fly the trilaterated point and check the range there
      if (st.phase === 'fix') {
        if (droneTo(game, st.fix.x, cruiseY(game), st.fix.z)) {
          const ping = adapter.pinger();
          if (ping.hasReturn && ping.rangeM <= 12) { st.phase = 'hold'; st.holdT = 0; }
          else if (ping.hasReturn && !st.refined) {
            st.refined = true;
            st.probes = [{ x: d.pos.x, z: d.pos.z, r: ping.rangeM }];
            st.probeIdx = 1; st.probeTarget = null; st.probeWaits = 0; st.probeRetry = 0;
            st.phase = 'probe';
          } else abort(`the fix did not check out (range ${ping.hasReturn ? ping.rangeM + ' m' : 'lost'})`);
        }
        return 'running';
      }
      // hold: down low over the fix until the game logs the pot; if
      // the fix is a few metres off, a slow small circle sweeps the
      // 10 m find radius across it
      if (st.phase === 'hold') {
        st.holdT += dt;
        let tx = st.fix.x, tz = st.fix.z;
        if (st.holdT > 15) {
          const ang = (st.holdT - 15) * 0.4;
          tx += Math.cos(ang) * 5; tz += Math.sin(ang) * 5;
        }
        const gnd = adapter.groundAt(d.pos.x, d.pos.z);
        const ty = Number.isFinite(gnd) ? gnd + 1.2 : cruiseY(game);
        droneTo(game, tx, ty, tz);
        if (st.holdT > 60 && !F.potFound) abort('held over the fix for a minute and the game never logged the pot');
        return 'running';
      }
      // back: fly home and be recovered — reached on success, on
      // abort, on any failure. Only once the drone is aboard (or was
      // never launched) does the tile settle its result. Bounded:
      // four minutes to get her back, then the tile admits the loss
      // and settles rather than holding the plan hostage.
      if (game.state.vehicle !== 'drone') return st.result === 'done' ? 'done' : 'failed';
      st.backT += dt;
      droneTo(game, b.pos.x, game.state.tide - 2, b.pos.z);
      if (tryRecover(game)) return st.result === 'done' ? 'done' : 'failed';
      if (st.backT > 240) return 'failed';
      return 'running';
    },
  };
}

// ---------- wreck-look: the spectacle beat in the cove ----------
// Port of the demo's cove steps (5 + 6) with the tile discipline the
// demo doesn't need: a precondition that declines a dry cove instead
// of discovering it with the bow, the demo's keel guard as an abort
// (bow clearance < 1.35 m stops the creep wherever she lies), and a
// drone look kept inside the thirds — the boat creeps to a stone's
// throw of the wreck first, so the drone's legs stay short hops.
// The latch the game asks for: the drone within 18 m of the wreck,
// near the bottom it lies on. The look itself is the demo's orbit
// points, trimmed to two, plus its held gaze.
export const COVE_MOUTH = { x: 8957, z: 596 };
export const WRECK_APPROACH = { x: 8991, z: 605 };   // ~25 m short of the wreck, on the mouth's line

export function createWreckLook() {
  const st = { phase: 'creep', leg: 0, elapsed: 0, stuck: 0, orbit: 0, wait: 0, result: null };
  const orbitPts = [
    { x: WRECK.x - 12, z: WRECK.z }, { x: WRECK.x, z: WRECK.z + 12 },
  ];
  return {
    id: 'wreck-look',
    name: 'look at the wreck',
    claims: 'wreck-look',
    precondition({ game, adapter }) {
      const gMouth = adapter.groundAt(COVE_MOUTH.x, COVE_MOUTH.z);
      if (!Number.isFinite(gMouth)) return { ok: false, reason: 'the cove mouth is over unmapped water' };
      const mouthDepth = game.state.tide - gMouth;
      if (mouthDepth <= 1.35) {
        return { ok: false, depth: mouthDepth, reason: `the cove mouth carries ${mouthDepth.toFixed(1)} m at this tide — the keel guard would stop her on the bar; the wreck stays unlogged rather than struck for` };
      }
      const gWreck = adapter.groundAt(WRECK.x, WRECK.z);
      if (!Number.isFinite(gWreck)) return { ok: false, reason: 'the wreck is over unmapped water' };
      // the drone's band at the wreck: floor (bottom + 0.8) must sit
      // under its ceiling (tide - 0.4)
      if (game.state.tide - 0.4 <= gWreck + 0.8) {
        return { ok: false, depth: mouthDepth, reason: `the wreck lies above the drone's ceiling at this tide (bottom ${gWreck.toFixed(1)} m, tide ${game.state.tide.toFixed(1)} m)` };
      }
      return { ok: true, depth: mouthDepth };
    },
    start() {},
    tick(ctx, dt) {
      const { game, adapter } = ctx;
      const d = game.state.drone, b = game.state.boat, F = game.state.flags;
      st.elapsed += dt;
      if (st.phase !== 'back' && st.elapsed > 1800) st.phase = 'back';
      if (st.phase !== 'back' && game.state.vehicle === 'drone' && d.battery < 0.36 && !F.wreckSeen) st.phase = 'back';

      if (st.phase === 'creep') {
        if (game.state.vehicle !== 'boat') { game.switchVehicle('boat', 'runtime'); return 'running'; }
        // the keel guard, the demo's own rule: bow clearance under
        // 1.35 m and the creep stops where she lies — the drone
        // looks from wherever that is, if it can reach
        const f = fwdOf(b.theta);
        const keelBow = game.state.tide - adapter.groundAt(b.pos.x + f.x * 3.4, b.pos.z + f.z * 3.4);
        const targets = [COVE_MOUTH, WRECK_APPROACH];
        const tgt = targets[st.leg];
        const arrived = boatTo(game, tgt.x, tgt.z, 1.3, st);
        if (Math.abs(b.speed) < 0.05 && game.input.throttle > 0) st.stuck += dt; else st.stuck = 0;
        if (arrived) {
          if (st.leg === 0) { st.leg = 1; st.stuck = 0; return 'running'; }
          zeroInput(game); st.phase = 'dive';
        } else if (keelBow < 1.35 || st.stuck > 2.5) {
          zeroInput(game);
          st.phase = hDist(b.pos, WRECK) <= 260 ? 'dive' : 'back';   // too far for the drone: settle as failed
          if (st.phase === 'back' && !st.result) st.result = 'failed';
        }
        return 'running';
      }
      if (st.phase === 'dive') {
        if (game.state.vehicle !== 'drone') { game.switchVehicle('drone', 'runtime'); return 'running'; }
        const wy = adapter.groundAt(WRECK.x, WRECK.z) + 1.4;
        const pt = orbitPts[st.orbit];
        if (droneTo(game, pt.x, wy, pt.z)) {
          st.orbit++;
          if (st.orbit >= orbitPts.length) { st.phase = 'look'; st.wait = 0; }
        }
        return 'running';
      }
      if (st.phase === 'look') {
        // the demo's held gaze: hover, face the wreck, let it register
        const wy = adapter.groundAt(WRECK.x, WRECK.z) + 1.4;
        game.input.throttle = 0; game.input.boost = false;
        game.input.turn = clamp(wrapPi(Math.atan2(-(WRECK.x - d.pos.x), -(WRECK.z - d.pos.z)) - d.theta) * 1.8, -1, 1);
        game.input.vert = clamp((wy - d.pos.y) * 0.9, -1, 1);
        st.wait += dt;
        if (st.wait > 3) st.phase = 'back';
        return 'running';
      }
      // back — fly at the boat and recover by proximity (the core
      // recovers within 15 m at any height), not by the arrival
      // test: where the drone's altitude band pinches shut, a
      // tide-minus-2 arrival target can be unreachable and the
      // phase would spin forever (the hunt tile's stall, fixed
      // the same way). Bounded regardless: settle, don't hang.
      if (game.state.vehicle !== 'drone') return F.wreckSeen ? 'done' : 'failed';
      droneTo(game, b.pos.x, game.state.tide - 2, b.pos.z);
      if (tryRecover(game)) return F.wreckSeen ? 'done' : 'failed';
      st.backT = (st.backT || 0) + dt;
      if (st.backT > 240) return 'failed';
      return 'running';
    },
  };
}

export { BAYC };
