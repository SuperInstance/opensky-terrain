import { MeshBasicMaterial } from "three";
import { TileMesh } from "three-tile";
import { QmTileLoader } from "./qm_tile_loader.ts";

const pack = process.env.PACK_DIR ?? "../examples/synthetic-pack";
// Root tile (z=0, stride 8 over the 25 m grid): samples span the full grid.
const extents = new Map([
  ["0/0/0", { westX: -2763.876, southY: -2767.343, spanX: 5550.0, spanY: 5525.0 }],
]);
const loader = new QmTileLoader(pack, extents);
const mesh = new TileMesh(undefined, [new MeshBasicMaterial()]);
const changed = await loader.update(
  { x: 0, y: 0, z: 0, projBounds: [0, 0, 0, 0] } as never, mesh);
const g = mesh.geometry;
const pos = g.getAttribute("position");
const bb = g.boundingBox!;
const conf = g.getAttribute("aConfidence");
const bt = g.getAttribute("aBottomType");
console.log(JSON.stringify({
  changed,
  vertexCount: pos.count,
  indexCount: g.getIndex()!.count,
  yRange: [bb.min.y, bb.max.y],
  hasConfidence: !!conf, hasBottomType: !!bt,
  normalFinite: Number.isFinite(g.getAttribute("normal").getX(0)),
}));
if (!changed || pos.count !== 841 || g.getIndex()!.count !== 1568 * 3
    || Math.abs(bb.min.y - -50.141) > 0.01 || Math.abs(bb.max.y - -5.666) > 0.01
    || !conf || !bt) { console.log("SPIKE FAIL"); process.exit(1); }
console.log("SPIKE PASS");
