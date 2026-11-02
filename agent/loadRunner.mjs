// k6 load test runs, started from the Load Tests page. Runs beside the QA Agent and Codegen loops in
// worker.mjs, one load test at a time per worker.
//   Before each run the target and load are checked again against this worker's own limits
//   (src/lib/loadLimits.js), so a changed project link or a raised app limit can't widen them.
//   While k6 runs, its REST API is polled for live numbers; at the end, k6's summary is saved.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decryptSecret } from '../src/lib/secrets.js';
import { limitProblem, loadLimits, originOf, targetProblem } from '../src/lib/loadLimits.js';
import { killTree, redact, run as runCommand } from './processes.mjs';
import { outageTracker, saveResult } from './dbRetry.mjs';
import { ROOT } from './workspace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'loadScript.k6.js');
const RUNS_DIR = path.join(ROOT, 'load-runs');
const K6 = process.env.K6_PATH || 'k6';
const POLL_MS = 2_000;
const MAX_CONSOLE = 100_000;
const MAX_SAMPLES = 400;
// After a stop request k6 finishes in-flight requests and writes its summary; then it is killed.
const STOP_GRACE_MS = 30_000;
const HIDDEN_ENV = ['DATABASE_URL', 'DIRECT_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'GITHUB_TOKEN', 'SMTP_PASS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const INSTALL_HINT =
  'k6 is not installed on the worker computer. Install it (Windows: winget install k6 --source winget; macOS: brew install k6; ' +
  'Linux: https://grafana.com/docs/k6/latest/set-up/install-k6/) or set K6_PATH, then restart the worker.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, digits = 1) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(digits)));

async function claim(db, workerId) {
  const rows = await db.$queryRaw`
    UPDATE "LoadRun"
    SET status = 'RUNNING', "workerId" = ${workerId}, hostname = ${os.hostname()},
        "startedAt" = NOW() AT TIME ZONE 'UTC', "heartbeatAt" = NOW() AT TIME ZONE 'UTC'
    WHERE id = (
      SELECT id FROM "LoadRun" WHERE status = 'QUEUED' AND "cancelRequested" = false
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

// Console and samples, written to the run every poll; also where a stop request is noticed.
function liveRun(db, id) {
  let consoleText = '';
  const samples = [];
  let stepStats = null;
  let dirty = false;
  const outage = outageTracker('load');
  return {
    append(text) {
      consoleText += text;
      if (consoleText.length > MAX_CONSOLE) consoleText = `…\n${consoleText.slice(-MAX_CONSOLE)}`;
      dirty = true;
    },
    addSample(point) {
      samples.push(point);
      dirty = true;
    },
    setStepStats(stats) {
      stepStats = stats;
      dirty = true;
    },
    // Resolves true when the run should stop (a user asked, or the test was deleted), false to go
    // on, or null when the database could not be reached: what was not written is kept for the next
    // flush. Throws once the database has been unreachable for a minute (see dbRetry.mjs).
    async flush(extra = {}) {
      const data = { heartbeatAt: new Date(), ...extra };
      const wasDirty = dirty;
      if (dirty) Object.assign(data, { console: consoleText, samples }, stepStats ? { stepStats } : {});
      dirty = false;
      try {
        const row = await db.loadRun.update({ where: { id }, data, select: { cancelRequested: true } });
        outage.ok();
        return row.cancelRequested;
      } catch (err) {
        if (err.code === 'P2025') return true;
        dirty ||= wasDirty;
        outage.failed(err);
        return null;
      }
    },
  };
}

// The steps the k6 script runs. A single request is a scenario of one step.
function stepsOf(config, test) {
  if (config.kind === 'scenario') return config.steps;
  const origin = originOf(config.url);
  return [{ name: 'Request', method: config.method, path: config.url.slice(origin.length) || '/', headers: [], body: test.body ?? null, expectStatus: null, extract: [], thinkTimeSec: 0, maxP95Ms: null }];
}

function k6Options(config, steps) {
  const thresholds = {};
  if (config.maxP95Ms != null) thresholds.http_req_duration = [`p(95)<${config.maxP95Ms}`];
  if (config.maxErrorRatePct != null) thresholds.http_req_failed = [`rate<=${config.maxErrorRatePct / 100}`];
  steps.forEach((step, i) => {
    if (step.maxP95Ms != null) thresholds[`step_${i}_duration`] = [`p(95)<${step.maxP95Ms}`];
  });
  return {
    scenarios: {
      load: {
        executor: 'ramping-vus',
        startVUs: config.rampUpSec ? 0 : config.vus,
        stages: [
          ...(config.rampUpSec ? [{ duration: `${config.rampUpSec}s`, target: config.vus }] : []),
          { duration: `${config.durationSec}s`, target: config.vus },
        ],
        gracefulRampDown: '10s',
        gracefulStop: '10s',
      },
    },
    thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    // A redirect could lead off the project's app, so none are followed: a 3xx counts as a response.
    maxRedirects: 0,
    discardResponseBodies: true,
    userAgent: 'AgentQA-LoadTest (k6)',
  };
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// k6's running totals: { metricId: sample }, or null while its API is not up yet.
async function readMetrics(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return null;
    const { data } = await res.json();
    return Object.fromEntries(data.map((m) => [m.id, m.attributes.sample]));
  } catch {
    return null;
  }
}

// Asks k6 to end the test early. It still writes the summary for the time so far.
const stopK6 = (port) =>
  fetch(`http://127.0.0.1:${port}/v1/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { type: 'status', id: 'default', attributes: { stopped: true } } }),
    signal: AbortSignal.timeout(3_000),
  }).catch(() => null);

