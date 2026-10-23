import { db } from '@/lib/db';
import { json, readJson, requireProjectManager } from '@/lib/apiHelpers';
import { validateJiraFields } from '@/lib/validation';
import { createJiraClient, JiraError } from '@/lib/jira';
import { decryptSecret } from '@/lib/secrets';
import { checkLimit, recordFailure, clearFailures } from '@/lib/rateLimit';

// "Test connection" in the project form: checks the account, the project key, and returns the
// project's status names. Nothing is saved.
export async function POST(request) {
  const { user, response } = await requireProjectManager();
  if (response) return response;

  const body = await readJson(request);
  const existing = body.projectId ? await db.project.findUnique({ where: { id: String(body.projectId) } }) : null;

  const errors = {};
  const values = validateJiraFields(body, errors, { tokenSaved: Boolean(existing?.jiraApiTokenEnc) });
  delete errors.jiraProjectKey; // the key is optional here; without one only the account is checked
  if (!values.jiraBaseUrl) errors.jiraBaseUrl ??= 'Enter the Jira site address';
  if (!values.jiraEmail) errors.jiraEmail ??= 'Enter the account email';
  if (Object.keys(errors).length > 0) return json({ ok: false, error: 'Please fix the highlighted fields', fieldErrors: errors }, 400);

  // A saved token is only reused against the same site and account it was saved for, so it
  // can't be sent to a different Jira site.
  let apiToken = values.jiraApiToken;
  if (!apiToken && existing?.jiraApiTokenEnc) {
    if (existing.jiraBaseUrl !== values.jiraBaseUrl || existing.jiraEmail !== values.jiraEmail) {
      return json({ ok: false, error: 'You changed the site or email, so enter the API token again.', fieldErrors: { jiraApiToken: 'Enter the API token for this site and email' } }, 400);
    }
    try {
      apiToken = decryptSecret(existing.jiraApiTokenEnc);
    } catch (err) {
      return json({ ok: false, error: err.message, fieldErrors: { jiraApiToken: 'Enter the API token again' } }, 400);
    }
  }
  if (!apiToken) return json({ ok: false, error: 'Enter the API token', fieldErrors: { jiraApiToken: 'Enter the API token' } }, 400);

  // Failed tests count like failed logins, so the endpoint can't be used to guess tokens.
  const limiterKey = `jira-test|${user.id}`;
  const limit = await checkLimit(limiterKey);
  if (!limit.allowed) {
    return json({ ok: false, error: `Too many failed connection tests. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` }, 429);
  }

  try {
    const result = await createJiraClient({ baseUrl: values.jiraBaseUrl, email: values.jiraEmail, apiToken }).verify(values.jiraProjectKey);
    await clearFailures(limiterKey);
    return json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof JiraError) {
      await recordFailure(limiterKey);
      const field = err.status === 404 && values.jiraProjectKey ? 'jiraProjectKey' : err.status === 401 ? 'jiraApiToken' : null;
      return json({ ok: false, error: err.message, fieldErrors: field ? { [field]: err.message.replace(/^Jira \d+: /, '') } : undefined }, 200);
    }
    throw err;
  }
}
