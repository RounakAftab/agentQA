# Email setup

AgentQA sends invitation emails (a link to set a password) over SMTP. The settings live in `.env`:

```
MAIL_FROM="AgentQA <no-reply@your-domain.com>"
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
APP_URL="http://localhost:3000"
```

Restart `npm run dev` after changing `.env`.

## Development: local inbox (default)

```
npm run mail:start
```

This starts MailDev: an SMTP server on port 1025 and a web inbox at <http://localhost:1080>.
Every email the app sends lands there and nothing leaves your machine. `.env` is already set to:

```
SMTP_HOST="127.0.0.1"
SMTP_PORT="1025"
SMTP_USER=""
SMTP_PASS=""
```

If `SMTP_HOST` is empty, emails are written to `.mail-outbox/` instead and the invite link is shown on
Settings -> Team.

## Real delivery

Use any provider's SMTP details. Port 587 uses STARTTLS and port 465 uses TLS; both work.

| Provider | SMTP_HOST | SMTP_PORT | SMTP_USER | SMTP_PASS |
|---|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | `587` | your full address | an [app password](https://myaccount.google.com/apppasswords) (needs 2-step verification) |
| Microsoft 365 | `smtp.office365.com` | `587` | the mailbox address | its password or app password (SMTP AUTH must be enabled) |
| SendGrid | `smtp.sendgrid.net` | `587` | `apikey` | your API key |
| Mailgun | `smtp.mailgun.org` | `587` | the SMTP login from the domain settings | its SMTP password |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `587` | SES SMTP username | SES SMTP password |

Also set:

- `MAIL_FROM` to an address your provider allows you to send from (Gmail only sends as the signed-in
  address; SendGrid, Mailgun and SES need a verified sender or domain).
- `APP_URL` to the public address of the app, so invite links work for the recipient
  (for example `https://qa.your-company.com`).

## Checking it works

1. Sign in as an admin, open Settings -> Team & RBAC Roles and add a user with an address you can read.
2. The page says "Invitation sent". If sending fails, the user is still created and the page shows an
   error; fix the settings and use the envelope icon on that row to resend.
3. The server terminal logs the SMTP error text when a send fails (wrong password, blocked port, unverified
   sender).

Keep real credentials out of git: `.env` is ignored, `.env.example` is the template.
