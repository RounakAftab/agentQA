// "Draft with AI" for load tests, shared by the app (src/app/api/load-tests/draft) and the worker
// (agent/loadDraftRunner.mjs, which asks Claude through the Agent SDK). No "@/" imports, so the
// worker can load it directly. The draft only fills in the form: saving runs validateLoadTestInput.
import { z } from 'zod';

export const LOAD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
export const BUILTIN_VARS = ['username', 'password', 'vu', 'iter'];
export const MAX_PROMPT = 4000;

// Enums are described rather than enforced: a "get" or "Scenario" is normalized in toForm and
// anything else is caught by the usual validation, instead of failing the whole draft.
const METHOD_HINT = `One of ${LOAD_METHODS.join(', ')}`;
const Header = z.object({ name: z.string(), value: z.string() });
const Step = z.object({
  name: z.string().describe('Short step name, e.g. "Log in"'),
  method: z.string().describe(METHOD_HINT),
  path: z.string().describe('Path on the app, starting with "/". May use {{variables}}.'),
  headers: z.array(Header),
  body: z.string().nullable().describe('Request body for POST/PUT/PATCH/DELETE, else null'),
  expectStatus: z.number().int().nullable().describe('Expected HTTP status, or null for any 2xx/3xx'),
  extract: z
    .array(
      z.object({
        var: z.string().describe('Variable name, letters/digits/_'),
        source: z.string().describe('"json" or "header"'),
        path: z.string().describe('Dot path into the JSON body (e.g. "data.token", "items.0.id") or a response header name'),
      })
    )
    .describe('Values to save from the response for later steps'),
  thinkTimeSec: z.number().describe('Seconds the user pauses after this step, 0-60'),
  maxP95Ms: z.number().int().nullable().describe('Per-step p95 limit in ms, or null'),
});

export const DraftSchema = z.object({
  name: z.string().describe('Short name for the load test'),
  kind: z.string().describe('"request" or "scenario"'),
  method: z.string().describe(`${METHOD_HINT}. Single request only; GET for a scenario`),
  path: z.string().describe('Single request only: path on the app starting with "/"; "/" for a scenario'),
  headers: z.array(Header).describe('Single request: its headers. Scenario: headers sent with every step.'),
  body: z.string().nullable().describe('Single request only'),
  steps: z.array(Step).describe('Scenario only; empty for a single request'),
  vus: z.number().int().describe('Virtual users at full load'),
  rampUpSec: z.number().int(),
  durationSec: z.number().int().describe('Seconds at full load after the ramp-up, at least 10'),
  maxP95Ms: z.number().int().nullable().describe('Pass/fail limit for 95th percentile response time in ms, or null'),
  maxErrorRatePct: z.number().nullable().describe('Pass/fail limit for failed requests in percent, or null'),
  notes: z.array(z.string()).describe('Assumptions you made that the person should check, in plain words. Empty if none.'),
});

// The JSON Schema the Agent SDK's structured output takes.
export function draftJsonSchema() {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(DraftSchema);
  return schema;
}

export const DRAFT_SYSTEM_PROMPT = `You turn a QA engineer's description of a load test into a test definition for AgentQA, which runs it with k6. Answer only with the structured output; you have no tools.

How AgentQA load tests work:
- A test is either a "request" (one endpoint hit again and again) or a "scenario" (steps each virtual user runs in order, then starts over; at most 10 steps).
- Load always goes to the project's app. Paths are relative to it and start with "/". Never put a host in a path.
- Virtual users are added evenly over the ramp-up, then held for the duration at full load.
- Redirects are not followed. A step fails on a 4xx/5xx, on a status other than expectStatus when that is set, or when a value to save is missing; the rest of that pass is skipped.
- Steps can use {{variables}} in the path, headers and body: built-in {{vu}} (virtual user number) and {{iter}} (pass number), values saved by an earlier step's extract, and {{username}} / {{password}} for the project's test account when one is set up.
- In a JSON body, write variables inside string literals, e.g. {"email": "{{username}}"}.
- Think time is a realistic pause after a step (real people take 1-5 s between pages); use 0 only for raw API hammering.

Rules:
- Follow the numbers the person gives (users, ramp-up, duration, limits) exactly. When they give none, pick sensible defaults: 20 users, 30 s ramp-up, 60 s at full load, p95 under 1000 ms for pages or 500 ms for APIs, at most 1% failed.
- Convert units: "2 minutes" is 120 seconds, "1 s" is 1000 ms, "under 1%" is 1.
- You don't know this app's real API. Use the paths the person names; otherwise infer conventional ones and say so in notes, so they can correct them.
- Only use {{username}}/{{password}} when the project has a test account; if the flow needs a login and it has none, still draft it and say in notes that the test account must be set up.
- Keep notes short and concrete ("Assumed the login endpoint is POST /api/login returning {"token": ...}").`;

// The user message: what Claude knows about the project, then the person's description.
export function draftPrompt({ project, limits, knownPaths = [], prompt }) {
  const context = [
    `Project: ${project.name}`,
    project.description ? `About the project: ${project.description}` : null,
    `App link (all load goes here): ${project.appBaseUrl}`,
    `Test account for {{username}}/{{password}}: ${project.hasTestAccount ? 'set up' : 'not set up'}`,
    `Built-in variables: ${BUILTIN_VARS.map((v) => `{{${v}}}`).join(', ')}`,
    `Limits: ${limits.maxVus == null ? 'no cap on virtual users' : `at most ${limits.maxVus} virtual users`}; ramp-up plus duration at most ${limits.maxDurationSec} seconds.`,
    knownPaths.length ? `Paths already used in this project's load tests: ${knownPaths.join(', ')}` : null,
  ].filter(Boolean);
  return `${context.join('\n')}\n\nThe load test to create:\n${prompt}`;
}

// Claude's draft to what the load test form holds (strings, headers as "Name: value" lines; scenario
// steps keep header arrays, which the form's stepsToForm converts).
export function toForm(draft) {
  const text = (v) => (v == null ? '' : String(v));
  const scenario = String(draft.kind).trim().toLowerCase() === 'scenario';
  const method = (m) => String(m ?? 'GET').trim().toUpperCase();
  return {
    name: String(draft.name).slice(0, 120),
    kind: scenario ? 'scenario' : 'request',
    method: scenario ? 'GET' : method(draft.method),
    url: scenario ? '/' : draft.path || '/',
    body: scenario ? '' : text(draft.body),
    headers: draft.headers.map((h) => `${h.name}: ${h.value}`).join('\n'),
    vus: text(draft.vus),
    rampUpSec: text(draft.rampUpSec),
    durationSec: text(draft.durationSec),
    maxP95Ms: text(draft.maxP95Ms),
    maxErrorRatePct: text(draft.maxErrorRatePct),
    steps: scenario
      ? draft.steps.map((s) => ({
          ...s,
          method: method(s.method),
          body: s.body ?? null,
          thinkTimeSec: Math.min(60, Math.max(0, s.thinkTimeSec)),
          extract: s.extract.map((e) => ({ ...e, source: String(e.source).trim().toLowerCase() === 'header' ? 'header' : 'json' })),
        }))
      : [],
  };
}
