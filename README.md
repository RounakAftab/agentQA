# AgentQA

A QA operations dashboard built with Next.js 16, PostgreSQL (Prisma) and password sign-in.
Admins invite people by email; projects, users and the audit trail are stored in the database.

## Run it locally

Use three terminals, all in this folder:

```
npm install
npm run db:start      # 1. local PostgreSQL on port 54329 (keep it running)
npm run mail:start    # 2. local mail server; read emails at http://localhost:1080
npm run dev           # 3. the app at http://localhost:3000
```

First time only, after `npm run db:start` is running:

```
npm run db:migrate    # create the tables
npm run db:seed       # create the first admin from ADMIN_NAME / ADMIN_EMAIL in .env
```

The seed emails an invitation to the admin. Open it in the MailDev inbox (http://localhost:1080),
choose a password, then sign in.

Copy `.env.example` to `.env` and fill it in. Settings are explained in [README-EMAIL.md](README-EMAIL.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:start` | Local PostgreSQL (data in `.pgdata`) |
| `npm run db:migrate` | Apply schema changes during development |
| `npm run db:seed` | Create the first admin (`-- --resend` re-sends their invitation) |
| `npm run db:wipe -- --yes` | Delete all data from the local database |
| `npm run db:studio` | Browse the database in a browser |
| `npm run mail:start` | Local SMTP server with a web inbox |
| `npm run agent:worker` | QA Agent worker (see below) |
| `npm run agent:browsers` | One-time download of the Chromium build the QA Agent's browser uses |

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, including adding, editing, disabling and deleting users |
| QA Lead | Create and manage projects, review approvals |
| QA Engineer, Developer | View projects, results and approvals |

## QA Agent

The **QA Agent** menu turns requirements into Playwright tests. A project needs only a name;
each connection adds more:

| Connection | Without it | With it |
|---|---|---|
| Jira | Write or paste requirements in AgentQA (`REQ-1`, `REQ-2`, ...) | Also pick up Jira tickets, which move to In Progress and Done |
| App link (Test environment) | Runs can't start | Specs are written and verified against the live site |
| Test repository (GitHub) | Specs are saved in AgentQA for download | Specs open as draft pull requests |

Run a requirement, or pick up a ticket (or type `pick up SCRUM-12`), and a worker runs these steps:

1. Reads the requirement. For a Jira ticket it also moves the ticket to **In Progress**.
2. Checks out the test repository on a new `qa/scrum-12` branch, or prepares a blank Playwright
   project when there is none.
3. A Claude agent extracts the steps and acceptance criteria, inspects the live app in a headless
   browser (Playwright MCP), writes `tests/generated/scrum_12.spec.ts` and runs it until it passes.
4. The worker re-runs the spec itself. Only a pass here counts.
5. With a test repository: commits the spec, pushes the branch and opens a draft pull request.
6. Saves the test case. For a Jira ticket it appends `✅ Automation test created: scrum_12.spec.ts`
   to the description and moves the ticket to **Done**.

If any step fails, the ticket stays In Progress, the run page shows why, and the worker adds a Jira
comment. These rules are checked in code, not just in the prompt: role-based selectors only, no
XPath, no credentials in test files, one `test.step()` per Jira step and one `expect()` per
acceptance criterion. A spec that breaks a rule is rejected.

**Page Object Model.** Every test is written with page objects. The agent writes one class per page
(`tests/pages/LoginPage.ts`, or the test repository's own page-object folder) holding its locators
and actions. The spec imports them and only calls and asserts. A spec that calls
`page.getByRole()`/`page.locator()` itself is rejected. The pull request, the Approvals preview and
**Download (.zip)** on the run page include the spec and its page objects at their repository paths.

**Run test (headless or headed).** A finished run's page has **Run test**. It runs the saved spec and
page objects again, without the AI, against the project's app link. It runs headless by default.
Tick **Show browser** to open a visible browser window on the computer the worker runs on. The
results and console stream into the page. The run uses a separate copy of the test repository
(`.agent-workspaces/<project>-replay`), so it never disturbs a QA Agent run. Test runs need a
worker kept running on a computer (`npm run agent:worker` or `agent:worker:prod`). The on-demand
GitHub Actions runner doesn't take them.

**Jira tickets without a Jira connection**

If you can't connect Jira (no API token, or third-party apps aren't allowed), tickets still work
as requirements. AgentQA never contacts Jira for them:

- **One ticket:** in **New requirement**, paste the ticket's text and fill in **Jira ticket**
  (`SCRUM-12`) and optionally its link. The requirement, spec (`scrum_12.spec.ts`) and branch are
  named after the ticket.
- **Many tickets:** in Jira, filter the tickets and use **Export → Export CSV (all fields)**, which
  any Jira user can do. Then use **Import from Jira CSV** on the Requirements tab. Each ticket keeps
  its key, summary, description and priority, and an *Acceptance Criteria* field is added to the
  description. Tickets already in the project are skipped, never overwritten. A ticket needs at
  least 20 characters of description. The limit is 200 tickets per file.
- **Back to Jira:** when the run finishes, the run page has **Copy Jira update**. It copies the
  `✅ Automation test created` note, the checks and the links (or the failure reason) to paste as a
  comment on the ticket. Then move the ticket yourself.

**Setup**

1. Open **Projects → Edit project**:
   - **Jira**: enter the Jira Cloud site, account email, API token and project key, then use
     **Test connection**. Each project can use its own Jira site. The token is stored encrypted
     and never sent back to the browser.
   - **Test environment**: set the app link the tests run against and its test account.
   - **Repositories**: set the test repository. It must already have `@playwright/test` and a
     `playwright.config`.
2. Fill in the QA Agent section of `.env` for the worker (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`).
   On your machine `ANTHROPIC_API_KEY` is optional: left empty, the worker uses your Claude CLI
   login (a Pro/Max subscription). Run `claude` once to sign in.
3. Run the worker, either way:
   - **On demand (recommended in production):** every run starts a GitHub Actions job that
     processes the queue and exits ([.github/workflows/qa-agent.yml](.github/workflows/qa-agent.yml)).
     Add the repository secrets listed at the top of that file, and set `AGENT_DISPATCH_TOKEN`,
     `AGENT_DISPATCH_REPO` (and optionally `AGENT_DISPATCH_REF`) on Vercel.
   - **On your machine:** `npm run agent:browsers` once, then keep `npm run agent:worker`
     running in a fourth terminal.
   - **Production queue from your machine:** leave `AGENT_DISPATCH_TOKEN` and `AGENT_DISPATCH_REPO`
     unset on Vercel and run `npm run agent:worker:prod` (reads `.env.production`). Runs started
     on the live dashboard wait in the queue until this worker picks them up.

The worker needs a UTF-8 database. Clusters created by `npm run db:start` before the QA Agent was
added are WIN1252 on Windows. The worker refuses to start on one and explains how to recreate it.

Admins, QA Leads and QA Engineers can start and cancel runs. Developers can view them.

## Codegen

The **Codegen** menu turns a recorded flow on any site into Playwright tests. It needs no project
or Jira:

1. Enter the site URL and click **Start recording**. The worker (`npm run agent:worker`) opens
   Playwright's recorder in a browser **on the computer it runs on**; the page names that computer.
   Use the site; the recorded steps appear in AgentQA as you go. Close the browser when done and the
   script opens in the editor. Recordings close after 30 minutes. Without a worker, run
   `npx playwright codegen <url>` yourself and paste the code instead.
2. Passwords, and the username typed next to them, are replaced with
   `process.env.E2E_PASSWORD` / `E2E_USERNAME` before anything is saved.
3. Switch between **Plain spec** and **Page Object Model**. Pages are named from their URLs; rename
   them, start a new page at any step, or leave steps out. Consecutive actions become methods
   (`loginPage.login(username, password)`), and repeated flows reuse one method.
4. **Run test** runs the Page Object Model or plain spec on the worker (tick **Show browser** to
   watch it there). The **Tests** tab lists every action and check with its code line, error and a
   screenshot on failure; **Console** streams Playwright's output; **History** keeps the last runs.
   Flows that log in need **Set test login** (stored encrypted; the password is masked in results).
5. When a run fails, **Heal test** gives it to the QA Agent healer: it inspects the live site, fixes
   the recorded steps (locators, waits) in codegen style and runs them again. **Apply fix** replaces
   the recording and keeps your page names. Healing uses the agent model (`AGENT_MODEL`, capped by
   `AGENT_MAX_BUDGET_USD`).
6. **Download ZIP** gives a project that runs with `npm install && npx playwright test`.

The converter lives in `src/lib/codegen` and is covered by `npm test`. Admins, QA Leads and QA
Engineers create and edit scripts. Developers can view and download them.

## Load Tests

The **Load Tests** menu runs k6 against one endpoint of a project's app and shows how it holds up:

1. Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) on the worker computer
   (Windows: `winget install k6 --source winget`, macOS: `brew install k6`), or set `K6_PATH`.
