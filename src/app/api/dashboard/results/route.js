import { db } from '@/lib/db';
import { json, requireUser } from '@/lib/apiHelpers';

const DAYS = 30;

// Finished test results from the last 30 days, for the dashboard's pass rate trend. The same
// sources as each project's pass rate (src/lib/projects.js): CI reports count their tests,
// and each finished QA Agent run counts as one test. The browser groups them by local day.
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const [ciRuns, agentRuns] = await Promise.all([
    db.cIRun.findMany({
      where: { startedAt: { gte: since }, totalTests: { gt: 0 } },
      select: { projectId: true, startedAt: true, completedAt: true, passed: true, totalTests: true },
    }),
    db.agentRun.findMany({
      where: { status: { in: ['PASSED', 'FAILED'] }, finishedAt: { gte: since } },
      select: { projectId: true, finishedAt: true, status: true },
    }),
  ]);

  const results = [
    ...ciRuns.map((r) => ({ at: (r.completedAt ?? r.startedAt).toISOString(), projectId: r.projectId, source: 'ci', passed: r.passed, total: r.totalTests })),
    ...agentRuns.map((r) => ({ at: r.finishedAt.toISOString(), projectId: r.projectId, source: 'agent', passed: r.status === 'PASSED' ? 1 : 0, total: 1 })),
  ];
  return json({ days: DAYS, results });
}
