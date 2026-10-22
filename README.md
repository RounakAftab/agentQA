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

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, including adding, editing, disabling and deleting users |
| QA Lead | Create and manage projects, review approvals |
| QA Engineer, Developer | View projects, results and approvals |

## Deploy

See [DEPLOY.md](DEPLOY.md) for a free setup on Vercel + Neon.

## Status

Working: sign-in with emailed invitations, user management, projects, audit trail.
Not connected yet: GitHub and CI integrations (requirements, test cases, CI runs and approvals have
tables but no data source), and an AI backend. The AI Workflow page is a clearly labelled simulation.
