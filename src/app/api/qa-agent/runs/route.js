import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { listRuns, getRun, workerStatus } from '@/lib/agentRuns';
import { ACTIVE_STATUSES, ISSUE_KEY_PATTERN } from '@/lib/agentSteps';
import { isProjectJiraConnected } from '@/lib/jira';

export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('projectId') || undefined;
  const [runs, worker] = await Promise.all([listRuns({ projectId }), workerStatus()]);
  return json({ runs, worker });
}

// Queues a run: { projectId, issueKey } for a Jira ticket ("pick up SCRUM-X"), or
// { projectId, requirementId } for a requirement written in AgentQA. The worker does the rest.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') } });
  if (!project) return json({ error: 'Project not found' }, 404);
  if (!project.appBaseUrl) {
    return json({ error: 'Add the app link the tests run against first (Projects > Edit project > Test environment).' }, 400);
  }

  let data;
  if (body.requirementId) {
    const requirement = await db.requirement.findFirst({ where: { id: String(body.requirementId), projectId: project.id, source: 'manual' } });
    if (!requirement) return json({ error: 'Requirement not found' }, 404);
    data = { source: 'manual', requirementId: requirement.id, issueKey: requirement.key, issueSummary: requirement.title };
  } else {
    const issueKey = String(body.issueKey ?? '').trim().toUpperCase();
    if (!ISSUE_KEY_PATTERN.test(issueKey)) return json({ error: 'Enter a Jira ticket key such as SCRUM-12' }, 400);
    if (!isProjectJiraConnected(project)) return json({ error: 'Connect Jira to this project first (Projects > Edit project > Jira).' }, 400);
    if (!issueKey.startsWith(`${project.jiraProjectKey}-`)) {
      return json({ error: `${issueKey} is not in the ${project.jiraProjectKey} Jira project` }, 400);
    }
    data = { source: 'jira', issueKey, issueSummary: String(body.summary ?? '').slice(0, 300) };
  }

  const active = await db.agentRun.findFirst({ where: { projectId: project.id, issueKey: data.issueKey, status: { in: ACTIVE_STATUSES } } });
  if (active) return json({ error: `${data.issueKey} already has a run in progress`, runId: active.id }, 409);

  const run = await db.agentRun.create({ data: { ...data, projectId: project.id, startedById: user.id } });
  const issueKey = data.issueKey;

  await recordAudit({ userId: user.id, projectId: project.id, action: 'agent.run.queued', target: issueKey, details: 'Queued QA Agent run' });
  return json({ run: await getRun(run.id) }, 201);
}
