// Server-side shape and validation of k6 load tests (run by agent/loadRunner.mjs).
import { encryptSecret } from '@/lib/secrets';
import { limitProblem, loadLimits, targetProblem } from '@/lib/loadLimits';

const iso = (d) => (d ? d.toISOString() : null);
const MAX_BODY = 64_000;
const MAX_HEADERS = 20;

export const LOAD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Headers that would change where the load goes or how k6 sends it.
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);

export const loadTestInclude = {
  project: { select: { id: true, name: true, appBaseUrl: true } },
  createdBy: { select: { id: true, name: true } },
};

export function publicLoadTest(row) {
  return {
    id: row.id,
    name: row.name,
    project: row.project ? { id: row.project.id, name: row.project.name, appBaseUrl: row.project.appBaseUrl } : null,
    method: row.method,
    url: row.url,
    body: row.body ?? '',
    // Header values can be tokens: the browser only learns the names.
    headerNames: row.headerNames,
    vus: row.vus,
    rampUpSec: row.rampUpSec,
    durationSec: row.durationSec,
    maxP95Ms: row.maxP95Ms,
    maxErrorRatePct: row.maxErrorRatePct,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// What a run records about its test when queued, so history shows what was actually run.
export const runConfig = (test) => ({
  method: test.method,
  url: test.url,
  vus: test.vus,
  rampUpSec: test.rampUpSec,
  durationSec: test.durationSec,
  maxP95Ms: test.maxP95Ms,
  maxErrorRatePct: test.maxErrorRatePct,
  headerNames: test.headerNames,
});

export const ACTIVE_LOAD_RUN = ['QUEUED', 'RUNNING'];

export function publicLoadRun(row, { full = false } = {}) {
  const summary = {
    id: row.id,
    status: row.status,
    config: row.config,
    summary: row.summary,
    error: row.error,
    cancelRequested: row.cancelRequested,
    hostname: row.hostname,
    createdAt: iso(row.createdAt),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
  if (!full) return summary;
  return { ...summary, samples: row.samples ?? [], console: row.console };
}

// "Name: value" per line. Returns { headers, error }.
function parseHeaders(text) {
  const headers = [];
  for (const [i, raw] of String(text ?? '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(':');
    const name = at > 0 ? line.slice(0, at).trim() : '';
    const value = at > 0 ? line.slice(at + 1).trim() : '';
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name)) return { error: `Line ${i + 1}: write each header as "Name: value"` };
    if (BLOCKED_HEADERS.has(name.toLowerCase())) return { error: `The ${name} header can't be set` };
    if (value.length > 4000) return { error: `The ${name} header is too long` };
    headers.push({ name, value });
  }
  if (headers.length > MAX_HEADERS) return { error: `At most ${MAX_HEADERS} headers` };
  return { headers };
}

function integer(value, { min, max }) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// Create (with `project`) or change a load test. `existing` is the saved row when editing.
// Returns { values, errors }.
export function validateLoadTestInput(input, { project, existing = null }) {
  const errors = {};
  const values = {};
  const has = (key) => !existing || key in input;
  const limits = loadLimits();

  if (has('name')) {
    const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) errors.name = 'Give the load test a name';
    else if (name.length > 120) errors.name = 'Name must be 120 characters or fewer';
    else values.name = name;
  }

  if (has('method')) {
    const method = String(input.method ?? 'GET').toUpperCase();
    if (!LOAD_METHODS.includes(method)) errors.method = 'Choose a method';
    else values.method = method;
  }

  if (has('url')) {
    // A path like "/api/health" is taken relative to the project's app.
    const raw = String(input.url ?? '').trim();
    let url = null;
    try {
      url = new URL(raw, project.appBaseUrl || undefined).toString();
    } catch {
      /* reported below */
    }
    const problem = url ? targetProblem(url, project.appBaseUrl) : null;
    if (!project.appBaseUrl) errors.url = targetProblem('', null);
    else if (!url) errors.url = 'Enter a path like /api/health, or the full address';
    else if (problem) errors.url = problem;
    else if (url.length > 2000) errors.url = 'The address is too long';
    else values.url = url;
  }

  const method = values.method ?? existing?.method ?? 'GET';
  if (has('body') || 'method' in values) {
    const body = String(input.body ?? existing?.body ?? '');
    if (body.length > MAX_BODY) errors.body = 'The body can be at most 64,000 characters';
    else values.body = BODY_METHODS.has(method) && body ? body : null;
  }

  // Blank keeps the saved headers when editing; `clearHeaders` removes them.
  if (input.clearHeaders) {
    values.headersEnc = null;
    values.headerNames = [];
  } else if (String(input.headers ?? '').trim()) {
    const { headers, error } = parseHeaders(input.headers);
    if (error) errors.headers = error;
    else {
      values.headersEnc = headers.length ? encryptSecret(JSON.stringify(headers)) : null;
      values.headerNames = headers.map((h) => h.name);
    }
  }

  for (const [key, label, min] of [
    ['vus', 'Virtual users', 1],
    ['rampUpSec', 'Ramp-up', 0],
    ['durationSec', 'Duration', 10],
  ]) {
    if (!has(key)) continue;
    const n = integer(input[key], { min, max: key === 'vus' ? limits.maxVus : limits.maxDurationSec });
    if (n == null) errors[key] = `${label} must be a whole number from ${min} to ${key === 'vus' ? limits.maxVus : limits.maxDurationSec}`;
    else values[key] = n;
  }
  const shape = {
    vus: values.vus ?? existing?.vus ?? 1,
    rampUpSec: values.rampUpSec ?? existing?.rampUpSec ?? 0,
    durationSec: values.durationSec ?? existing?.durationSec ?? 10,
  };
  const overLimit = limitProblem(shape, limits);
  if (overLimit && !errors.vus && !errors.durationSec && !errors.rampUpSec) errors[shape.vus > limits.maxVus ? 'vus' : 'durationSec'] = overLimit;

  // Empty = not checked.
  if (has('maxP95Ms')) {
    const raw = String(input.maxP95Ms ?? '').trim();
    const n = raw ? integer(raw, { min: 1, max: 600_000 }) : null;
    if (raw && n == null) errors.maxP95Ms = 'Enter milliseconds as a whole number, or leave it empty';
    else values.maxP95Ms = n;
  }
  if (has('maxErrorRatePct')) {
    const raw = String(input.maxErrorRatePct ?? '').trim();
    const n = raw ? Number(raw) : null;
    if (raw && !(Number.isFinite(n) && n >= 0 && n <= 100)) errors.maxErrorRatePct = 'Enter a percentage from 0 to 100, or leave it empty';
    else values.maxErrorRatePct = n;
  }

  return { values, errors };
}
