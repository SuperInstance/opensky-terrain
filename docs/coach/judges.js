// judges.js — who scores tile fit, and the four M0 controls.
//
// A judge returns { fit: 0..1, reasons: [..] } for a candidate tile in
// the current situation. The percentages are PROVISIONAL — no judge
// has passed a calibration gate (that gate is M1 work), and the band
// thresholds in the overseer are placeholders until one does. The
// three constant judges are the design's controls: they exist to test
// the band logic itself, not any judge's wisdom.

// The provisional "real" judge: a deterministic heuristic over state
// the adapter can read. Deliberately simple — its job in M0 is to be
// a sane stand-in while the controls probe the machinery around it.
const realJudge = {
  name: 'real',
  score(tile, { game, adapter }) {
    const b = game.state.boat;
    if (tile.id === 'make-way') {
      const t = tile.target;
      const dist = Math.hypot(t.x - b.pos.x, t.z - b.pos.z);
      const n = Math.max(1, Math.ceil(dist / 100));
      for (let i = 1; i < n; i++) {
        const x = b.pos.x + (t.x - b.pos.x) * i / n, z = b.pos.z + (t.z - b.pos.z) * i / n;
        if (!Number.isFinite(adapter.groundAt(x, z))) {
          return { fit: 0.25, reasons: ['the direct route leaves mapped water'] };
        }
      }
      return { fit: Math.max(0.72, 0.9 - dist / 50000), reasons: [`open mapped water, ${(dist / 1000).toFixed(1)} km`] };
    }
    if (tile.id === 'work-the-shoal') {
      const pre = tile.precondition({ game, adapter });
      const battery = game.state.drone.battery;
      const fit = Math.min(0.97, Math.max(0.05, 0.45 + (pre.depth - 2.3) * 0.06 + battery * 0.25));
      return { fit, reasons: [`the tide clears the shoal by ${pre.depth.toFixed(1)} m`, `drone battery ${Math.round(battery * 100)}%`] };
    }
    return { fit: 0.5, reasons: ['no heuristic for this tile yet'] };
  },
};

const constant = (v) => ({
  name: `always-${v}`,
  score() { return { fit: v, reasons: [`control judge: constant ${v}`] }; },
});

export const JUDGES = {
  real: realJudge,
  'always-0.9': constant(0.9),
  'always-0.5': constant(0.5),
  'always-0.3': constant(0.3),
};
