import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireProjectManager, requireUser } from '@/lib/apiHelpers';
import { getProject, listProjects, projectData } from '@/lib/projects';
import { validateProjectInput } from '@/lib/validation';

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  return json({ projects: await listProjects() });
}

export async function POST(request) {
  const { user, response } = await requireProjectManager();
  if (response) return response;

  const { values, errors } = validateProjectInput({ ...(await readJson(request)), jiraTokenSet: false });
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  if (await db.project.findFirst({ where: { name: { equals: values.name, mode: 'insensitive' } } })) {
    return json({ error: 'Please fix the highlighted fields', fieldErrors: { name: 'A project with this name already exists' } }, 409);
  }

  const { data: fields, memberIds } = projectData(values);
  const activeMembers = await db.user.findMany({
    where: { id: { in: memberIds }, deletedAt: null },
    select: { id: true },
  });

  const created = await db.project.create({
    data: { ...fields, members: { create: activeMembers.map((m) => ({ userId: m.id })) } },
  });

  await recordAudit({
    userId: user.id,
    projectId: created.id,
    action: 'project.created',
    target: created.name,
    details: `Created project with ${activeMembers.length} member(s)`,
  });
  return json({ project: await getProject(created.id) }, 201);
}
