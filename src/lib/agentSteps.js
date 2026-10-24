// The QA Agent pipeline, shared by the worker (which reports progress) and the run page
// (which draws the timeline). Order matters: a run's `step` is the one in progress.
// Steps that don't apply to a run (no Jira for a manual requirement, no test repository)
// are recorded in the run's `skippedSteps`.
export const AGENT_STEPS = [
  { id: 'jira.read', label: 'Read Jira ticket', manualLabel: 'Read requirement' },
  { id: 'jira.in_progress', label: 'Move to In Progress', jiraOnly: true },
  { id: 'workspace', label: 'Prepare test project' },
  { id: 'agent', label: 'Plan, inspect page and write test' },
  { id: 'verify', label: 'Verify test passes' },
  { id: 'heal', label: 'Heal failing test' }, // only when verification fails
  { id: 'publish', label: 'Commit and open pull request' },
  { id: 'jira.done', label: 'Append note and move to Done', manualLabel: 'Save results' },
];

export const stepLabel = (step, source) => (source === 'manual' && step.manualLabel) || step.label;

export const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];

// "SCRUM-12" -> "tests/generated/scrum_12.spec.ts"
export const specPathFor = (issueKey) => `tests/generated/${issueKey.toLowerCase().replace(/-/g, '_')}.spec.ts`;

export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,9}-\d{1,7}$/;
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,9}$/;

// Keys for requirements written in AgentQA: REQ-1, REQ-2, ...
export const MANUAL_KEY_PREFIX = 'REQ';

// A worker that has not checked in for this long is treated as stopped.
export const WORKER_STALE_MS = 60_000;
