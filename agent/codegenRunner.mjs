// Codegen test runs and heals, started from the script editor.
//   run:  writes the generated project (POM or plain) into one persistent Playwright project and
//         runs it, streaming the console and each action's result to the database.
//   heal: gives a failed run to the QA Agent healer (session.mjs), which fixes the recorded code in
//         codegen style against the live site, then runs the fix. The user decides whether to apply it.
// Runs beside the QA Agent loop in worker.mjs, so a long agent run never makes a test run wait.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/lib/codegen/bundle.js';
import { parseCodegen } from '../src/lib/codegen/parse.js';
import { decryptSecret } from '../src/lib/secrets.js';
import { killTree, redact } from './processes.mjs';
import { installDependencies, ROOT, PLAYWRIGHT_TEST_VERSION } from './workspace.mjs';
import { runHealerSession } from './session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = path.join(ROOT, 'codegen-runner');
const REPORTER = path.join(here, 'codegenReporter.cjs');
const POLL_MS = 1_000;
const RUN_TIMEOUT_MS = Number(process.env.CODEGEN_RUN_TIMEOUT_MS) || 10 * 60_000;
const MAX_CONSOLE = 200_000;
// The recorded code is user content: tests get the site and test login, never the worker's secrets.
const HIDDEN_ENV = ['DATABASE_URL', 'DIRECT_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'GITHUB_TOKEN', 'SMTP_PASS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

const HEAL_RULES = `This test was recorded with Playwright codegen in AgentQA. AgentQA rebuilds page objects
from this file, so keep the codegen style:
- Every action or check is one \`await ...\` statement directly in the test body, in flow order.
- No test.step(), helper functions, loops, comments or new variables (the popup lines codegen writes are fine).
- Fix what fails: change a locator, or add a wait as its own line, e.g. \`await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();\`.
- Keep every existing expect() unless it checks something the page really doesn't show.
- JavaScript syntax only (no type annotations); \`process.env.E2E_PASSWORD!\` is fine.
- Navigate with relative paths: the config sets baseURL.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

async function claim(db, workerId) {
  const rows = await db.$queryRaw`
    UPDATE "CodegenRun"
    SET status = 'RUNNING', "workerId" = ${workerId}, hostname = ${os.hostname()}, "heartbeatAt" = NOW() AT TIME ZONE 'UTC'
    WHERE id = (
      SELECT id FROM "CodegenRun" WHERE status = 'QUEUED' AND "cancelRequested" = false
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

// One Playwright project reused by every run, so dependencies install once.
async function prepareRunner(log) {
  await fs.mkdir(RUNNER_DIR, { recursive: true });
  const pkg = path.join(RUNNER_DIR, 'package.json');
  if (!(await fs.access(pkg).then(() => true, () => false))) {
    await fs.writeFile(
      pkg,
      JSON.stringify({ name: 'agentqa-codegen-runner', private: true, devDependencies: { '@playwright/test': PLAYWRIGHT_TEST_VERSION, dotenv: '16.4.5' } }, null, 2)
    );
  }
  await installDependencies(RUNNER_DIR, log);
}

// Replaces the runner's tests and pages with the script's code. Returns the spec path.
async function writeProject(script, style) {
  for (const dir of ['tests', 'pages', 'test-results']) await fs.rm(path.join(RUNNER_DIR, dir), { recursive: true, force: true });
  const files = buildProject({ title: script.title, recording: script.recording, edits: script.edits ?? {} }, style);
  let specPath = null;
  for (const [full, content] of Object.entries(files)) {
    const rel = full.split('/').slice(1).join('/'); // drop the project folder name
    if (!/^(tests|pages)\/|^playwright\.config\.ts$/.test(rel)) continue;
    await fs.mkdir(path.dirname(path.join(RUNNER_DIR, rel)), { recursive: true });
    await fs.writeFile(path.join(RUNNER_DIR, rel), content);
    if (rel.startsWith('tests/')) specPath = rel;
  }
  return specPath;
}

// Console and results, written to the run every second; also where cancellation is noticed.
// `secret` (the test password) is masked in everything written.
const masker = (secret) => (text) => (secret && secret.length >= 3 && text ? text.split(secret).join('••••••') : text);

function liveRun(db, id, secret) {
  let consoleText = '';
  let results = null;
  let dirty = false;
  const mask = masker(secret);
  return {
    append(text) {
      consoleText += mask(text);
      if (consoleText.length > MAX_CONSOLE) consoleText = `…\n${consoleText.slice(-MAX_CONSOLE)}`;
      dirty = true;
    },
    setResults(next) {
      results = next;
      dirty = true;
    },
    get results() {
      return results;
    },
    async flush(extra = {}) {
      const data = { heartbeatAt: new Date(), ...extra };
      if (dirty) Object.assign(data, { console: consoleText }, results ? { results } : {});
      dirty = false;
      const row = await db.codegenRun.update({ where: { id }, data, select: { cancelRequested: true } });
      return row.cancelRequested;
    },
  };
}

const readResults = (file) => fs.readFile(file, 'utf8').then(JSON.parse, () => null);

// Runs the project's tests with the list reporter (console) and the Codegen reporter (results).
// Resolves 'passed' | 'failed' | 'error' | 'cancelled' | 'timeout'.
async function runTests({ live, env, headed, isCancelled }) {
  const resultsFile = path.join(RUNNER_DIR, '.agentqa', `results-${Date.now()}.json`);
  await fs.mkdir(path.dirname(resultsFile), { recursive: true });
  const args = ['playwright', 'test', `--reporter=list,${REPORTER}`, '--retries=0', '--workers=1', ...(headed ? ['--headed'] : [])];
  live.append(`$ npx ${args.join(' ').replace(REPORTER, 'agentqa-reporter')}\n\n`);

  const child = spawn('npx', args, {
    cwd: RUNNER_DIR,
    env: { ...env, AGENTQA_RESULTS: resultsFile, FORCE_COLOR: '0' },
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.stdout.on('data', (d) => live.append(d.toString()));
  child.stderr.on('data', (d) => live.append(d.toString()));
  const exited = new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (err) => {
      live.append(`\n${err.message}\n`);
      resolve(-1);
    });
  });

  const started = Date.now();
  let ending = null;
  while (child.exitCode === null && !ending) {
    const code = await Promise.race([exited, sleep(POLL_MS).then(() => undefined)]);
    if (code !== undefined) break;
    const results = await readResults(resultsFile);
    if (results) live.setResults(results);
    if (await isCancelled()) ending = 'cancelled';
    else if (Date.now() - started > RUN_TIMEOUT_MS) ending = 'timeout';
  }
  if (ending) await killTree(child);
  const exitCode = await exited;

  const results = await readResults(resultsFile);
  if (results) live.setResults(results);
  await fs.rm(resultsFile, { force: true });
  if (ending) {
    live.append(ending === 'timeout' ? `\nStopped: the run took longer than ${RUN_TIMEOUT_MS / 60_000} minutes.\n` : '\nCancelled.\n');
    return ending;
  }
  if (!results || results.tests.length === 0) return 'error';
  return results.status === 'passed' && exitCode === 0 ? 'passed' : 'failed';
}

// What the healer is told about the failed run: each failing test, its error and failing step.
function failuresOf(run) {
  return (run?.results?.tests ?? [])
    .filter((t) => !['passed', 'skipped'].includes(t.status))
    .map((t) => {
      const step = t.steps.find((s) => s.error);
      // A POM run fails inside pages/*.ts, which the healer never sees (it fixes the plain
      // recording), so name the failing step by its code, not its file.
      const where = step ? `\nFailed at: ${step.title}${step.code ? ` (\`${step.code}\`${step.folder === 'pages' ? ` in the page object ${step.file}` : ''})` : ''}` : '';
      return { title: t.title, status: t.status, error: `${t.error ?? 'Failed'}${where}`.slice(0, 4000) };
    });
}

async function heal({ db, run, script, env, credentials, live, isCancelled }) {
  const from = run.fromRunId ? await db.codegenRun.findUnique({ where: { id: run.fromRunId } }) : null;
  const failures = failuresOf(from);
  const specPath = await writeProject(script, 'plain');
  const current = await fs.readFile(path.join(RUNNER_DIR, specPath), 'utf8');

  const abortController = new AbortController();
  const watch = setInterval(async () => {
    if (await isCancelled().catch(() => false)) abortController.abort();
  }, POLL_MS * 2);

  let healed = null;
  let outcome;
  live.append(`Healing ${specPath} with the QA Agent healer…\n`);
  try {
    outcome = await runHealerSession({
      workspace: RUNNER_DIR,
      project: { name: script.title, appBaseUrl: origin(script.startUrl) },
      issue: { key: 'Recorded flow', summary: script.title, description: HEAL_RULES },
      specPath,
      testEnv: env,
      credentials,
      abortController,
      plan: { flow: `The recorded flow "${script.title}"`, steps: [], acceptanceCriteria: [] },
      draft: current,
      problem: from ? 'The test failed when it was run from AgentQA.' : 'Make the recorded test pass against the live site.',
      failures,
      ctx: {
        log: async (_tag, level, message) => live.append(`[healer${level === 'info' ? '' : ` ${level}`}] ${message}\n`),
        savePlan: async () => {},
        saveSpec: async (content) => {
          healed = content;
        },
        countTestRun: async () => {},
      },
    });
  } finally {
    clearInterval(watch);
  }
  if (abortController.signal.aborted) return { status: 'CANCELLED' };

  const summary = outcome.summary?.slice(0, 4000) ?? null;
  const extra = { healSummary: summary, costUsd: outcome.costUsd };
  if (!healed) return { status: 'FAILED', error: `The healer did not change the test. ${summary ?? ''}`.trim(), ...extra };
  const parsed = parseCodegen(healed);
  if (parsed.errors.length) return { status: 'FAILED', error: `The healed code can't be turned back into steps: ${parsed.errors[0]}`, ...extra };

  live.append('\nRunning the healed test to confirm it passes…\n');
  const outcomeOfRun = await runTests({ live, env, headed: run.headed, isCancelled });
  const status = { passed: 'PASSED', failed: 'FAILED', cancelled: 'CANCELLED' }[outcomeOfRun] ?? 'ERROR';
  return { status, healedSource: parsed.source, ...extra, error: status === 'PASSED' ? null : 'The healed test still fails. You can apply it anyway, or record the flow again.' };
}

async function execute(db, id, log) {
  const run = await db.codegenRun.findUnique({ where: { id }, include: { script: true } });
  const { script } = run;
  const credentials = { username: script.e2eUsername ?? '', password: decryptSecret(script.e2ePasswordEnc) ?? '' };
  const live = liveRun(db, id, credentials.password);
  const isCancelled = () => live.flush();
  const env = { ...process.env, BASE_URL: origin(script.startUrl), E2E_USERNAME: credentials.username, E2E_PASSWORD: credentials.password, CI: '1' };
  for (const name of HIDDEN_ENV) delete env[name];

  let final;
  try {
    await prepareRunner((message) => live.append(`${message}\n`));
    if (run.kind === 'heal') {
      final = await heal({ db, run, script, env, credentials, live, isCancelled });
    } else {
      await writeProject(script, run.style);
      const outcome = await runTests({ live, env, headed: run.headed, isCancelled });
      final = {
        status: { passed: 'PASSED', failed: 'FAILED', cancelled: 'CANCELLED' }[outcome] ?? 'ERROR',
        error: outcome === 'error' ? 'Playwright stopped before running the test. See the console.' : outcome === 'timeout' ? 'The run took too long and was stopped.' : null,
      };
    }
  } catch (err) {
    live.append(`\n${redact(err.message)}\n`);
    final = { status: 'ERROR', error: redact(err.message).slice(0, 2000) };
  }
  // The healer can see the test login; keep it out of what it wrote.
  const mask = masker(credentials.password);
  for (const field of ['healSummary', 'error']) if (final[field]) final[field] = mask(final[field]);
  await live.flush({ ...final, finishedAt: new Date() });
  log(`${run.kind} ${script.title}: ${final.status}`);
}

// Polls for runs until `isStopping()` is true. One run at a time per worker.
export async function codegenRunLoop({ db, workerId, isStopping }) {
  const log = (message) => console.log(`[codegen] ${message}`);
  log('Ready to run and heal Codegen tests');
  while (!isStopping()) {
    try {
      const id = await claim(db, workerId);
      if (id) await execute(db, id, log);
      else await sleep(POLL_MS * 2);
    } catch (err) {
      console.error('[codegen]', err.message);
      await sleep(POLL_MS * 5);
    }
  }
}
