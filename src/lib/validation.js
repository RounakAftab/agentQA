// Validation shared by the forms (instant feedback) and the API (the real enforcement).
import { ROLES } from './roles.js';
import { PROJECT_KEY_PATTERN } from './agentSteps.js';

// Local part: common RFC 5322 characters. Domain: dot-separated labels, TLD of 2+ letters.
const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function validateEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email) return { error: 'Email is required' };
  if (email.length > 254) return { error: 'Email is too long' };
  const local = email.split('@')[0];
  if (email.includes('..') || local.startsWith('.') || local.endsWith('.')) {
    return { error: 'Enter a valid email address' };
  }
  if (!EMAIL_PATTERN.test(email)) return { error: 'Enter a valid email address' };
  return { value: email };
}

export function validateName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Name is required' };
  if (name.length < 2) return { error: 'Name must be at least 2 characters' };
  if (name.length > 80) return { error: 'Name must be 80 characters or fewer' };
  return { value: name };
}

export function validateRole(value) {
  if (!value) return { error: 'Role is required' };
  if (!ROLES.includes(value)) return { error: 'Choose a valid role' };
  return { value };
}

export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'letter', label: 'Contains a letter', test: (p) => /[A-Za-z]/.test(p) },
  { id: 'number', label: 'Contains a number', test: (p) => /\d/.test(p) },
];

export function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length > 128) return { error: 'Password must be 128 characters or fewer' };
  const failed = PASSWORD_RULES.find((r) => !r.test(value));
  return failed ? { error: `Password needs: ${failed.label.toLowerCase()}` } : { value };
}

// Validates the create/edit user form. Returns { values, errors }.
export function validateUserInput({ name, email, role }) {
  const checks = { name: validateName(name), email: validateEmail(email), role: validateRole(role) };
  const errors = {};
  const values = {};
  for (const [key, result] of Object.entries(checks)) {
    if (result.error) errors[key] = result.error;
    else values[key] = result.value;
  }
  return { values, errors };
}

function validateUrl(value, { required, label, example = 'https://github.com/org/repo' }) {
  const raw = String(value ?? '').trim();
  if (!raw) return required ? { error: `${label} is required` } : { value: '' };
  if (raw.length > 300) return { error: `${label} is too long` };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error('bad');
    return { value: raw };
  } catch {
    return { error: `${label} must be a full link such as ${example}` };
  }
}

// Jira Cloud sites only. Keeping the host to *.atlassian.net also stops the server from being
// pointed at arbitrary internal addresses. A pasted board or ticket link is reduced to the site.
export function validateJiraBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { value: '' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port || url.username || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(url.hostname)) {
      throw new Error('bad');
    }
    return { value: `https://${url.hostname.toLowerCase()}` };
  } catch {
    return { error: 'Use your Jira Cloud site address, such as https://your-team.atlassian.net' };
  }
}

const STATUS_NAME = /^[^\n\r]{1,60}$/;

// The Jira section of the project form. `tokenSaved` says whether a token is already stored
// (and kept), so a blank token field means "keep it". Fills `errors`, returns the values.
export function validateJiraFields(input, errors, { tokenSaved = false } = {}) {
  const values = {};

  const base = validateJiraBaseUrl(input.jiraBaseUrl);
  if (base.error) errors.jiraBaseUrl = base.error;
  else values.jiraBaseUrl = base.value || null;

  const rawEmail = String(input.jiraEmail ?? '').trim();
  if (rawEmail) {
    const email = validateEmail(rawEmail);
    if (email.error) errors.jiraEmail = email.error;
    else values.jiraEmail = email.value;
  } else values.jiraEmail = null;

  const token = String(input.jiraApiToken ?? '').trim();
  if (token.length > 500) errors.jiraApiToken = 'API token is too long';
  else values.jiraApiToken = token;
  values.clearJiraApiToken = Boolean(input.clearJiraApiToken);

  const key = String(input.jiraProjectKey ?? '').trim().toUpperCase();
  if (key && !PROJECT_KEY_PATTERN.test(key)) errors.jiraProjectKey = 'Use the Jira project key, such as SCRUM';
  else values.jiraProjectKey = key || null;

  for (const field of ['jiraStatusInProgress', 'jiraStatusDone']) {
    const v = String(input[field] ?? '').trim();
    if (v && !STATUS_NAME.test(v)) errors[field] = 'Status names are up to 60 characters';
    else values[field] = v || null;
  }

  // All or nothing: a half-filled connection can't be used.
  const hasToken = Boolean(token) || tokenSaved;
  const filled = [values.jiraBaseUrl, values.jiraEmail, hasToken, values.jiraProjectKey];
  if (filled.some(Boolean) && !filled.every(Boolean)) {
    if (!values.jiraBaseUrl && !errors.jiraBaseUrl) errors.jiraBaseUrl = 'Jira site address is required to connect Jira';
    if (!values.jiraEmail && !errors.jiraEmail) errors.jiraEmail = 'Account email is required to connect Jira';
    if (!hasToken && !errors.jiraApiToken) errors.jiraApiToken = 'API token is required to connect Jira';
    if (!values.jiraProjectKey && !errors.jiraProjectKey) errors.jiraProjectKey = 'Project key is required to connect Jira';
  }
  return values;
}

