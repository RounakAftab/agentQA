import { json, readJson, recordAudit, requireUser } from '@/lib/apiHelpers';
import { findProjectForReport, listCiRuns, saveReport, validIngestToken } from '@/lib/ciRuns';

export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('projectId') || undefined;
  return json({ runs: await listCiRuns({ projectId }) });
}

// Called by the test repository's GitHub Actions workflow (see ci-templates/), not by the
// browser. Body: { repository | projectId, branch, commit, commitMessage, event, runId,
// runAttempt, runUrl, status?, report: <Playwright JSON report> | null }.
export async function POST(request) {
  if (!process.env.CI_INGEST_TOKEN) return json({ error: 'CI reporting is off: set CI_INGEST_TOKEN on the server' }, 503);
  if (!validIngestToken(request)) return json({ error: 'Invalid CI token' }, 401);

  const body = await readJson(request);
  const project = await findProjectForReport(body);
  if (!project) {
    return json({ error: `No project uses the repository "${body.repository ?? ''}". Set its Automation repo URL, or send projectId.` }, 404);
  }
  if (project.ambiguous) {
    return json({ error: `Several projects use this repository (${project.ambiguous.join(', ')}). Send projectId to choose one.` }, 409);
  }

  const { run, replaced } = await saveReport(project, body);
  await recordAudit({
    projectId: project.id,
    action: `ci.run.${run.status.toLowerCase()}`,
    target: `${run.branch}@${run.commit}`,
    details: `${run.passed}/${run.totalTests} passed${run.failed ? `, ${run.failed} failed` : ''}${replaced ? ' (re-sent)' : ''}`,
  });
  return json({ id: run.id, status: run.status, totalTests: run.totalTests, passed: run.passed, failed: run.failed }, replaced ? 200 : 201);
}
