import { db } from '@/lib/db';
import { json, requireUser } from '@/lib/apiHelpers';
import { isProjectJiraConnected, jiraForProject, JiraError } from '@/lib/jira';

// Open Jira tickets for a project: GET /api/qa-agent/issues?projectId=...
export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;

  const projectId = new URL(request.url).searchParams.get('projectId');
  const project = projectId ? await db.project.findUnique({ where: { id: projectId } }) : null;
  if (!project) return json({ error: 'Project not found' }, 404);
  if (!isProjectJiraConnected(project)) return json({ configured: false, issues: [] });

  try {
    return json({ configured: true, issues: await jiraForProject(project).listOpenIssues(project.jiraProjectKey) });
  } catch (err) {
    // A token that no longer decrypts is reported like a Jira error, not a server crash.
    if (err instanceof JiraError || /decrypt/.test(err.message)) return json({ configured: true, issues: [], error: err.message }, 502);
    throw err;
  }
}
