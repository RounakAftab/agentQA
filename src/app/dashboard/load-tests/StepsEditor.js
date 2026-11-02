'use client';

import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import styles from './StepsEditor.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const MAX_STEPS = 10;
const MAX_EXTRACTS = 5;
const BUILTIN = ['username', 'password', 'vu', 'iter'];

let nextKey = 0;
const key = () => `step-${nextKey++}`;
const text = (v) => (v == null ? '' : String(v));

export const newStep = (n = 1) => ({ key: key(), name: `Step ${n}`, method: 'GET', path: '/', headers: '', body: '', expectStatus: '', thinkTimeSec: '1', maxP95Ms: '', extract: [] });

// Saved steps (headers as [{ name, value }]) to form state (headers as "Name: value" lines).
export const stepsToForm = (steps) =>
  (steps ?? []).map((s) => ({
    key: key(),
    name: s.name,
    method: s.method,
    path: s.path,
    headers: (s.headers ?? []).map((h) => `${h.name}: ${h.value}`).join('\n'),
    body: text(s.body),
    expectStatus: text(s.expectStatus),
    thinkTimeSec: text(s.thinkTimeSec),
    maxP95Ms: text(s.maxP95Ms),
    extract: (s.extract ?? []).map((e) => ({ ...e })),
  }));

// Form state to what the API takes.
export const stepsFromForm = (steps) => steps.map(({ key: _key, ...s }) => s);

// The steps of a scenario: request, expected status, think time, a p95 limit, and values to save from
// the response for later steps. `base` is the project's app origin.
export default function StepsEditor({ steps, onChange, base, hasTestAccount }) {
  const update = (i, changes) => onChange(steps.map((s, j) => (j === i ? { ...s, ...changes } : s)));
  const move = (i, by) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const setExtract = (i, extract) => update(i, { extract });

  return (
    <div className={styles.steps}>
      {steps.map((step, i) => {
        // Values this step can use: built in, plus those saved by earlier steps.
        const saved = steps.slice(0, i).flatMap((s) => s.extract.map((e) => e.var.trim()).filter(Boolean));
        const available = [...BUILTIN.filter((v) => hasTestAccount || (v !== 'username' && v !== 'password')), ...saved];
        const field = (name, label, props) => (
          <label className={styles.small}>
            <span>{label}</span>
            <input className="input" value={step[name]} onChange={(e) => update(i, { [name]: e.target.value })} {...props} />
          </label>
        );
        return (
          <div key={step.key} className={styles.step}>
            <div className={styles.head}>
              <span className={styles.number}>{i + 1}</span>
              <input
                className={`input ${styles.name}`}
                value={step.name}
                onChange={(e) => update(i, { name: e.target.value })}
                aria-label={`Step ${i + 1} name`}
                placeholder="Step name, e.g. Log in"
              />
              <button type="button" className="btn btn-ghost btn-icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" title="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" title="Remove step" disabled={steps.length === 1} onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            </div>

            <div className={styles.request}>
              <select className={`select ${styles.method}`} value={step.method} onChange={(e) => update(i, { method: e.target.value })} aria-label={`Step ${i + 1} method`}>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              {base && <span className={styles.base}>{base}</span>}
              <input className="input" value={step.path} onChange={(e) => update(i, { path: e.target.value })} placeholder="/api/login" spellCheck={false} aria-label={`Step ${i + 1} path`} />
            </div>

            <div className={styles.row}>
              {field('expectStatus', 'Expected status', { type: 'number', min: 100, max: 599, placeholder: 'Any 2xx or 3xx' })}
              {field('thinkTimeSec', 'Think time after (s)', { type: 'number', min: 0, max: 60, step: 0.1 })}
              {field('maxP95Ms', 'Pass if p95 under (ms)', { type: 'number', min: 1, placeholder: 'Not checked' })}
            </div>

            <details className={styles.more} open={Boolean(step.headers || step.body || step.extract.length)}>
              <summary>Headers, body and values to save</summary>
              <label className={styles.small}>
                <span>Headers for this step</span>
                <textarea
                  className={`input ${styles.code}`}
                  value={step.headers}
                  onChange={(e) => update(i, { headers: e.target.value })}
                  placeholder={'Authorization: Bearer {{token}}\nContent-Type: application/json'}
                  spellCheck={false}
                />
              </label>
              {BODY_METHODS.has(step.method) && (
                <label className={styles.small}>
                  <span>Body</span>
                  <textarea
                    className={`input ${styles.code}`}
                    value={step.body}
                    onChange={(e) => update(i, { body: e.target.value })}
                    placeholder={'{"email": "{{username}}", "password": "{{password}}"}'}
                    spellCheck={false}
                  />
                </label>
              )}
              <div className={styles.small}>
                <span>Save from the response, for later steps</span>
                {step.extract.map((e, k) => (
                  <div key={k} className={styles.extract}>
                    <input
                      className="input"
                      value={e.var}
                      onChange={(ev) => setExtract(i, step.extract.map((x, j) => (j === k ? { ...x, var: ev.target.value } : x)))}
                      placeholder="token"
                      aria-label="Value name"
                      spellCheck={false}
                    />
                    <span className={styles.from}>from</span>
                    <select
                      className="select"
                      value={e.source}
                      onChange={(ev) => setExtract(i, step.extract.map((x, j) => (j === k ? { ...x, source: ev.target.value } : x)))}
                      aria-label="Where from"
                    >
                      <option value="json">JSON field</option>
                      <option value="header">Header</option>
                    </select>
                    <input
                      className="input"
                      value={e.path}
                      onChange={(ev) => setExtract(i, step.extract.map((x, j) => (j === k ? { ...x, path: ev.target.value } : x)))}
                      placeholder={e.source === 'header' ? 'X-Cart-Id' : 'data.token'}
                      aria-label={e.source === 'header' ? 'Header name' : 'JSON field path'}
                      spellCheck={false}
                    />
                    <button type="button" className="btn btn-ghost btn-icon" title="Remove" onClick={() => setExtract(i, step.extract.filter((_, j) => j !== k))}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {step.extract.length < MAX_EXTRACTS && (
                  <div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExtract(i, [...step.extract, { var: '', source: 'json', path: '' }])}>
                      <Plus size={13} /> Save a value
                    </button>
                  </div>
                )}
              </div>
            </details>
            <p className={styles.hint}>
              Values you can use here:{' '}
              {available.map((v) => (
                <code key={v}>{`{{${v}}}`}</code>
              ))}
              {!hasTestAccount && " · Set the project's test account to use {{username}} and {{password}}."}
            </p>
          </div>
        );
      })}
      {steps.length < MAX_STEPS && (
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...steps, newStep(steps.length + 1)])}>
            <Plus size={13} /> Add step
          </button>
        </div>
      )}
    </div>
  );
}
