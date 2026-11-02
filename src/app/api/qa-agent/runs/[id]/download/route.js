import { strToU8, zipSync } from 'fflate';
import { db } from '@/lib/db';
import { json, requireUser } from '@/lib/apiHelpers';

// The run's test as a ZIP: the spec and its page objects at their paths in the test repository,
// ready to drop into it. GET /api/qa-agent/runs/:id/download
export async function GET(_request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const run = await db.agentRun.findUnique({ where: { id }, select: { issueKey: true, specPath: true, specContent: true, pageObjects: true } });
  if (!run?.specContent || !run.specPath) return json({ error: 'This run has no saved test' }, 404);

  const files = { ...(run.pageObjects ?? {}), [run.specPath]: run.specContent };
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])));
  const name = run.issueKey.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}-pom.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
