// qm.js — browser quantized-mesh-1.0 decoder for Region Pack tiles.
// Plain-JS port of runtime/qm_decoder.ts (same format logic, verified
// against the Python reference decoder). Extensions: id 5 = bottom-type,
// id 6 = confidence (uint8 per vertex); unknown IDs skipped by length.
export function decodeQuantizedMeshTile(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const f64 = () => { const v = view.getFloat64(offset, true); offset += 8; return v; };
  const f32 = () => { const v = view.getFloat32(offset, true); offset += 4; return v; };
  const u32 = () => { const v = view.getUint32(offset, true); offset += 4; return v; };

  const header = {
    centerX: f64(), centerY: f64(), centerZ: f64(),
    minimumHeight: f32(), maximumHeight: f32(),
    boundingSphereCenterX: f64(), boundingSphereCenterY: f64(),
    boundingSphereCenterZ: f64(), boundingSphereRadius: f64(),
    horizonOcclusionPointX: f64(), horizonOcclusionPointY: f64(),
    horizonOcclusionPointZ: f64(),
  };

  const vertexCount = u32();
  const zigzagDelta = () => {
    const out = new Uint16Array(vertexCount);
    let prev = 0;
    for (let i = 0; i < vertexCount; i++) {
      const raw = view.getUint16(offset + i * 2, true);
      prev += (raw >> 1) ^ -(raw & 1);
      out[i] = prev;
    }
    offset += vertexCount * 2;
    return out;
  };
  const u = zigzagDelta();
  const v = zigzagDelta();
  const q = zigzagDelta();
  const span = header.maximumHeight - header.minimumHeight;
  const height = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    height[i] = header.minimumHeight + (q[i] / 32767) * span;
  }

  const indexCount = u32();
  const wide = vertexCount > 65536;
  const indices = new Uint32Array(indexCount);
  let highest = 0;
  for (let i = 0; i < indexCount; i++) {
    const code = wide ? view.getUint32(offset + i * 4, true)
      : view.getUint16(offset + i * 2, true);
    indices[i] = highest - code;
    if (code === 0) highest++;
  }
  offset += indexCount * (wide ? 4 : 2);

  const edges = {};
  for (const key of ["west", "south", "east", "north"]) {
    const count = u32();
    const arr = new Uint32Array(count);
    for (let i = 0; i < count; i++) arr[i] = u32();
    edges[key] = arr;
  }

  let bottomType = null;
  let confidence = null;
  const extensionIds = [];
  while (offset < bytes.byteLength) {
    const id = view.getUint8(offset); offset += 1;
    const length = u32();
    if (id === 5) bottomType = bytes.slice(offset, offset + length);
    else if (id === 6) confidence = bytes.slice(offset, offset + length);
    extensionIds.push(id);
    offset += length;
  }

  return { header, vertexCount, u, v, height, indices, edges,
    bottomType, confidence, extensionIds };
}
