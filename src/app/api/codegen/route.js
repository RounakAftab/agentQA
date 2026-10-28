import { db } from '@/lib/db';
import { json, readJson, recordAudit, requireAgentOperator, requireUser } from '@/lib/apiHelpers';
import { codegenInclude, publicScript, validateCodegenInput } from '@/lib/codegenScripts';

// Saved Codegen scripts, newest first: GET /api/codegen
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const rows = await db.codegenScript.findMany({ orderBy: { updatedAt: 'desc' }, take: 200, include: codegenInclude });
  return json({ scripts: rows.map((row) => publicScript(row)) });
}

// Converts recorder code into a script: POST { title?, startUrl, sourceCode }
export async function POST(request) {
  const { user, response } = await requireAgentOperator();
  if (response) return response;

  const { values, errors } = validateCodegenInput(await readJson(request));
  if (Object.keys(errors).length > 0) return json({ error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  const created = await db.codegenScript.create({ data: { ...values, createdById: user.id }, include: codegenInclude });
  await recordAudit({ userId: user.id, action: 'codegen.created', target: created.title, details: created.startUrl });
  return json({ script: publicScript(created, { full: true }) }, 201);
}