// Turns k6's running totals into one point per interval. Requests per second, average response time
// and error rate cover the interval since the last point; k6 only reports p95 for the run so far.
function sampler(started) {
  let prev = null;
  return (m) => {
    const count = m.http_reqs?.count ?? 0;
    const avg = m.http_req_duration?.avg ?? 0;
    const failRate = m['http_req_failed']?.rate ?? 0;
    const at = Date.now();
    let point = null;
    if (prev) {
      const n = count - prev.count;
      point = {
        t: Math.round((at - started) / 1000),
        vus: m.vus?.value ?? 0,
        rps: round(n / ((at - prev.at) / 1000)),
        avgMs: n > 0 ? round(Math.max(0, (avg * count - prev.avg * prev.count) / n)) : null,
        p95Ms: round(m.http_req_duration?.['p(95)']),
        errorPct: n > 0 ? round(Math.min(100, Math.max(0, ((failRate * count - prev.failRate * prev.count) / n) * 100)), 2) : null,
      };
    }
    prev = { count, avg, failRate, at };
    return point;
  };
}

// Each step's numbers so far, from k6's running totals (live) or its summary (at the end).
function stepNumbers(steps, read) {
  return steps.map((step, i) => {
    const duration = read(`step_${i}_duration`) ?? {};
    const failed = read(`step_${i}_failed`) ?? {};
    return {
      name: step.name,
      requests: read(`step_${i}_requests`)?.count ?? 0,
      avgMs: round(duration.avg),
      p95Ms: round(duration['p(95)']),
      failedPct: failed.rate == null ? null : round(failed.rate * 100, 2),
      maxP95Ms: step.maxP95Ms ?? null,
    };
  });
}

