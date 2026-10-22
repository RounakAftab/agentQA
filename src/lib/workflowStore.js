'use client';

import { useSyncExternalStore } from 'react';

// Browser-local store for records created by the AI workflow, so the Approvals,
// Audit and Workflow pages stay in sync until a real backend is connected.

// v2: earlier versions held sample records, which are intentionally left behind.
const STORAGE_KEY = 'agentqa.workflow.v2';
const CHANGE_EVENT = 'agentqa:workflow-change';
const EMPTY = { approvals: [], runs: [], audit: [] };

let cachedRaw = null;
let cachedValue = EMPTY;

function readSnapshot() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedValue;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useWorkflowStore() {
  return useSyncExternalStore(subscribe, readSnapshot, () => EMPTY);
}

function write(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota) — records just won't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// kind: 'approvals' | 'runs' | 'audit'. Newest first; an existing id is merged.
export function upsertRecord(kind, record) {
  const current = readSnapshot();
  const list = current[kind];
  const exists = list.some((r) => r.id === record.id);
  const nextList = exists
    ? list.map((r) => (r.id === record.id ? { ...r, ...record } : r))
    : [record, ...list];
  write({ ...current, [kind]: nextList });
}

export function removeRecord(kind, id) {
  const current = readSnapshot();
  write({ ...current, [kind]: current[kind].filter((r) => r.id !== id) });
}

export function patchRecord(kind, id, patch) {
  const current = readSnapshot();
  if (!current[kind].some((r) => r.id === id)) return false;
  write({
    ...current,
    [kind]: current[kind].map((r) => (r.id === id ? { ...r, ...patch } : r)),
  });
  return true;
}
