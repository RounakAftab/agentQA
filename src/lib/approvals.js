// Server-side approval queries, shared by the /api/approvals routes.
import { db } from '@/lib/db';

const iso = (d) => (d ? d.toISOString() : null);
const person = (u) => (u ? { id: u.id, name: u.name } : null);

export const include = {
  assignedTo: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  agentRun: { select: { id: true, issueKey: true, source: true, specPath: true, prUrl: true, branch: true, project: { select: { name: true } } } },
  comments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, name: true } } } },
};

export function publicApproval(a) {
  return {
    id: a.id,
    projectId: a.projectId,
    projectName: a.agentRun?.project?.name ?? null,
    type: a.type,
    title: a.title,
    description: a.description,
    status: a.status.toLowerCase(),
    requestedBy: a.requestedBy,
    assignedTo: person(a.assignedTo),
    decidedBy: person(a.approvedBy),
    decidedAt: iso(a.decidedAt),
    codePreview: a.codePreview,
    run: a.agentRun
      ? { id: a.agentRun.id, issueKey: a.agentRun.issueKey, source: a.agentRun.source, specPath: a.agentRun.specPath, prUrl: a.agentRun.prUrl, branch: a.agentRun.branch }
      : null,
    comments: (a.comments ?? []).map((c) => ({ id: c.id, user: person(c.user), text: c.text, createdAt: iso(c.createdAt) })),
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
  };
}

export async function listApprovals({ projectId, take = 200 } = {}) {
  const rows = await db.approval.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: 'desc' },
    take,
    include,
  });
  return rows.map(publicApproval);
}

export async function getApproval(id) {
  const row = await db.approval.findUnique({ where: { id }, include });
  return row ? publicApproval(row) : null;
}
