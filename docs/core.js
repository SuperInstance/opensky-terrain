// core.js — Shoalwater simulation core.
//
// Extracted from explore.html (M0, Coach Player) so the identical physics
// runs in the browser page and in headless Node (tools/sim.mjs). No
// rendering, no DOM, no three.js: positions are plain {x, y, z} objects
// and all math is local. Behaviour is a faithful port of the page's
// stepBoat / stepDrone / switchVehicle — this is an extraction, not a
// redesign. Two judgement calls, both flagged where they live:
//   1. The wreckSeen / missionOver latches were computed in the page's
//      HUD block (~8 Hz); they are latched here per physics step.
//      Both are monotonic latches, so the only difference is that they
//      can set up to ~0.1 s earlier.
//   2. Touch vertical input arrives as input.touchVert (the page's
//      touch buttons write it; it is 0 everywhere else).
//
// The core keeps the game's historical terrain behaviour: sampleBottom
// returns -60 outside the pack. Fail-closed sampling for the runtime
// lives in coach/adapter.js, not here.

export const STEP = 1 / 60;

// Scene 1 geography (world coords: x = ENU east, z = -ENU north)
export const SPAWN = { x: 4641, z: -779 };   // Western Anchorage
export const BAYC  = { x: 8471, z: 445 };    // Jamestown Bay centre
export const WRECK = { x: 9015, z: 612 };    // the cove at the back of the bay
export const POT   = { x: 8540, z: 430 };    // the Marigold's lost pot

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const hDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// forward vector for a heading, as a plain object (the page's fwdOf
// returns the same components in a THREE.Vector3)
export const fwdOf = (th) => ({ x: -Math.sin(th), y: 0, z: -Math.cos(th) });

// ---------- terrain pack ----------
// Build the 65x65 height lattice for one decoded quantized-mesh tile.
// Port of the page's loader loop, including the nearest-filled-neighbour
// hole fill (ties resolve to the lowest lattice index, as in the page).
export function gridFromTile(d, e) {
  const grid = new Float32Array(65 * 65).fill(NaN);
  const conf = d.confidence ? new Float32Array(65 * 65).fill(NaN) : null;
  for (let i = 0; i < d.vertexCount; i++) {
    const cx = Math.round(d.u[i] / 32767 * 64), cy = Math.round(d.v[i] / 32767 * 64);
    grid[cy * 65 + cx] = d.height[i];
    if (conf) conf[cy * 65 + cx] = d.confidence[i];
  }
  const filled = [];
  for (let j = 0; j < 65 * 65; j++) if (!Number.isNaN(grid[j])) filled.push(j);
  for (let k = 0; k < 65 * 65; k++) if (Number.isNaN(grid[k])) {
    const cx = k % 65, cy = (k / 65) | 0;
    let best = Infinity, val = e.minHeight, cval = 0;
    for (const j of filled) {
      const dd = Math.abs(j % 65 - cx) + Math.abs(((j / 65) | 0) - cy);
      if (dd < best) { best = dd; val = grid[j]; if (conf) cval = conf[j]; }
    }
    grid[k] = val;
    if (conf) conf[k] = cval;
  }
  return { height: grid, confidence: conf };
}

