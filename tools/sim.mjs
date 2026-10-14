// sim.mjs — headless Shoalwater: load a pack, apply a practice start or
// a snapshot, step the core, print the resulting snapshot.
//   node tools/sim.mjs [--pack docs/real-pack] [--start jamestown]
//                      [--snapshot file.json] [--tide 1.4] [--steps 3600]
//                      [--steps-per-frame 1] [--out final.json]
// --steps-per-frame is the page's time-scale analogue (Addition 1):
// the same fixed 1/60 steps, batched N per "frame" — the batching
// changes nothing physically, which is exactly the point.
// With no controller attached the input object stays zeroed, so the boat
// sits and the drone charges — this entry point exists to prove that the
// core runs identically outside the page; drivers live in the harness
// and the control runs.
import { readFile, writeFile } from 'node:fs/promises';
import { loadPackFromDisk, applyPracticeStart } from './pack-loader.mjs';
import { createGame, STEP } from '../docs/core.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const packDir = args.pack || 'docs/real-pack';
const { pack, useZ, tileCount } = await loadPackFromDisk(packDir);
const game = createGame(pack);
if (args.tide !== undefined) game.state.tide = parseFloat(args.tide);
if (args.snapshot) game.load(JSON.parse(await readFile(args.snapshot, 'utf8')));
else applyPracticeStart(game, args.start || 'spawn');

const steps = parseInt(args.steps || '0', 10);
const perFrame = Math.max(1, parseInt(args['steps-per-frame'] || '1', 10));
let frames = 0;
for (let done = 0; done < steps; done += perFrame) {
  const n = Math.min(perFrame, steps - done);
  for (let i = 0; i < n; i++) game.step(STEP);
  frames++;
}

const snap = JSON.stringify(game.snapshot());
console.log(`pack=${packDir} z=${useZ} tiles=${tileCount} steps=${steps} frames=${frames} stepsPerFrame=${perFrame}`);
console.log(snap);
if (args.out) await writeFile(args.out, snap + '\n');
