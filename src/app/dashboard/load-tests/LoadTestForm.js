'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Loader2, Save, Sparkles, X } from 'lucide-react';
import { createLoadTest, getLoadDraft, startLoadDraft, updateLoadTest } from '@/lib/loadTestClient';
import { SPEED_PRESETS, TEST_TYPES, describeLoad, matchTestType, speedPresetFor, testTypeValues } from '@/lib/loadPresets';
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

// A short explanation shown on hover or focus next to a label.
const Help = ({ text }) => (
  <span className={styles.help} title={text} aria-label={text} role="img" tabIndex={0}>
    <Info size={13} />
  </span>
);

const HELP = {
  vus: 'How many people use the app at the same time. Each virtual user repeats the request (or the steps) over and over.',
  rampUpSec: 'Users are added gradually over this time, like people arriving, instead of all at once. 0 starts everyone together.',
  durationSec: 'How long all users keep going after the ramp-up. At least 10 seconds.',
  speed: '95% of requests must be faster than this (the p95). The slowest 5% are ignored, so one slow outlier doesn’t fail the test.',
  errors: 'A request fails on a 4xx/5xx response, a timeout, or a different status than a step expects. 0 means no failure is allowed.',
};

const SPEED_OPTIONS = [
  ...SPEED_PRESETS.map((p) => ({ id: p.id, label: `${p.label} · under ${p.ms >= 1000 ? `${p.ms / 1000} s` : `${p.ms} ms`}`, title: p.hint })),
  { id: 'custom', label: 'Custom', title: 'Your own limit in milliseconds' },
  { id: 'off', label: 'Don’t check', title: 'Response time never fails the test' },
];

