// Server-side project queries. Statistics are computed from real records, so a new
// project shows zeros and "no data yet" instead of invented numbers.
import { db } from '@/lib/db';

function healthFrom(passRate) {
  if (passRate == null) return 'unknown';
  if (passRate >= 90) return 'healthy';
  if (passRate >= 75) return 'warning';
  return 'critical';
}

async function loadProjects(where) {
  const [projects, pending] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        members: { include: { user: { select: { id: true, name: true, avatar: true, deletedAt: true } } } },
        ciRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
        _count: { select: { testCases: true, requirements: true } },
      },
    }),
    db.approval.groupBy({ by: ['projectId'], where: { status: 'PENDING' }, _count: { _all: true } }),
  ]);

  const pendingByProject = new Map(pending.map((row) => [row.projectId, row._count._all]));

  return projects.map((p) => {
    const run = p.ciRuns[0];
    const passRate = run && run.totalTests > 0 ? Math.round((run.passed / run.totalTests) * 1000) / 10 : null;
    const members = p.members.filter((m) => !m.user.deletedAt).map((m) => m.user);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      repoUrl: p.repoUrl,
      automationRepoUrl: p.automationRepoUrl,
      defaultBranch: p.defaultBranch,
      language: p.language,
      framework: p.framework,
      jiraProjectKey: p.jiraProjectKey,
      appBaseUrl: p.appBaseUrl,
      health: healthFrom(passRate),
      testCoverage: run ? run.coverage : null,
      passRate,
      totalTestCases: p._count.testCases,
      totalRequirements: p._count.requirements,
      pendingApprovals: pendingByProject.get(p.id) ?? 0,
      lastRun: run ? run.startedAt.toISOString() : null,
      memberIds: members.map((m) => m.id),
      members,
      createdAt: p.createdAt.toISOString(),
    };
  });
}

export const listProjects = () => loadProjects({});

export async function getProject(id) {
  const [project] = await loadProjects({ id });
  return project ?? null;
}
