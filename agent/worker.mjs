// QA Agent worker. Claims queued runs from the database one at a time and executes them.
// Runs next to the app (it can't run on Vercel: it needs a browser and long-lived processes).
//
//   npm run agent:worker            keeps running and waits for runs
//   node agent/worker.mjs --once    works through the queue, then exits (the GitHub Actions runner)
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { runTicket, CancelledError } from './runTicket.mjs';
import { recordingLoop } from './recorder.mjs';
import { codegenRunLoop } from './codegenRunner.mjs';
import { redact } from './processes.mjs';

// A slow connection to a cloud database can take longer than Prisma's 10 s pool timeout.
function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || /[?&]pool_timeout=/.test(url)) return undefined;
  return `${url}${url.includes('?') ? '&' : '?'}pool_timeout=60`;
}

const db = new PrismaClient({ datasourceUrl: databaseUrl() });
const WORKER_ID = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
const POLL_MS = 3_000;
const HEARTBEAT_MS = 10_000;
const STALE_RUN_MS = 2 * 60_000;

// One-shot mode: started on demand for queued runs, so there is nothing to wait for.
const ONCE = process.argv.includes('--once');

let stopping = false;
let current = null; // { id, abortController }

function checkConfig() {
  const missing = [];
  if (!process.env.ENCRYPTION_KEY && !process.env.SESSION_SECRET) missing.push('ENCRYPTION_KEY or SESSION_SECRET (the same value as the app, to read saved Jira tokens)');
  // Without a key the Agent SDK falls back to the local `claude` CLI login, which a CI runner doesn't have.
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!hasKey && ONCE) missing.push('ANTHROPIC_API_KEY');
  if (missing.length > 0) {
    console.error(`[worker] Missing settings in .env: ${missing.join('; ')}`);
    process.exit(1);
  }
  if (!hasKey) console.warn('[worker] ANTHROPIC_API_KEY is not set: using your Claude CLI login (run "claude" once to sign in if needed).');
  if (!process.env.GITHUB_TOKEN) console.warn('[worker] GITHUB_TOKEN is not set: specs will be committed locally but not pushed.');
}

// Model output and Jira text contain arbitrary Unicode, which a WIN1252 database rejects.
async function checkDatabaseEncoding() {
  const [{ server_encoding: encoding }] = await db.$queryRaw`SHOW server_encoding`;
  if (encoding !== 'UTF8') {
    console.error(
      `[worker] The database uses ${encoding}, not UTF8, so run logs with emoji or non-Latin text would fail.
` +
        '         Local fix: stop "npm run db:start", delete the .pgdata folder, then run db:start, db:migrate and db:seed again.'
    );
    process.exit(1);
  }
}

async function heartbeat() {
  await db.agentWorker.upsert({
    where: { id: WORKER_ID },
    create: { id: WORKER_ID, hostname: os.hostname() },
    update: { lastSeenAt: new Date() },
  });
  if (!current) return;
  const run = await db.agentRun.update({ where: { id: current.id }, data: { heartbeatAt: new Date() }, select: { cancelRequested: true } });
  if (run.cancelRequested && !current.abortController.signal.aborted) {
    console.log(`[worker] Cancelling ${current.id}`);
    current.abortController.abort();
  }
}

// Runs left RUNNING by a worker that crashed or was stopped.
async function failStaleRuns() {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  await db.agentRun.updateMany({
    where: { status: 'RUNNING', OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }] },
    data: { status: 'FAILED', finishedAt: new Date(), error: 'The worker stopped responding during this run. Start it again to retry.' },
  });
}

// Atomically claims the oldest queued run; safe with several workers. Prisma stores
// timestamps as UTC without a zone, so the SQL must write UTC too (not plain NOW()).
async function claimRun() {
  const rows = await db.$queryRaw`
    UPDATE "AgentRun"
    SET status = 'RUNNING', "workerId" = ${WORKER_ID},
        "startedAt" = NOW() AT TIME ZONE 'UTC', "heartbeatAt" = NOW() AT TIME ZONE 'UTC'
    WHERE id = (
      SELECT id FROM "AgentRun" WHERE status = 'QUEUED' AND "cancelRequested" = false
      ORDER BY "queuedAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

async function execute(id) {
  const run = await db.agentRun.findUnique({ where: { id } });
  const abortController = new AbortController();
  current = { id, abortController };
  console.log(`[worker] Started ${run.issueKey} (${id})`);

  let status = 'FAILED';
  let error = null;
  let step = null;
  try {
    ({ status } = await runTicket({ db, run, abortController }));
  } catch (err) {
    const cancelled = err instanceof CancelledError || abortController.signal.aborted;
    status = cancelled ? 'CANCELLED' : 'FAILED';
    error = cancelled ? 'Cancelled while running. The Jira ticket was left as it was.' : redact(err.message);
    step = err.step ?? null;
    if (!cancelled) console.error(`[worker] ${run.issueKey} failed:`, redact(err.stack ?? err.message));
  } finally {
    current = null;
  }

  await db.agentRun.update({ where: { id }, data: { status, error, finishedAt: new Date(), ...(step ? { step } : {}) } });
  await db.agentRunEvent.create({
    data: { runId: id, step: step ?? 'done', level: status === 'PASSED' ? 'success' : status === 'CANCELLED' ? 'warn' : 'error', message: error ?? 'Run complete' },
  });
  if (status === 'FAILED') {
    await db.auditEvent
      .create({ data: { userId: run.startedById, projectId: run.projectId, action: 'agent.run.failed', target: run.issueKey, details: error?.slice(0, 500) ?? '' } })
      .catch(() => {});
  }
  console.log(`[worker] Finished ${run.issueKey}: ${status}`);
}

// The first query also wakes a sleeping cloud database, so give it a few tries before giving up.
async function waitForDatabase(attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await checkDatabaseEncoding();
    } catch (err) {
      if (attempt === attempts) throw err;
      console.warn(`[worker] Database not reachable yet (try ${attempt} of ${attempts}), retrying in 5s: ${err.message.split('\n').filter(Boolean).at(-1)}`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

async function main() {
  checkConfig();
  await waitForDatabase();
  console.log(ONCE ? `[worker] ${WORKER_ID} working through the queue` : `[worker] ${WORKER_ID} waiting for runs (Ctrl+C to stop)`);
  await heartbeat();
  const beat = setInterval(() => heartbeat().catch((e) => console.error('[worker] heartbeat:', e.message)), HEARTBEAT_MS);
  // Codegen recordings open a visible browser and runs are started by someone waiting in the
  // editor, so only a long-running worker on someone's computer takes them, never the CI runner.
  const recorder = ONCE ? null : recordingLoop({ db, workerId: WORKER_ID, isStopping: () => stopping });
  const codegenRuns = ONCE ? null : codegenRunLoop({ db, workerId: WORKER_ID, isStopping: () => stopping });

  while (!stopping) {
    try {
      await failStaleRuns();
      const id = await claimRun();
      if (id) await execute(id);
      else if (ONCE) break;
      else await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error('[worker]', err.message);
      if (ONCE) {
        process.exitCode = 1;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS * 3));
    }
  }

  clearInterval(beat);
  await Promise.all([recorder, codegenRuns]);
  await db.agentWorker.delete({ where: { id: WORKER_ID } }).catch(() => {});
  await db.$disconnect();
  if (ONCE) console.log('[worker] Queue is empty, exiting');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('[worker] Stopping: cancelling the current run, if any (press Ctrl+C again to force)');
    current?.abortController.abort();
  });
}

main();
