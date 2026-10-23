import { db } from '@/lib/db';
import { json, requireUser } from '@/lib/apiHelpers';
import { isJiraConfigured, listOpenIssues, JiraError } from '@/lib/jira';

// Open Jira tickets for a project: GET /api/qa-agent/issues?projectId=...
export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;

  if (!isJiraConfigured()) return json({ configured: false, issues: [] });

  const projectId = new URL(request.url).searchParams.get('projectId');
  const project = projectId ? await db.project.findUnique({ where: { id: projectId } }) : null;
  if (!project) return json({ error: 'Project not found' }, 404);
  if (!project.jiraProjectKey) return json({ configured: true, issues: [], missingKey: true });

  try {
    return json({ configured: true, issues: await listOpenIssues(project.jiraProjectKey) });
  } catch (err) {
    if (err instanceof JiraError) return json({ configured: true, issues: [], error: err.message }, 502);
    throw err;
  }
}
