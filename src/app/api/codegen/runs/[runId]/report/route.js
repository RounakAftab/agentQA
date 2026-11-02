import { db } from '@/lib/db';
import { json, requireUser } from '@/lib/apiHelpers';
import { slug } from '@/lib/codegen/naming';
import { buildRunReport } from '@/lib/codegen/report';
import { renderReportHtml } from '@/lib/codegen/reportHtml';

const HISTORY_RUNS = 10;

// Earlier finished test runs of the script, newest first, without their screenshots (up to ~1.5 MB
// each), which the report only needs for the run itself. Prisma stores timestamps as UTC without a
// zone, so the cut-off is passed the same way (a Date would be shifted by the server's time zone).
const historyOf = (run) => db.$queryRaw`
  SELECT id, status, style, "createdAt",
         (results->>'duration')::float AS duration,
         COALESCE((SELECT jsonb_agg(t - 'screenshot') FROM jsonb_array_elements(results->'tests') t), '[]'::jsonb) AS tests
  FROM "CodegenRun"
  WHERE "scriptId" = ${run.scriptId} AND kind = 'run' AND status IN ('PASSED', 'FAILED')
    AND id <> ${run.id} AND "createdAt" < CAST(${run.createdAt.toISOString().replace('Z', '')} AS timestamp) AND results IS NOT NULL
  ORDER BY "createdAt" DESC
  LIMIT ${HISTORY_RUNS}`;

// The report of a finished test run: GET /api/codegen/runs/:runId/report
// ?format=html downloads it as one self-contained HTML file.
export async function GET(request, ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { runId } = await ctx.params;
  const run = await db.codegenRun.findUnique({ where: { id: runId }, include: { script: { select: { title: true, startUrl: true, updatedAt: true } } } });
  if (!run) return json({ error: 'Run not found' }, 404);
  if (run.kind !== 'run' || !['PASSED', 'FAILED'].includes(run.status) || !run.results?.tests?.length) {
    return json({ error: 'A report is available once a test run has finished with results.' }, 409);
  }

  const report = buildRunReport({ run, history: await historyOf(run), script: run.script });
  if (new URL(request.url).searchParams.get('format') !== 'html') return json({ report });

  const day = run.createdAt.toISOString().slice(0, 10);
  return new Response(renderReportHtml(report), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug(run.script.title) || 'codegen'}-report-${day}.html"`,
    },
  });
}
