// QA Agent worker. Claims queued runs from the database one at a time and executes them.
// Runs next to the app (it can't run on Vercel: it needs a browser and long-lived processes).
//
//   npm run agent:worker
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { isJiraConfigured } from '../src/lib/jira.js';
import { runTicket, CancelledError } from './runTicket.mjs';
import { redact } from './processes.mjs';

const db = new PrismaClient();
const WORKER_ID = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
const POLL_MS = 3_000;
const HEARTBEAT_MS = 10_000;
const STALE_RUN_MS = 2 * 60_000;

let stopping = false;
let current = null; // { id, abortController }

function checkConfig() {
  const missing = [];
  if (!isJiraConfigured()) missing.push('JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) missing.push('ANTHROPIC_API_KEY');
  if (missing.length > 0) {
    console.error(`[worker] Missing settings in .env: ${missing.join('; ')}`);
    process.exit(1);
  }
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

async function main() {
  checkConfig();
  await checkDatabaseEncoding();
  console.log(`[worker] ${WORKER_ID} waiting for runs (Ctrl+C to stop)`);
  await heartbeat();
  const beat = setInterval(() => heartbeat().catch((e) => console.error('[worker] heartbeat:', e.message)), HEARTBEAT_MS);

  while (!stopping) {
    try {
      await failStaleRuns();
      const id = await claimRun();
      if (id) await execute(id);
      else await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error('[worker]', err.message);
      await new Promise((r) => setTimeout(r, POLL_MS * 3));
    }
  }

  clearInterval(beat);
  await db.agentWorker.delete({ where: { id: WORKER_ID } }).catch(() => {});
  await db.$disconnect();
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
