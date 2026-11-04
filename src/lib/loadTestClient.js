'use client';

import { useCallback, useState } from 'react';
import { request, useLoad, usePoll } from '@/lib/codegenClient';

// Client calls for the Load Tests pages.

const pickList = (data) => ({ tests: data.tests ?? [], limits: data.limits ?? null });
const pickOne = (data) => ({ test: data.test ?? null, limits: data.limits ?? null });

export function useLoadTests() {
  const { value, loaded, error, refresh } = useLoad('/api/load-tests', pickList);
  return { tests: value?.tests ?? [], limits: value?.limits ?? null, loaded, error, refresh };
}

export function useLoadTest(id) {
  const { value, loaded, error, refresh } = useLoad(id ? `/api/load-tests/${encodeURIComponent(id)}` : null, pickOne);
  return { test: value?.test ?? null, limits: value?.limits ?? null, loaded, error, refresh };
}

const RUN_ACTIVE = new Set(['QUEUED', 'RUNNING']);
export const isLoadRunActive = (run) => Boolean(run && RUN_ACTIVE.has(run.status));

// A test's latest runs. `refresh()` reloads at once (after starting one).
export function useLoadRuns(testId) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const data = usePoll(testId ? `/api/load-tests/${encodeURIComponent(testId)}/runs?v=${version}` : null, 5_000);
  return { runs: data?.runs ?? [], worker: data?.worker ?? null, refresh };
}

// One run with its samples and console, polled every two seconds until it ends.
export function useLoadRun(runId) {
  const [ended, setEnded] = useState(null);
  const data = usePoll(runId ? `/api/load-tests/runs/${encodeURIComponent(runId)}` : null, ended === runId ? null : 2_000);
  const run = data?.run?.id === runId ? data.run : null;
  if (run && !isLoadRunActive(run) && ended !== runId) setEnded(runId);
  return run;
}

export const createLoadTest = (form) => request('POST', '/api/load-tests', form);
// "Draft with AI": queues the description for the worker, which asks Claude. Nothing is saved.
export const startLoadDraft = (projectId, prompt) => request('POST', '/api/load-tests/draft', { projectId, prompt });
// { status: QUEUED | RUNNING | DONE | ERROR, draft?, notes?, fieldErrors?, error?, worker }
export const getLoadDraft = (id) => request('GET', `/api/load-tests/draft/${encodeURIComponent(id)}`);
export const updateLoadTest = (id, changes) => request('PATCH', `/api/load-tests/${encodeURIComponent(id)}`, changes);
export const deleteLoadTest = (id) => request('DELETE', `/api/load-tests/${encodeURIComponent(id)}`);
export const startLoadRun = (testId) => request('POST', `/api/load-tests/${encodeURIComponent(testId)}/runs`);
export const cancelLoadRun = (runId) => request('DELETE', `/api/load-tests/runs/${encodeURIComponent(runId)}`);

export const LOAD_RUN_STATUS = {
  QUEUED: { label: 'Waiting for the worker', color: 'neutral' },
  RUNNING: { label: 'Running', color: 'info' },
  PASSED: { label: 'Passed', color: 'success' },
  FAILED: { label: 'Limit crossed', color: 'danger' },
  ERROR: { label: 'Error', color: 'danger' },
  CANCELLED: { label: 'Stopped', color: 'warning' },
};

// "2m 30s" / "45s"
export const formatSeconds = (s) => (s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`);
export const formatMs = (ms) => (ms == null ? '–' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
