// "Run test" on a QA Agent run page: runs the run's saved spec and page objects again, without
// the AI, headless or with the browser visible on this computer.
// The files go on top of a fresh copy of the project's test repository (or blank project) in its
// own folder, so the repository's config, fixtures and helpers apply, and a QA Agent run working
// in the main folder is never disturbed. Runs beside the other loops in worker.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { decryptSecret } from '../src/lib/secrets.js';
import { redact } from './processes.mjs';
import { saveResult } from './dbRetry.mjs';
import { prepareWorkspace } from './workspace.mjs';
import { liveRun, masker, runTests } from './codegenRunner.mjs';

const POLL_MS = 1_000;
// The saved code is the project's: tests get the site and test login, never the worker's secrets.
const HIDDEN_ENV = ['DATABASE_URL', 'DIRECT_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'GITHUB_TOKEN', 'SMTP_PASS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claim(db, workerId) {
  const rows = await db.$queryRaw`
    UPDATE "AgentTestRun"
    SET status = 'RUNNING', "workerId" = ${workerId}, hostname = ${os.hostname()},
        "startedAt" = NOW() AT TIME ZONE 'UTC', "heartbeatAt" = NOW() AT TIME ZONE 'UTC'
    WHERE id = (
      SELECT id FROM "AgentTestRun" WHERE status = 'QUEUED' AND "cancelRequested" = false
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

// Writes `files` ({ repo-relative path: source }) into the workspace, refusing paths outside it.
async function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.resolve(dir, rel);
    if (!full.startsWith(dir + path.sep) || full.split(path.sep).includes('node_modules')) throw new Error(`Refusing to write ${rel}`);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
}

async function execute(db, id, log) {
  const testRun = await db.agentTestRun.findUnique({ where: { id }, include: { agentRun: { include: { project: true } } } });
  const { agentRun: run } = testRun;
  const { project } = run;
  const credentials = { username: project.e2eUsername ?? '', password: decryptSecret(project.e2ePasswordEnc) ?? '' };
  const live = liveRun(db.agentTestRun, id, credentials.password, 'test-run');
  const isCancelled = () => live.flush();
  const env = {
    ...process.env,
    BASE_URL: project.appBaseUrl,
    PLAYWRIGHT_BASE_URL: project.appBaseUrl,
    E2E_USERNAME: credentials.username,
    E2E_PASSWORD: credentials.password,
    CI: '1',
  };
  for (const name of HIDDEN_ENV) delete env[name];

  let final;
  try {
    if (!run.specPath || !run.specContent) throw new Error('This run has no saved test to run.');
    if (!project.appBaseUrl) throw new Error('The project has no app link to run the test against.');
    const { dir } = await prepareWorkspace(project, 'agentqa-test-run', (m) => live.append(`${m}\n`), { suffix: '-replay' });
    await writeFiles(dir, { ...(run.pageObjects ?? {}), [run.specPath]: run.specContent });
    live.append(`Running ${run.specPath} against ${project.appBaseUrl} ${testRun.headed ? `with the browser visible on ${os.hostname()}` : 'headless'}\n`);
    const outcome = await runTests({ live, env, headed: testRun.headed, isCancelled, cwd: dir, testArgs: [run.specPath] });
    final = {
      status: { passed: 'PASSED', failed: 'FAILED', cancelled: 'CANCELLED' }[outcome] ?? 'ERROR',
      error:
        outcome === 'error'
          ? 'Playwright stopped before running the test. See the console.'
          : outcome === 'timeout'
            ? 'The run took too long and was stopped.'
            : null,
    };
  } catch (err) {
    live.append(`\n${redact(err.message)}\n`);
    final = { status: 'ERROR', error: redact(err.message).slice(0, 2000) };
  }
  if (final.error) final.error = masker(credentials.password)(final.error);
  await saveResult(live.flush, final);
  log(`${run.issueKey} ${testRun.headed ? 'headed' : 'headless'}: ${final.status}`);
}

// Runs left RUNNING by a worker that stopped.
async function failStale(db) {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  await db.agentTestRun.updateMany({
    where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } },
    data: { status: 'ERROR', finishedAt: new Date(), error: 'The worker stopped responding during this run.' },
  });
}

// Polls for test runs until `isStopping()` is true. One at a time per worker.
export async function testRunLoop({ db, workerId, isStopping }) {
  const log = (message) => console.log(`[test-run] ${message}`);
  log('Ready to run saved QA Agent tests');
  while (!isStopping()) {
    try {
      await failStale(db);
      const id = await claim(db, workerId);
      if (id) await execute(db, id, log);
      else await sleep(POLL_MS * 2);
    } catch (err) {
      console.error('[test-run]', err.message);
      await sleep(POLL_MS * 5);
    }
  }
}
