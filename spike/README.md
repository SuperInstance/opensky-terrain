# three-tile loader spike

Proves the runtime integration point for Region Packs: a subclass of the
upstream `three-tile` `TileLoader` (v0.12.2, the version OpenSkyFlight
depends on) overrides `updateGeometry` to decode quantized-mesh tiles from
a Region Pack and build Three.js geometry in the pack's local ENU frame —
positions, index, computed normals, and the pack's per-vertex extensions
carried in as `aConfidence` / `aBottomType` geometry attributes.

Verified headless (Node, no renderer): the synthetic pack's root tile loads
through `TileLoader.update()` into a real `TileMesh` with 841 vertices,
4,704 indices, height range exactly -50.141..-5.666 m, both attributes
present. Run it:

```bash
cd spike && npm install
PACK_DIR=/path/to/a/baked/pack node spike_test.ts   # prints SPIKE PASS
```

`PACK_DIR` points at any pack produced by `regionpack.bake` (the repo's
checks bake one from fixtures; the full synthetic Sitka pack is not in this
repo — see the licence note in the root README). The remaining fork work is
the material side (contour/confidence shading via TSL) and TileMap-level
LOD wiring; the geometry path — the risky half — is what this spike closes.
