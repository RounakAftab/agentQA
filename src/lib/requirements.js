// Server-side shape of a requirement for the QA Agent pages.
const iso = (d) => (d ? d.toISOString() : null);

export const requirementInclude = {
  createdBy: { select: { id: true, name: true } },
  agentRuns: { orderBy: { queuedAt: 'desc' }, take: 1, select: { id: true, status: true, queuedAt: true } },
};

export function publicRequirement(r) {
  const lastRun = r.agentRuns?.[0] ?? null;
  return {
    id: r.id,
    key: r.key,
    title: r.title,
    description: r.description ?? '',
    priority: r.priority,
    status: r.status,
    generatedTests: r.generatedTests,
    createdBy: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.name } : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, queuedAt: iso(lastRun.queuedAt) } : null,
  };
}