export const REQUIREMENT_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// A requirement written in AgentQA (instead of a Jira ticket). Returns { values, errors }.
export function validateRequirementInput(input) {
  const errors = {};
  const values = {};
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  if (title.length < 3) errors.title = 'Give the requirement a title of at least 3 characters';
  else if (title.length > 200) errors.title = 'Title must be 200 characters or fewer';
  else values.title = title;

  const description = String(input.description ?? '').trim();
  if (description.length < 20) errors.description = 'Describe the user flow and what should happen (at least 20 characters)';
  else if (description.length > 20000) errors.description = 'Requirement text must be 20,000 characters or fewer';
  else values.description = description;

  const priority = String(input.priority ?? 'medium').toLowerCase();
  values.priority = REQUIREMENT_PRIORITIES.includes(priority) ? priority : 'medium';
  return { values, errors };
}

// Validates the create/edit project form. Returns { values, errors }.
export function validateProjectInput(input) {
  const errors = {};
  const values = {};

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Project name is required';
  else if (name.length < 2 || name.length > 100) errors.name = 'Project name must be 2 to 100 characters';
  else values.name = name;

  const repo = validateUrl(input.repoUrl, { required: false, label: 'Source repository link' });
  if (repo.error) errors.repoUrl = repo.error;
  else values.repoUrl = repo.value || null;

  const autoRepo = validateUrl(input.automationRepoUrl, { required: false, label: 'Test repository link' });
  if (autoRepo.error) errors.automationRepoUrl = autoRepo.error;
  else values.automationRepoUrl = autoRepo.value;

  const appUrl = validateUrl(input.appBaseUrl, { required: false, label: 'App link', example: 'https://staging.your-app.com' });
  if (appUrl.error) errors.appBaseUrl = appUrl.error;
  else values.appBaseUrl = appUrl.value || null;

  Object.assign(values, validateJiraFields(input, errors, { tokenSaved: Boolean(input.jiraTokenSet) && !input.clearJiraApiToken }));

  const e2eUsername = String(input.e2eUsername ?? '').trim();
  if (e2eUsername.length > 200) errors.e2eUsername = 'Username is too long';
  else values.e2eUsername = e2eUsername || null;
  const e2ePassword = String(input.e2ePassword ?? '');
  if (e2ePassword.length > 200) errors.e2ePassword = 'Password is too long';
  else values.e2ePassword = e2ePassword;
  values.clearE2ePassword = Boolean(input.clearE2ePassword);

  const description = String(input.description ?? '').trim();
  if (description.length > 500) errors.description = 'Description must be 500 characters or fewer';
  else values.description = description;

  for (const [key, label] of [['language', 'Language'], ['framework', 'Framework']]) {
    const v = String(input[key] ?? '').trim();
    if (v.length > 60) errors[key] = `${label} must be 60 characters or fewer`;
    else values[key] = v;
  }

  const branch = String(input.defaultBranch ?? '').trim() || 'main';
  if (!/^[\w./-]{1,100}$/.test(branch)) errors.defaultBranch = 'Branch name has invalid characters';
  else values.defaultBranch = branch;

  values.memberIds = Array.isArray(input.memberIds) ? [...new Set(input.memberIds.filter((id) => typeof id === 'string'))] : [];

  return { values, errors };
}
