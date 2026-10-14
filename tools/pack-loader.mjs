// pack-loader.mjs — load a Region Pack from disk for headless Node use.
// Replicates the page's zoom-level choice exactly: highest z whose tile
// count is <= 120 (dropping a level while over).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeQuantizedMeshTile } from '../docs/qm.js';
import { createPack, gridFromTile } from '../docs/core.js';

export async function loadPackFromDisk(packDir) {
  const index = JSON.parse(await readFile(join(packDir, 'tiles-index.json'), 'utf8'));
  const levels = [...new Set(index.tiles.map(e => e.z))].sort((a, b) => a - b);
  let useZ = levels[levels.length - 1];
  while (index.tiles.filter(e => e.z === useZ).length > 120 && useZ > levels[0]) useZ--;
  const entries = index.tiles.filter(e => e.z === useZ);
  const grids = await Promise.all(entries.map(async (e) => {
    const buf = await readFile(join(packDir, 'tiles', String(e.z), String(e.x), String(e.y) + '.terrain'));
    return gridFromTile(decodeQuantizedMeshTile(buf), e);
  }));
  return { pack: createPack(entries, grids), useZ, tileCount: entries.length };
}

// Practice starts, mirroring docs/explore.html's ?start= handling.
export const PRACTICE_STARTS = {
  spawn:     null,   // the default: Western Anchorage, as created
  jamestown: { x: 8200, z: 445, theta: -1.5708 },
  pot:       { x: 8410, z: 430, theta: -1.5708 },
  cove:      { x: 8900, z: 612, theta: -1.5708 },
};

export function applyPracticeStart(game, name) {
  const s = PRACTICE_STARTS[name];
  if (!s) return;
  const st = game.state;
  st.boat.pos.x = s.x; st.boat.pos.z = s.z; st.boat.pos.y = st.tide;
  st.boat.theta = s.theta;
  st.drone.pos.x = s.x; st.drone.pos.z = s.z; st.drone.pos.y = st.tide - 6;
}
