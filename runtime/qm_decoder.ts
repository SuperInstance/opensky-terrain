// qm_decoder.ts

// Check if the module is being run as a CLI script
const isCliMode = import.meta.url === pathToFileURL(process.argv[1]).href;

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Define the QuantizedMeshHeader interface
export interface QuantizedMeshHeader {
  centerX: number;
  centerY: number;
  centerZ: number;
  minimumHeight: number;
  maximumHeight: number;
  boundingSphereCenterX: number;
  boundingSphereCenterY: number;
  boundingSphereCenterZ: number;
  boundingSphereRadius: number;
  horizonOcclusionPointX: number;
  horizonOcclusionPointY: number;
  horizonOcclusionPointZ: number;
}

// Define the DecodedTile interface
export interface DecodedTile {
  header: QuantizedMeshHeader;
  vertexCount: number;
  u: Uint16Array;
  v: Uint16Array;
  height: Float32Array;
  indices: Uint32Array;
  edges: {
    west: Uint32Array;
    south: Uint32Array;
    east: Uint32Array;
    north: Uint32Array;
  };
  bottomType: Uint8Array | null;
  confidence: Uint8Array | null;
  extensionIds: number[];
}

// Function to decode a quantized mesh tile
export function decodeQuantizedMeshTile(data: ArrayBuffer | Uint8Array): DecodedTile {
  // Ensure data is a Uint8Array
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

  // Create a DataView for the buffer
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 0;

  // Read the header (88 bytes)
  const header: QuantizedMeshHeader = {
    centerX: view.getFloat64(offset, true),
    centerY: view.getFloat64(offset + 8, true),
    centerZ: view.getFloat64(offset + 16, true),
    minimumHeight: view.getFloat32(offset + 24, true),
    maximumHeight: view.getFloat32(offset + 28, true),
    boundingSphereCenterX: view.getFloat64(offset + 32, true),
    boundingSphereCenterY: view.getFloat64(offset + 40, true),
    boundingSphereCenterZ: view.getFloat64(offset + 48, true),
    boundingSphereRadius: view.getFloat64(offset + 56, true),
    horizonOcclusionPointX: view.getFloat64(offset + 64, true),
    horizonOcclusionPointY: view.getFloat64(offset + 72, true),
    horizonOcclusionPointZ: view.getFloat64(offset + 80, true),
  };
  offset += 88;

  // Read vertexCount
  const vertexCount = view.getUint32(offset, true);
  offset += 4;

  // Read u, v, height arrays
  const u = decodeZigZagDeltaEncodedArray(view, offset, vertexCount);
  offset += vertexCount * 2;
  const v = decodeZigZagDeltaEncodedArray(view, offset, vertexCount);
  offset += vertexCount * 2;
  const height = Float32Array.from(decodeZigZagDeltaEncodedArray(view, offset, vertexCount)).map((q) => header.minimumHeight + (q / 32767) * (header.maximumHeight - header.minimumHeight));
  offset += vertexCount * 2;

  // Read indices
  const indexCount = view.getUint32(offset, true);
  offset += 4;
  const indices = decodeHighWaterMarkEncodedArray(view, offset, indexCount, vertexCount > 65536 ? 4 : 2);
  offset += indexCount * (vertexCount > 65536 ? 4 : 2);

  // Read edges: four count-prefixed uint32 lists, sequential.
  const edges = { west: new Uint32Array(0), south: new Uint32Array(0), east: new Uint32Array(0), north: new Uint32Array(0) };
  for (const key of ["west", "south", "east", "north"] as const) {
    edges[key] = decodeUint32Array(view, offset);
    offset += 4 + edges[key].length * 4;
  }

  // Read extensions
  const extensionIds: number[] = [];
  let bottomType: Uint8Array | null = null;
  let confidence: Uint8Array | null = null;

  while (offset < buffer.length) {
    const extensionId = view.getUint8(offset);
    offset += 1;
    const extensionLength = view.getUint32(offset, true);
    offset += 4;
    const extensionEnd = offset + extensionLength;

    switch (extensionId) {
      case 5:
        bottomType = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, extensionLength);
        break;
      case 6:
        confidence = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, extensionLength);
        break;
      default:
        // Skip unknown extensions
        break;
    }

    offset = extensionEnd;
    extensionIds.push(extensionId);
  }

  return {
    header,
    vertexCount,
    u,
    v,
    height,
    indices,
    edges,
    bottomType,
    confidence,
    extensionIds,
  };
}

// Function to decode zigzag delta encoded array
function decodeZigZagDeltaEncodedArray(view: DataView, offset: number, length: number): Uint16Array {
  const result = new Uint16Array(length);
  let prev = 0;
  for (let i = 0; i < length; i++) {
    const value = view.getUint16(offset + i * 2, true);
    const zigzag = (value >> 1) ^ -(value & 1);
    const delta = prev + zigzag;
    result[i] = delta;
    prev = delta;
  }
  return result;
}

// Function to decode high water mark encoded array.
// HWM semantics: index = highest - code; when code == 0 the index IS the
// current highest and highest increments afterwards. Length is the full
// index count (3 per triangle), not divided by anything.
function decodeHighWaterMarkEncodedArray(view: DataView, offset: number, length: number, byteLength: number): Uint32Array {
  const result = new Uint32Array(length);
  let highest = 0;
  for (let i = 0; i < length; i++) {
    const code = byteLength === 4 ? view.getUint32(offset + i * 4, true) : view.getUint16(offset + i * 2, true);
    result[i] = highest - code;
    if (code === 0) {
      highest++;
    }
  }
  return result;
}

// Function to decode uint32 array
function decodeUint32Array(view: DataView, offset: number): Uint32Array {
  const count = view.getUint32(offset, true);
  const array = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    array[i] = view.getUint32(offset + 4 + i * 4, true);
  }
  return array;
}

// CLI test mode
if (isCliMode) {
  const filePath = process.argv[2];
  const fileData = readFileSync(filePath);
  const decodedTile = decodeQuantizedMeshTile(fileData);

  const summary = {
    vertexCount: decodedTile.vertexCount,
    triangleCount: decodedTile.indices.length / 3,
    heightMin: decodedTile.height.reduce((min, val) => (val < min ? val : min), decodedTile.height[0]),
    heightMax: decodedTile.height.reduce((max, val) => (val > max ? val : max), decodedTile.height[0]),
    indexHead: Array.from(decodedTile.indices.subarray(0, 6)),
    uHead: Array.from(decodedTile.u.subarray(0, 3)),
    vHead: Array.from(decodedTile.v.subarray(0, 3)),
    bottomTypeCounts: decodedTile.bottomType
      ? Array.from(decodedTile.bottomType)
          .reduce((acc, val) => {
            acc[val] = (acc[val] || 0) + 1;
            return acc;
          }, {})
      : {},
    confidenceMean: decodedTile.confidence
      ? decodedTile.confidence.reduce((sum, val) => sum + val, 0) / decodedTile.confidence.length
      : null,
    extensionIds: decodedTile.extensionIds,
  };

  console.log(JSON.stringify(summary));
}
