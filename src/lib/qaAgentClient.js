'use client';

import { useCallback, useEffect, useState } from 'react';

// Client hooks for the QA Agent pages. Runs change while the worker is busy, so these poll:
// quickly while something is queued or running, slowly otherwise.
const FAST_POLL_MS = 2_500;
const SLOW_POLL_MS = 15_000;
const isActive = (run) => run && (run.status === 'QUEUED' || run.status === 'RUNNING');

async function getJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection.' } };
  }
}

function usePolling(url, pickActive) {
  const [state, setState] = useState({ data: null, loaded: false, error: '' });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    let timer;
    const load = async () => {
      const result = await getJson(url);
      if (cancelled) return;
      setState({ data: result.ok ? result.data : null, loaded: true, error: result.ok ? '' : result.data.error ?? 'Could not load' });
      timer = setTimeout(load, result.ok && pickActive(result.data) ? FAST_POLL_MS : SLOW_POLL_MS);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, tick, pickActive]);

  return { ...state, refresh };
}

const runsActive = (data) => data.runs?.some(isActive);
const requirementsActive = (data) => data.requirements?.some((r) => isActive(r.lastRun));
const runActive = (data) => isActive(data.run);
const never = () => false;

export function useAgentRuns(projectId) {
  const { data, loaded, error, refresh } = usePolling(
    projectId ? `/api/qa-agent/runs?projectId=${encodeURIComponent(projectId)}` : null,
    runsActive
  );
  return {
    runs: data?.runs ?? [],
    worker: data?.worker ?? { online: false, lastSeenAt: null },
    loaded,
    error,
    refresh,
  };
}

export function useAgentRun(id) {
  const { data, loaded, error, refresh } = usePolling(id ? `/api/qa-agent/runs/${encodeURIComponent(id)}` : null, runActive);
  return { run: data?.run ?? null, worker: data?.worker ?? null, loaded, error, refresh };
}

export function useJiraIssues(projectId) {
  const { data, loaded, error, refresh } = usePolling(
    projectId ? `/api/qa-agent/issues?projectId=${encodeURIComponent(projectId)}` : null,
    never
  );
  return {
    issues: data?.issues ?? [],
    configured: data?.configured ?? true,
    loaded,
    error: error || data?.error || '',
    refresh,
  };
}

// `withJira` also returns the Jira tickets the agent has picked up.
export function useRequirements(projectId, { withJira = false } = {}) {
  const { data, loaded, error, refresh } = usePolling(
    projectId ? `/api/qa-agent/requirements?projectId=${encodeURIComponent(projectId)}${withJira ? '&all=1' : ''}` : null,
    requirementsActive
  );
  return { requirements: data?.requirements ?? [], loaded, error, refresh };
}

async function send(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection.' } };
  }
}

export const startAgentRun = ({ projectId, issueKey, summary, requirementId }) =>
  send('POST', '/api/qa-agent/runs', { projectId, issueKey, summary, requirementId });
export const createRequirement = (projectId, form) => send('POST', '/api/qa-agent/requirements', { ...form, projectId });
export const updateRequirement = (id, form) => send('PATCH', `/api/qa-agent/requirements/${encodeURIComponent(id)}`, form);
export const deleteRequirement = (id) => send('DELETE', `/api/qa-agent/requirements/${encodeURIComponent(id)}`);
export const cancelAgentRun = (id) => send('DELETE', `/api/qa-agent/runs/${encodeURIComponent(id)}`);
export const startRunner = (id) => send('POST', `/api/qa-agent/runs/${encodeURIComponent(id)}`);

export const RUN_STATUS = {
  QUEUED: { label: 'Queued', color: 'neutral' },
  RUNNING: { label: 'Running', color: 'info' },
  PASSED: { label: 'Done', color: 'success' },
  FAILED: { label: 'Failed', color: 'danger' },
  CANCELLED: { label: 'Cancelled', color: 'warning' },
};

export { isActive as isRunActive };
