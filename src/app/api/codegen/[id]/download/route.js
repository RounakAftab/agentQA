import { strToU8, zipSync } from 'fflate';
import { db } from '@/lib/db';
import { json, recordAudit, requireUser } from '@/lib/apiHelpers';
import { toScript } from '@/lib/codegenScripts';
import { buildProject } from '@/lib/codegen/bundle';
import { slug } from '@/lib/codegen/naming';

// The script as a ready-to-run Playwright project: GET /api/codegen/:id/download?style=pom|plain
export async function GET(request, ctx) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  const row = await db.codegenScript.findUnique({ where: { id } });
  if (!row) return json({ error: 'Script not found' }, 404);

  const style = new URL(request.url).searchParams.get('style') === 'plain' ? 'plain' : 'pom';
  const files = buildProject(toScript(row), style);
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])));

  await recordAudit({ userId: user.id, action: 'codegen.downloaded', target: row.title, details: style === 'pom' ? 'Page Object Model' : 'Plain spec' });
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug(row.title)}-${style}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
