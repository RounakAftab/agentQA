import { db } from '@/lib/db';
import { initialsFor, isLastActiveAdmin, json, publicUser, readJson, recordAudit, requireAdmin } from '@/lib/apiHelpers';
import { issueInvite } from '@/lib/invites';
import { ROLE_ENUM } from '@/lib/roles';
import { validateUserInput } from '@/lib/validation';

async function findTarget(ctx) {
  const { id } = await ctx.params;
  const target = await db.user.findUnique({ where: { id } });
  return target && !target.deletedAt ? target : null;
}

export async function PATCH(request, ctx) {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;

  const target = await findTarget(ctx);
  if (!target) return json({ error: 'User not found' }, 404);

  const body = await readJson(request);
  const data = {};
  let reinvite = false;

  const wantsProfile = ['name', 'email', 'role'].some((k) => k in body);
  if (wantsProfile) {
    const { values, errors } = validateUserInput({
      name: body.name ?? target.name,
      email: body.email ?? target.email,
      role: body.role ?? { ADMIN: 'Admin', QA_LEAD: 'QA Lead', QA_ENGINEER: 'QA Engineer', DEVELOPER: 'Developer' }[target.role],
    });
    if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

    if (values.email !== target.email) {
      if (await db.user.findUnique({ where: { email: values.email } })) {
        return json({ error: 'Please fix the highlighted fields', fieldErrors: { email: 'Another user already has this email' } }, 409);
      }
      // Not activated yet: the old address got the link, so send a new one to the new address.
      reinvite = !target.passwordHash;
    }
    Object.assign(data, {
      name: values.name,
      email: values.email,
      role: ROLE_ENUM[values.role],
      avatar: initialsFor(values.name),
    });
  }

  if (typeof body.disabled === 'boolean') {
    if (body.disabled && target.id === admin.id) return json({ error: 'You cannot disable your own account' }, 400);
    data.disabled = body.disabled;
  }

  const demotes = data.role && data.role !== 'ADMIN';
  if ((demotes || data.disabled === true) && (await isLastActiveAdmin(target))) {
    return json({ error: 'At least one active administrator is required' }, 400);
  }

  const updated = await db.user.update({ where: { id: target.id }, data });

  const changes = [];
  if (data.name && data.name !== target.name) changes.push(`name "${target.name}" to "${data.name}"`);
  if (data.email && data.email !== target.email) changes.push(`email ${target.email} to ${data.email}`);
  if (data.role && data.role !== target.role) changes.push(`role to ${data.role}`);
  if (changes.length > 0) {
    await recordAudit({ userId: admin.id, action: 'user.updated', target: updated.name, details: `Changed ${changes.join(', ')}` });
  }
  if (typeof data.disabled === 'boolean' && data.disabled !== target.disabled) {
    await recordAudit({
      userId: admin.id,
      action: data.disabled ? 'user.disabled' : 'user.enabled',
      target: updated.name,
      details: data.disabled ? 'Access suspended' : 'Access restored',
    });
  }

  let inviteError;
  let devLink;
  if (reinvite) {
    try {
      const { link, delivery } = await issueInvite(updated, { inviterName: admin.name, origin: new URL(request.url).origin });
      if (process.env.NODE_ENV !== 'production' && delivery.mode === 'outbox') devLink = link;
    } catch (err) {
      console.error('[invite] failed to send invitation', err);
      inviteError = 'The email was changed but the new invitation could not be sent. Use "Resend invite".';
    }
  }
  return json({ user: publicUser(updated), reinvited: reinvite && !inviteError, devLink, inviteError });
}

// Soft delete: the row stays so approvals, comments and audit history keep their author.
export async function DELETE(_request, ctx) {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;

  const target = await findTarget(ctx);
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.id === admin.id) return json({ error: 'You cannot delete your own account' }, 400);
  if (await isLastActiveAdmin(target)) return json({ error: 'At least one active administrator is required' }, 400);

  await db.$transaction([
    db.passwordToken.deleteMany({ where: { userId: target.id } }),
    db.user.update({
      where: { id: target.id },
      data: {
        deletedAt: new Date(),
        disabled: true,
        passwordHash: null,
        email: `deleted-${target.id}@deleted.invalid`, // frees the address for a future invitation
      },
    }),
  ]);
  await recordAudit({ userId: admin.id, action: 'user.deleted', target: target.name, details: `Removed ${target.email} from the team` });
  return json({ ok: true });
}
