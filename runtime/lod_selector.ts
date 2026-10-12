// lod_selector_ref.ts — runtime LOD selector for the bathymetric terrain
// platform, implementing SPEC-v0.1 §5. Reference implementation by Muse
// after the MiniMax draft failed its own test suite (no exports, mesh clamp
// ignored the mode target, hysteresis conflated mode and clamp changes).
//
// Rules (SPEC §5):
// - Modes target contour intervals: freeFly 10 fm, boat 5, deck 2, auv 1.
// - Interval -> max geometric error (m): the interval in meters.
// - Mesh clamp (honesty, applies instantly, never hysteresis-delayed):
//   interval I is renderable only if meshError <= bound(I). Effective
//   interval = coarser of (mode target, finest interval the mesh supports).
//   If meshError exceeds even the 10 fm bound, render 10 fm and report
//   meshSufficient = false.
// - Hysteresis (anti-thrash, applies to MODE-driven changes only): a mode
//   transition takes effect only once altitude has left the current mode's
//   band by a 10% margin. Explicit setMode() bypasses hysteresis.

import { pathToFileURL } from "node:url";

export type CameraMode = "freeFly" | "boat" | "deck" | "auv";
export type CapabilityTier = "low" | "balanced" | "high";

export interface Selection {
  mode: CameraMode;
  intervalFm: number;
  maxGeometricErrorM: number;
  tileBudget: number;
  meshSufficient: boolean;
}

const TARGET_INTERVAL_FM: Record<CameraMode, number> = {
  freeFly: 10,
  boat: 5,
  deck: 2,
  auv: 1,
};

const INTERVAL_BOUND_M: Record<number, number> = {
  10: 18.288,
  5: 9.144,
  2: 3.6576,
  1: 1.8288,
};

const ALTITUDE_BANDS: Record<CameraMode, [number, number]> = {
  freeFly: [800, 6000],
  boat: [150, 800],
  deck: [30, 150],
  auv: [3, 30],
};

const TILE_BUDGETS: Record<CameraMode, Record<CapabilityTier, number>> = {
  freeFly: { low: 80, balanced: 200, high: 500 },
  boat: { low: 100, balanced: 300, high: 800 },
  deck: { low: 200, balanced: 500, high: 1500 },
  auv: { low: 300, balanced: 800, high: 3000 },
};

function bandMode(altitudeM: number): CameraMode {
  if (altitudeM >= 800) return "freeFly";
  if (altitudeM >= 150) return "boat";
  if (altitudeM >= 30) return "deck";
  return "auv";
}

/** Finest interval whose error bound the loaded mesh honestly supports. */
function finestSupportedInterval(meshErrorM: number): number {
  for (const fm of [1, 2, 5, 10]) {
    if (meshErrorM <= INTERVAL_BOUND_M[fm]) return fm;
  }
  return 10;
}

export class LodSelector {
  private capability: CapabilityTier;
  private explicitMode: CameraMode | null = null;
  private activeMode: CameraMode | null = null; // mode behind current target

  constructor(capability: CapabilityTier) {
    this.capability = capability;
  }

  setMode(mode: CameraMode): void {
    this.explicitMode = mode;
    this.activeMode = mode; // explicit user mode bypasses hysteresis
  }

  update(altitudeM: number, loadedMeshErrorM: number): Selection {
    const desiredMode = this.explicitMode ?? bandMode(altitudeM);

    if (this.activeMode === null) {
      this.activeMode = desiredMode;
    } else if (desiredMode !== this.activeMode && this.explicitMode === null) {
      // Hysteresis: switch modes only once altitude has cleared the
      // CURRENT mode's band by 10% on the relevant side.
      const [low, high] = ALTITUDE_BANDS[this.activeMode];
      if (altitudeM > high * 1.1 || altitudeM < low * 0.9) {
        this.activeMode = desiredMode;
      }
    } else {
      this.activeMode = desiredMode;
    }

    const mode = this.activeMode;
    const target = TARGET_INTERVAL_FM[mode];
    const supported = finestSupportedInterval(loadedMeshErrorM);
    const sufficient = loadedMeshErrorM <= INTERVAL_BOUND_M[10];
    // Coarser of target and mesh-supported wins; clamp applies instantly.
    const intervalFm = Math.max(target, supported);

    return {
      mode,
      intervalFm,
      maxGeometricErrorM: INTERVAL_BOUND_M[intervalFm],
      tileBudget: TILE_BUDGETS[mode][this.capability],
      meshSufficient: sufficient,
    };
  }
}

// ---------------------------------------------------------------- CLI tests
function runTests(): void {
  const fail = (name: string, got: unknown) => {
    console.log(`FAIL ${name}: ${JSON.stringify(got)}`);
    process.exit(1);
  };

  // 1. High overview on a fine mesh -> 10 fm, balanced freeFly budget.
  const s1 = new LodSelector("balanced");
  const r1 = s1.update(2000, 1.0);
  if (r1.intervalFm !== 10 || r1.tileBudget !== 200 || !r1.meshSufficient) fail("t1", r1);

  // 2. Descend to deck altitude: settles at 2 fm with no oscillation.
  const seen: number[] = [r1.intervalFm];
  for (let i = 0; i < 5; i++) seen.push(s1.update(100, 1.0).intervalFm);
  if (new Set(seen).size > 2 || seen[seen.length - 1] !== 2) fail("t2", seen);

  // 2b. Altitude hovering at the boat/freeFly boundary must not thrash.
  const s2 = new LodSelector("balanced");
  s2.update(2000, 1.0); // freeFly
  const hover: number[] = [];
  for (const alt of [790, 810, 795, 805, 790]) hover.push(s2.update(alt, 1.0).intervalFm);
  if (new Set(hover).size !== 1) fail("t2b-hover", hover);

  // 3. Mesh clamp: auv requested but mesh error 9.5 m -> finest honest
  //    interval is 10 fm (5 fm bound 9.144 < 9.5); error 25 m -> insufficient.
  const s3 = new LodSelector("low");
  s3.setMode("auv");
  const r3 = s3.update(10, 9.5);
  if (r3.intervalFm !== 10 || !r3.meshSufficient) fail("t3a", r3);
  const r3b = s3.update(10, 25.0);
  if (r3b.intervalFm !== 10 || r3b.meshSufficient) fail("t3b", r3b);

  // 4. Explicit boat mode, high tier -> 5 fm, budget 800.
  const s4 = new LodSelector("high");
  s4.setMode("boat");
  const r4 = s4.update(400, 0.5);
  if (r4.intervalFm !== 5 || r4.tileBudget !== 800) fail("t4", r4);

  console.log("LOD PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTests();
}
