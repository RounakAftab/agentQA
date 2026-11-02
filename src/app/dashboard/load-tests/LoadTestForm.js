'use client';

import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { createLoadTest, updateLoadTest } from '@/lib/loadTestClient';
import StepsEditor, { newStep, stepsFromForm, stepsToForm } from './StepsEditor';
import styles from './LoadTestForm.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

const initialForm = (test, projects) => {
  if (!test) {
    const first = projects.find((p) => p.appBaseUrl);
    return { projectId: first?.id ?? '', name: '', kind: 'request', method: 'GET', url: '/', body: '', headers: '', vus: '10', rampUpSec: '30', durationSec: '60', maxP95Ms: '500', maxErrorRatePct: '1' };
  }
  // The URL is edited as a path when it is on the project's app.
  const base = origin(test.project?.appBaseUrl ?? '');
  const url = base && test.url.startsWith(base) ? test.url.slice(base.length) || '/' : test.url;
  const text = (v) => (v == null ? '' : String(v));
  return {
    projectId: test.project?.id ?? '',
    name: test.name,
    kind: test.kind,
    method: test.method,
    url,
    body: test.body,
    headers: '',
    vus: text(test.vus),
    rampUpSec: text(test.rampUpSec),
    durationSec: text(test.durationSec),
    maxP95Ms: text(test.maxP95Ms),
    maxErrorRatePct: text(test.maxErrorRatePct),
  };
};

