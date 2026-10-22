// Shared by server and client code. The DB stores enum names; the UI shows labels.
export const ROLE_LABEL = {
  ADMIN: 'Admin',
  QA_LEAD: 'QA Lead',
  QA_ENGINEER: 'QA Engineer',
  DEVELOPER: 'Developer',
};

export const ROLE_ENUM = Object.fromEntries(Object.entries(ROLE_LABEL).map(([k, v]) => [v, k]));

export const ROLES = Object.values(ROLE_LABEL);

export const ROLE_PERMISSIONS = {
  Admin: 'Full platform control, Keycloak realm admin, Audit export',
  'QA Lead': 'Human-in-the-loop approval, Pipeline trigger, CI failure triage',
  'QA Engineer': 'View pipelines, Submit comments, Execute test runs',
  Developer: 'View test designs, CI run reports, Draft PR links',
};
