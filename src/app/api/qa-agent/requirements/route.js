import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { nextManualKey, publicRequirement, requirementColumns, requirementInclude } from '@/lib/requirements';
import { validateRequirementInput } from '@/lib/validation';

// Requirements written in AgentQA for a project: GET /api/qa-agent/requirements?projectId=...
// Add &all=1 to include Jira tickets the agent has picked up.
export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId');
  if (!projectId) return json({ error: 'projectId is required' }, 400);
  const rows = await db.requirement.findMany({
    where: params.get('all') === '1' ? { projectId } : { projectId, source: 'manual' },
    orderBy: { createdAt: 'desc' },
    include: requirementInclude,
  });
  return json({ requirements: rows.map(publicRequirement) });
}

const duplicateKeyError = (key) =>
  json({ error: 'Please fix the highlighted fields', fieldErrors: { jiraKey: `${key} is already a requirement in this project` } }, 409);

export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') } });
  if (!project) return json({ error: 'Project not found' }, 404);

  const { values, errors } = validateRequirementInput(body);
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);
  const data = { ...requirementColumns(values, project), projectId: project.id, source: 'manual', status: 'open', createdById: user.id };

  // A Jira key is used as given. Otherwise two people adding a requirement at once can pick the
  // same REQ-n; the unique index rejects the second, which then takes the next number.
  let created = null;
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    try {
      created = await db.requirement.create({
        data: { ...data, key: values.jiraKey ?? (await nextManualKey(db, project.id)) },
        include: requirementInclude,
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      if (values.jiraKey) return duplicateKeyError(values.jiraKey);
    }
  }
  if (!created) return json({ error: 'Could not create the requirement. Try again.' }, 409);

  await recordAudit({ userId: user.id, projectId: project.id, action: 'requirement.created', target: created.key, details: created.title });
  return json({ requirement: publicRequirement(created) }, 201);
}
