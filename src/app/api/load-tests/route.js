import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { loadLimits } from '@/lib/loadLimits';
import { loadTestInclude, publicLoadTest, publicLoadRun, validateLoadTestInput } from '@/lib/loadTests';

// Load tests with their latest run, newest first: GET /api/load-tests
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const rows = await db.loadTest.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { ...loadTestInclude, runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  return json({
    tests: rows.map((row) => ({ ...publicLoadTest(row), lastRun: row.runs[0] ? publicLoadRun(row.runs[0]) : null })),
    limits: loadLimits(),
  });
}

// POST { projectId, name, method, url, body, headers, vus, rampUpSec, durationSec, maxP95Ms, maxErrorRatePct }
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') }, select: { id: true, appBaseUrl: true } });
  if (!project) return json({ error: 'Please fix the highlighted fields', fieldErrors: { projectId: 'Choose a project' } }, 400);

  const { values, errors } = validateLoadTestInput(body, { project });
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  const created = await db.loadTest.create({ data: { ...values, projectId: project.id, createdById: user.id }, include: loadTestInclude });
  await recordAudit({ userId: user.id, projectId: project.id, action: 'loadtest.created', target: created.name, details: `${created.method} ${created.url}` });
  return json({ test: publicLoadTest(created) }, 201);
}
