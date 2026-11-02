// The comment to paste into a Jira ticket after a run, for projects where AgentQA can't update
// Jira itself. Matches what the worker writes when Jira is connected (agent/runTicket.mjs).

// `runUrl` is the run page's address; null leaves the link out. '' for a run that hasn't finished.
export function buildJiraUpdate(run, runUrl) {
  const lines = [];
  const links = [];
  if (run.status === 'PASSED') {
    lines.push(`✅ Automation test created: ${run.specPath?.split('/').pop()}`);
    lines.push(`Verified passing by AgentQA on ${(run.finishedAt ?? new Date().toISOString()).slice(0, 10)}.`);
    const criteria = run.testPlan?.acceptanceCriteria ?? [];
    if (criteria.length) lines.push('', 'Checks:', ...criteria.map((c) => `- ${c}`));
    if (run.prUrl) links.push(`Pull request: ${run.prUrl}`);
  } else if (run.status === 'FAILED') {
    lines.push(`AgentQA could not finish the automation test: ${run.error || 'unknown error'}`);
  } else {
    return '';
  }
  if (runUrl) links.push(`Details: ${runUrl}`);
  return [...lines, ...(links.length ? ['', ...links] : [])].join('\n');
}
