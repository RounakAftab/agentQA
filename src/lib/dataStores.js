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
const approvalsStore = createListStore('/api/approvals', 'approvals');

export function useProjects() {
  const { items, loaded } = projectsStore.useStore();
  return { projects: items, loaded };
}

export function useAuditEvents() {
  const { items, loaded } = auditStore.useStore();
  return { events: items, loaded };
}

// Reviews of QA Agent output. Read by the Approvals page, the sidebar badge and the header bell.
export function useApprovals() {
  const { items, loaded } = approvalsStore.useStore();
  return { approvals: items, loaded, pendingCount: items.filter((a) => a.status === 'pending').length };
}

export const refreshProjects = projectsStore.refresh;
export const refreshAudit = auditStore.refresh;
export const refreshApprovals = approvalsStore.refresh;

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

// Pending counts on the project cards and the audit trail both change with a decision.
async function mutateApproval(method, url, body) {
  const result = await call(method, url, body);
  if (result.ok || result.status === 409) await Promise.all([refreshApprovals(), refreshProjects(), refreshAudit()]);
  return result;
}

export const decideApproval = (id, status, comment) => mutateApproval('PATCH', `/api/approvals/${id}`, { status, comment });
export const commentOnApproval = (id, text) => mutateApproval('POST', `/api/approvals/${id}/comments`, { text });
