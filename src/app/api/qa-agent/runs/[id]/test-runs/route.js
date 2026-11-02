import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { ACTIVE_TEST_RUN, getRun } from '@/lib/agentRuns';

// Runs a QA Agent run's saved test again, without the AI: POST { headed }.
// A worker running on someone's computer picks it up; with `headed` the browser opens there.
export async function POST(request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const { id } = await ctx.params;
  const run = await db.agentRun.findUnique({ where: { id }, include: { project: { select: { appBaseUrl: true } } } });
  if (!run) return json({ error: 'Run not found' }, 404);
  if (!run.specContent || !run.specPath) return json({ error: 'This run has no saved test to run.' }, 409);
  if (!run.project.appBaseUrl) return json({ error: 'Add the app link the tests run against first (Projects > Edit project > Test environment).' }, 400);
  const active = await db.agentTestRun.findFirst({ where: { agentRunId: id, status: { in: ACTIVE_TEST_RUN } } });
  if (active) return json({ error: 'This test is already running. Wait for it or cancel it first.' }, 409);

  const headed = Boolean((await readJson(request)).headed);
  await db.agentTestRun.create({ data: { agentRunId: id, headed, requestedById: user.id } });
  await recordAudit({ userId: user.id, projectId: run.projectId, action: 'agent.test_run.queued', target: run.issueKey, details: headed ? 'Run test with the browser visible' : 'Run test headless' });
  return json({ run: await getRun(id) }, 201);
}
