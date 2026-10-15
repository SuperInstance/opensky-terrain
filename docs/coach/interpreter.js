// interpreter.js — the order interpreter: a coach's typed words
// become a closed-vocabulary order, or honestly don't (Coach
// Player synthesis: Claude's order interpreter, adopted whole —
// closed vocabulary, schema-checked, template echo; model prose
// never reaches the kid).
//
// Resolution order:
//   1. the PHRASE TABLE — control verbs, the clock dial, and the
//      registry's intentions under their names and synonyms.
//   2. a FUZZY pass over the same closed vocabulary (token
//      overlap) — still nothing outside the vocabulary can come
//      back, only a nearer or farther match inside it.
//   3. the LLM SEAM (below) — in this build it is a stub that
//      returns null. NOTHING a coach types leaves the device.
//
// Whatever the path, the result is a closed shape —
// { kind: 'intention' | 'control' | 'dial' | 'none', ... } — and
// a TEMPLATE: the order restated in the system's own words. The
// coach surface shows the template and applies the order only on
// confirmation. The raw typed text is never executed and never
// displayed back as an instruction.
//
// PRIVACY (open ruling #5): the design's interpreter sends typed
// text to a small LLM behind a consent/privacy review that has
// NOT happened. Until the owner rules, the seam stays shut and
// this module is fully local.
import { REGISTRY } from './registry.js?v=2026-10-14.9';

// Synonyms are authored per intention — the words a person
// actually uses for the registry's intentions.
const SYNONYMS = {
  'reach': ['jamestown bay', 'jamestown', 'the bay', 'go to the bay', 'head to the bay', 'make the bay'],
  'reach-home': ['go home', 'head home', 'bring her home', 'come home', 'home', 'the anchorage', 'western anchorage'],
  'work-shoal': ['work the shoal', 'the shoal', 'work the patch', 'the pale patch', 'shoal'],
  'hunt-pot': ['hunt the pot', 'find the pot', 'the pot', 'pot', 'marigold', 'pinger', 'lost pot'],
  'wreck-look': ['the wreck', 'look at the wreck', 'wreck', 'the cove', 'cove', 'film the wreck'],
  'detour': ['the cove mouth', 'detour', 'by the cove'],
  'hold-station': ['hold station', 'hold', 'wait', 'stay here', 'stay put', 'anchor'],
};

const CONTROLS = [
  { verb: 'stand-down', phrases: ['stop', 'halt', 'enough', 'my wheel', 'i have her', 'i\'ve got her'], template: 'Order read as: stop — you have the wheel; the coach stands by.' },
  { verb: 'resume', phrases: ['resume', 'carry on', 'you have her', 'your boat', 'continue', 'go on'], template: 'Order read as: resume — the coach takes the plan up again.' },
];

const DIALS = [
  { name: 'time', value: 1, phrases: ['slow down', 'take it easy', 'slow the clock', 'real time'], template: 'Order read as: slow the clock to 1× — real time.' },
  { name: 'time', value: 8, phrases: ['speed up', 'hurry', 'fast forward', 'speed the clock'], template: 'Order read as: speed the clock to 8×.' },
];

const norm = (t) => String(t || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (t) => new Set(norm(t).split(' ').filter(Boolean));

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
}

// The vocabulary, flattened: every phrase that can resolve, what
// it resolves to, and the registry entry behind it (if any).
function vocabulary() {
  const out = [];
  for (const c of CONTROLS) for (const phrase of c.phrases) out.push({ phrase, kind: 'control', verb: c.verb, template: c.template });
  for (const d of DIALS) for (const phrase of d.phrases) out.push({ phrase, kind: 'dial', name: d.name, value: d.value, template: d.template });
  for (const e of REGISTRY) {
    // the tile's name resolves to its first-claimed intention; each
    // synonym resolves to ITS intention only — a phrase must never
    // drift across a multi-intention tile's claims ("bring her
    // home" is reach-home, not whatever the tile claimed first)
    out.push({
      phrase: e.name, kind: 'intention', intention: e.intentions[0], tileId: e.tileId,
      template: `Order read as: ${e.name} — the “${e.intentions[0]}” leg.`,
    });
    for (const intention of e.intentions) {
      for (const phrase of SYNONYMS[intention] || []) {
        out.push({
          phrase, kind: 'intention', intention, tileId: e.tileId,
          template: `Order read as: ${e.name} — the “${intention}” leg.`,
        });
      }
    }
  }
  return out;
}

// THE LLM SEAM — deliberately shut in this build.
// A future implementation (only after the owner's privacy ruling)
// would send the typed order to a small model and MUST return the
// same closed shape this module returns (an intention / control /
// dial from the vocabulary above, schema-checked), or null. Its
// prose is never shown and never executed: the surface renders
// only the template built from the closed result. Returns null
// here, always — unmatched orders end at the honest 'none'.
export async function llmInterpret(/* text, vocab */) {
  return null;
}

// interpret(text, { planIntentions }) — planIntentions is the list
// of intentions the CURRENT plan carries; an order for an
// intention outside the plan resolves but is flagged inPlan:false
// (the surface can offer it as information; there is no leg to go
// to). hold-station is the exception: it applies through the
// overseer's hold even when no leg carries it (applicable:true).
export function interpret(text, { planIntentions = [] } = {}) {
  const vocab = vocabulary();
  const raw = norm(text);
  if (!raw) return { kind: 'none', via: 'empty', template: 'No order there — type what you want her to do.' };
  // 1. phrase table: longest matching phrase wins. Matching is
  // word-boundaried — a phrase must appear as whole words, or
  // "the pot" would match inside "the pott" and the fuzzy pass
  // would never get its turn.
  let best = null;
  const padded = ' ' + raw + ' ';
  for (const v of vocab) {
    if (padded.includes(' ' + v.phrase + ' ')) {
      if (!best || v.phrase.length > best.phrase.length) best = v;
    }
  }
  if (best) return finish(best, 'phrase', planIntentions);
  // 2. fuzzy pass over the same vocabulary
  const tt = tokens(raw);
  let bestScore = 0;
  for (const v of vocab) {
    const s = jaccard(tt, tokens(v.phrase));
    if (s > bestScore) { bestScore = s; best = v; }
  }
  if (best && bestScore >= 0.5) return finish(best, 'fuzzy', planIntentions);
  // 3. the seam is shut; say so in template words
  const known = REGISTRY.map(e => e.name).join(' · ');
  return {
    kind: 'none', via: 'none',
    template: `I don't have a move for “${String(text).trim()}” yet. The moves I know: ${known} — plus stop, resume, and the clock.`,
  };
}

function finish(v, via, planIntentions) {
  const out = { ...v, via };
  if (v.kind === 'intention') {
    out.inPlan = planIntentions.includes(v.intention);
    out.applicable = out.inPlan || v.intention === 'hold-station';
    if (!out.inPlan && v.intention !== 'hold-station') {
      out.template += ' This plan has no such leg, so there is nothing to send her to.';
    }
  }
  return out;
}
