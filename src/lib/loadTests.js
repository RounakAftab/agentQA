// Server-side shape and validation of k6 load tests (run by agent/loadRunner.mjs).
import { Prisma } from '@prisma/client';
import { encryptSecret } from '@/lib/secrets';
import { limitProblem, loadLimits, originOf, targetProblem } from '@/lib/loadLimits';

const iso = (d) => (d ? d.toISOString() : null);
const MAX_BODY = 64_000;
const MAX_HEADERS = 20;
const MAX_STEPS = 10;
const MAX_EXTRACTS = 5;

export const LOAD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Headers that would change where the load goes or how k6 sends it.
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);

// Values every scenario step can use as {{name}}: the project's test account, and k6's numbers for
// the virtual user and its pass through the flow.
export const BUILTIN_VARS = ['username', 'password', 'vu', 'iter'];
const VAR_NAME = /^[A-Za-z_]\w{0,39}$/;
export const templateVars = (text) => [...String(text ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

const projectSelect = { id: true, name: true, appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true };

export const loadTestInclude = {
  project: { select: projectSelect },
  createdBy: { select: { id: true, name: true } },
};

export function publicLoadTest(row) {
  return {
    id: row.id,
    name: row.name,
    project: row.project
      ? {
          id: row.project.id,
          name: row.project.name,
          appBaseUrl: row.project.appBaseUrl,
          // Whether {{username}} and {{password}} have values; the password itself never leaves the server.
          hasTestAccount: Boolean(row.project.e2eUsername && row.project.e2ePasswordEnc),
        }
      : null,
    kind: row.kind,
    steps: row.steps ?? [],
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
  kind: test.kind,
  steps: test.kind === 'scenario' ? test.steps : null,
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
  return { ...summary, samples: row.samples ?? [], stepStats: row.stepStats, console: row.console };
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

// Empty = null. Returns { value } or { error }.
function optionalInteger(raw, { min, max }, message) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null };
  const n = integer(text, { min, max });
  return n == null ? { error: message } : { value: n };
}

// Scenario steps from the form. Each step's path is appended to the project's app origin, so it must
// start with "/"; values put into it are URL-encoded by the k6 script, so they can't change the host.
// Every {{name}} must be a built-in value or one saved by an earlier step. Returns { steps } or { error }.
export function validateSteps(input, project) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Add at least one step' };
  if (input.length > MAX_STEPS) return { error: `A scenario can have at most ${MAX_STEPS} steps` };
  const known = new Set(BUILTIN_VARS);
  const names = new Set();
  const steps = [];
  for (const [i, raw] of input.entries()) {
    const name = String(raw?.name ?? '').trim().replace(/\s+/g, ' ') || `Step ${i + 1}`;
    const fail = (message) => ({ error: `Step ${i + 1} (${name}): ${message}` });
    if (name.length > 60) return fail('the name can be at most 60 characters');
    if (names.has(name.toLowerCase())) return fail('another step has the same name');
    names.add(name.toLowerCase());

    const method = String(raw?.method ?? 'GET').toUpperCase();
    if (!LOAD_METHODS.includes(method)) return fail('choose a method');
    const path = String(raw?.path ?? '').trim();
    if (!path.startsWith('/') || path.startsWith('//')) return fail('the path must start with a single "/", e.g. /api/login');
    if (path.length > 2000 || /\s/.test(path)) return fail('the path is too long or contains spaces');
    try {
      new URL(path.replace(/\{\{\s*\w+\s*\}\}/g, 'x'), project.appBaseUrl);
    } catch {
      return fail('the path is not a valid address');
    }

    const parsed = parseHeaders(Array.isArray(raw?.headers) ? raw.headers.map((h) => `${h.name}: ${h.value}`).join('\n') : raw?.headers);
    if (parsed.error) return fail(parsed.error);
    const body = BODY_METHODS.has(method) && raw?.body ? String(raw.body) : null;
    if (body && body.length > MAX_BODY) return fail('the body can be at most 64,000 characters');

    const used = [path, body, ...parsed.headers.map((h) => h.value)].flatMap(templateVars);
    const unknown = used.find((v) => !known.has(v));
    if (unknown) return fail(`{{${unknown}}} is not saved by an earlier step`);
    if (used.some((v) => v === 'username' || v === 'password') && !(project.e2eUsername && project.e2ePasswordEnc)) {
      return fail("{{username}} and {{password}} need the project's test account (Projects → Edit project → Test environment)");
    }

    const expect = optionalInteger(raw?.expectStatus, { min: 100, max: 599 }, 'the expected status must be a number from 100 to 599');
    if (expect.error) return fail(expect.error);
    const p95 = optionalInteger(raw?.maxP95Ms, { min: 1, max: 600_000 }, 'the p95 limit must be whole milliseconds');
    if (p95.error) return fail(p95.error);
    const think = Number(String(raw?.thinkTimeSec ?? '').trim() || 0);
    if (!(Number.isFinite(think) && think >= 0 && think <= 60)) return fail('think time must be from 0 to 60 seconds');

    const extract = [];
    for (const e of Array.isArray(raw?.extract) ? raw.extract : []) {
      const variable = String(e?.var ?? '').trim();
      const from = String(e?.path ?? '').trim();
      if (!variable && !from) continue;
      if (!VAR_NAME.test(variable)) return fail(`"${variable}" can't be a value name: use letters, digits and _`);
      if (BUILTIN_VARS.includes(variable)) return fail(`{{${variable}}} is built in; pick another name`);
      if (!from || from.length > 200) return fail(`say where {{${variable}}} comes from`);
      extract.push({ var: variable, source: e?.source === 'header' ? 'header' : 'json', path: from });
      known.add(variable);
    }
    if (extract.length > MAX_EXTRACTS) return fail(`a step can save at most ${MAX_EXTRACTS} values`);

    steps.push({ name, method, path, headers: parsed.headers, body, expectStatus: expect.value, extract, thinkTimeSec: think, maxP95Ms: p95.value });
  }
  return { steps };
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

  const kind = (input.kind ?? existing?.kind ?? 'request') === 'scenario' ? 'scenario' : 'request';
  if (has('kind')) values.kind = kind;

  if (kind === 'scenario') {
    if (!project.appBaseUrl) errors.steps = targetProblem('', null);
    else if (has('steps') || 'kind' in values) {
      const { steps, error } = validateSteps(input.steps ?? existing?.steps, project);
      if (error) errors.steps = error;
      else {
        // The first step stands for the scenario in lists; method and body belong to single requests.
        Object.assign(values, { steps, url: `${originOf(project.appBaseUrl)}${steps[0].path}`, method: steps[0].method, body: null });
      }
    }
  } else if ('kind' in values) {
    values.steps = Prisma.DbNull;
  }

  if (kind === 'request' && has('method')) {
    const method = String(input.method ?? 'GET').toUpperCase();
    if (!LOAD_METHODS.includes(method)) errors.method = 'Choose a method';
    else values.method = method;
  }

  if (kind === 'request' && has('url')) {
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
  if (kind === 'request' && (has('body') || 'method' in values)) {
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