// The numbers the dashboard keeps from k6's end-of-test summary.
function summarize(data, steps) {
  const m = data.metrics ?? {};
  const duration = m.http_req_duration?.values ?? {};
  const failed = m.http_req_failed?.values ?? {};
  const flow = m.flow_duration?.values ?? {};
  return {
    steps: stepNumbers(steps, (id) => m[id]?.values),
    flows: { completed: m.flows_completed?.values?.count ?? 0, avgMs: round(flow.avg), p95Ms: round(flow['p(95)']) },
    requests: m.http_reqs?.values?.count ?? 0,
    rps: round(m.http_reqs?.values?.rate ?? 0),
    failedRequests: failed.passes ?? 0,
    errorPct: round((failed.rate ?? 0) * 100, 2),
    avgMs: round(duration.avg),
    medMs: round(duration.med),
    p90Ms: round(duration['p(90)']),
    p95Ms: round(duration['p(95)']),
    p99Ms: round(duration['p(99)']),
    maxMs: round(duration.max),
    maxVus: m.vus_max?.values?.max ?? null,
    durationMs: Math.round(data.state?.testRunDurationMs ?? 0),
    thresholds: Object.entries(m).flatMap(([metric, v]) =>
      Object.entries(v.thresholds ?? {}).map(([rule, result]) => ({ metric, rule, ok: Boolean(result.ok) }))
    ),
  };
}

function crossedLimits(summary, config) {
  const crossed = [];
  if (config.maxP95Ms != null && summary.p95Ms >= config.maxP95Ms) crossed.push(`p95 response time was ${Math.round(summary.p95Ms)} ms (limit ${config.maxP95Ms} ms)`);
  if (config.maxErrorRatePct != null && summary.errorPct > config.maxErrorRatePct) crossed.push(`${summary.errorPct}% of requests failed (limit ${config.maxErrorRatePct}%)`);
  for (const step of summary.steps) {
    if (step.maxP95Ms != null && step.p95Ms >= step.maxP95Ms) crossed.push(`"${step.name}" p95 was ${Math.round(step.p95Ms)} ms (limit ${step.maxP95Ms} ms)`);
  }
  return crossed;
}

const readSummary = (file, steps) => fs.readFile(file, 'utf8').then((text) => summarize(JSON.parse(text), steps), () => null);

