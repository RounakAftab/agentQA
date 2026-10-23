// Static checks on a generated spec. These enforce the QA Agent rules in code, so a spec
// that breaks them is rejected even if the model ignores its instructions.

// Values that must never appear in a test file.
const SECRET_ENV = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'SESSION_SECRET', 'ENCRYPTION_KEY'];

const count = (text, re) => (text.match(re) ?? []).length;

// `secrets` are extra values that must not appear, such as the project's test account.
export function checkSpec(content, plan, secrets = []) {
  const errors = [];
  const warnings = [];

  if (!/from\s+['"]@playwright\/test['"]/.test(content)) {
    errors.push("Import test and expect from '@playwright/test'.");
  }

  // XPath in any form: xpath= engine, page.$x, or a locator string starting with / or (.
  if (/xpath\s*=/i.test(content) || /\$x\s*\(/.test(content) || /locator\(\s*['"`]\s*(\/|\.\.\/|\(\s*\/)/.test(content)) {
    errors.push('XPath selectors are not allowed. Use getByRole, getByLabel, getByPlaceholder or getByText.');
  }

  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 4 && content.includes(value)) {
      errors.push(`The value of ${name} is written into the file. Read it from process.env.${name} instead.`);
    }
  }
  if (secrets.some((value) => value && value.length >= 4 && content.includes(value))) {
    errors.push('The test account username or password is written into the file. Read them from process.env.E2E_USERNAME and process.env.E2E_PASSWORD.');
  }
  if (/(password|passwd|secret|token)\w*\s*[:=]\s*['"`][^'"`\s]{3,}['"`]/i.test(content)) {
    errors.push('A credential appears to be hardcoded. Read credentials from process.env (E2E_USERNAME, E2E_PASSWORD).');
  }

  const steps = count(content, /\btest\.step\s*\(/g);
  const asserts = count(content, /\bexpect(\.soft)?\s*\(/g);
  if (plan) {
    if (steps < plan.steps.length) {
      errors.push(`The ticket has ${plan.steps.length} steps but the spec has ${steps} test.step() blocks. Mirror every step.`);
    }
    if (asserts < plan.acceptanceCriteria.length) {
      errors.push(
        `The ticket has ${plan.acceptanceCriteria.length} acceptance criteria but the spec has ${asserts} expect() assertions. Assert every criterion.`
      );
    }
  } else if (steps === 0) {
    errors.push('Structure the test with test.step() blocks that mirror the Jira steps.');
  }

  if (/\.locator\(\s*['"`][.#\[]/.test(content)) {
    warnings.push('CSS locators found. Prefer role-based selectors where the page allows it.');
  }
  if (/waitForTimeout\s*\(/.test(content)) {
    warnings.push('waitForTimeout() makes tests slow and flaky. Wait for a visible element or URL instead.');
  }
  if (/test\.(only|skip)\s*\(/.test(content)) {
    errors.push('Remove test.only / test.skip.');
  }

  return { errors, warnings };
}
