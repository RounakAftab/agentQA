import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { getRun } from '@/lib/agentRuns';

export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const run = await getRun((await ctx.params).id);
  return run ? json({ run }) : json({ error: 'Run not found' }, 404);
}

// Cancels a run. A queued run stops at once; a running one is stopped by the worker at its
// next check-in, and the Jira ticket is left where it is.
export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const { id } = await ctx.params;
  const run = await db.agentRun.findUnique({ where: { id } });
  if (!run) return json({ error: 'Run not found' }, 404);

  if (run.status === 'QUEUED') {
    // Conditional update so a worker claiming the run at the same moment wins cleanly.
    const { count } = await db.agentRun.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'CANCELLED', finishedAt: new Date(), error: 'Cancelled before it started' },
    });
    if (count === 0) await db.agentRun.update({ where: { id }, data: { cancelRequested: true } });
  } else if (run.status === 'RUNNING') {
    await db.agentRun.update({ where: { id }, data: { cancelRequested: true } });
  } else {
    return json({ error: 'This run has already finished' }, 409);
  }

  await recordAudit({ userId: user.id, projectId: run.projectId, action: 'agent.run.cancelled', target: run.issueKey, details: 'Cancelled QA Agent run' });
  return json({ run: await getRun(id) });
}
