// Server-side QA Agent run queries, shared by the /api/qa-agent routes.
import { db } from '@/lib/db';
import { WORKER_STALE_MS } from '@/lib/agentSteps';
import { issueUrl } from '@/lib/jira';
import { cloudRunnerEnabled } from '@/lib/agentRunner';

const iso = (d) => (d ? d.toISOString() : null);

export function publicRun(run, { withDetail = false } = {}) {
  const base = {
    id: run.id,
    projectId: run.projectId,
    projectName: run.project?.name ?? null,
    issueKey: run.issueKey,
    issueSummary: run.issueSummary,
    source: run.source,
    requirementId: run.requirementId,
    skippedSteps: run.skippedSteps ?? [],
    issueUrl: run.source === 'jira' && run.project?.jiraBaseUrl ? issueUrl(run.project.jiraBaseUrl, run.issueKey) : null,
    status: run.status,
    step: run.step,
    verifiedPass: run.verifiedPass,
    testAttempts: run.testAttempts,
    specPath: run.specPath,
    branch: run.branch,
    prUrl: run.prUrl,
    costUsd: run.costUsd,
    error: run.error,
    cancelRequested: run.cancelRequested,
    startedBy: run.startedBy ? { id: run.startedBy.id, name: run.startedBy.name } : null,
    queuedAt: iso(run.queuedAt),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
  };
  if (!withDetail) return base;
  return {
    ...base,
    issueSnapshot: run.issueSnapshot,
    testPlan: run.testPlan,
    specContent: run.specContent,
    events: (run.events ?? []).map((e) => ({ id: e.id, step: e.step, level: e.level, message: e.message, at: iso(e.at) })),
  };
}

const include = {
  project: { select: { name: true, jiraBaseUrl: true } },
  startedBy: { select: { id: true, name: true } },
};

export async function listRuns({ projectId, take = 50 } = {}) {
  const runs = await db.agentRun.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { queuedAt: 'desc' },
    take,
    include,
  });
  return runs.map((r) => publicRun(r));
}

export async function getRun(id) {
  const run = await db.agentRun.findUnique({
    where: { id },
    include: { ...include, events: { orderBy: { at: 'asc' } } },
  });
  return run ? publicRun(run, { withDetail: true }) : null;
}

export async function workerStatus() {
  const latest = await db.agentWorker.findFirst({ orderBy: { lastSeenAt: 'desc' } });
  return {
    online: Boolean(latest && Date.now() - latest.lastSeenAt.getTime() < WORKER_STALE_MS),
    lastSeenAt: iso(latest?.lastSeenAt),
    // Runs start a GitHub Actions runner themselves, so no worker has to be online.
    onDemand: cloudRunnerEnabled(),
  };
}
