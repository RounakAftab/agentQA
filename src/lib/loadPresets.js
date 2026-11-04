// Friendly starting points for load tests: what kind of test it is (a load shape) and how fast is
// fast enough (a p95 limit), plus a plain-language description of the load. They only fill the usual
// fields (vus, rampUpSec, durationSec, maxP95Ms, maxErrorRatePct), so nothing new is stored: a saved
// test shows the type its numbers match, or "Custom". No imports: the form, pages and tests load it.

// `shape(limits)` returns the numbers; long or heavy types shrink to fit LOAD_MAX_* limits.
export const TEST_TYPES = [
  {
    id: 'smoke',
    label: 'Quick check',
    hint: 'A couple of users for 30 s. Does it work at all?',
    when: 'Run this first, after any change to the test.',
    shape: () => ({ vus: 2, rampUpSec: 0, durationSec: 30, maxErrorRatePct: 0 }),
  },
  {
    id: 'load',
    label: 'Normal day',
    hint: 'Your usual number of users for 2 minutes',
    when: 'Set the users to how many you expect at a busy moment.',
    shape: () => ({ vus: 20, rampUpSec: 30, durationSec: 120, maxErrorRatePct: 1 }),
  },
  {
    id: 'stress',
    label: 'Find the limit',
    hint: 'Users climb slowly to far more than normal',
    when: 'Watch the response time chart: where it bends upward is the limit.',
    shape: () => ({ vus: 200, rampUpSec: 240, durationSec: 60, maxErrorRatePct: 5 }),
  },
  {
    id: 'spike',
    label: 'Sudden rush',
    hint: 'Lots of users arrive within seconds',
    when: 'Like a sale starting or a link going viral.',
    shape: () => ({ vus: 200, rampUpSec: 5, durationSec: 60, maxErrorRatePct: 5 }),
  },
  {
    id: 'soak',
    label: 'Long run',
    hint: 'Steady users for as long as allowed',
    when: 'Finds slow leaks: memory, connections, growing queues.',
    shape: (limits) => ({ vus: 20, rampUpSec: 30, durationSec: Math.max(10, (limits?.maxDurationSec ?? 600) - 30), maxErrorRatePct: 1 }),
  },
];

// The numbers of a test type, kept within the limits. Strings, as the form holds them.
export function testTypeValues(id, limits) {
  const type = TEST_TYPES.find((t) => t.id === id);
  if (!type) return null;
  const s = type.shape(limits);
  const maxVus = limits?.maxVus ?? null;
  const maxTotal = limits?.maxDurationSec ?? Infinity;
  const vus = maxVus != null ? Math.min(s.vus, maxVus) : s.vus;
  const rampUpSec = Math.min(s.rampUpSec, Math.max(0, maxTotal - s.durationSec));
  const durationSec = Math.max(10, Math.min(s.durationSec, maxTotal - rampUpSec));
  return { vus: String(vus), rampUpSec: String(rampUpSec), durationSec: String(durationSec), maxErrorRatePct: String(s.maxErrorRatePct) };
}

// The type whose load shape matches these numbers, or 'custom'. The error limit doesn't count: people
// often tighten it without changing the kind of test.
export function matchTestType(values, limits) {
  for (const type of TEST_TYPES) {
    const t = testTypeValues(type.id, limits);
    if (['vus', 'rampUpSec', 'durationSec'].every((k) => String(values?.[k] ?? '').trim() === t[k])) return type.id;
  }
  return 'custom';
}

export const testTypeLabel = (id) => TEST_TYPES.find((t) => t.id === id)?.label ?? 'Custom';

// How fast is fast enough: the p95 limit, in words.
export const SPEED_PRESETS = [
  { id: 'fast', label: 'Fast', ms: 500, hint: 'APIs and search' },
  { id: 'ok', label: 'OK', ms: 1000, hint: 'Most pages' },
  { id: 'relaxed', label: 'Relaxed', ms: 2000, hint: 'Reports, uploads, heavy pages' },
];

export function speedPresetFor(maxP95Ms) {
  const text = String(maxP95Ms ?? '').trim();
  if (!text) return 'off';
  return SPEED_PRESETS.find((p) => String(p.ms) === text)?.id ?? 'custom';
}

// "2 min 30 s", "45 s", "10 min"
export function duration(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

const users = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'user' : 'users'}`;
const ASSUMED_RESPONSE_SEC = 0.2;

function roughly(n) {
  if (n < 100) return String(Math.max(1, Math.round(n)));
  const digits = 10 ** (Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / digits) * digits).toLocaleString('en-US');
}

// What the numbers mean, in words, with a rough request count:
//   { text: "Users go from 0 to 200 over 30 s, then all 200 keep going for 2 min (2 min 30 s in total).",
//     estimate: "About 48,000 requests if responses take ~200 ms.", warning }
// Returns null while the numbers are incomplete. `steps` (scenario) gives think times.
export function describeLoad({ vus, rampUpSec, durationSec, kind = 'request', steps = [] }) {
  const v = Number(vus);
  const ramp = Number(String(rampUpSec ?? '').trim() || 0);
  const hold = Number(durationSec);
  if (!(Number.isInteger(v) && v >= 1 && Number.isFinite(ramp) && ramp >= 0 && Number.isFinite(hold) && hold > 0)) return null;

  const text = ramp > 0
    ? `Users go from 0 to ${v.toLocaleString('en-US')} over ${duration(ramp)}, then all ${users(v)} keep going for ${duration(hold)} (${duration(ramp + hold)} in total).`
    : `${users(v)} start at once and keep going for ${duration(hold)}.`;

  // Each user repeats the request (or the flow) back to back: one pass is every step's response
  // time plus its think time. Average users over the ramp are half the target.
  const scenario = kind === 'scenario' && steps.length > 0;
  const stepCount = scenario ? steps.length : 1;
  const think = scenario ? steps.reduce((sum, s) => sum + (Number(s.thinkTimeSec) || 0), 0) : 0;
  const passSec = stepCount * ASSUMED_RESPONSE_SEC + think;
  const userSeconds = (v * ramp) / 2 + v * hold;
  const total = (userSeconds / passSec) * stepCount;
  const perSecond = (v / passSec) * stepCount;
  const estimate = `About ${roughly(total)} requests, ${roughly(perSecond)} a second at full load, if responses take ~${ASSUMED_RESPONSE_SEC * 1000} ms.`;

  const warning =
    !scenario && v >= 50
      ? `No pauses between requests: each user sends about ${Math.round(1 / ASSUMED_RESPONSE_SEC)} a second, so ${users(v)} hit much harder than ${v} real people. Use a scenario with think time to act like real users.`
      : null;
  return { text, estimate, warning };
}
