// node --test agent/pom.test.mjs
// The Page Object Model rules the QA Agent's files are held to, and the files saved with a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPageObject, checkSpec, pageObjectPathProblem } from './guardrails.mjs';
import { collectSpecFiles, relativeImports } from './pomFiles.mjs';

const PLAN = { flow: 'Log in', steps: ['Open the login page', 'Log in'], acceptanceCriteria: ['Dashboard is shown'] };

const LOGIN_PAGE = `import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  readonly username: Locator;
  readonly password: Locator;
  readonly submit: Locator;

  constructor(private readonly page: Page) {
    this.username = page.getByLabel('Username');
    this.password = page.getByLabel('Password');
    this.submit = page.getByRole('button', { name: 'Login' });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(username: string, password: string) {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }
}
`;

const POM_SPEC = `import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

test('SCRUM-12 user logs in', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  await test.step('Open the login page', async () => {
    await login.goto();
  });
  await test.step('Log in', async () => {
    await login.login(process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
  });
  await expect(dashboard.heading).toBeVisible();
  await expect(page).toHaveURL(/dashboard/);
});
`;

test('a spec that uses page objects passes the POM rules', () => {
  assert.deepEqual(checkSpec(POM_SPEC, PLAN, {}, { pom: true }).errors, []);
});

test('a spec with its own locators or no page objects is rejected', () => {
  const inline = POM_SPEC.replace('await login.goto();', "await page.getByRole('link', { name: 'Login' }).click();");
  assert.ok(checkSpec(inline, PLAN, {}, { pom: true }).errors.some((e) => e.includes('Locators belong in page objects')));
  const noImports = POM_SPEC.replace(/import \{ \w+Page \} from '\.\.\/pages\/\w+';\n/g, '');
  assert.ok(checkSpec(noImports, PLAN, {}, { pom: true }).errors.some((e) => e.includes('Page Object Model')));
  // Without the pom option (Codegen's plain style) the same spec is fine.
  assert.deepEqual(checkSpec(inline, PLAN).errors, []);
});

test('page objects: class only, no tests, same secret rules', () => {
  assert.deepEqual(checkPageObject(LOGIN_PAGE).errors, []);
  assert.ok(checkPageObject(`${LOGIN_PAGE}\ntest('x', async () => {});`).errors.some((e) => e.includes('locators and actions only')));
  assert.ok(checkPageObject('export function login(page) { return page.getByLabel("User"); }').errors.some((e) => e.includes('class')));
  assert.ok(checkPageObject(LOGIN_PAGE.replace("'/login'", "'/login'); const password = 'hunter22'; (0")).errors.length > 0);
  assert.ok(checkPageObject(LOGIN_PAGE.replace("getByLabel('Username')", "locator('xpath=//input')")).errors.some((e) => e.includes('XPath')));
  // A regex .test() call is not a test.
  assert.deepEqual(checkPageObject(`${LOGIN_PAGE}\nconst ok = /x/.test('x');`).errors, []);
});

test('page object paths stay inside a pages folder of the repository', () => {
  assert.equal(pageObjectPathProblem('tests/pages/LoginPage.ts'), null);
  assert.equal(pageObjectPathProblem('src/page-objects/admin/Users.ts'), null);
  assert.equal(pageObjectPathProblem('tests\\pages\\LoginPage.ts'), null);
  assert.match(pageObjectPathProblem('tests/LoginPage.ts'), /pages folder/);
  assert.match(pageObjectPathProblem('../pages/LoginPage.ts'), /relative to the repository root/);
  assert.match(pageObjectPathProblem('/etc/pages/x.ts'), /relative/);
  assert.match(pageObjectPathProblem('node_modules/pages/x.ts'), /not writable/);
  assert.match(pageObjectPathProblem('tests/pages/login.spec.ts'), /named like a test/);
  assert.match(pageObjectPathProblem('tests/pages/LoginPage.json'), /\.ts, \.js/);
});

test('relativeImports finds local imports only', () => {
  const source = `import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
export * from './helpers';
import './setup';
const x = await import('../pages/Lazy');`;
  assert.deepEqual(relativeImports(source), ['../pages/LoginPage', './helpers', './setup', '../pages/Lazy']);
});

test('collectSpecFiles follows page objects and their imports, inside the workspace only', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pom-'));
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  };
  await write('tests/generated/scrum_12.spec.ts', POM_SPEC + "\nimport '../../../outside';\n");
  await write('tests/pages/LoginPage.ts', `import { BasePage } from './BasePage';\n${LOGIN_PAGE}`);
  await write('tests/pages/BasePage.ts', 'export class BasePage {}\n');
  await write('tests/pages/DashboardPage.ts', 'export class DashboardPage {}\n');
  await write('tests/pages/Unused.ts', 'export class Unused {}\n');
  try {
    const files = await collectSpecFiles(dir, 'tests/generated/scrum_12.spec.ts');
    assert.deepEqual(Object.keys(files).sort(), ['tests/pages/BasePage.ts', 'tests/pages/DashboardPage.ts', 'tests/pages/LoginPage.ts']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
