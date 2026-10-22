// Validation shared by the forms (instant feedback) and the API (the real enforcement).
import { ROLES } from './roles.js';

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

function validateUrl(value, { required, label }) {
  const raw = String(value ?? '').trim();
  if (!raw) return required ? { error: `${label} is required` } : { value: '' };
  if (raw.length > 300) return { error: `${label} is too long` };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error('bad');
    return { value: raw };
  } catch {
    return { error: `${label} must be a full link such as https://github.com/org/repo` };
  }
}

// Validates the create/edit project form. Returns { values, errors }.
export function validateProjectInput(input) {
  const errors = {};
  const values = {};

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Project name is required';
  else if (name.length < 2 || name.length > 100) errors.name = 'Project name must be 2 to 100 characters';
  else values.name = name;

  const repo = validateUrl(input.repoUrl, { required: true, label: 'Repository link' });
  if (repo.error) errors.repoUrl = repo.error;
  else values.repoUrl = repo.value;

  const autoRepo = validateUrl(input.automationRepoUrl, { required: false, label: 'Test repository link' });
  if (autoRepo.error) errors.automationRepoUrl = autoRepo.error;
  else values.automationRepoUrl = autoRepo.value;

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
