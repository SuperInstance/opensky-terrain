#!/usr/bin/env python3
"""
qm_ref.py — quantized-mesh-1.0 encoder/decoder roundtrip prototype with
LOCAL-ENU vertex storage and two custom extensions.

Reference implementation written by Muse after two MiniMax drafts failed
verification (v1: wrong header format + invented zigzag/HWM helpers +
float32 heights; v2: toy dict API that dropped the format entirely).

Wire format (little-endian throughout, per quantized-mesh-1.0):
  Header: CenterX/Y/Z (3x float64), MinimumHeight/MaximumHeight (2x float32),
          BoundingSphereCenterX/Y/Z + Radius (4x float64),
          HorizonOcclusionPointX/Y/Z (3x float64)   -> struct '<3dff4d3d'
          LOCAL FRAME NOTE: for Region Packs the header coordinates are in the
          pack's local ENU frame (meters from the manifest origin), NOT ECEF.
          The pack manifest declares the frame; this is the documented local
          deviation that the custom runtime decoder is built against.
  VertexData: vertexCount (uint32), then u[], v[], height[] — each vertexCount
          uint16, delta-encoded then zigzag-encoded. Heights are quantized
          0..32767 between MinimumHeight and MaximumHeight.
  IndexData: triangleCount*3 (uint32), then indices in high-water-mark
          encoding, uint16 when vertexCount <= 65536 else uint32.
  Edge indices: west, south, east, north — each uint32 count + uint32 indices.
  Extensions: repeated (uint8 id, uint32 length, bytes) until end of buffer.
          id 5 = bathymetry-bottomtype: uint8 per vertex (enum in spec).
          id 6 = bathymetry-confidence: uint8 per vertex, 0-255.
"""
import gzip
import struct

import numpy as np
from scipy.spatial import Delaunay

HEADER_FMT = "<3dff4d3d"
HEADER_SIZE = struct.calcsize(HEADER_FMT)


# ---------------------------------------------------------------- zigzag/delta
def _delta_zigzag_encode(values: np.ndarray) -> np.ndarray:
    v = values.astype(np.int64)
    deltas = np.diff(v, prepend=0)
    zz = (deltas << 1) ^ (deltas >> 63)
    return zz.astype(np.uint16)


def _delta_zigzag_decode(encoded: np.ndarray) -> np.ndarray:
    zz = encoded.astype(np.int64)
    deltas = (zz >> 1) ^ -(zz & 1)
    return np.cumsum(deltas)


# ------------------------------------------------------------------ high water
def _hwm_encode(indices: np.ndarray) -> np.ndarray:
    out = np.empty(len(indices), dtype=np.int64)
    highest = 0
    for i, idx in enumerate(indices):
        if idx == highest:
            out[i] = 0
            highest += 1
        else:
            out[i] = highest - idx
    return out


def _hwm_decode(encoded: np.ndarray) -> np.ndarray:
    out = np.empty(len(encoded), dtype=np.int64)
    highest = 0
    for i, code in enumerate(encoded):
        out[i] = highest - code
        if code == 0:
            highest += 1
    return out


