// Shared by server and client code. The DB stores enum names; the UI shows labels.
export const ROLE_LABEL = {
  ADMIN: 'Admin',
  QA_LEAD: 'QA Lead',
  QA_ENGINEER: 'QA Engineer',
  DEVELOPER: 'Developer',
};

export const ROLE_ENUM = Object.fromEntries(Object.entries(ROLE_LABEL).map(([k, v]) => [v, k]));

export const ROLES = Object.values(ROLE_LABEL);

// One-line summary, shown in the team table and the add/edit user form.
export const ROLE_PERMISSIONS = {
  Admin: 'Everything a QA Lead can do, plus manage users and their roles',
  'QA Lead': 'Manage projects and Jira, approve or reject test designs, run tests',
  'QA Engineer': 'Write requirements, run the QA Agent, codegen scripts and load tests',
  Developer: 'Read-only: view projects, test runs, reports, approvals and the audit log; comment',
};

// What each role is for, shown on the Team tab.
export const ROLE_DESCRIPTIONS = {
  Admin: 'Owns the platform. Manages who has access and with which role, and can do everything else.',
  'QA Lead': 'Runs QA for projects: sets them up, connects Jira, and signs off on what the agent produces.',
  'QA Engineer': 'Does the day-to-day testing work: requirements, agent runs, recorded scripts and load tests.',
  Developer: 'Follows test results for their work. Can see everything and comment, but cannot change anything.',
};

// The permission matrix. Each entry lists the roles (labels) allowed to do it. Keep this in step
// with the guards in src/lib/apiHelpers.js (requireUser / requireAgentOperator /
// requireProjectManager / requireAdmin) and APPROVER_ROLES in src/lib/approvalRules.js.
const ALL = ['Admin', 'QA Lead', 'QA Engineer', 'Developer'];
const OPERATORS = ['Admin', 'QA Lead', 'QA Engineer'];
const MANAGERS = ['Admin', 'QA Lead'];
const ADMINS = ['Admin'];

export const ROLE_CAPABILITIES = [
  {
    area: 'Viewing & collaboration',
    items: [
      { label: 'View dashboard, projects, requirements and Jira tickets', roles: ALL },
      { label: 'View QA Agent runs, codegen scripts, load tests and CI results', roles: ALL },
      { label: 'Download generated tests and Playwright reports', roles: ALL },
      { label: 'View the approvals queue and comment on reviews', roles: ALL },
      { label: 'View the audit trail and export it as CSV or JSON', roles: ALL },
      { label: "View the team list and each member's role", roles: ALL },
    ],
  },
  {
    area: 'Testing work',
    items: [
      { label: 'Add, edit, delete and import (from Jira) requirements', roles: OPERATORS },
      { label: 'Start, cancel and delete QA Agent runs', roles: OPERATORS },
      { label: 'Re-run a generated test (headed or headless)', roles: OPERATORS },
      { label: 'Create, edit, run and delete codegen scripts and recordings', roles: OPERATORS },
      { label: 'Apply a self-healing fix to a codegen script', roles: OPERATORS },
      { label: 'Create, edit, run and delete load tests', roles: OPERATORS },
    ],
  },
  {
    area: 'Projects & review',
    items: [
      { label: 'Create, edit and delete projects', roles: MANAGERS },
      { label: "Set a project's app link and automation repo", roles: MANAGERS },
      { label: 'Connect Jira to a project and test the connection', roles: MANAGERS },
      { label: 'Approve, request changes on, or reject a test design', roles: MANAGERS },
      { label: 'Reopen a rejected or changes-requested review', roles: MANAGERS },
    ],
  },
  {
    area: 'User administration',
    items: [
      { label: 'Invite users and resend invitations', roles: ADMINS },
      { label: "Edit a user's name, email and role", roles: ADMINS },
      { label: 'Disable, re-enable and delete users', roles: ADMINS },
    ],
  },
];

// Guard rails that apply on top of the matrix.
export const ROLE_RULES = [
  'Admins cannot disable or delete their own account.',
  'The last active Admin cannot be demoted, disabled or deleted.',
  'Deleted users are kept in history so their approvals, comments and audit entries keep an author.',
  'Changes requested and rejections must include a reason.',
];
