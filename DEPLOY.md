# Deploying for free (Vercel + Neon + SMTP)

This setup costs nothing and needs no credit card. Free-tier limits change, so check each
provider's pricing page before relying on them for a team.

| Part | Service | Free-tier notes |
|---|---|---|
| App | **Vercel** (Hobby plan) | Free for non-commercial use only. |
| Database | **Neon** (PostgreSQL) | Small storage quota. The database sleeps when idle, so the first request after a pause is slower. |
| Email | **Brevo** or **Gmail** | Brevo has a daily send quota. Gmail needs 2-step verification and an app password. |

The app needs a normal Node.js runtime (Prisma, password hashing, nodemailer), so edge-only
hosts such as Cloudflare Workers are not suitable.

## 1. Put the code on GitHub

The git repository is the `qa-dashboard` folder.

```
git add -A
git commit -m "Prepare for deployment"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin master
```

`.env`, `.env.production`, `.pgdata` and `.mail-outbox` are git-ignored, so secrets and local data stay
on your machine. Check with `git status` that no `.env*` file is listed (only `.env.example`).

## 2. Create the database (Neon)

1. Sign up at neon.tech and create a project. Pick the region closest to your Vercel region.
2. In the connection details you need two strings:
   - **Pooled** (the host contains `-pooler`). This is `DATABASE_URL`. Append `&pgbouncer=true&connect_timeout=15`.
   - **Direct** (no `-pooler`). This is `DIRECT_URL`. It is used for migrations.

Both need `?sslmode=require`.

## 3. Choose an email service

The app emails an invitation link to every new user, so SMTP is required in production
(it refuses to start sending without it, instead of silently dropping mail).

**Brevo**: create an account, verify your sender address, then SMTP & API -> SMTP.
`SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<your login>`, `SMTP_PASS=<SMTP key>`.

**Gmail**: turn on 2-step verification, create an app password.
`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<your address>`, `SMTP_PASS=<app password>`.
`MAIL_FROM` must be that same address.

[README-EMAIL.md](README-EMAIL.md) lists other providers.

## 4. Deploy on Vercel

1. vercel.com -> Add New -> Project -> import the GitHub repo. The framework is detected as Next.js.
2. Add these Environment Variables (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon pooled string from step 2 |
| `DIRECT_URL` | Neon direct string from step 2 |
| `SESSION_SECRET` | a new random value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_URL` | your site address, e.g. `https://your-app.vercel.app` (used in invitation links) |
| `MAIL_FROM` | e.g. `AgentQA <you@your-domain.com>` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | from step 3 |

3. Deploy. The build runs `vercel-build`, which generates the Prisma client, **applies database
   migrations**, and builds the app. Do not reuse your local `SESSION_SECRET`.

## 5. Create the first administrator

Create a file `.env.production` (git-ignored) in the project folder with the **production** values:

```
DATABASE_URL="<Neon pooled string>"
DIRECT_URL="<Neon direct string>"
APP_URL="https://your-app.vercel.app"
MAIL_FROM="AgentQA <rounak.aftab@gmail.com>"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="ipx720754@gmail.com"
SMTP_PASS="..."
ADMIN_NAME="Your Name"
ADMIN_EMAIL="you@your-domain.com"
```

Then run once:

```
npm run db:seed:prod
```

It creates the admin and emails a link to choose a password. If the email is lost,
`npm run db:seed:prod -- --resend` sends another. Delete `.env.production` afterwards if you like.

## 6. Check it

- `https://your-app.vercel.app/api/health` should return `{"status":"ok"}`.
- Open the site, follow the invitation email, set a password and sign in.
- Add the rest of your team from Settings -> Team & RBAC Roles.

## 7. GitHub Actions (CI/CD)

`.github/workflows/ci-cd.yml` runs on GitHub's free runners (unlimited for public repositories,
2,000 minutes a month for private ones; one run takes a few minutes).

- **Every push and pull request:** install, validate the schema, apply migrations to a throwaway
  Postgres, lint, build, start the production server and smoke-test it.
- **Pushes to `main`**, once those checks pass: deploy to Vercel production. Database migrations are
  applied to Neon during the Vercel build.

`vercel.json` turns off Vercel's own Git deployments so each change deploys once, through the pipeline.

### One-time setup

1. Create the Vercel project first (step 4) and set its Environment Variables. The pipeline reads
   them from Vercel; database and email secrets never go into GitHub.
2. Get the three Vercel values:
   - **VERCEL_TOKEN**: vercel.com -> Account Settings -> Tokens -> Create.
   - **VERCEL_ORG_ID** and **VERCEL_PROJECT_ID**: in the project folder run `npx vercel link`,
     then open `.vercel/project.json` (`orgId` and `projectId`). The `.vercel` folder is git-ignored.
3. On GitHub: repository -> Settings -> Secrets and variables -> Actions:
   - **Secrets** tab -> New repository secret: add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
   - **Variables** tab (optional): add `PRODUCTION_URL` = `https://your-app.vercel.app` to get a
     health check after each deploy.
4. Push to `main`. Watch it under the repository's **Actions** tab.

To deploy by hand, open Actions -> CI/CD -> **Run workflow**.

## Updating

Push to `main`. The pipeline tests the change, then deploys it and applies any new database migrations.
To change the schema locally: edit `prisma/schema.prisma`, run `npm run db:migrate`, commit the new
folder under `prisma/migrations`.

## Things to know

- **Cold starts:** after a quiet period the Neon database wakes up on the next request, so the
  first page load can take a few seconds.
- **AI Workflow page:** removed (it was a simulation). The link now opens the QA Agent.
- **Requirements, test cases, CI runs, approvals:** the tables exist but nothing fills them until the
  GitHub/CI integrations are built.
- **Backups:** free database plans keep little history. Export anything important regularly
  (`pg_dump` with the direct connection string).
- **Custom domain:** add it in Vercel, then change `APP_URL` so invitation links use it.
- **Rotating `SESSION_SECRET`** signs everyone out.
- **QA Agent worker:** Vercel serves the QA Agent pages and API, but it cannot run the worker, which
  needs a browser and runs for minutes per ticket. Run `npm run agent:worker` on any always-on
  machine (a small VM, a container, or a spare computer) with the same `DATABASE_URL` as production
  plus the QA Agent settings from `.env.example`. Install browsers there with `npm run agent:browsers`.
  The worker also needs the same `SESSION_SECRET` (or `ENCRYPTION_KEY`) as Vercel, because it decrypts
  the Jira tokens saved in each project's settings.