# --------------------------------------------------------------------- encode
def encode_tile(u, v, heights_m, triangles, bottom_type, confidence, header):
    """u, v: uint16 arrays in 0..32767 quantized tile space.
    heights_m: float array (meters, MLLW). triangles: (n,3) index array.
    bottom_type / confidence: uint8 per-vertex arrays, or empty to omit."""
    u = np.asarray(u, dtype=np.uint16)
    v = np.asarray(v, dtype=np.uint16)
    heights_m = np.asarray(heights_m, dtype=np.float64)
    triangles = np.asarray(triangles, dtype=np.int64)
    n = len(u)
    assert len(v) == len(heights_m) == n

    # High-water-mark encoding requires vertices to be FIRST REFERENCED in
    # increasing order. Relabel vertices by first occurrence in the triangle
    # stream (real QM encoders do the same) and permute all per-vertex arrays
    # consistently. Vertices never referenced keep their relative order last.
    first_occ = np.full(n, np.iinfo(np.int64).max)
    flat_in = triangles.ravel()
    seen = np.zeros(n, dtype=bool)
    for pos, idx in enumerate(flat_in):
        if not seen[idx]:
            seen[idx] = True
            first_occ[idx] = pos
    order = np.argsort(first_occ, kind="stable")  # old indices in new order
    new_id = np.empty(n, dtype=np.int64)
    new_id[order] = np.arange(n)
    u, v, heights_m = u[order], v[order], heights_m[order]
    if bottom_type is not None and len(bottom_type):
        bottom_type = np.asarray(bottom_type)[order]
    if confidence is not None and len(confidence):
        confidence = np.asarray(confidence)[order]
    triangles = new_id[triangles]

    hmin = float(header["MinimumHeight"])
    hmax = float(header["MaximumHeight"])
    span = hmax - hmin if hmax > hmin else 1.0
    height_q = np.round((heights_m - hmin) / span * 32767).astype(np.uint16)

    out = bytearray()
    out += struct.pack(
        HEADER_FMT,
        header["CenterX"], header["CenterY"], header["CenterZ"],
        hmin, hmax,
        header["BoundingSphereCenterX"], header["BoundingSphereCenterY"],
        header["BoundingSphereCenterZ"], header["BoundingSphereRadius"],
        header["HorizonOcclusionPointX"], header["HorizonOcclusionPointY"],
        header["HorizonOcclusionPointZ"],
    )
    # vertex data
    out += struct.pack("<I", n)
    out += _delta_zigzag_encode(u).tobytes()
    out += _delta_zigzag_encode(v).tobytes()
    out += _delta_zigzag_encode(height_q).tobytes()
    # triangle indices (high-water-mark)
    flat = triangles.ravel()
    idx = _hwm_encode(flat)
    out += struct.pack("<I", len(flat))
    if n > 65536:
        out += idx.astype(np.uint32).tobytes()
    else:
        out += idx.astype(np.uint16).tobytes()
    # edge indices: vertices lying on each tile border, in vertex order
    edges = {
        "west": np.where(u == 0)[0],
        "south": np.where(v == 0)[0],
        "east": np.where(u == 32767)[0],
        "north": np.where(v == 32767)[0],
    }
    for name in ("west", "south", "east", "north"):
        e = edges[name].astype(np.uint32)
        out += struct.pack("<I", len(e))
        out += e.tobytes()
    # extensions
    for ext_id, arr in ((5, bottom_type), (6, confidence)):
        if arr is None or len(arr) == 0:
            continue
        arr = np.asarray(arr, dtype=np.uint8)
        assert len(arr) == n
        out += struct.pack("<BI", ext_id, len(arr))
        out += arr.tobytes()
    return bytes(out)


# --------------------------------------------------------------------- decode
def decode_tile(data: bytes):
    off = 0
    vals = struct.unpack_from(HEADER_FMT, data, off)
    off += HEADER_SIZE
    header = {
        "CenterX": vals[0], "CenterY": vals[1], "CenterZ": vals[2],
        "MinimumHeight": vals[3], "MaximumHeight": vals[4],
        "BoundingSphereCenterX": vals[5], "BoundingSphereCenterY": vals[6],
        "BoundingSphereCenterZ": vals[7], "BoundingSphereRadius": vals[8],
        "HorizonOcclusionPointX": vals[9], "HorizonOcclusionPointY": vals[10],
        "HorizonOcclusionPointZ": vals[11],
    }
    n = struct.unpack_from("<I", data, off)[0]
    off += 4

    def read_u16s(count):
        nonlocal off
        arr = np.frombuffer(data, dtype="<u2", count=count, offset=off)
        off += 2 * count
        return arr.copy()

    u = _delta_zigzag_decode(read_u16s(n)).astype(np.uint16)
    v = _delta_zigzag_decode(read_u16s(n)).astype(np.uint16)
    height_q = _delta_zigzag_decode(read_u16s(n))
    hmin, hmax = header["MinimumHeight"], header["MaximumHeight"]
    heights = hmin + height_q / 32767.0 * (hmax - hmin)

    tri_count = struct.unpack_from("<I", data, off)[0]
    off += 4
    if n > 65536:
        raw = np.frombuffer(data, dtype="<u4", count=tri_count, offset=off)
        off += 4 * tri_count
    else:
        raw = np.frombuffer(data, dtype="<u2", count=tri_count, offset=off)
        off += 2 * tri_count
    triangles = _hwm_decode(raw.astype(np.int64)).reshape(-1, 3)

    edges = {}
    for name in ("west", "south", "east", "north"):
        c = struct.unpack_from("<I", data, off)[0]
        off += 4
        edges[name] = np.frombuffer(data, dtype="<u4", count=c, offset=off).copy()
        off += 4 * c

    bottom_type = np.array([], dtype=np.uint8)
    confidence = np.array([], dtype=np.uint8)
    while off < len(data):
        ext_id, ext_len = struct.unpack_from("<BI", data, off)
        off += 5
        payload = data[off:off + ext_len]
        off += ext_len
        if ext_id == 5:
            bottom_type = np.frombuffer(payload, dtype=np.uint8).copy()
        elif ext_id == 6:
            confidence = np.frombuffer(payload, dtype=np.uint8).copy()
        # unknown extensions are skipped by length, per spec

    return {
        "header": header, "u": u, "v": v, "height": heights,
        "triangles": triangles, "edges": edges,
        "bottom_type": bottom_type, "confidence": confidence,
    }


