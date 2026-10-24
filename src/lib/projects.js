// Server-side project queries. Statistics are computed from real records, so a new
// project shows zeros and "no data yet" instead of invented numbers.
import { db } from '@/lib/db';
import { encryptSecret } from '@/lib/secrets';
import { isProjectJiraConnected } from '@/lib/jira';

function healthFrom(passRate) {
  if (passRate == null) return 'unknown';
  if (passRate >= 90) return 'healthy';
  if (passRate >= 75) return 'warning';
  return 'critical';
}

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// Per-project counts from the QA Agent: finished runs by result, and requirements by status.
async function agentStats() {
  const [runs, requirements] = await Promise.all([
    db.agentRun.groupBy({ by: ['projectId', 'status'], where: { status: { in: ['PASSED', 'FAILED'] } }, _count: { _all: true } }),
    db.requirement.groupBy({ by: ['projectId', 'status'], _count: { _all: true } }),
  ]);
  const stats = new Map();
  const entry = (id) => stats.get(id) ?? stats.set(id, { passed: 0, failed: 0, requirements: 0, automated: 0, failing: 0 }).get(id);
  for (const row of runs) entry(row.projectId)[row.status === 'PASSED' ? 'passed' : 'failed'] += row._count._all;
  for (const row of requirements) {
    const s = entry(row.projectId);
    s.requirements += row._count._all;
    if (row.status === 'automated') s.automated += row._count._all;
    if (row.status === 'failed') s.failing += row._count._all;
  }
  return stats;
}

async function loadProjects(where) {
  const [projects, pending, stats] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        members: { include: { user: { select: { id: true, name: true, avatar: true, deletedAt: true } } } },
        ciRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
        _count: { select: { requirements: true } },
      },
    }),
    db.approval.groupBy({ by: ['projectId'], where: { status: 'PENDING' }, _count: { _all: true } }),
    agentStats(),
  ]);

  const pendingByProject = new Map(pending.map((row) => [row.projectId, row._count._all]));

  return projects.map((p) => {
    const run = p.ciRuns[0];
    const agent = stats.get(p.id) ?? { passed: 0, failed: 0, requirements: 0, automated: 0, failing: 0 };
    // A CI report wins when there is one; otherwise the QA Agent's own results are used.
    const passRate = run && run.totalTests > 0 ? percent(run.passed, run.totalTests) : percent(agent.passed, agent.passed + agent.failed);
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
      // Secrets never leave the server; the form only learns whether one is saved.
      jiraBaseUrl: p.jiraBaseUrl,
      jiraEmail: p.jiraEmail,
      jiraTokenSet: Boolean(p.jiraApiTokenEnc),
      jiraProjectKey: p.jiraProjectKey,
      jiraStatusInProgress: p.jiraStatusInProgress,
      jiraStatusDone: p.jiraStatusDone,
      jiraConnected: isProjectJiraConnected(p),
      appBaseUrl: p.appBaseUrl,
      e2eUsername: p.e2eUsername,
      e2ePasswordSet: Boolean(p.e2ePasswordEnc),
      health: healthFrom(passRate),
      // Without a CI coverage report: the share of requirements that have a passing automated test.
      testCoverage: run?.coverage ?? percent(agent.automated, agent.requirements),
      passRate,
      // One automated test per requirement: re-running a requirement replaces its test.
      totalTestCases: agent.automated,
      totalRequirements: p._count.requirements,
      failingRequirements: agent.failing,
      pendingApprovals: pendingByProject.get(p.id) ?? 0,
      lastRun: run ? run.startedAt.toISOString() : null,
      memberIds: members.map((m) => m.id),
      members,
      createdAt: p.createdAt.toISOString(),
    };
  });
}

export const listProjects = () => loadProjects({});

// Turns validated form values into columns, encrypting new secrets. A blank secret keeps the
// stored one unless the form asked to remove it.
export function projectData(values) {
  const { memberIds, jiraApiToken, clearJiraApiToken, e2ePassword, clearE2ePassword, ...fields } = values;
  const data = { ...fields };
  if (jiraApiToken) data.jiraApiTokenEnc = encryptSecret(jiraApiToken);
  else if (clearJiraApiToken) data.jiraApiTokenEnc = null;
  if (e2ePassword) data.e2ePasswordEnc = encryptSecret(e2ePassword);
  else if (clearE2ePassword) data.e2ePasswordEnc = null;
  return { data, memberIds };
}

export async function getProject(id) {
  const [project] = await loadProjects({ id });
  return project ?? null;
}
