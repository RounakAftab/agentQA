import { db } from '@/lib/db';
import { json, requireUser } from '@/lib/apiHelpers';

// Newest first, capped so the page stays fast. Add paging when the log grows past this.
const LIMIT = 500;

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const events = await db.auditEvent.findMany({ orderBy: { timestamp: 'desc' }, take: LIMIT });
  return json({
    events: events.map((e) => ({
      id: e.id,
      userId: e.userId,
      projectId: e.projectId,
      action: e.action,
      target: e.target,
      details: e.details,
      timestamp: e.timestamp.toISOString(),
    })),
  });
}
