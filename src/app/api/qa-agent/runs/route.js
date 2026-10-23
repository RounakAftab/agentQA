import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { listRuns, getRun, workerStatus } from '@/lib/agentRuns';
import { ACTIVE_STATUSES, ISSUE_KEY_PATTERN } from '@/lib/agentSteps';
import { isJiraConfigured } from '@/lib/jira';

export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('projectId') || undefined;
  const [runs, worker] = await Promise.all([listRuns({ projectId }), workerStatus()]);
  return json({ runs, worker, jiraConfigured: isJiraConfigured() });
}

// Queues "pick up SCRUM-X". The worker does the rest.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const issueKey = String(body.issueKey ?? '').trim().toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(issueKey)) return json({ error: 'Enter a Jira ticket key such as SCRUM-12' }, 400);
  if (!isJiraConfigured()) return json({ error: 'Jira is not connected. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.' }, 400);

  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') } });
  if (!project) return json({ error: 'Project not found' }, 404);

  const missing = [
    !project.jiraProjectKey && 'Jira project key',
    !project.appBaseUrl && 'app link for tests',
    !project.automationRepoUrl && 'test repository link',
  ].filter(Boolean);
  if (missing.length > 0) return json({ error: `Add the ${missing.join(', ')} to this project first (Projects > Edit).` }, 400);
  if (!issueKey.startsWith(`${project.jiraProjectKey}-`)) {
    return json({ error: `${issueKey} is not in the ${project.jiraProjectKey} Jira project` }, 400);
  }

  const active = await db.agentRun.findFirst({ where: { issueKey, status: { in: ACTIVE_STATUSES } } });
  if (active) return json({ error: `${issueKey} already has a run in progress`, runId: active.id }, 409);

  const run = await db.agentRun.create({
    data: { projectId: project.id, issueKey, issueSummary: String(body.summary ?? '').slice(0, 300), startedById: user.id },
  });

  await recordAudit({ userId: user.id, projectId: project.id, action: 'agent.run.queued', target: issueKey, details: 'Queued QA Agent run' });
  return json({ run: await getRun(run.id) }, 201);
}
