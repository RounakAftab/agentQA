// Server-side shape of a requirement for the QA Agent pages.
import { MANUAL_KEY_PREFIX } from './agentSteps.js';

const iso = (d) => (d ? d.toISOString() : null);

// AgentQA's own numbering (REQ-3), as opposed to a Jira key (SCRUM-12).
export const isManualKey = (key) => new RegExp(`^${MANUAL_KEY_PREFIX}-\\d+$`).test(key ?? '');

// Next free REQ-n in the project.
export async function nextManualKey(db, projectId) {
  const rows = await db.requirement.findMany({ where: { projectId, key: { startsWith: `${MANUAL_KEY_PREFIX}-` } }, select: { key: true } });
  const highest = rows.reduce((max, r) => Math.max(max, Number(r.key.split('-')[1]) || 0), 0);
  return `${MANUAL_KEY_PREFIX}-${highest + 1}`;
}

// Columns for a manual requirement from validateRequirementInput's values. Without a ticket link,
// a Jira key still gets one when the project has a Jira site set.
export function requirementColumns(values, project) {
  const base = project.jiraBaseUrl?.replace(/\/+$/, '');
  const builtUrl = values.jiraKey && base ? `${base}/browse/${values.jiraKey}` : null;
  return {
    title: values.title,
    description: values.description,
    priority: values.priority,
    sourceUrl: values.ticketUrl ?? builtUrl,
  };
}

export const requirementInclude = {
  createdBy: { select: { id: true, name: true } },
  agentRuns: { orderBy: { queuedAt: 'desc' }, take: 1, select: { id: true, status: true, queuedAt: true } },
};

export function publicRequirement(r) {
  const lastRun = r.agentRuns?.[0] ?? null;
  return {
    id: r.id,
    key: r.key,
    // The Jira ticket a manual requirement was copied from, when the user gave one.
    jiraKey: r.source === 'manual' && !isManualKey(r.key) ? r.key : null,
    ticketUrl: r.sourceUrl ?? null,
    title: r.title,
    source: r.source === 'manual' ? 'manual' : 'jira',
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
