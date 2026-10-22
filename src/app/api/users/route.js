import { db } from '@/lib/db';
import { initialsFor, json, publicUser, readJson, recordAudit, requireAdmin, requireUser } from '@/lib/apiHelpers';
import { issueInvite } from '@/lib/invites';
import { isSmtpConfigured } from '@/lib/mail';
import { ROLE_ENUM } from '@/lib/roles';
import { validateUserInput } from '@/lib/validation';

// Includes soft-deleted users (flagged `deleted`) so history can still show their names.
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const users = await db.user.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return json({ users: users.map(publicUser), smtpConfigured: isSmtpConfigured() });
}

export async function POST(request) {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;

  const { values, errors } = validateUserInput(await readJson(request));
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  if (await db.user.findUnique({ where: { email: values.email } })) {
    return json({ error: 'Please fix the highlighted fields', fieldErrors: { email: 'Another user already has this email' } }, 409);
  }

  const created = await db.user.create({
    data: {
      name: values.name,
      email: values.email,
      role: ROLE_ENUM[values.role],
      avatar: initialsFor(values.name),
    },
  });

  await recordAudit({
    userId: admin.id,
    action: 'user.created',
    target: created.name,
    details: `Invited ${created.email} as ${values.role}`,
  });

  // The account exists even if the email fails; the admin can resend from the table.
  try {
    const { link, delivery } = await issueInvite(created, {
      inviterName: admin.name,
      origin: new URL(request.url).origin,
    });
    return json(
      {
        user: publicUser(created),
        invite: {
          mode: delivery.mode,
          devLink: process.env.NODE_ENV !== 'production' && delivery.mode === 'outbox' ? link : undefined,
        },
      },
      201
    );
  } catch (err) {
    console.error('[invite] failed to send invitation', err);
    return json({ user: publicUser(created), inviteError: 'The user was created but the invitation email could not be sent. Use "Resend invite" to try again.' }, 201);
  }
}
