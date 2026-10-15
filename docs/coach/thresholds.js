// thresholds.js — the overseer's operative numbers, as data.
//
// thresholds.json (beside this file) is the data of record: every
// number with its status (guess / swept / shaded / implemented) and
// its source. This module carries the built-in defaults the runtime
// falls back to when the JSON cannot be read (a failed fetch on the
// page, a missing file in a test) — they are the SAME values, and
// tools/m1-test.mjs asserts the two agree, so the fallback can never
// silently become a second set of books. Provenance for every value:
// coach-player docs/OVERSEER-NUMBERS.md.
export const DEFAULT_THRESHOLDS = {
  runFloor: 0.70,
  misfit: 0.30,
  holdRelookS: 2,
  misfitPauseS: 5,
  holdCountForceRun: 2,
  holdCountArmAuthor: 3,
  shadowPulsesCap: 3,
  corridorHarvestH: 0.9,
  knnK: 20,
  knnAlpha: 4,
  familiarMinNeighbours: 5,
  knnRadius: 0.35,
  counterfactualMaxReplays: 6,
  decisionsAlarmPerMin: 15,
  harvest: { SPAWN: 0.0, BAYC: 0.6, shoal: 2.4, pot: 1.8, WRECK: 0.0, cove: 0.0 },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Merge a parsed thresholds.json over the defaults. Only finite
// numbers are taken, and only for keys the defaults know — a corrupt
// or hand-edited file can retune the overseer but cannot invent new
// knobs or break its arithmetic.
export function resolveThresholds(json) {
  const T = { ...DEFAULT_THRESHOLDS, harvest: { ...DEFAULT_THRESHOLDS.harvest } };
  if (!json || typeof json !== 'object') return T;
  const nums = json.numbers && typeof json.numbers === 'object' ? json.numbers : {};
  for (const k of Object.keys(T)) {
    if (k === 'harvest') continue;
    const row = nums[k];
    if (row && isNum(row.value)) T[k] = row.value;
    else if (isNum(nums[k])) T[k] = nums[k];
    else if (isNum(json[k])) T[k] = json[k];
  }
  const harv = json.harvest && typeof json.harvest === 'object' ? json.harvest : {};
  for (const k of Object.keys(T.harvest)) {
    const row = harv[k];
    if (row && isNum(row.value)) T.harvest[k] = row.value;
    else if (isNum(harv[k])) T.harvest[k] = harv[k];
  }
  return T;
}

// The flat { key: value } view of a parsed thresholds.json — used by
// the parity test to compare the file against DEFAULT_THRESHOLDS.
export function flattenJsonThresholds(json) {
  const out = {};
  if (!json || typeof json !== 'object') return out;
  const nums = json.numbers && typeof json.numbers === 'object' ? json.numbers : {};
  for (const [k, row] of Object.entries(nums)) if (row && isNum(row.value)) out[k] = row.value;
  const harv = json.harvest && typeof json.harvest === 'object' ? json.harvest : {};
  for (const [k, row] of Object.entries(harv)) if (row && isNum(row.value)) out['harvest.' + k] = row.value;
  return out;
}

export function flattenDefaults() {
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_THRESHOLDS)) {
    if (k === 'harvest') for (const [hk, hv] of Object.entries(v)) out['harvest.' + hk] = hv;
    else out[k] = v;
  }
  return out;
}
