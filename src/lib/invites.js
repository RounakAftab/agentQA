// Creates one-time "set your password" links and emails them.
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { sendMail } from './mail.js';

export const INVITE_TTL_HOURS = 48;
export const RESET_TTL_MINUTES = 60;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inviteEmail({ name, inviterName, role, link }) {
  const subject = 'You have been invited to AgentQA';
  const text = [
    `Hi ${name},`,
    '',
    `${inviterName} invited you to AgentQA as ${role}.`,
    `Set your password to activate your account (the link expires in ${INVITE_TTL_HOURS} hours and works once):`,
    '',
    link,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
      <tr><td>
        <h2 style="margin:0 0 16px;font-size:20px">Welcome to AgentQA, ${escapeHtml(name)}</h2>
        <p style="margin:0 0 12px;line-height:1.5">${escapeHtml(inviterName)} invited you to join as <strong>${escapeHtml(role)}</strong>.</p>
        <p style="margin:0 0 24px;line-height:1.5">Set your password to activate your account.</p>
        <p style="margin:0 0 24px"><a href="${link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Set your password</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.5">This link expires in ${INVITE_TTL_HOURS} hours and can be used once. If the button does not work, copy this address into your browser:</p>
        <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#475569">${link}</p>
        <p style="margin:0;font-size:12px;color:#94a3b8">If you were not expecting this invitation, you can ignore this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html };
}

function resetEmail({ name, link }) {
  const subject = 'Reset your AgentQA password';
  const text = [
    `Hi ${name},`,
    '',
    'Someone asked to reset the password for your AgentQA account.',
    `Choose a new password here (the link expires in ${RESET_TTL_MINUTES} minutes and works once):`,
    '',
    link,
    '',
    'If you did not ask for this, you can ignore this email. Your password stays the same.',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
      <tr><td>
        <h2 style="margin:0 0 16px;font-size:20px">Reset your password</h2>
        <p style="margin:0 0 12px;line-height:1.5">Hi ${escapeHtml(name)}, someone asked to reset the password for your AgentQA account.</p>
        <p style="margin:0 0 24px"><a href="${link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Choose a new password</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.5">This link expires in ${RESET_TTL_MINUTES} minutes and can be used once. If the button does not work, copy this address into your browser:</p>
        <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#475569">${link}</p>
        <p style="margin:0;font-size:12px;color:#94a3b8">If you did not ask for this, you can ignore this email. Your password stays the same.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html };
}

// Replaces any earlier unused link for the user with a new one and returns its URL.
async function createLink(user, { purpose, ttlMs, origin }) {
  const token = randomBytes(32).toString('base64url');

  await db.passwordToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await db.passwordToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      purpose,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  const base = (process.env.APP_URL || origin || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/set-password?token=${token}`;
}

// Replaces any earlier unused invitation for the user and sends a fresh one.
// Returns { link, delivery } where delivery is { mode: 'smtp' | 'outbox' }.
export async function issueInvite(user, { inviterName, origin }) {
  const link = await createLink(user, { purpose: 'invite', ttlMs: INVITE_TTL_HOURS * 60 * 60 * 1000, origin });
  const roleLabel = { ADMIN: 'Admin', QA_LEAD: 'QA Lead', QA_ENGINEER: 'QA Engineer', DEVELOPER: 'Developer' }[user.role];

  const delivery = await sendMail({
    to: user.email,
    ...inviteEmail({ name: user.name, inviterName, role: roleLabel, link }),
  });
  return { link, delivery };
}

// Emails a "forgot password" link. Same page and rules as an invitation, shorter lifetime.
export async function issuePasswordReset(user, { origin }) {
  const link = await createLink(user, { purpose: 'reset', ttlMs: RESET_TTL_MINUTES * 60 * 1000, origin });
  const delivery = await sendMail({ to: user.email, ...resetEmail({ name: user.name, link }) });
  return { link, delivery };
}
