import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { publicRun } from '@/lib/codegenScripts';

// The worker writes every second while a run is going; a heal waits on the model, so allow longer.
const STALE_MS = 2 * 60_000;

// A run whose worker stopped writing ends as an error, so the editor doesn't wait forever.
async function failIfStale(row) {
  if (row.status !== 'RUNNING' || !row.heartbeatAt || Date.now() - row.heartbeatAt.getTime() < STALE_MS) return row;
  return db.codegenRun.update({
    where: { id: row.id },
    data: { status: 'ERROR', error: 'The worker stopped responding during the run. Start it again and retry.', finishedAt: new Date() },
  });
}

// One run with its console and results: GET /api/codegen/runs/:runId
export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { runId } = await ctx.params;
  const row = await db.codegenRun.findUnique({ where: { id: runId } });
  if (!row) return json({ error: 'Run not found' }, 404);
  return json({ run: publicRun(await failIfStale(row), { full: true }) });
}

// Cancels: a queued run at once, a running one when the worker next checks (within a second or two).
export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { runId } = await ctx.params;
  const row = await db.codegenRun.findUnique({ where: { id: runId }, include: { script: { select: { title: true } } } });
  if (!row) return json({ error: 'Run not found' }, 404);

  if (row.status === 'QUEUED') {
    await db.codegenRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'CANCELLED', cancelRequested: true, finishedAt: new Date() } });
  } else if (row.status === 'RUNNING') {
    await db.codegenRun.update({ where: { id: runId }, data: { cancelRequested: true } });
  }
  await recordAudit({ userId: user.id, action: 'codegen.run.cancelled', target: row.script.title, details: row.kind });
  return json({ ok: true });
}
