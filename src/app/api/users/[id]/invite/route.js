import { db } from '@/lib/db';
import { json, recordAudit, requireAdmin } from '@/lib/apiHelpers';
import { issueInvite } from '@/lib/invites';

export async function POST(request, ctx) {
  const { user: admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await ctx.params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.deletedAt) return json({ error: 'User not found' }, 404);
  if (target.passwordHash) return json({ error: 'This user has already set a password' }, 400);

  try {
    const { link, delivery } = await issueInvite(target, { inviterName: admin.name, origin: new URL(request.url).origin });
    await recordAudit({ userId: admin.id, action: 'user.invited', target: target.name, details: `Resent the invitation to ${target.email}` });
    return json({
      invite: {
        mode: delivery.mode,
        devLink: process.env.NODE_ENV !== 'production' && delivery.mode === 'outbox' ? link : undefined,
      },
    });
  } catch (err) {
    console.error('[invite] failed to send invitation', err);
    return json({ error: 'The invitation email could not be sent. Check the SMTP settings and try again.' }, 502);
  }
}
