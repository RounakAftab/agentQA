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

The **QA Agent** menu turns Jira tickets into Playwright tests. Pick a ticket (or type
`pick up SCRUM-12`) and a worker runs these steps:

1. Reads the ticket and moves it to **In Progress**.
2. Checks out the project's test repository on a new `qa/scrum-12` branch.
3. A Claude agent extracts the steps and acceptance criteria, inspects the live app in a headless
   browser (Playwright MCP), writes `tests/generated/scrum_12.spec.ts` and runs it until it passes.
4. The worker re-runs the spec itself. Only a pass here counts.
5. Commits the spec, pushes the branch and opens a draft pull request.
6. Appends `✅ Automation test created: scrum_12.spec.ts` to the ticket description and moves it to **Done**.

If any step fails, the ticket stays In Progress, the run page shows why, and the worker adds a Jira
comment. These rules are checked in code, not just in the prompt: role-based selectors only, no
XPath, no credentials in test files, one `test.step()` per Jira step and one `expect()` per
acceptance criterion. A spec that breaks a rule is rejected.

**Setup**

1. Fill in the QA Agent section of `.env` (Jira, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, test account).
2. On each project, set the **Jira project key**, the **App link for tests** and the **Test repository
   link**. The test repository must already have `@playwright/test` and a `playwright.config`.
3. `npm run agent:browsers` once, then keep `npm run agent:worker` running in a fourth terminal.

The worker needs a UTF-8 database. Clusters created by `npm run db:start` before the QA Agent was
added are WIN1252 on Windows. The worker refuses to start on one and explains how to recreate it.

Admins, QA Leads and QA Engineers can start and cancel runs. Developers can view them.

## Deploy

See [DEPLOY.md](DEPLOY.md) for a free setup on Vercel + Neon.

## Status

Working: sign-in with emailed invitations, user management, projects, audit trail.
QA Agent: Jira tickets to verified Playwright tests (needs the worker running).
Not connected yet: GitHub and CI integrations (requirements, test cases, CI runs and approvals have
tables but no data source), and an AI backend. The AI Workflow page is a clearly labelled simulation.
