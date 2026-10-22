'use client';

import { useEffect, useSyncExternalStore } from 'react';

// Small cached fetchers for lists served by the API. Each store loads once on first use,
// is shared by every component that reads it, and refreshes after a mutation.

function createListStore(url, key) {
  let state = { items: [], loaded: false };
  let loading = null;
  const listeners = new Set();

  const setState = (next) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };

  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const res = await fetch(url);
        if (res.ok) setState({ items: (await res.json())[key], loaded: true });
        else setState({ loaded: true });
      } catch {
        setState({ loaded: true });
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function useStore() {
    const snapshot = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => state,
      () => state
    );
    useEffect(() => {
      if (!state.loaded) refresh();
    }, []);
    return snapshot;
  }

  return { refresh, useStore };
}

const projectsStore = createListStore('/api/projects', 'projects');
const auditStore = createListStore('/api/audit', 'events');

export function useProjects() {
  const { items, loaded } = projectsStore.useStore();
  return { projects: items, loaded };
}

export function useAuditEvents() {
  const { items, loaded } = auditStore.useStore();
  return { events: items, loaded };
}

export const refreshProjects = projectsStore.refresh;
export const refreshAudit = auditStore.refresh;

async function call(method, url, body) {
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

async function mutateProject(method, url, body) {
  const result = await call(method, url, body);
  if (result.ok) await Promise.all([refreshProjects(), refreshAudit()]);
  return result;
}

export const createProject = (form) => mutateProject('POST', '/api/projects', form);
export const updateProject = (id, form) => mutateProject('PATCH', `/api/projects/${id}`, form);
export const deleteProject = (id) => mutateProject('DELETE', `/api/projects/${id}`);