// A pack = the chosen zoom level's tile entries + their lattices, with an
// O(1) grid-index sampler. (The page's original sampler scanned every
// tile per call; values are identical — tiles partition the extent, and
// the containment test below is the same one the scan performed.)
export function createPack(entries, grids) {
  const extent = {
    minX: Math.min(...entries.map(e => e.westX)), maxX: Math.max(...entries.map(e => e.westX + e.spanX)),
    minY: Math.min(...entries.map(e => e.southY)), maxY: Math.max(...entries.map(e => e.southY + e.spanY)),
  };
  // Grid index over the pack's own edge lines: tiles have non-uniform
  // spans (edge tiles are clipped), so the index is built from the
  // sorted unique boundary coordinates, and each tile registers every
  // cell it covers. Lookup is a binary search per axis + one map hit;
  // the containment test is the same one the old linear scan performed.
  const xEdges = [...new Set(entries.flatMap(e => [e.westX, e.westX + e.spanX]))].sort((a, b) => a - b);
  const yEdges = [...new Set(entries.flatMap(e => [e.southY, e.southY + e.spanY]))].sort((a, b) => a - b);
  const cells = new Map();   // "col,row" -> index into entries
  entries.forEach((e, i) => {
    const c0 = xEdges.indexOf(e.westX), c1 = xEdges.indexOf(e.westX + e.spanX);
    const r0 = yEdges.indexOf(e.southY), r1 = yEdges.indexOf(e.southY + e.spanY);
    for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) cells.set(c + ',' + r, i);
  });
  const cellOf = (edges, v) => {   // last edge <= v
    let lo = 0, hi = edges.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (edges[mid] <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  function tileAt(x, yEnu) {
    const c = cellOf(xEdges, x), r = cellOf(yEdges, yEnu);
    for (let dc = 0; dc >= -1; dc--) for (let dr = 0; dr >= -1; dr--) {
      const i = cells.get((c + dc) + ',' + (r + dr));
      if (i === undefined) continue;
      const e = entries[i];
      if (x >= e.westX && x <= e.westX + e.spanX && yEnu >= e.southY && yEnu <= e.southY + e.spanY) return i;
    }
    return -1;
  }
  function bilinear(grid, e, x, yEnu) {
    const fx = (x - e.westX) / e.spanX * 64, fy = (yEnu - e.southY) / e.spanY * 64;
    const x0 = Math.min(63, Math.floor(fx)), y0 = Math.min(63, Math.floor(fy));
    const tx = fx - x0, ty = fy - y0;
    const g = (cx, cy) => grid[cy * 65 + cx];
    return g(x0, y0) * (1 - tx) * (1 - ty) + g(x0 + 1, y0) * tx * (1 - ty)
         + g(x0, y0 + 1) * (1 - tx) * ty + g(x0 + 1, y0 + 1) * tx * ty;
  }
  return {
    entries, extent,
    tileAt,
    sampleBottom(x, yEnu) {
      const i = tileAt(x, yEnu);
      if (i < 0) return -60;   // outside the pack: the game's historical assumption
      return bilinear(grids[i].height, entries[i], x, yEnu);
    },
    // bathymetry confidence, 0..1, or null when the pack carries none
    sampleConfidence(x, yEnu) {
      const i = tileAt(x, yEnu);
      if (i < 0 || !grids[i].confidence) return null;
      return bilinear(grids[i].confidence, entries[i], x, yEnu) / 255;
    },
  };
}

// ---------- the game ----------
export function createGame(pack) {
  const state = {
    vehicle: 'boat', tide: 1.4, exagg: 1, time: 0,
    boat: { pos: { x: SPAWN.x, y: 1.4, z: SPAWN.z }, theta: 1.5708, speed: 0, aground: false, wasAground: false },
    drone: { pos: { x: SPAWN.x, y: -4.6, z: SPAWN.z }, theta: 1.5708, vel: { x: 0, y: 0, z: 0 },
             battery: 1, aboard: true, diveMin: 1, dead: false },
    flags: { shoalTime: 0, potTime: 0, potFound: false, reserveSpent: false,
             hullHits: 0, takingWater: false, missionOver: false, wreckSeen: false },
  };
  // the one input object: keyboard, touch, demo, tiles — writers compete
  // for these fields and possession decides whose write counts
  const input = { throttle: 0, turn: 0, vert: 0, boost: false, brake: false, touchVert: 0 };
  const events = [];   // {type:'note', text} and typed events, drained by the host
  const note = (text) => events.push({ type: 'note', text });

  const sampleBottom = (x, yEnu) => pack.sampleBottom(x, yEnu);
  const groundAt = (x, z) => sampleBottom(x, -z) * state.exagg;
  const extent = pack.extent;

  // source: 'player' | 'runtime' — recorded for the contract; takeover
  // itself is the host page's decision, the rules here are source-blind.
  function switchVehicle(v, source = 'player') {
    if (v === state.vehicle) return false;
    const d = state.drone, b = state.boat;
    if (v === 'drone') {
      if (d.aboard && d.battery <= 0.02) { note('Drone battery flat — she charges while you run the boat.'); return false; }
      state.vehicle = 'drone';
      if (d.aboard) {   // launch from the boat; if she's out hovering, you take her back over in place
        d.aboard = false; d.dead = false; d.diveMin = d.battery;
        d.pos.x = b.pos.x; d.pos.z = b.pos.z;
        d.pos.y = Math.max(groundAt(b.pos.x, b.pos.z) + 1.5, state.tide - 6);   // in the shallows, launch over the bottom — never inside it
        d.theta = b.theta; d.vel.x = 0; d.vel.y = 0; d.vel.z = 0;
      }
    } else {
      state.vehicle = 'boat';
      if (!d.aboard && hDist(b.pos, d.pos) < 15) {   // came alongside: recovered aboard
        d.aboard = true;
        if (d.diveMin < 1 / 3) state.flags.reserveSpent = true;
        note(d.dead ? 'Drone recovered off the bottom. Charging.' : 'Drone recovered aboard. Charging.');
      }
      // otherwise she holds her hover where you left her — sail back for her
    }
    return true;
  }

  function stepBoat(dt) {
    const b = state.boat, F = state.flags;
    const shaped = Math.sign(input.throttle) * Math.pow(Math.abs(input.throttle), 1.4);
    const target = shaped * (shaped > 0 ? 6 : 2);
    const rate = input.brake ? 3.2 : 1.1;
    b.speed += clamp(target - b.speed, -rate * dt, rate * dt);
    if (b.aground && b.speed > 0) b.speed = 0;
    b.theta += input.turn * (0.12 + 0.38 * Math.min(Math.abs(b.speed) / 3, 1)) * Math.sign(b.speed || 1) * dt;
    const f = fwdOf(b.theta);
    b.pos.x += f.x * b.speed * dt;
    b.pos.z += f.z * b.speed * dt;
    b.pos.x = clamp(b.pos.x, extent.minX + 5, extent.maxX - 5);
    b.pos.z = clamp(b.pos.z, -(extent.maxY - 5), -(extent.minY + 5));
    const bowX = b.pos.x + f.x * 3.4, bowZ = b.pos.z + f.z * 3.4;
    b.aground = groundAt(bowX, bowZ) > state.tide - 0.45 && Math.abs(b.speed) > 0.01;
    // a hard strike is a fact the hull remembers: two and she takes water
    if (b.aground && !b.wasAground && Math.abs(b.speed) > 2.2 && !F.missionOver) {
      F.hullHits++;
      events.push({ type: 'hullHit', hits: F.hullHits });
      if (F.hullHits >= 2) { F.takingWater = true; note('Struck again — she is TAKING WATER. Make the anchorage, slow and straight.'); }
      else note('Struck the bottom hard — one strike. She is tender now; the next one opens her up.');
    }
    b.wasAground = b.aground;
    if (F.takingWater) b.speed = clamp(b.speed, -1, 1.2);
    b.pos.y = state.tide + Math.sin(state.time * 0.9) * 0.05;
    // the drone: aboard — on deck, charging; out — holding where you left her
    const d = state.drone;
    if (d.aboard) {
      d.battery = Math.min(1, d.battery + dt * 0.05);
    } else if (d.dead && hDist(b.pos, d.pos) < 15) {
      d.aboard = true; d.dead = false; d.battery = 0.03;
      if (d.diveMin < 1 / 3) F.reserveSpent = true;
      note('Drone recovered off the bottom. Charging.');
    }
  }

  function stepDrone(dt) {
    const d = state.drone, F = state.flags;
    const f = fwdOf(d.theta);
    const maxF = input.boost ? 4.5 : 2.6;
    d.theta += input.turn * 0.9 * dt;
    const shapedD = Math.sign(input.throttle) * Math.pow(Math.abs(input.throttle), 1.4);
    const vert = input.vert + input.touchVert;
    const thrust = {
      x: f.x * shapedD * 1.7 * (input.boost ? 1.75 : 1),
      y: vert * 1.5,
      z: f.z * shapedD * 1.7 * (input.boost ? 1.75 : 1),
    };
    // battery: hover sips, work drinks — thirds are the discipline
    const effort = Math.min(1, Math.abs(shapedD) + Math.abs(vert) + (input.boost ? 0.5 : 0));
    d.battery = Math.max(0, d.battery - dt * (1 / 600 + effort / 240));
    d.diveMin = Math.min(d.diveMin, d.battery);
    if (d.battery <= 0) {
      thrust.x = 0; thrust.y = 0; thrust.z = 0;
      d.vel.y -= 0.35 * dt;   // no lift: she settles
      if (!d.dead && d.pos.y <= groundAt(d.pos.x, d.pos.z) + 0.85) {
        d.dead = true;
        events.push({ type: 'droneDead' });
        note('Battery spent — drone on the bottom. Bring the boat to her.');
      }
    }
    d.vel.x += thrust.x * dt; d.vel.y += thrust.y * dt; d.vel.z += thrust.z * dt;
    const damp = Math.exp(-1.7 * dt);
    d.vel.x *= damp; d.vel.y *= damp; d.vel.z *= damp;
    if (input.brake) { const bd = Math.exp(-6 * dt); d.vel.x *= bd; d.vel.y *= bd; d.vel.z *= bd; }
    const vlen = Math.hypot(d.vel.x, d.vel.y, d.vel.z);
    if (vlen > maxF * 1.4) { const s = maxF * 1.4 / vlen; d.vel.x *= s; d.vel.y *= s; d.vel.z *= s; }
    d.pos.x += d.vel.x * dt; d.pos.y += d.vel.y * dt; d.pos.z += d.vel.z * dt;
    d.pos.x = clamp(d.pos.x, extent.minX + 3, extent.maxX - 3);
    d.pos.z = clamp(d.pos.z, -(extent.maxY - 3), -(extent.minY + 3));
    const floor = groundAt(d.pos.x, d.pos.z) + 0.8;
    if (d.pos.y < floor) { d.pos.y = floor; d.vel.y = Math.max(d.vel.y, 0); }
    const ceil = state.tide - 0.4;
    if (d.pos.y > ceil) { d.pos.y = ceil; d.vel.y = Math.min(d.vel.y, 0); }
    // working the shoal: inside the bay, under the surface, close over the bottom
    const gnd = groundAt(d.pos.x, d.pos.z);
    if (hDist(d.pos, BAYC) < 350 && (d.pos.y - gnd) < 2.5 && (state.tide - d.pos.y) > 1.5) F.shoalTime += dt;
    // finding the pot: close, low over it, held for a slow count of three
    if (!F.potFound && hDist(d.pos, POT) < 10 && (d.pos.y - gnd) < 3) {
      F.potTime += dt;
      if (F.potTime > 3) { F.potFound = true; events.push({ type: 'potFound' }); note('CONTACT — that is her pot. Position logged for the Marigold.'); }
    } else if (!F.potFound) F.potTime = 0;
  }

  function step(dt) {
    if (state.vehicle === 'boat') stepBoat(dt); else stepDrone(dt);
    state.time += dt;
    const d = state.drone, b = state.boat, F = state.flags;
    // objective latches (in the page these ran in the HUD block; see header)
    if (!F.wreckSeen && hDist(d.pos, WRECK) < 18 && Math.abs(d.pos.y - (groundAt(WRECK.x, WRECK.z) + 1)) < 8 && !d.aboard) F.wreckSeen = true;
    if (F.takingWater && !F.missionOver && hDist(b.pos, SPAWN) < 60) {
      F.missionOver = true;
      events.push({ type: 'missionOver' });
      note('Limped home. The yard will have her a week — reset and run it cleaner.');
    }
  }

  function objectives() {
    const b = state.boat, F = state.flags;
    return [
      ['Cast off', hDist(b.pos, SPAWN) > 60],
      ['Jamestown Bay', hDist(b.pos, BAYC) < 350],
      ['Work the shoal', F.shoalTime >= 10],
      ['Find the pot', F.potFound],
      ['Bring her home', hDist(b.pos, SPAWN) < 40 && F.potFound],
      ['Log the wreck', F.wreckSeen],
    ];
  }

  function snapshot() {
    const b = state.boat, d = state.drone, F = state.flags;
    return {
      vehicle: state.vehicle, tide: state.tide, exagg: state.exagg, time: state.time,
      boat: { pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, theta: b.theta, speed: b.speed, aground: b.aground, wasAground: b.wasAground },
      drone: { pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z }, theta: d.theta, vel: { x: d.vel.x, y: d.vel.y, z: d.vel.z },
               battery: d.battery, aboard: d.aboard, diveMin: d.diveMin, dead: d.dead },
      flags: { shoalTime: F.shoalTime, potTime: F.potTime, potFound: F.potFound, reserveSpent: F.reserveSpent,
               hullHits: F.hullHits, takingWater: F.takingWater, missionOver: F.missionOver, wreckSeen: F.wreckSeen },
    };
  }

  function load(snap) {
    const s = typeof snap === 'string' ? JSON.parse(snap) : snap;
    state.vehicle = s.vehicle; state.tide = s.tide; state.exagg = s.exagg; state.time = s.time;
    Object.assign(state.boat.pos, s.boat.pos);
    state.boat.theta = s.boat.theta; state.boat.speed = s.boat.speed;
    state.boat.aground = s.boat.aground; state.boat.wasAground = s.boat.wasAground;
    Object.assign(state.drone.pos, s.drone.pos); Object.assign(state.drone.vel, s.drone.vel);
    state.drone.theta = s.drone.theta; state.drone.battery = s.drone.battery;
    state.drone.aboard = s.drone.aboard; state.drone.diveMin = s.drone.diveMin; state.drone.dead = s.drone.dead;
    Object.assign(state.flags, s.flags);
    events.length = 0;
  }

  return { state, input, events, pack, groundAt, sampleBottom, switchVehicle, step, stepBoat, stepDrone, objectives, snapshot, load };
}
