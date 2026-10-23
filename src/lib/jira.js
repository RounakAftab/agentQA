// Jira Cloud REST v3 client, used by the API routes (reading tickets, testing a connection)
// and the QA Agent worker (status changes and notes). Server-only. Each project has its own
// connection (site, email, encrypted API token), set in the project settings.
//
// Deliberately has no "set description" function. Descriptions are append-only, so a run
// can never overwrite what people wrote on a ticket.
import { ISSUE_KEY_PATTERN, PROJECT_KEY_PATTERN } from './agentSteps.js';
import { decryptSecret } from './secrets.js';

export const DEFAULT_STATUS_IN_PROGRESS = 'In Progress';
export const DEFAULT_STATUS_DONE = 'Done';

export class JiraError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const trimBase = (url) => String(url ?? '').replace(/\/+$/, '');

export const issueUrl = (baseUrl, key) => `${trimBase(baseUrl)}/browse/${key}`;

// True when a project has everything needed to talk to Jira.
export const isProjectJiraConnected = (project) =>
  Boolean(project?.jiraBaseUrl && project.jiraEmail && project.jiraApiTokenEnc && project.jiraProjectKey);

const STATUS_HINTS = {
  401: 'Jira rejected the email or API token. Check both, or create a new token.',
  403: 'This Jira account does not have permission for that action or project.',
  404: 'Jira could not find that site, project or ticket. Check the site address and project key.',
};

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

const ISSUE_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated', 'description'];

// A client bound to one Jira site and account.
export function createJiraClient({ baseUrl, email, apiToken }) {
  const base = trimBase(baseUrl);
  if (!base || !email || !apiToken) throw new JiraError('Jira is not connected for this project.', 0);
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(`${base}/rest/api/3${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new JiraError(`Could not reach ${base}: ${err.cause?.code ?? err.message}`, 0);
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.errorMessages?.join(' ') || Object.values(data?.errors ?? {}).join(' ') || res.statusText;
      throw new JiraError(`Jira ${res.status}: ${STATUS_HINTS[res.status] ?? detail}`, res.status);
    }
    return data;
  }

  const toIssue = (raw) => {
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
      url: issueUrl(base, raw.key),
    };
  };

  return {
    // Checks the account and project, and lists the project's status names.
    async verify(projectKey) {
      const me = await request('GET', '/myself');
      if (!PROJECT_KEY_PATTERN.test(projectKey ?? '')) return { account: me.displayName, project: null, statuses: [] };
      const project = await request('GET', `/project/${projectKey}`);
      const statusGroups = await request('GET', `/project/${projectKey}/statuses`).catch(() => []);
      const statuses = [...new Set(statusGroups.flatMap((g) => (g.statuses ?? []).map((s) => s.name)))];
      return { account: me.displayName, project: { key: project.key, name: project.name }, statuses };
    },

    async getIssue(key) {
      if (!ISSUE_KEY_PATTERN.test(key)) throw new JiraError(`"${key}" is not a Jira issue key`, 400);
      return toIssue(await request('GET', `/issue/${key}?fields=${ISSUE_FIELDS.join(',')}`));
    },

    // Open tickets in a project, most recently updated first.
    async listOpenIssues(projectKey, { max = 50 } = {}) {
      if (!PROJECT_KEY_PATTERN.test(projectKey)) throw new JiraError(`"${projectKey}" is not a Jira project key`, 400);
      const data = await request('POST', '/search/jql', {
        jql: `project = "${projectKey}" AND statusCategory != Done ORDER BY updated DESC`,
        fields: ISSUE_FIELDS,
        maxResults: max,
      });
      return (data.issues ?? []).map(toIssue);
    },

    // Moves an issue to the status with this name (case-insensitive), using whichever
    // transition leads there. Does nothing if it is already in that status.
    async transitionTo(key, statusName) {
      const issue = await request('GET', `/issue/${key}?fields=status`);
      if (issue.fields.status.name.toLowerCase() === statusName.toLowerCase()) return { changed: false };
      const { transitions } = await request('GET', `/issue/${key}/transitions`);
      const match = transitions.find((t) => t.to?.name?.toLowerCase() === statusName.toLowerCase());
      if (!match) {
        const available = transitions.map((t) => t.to?.name).filter(Boolean).join(', ') || 'none';
        throw new JiraError(
          `${key} cannot move to "${statusName}" from "${issue.fields.status.name}" (available: ${available}). Check the status names in the project's Jira settings.`,
          409
        );
      }
      await request('POST', `/issue/${key}/transitions`, { transition: { id: match.id } });
      return { changed: true, from: issue.fields.status.name };
    },

    // Adds a paragraph to the end of the description, keeping everything already there.
    // Skips the write if the exact line is already present, so re-runs don't duplicate it.
    async appendToDescription(key, text) {
      const issue = await request('GET', `/issue/${key}?fields=description`);
      const current = issue.fields.description ?? { type: 'doc', version: 1, content: [] };
      if (adfToText(current).includes(text)) return { changed: false };
      const next = { ...current, content: [...(current.content ?? []), paragraph(text)] };
      await request('PUT', `/issue/${key}`, { fields: { description: next } });
      return { changed: true };
    },

    async addComment(key, text) {
      await request('POST', `/issue/${key}/comment`, { body: { type: 'doc', version: 1, content: [paragraph(text)] } });
    },
  };
}

// The client for a project row from the database (decrypts its stored token).
export function jiraForProject(project) {
  if (!isProjectJiraConnected(project)) throw new JiraError('Jira is not connected for this project. Open the project settings to connect it.', 0);
  return createJiraClient({ baseUrl: project.jiraBaseUrl, email: project.jiraEmail, apiToken: decryptSecret(project.jiraApiTokenEnc) });
}

export const jiraStatusesFor = (project) => ({
  inProgress: project.jiraStatusInProgress || DEFAULT_STATUS_IN_PROGRESS,
  done: project.jiraStatusDone || DEFAULT_STATUS_DONE,
});
