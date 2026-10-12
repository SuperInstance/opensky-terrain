# Region Pack Specification — v0.2 Amendments (draft, for maintainer review)

**Version:** v0.2  
**Date:** 2026-10-12  
**Status:** DRAFT  

---

### 1. COPC Archive Stage Measurement
- **Section Affected:** Bake Pipeline  
- **Change:**  
  - Add COPC/LAZ as the normative archive form in the bake pipeline section.  
  - Include the measured ratio (21.7x vs XYZ) as an informative note.  
- **Rationale:**  
  - Verified through code execution: corrected fleet soundings to COPC/LAZ resulted in a 21.7x compression ratio, retaining 2,439 soundings and excluding 261 out-of-tide-range soundings.  
- **Type:** Normative (archive form), Informative (measured ratio)  

---

### 2. Cross-Language Format Proof
- **Section Affected:** Conformance Requirements  
- **Change:**  
  - Add a conformance requirement that an implementation must round-trip the reference tiles byte-semantically (same decode).  
  - List the reference tile in examples/example-pack as the conformance fixture.  
- **Rationale:**  
  - Verified through code execution: the TypeScript decoder reproduces Python-encoded tiles exactly (vertex/triangle counts, heights, indices, both extensions).  
- **Type:** Normative  

---

### 3. LOD Selector Contract Clarification
- **Section Affected:** LOD Selector  
- **Change:**  
  - Replace ambiguous hysteresis wording with the following:  
    - Effective interval = the COARSER of (mode target, finest interval the loaded mesh honestly supports).  
    - The mesh clamp applies instantly.  
    - Hysteresis (10% band margin) gates MODE transitions only.  
    - Explicit user mode changes bypass hysteresis but never the clamp.  
- **Rationale:**  
  - Clarified through the reference implementation: ensures clear understanding of LOD selection and hysteresis behavior.  
- **Type:** Normative  

---

### 4. Bake Self-Check Tolerance Rule
- **Section Affected:** Bake Invariants  
- **Change:**  
  - Add the tolerance budget rule: verification tolerance = half the DECODED quantization step + the float32 endpoint budget (|min| + span) * 2^-24, computed from the decoded header — never from float64 source values alone.  
- **Rationale:**  
  - Verified through code execution: two real tiles exceeded narrower tolerances by 4 nanometers and 0.27 micrometers respectively; the float32 header sets a hard floor (~micrometers) on how exactly any tile can verify.  
- **Type:** Normative  

---

### 5. Extension Robustness
- **Section Affected:** Decoder Requirements  
- **Change:**  
  - Elevate the advice to a MUST: decoders MUST skip unknown extension IDs by their length field.  
  - Include the rationale that a widely-used NASA loader was source-verified to break on unknown IDs due to the lack of a skip branch.  
- **Rationale:**  
  - Ensures robustness and compatibility with unknown extensions.  
- **Type:** Normative  

---

### 6. Pack Extent / Curved Sea
- **Section Affected:** Pack Geometry  
- **Change:**  
  - Record the decision packet summary:  
    - Corner drop 208 m (90x50 km), 12 m (20x15 km).  
    - ~1.83 m honesty threshold implies ~6.8 km square packs if flat-sea capping is chosen.  
    - Independent judgment process split between curved sea (0.47) and tiny packs (0.42).  
    - Note that in the reference runtime, the sea surface already computes per-vertex depth attributes on CPU, making a curved segmented sea a contained change.  
  - Status: DECISION PENDING (maintainer).  
- **Rationale:**  
  - Ongoing decision process regarding pack geometry and sea surface representation.  
- **Type:** Informative  

---

### 7. Validator Growth
- **Section Affected:** Conformance Suite  
- **Change:**  
  - The conformance suite now additionally runs the bake self-check over a pack baked end-to-end from this repository's own synthetic fixtures, plus the TypeScript decoder/LOD test suites.  
  - One command (checks/run_all.py) reproduces every verified number in the README.  
- **Rationale:**  
  - Ensures comprehensive validation and reproducibility of verified numbers.  
- **Type:** Normative  

---

### Unchanged from v0.1:
- Tile format core  
- Extension IDs 5/6  
- ENU frame  
- Datum handling  
- Contour ladder values  

---

### Maintainer notes on two micro-decisions (2026-10-12)

Reviewed with an independent typed-judgment pass (Jev/TypeSafe), which
favoured a Morton quadkey path scheme and deferring any extension registry.
Neither is adopted as-is:

- **Tile paths stay `tiles/{z}/{x}/{y}.terrain`.** The scheme is already
  implemented by the bake, the validator, and the loader spike; it is
  human-browsable in a workshop setting and matches common tile
  conventions. A quadkey's compactness buys nothing at pack scale.
- **Registry-lite is adopted instead of deferral:** IDs 5 (bottom-type)
  and 6 (confidence) are listed in SPEC §4 with their payload layouts, and
  new extension IDs are claimed by adding them to that table before use.
  Decoders already MUST skip unknown IDs by length (Amendment 5), so the
  table is documentation, not a gate.
