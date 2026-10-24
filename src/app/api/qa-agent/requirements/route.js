import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { publicRequirement, requirementInclude } from '@/lib/requirements';
import { validateRequirementInput } from '@/lib/validation';
import { MANUAL_KEY_PREFIX } from '@/lib/agentSteps';

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

// Next free REQ-n in the project.
async function nextKey(projectId) {
  const rows = await db.requirement.findMany({ where: { projectId, key: { startsWith: `${MANUAL_KEY_PREFIX}-` } }, select: { key: true } });
  const highest = rows.reduce((max, r) => Math.max(max, Number(r.key.split('-')[1]) || 0), 0);
  return `${MANUAL_KEY_PREFIX}-${highest + 1}`;
}

export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') } });
  if (!project) return json({ error: 'Project not found' }, 404);

  const { values, errors } = validateRequirementInput(body);
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  // Two people adding a requirement at once can pick the same key; the unique index
  // rejects the second, which then takes the next number.
  let created = null;
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    try {
      created = await db.requirement.create({
        data: { ...values, projectId: project.id, key: await nextKey(project.id), source: 'manual', status: 'open', createdById: user.id },
        include: requirementInclude,
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }
  }
  if (!created) return json({ error: 'Could not create the requirement. Try again.' }, 409);

  await recordAudit({ userId: user.id, projectId: project.id, action: 'requirement.created', target: created.key, details: created.title });
  return json({ requirement: publicRequirement(created) }, 201);
}