# ------------------------------------------------------------------ test tile
def make_test_tile(grid=15, seed=7):
    """A jittered-grid TIN over a unit tile: a gaussian shoal peaking at
    -5.5 m amid -40 m depths. Border vertices stay on the border so the
    edge-index lists are populated."""
    rng = np.random.default_rng(seed)
    xs = np.linspace(0.0, 1.0, grid)
    pts = []
    for i, gx in enumerate(xs):
        for j, gy in enumerate(xs):
            x, y = gx, gy
            if 0 < i < grid - 1:
                x += rng.uniform(-0.02, 0.02)
            if 0 < j < grid - 1:
                y += rng.uniform(-0.02, 0.02)
            pts.append((x, y))
    pts = np.array(pts)
    d2 = (pts[:, 0] - 0.5) ** 2 + (pts[:, 1] - 0.5) ** 2
    heights = -40.0 + 34.5 * np.exp(-d2 / 0.02)
    triangles = Delaunay(pts).simplices
    u = np.round(pts[:, 0] * 32767).astype(np.uint16)
    v = np.round(pts[:, 1] * 32767).astype(np.uint16)
    dist = np.sqrt(d2)
    bottom_type = np.where(dist < 0.12, 1, 2).astype(np.uint8)  # rock core, sand
    confidence = np.clip(240 - 500 * dist, 20, 255).astype(np.uint8)
    header = {
        "CenterX": 2500.0, "CenterY": 2500.0, "CenterZ": -22.0,
        "MinimumHeight": float(heights.min()),
        "MaximumHeight": float(heights.max()),
        "BoundingSphereCenterX": 2500.0, "BoundingSphereCenterY": 2500.0,
        "BoundingSphereCenterZ": -22.0, "BoundingSphereRadius": 3600.0,
        "HorizonOcclusionPointX": 2500.0, "HorizonOcclusionPointY": 2500.0,
        "HorizonOcclusionPointZ": 500.0,
    }
    return {"u": u, "v": v, "height_m": heights, "triangles": triangles,
            "bottom_type": bottom_type, "confidence": confidence,
            "header": header}


def main():
    t = make_test_tile()
    data_ext = encode_tile(t["u"], t["v"], t["height_m"], t["triangles"],
                           t["bottom_type"], t["confidence"], t["header"])
    data_plain = encode_tile(t["u"], t["v"], t["height_m"], t["triangles"],
                             np.array([], dtype=np.uint8),
                             np.array([], dtype=np.uint8), t["header"])
    gz_ext = len(gzip.compress(data_ext))
    gz_plain = len(gzip.compress(data_plain))

    d = decode_tile(data_ext)
    # The encoder relabels vertices by first occurrence (HWM requirement), so
    # verify SEMANTIC equality: same vertices (keyed by unique (u,v)) with the
    # same attributes, and the same triangles under that correspondence.
    orig_key = {(int(t["u"][i]), int(t["v"][i])): i for i in range(len(t["u"]))}
    assert len(orig_key) == len(t["u"]), "test tile (u,v) not unique"
    back = np.array([orig_key[(int(d["u"][i]), int(d["v"][i]))]
                     for i in range(len(d["u"]))])
    tol = (t["header"]["MaximumHeight"] - t["header"]["MinimumHeight"]) / 32767 / 2 + 1e-9
    err = float(np.max(np.abs(d["height"] - t["height_m"][back])))
    assert err <= tol, f"height error {err} > tol {tol}"
    assert np.array_equal(d["bottom_type"], t["bottom_type"][back]), "bottom_type mismatch"
    assert np.array_equal(d["confidence"], t["confidence"][back]), "confidence mismatch"
    tri_orig = {tuple(sorted(x)) for x in t["triangles"].tolist()}
    tri_dec = {tuple(sorted(back[list(x)])) for x in d["triangles"].tolist()}
    assert tri_orig == tri_dec, "triangle sets differ"
    assert len(d["edges"]["west"]) > 0 and len(d["edges"]["north"]) > 0, "edges empty"
    # no-extension variant must decode with empty extension arrays
    d2 = decode_tile(data_plain)
    assert len(d2["bottom_type"]) == 0 and len(d2["confidence"]) == 0
    tri_dec2 = {tuple(sorted(back[list(x)])) for x in d2["triangles"].tolist()}
    assert tri_dec2 == tri_orig

    print(f"PASS: vertices={len(t['u'])} triangles={len(t['triangles'])} "
          f"height_max_err={err:.5f} m (tol {tol:.5f}) "
          f"gz sizes ext/plain: {gz_ext}/{gz_plain} bytes "
          f"(extensions cost {gz_ext - gz_plain} B gz, "
          f"{len(data_ext) - len(data_plain)} B raw)")


if __name__ == "__main__":
    main()
