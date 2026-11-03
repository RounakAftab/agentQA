// Safety limits for load tests, shared by the app (when a test is saved or started) and the worker
// (before every run, with its own environment). No imports, so the worker can load it directly.

const positive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

// LOAD_MAX_VUS: virtual users at full load; unset means no cap, so people can test with as many
// users as their worker can drive. LOAD_MAX_DURATION_SEC: ramp-up plus time at full load.
export function loadLimits(env = process.env) {
  return {
    maxVus: positive(env.LOAD_MAX_VUS, null),
    maxDurationSec: positive(env.LOAD_MAX_DURATION_SEC, 600),
  };
}

export const originOf = (url) => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
};

// Load is only ever sent to the project's own Test environment: same scheme, host and port.
export function targetProblem(url, appBaseUrl) {
  const allowed = originOf(appBaseUrl ?? '');
  if (!allowed) return "Set the project's app link (Projects → Edit project → Test environment) before load testing it.";
  if (originOf(url) !== allowed) return `Load tests can only target the project's app at ${allowed}.`;
  return null;
}

// Why `config` is over the limits, or null.
export function limitProblem(config, limits) {
  if (limits.maxVus != null && config.vus > limits.maxVus) return `At most ${limits.maxVus} virtual users are allowed (LOAD_MAX_VUS).`;
  if (config.rampUpSec + config.durationSec > limits.maxDurationSec) {
    return `Ramp-up plus duration can be at most ${limits.maxDurationSec} seconds (LOAD_MAX_DURATION_SEC).`;
  }
  return null;
}
