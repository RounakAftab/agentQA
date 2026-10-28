'use client';

import { useCallback, useEffect, useState } from 'react';

// Client calls for the Codegen pages.

async function request(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection.' } };
  }
}

function useLoad(url, pick) {
  const [state, setState] = useState({ value: null, loaded: false, error: '' });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    request('GET', url).then((result) => {
      if (cancelled) return;
      setState({ value: result.ok ? pick(result.data) : null, loaded: true, error: result.ok ? '' : result.data.error ?? 'Could not load' });
    });
    return () => {
      cancelled = true;
    };
  }, [url, tick, pick]);

  return { ...state, refresh };
}

const pickScripts = (data) => data.scripts ?? [];
const pickScript = (data) => data.script ?? null;

export function useCodegenScripts() {
  const { value, loaded, error, refresh } = useLoad('/api/codegen', pickScripts);
  return { scripts: value ?? [], loaded, error, refresh };
}

export function useCodegenScript(id) {
  const { value, loaded, error, refresh } = useLoad(id ? `/api/codegen/${encodeURIComponent(id)}` : null, pickScript);
  return { script: value, loaded, error, refresh };
}

// Polls `url` every `intervalMs` (null = stop) and returns the latest response body.
function usePoll(url, intervalMs) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    let timer;
    const load = async () => {
      const result = await request('GET', url);
      if (cancelled) return;
      if (result.ok) setData(result.data);
      if (intervalMs) timer = setTimeout(load, intervalMs);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, intervalMs]);
  return data;
}

const RECORDING_ACTIVE = new Set(['QUEUED', 'RECORDING', 'DONE', 'SAVING']);
export const isRecordingActive = (recording) => Boolean(recording && RECORDING_ACTIVE.has(recording.status));

// Which computer would open the recorder, and the user's own recording still open (after a reload).
export function useRecorderStatus() {
  const data = usePoll('/api/codegen/recordings', 5_000);
  return { worker: data?.worker ?? null, openRecording: data?.recording ?? null };
}

// A live recording, polled quickly until it ends.
export function useRecording(id) {
  const [ended, setEnded] = useState(null); // id of a recording known to be over
  const data = usePoll(id ? `/api/codegen/recordings/${encodeURIComponent(id)}` : null, ended === id ? null : 1_500);
  const recording = data?.recording?.id === id ? data.recording : null;
  if (recording && !isRecordingActive(recording) && ended !== id) setEnded(id);
  return { recording, worker: data?.worker ?? null };
}

const RUN_ACTIVE = new Set(['QUEUED', 'RUNNING']);
export const isRunActive = (run) => Boolean(run && RUN_ACTIVE.has(run.status));

// A script's latest runs. `refresh()` reloads at once (after starting one).
export function useScriptRuns(scriptId) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const data = usePoll(scriptId ? `/api/codegen/${encodeURIComponent(scriptId)}/runs?v=${version}` : null, 5_000);
  return { runs: data?.runs ?? [], worker: data?.worker ?? null, refresh };
}

// One run with its console and results, polled every second until it ends.
export function useScriptRun(runId) {
  const [ended, setEnded] = useState(null);
  const data = usePoll(runId ? `/api/codegen/runs/${encodeURIComponent(runId)}` : null, ended === runId ? null : 1_000);
  const run = data?.run?.id === runId ? data.run : null;
  if (run && !isRunActive(run) && ended !== runId) setEnded(runId);
  return run;
}

export const startScriptRun = (scriptId, options) => request('POST', `/api/codegen/${encodeURIComponent(scriptId)}/runs`, options);
export const cancelScriptRun = (runId) => request('DELETE', `/api/codegen/runs/${encodeURIComponent(runId)}`);
export const applyHealedFix = (runId) => request('POST', `/api/codegen/runs/${encodeURIComponent(runId)}/apply`);

export const startRecording = (form) => request('POST', '/api/codegen/recordings', form);
export const cancelRecording = (id) => request('DELETE', `/api/codegen/recordings/${encodeURIComponent(id)}`);
export const createCodegenScript = (form) => request('POST', '/api/codegen', form);
export const updateCodegenScript = (id, changes) => request('PATCH', `/api/codegen/${encodeURIComponent(id)}`, changes);
export const deleteCodegenScript = (id) => request('DELETE', `/api/codegen/${encodeURIComponent(id)}`);
export const downloadUrl = (id, style) => `/api/codegen/${encodeURIComponent(id)}/download?style=${style}`;

// The command that opens Playwright's recorder on the site.
export const recorderCommand = (url) => `npx playwright codegen ${/^[\w:/?#&=.%~+-]+$/.test(url) ? url : `"${url.replace(/"/g, '')}"`}`;