// Creates a load test (`test` null) or edits one. Calls onSaved(test) after saving.
export default function LoadTestForm({ test = null, projects = [], limits, onSaved, onCancel }) {
  const [form, setForm] = useState(() => initialForm(test, projects));
  const [steps, setSteps] = useState(() => (test?.kind === 'scenario' ? stepsToForm(test.steps) : [newStep(1)]));
  const [clearHeaders, setClearHeaders] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const project = test ? test.project : projects.find((p) => p.id === form.projectId);
  const base = origin(project?.appBaseUrl ?? '');
  const hasBody = BODY_METHODS.has(form.method);
  const scenario = form.kind === 'scenario';
  const hasTestAccount = test ? Boolean(test.project?.hasTestAccount) : Boolean(project?.e2eUsername && project?.e2ePasswordSet);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const { projectId, ...changes } = form;
    if (scenario) changes.steps = stepsFromForm(steps);
    const result = test ? await updateLoadTest(test.id, { ...changes, clearHeaders }) : await createLoadTest({ projectId, ...changes });
    setSaving(false);
    if (result.ok) return onSaved(result.data.test);
    setFieldErrors(result.data.fieldErrors ?? {});
    setError(result.data.fieldErrors ? '' : result.data.error ?? 'Could not save the load test');
  };

  const field = (key, label, input, hint) => (
    <div className={styles.field}>
      <label className="label" htmlFor={`load-${key}`}>{label}</label>
      {input}
      {fieldErrors[key] ? <p className={styles.fieldError}>{fieldErrors[key]}</p> : hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.row}>
        {test ? (
          field('projectId', 'Project', <div className={styles.static}>{test.project?.name}</div>)
        ) : (
          field(
            'projectId',
            'Project',
            <select id="load-projectId" className="select" value={form.projectId} onChange={set('projectId')}>
              <option value="">Choose a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.appBaseUrl}>
                  {p.name}{p.appBaseUrl ? '' : ' (no app link set)'}
                </option>
              ))}
            </select>,
            'Load is only sent to the project’s Test environment app link.'
          )
        )}
        {field('name', 'Name', <input id="load-name" className="input" value={form.name} onChange={set('name')} placeholder="Login API under load" />)}
      </div>

      <div className={styles.kinds} role="radiogroup" aria-label="What to load test">
        {[
          ['request', 'Single request', 'One endpoint, requested again and again'],
          ['scenario', 'Scenario', 'Steps each user runs in order, e.g. log in → search → add to cart'],
        ].map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={form.kind === value}
            className={`${styles.kind} ${form.kind === value ? styles.kindActive : ''}`}
            onClick={() => setForm((f) => ({ ...f, kind: value }))}
          >
            <strong>{label}</strong>
            <span>{hint}</span>
          </button>
        ))}
      </div>

      {scenario ? (
        <div className={styles.field}>
          <span className="label">Steps</span>
          {fieldErrors.steps && <p className={styles.fieldError}>{fieldErrors.steps}</p>}
          <StepsEditor steps={steps} onChange={setSteps} base={base} hasTestAccount={hasTestAccount} />
          <p className={styles.hint}>
            Each virtual user runs the steps in order, then starts again. A step fails on a different status than expected (or
            4xx/5xx), or when a value to save is missing; the rest of that pass is skipped. Redirects are not followed.
          </p>
        </div>
      ) : (
        <div className={styles.field}>
          <label className="label" htmlFor="load-url">Request</label>
          <div className={styles.request}>
            <select className={`select ${styles.method}`} value={form.method} onChange={set('method')} aria-label="Method">
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            {base && <span className={styles.base}>{base}</span>}
            <input id="load-url" className="input" value={form.url} onChange={set('url')} placeholder="/api/health" spellCheck={false} />
          </div>
          {fieldErrors.method && <p className={styles.fieldError}>{fieldErrors.method}</p>}
          {fieldErrors.url ? (
            <p className={styles.fieldError}>{fieldErrors.url}</p>
          ) : (
            <p className={styles.hint}>Redirects are not followed, so use the final address. A 4xx or 5xx response counts as an error.</p>
          )}
        </div>
      )}

      <div className={styles.row3}>
        {field('vus', 'Virtual users', <input id="load-vus" className="input" type="number" min="1" value={form.vus} onChange={set('vus')} />, limits && `Up to ${limits.maxVus}`)}
        {field('rampUpSec', 'Ramp-up (seconds)', <input id="load-rampUpSec" className="input" type="number" min="0" value={form.rampUpSec} onChange={set('rampUpSec')} />, 'From 0 to all users')}
        {field(
          'durationSec',
          'Duration at full load (seconds)',
          <input id="load-durationSec" className="input" type="number" min="10" value={form.durationSec} onChange={set('durationSec')} />,
          limits && `Ramp-up + duration up to ${limits.maxDurationSec}s`
        )}
      </div>

      <div className={styles.row3}>
        {field('maxP95Ms', 'Pass if p95 response time is under (ms)', <input id="load-maxP95Ms" className="input" type="number" min="1" value={form.maxP95Ms} onChange={set('maxP95Ms')} placeholder="Not checked" />)}
        {field(
          'maxErrorRatePct',
          'and failed requests are at most (%)',
          <input id="load-maxErrorRatePct" className="input" type="number" min="0" max="100" step="0.1" value={form.maxErrorRatePct} onChange={set('maxErrorRatePct')} placeholder="Not checked" />
        )}
        <p className={`${styles.hint} ${styles.limitsHint}`}>Leave a limit empty to not check it. 95% of requests must be faster than the p95 limit.</p>
      </div>

      <details className={styles.advanced} open={Boolean(test?.headerNames.length || test?.body)}>
        <summary>{scenario ? 'Headers for every step' : 'Headers and body'}</summary>
        {field(
          'headers',
          scenario ? 'Headers sent with every step' : 'Headers',
          <textarea
            id="load-headers"
            className={`input ${styles.code}`}
            value={form.headers}
            onChange={set('headers')}
            placeholder={test?.headerNames.length ? `Saved: ${test.headerNames.join(', ')}. Type all headers again to replace them.` : 'Authorization: Bearer …\nContent-Type: application/json'}
            spellCheck={false}
            disabled={clearHeaders}
          />,
          `One "Name: value" per line. Stored encrypted; values are never shown again.${scenario ? ' Put API keys here, not in the steps.' : ''}`
        )}
        {test?.headerNames.length > 0 && (
          <label className={styles.check}>
            <input type="checkbox" checked={clearHeaders} onChange={(e) => setClearHeaders(e.target.checked)} /> Remove the saved headers
          </label>
        )}
        {hasBody &&
          !scenario &&
          field(
            'body',
            'Body',
            <textarea id="load-body" className={`input ${styles.code}`} value={form.body} onChange={set('body')} placeholder='{"query": "…"}' spellCheck={false} />,
            'Sent as is with every request. Set Content-Type in the headers.'
          )}
      </details>

      {error && <p className={styles.fieldError}>{error}</p>}
      <div className={styles.actions}>
        <button className="btn btn-primary" disabled={saving} id="load-save">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {test ? 'Save changes' : 'Create load test'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