const initialForm = (test, projects, limits) => {
  if (!test) {
    // A new test starts as a quick check: safe to run straight away.
    const first = projects.find((p) => p.appBaseUrl);
    return { projectId: first?.id ?? '', name: '', kind: 'request', method: 'GET', url: '/', body: '', headers: '', ...testTypeValues('smoke', limits), maxP95Ms: '1000' };
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
  const [form, setForm] = useState(() => initialForm(test, projects, limits));
  // "Custom" stays chosen even when its value happens to equal a preset.
  const [customSpeed, setCustomSpeed] = useState(() => speedPresetFor(test?.maxP95Ms) === 'custom');
  const [steps, setSteps] = useState(() => (test?.kind === 'scenario' ? stepsToForm(test.steps) : [newStep(1)]));
  const [clearHeaders, setClearHeaders] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [drafting, setDrafting] = useState(null); // null, or what the draft is waiting on
  const pollRef = useRef(0); // bumped to stop polling (cancel, unmount, a new draft)
  useEffect(() => () => void (pollRef.current += 1), []);
  const [draftError, setDraftError] = useState('');
  const [draftNotes, setDraftNotes] = useState(null);
  // Editing a field clears its error (ramp-up and duration share the total-time error).
  const LINKED = { rampUpSec: ['rampUpSec', 'durationSec'], durationSec: ['rampUpSec', 'durationSec'] };
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFieldErrors((errs) => {
      const keys = (LINKED[key] ?? [key]).filter((k) => errs[k]);
      if (keys.length === 0) return errs;
      const next = { ...errs };
      for (const k of keys) delete next[k];
      return next;
    });
  };
  const vusHint = !limits
    ? null
    : limits.maxVus != null
      ? `Up to ${limits.maxVus.toLocaleString()}`
      : Number(form.vus) > 1000
        ? 'A heavy load: one worker computer usually drives a few thousand users at most'
        : 'No upper limit; big loads need a strong worker computer';

  const project = test ? test.project : projects.find((p) => p.id === form.projectId);
  const base = origin(project?.appBaseUrl ?? '');
  const hasBody = BODY_METHODS.has(form.method);
  const scenario = form.kind === 'scenario';
  const hasTestAccount = test ? Boolean(test.project?.hasTestAccount) : Boolean(project?.e2eUsername && project?.e2ePasswordSet);

  const testType = matchTestType(form, limits);
  const chosenType = TEST_TYPES.find((t) => t.id === testType);
  const chooseType = (id) => {
    setForm((f) => ({ ...f, ...testTypeValues(id, limits) }));
    setFieldErrors(({ vus: _v, rampUpSec: _r, durationSec: _d, maxErrorRatePct: _e, ...rest }) => rest);
  };
  const load = describeLoad({ ...form, steps });

  const speed = customSpeed ? 'custom' : speedPresetFor(form.maxP95Ms);
  const chooseSpeed = (id) => {
    const preset = SPEED_PRESETS.find((p) => p.id === id);
    setCustomSpeed(id === 'custom');
    setForm((f) => ({ ...f, maxP95Ms: preset ? String(preset.ms) : id === 'off' ? '' : f.maxP95Ms || '1500' }));
    setFieldErrors(({ maxP95Ms: _p, ...rest }) => rest);
  };

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

  // Claude fills in the form from the description; the person reviews it and saves as usual.
  // The worker asks Claude (with your Claude login or an API key), so the form polls for the answer.
  const draft = async () => {
    const poll = ++pollRef.current;
    setDrafting('Sending…');
    setDraftError('');
    setDraftNotes(null);
    const started = await startLoadDraft(test ? test.project?.id : form.projectId, prompt);
    if (poll !== pollRef.current) return;
    if (!started.ok) {
      setDrafting(null);
      return setDraftError(started.data.error ?? 'Could not draft the load test');
    }
    let result;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      if (poll !== pollRef.current) return;
      result = await getLoadDraft(started.data.id);
      if (poll !== pollRef.current) return;
      const status = result.data.status;
      if (!result.ok || status === 'DONE' || status === 'ERROR') break;
      setDrafting(
        status === 'RUNNING'
          ? 'Claude is drafting…'
          : result.data.worker?.online
            ? 'Waiting for the worker…'
            : 'No worker is running. Start "npm run agent:worker" and the draft begins.'
      );
    }
    setDrafting(null);
    if (!result.ok || result.data.status === 'ERROR') return setDraftError(result.data.error ?? 'Could not draft the load test');
    const { steps: draftSteps, ...fields } = result.data.draft;
    setForm((f) => ({ ...f, ...fields }));
    if (fields.kind === 'scenario') setSteps(stepsToForm(draftSteps));
    setFieldErrors(result.data.fieldErrors ?? {});
    setError('');
    setDraftNotes(result.data.notes ?? []);
  };
  const canDraft = Boolean(test || form.projectId) && prompt.trim().length >= 10 && !drafting;
  const stopDraft = () => {
    pollRef.current += 1;
    setDrafting(null);
  };

  const field = (key, label, input, hint, help) => (
    <div className={styles.field}>
      <label className="label" htmlFor={`load-${key}`}>
        {label}
        {help && <Help text={help} />}
      </label>
      {input}
      {fieldErrors[key] ? <p className={styles.fieldError}>{fieldErrors[key]}</p> : hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.aiPanel} id="load-ai-panel">
        <label className="label" htmlFor="load-ai-prompt">
          <Sparkles size={14} /> Describe the load test{test ? ' to rewrite it' : ''}
        </label>
        <textarea
          id="load-ai-prompt"
          className="input"
          rows={3}
          maxLength={4000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canDraft) {
              e.preventDefault();
              draft();
            }
          }}
          placeholder="e.g. 500 users log in, search for 'shoes' and add the first result to the cart. Ramp up over 2 minutes, hold for 5. Fail if 95% of requests take over 1 s or more than 1% fail."
        />
        <div className={styles.aiActions}>
          <span className={styles.hint}>
            {!test && !form.projectId ? 'Choose a project below first. ' : ''}Claude fills in the form below; review it, then save. Mention real endpoints if you know them.
          </span>
          {drafting ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={stopDraft} id="load-ai-stop">
              <X size={14} /> Stop waiting
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={draft} disabled={!canDraft} id="load-ai-draft">
              <Sparkles size={14} /> Draft with AI
            </button>
          )}
        </div>
        {drafting && (
          <p className={styles.aiStatus} role="status">
            <Loader2 size={14} className="animate-spin" /> {drafting}
          </p>
        )}
        {draftError && <p className={styles.fieldError}>{draftError}</p>}
        {draftNotes && (
          <div className={styles.aiNotes} role="status">
            <div className={styles.aiNotesHead}>
              <strong>{draftNotes.length ? 'Drafted. Check these assumptions:' : 'Drafted. Review the form below, then save.'}</strong>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setDraftNotes(null)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
            {draftNotes.length > 0 && (
              <ul>
                {draftNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

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

      <section className={styles.section} aria-labelledby="load-shape-title">
        <h4 className={styles.sectionTitle} id="load-shape-title">How much load</h4>
        <div className={styles.types} role="radiogroup" aria-label="Kind of load test">
          {TEST_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={testType === t.id}
              className={`${styles.kind} ${testType === t.id ? styles.kindActive : ''}`}
              onClick={() => chooseType(t.id)}
              id={`load-type-${t.id}`}
            >
              <strong>{t.label}</strong>
              <span>{t.hint}</span>
            </button>
          ))}
        </div>
        <p className={styles.hint}>{chosenType ? chosenType.when : 'Custom numbers. Pick a kind of test above to start from a sensible shape.'}</p>

        <div className={styles.row3}>
          {field('vus', 'Virtual users', <input id="load-vus" className="input" type="number" min="1" value={form.vus} onChange={set('vus')} />, vusHint, HELP.vus)}
          {field('rampUpSec', 'Ramp-up (seconds)', <input id="load-rampUpSec" className="input" type="number" min="0" value={form.rampUpSec} onChange={set('rampUpSec')} />, 'From 0 to all users', HELP.rampUpSec)}
          {field(
            'durationSec',
            'Then hold for (seconds)',
            <input id="load-durationSec" className="input" type="number" min="10" value={form.durationSec} onChange={set('durationSec')} />,
            limits && `Ramp-up + hold up to ${limits.maxDurationSec} s`,
            HELP.durationSec
          )}
        </div>

        {load && (
          <div className={styles.loadSummary} role="status" id="load-summary">
            <p>{load.text}</p>
            <p className={styles.hint}>{load.estimate}</p>
            {load.warning && (
              <p className={styles.loadWarning}>
                <AlertTriangle size={13} /> {load.warning}
              </p>
            )}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="load-pass-title">
        <h4 className={styles.sectionTitle} id="load-pass-title">When does it pass?</h4>
        <div className={styles.field}>
          <span className="label">
            Response time limit
            <Help text={HELP.speed} />
          </span>
          <div className={styles.segments} role="radiogroup" aria-label="Response time limit">
            {SPEED_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={speed === o.id}
                title={o.title}
                className={`${styles.segment} ${speed === o.id ? styles.segmentActive : ''}`}
                onClick={() => chooseSpeed(o.id)}
                id={`load-speed-${o.id}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {speed === 'custom' && (
            <div className={styles.customSpeed}>
              <input id="load-maxP95Ms" className="input" type="number" min="1" value={form.maxP95Ms} onChange={set('maxP95Ms')} aria-label="Response time limit in milliseconds" />
              <span className={styles.hint}>ms, for 95% of requests</span>
            </div>
          )}
          {fieldErrors.maxP95Ms ? (
            <p className={styles.fieldError}>{fieldErrors.maxP95Ms}</p>
          ) : (
            speed !== 'off' && speed !== 'custom' && <p className={styles.hint}>{SPEED_PRESETS.find((p) => p.id === speed)?.hint}</p>
          )}
        </div>
        <div className={styles.row3}>
          {field(
            'maxErrorRatePct',
            'Failed requests at most (%)',
            <input id="load-maxErrorRatePct" className="input" type="number" min="0" max="100" step="0.1" value={form.maxErrorRatePct} onChange={set('maxErrorRatePct')} placeholder="Not checked" />,
            'Empty: failures never fail the test',
            HELP.errors
          )}
        </div>
      </section>

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
