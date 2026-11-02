// The k6 script behind every AgentQA load test (agent/loadRunner.mjs). The steps and the load shape
// come from a JSON file the worker writes for each run, so nothing a user typed is ever code.
// A single-request test is a scenario of one step.
//
// Each virtual user runs the steps in order, again and again. {{name}} in a step's path, headers or
// body is replaced with a built-in value or one saved from an earlier response. A failed step ends that
// pass through the flow; the next pass starts from the first step.
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const config = JSON.parse(open(__ENV.AGENTQA_CONFIG));
const { origin, steps, headers: sharedHeaders, variables } = config;

export const options = config.options;

// Per-step numbers, named by position so any step name works: step_0_duration, step_0_failed, ...
const metrics = steps.map((_, i) => ({
  duration: new Trend(`step_${i}_duration`, true),
  failed: new Rate(`step_${i}_failed`),
  requests: new Counter(`step_${i}_requests`),
}));
// Time spent waiting on responses in one full pass through the flow (think time not included).
const flowDuration = new Trend('flow_duration', true);
const flowsCompleted = new Counter('flows_completed');
// A step with an expected status counts other statuses as failed in http_req_failed too.
const callbacks = steps.map((s) => (s.expectStatus ? http.expectedStatuses(s.expectStatus) : null));

const fill = (text, vars, encode) =>
  text == null ? text : String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (name in vars ? encode(String(vars[name])) : match));
const raw = (v) => v;
// Inside a JSON body, a value goes into a string literal: escape quotes and backslashes.
const jsonString = (v) => JSON.stringify(v).slice(1, -1);

const pick = (value, path) => path.split('.').reduce((v, key) => (v == null ? undefined : v[key]), value);

function headerValue(res, name) {
  const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? res.headers[key] : undefined;
}

function extractValues(step, res, vars) {
  for (const e of step.extract) {
    let value;
    if (e.source === 'header') value = headerValue(res, e.path);
    else {
      try {
        value = pick(res.json(), e.path);
      } catch {
        value = undefined;
      }
    }
    if (value == null || typeof value === 'object') return false;
    vars[e.var] = value;
  }
  return true;
}

export default function flow() {
  const vars = { ...variables, vu: __VU, iter: __ITER };
  let waited = 0;
  for (const [i, step] of steps.entries()) {
    const headers = {};
    for (const h of [...sharedHeaders, ...step.headers]) headers[h.name] = fill(h.value, vars, raw);
    const isJson = /^\s*[[{]/.test(step.body ?? '');
    const params = {
      headers,
      tags: { step: step.name },
      responseType: step.extract.some((e) => e.source === 'json') ? 'text' : 'none',
    };
    if (callbacks[i]) params.responseCallback = callbacks[i];
    const res = http.request(step.method, origin + fill(step.path, vars, encodeURIComponent), fill(step.body, vars, isJson ? jsonString : raw), params);

    const statusOk = step.expectStatus ? res.status === step.expectStatus : res.status > 0 && res.status < 400;
    const ok = statusOk && extractValues(step, res, vars);
    metrics[i].duration.add(res.timings.duration);
    metrics[i].failed.add(!ok);
    metrics[i].requests.add(1);
    waited += res.timings.duration;
    if (!ok) return;
    if (step.thinkTimeSec > 0) sleep(step.thinkTimeSec);
  }
  flowDuration.add(waited);
  flowsCompleted.add(1);
}

// The worker reads the end-of-test numbers from this file.
export function handleSummary(data) {
  return { [config.summaryPath]: JSON.stringify(data) };
}
