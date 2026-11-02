import { db } from '@/lib/db';
import { json, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { workerInfo } from '@/lib/codegenScripts';
import { limitProblem, loadLimits, targetProblem } from '@/lib/loadLimits';
import { ACTIVE_LOAD_RUN, publicLoadRun, runConfig } from '@/lib/loadTests';

// The test's latest runs: GET /api/load-tests/:id/runs
export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const rows = await db.loadRun.findMany({ where: { testId: id }, orderBy: { createdAt: 'desc' }, take: 20 });
  return json({ runs: rows.map((row) => publicLoadRun(row)), worker: await workerInfo() });
}

// Queues a run on the worker: POST /api/load-tests/:id/runs
export async function POST(_request, ctx) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;
  const { id } = await ctx.params;
  const test = await db.loadTest.findUnique({ where: { id }, include: { project: { select: { appBaseUrl: true } } } });
  if (!test) return json({ error: 'Load test not found' }, 404);

  // The project's app link or the limits may have changed since the test was saved.
  const problem = targetProblem(test.url, test.project.appBaseUrl) ?? limitProblem(test, loadLimits());
  if (problem) return json({ error: problem }, 400);

  const active = await db.loadRun.findFirst({ where: { testId: id, status: { in: ACTIVE_LOAD_RUN } } });
  if (active) return json({ error: 'This load test is already running.', run: publicLoadRun(active) }, 409);

  const created = await db.loadRun.create({ data: { testId: id, config: runConfig(test), requestedById: user.id } });
  await recordAudit({
    userId: user.id,
    projectId: test.projectId,
    action: 'loadtest.run.started',
    target: test.name,
    details: `${test.vus} users, ${test.rampUpSec}s ramp-up + ${test.durationSec}s on ${test.method} ${test.url}`,
  });
  return json({ run: publicLoadRun(created) }, 201);
}
