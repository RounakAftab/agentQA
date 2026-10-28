// node --test src/lib/codegen/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodegen } from './parse.js';
import { emitPlain, emitPom, pageGroups } from './emit.js';
import { buildProject, checkCode } from './bundle.js';
import { classNameFromUrl } from './naming.js';

const LOGIN = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');
  await page.getByRole('textbox', { name: 'Username' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill('Admin');
  await page.getByRole('textbox', { name: 'Password' }).fill('admin123');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page).toHaveURL(/admin/);
});
`;

const TODO = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://demo.playwright.dev/todomvc/#/');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('milk');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('bread');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
  await page.getByRole('listitem').filter({ hasText: 'milk' }).getByLabel('Toggle Todo').check();
  await expect(page.getByTestId('todo-title').first()).toContainText('milk');
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Real TodoMVC' }).click();
  const page1 = await page1Promise;
  await page1.getByRole('link', { name: 'React' }).click();
  page.once('dialog', dialog => {
    console.log(\`Dialog message: \${dialog.message()}\`);
    dialog.dismiss().catch(() => {});
  });
  await page.keyboard.press('Escape');
});
`;

const script = (source, title = 'Login flow') => ({ title, recording: parseCodegen(source), edits: {} });

test('parses actions, assertions and the start URL', () => {
  const rec = parseCodegen(LOGIN);
  assert.deepEqual(rec.errors, []);
  assert.equal(rec.startUrl, 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login');
  assert.deepEqual(rec.steps.map((s) => s.kind), ['goto', 'action', 'action', 'action', 'action', 'assert', 'action', 'assert']);
  const login = rec.steps[4];
  assert.equal(login.locator, "getByRole('button', { name: 'Login' })");
  assert.deepEqual([login.words, login.suffix], [['login'], 'Button']);
  assert.equal(rec.steps[7].locator, null);
  assert.equal(rec.steps[7].matcher, '.toHaveURL(/admin/)');
});

test('replaces typed credentials before anything is stored', () => {
  const rec = parseCodegen(LOGIN);
  assert.deepEqual(rec.secrets, ['E2E_USERNAME', 'E2E_PASSWORD']);
  assert.ok(!rec.source.includes('admin123'));
  assert.ok(!rec.source.includes("fill('Admin')"));
  assert.ok(rec.source.includes("getByRole('link', { name: 'Admin' })"), 'locator text is left alone');
  assert.equal(rec.steps[3].args[0], 'process.env.E2E_PASSWORD!');
});

test('leaves form values alone when there is no password field', () => {
  const rec = parseCodegen(TODO);
  assert.deepEqual(rec.secrets, []);
  assert.ok(rec.source.includes("fill('milk')"));
});

test('keeps statements it does not understand as raw steps', () => {
  const raw = parseCodegen(TODO).steps.filter((s) => s.kind === 'raw').map((s) => s.source.split('\n')[0]);
  assert.deepEqual(raw, [
    "const page1Promise = page.waitForEvent('popup');",
    'const page1 = await page1Promise;',
    "page.once('dialog', dialog => {",
    "await page.keyboard.press('Escape');",
  ]);
});

test('rejects other languages and empty input with a clear message', () => {
  assert.match(parseCodegen('from playwright.sync_api import Page\n').errors[0], /Python/);
  assert.match(parseCodegen('').errors[0], /Paste/);
  assert.match(parseCodegen("test('x', async ({ page }) => {\n});").errors[0], /no recorded steps/);
  assert.match(parseCodegen('test(').errors[0], /line 1/);
});

test('names pages from URLs', () => {
  assert.equal(classNameFromUrl('https://x.test/web/index.php/auth/login'), 'LoginPage');
  assert.equal(classNameFromUrl('https://x.test/'), 'HomePage');
  assert.equal(classNameFromUrl('https://x.test/orders/12345/edit-items'), 'EditItemsPage');
  assert.equal(classNameFromUrl('https://demo.playwright.dev/todomvc/#/completed'), 'CompletedPage');
});

test('plain spec uses relative URLs and env credentials', () => {
  const files = emitPlain(script(LOGIN));
  const spec = files['tests/login-flow.spec.ts'];
  assert.ok(spec.includes("await page.goto('/web/index.php/auth/login');"));
  assert.ok(spec.includes('.fill(process.env.E2E_PASSWORD!)'));
  assert.ok(spec.includes("test('Login flow', async ({ page }) => {"));
});

test('POM groups locators into a class and actions into named methods', () => {
  const files = emitPom(script(LOGIN));
  const page = files['pages/LoginPage.ts'];
  assert.ok(page.includes("this.usernameInput = page.getByRole('textbox', { name: 'Username' });"));
  assert.ok(page.includes("async goto(path = '/web/index.php/auth/login') {"));
  assert.ok(page.includes('async login(username: string, password: string) {'));
  assert.ok(page.includes('await this.passwordInput.fill(password);'));
  assert.ok(!page.includes('this.usernameInput.click()'), 'the click before typing is dropped');
  assert.ok(emitPlain(script(LOGIN))['tests/login-flow.spec.ts'].includes(".getByRole('textbox', { name: 'Username' }).click();"), 'plain keeps it');
  const spec = files['tests/login-flow.spec.ts'];
  assert.ok(spec.includes('const loginPage = new LoginPage(page);'));
  assert.ok(spec.includes('await loginPage.login(process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);'));
  assert.ok(spec.includes('await expect(loginPage.dashboardHeading).toBeVisible();'));
  assert.ok(spec.includes('await expect(page).toHaveURL(/admin/);'));
});

test('POM reuses a method for a repeated flow and keeps raw steps in order', () => {
  const files = emitPom(script(TODO, 'Todo'));
  const todo = files['pages/TodomvcPage.ts'];
  assert.equal(todo.match(/async submitWhatNeedsTo\(/g)?.length, 1);
  assert.ok(todo.includes("this.milkToggleTodoInput = page.getByRole('listitem').filter({ hasText: 'milk' }).getByLabel('Toggle Todo');"));
  const spec = files['tests/todo.spec.ts'];
  assert.ok(spec.includes("await todomvcPage.submitWhatNeedsTo('milk');"));
  assert.ok(spec.includes("await todomvcPage.submitWhatNeedsTo('bread');"));
  // The popup gets its own page object, created after the raw lines that open it.
  assert.ok(spec.indexOf('const page1 = await page1Promise;') < spec.indexOf('new PopupPage(page1)'));
  assert.ok(spec.includes("    console.log(`Dialog message: ${dialog.message()}`);"));
});

test('edits split, rename and remove steps', () => {
  const s = script(LOGIN);
  s.edits = { pageNames: { s7: 'admin area' }, renames: { LoginPage: 'Sign in' }, removed: ['s2'] };
  const groups = pageGroups(s);
  // s8 checks the URL, which starts the Admin page on its own.
  assert.deepEqual(groups.map((g) => g.page), ['SignInPage', 'AdminAreaPage', 'AdminPage']);
  assert.ok(!groups[0].steps.some((st) => st.id === 's2'));
  const files = emitPom(s);
  assert.ok(files['pages/AdminAreaPage.ts'].includes("this.adminLink = page.getByRole('link', { name: 'Admin' });"));
});

test('a URL check starts a new page after a click', () => {
  const rec = parseCodegen(`test('test', async ({ page }) => {
  await page.goto('https://hr.test/web/index.php/auth/login');
  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page).toHaveURL(/admin\\/viewSystemUsers/);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL('https://hr.test/web/index.php/pim/viewEmployeeList');
  await page.getByRole('button', { name: 'Add' }).click();
});`);
  const groups = pageGroups({ title: 't', recording: rec, edits: {} });
  assert.deepEqual(groups.map((g) => [g.page, g.steps.length]), [['LoginPage', 2], ['ViewSystemUsersPage', 2], ['ViewEmployeeListPage', 2]]);
});

test('generated code passes the QA Agent rules and the project is complete', () => {
  for (const style of ['plain', 'pom']) {
    const s = script(LOGIN);
    const files = buildProject(s, style);
    assert.deepEqual(checkCode(style === 'plain' ? emitPlain(s) : emitPom(s)).errors, []);
    assert.ok(files['login-flow/playwright.config.ts'].includes('"https://opensource-demo.orangehrmlive.com"'));
    assert.equal(files['login-flow/.env.example'], 'BASE_URL=https://opensource-demo.orangehrmlive.com\nE2E_USERNAME=\nE2E_PASSWORD=\n');
  }
});