async function runK6({ live, config, test, dir }) {
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  const summaryPath = path.join(dir, 'summary.json');
  const steps = stepsOf(config, test);
  const headers = JSON.parse(decryptSecret(test.headersEnc) ?? '[]');
  // The project's test account, for {{username}} and {{password}} in scenario steps.
  const variables = config.kind === 'scenario' ? { username: test.project.e2eUsername ?? '', password: decryptSecret(test.project.e2ePasswordEnc) ?? '' } : {};
  await fs.writeFile(configPath, JSON.stringify({ origin: originOf(config.url), steps, headers, variables, options: k6Options(config, steps), summaryPath }));

  const port = await freePort();
  const env = { ...process.env, AGENTQA_CONFIG: configPath, K6_NO_USAGE_REPORT: 'true' };
  for (const name of HIDDEN_ENV) delete env[name];
  const target =
    config.kind === 'scenario'
      ? steps.map((step, i) => `  ${i + 1}. ${step.name}: ${step.method} ${step.path}`).join('\n')
      : `  ${config.method} ${config.url}`;
  live.append(
    `$ k6 run: ${config.vus} virtual users, ${config.rampUpSec}s ramp-up + ${config.durationSec}s at full load\n` +
      `${target}${config.headerNames?.length ? `\n  Headers${config.kind === 'scenario' ? ' for every step' : ''}: ${config.headerNames.join(', ')}` : ''}\n\n`
  );

  const child = spawn(K6, ['run', '--address', `127.0.0.1:${port}`, '--no-color', SCRIPT], { env, windowsHide: true });
  child.stdout.on('data', (d) => live.append(d.toString()));
  child.stderr.on('data', (d) => live.append(d.toString()));
  const exited = new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? -1));
    child.on('error', (err) => {
      live.append(`\n${err.message}\n`);
      resolve(-1);
    });
  });

  const started = Date.now();
  // Ramp-up, full load and k6's graceful stops, with room to spare.
  const limitMs = (config.rampUpSec + config.durationSec + 60) * 1000;
  const sampleEvery = Math.max(POLL_MS, Math.ceil(((config.rampUpSec + config.durationSec) * 1000) / MAX_SAMPLES));
  const sample = sampler(started);
  let lastSampleAt = 0;
  let ending = null;
  let stopAskedAt = 0;
  let exitCode;
  try {
    for (;;) {
      exitCode = await Promise.race([exited, sleep(POLL_MS).then(() => undefined)]);
      if (exitCode !== undefined) break;
      if (Date.now() - lastSampleAt >= sampleEvery) {
        const metrics = await readMetrics(port);
        if (metrics) {
          const point = sample(metrics);
          if (point) live.addSample(point);
          if (config.kind === 'scenario') live.setStepStats(stepNumbers(steps, (id) => metrics[id]));
          lastSampleAt = Date.now();
        }
      }
      const stopRequested = await live.flush();
      if (!ending && (stopRequested || Date.now() - started > limitMs)) {
        ending = stopRequested ? 'cancelled' : 'timeout';
        stopAskedAt = Date.now();
        live.append(ending === 'cancelled' ? '\nStopping at a user’s request…\n' : '\nk6 ran longer than planned; stopping it…\n');
        await stopK6(port);
      } else if (ending && Date.now() - stopAskedAt > STOP_GRACE_MS) {
        await killTree(child);
      }
    }
  } finally {
    // Never leave k6 sending load when this loop ends early (e.g. the database is gone).
    if (child.exitCode === null) await killTree(child);
  }

  const summary = await readSummary(summaryPath, steps);
  if (ending === 'cancelled') return { status: 'CANCELLED', summary, error: 'Stopped before the end. The numbers cover the time until then.' };
  if (ending === 'timeout') return { status: 'ERROR', summary, error: 'k6 ran longer than planned and was stopped.' };
  if (exitCode === 0 && summary) return { status: 'PASSED', summary, error: null };
  // 99: a pass/fail limit was crossed.
  if (exitCode === 99 && summary) {
    const crossed = crossedLimits(summary, config);
    return { status: 'FAILED', summary, error: crossed.length ? `Limit crossed: ${crossed.join('; ')}.` : 'A pass/fail limit was crossed.' };
  }
  return { status: 'ERROR', summary, error: `k6 stopped with an error (exit ${exitCode}). See the console.` };
}

async function execute(db, id, log) {
  const run = await db.loadRun.findUnique({ where: { id }, include: { test: { include: { project: { select: { appBaseUrl: true, e2eUsername: true, e2ePasswordEnc: true } } } } } });
  const { test, config } = run;
  const live = liveRun(db, id);
  const dir = path.join(RUNS_DIR, id);

  let final;
  try {
    const problem = targetProblem(config.url, test.project.appBaseUrl) ?? limitProblem(config, loadLimits());
    if (problem) throw new Error(problem);
    const version = await runCommand(K6, ['version'], { timeoutMs: 15_000 });
    if (version.code !== 0) throw new Error(INSTALL_HINT);
    live.append(`${version.stdout.trim()}\n`);
    final = await runK6({ live, config, test, dir });
  } catch (err) {
    live.append(`\n${redact(err.message)}\n`);
    final = { status: 'ERROR', error: redact(err.message).slice(0, 2000) };
  } finally {
    // The config file holds the decrypted headers.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  await saveResult(live.flush, final);
  log(`${test.name}: ${final.status}`);
}

// Polls for load runs until `isStopping()` is true.
export async function loadRunLoop({ db, workerId, isStopping }) {
  const log = (message) => console.log(`[load] ${message}`);
  log('Ready to run k6 load tests');
  while (!isStopping()) {
    try {
      const id = await claim(db, workerId);
      if (id) await execute(db, id, log);
      else await sleep(POLL_MS * 2);
    } catch (err) {
      console.error('[load]', err.message);
      await sleep(POLL_MS * 5);
    }
  }
}
