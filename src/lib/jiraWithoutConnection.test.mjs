// node --test src/lib/jiraWithoutConnection.test.mjs
// Working with Jira tickets in a project that has no Jira connection: CSV import, ticket keys on
// requirements, and the update to paste back into Jira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, issuesFromJiraCsv, importProblem, mapPriority, MAX_IMPORT_ROWS } from './jiraCsv.js';
import { validateRequirementInput } from './validation.js';
import { isManualKey, publicRequirement, requirementColumns } from './requirements.js';
import { buildJiraUpdate } from './jiraUpdate.js';

const DESCRIPTION = 'Open /login, sign in with a valid user and see the Dashboard heading.';

test('parseCsv handles quotes, commas, newlines and a BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","line 1\nline 2","say ""hi"""\n\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'line 1\nline 2', 'say "hi"'],
  ]);
});

test('issuesFromJiraCsv reads a Jira export, appends acceptance criteria and maps priority', () => {
  const csv = [
    'Summary,Issue key,Issue id,Issue Type,Status,Priority,Description,Custom field (Acceptance Criteria),Labels,Labels',
    `User logs in,scrum-12,10012,Story,To Do,Highest,"${DESCRIPTION}","- Dashboard heading is visible\n- No error shown",ui,login`,
    'Export report,SCRUM-13,10013,Task,In Progress,Low,,,,',
  ].join('\n');
  const { issues, error } = issuesFromJiraCsv(csv);
  assert.equal(error, '');
  assert.equal(issues.length, 2);
  assert.deepEqual(issues[0], {
    key: 'SCRUM-12',
    title: 'User logs in',
    description: `${DESCRIPTION}\n\nAcceptance criteria:\n- Dashboard heading is visible\n- No error shown`,
    priority: 'critical',
    status: 'To Do',
    type: 'Story',
  });
  assert.equal(issues[1].description, '');
  assert.equal(issues[1].priority, 'low');
});

test('issuesFromJiraCsv explains files it cannot use', () => {
  assert.match(issuesFromJiraCsv('').error, /empty/);
  assert.match(issuesFromJiraCsv('Name,Email\nA,b@c.d').error, /Issue key/);
  assert.match(issuesFromJiraCsv('Summary,Issue key\n').error, /no tickets/);
  const big = ['Summary,Issue key', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `T,A-${i + 1}`)].join('\n');
  assert.match(issuesFromJiraCsv(big).error, /at most/);
});

test('importProblem gives one short reason per skipped ticket', () => {
  const good = { key: 'SCRUM-1', title: 'User logs in', description: DESCRIPTION };
  assert.equal(importProblem(good, new Set()), '');
  assert.equal(importProblem(good, new Set(['SCRUM-1'])), 'Already in this project');
  assert.equal(importProblem({ ...good, key: '' }, new Set()), 'No issue key');
  assert.match(importProblem({ ...good, description: 'Broken' }, new Set()), /too short/);
  assert.match(importProblem({ ...good, key: 'REQ-1' }, new Set()), /not a Jira key/);
});

test('mapPriority falls back to medium', () => {
  assert.equal(mapPriority('Blocker'), 'critical');
  assert.equal(mapPriority('Major'), 'high');
  assert.equal(mapPriority(''), 'medium');
  assert.equal(mapPriority('P1'), 'medium');
});

test('validateRequirementInput accepts an optional Jira key and ticket link', () => {
  const base = { title: 'User logs in', description: DESCRIPTION };
  assert.equal(validateRequirementInput(base).values.jiraKey, null);
  const ok = validateRequirementInput({ ...base, jiraKey: ' scrum-12 ', ticketUrl: 'https://team.atlassian.net/browse/SCRUM-12' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.jiraKey, 'SCRUM-12');
  assert.equal(ok.values.ticketUrl, 'https://team.atlassian.net/browse/SCRUM-12');
  assert.ok(validateRequirementInput({ ...base, jiraKey: 'SCRUM12' }).errors.jiraKey);
  assert.ok(validateRequirementInput({ ...base, jiraKey: 'REQ-4' }).errors.jiraKey, 'REQ-n stays AgentQA numbering');
  assert.ok(validateRequirementInput({ ...base, ticketUrl: 'javascript:alert(1)' }).errors.ticketUrl);
});

test('requirementColumns builds the ticket link from the project Jira site when none is given', () => {
  const values = { title: 'T', description: DESCRIPTION, priority: 'high', jiraKey: 'SCRUM-12', ticketUrl: null };
  assert.equal(requirementColumns(values, { jiraBaseUrl: 'https://team.atlassian.net/' }).sourceUrl, 'https://team.atlassian.net/browse/SCRUM-12');
  assert.equal(requirementColumns(values, { jiraBaseUrl: null }).sourceUrl, null);
  assert.equal(requirementColumns({ ...values, ticketUrl: 'https://x.io/t/1' }, { jiraBaseUrl: 'https://team.atlassian.net' }).sourceUrl, 'https://x.io/t/1');
  assert.equal(requirementColumns({ ...values, jiraKey: null }, { jiraBaseUrl: 'https://team.atlassian.net' }).sourceUrl, null);
});

test('publicRequirement reports the Jira key of a manual requirement only', () => {
  const row = { id: '1', title: 'T', priority: 'medium', status: 'open', generatedTests: 0, createdAt: new Date(), updatedAt: new Date() };
  assert.equal(publicRequirement({ ...row, key: 'SCRUM-12', source: 'manual', sourceUrl: 'https://t.atlassian.net/browse/SCRUM-12' }).jiraKey, 'SCRUM-12');
  assert.equal(publicRequirement({ ...row, key: 'REQ-3', source: 'manual' }).jiraKey, null);
  assert.equal(publicRequirement({ ...row, key: 'SCRUM-12', source: 'jira' }).jiraKey, null);
  assert.ok(isManualKey('REQ-10'));
  assert.ok(!isManualKey('REQ-1A'));
});

test('buildJiraUpdate: a passed run lists the checks and links', () => {
  const run = {
    status: 'PASSED',
    specPath: 'tests/generated/scrum_12.spec.ts',
    finishedAt: '2026-11-02T10:00:00.000Z',
    prUrl: 'https://github.com/org/tests/pull/7',
    testPlan: { acceptanceCriteria: ['Dashboard heading is visible', 'No error shown'] },
  };
  assert.equal(
    buildJiraUpdate(run, 'https://qa.example.com/dashboard/qa-agent/runs/abc'),
    [
      '✅ Automation test created: scrum_12.spec.ts',
      'Verified passing by AgentQA on 2026-11-02.',
      '',
      'Checks:',
      '- Dashboard heading is visible',
      '- No error shown',
      '',
      'Pull request: https://github.com/org/tests/pull/7',
      'Details: https://qa.example.com/dashboard/qa-agent/runs/abc',
    ].join('\n')
  );
  assert.equal(buildJiraUpdate({ ...run, prUrl: null, testPlan: null }, null), '✅ Automation test created: scrum_12.spec.ts\nVerified passing by AgentQA on 2026-11-02.');
});

test('buildJiraUpdate: a failed run gives the reason; an unfinished run gives nothing', () => {
  assert.equal(
    buildJiraUpdate({ status: 'FAILED', error: 'Verification run failed' }, 'https://qa.example.com/r/1'),
    'AgentQA could not finish the automation test: Verification run failed\n\nDetails: https://qa.example.com/r/1'
  );
  assert.equal(buildJiraUpdate({ status: 'RUNNING' }, null), '');
});