2. Set the project's app link (**Projects → Edit project → Test environment**). Load tests can only
   target that site (same scheme, host and port), and redirects are not followed.
3. Click **New load test** and choose what to test:
   - **Single request**: one method and path, with optional headers and body.
   - **Scenario**: up to 10 steps each virtual user runs in order, then starts again (for example
     log in → search → add to cart). Each step has its own method, path, headers and body, an
     optional expected status, think time and p95 limit, and can save values from its response
     (a JSON field like `data.token`, or a header) for later steps as `{{token}}`. Steps can also
     use `{{username}}` and `{{password}}` (the project's test account), `{{vu}}` and `{{iter}}`.
     A failed step skips the rest of that pass. Put API keys in **Headers for every step**, not
     in the steps.

   Then set the number of virtual users, the ramp-up and how long to hold full load, and the
   pass/fail limits (p95 response time, share of failed requests). Headers are stored encrypted.
4. **Run load test** queues it for the worker (`npm run agent:worker`). The page shows requests per
   second, response times and errors live (and each scenario step's numbers), then k6's final
   numbers and whether each limit held.
   **Stop** ends the run early and keeps the numbers so far.

Limits: `LOAD_MAX_VUS` (default 100) and `LOAD_MAX_DURATION_SEC` (ramp-up plus duration, default
600). The app checks them when a test is saved or started, and the worker checks them again with
its own values. Load tests run only on a worker someone keeps running, never on the GitHub Actions
runner, and the load comes from that computer's network. Admins, QA Leads and QA Engineers create
and run load tests. Developers can view them.

## Deploy

See [DEPLOY.md](DEPLOY.md) for a free setup on Vercel + Neon.

## Status

Working: sign-in with emailed invitations, user management, projects, audit trail.
QA Agent: Jira tickets to verified Playwright tests (needs the worker running).
Not connected yet: GitHub and CI integrations (requirements, test cases, CI runs and approvals have
tables but no data source). To review a generated test, open the pull request the QA Agent creates.
