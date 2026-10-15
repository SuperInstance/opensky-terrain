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
    if (tile.id === 'hunt-the-pot') {
      const pre = tile.precondition({ game, adapter });
      const battery = game.state.drone.battery;
      const fit = Math.min(0.95, Math.max(0.05, 0.5 + (pre.depth - 2.0) * 0.03 + battery * 0.2));
      return { fit, reasons: [`the drainage carries ${pre.depth.toFixed(1)} m of water to hunt in`, `drone battery ${Math.round(battery * 100)}% (the tile tops it up first)`] };
    }
    if (tile.id === 'hold-station') {
      const d = game.state.drone;
      // the reflex's fit is about exposure: a drone out on a falling
      // battery is the situation this tile exists for; a quiet boat
      // with everything aboard can always hold, unremarkably
      if (!d.aboard && d.battery < 0.5) return { fit: 0.9, reasons: [`the drone is out on ${Math.round(d.battery * 100)}% — bring her in and hold`] };
      if (!d.aboard) return { fit: 0.75, reasons: ['the drone is out — recover her and hold station'] };
      return { fit: 0.55, reasons: ['everything is aboard and she can hold where she lies'] };
    }
    if (tile.id === 'wreck-look') {
      const pre = tile.precondition({ game, adapter });
      const fit = Math.min(0.92, Math.max(0.05, 0.62 + (pre.depth - 1.35) * 0.25));
      return { fit, reasons: [`the cove mouth carries ${pre.depth.toFixed(1)} m — past the keel guard's 1.35 m with room`] };
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
