import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { publicLoadRun } from '@/lib/loadTests';

// The worker writes every few seconds while k6 runs.
const STALE_MS = 2 * 60_000;

// A run whose worker stopped writing ends as an error, so the page doesn't wait forever.
async function failIfStale(row) {
  if (row.status !== 'RUNNING' || !row.heartbeatAt || Date.now() - row.heartbeatAt.getTime() < STALE_MS) return row;
  return db.loadRun.update({
    where: { id: row.id },
    data: { status: 'ERROR', error: 'The worker stopped responding during the run. Start it again and retry.', finishedAt: new Date() },
  });
}

// One run with its samples and console: GET /api/load-tests/runs/:runId
export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { runId } = await ctx.params;
  const row = await db.loadRun.findUnique({ where: { id: runId } });
  if (!row) return json({ error: 'Run not found' }, 404);
  return json({ run: publicLoadRun(await failIfStale(row), { full: true }) });
}

// Stops: a queued run at once, a running one when the worker next checks (within a few seconds).
// k6 then ends gracefully, so the numbers so far are kept.
export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { runId } = await ctx.params;
  const row = await db.loadRun.findUnique({ where: { id: runId }, include: { test: { select: { name: true, projectId: true } } } });
  if (!row) return json({ error: 'Run not found' }, 404);

  if (row.status === 'QUEUED') {
    await db.loadRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'CANCELLED', cancelRequested: true, finishedAt: new Date() } });
  } else if (row.status === 'RUNNING') {
    await db.loadRun.update({ where: { id: runId }, data: { cancelRequested: true } });
  }
  await recordAudit({ userId: user.id, projectId: row.test.projectId, action: 'loadtest.run.cancelled', target: row.test.name, details: row.status });
  return json({ ok: true });
}
