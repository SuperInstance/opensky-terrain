// tiles.js — the first two Coach Player tiles.
//
// A tile is a verified script exposed upward as ONE named choice the
// size of a human intention. Its only sink is the game's input object —
// the same object the keyboard, the touch stick and the demo write.
// Ports of the demo's own steering (demoBoatTo / demoDroneTo and the
// demo's shoal step), with the M0 changes the design called for:
// make-way's arrival is scale-relative, and work-the-shoal declares
// its precondition and refuses where the water isn't there.
import { BAYC, clamp, fwdOf, hDist } from '../core.js';

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
      st.timeout = st.startDist / Math.max(0.4, shapedSpeed(speed)) * 2.5 + 120;
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
      // Keel look-ahead (claude-v1's make-for fixture rule): when the
      // water 10 m ahead shoals under 2.0 m of clearance, cap at
      // creep speed. A touch under 2.2 m/s is not a hull strike — so
      // where the water isn't there, the tile slows, feels the
      // bottom gently and fails loudly on timeout instead of
      // wrecking the boat. Unmapped ahead (adapter NaN) counts as
      // shoal: fail closed.
      const f = fwdOf(b.theta);
      const aheadBottom = adapter
        ? adapter.groundAt(b.pos.x + f.x * 10, b.pos.z + f.z * 10)
        : game.groundAt(b.pos.x + f.x * 10, b.pos.z + f.z * 10);
      const clearance = game.state.tide - aheadBottom;
      const effSpeed = (!Number.isFinite(clearance) || clearance < 2.0) ? Math.min(speed, 1.5) : speed;
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
        if (boatTo(game, SHOAL_POINT.x, SHOAL_POINT.z, 3.2, st)) st.phase = 'go';
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
      if (droneTo(game, b.pos.x, game.state.tide - 2, b.pos.z)) {
        game.switchVehicle('boat', 'runtime');
        return (F.shoalTime - st.shoalStart >= 10 && !st.compromised) ? 'done' : 'failed';
      }
      return 'running';
    },
  };
}

export { BAYC };
