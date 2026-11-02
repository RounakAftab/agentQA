// Static checks on a generated spec. These enforce the QA Agent rules in code, so a spec
// that breaks them is rejected even if the model ignores its instructions.

// Values that must never appear in a test file.
const SECRET_ENV = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'SESSION_SECRET', 'ENCRYPTION_KEY'];

const count = (text, re) => (text.match(re) ?? []).length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The password must never appear. The username often doubles as visible text (OrangeHRM's
// "Admin" is also a menu item), so it only counts as hardcoded where it is typed into a
// field, assigned to a user/login variable or used as an env fallback.
function leaksCredentials(content, { username, password } = {}) {
  if (password && password.length >= 4 && content.includes(password)) return true;
  if (!username || username.length < 4) return false;
  const quoted = `['"\`]${escapeRe(username)}['"\`]`;
  return (
    new RegExp(`\\.(fill|type|pressSequentially)\\([^)]*${quoted}`).test(content) ||
    new RegExp(`\\b(user(name)?|login|email)\\w*\\s*[:=]\\s*${quoted}`, 'i').test(content) ||
    new RegExp(`(\\?\\?|\\|\\|)\\s*${quoted}`).test(content)
  );
}

// Rules for any file the agent writes: specs and page objects.
function checkCommon(content, credentials, errors, warnings) {
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
  if (leaksCredentials(content, credentials)) {
    errors.push('The test account username or password is written into the file. Read them from process.env.E2E_USERNAME and process.env.E2E_PASSWORD.');
  }
  if (/(password|passwd|secret|token)\w*\s*[:=]\s*['"`][^'"`\s]{3,}['"`]/i.test(content)) {
    errors.push('A credential appears to be hardcoded. Read credentials from process.env (E2E_USERNAME, E2E_PASSWORD).');
  }
  if (/\.locator\(\s*['"`][.#\[]/.test(content)) {
    warnings.push('CSS locators found. Prefer role-based selectors where the page allows it.');
  }
  if (/waitForTimeout\s*\(/.test(content)) {
    warnings.push('waitForTimeout() makes tests slow and flaky. Wait for a visible element or URL instead.');
  }
}

// Folders page objects live in. A path is a page object when one of its folders has one of these names.
const PAGE_DIRS = new Set(['pages', 'page-objects', 'pageobjects', 'pom', 'poms']);
export const DEFAULT_PAGES_DIR = 'tests/pages';

// Why the agent may not write a page object at `rel` (repository-relative), or null.
export function pageObjectPathProblem(rel) {
  const parts = String(rel ?? '').replace(/\\/g, '/').split('/');
  if (!rel || rel.startsWith('/') || /^[a-z]:/i.test(rel) || parts.some((p) => p === '..' || p === '.' || p === '')) {
    return 'Use a path relative to the repository root, such as tests/pages/LoginPage.ts.';
  }
  if (parts.some((p) => ['node_modules', '.git', '.agentqa'].includes(p))) return 'That folder is not writable.';
  if (!parts.slice(0, -1).some((p) => PAGE_DIRS.has(p.toLowerCase()))) {
    return `Page objects go in a pages folder: ${DEFAULT_PAGES_DIR}/, or the repository's own page-object folder.`;
  }
  const file = parts.at(-1);
  if (!/^[A-Za-z0-9_.-]+\.(ts|js|mjs)$/.test(file)) return 'Page object files must be .ts, .js or .mjs.';
  if (/\.(spec|test)\.\w+$/.test(file)) return 'A page object must not be named like a test (.spec / .test).';
  return null;
}

// A page object: locators and actions for one page. No tests in it.
export function checkPageObject(content, credentials = {}) {
  const errors = [];
  const warnings = [];
  checkCommon(content, credentials, errors, warnings);
  if (/(?<![.\w])test(\.step)?\s*\(/.test(content) || /(?<![.\w])test\.(describe|only|skip)\b/.test(content)) {
    errors.push('A page object holds locators and actions only. Keep test() and test.step() in the spec.');
  }
  if (!/\bclass\s+\w+/.test(content)) errors.push('Write the page object as a class (e.g. export class LoginPage { constructor(page) {...} }).');
  return { errors, warnings };
}

// `credentials` is the project's test account: { username, password }. With `pom`, the spec must
// get every locator from page objects.
export function checkSpec(content, plan, credentials = {}, { pom = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!/from\s+['"]@playwright\/test['"]/.test(content)) {
    errors.push("Import test and expect from '@playwright/test'.");
  }
  checkCommon(content, credentials, errors, warnings);

  if (pom) {
    const imports = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (!imports.some((m) => m.split('/').some((p) => PAGE_DIRS.has(p.toLowerCase())))) {
      errors.push(`Use the Page Object Model: import the page objects (e.g. from '../pages/LoginPage') and use them in the test.`);
    }
    if (/\bpage\s*\.\s*(getBy\w+|locator|frameLocator|\$\$?)\s*\(/.test(content)) {
      errors.push('Locators belong in page objects. Replace page.getBy...()/page.locator() in the spec with page-object members.');
    }
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

  if (/test\.(only|skip)\s*\(/.test(content)) {
    errors.push('Remove test.only / test.skip.');
  }

  return { errors, warnings };
}
