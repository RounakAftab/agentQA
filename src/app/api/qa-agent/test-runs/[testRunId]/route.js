import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { getRun } from '@/lib/agentRuns';

// Cancels a "Run test" run. A queued one stops at once; a running one when the worker next checks in.
export async function DELETE(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const { testRunId } = await ctx.params;
  const testRun = await db.agentTestRun.findUnique({ where: { id: testRunId }, include: { agentRun: { select: { id: true, projectId: true, issueKey: true } } } });
  if (!testRun) return json({ error: 'Test run not found' }, 404);

  if (testRun.status === 'QUEUED') {
    const { count } = await db.agentTestRun.updateMany({
      where: { id: testRunId, status: 'QUEUED' },
      data: { status: 'CANCELLED', finishedAt: new Date(), error: 'Cancelled before it started' },
    });
    if (count === 0) await db.agentTestRun.update({ where: { id: testRunId }, data: { cancelRequested: true } });
  } else if (testRun.status === 'RUNNING') {
    await db.agentTestRun.update({ where: { id: testRunId }, data: { cancelRequested: true } });
  } else {
    return json({ error: 'This test run has already finished' }, 409);
  }

  await recordAudit({ userId: user.id, projectId: testRun.agentRun.projectId, action: 'agent.test_run.cancelled', target: testRun.agentRun.issueKey, details: 'Cancelled a test run' });
  return json({ run: await getRun(testRun.agentRun.id) });
}
