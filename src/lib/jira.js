// Jira Cloud REST v3 client, used by the API routes (reading tickets) and the QA Agent
// worker (status changes and notes). Server-only: it reads JIRA_API_TOKEN from the environment.
//
// Deliberately has no "set description" function. Descriptions are append-only, so a run
// can never overwrite what people wrote on a ticket.
import { ISSUE_KEY_PATTERN, PROJECT_KEY_PATTERN } from './agentSteps.js';

export const isJiraConfigured = () =>
  Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);

export class JiraError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function baseUrl() {
  return process.env.JIRA_BASE_URL.replace(/\/+$/, '');
}

export const issueUrl = (key) => `${baseUrl()}/browse/${key}`;

async function request(method, path, body) {
  if (!isJiraConfigured()) throw new JiraError('Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.', 0);
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  let res;
  try {
    res = await fetch(`${baseUrl()}/rest/api/3${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new JiraError(`Could not reach Jira: ${err.message}`, 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.errorMessages?.join(' ') || Object.values(data?.errors ?? {}).join(' ') || res.statusText;
    throw new JiraError(`Jira ${res.status}: ${detail}`, res.status);
  }
  return data;
}

// ---- Atlassian Document Format (ADF) ----

// Flattens an ADF document into readable text, keeping list items and paragraphs on their
// own lines so numbered test steps survive.
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const children = (node.content ?? []).map(adfToText);
  switch (node.type) {
    case 'orderedList':
      return children.map((c, i) => `${i + 1}. ${c.trim()}`).join('\n') + '\n';
    case 'bulletList':
      return children.map((c) => `- ${c.trim()}`).join('\n') + '\n';
    case 'paragraph':
    case 'heading':
      return children.join('') + '\n';
    default:
      return children.join('');
  }
}

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

// ---- Issues ----

function toIssue(raw) {
  const f = raw.fields ?? {};
  return {
    key: raw.key,
    summary: f.summary ?? '',
    status: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.key ?? '',
    type: f.issuetype?.name ?? '',
    priority: f.priority?.name ?? '',
    assignee: f.assignee?.displayName ?? null,
    updated: f.updated ?? null,
    description: adfToText(f.description).trim(),
    url: issueUrl(raw.key),
  };
}

const ISSUE_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated', 'description'];

export async function getIssue(key) {
  if (!ISSUE_KEY_PATTERN.test(key)) throw new JiraError(`"${key}" is not a Jira issue key`, 400);
  return toIssue(await request('GET', `/issue/${key}?fields=${ISSUE_FIELDS.join(',')}`));
}

// Open tickets in a project, most recently updated first.
export async function listOpenIssues(projectKey, { max = 50 } = {}) {
  if (!PROJECT_KEY_PATTERN.test(projectKey)) throw new JiraError(`"${projectKey}" is not a Jira project key`, 400);
  const data = await request('POST', '/search/jql', {
    jql: `project = "${projectKey}" AND statusCategory != Done ORDER BY updated DESC`,
    fields: ISSUE_FIELDS,
    maxResults: max,
  });
  return (data.issues ?? []).map(toIssue);
}

// Moves an issue to the status with this name (case-insensitive), using whichever
// transition leads there. Does nothing if it is already in that status.
export async function transitionTo(key, statusName) {
  const issue = await request('GET', `/issue/${key}?fields=status`);
  if (issue.fields.status.name.toLowerCase() === statusName.toLowerCase()) return { changed: false };
  const { transitions } = await request('GET', `/issue/${key}/transitions`);
  const match = transitions.find((t) => t.to?.name?.toLowerCase() === statusName.toLowerCase());
  if (!match) {
    const available = transitions.map((t) => t.to?.name).filter(Boolean).join(', ') || 'none';
    throw new JiraError(`${key} cannot move to "${statusName}" from "${issue.fields.status.name}" (available: ${available})`, 409);
  }
  await request('POST', `/issue/${key}/transitions`, { transition: { id: match.id } });
  return { changed: true, from: issue.fields.status.name };
}

// Adds a paragraph to the end of the description, keeping everything already there.
// Skips the write if the exact line is already present, so re-runs don't duplicate it.
export async function appendToDescription(key, text) {
  const issue = await request('GET', `/issue/${key}?fields=description`);
  const current = issue.fields.description ?? { type: 'doc', version: 1, content: [] };
  if (adfToText(current).includes(text)) return { changed: false };
  const next = { ...current, content: [...(current.content ?? []), paragraph(text)] };
  await request('PUT', `/issue/${key}`, { fields: { description: next } });
  return { changed: true };
}

export async function addComment(key, text) {
  await request('POST', `/issue/${key}/comment`, { body: { type: 'doc', version: 1, content: [paragraph(text)] } });
}
