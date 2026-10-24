import { json, requireUser } from '@/lib/apiHelpers';
import { listApprovals } from '@/lib/approvals';

export async function GET(request) {
  const { response } = await requireUser();
  if (response) return response;
  const projectId = new URL(request.url).searchParams.get('projectId') || undefined;
  return json({ approvals: await listApprovals({ projectId }) });
}
