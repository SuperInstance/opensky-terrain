// run-controls.mjs — the design's four control judges over the A-plan
// (design §8.2). Each runs the full session in sim and writes its logs
// under sessions/m0-ctrl-<judge>/. The point of the controls is the
// band logic, not the judges: B (0.9) may stumble, C (0.3) must refuse
// cleanly into hold-station, D (0.5) must terminate via the forced
// exits and never stall.
import { loadPackFromDisk } from './pack-loader.mjs';
import { runSession } from '../docs/coach/session.js';

const { pack } = await loadPackFromDisk('docs/real-pack');
for (const judgeName of ['real', 'always-0.9', 'always-0.5', 'always-0.3']) {
  const { report } = await runSession({ pack, judgeName, tide: 1.4, sessionId: 'm0-ctrl-' + judgeName });
  console.log(`\n=== control ${judgeName} (tide +1.4) ===`);
  console.log(`terminated: ${report.terminated} in ${report.simMinutes} sim-min`);
  console.log(`objectives completed: ${report.objectivesCompleted.join(', ') || 'none'}`);
  console.log(`plan completion: ${report.planCompletion} (${report.planResults.map(r => `${r.label}=${r.result}`).join('; ')})`);
  console.log(`bends: ${report.bends.map(b => `score ${b.score} vs ${b.threshold} -> ${b.bent ? 'BENT' : 'declined'}`).join(' | ') || 'none'}`);
  console.log(`stumbles: ${report.stumbles.groundings} groundings, ${report.stumbles.hullHits} hull hits`);
  console.log(`decisions: ${report.decisions} (${report.decisionsPerMin}/min) · holdCountMax ${report.holdCountMax} · exploratory ${report.exploratory} · shadow opportunities ${report.shadowOpportunities}`);
  console.log(`logs: ${report.logs}`);
}
