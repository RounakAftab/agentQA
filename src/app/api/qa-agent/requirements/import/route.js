import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator } from '@/lib/apiHelpers';
import { requirementColumns } from '@/lib/requirements';
import { validateRequirementInput } from '@/lib/validation';
import { MAX_IMPORT_ROWS, importProblem } from '@/lib/jiraCsv';

// Origin of the Jira site the tickets link to ("https://your-team.atlassian.net"), or '' for none.
function siteOrigin(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.origin : null;
  } catch {
    return null;
  }
}

// Adds tickets from a Jira CSV export as manual requirements:
// POST { projectId, site?, issues: [{ key, title, description, priority }] }
// Tickets already in the project are skipped, never overwritten.
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const body = await readJson(request);
  const project = await db.project.findUnique({ where: { id: String(body.projectId ?? '') } });
  if (!project) return json({ error: 'Project not found' }, 404);
  const issues = Array.isArray(body.issues) ? body.issues : [];
  if (issues.length === 0) return json({ error: 'No tickets to import' }, 400);
  if (issues.length > MAX_IMPORT_ROWS) return json({ error: `Import at most ${MAX_IMPORT_ROWS} tickets at a time` }, 400);
  const site = siteOrigin(body.site);
  if (site === null) return json({ error: 'Jira site must be a link such as https://your-team.atlassian.net', fieldErrors: { site: 'Use a link such as https://your-team.atlassian.net' } }, 400);
  const linkProject = { jiraBaseUrl: site || project.jiraBaseUrl };

  const existing = new Set(
    (await db.requirement.findMany({ where: { projectId: project.id }, select: { key: true } })).map((r) => r.key)
  );
  const skipped = [];
  const rows = [];
  for (const issue of issues) {
    const key = String(issue?.key ?? '').trim().toUpperCase();
    const problem = importProblem({ ...issue, key }, existing);
    if (problem) skipped.push({ key: key || '—', reason: problem });
    else {
      const { values } = validateRequirementInput({ ...issue, jiraKey: key, ticketUrl: '' });
      existing.add(key); // a ticket listed twice in the file is imported once
      rows.push({ ...requirementColumns(values, linkProject), key, projectId: project.id, source: 'manual', status: 'open', createdById: user.id });
    }
  }

  // skipDuplicates covers a ticket someone added while this ran.
  const { count } = rows.length ? await db.requirement.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  const created = rows.map((r) => r.key);
  if (count < rows.length) skipped.push({ key: '—', reason: `${rows.length - count} ticket(s) were added by someone else while importing` });
  if (count > 0) {
    await recordAudit({
      userId: user.id,
      projectId: project.id,
      action: 'requirement.imported',
      target: `${count} Jira ticket(s)`,
      details: created.slice(0, 20).join(', ') + (created.length > 20 ? ', …' : ''),
    });
  }
  return json({ created: count, skipped }, count > 0 ? 201 : 200);
}
