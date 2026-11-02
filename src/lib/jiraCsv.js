// Reads a Jira issue export (Jira > Filters > Export > CSV) into requirements. Any Jira user can
// export one, so tickets can come into AgentQA without connecting Jira. Runs in the browser for
// the preview; the server validates every row again.

import { validateRequirementInput } from './validation.js';

export const MAX_IMPORT_ROWS = 200;

// Why a ticket can't be imported, or '' when it can. Shared by the preview and the import API.
export function importProblem(issue, existingKeys) {
  if (!issue.key) return 'No issue key';
  if (existingKeys.has(issue.key)) return 'Already in this project';
  const { errors } = validateRequirementInput({ ...issue, jiraKey: issue.key });
  if (errors.jiraKey) return `"${issue.key}" is not a Jira key`;
  if (errors.title) return 'Summary is missing or too long';
  if (errors.description) return 'Description is under 20 characters, too short to test';
  return '';
}

// RFC 4180: quoted fields may hold commas, newlines and "" for a quote.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

// Jira's priority names -> AgentQA's.
const PRIORITIES = {
  highest: 'critical',
  blocker: 'critical',
  critical: 'critical',
  high: 'high',
  major: 'high',
  medium: 'medium',
  normal: 'medium',
  low: 'low',
  lowest: 'low',
  minor: 'low',
  trivial: 'low',
};
export const mapPriority = (name) => PRIORITIES[String(name ?? '').trim().toLowerCase()] ?? 'medium';

// Jira repeats a header for multi-value fields and names custom fields "Custom field (Name)".
const fieldName = (header) => header.trim().replace(/^Custom field \((.*)\)$/i, '$1').toLowerCase();

// Returns { issues, error }. Each issue: { key, title, description, priority, status, type }.
// The description gets the ticket's acceptance-criteria field appended, as the agent needs both.
export function issuesFromJiraCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { issues: [], error: 'The file is empty.' };
  const names = header.map(fieldName);
  const col = (name) => names.indexOf(name);
  const keyCol = col('issue key');
  const summaryCol = col('summary');
  if (keyCol === -1 || summaryCol === -1) {
    return { issues: [], error: 'This does not look like a Jira CSV export: it needs the "Issue key" and "Summary" columns.' };
  }
  const criteriaCols = names.flatMap((n, i) => (/acceptance criteria/.test(n) ? [i] : []));
  const cell = (row, i) => (i >= 0 ? (row[i] ?? '').trim() : '');

  const issues = rows.map((row) => {
    const criteria = criteriaCols.map((i) => cell(row, i)).filter(Boolean).join('\n');
    const description = [cell(row, col('description')), criteria && `Acceptance criteria:\n${criteria}`].filter(Boolean).join('\n\n');
    return {
      key: cell(row, keyCol).toUpperCase(),
      title: cell(row, summaryCol).replace(/\s+/g, ' '),
      description,
      priority: mapPriority(cell(row, col('priority'))),
      status: cell(row, col('status')),
      type: cell(row, col('issue type')),
    };
  });
  if (issues.length === 0) return { issues, error: 'The file has a header row but no tickets.' };
  if (issues.length > MAX_IMPORT_ROWS) {
    return { issues: [], error: `The file has ${issues.length} tickets. Import at most ${MAX_IMPORT_ROWS} at a time (narrow the Jira filter).` };
  }
  return { issues, error: '' };
}
