// Outgoing email. With SMTP_HOST set, mail goes out through that server. Without it
// (local development) each message is written to ./.mail-outbox so nothing is sent by
// accident and you can open the email to follow the link.
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      // Fail fast so the Settings page reports a problem instead of hanging.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export const isSmtpConfigured = () => Boolean(process.env.SMTP_HOST);

// Returns { mode: 'smtp' } when handed to the mail server, or { mode: 'outbox', file }.
export async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || 'AgentQA <no-reply@agentqa.local>';

  if (isSmtpConfigured()) {
    await getTransporter().sendMail({ from, to, subject, text, html });
    return { mode: 'smtp' };
  }

  // Hosting platforms have read-only disks and no one reads an outbox there, so fail loudly.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to send email.');
  }

  const dir = path.resolve('.mail-outbox');
  await fs.mkdir(dir, { recursive: true });
  const safeTo = to.replace(/[^a-z0-9@.-]/gi, '_');
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeTo}.html`);
  await fs.writeFile(
    file,
    `<!-- To: ${to} | From: ${from} | Subject: ${subject} -->\n${html}\n<!--\n${text}\n-->\n`,
    'utf8'
  );
  console.log(`[mail] SMTP not configured. Wrote "${subject}" for ${to} to ${file}`);
  return { mode: 'outbox', file };
}
