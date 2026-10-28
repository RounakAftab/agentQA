// Codegen recordings. When someone clicks "Start recording" in AgentQA, this opens Playwright's
// recorder on this machine at the URL they entered, sends the code back while they use the site,
// and finishes when they close the browser. The app turns the code into a script.
//
// Runs beside the QA Agent loop in worker.mjs, so a long agent run never makes a recording wait.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCodegen } from '../src/lib/codegen/parse.js';
import { killTree } from './processes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// The Playwright that ships with @playwright/mcp; `npm run agent:browsers` installs its Chromium.
const PLAYWRIGHT_CLI = path.resolve(here, '..', 'node_modules', 'playwright', 'cli.js');
const POLL_MS = 1_500;
const MAX_RECORDING_MS = 30 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Atomically claims the oldest queued recording (UTC timestamps, as in worker.mjs).
async function claim(db, workerId) {
  const rows = await db.$queryRaw`
    UPDATE "CodegenRecording"
    SET status = 'RECORDING', "workerId" = ${workerId}, hostname = ${os.hostname()},
        "heartbeatAt" = NOW() AT TIME ZONE 'UTC', "updatedAt" = NOW() AT TIME ZONE 'UTC'
    WHERE id = (
      SELECT id FROM "CodegenRecording" WHERE status = 'QUEUED' AND "cancelRequested" = false
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "startUrl"`;
  return rows[0] ?? null;
}

// The recorder's code with credentials replaced, or null while it has no usable steps yet.
async function readCode(file) {
  const code = await fs.readFile(file, 'utf8').catch(() => '');
  if (!code.trim()) return null;
  const parsed = parseCodegen(code);
  return parsed.errors.length ? null : { liveCode: parsed.source, stepCount: parsed.steps.length };
}

async function record(db, { id, startUrl }, isStopping) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentqa-recording-'));
  const file = path.join(dir, 'recording.spec.ts');
  console.log(`[recorder] Opening the recorder on ${startUrl} (${id})`);

  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'codegen', '--target', 'playwright-test', '--output', file, startUrl], { stdio: 'ignore' });
  let spawnError = null;
  const exited = new Promise((resolve) => {
    child.on('error', (err) => {
      spawnError = err;
      resolve();
    });
    child.on('exit', resolve);
  });

  let ending = null; // why we closed the recorder ourselves
  const started = Date.now();
  try {
    while (child.exitCode === null && !spawnError) {
      await Promise.race([exited, sleep(POLL_MS)]);
      const latest = await readCode(file);
      const row = await db.codegenRecording.update({
        where: { id },
        data: { heartbeatAt: new Date(), ...latest },
        select: { cancelRequested: true },
      });
      if (row.cancelRequested) ending = 'cancelled';
      else if (isStopping()) ending = 'The worker was stopped during the recording.';
      else if (Date.now() - started > MAX_RECORDING_MS) ending = 'The recording reached its 30-minute limit and was closed.';
      if (ending) {
        await killTree(child);
        break;
      }
    }
    await exited;

    const final = await readCode(file);
    let data;
    if (ending === 'cancelled') data = { status: 'CANCELLED', liveCode: null, stepCount: 0 };
    else if (spawnError) data = { status: 'FAILED', error: `Could not open the recorder: ${spawnError.message}` };
    else if (!final) data = { status: 'FAILED', error: ending ?? 'No steps were recorded. Use the site in the browser that opens, then close the browser.' };
    else data = { status: 'DONE', ...final, error: ending };
    await db.codegenRecording.update({ where: { id }, data: { ...data, heartbeatAt: new Date() } });
    console.log(`[recorder] ${id}: ${data.status}${final ? ` (${final.stepCount} steps)` : ''}`);
  } finally {
    await killTree(child).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Polls for recordings until `isStopping()` is true. One recording at a time per worker.
export async function recordingLoop({ db, workerId, isStopping }) {
  if (!(await fs.access(PLAYWRIGHT_CLI).then(() => true, () => false))) {
    console.warn('[recorder] Playwright is not installed (node_modules/playwright): Codegen recordings are disabled.');
    return;
  }
  console.log('[recorder] Ready to open Codegen recordings on this computer');
  while (!isStopping()) {
    try {
      const recording = await claim(db, workerId);
      if (recording) await record(db, recording, isStopping);
      else await sleep(POLL_MS);
    } catch (err) {
      console.error('[recorder]', err.message);
      await sleep(POLL_MS * 3);
    }
  }
}
