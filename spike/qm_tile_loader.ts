// qm_tile_loader.ts — SPIKE: a three-tile TileLoader that serves our
// quantized-mesh Region Pack tiles (local ENU) instead of Terrarium DEM.
// Overrides updateGeometry (the exact fork point the feasibility report
// identified); updateMaterial is a no-op (terrain material spike is next).
import { readFileSync } from "node:fs";
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import { TileLoader, TileMesh } from "three-tile";
import { decodeQuantizedMeshTile } from "../runtime/qm_decoder.ts";

export interface PackTileExtent { westX: number; southY: number; spanX: number; spanY: number }

export class QmTileLoader extends TileLoader {
  private packDir: string;
  private extents: Map<string, PackTileExtent>;
  constructor(packDir: string, extents: Map<string, PackTileExtent>) {
    super();
    this.packDir = packDir;
    this.extents = extents;
  }
  protected async updateMaterial(): Promise<boolean> { return false; }
  protected async updateGeometry(params: { x: number; y: number; z: number }, tileMesh: TileMesh): Promise<boolean> {
    const key = `${params.z}/${params.x}/${params.y}`;
    const ext = this.extents.get(key);
    if (!ext) return false;
    const data = readFileSync(`${this.packDir}/tiles/${key}.terrain`);
    const tile = decodeQuantizedMeshTile(data);
    const n = tile.vertexCount;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = ext.westX + (tile.u[i] / 32767) * ext.spanX;       // east
      positions[i * 3 + 1] = tile.height[i];                                 // up
      positions[i * 3 + 2] = -(ext.southY + (tile.v[i] / 32767) * ext.spanY); // z = -north
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    if (tile.confidence) geo.setAttribute("aConfidence", new Float32BufferAttribute(Float32Array.from(tile.confidence), 1));
    if (tile.bottomType) geo.setAttribute("aBottomType", new Float32BufferAttribute(Float32Array.from(tile.bottomType), 1));
    geo.setIndex(new Uint32BufferAttribute(tile.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    tileMesh.setGeometry(geo);
    return true;
  }
}
