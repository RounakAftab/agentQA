'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useCurrentUser } from '@/lib/teamStore';
import { getRelativeTime } from '@/lib/format';
import {
  useCodegenScripts,
  useRecorderStatus,
  useRecording,
  createCodegenScript,
  deleteCodegenScript,
  startRecording,
  cancelRecording,
  recorderCommand,
} from '@/lib/codegenClient';
import {
  Code2,
  Copy,
  Check,
  Loader2,
  Wand2,
  Trash2,
  ChevronRight,
  Globe,
  AlertCircle,
  Circle,
  Monitor,
  Square,
  RotateCcw,
} from 'lucide-react';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];
const host = (url) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

function WorkerHint({ worker }) {
  if (!worker) return null;
  return worker.online ? (
    <p className={styles.hint}>
      <Monitor size={12} /> The browser opens on <strong>{worker.hostname}</strong>, where the AgentQA worker is running.
    </p>
  ) : (
    <p className={`${styles.hint} ${styles.hintWarn}`}>
      <AlertCircle size={12} /> No worker is running. Start <code>npm run agent:worker</code> on the computer where the
      browser should open. The recording starts as soon as it is up.
    </p>
  );
}

// Follows one recording from "waiting for the worker" to the saved script.
function RecordingPanel({ id, onDone }) {
  const router = useRouter();
  const { recording, worker } = useRecording(id);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (recording?.status === 'SAVED' && recording.scriptId) router.push(`/dashboard/codegen/${recording.scriptId}`);
  }, [recording, router]);

  const cancel = async () => {
    setCancelling(true);
    await cancelRecording(id);
  };

  if (!recording) {
    return (
      <div className={styles.recording}>
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  const { status } = recording;
  const cancelButton = (
    <button type="button" className="btn btn-secondary btn-sm" onClick={cancel} disabled={cancelling}>
      <Square size={13} /> {cancelling ? 'Cancelling…' : 'Cancel'}
    </button>
  );

  if (status === 'QUEUED') {
    return (
      <div className={styles.recording}>
        <div className={styles.recordingHead}>
          <Loader2 size={16} className="animate-spin" />
          <strong>Opening the recorder…</strong>
          {cancelButton}
        </div>
        <WorkerHint worker={worker} />
      </div>
    );
  }

  if (status === 'RECORDING') {
    return (
      <div className={`${styles.recording} ${styles.recordingLive}`}>
        <div className={styles.recordingHead}>
          <Circle size={12} className={styles.liveDot} />
          <strong>Recording on {recording.hostname}</strong>
          <span className={styles.stepCount}>{recording.stepCount} {recording.stepCount === 1 ? 'step' : 'steps'}</span>
          {cancelButton}
        </div>
        <p className={styles.hint}>
          A browser opened at {host(recording.startUrl)}. Use the site the way a user would. To check what a page shows,
          use the eye and check buttons in the recorder toolbar. <strong>Close the browser when you are done</strong> and
          the code is generated here.
        </p>
        {recording.liveCode && <pre className={styles.liveCode}>{recording.liveCode}</pre>}
      </div>
    );
  }

  if (status === 'DONE' || status === 'SAVING' || status === 'SAVED') {
    return (
      <div className={styles.recording}>
        <div className={styles.recordingHead}>
          <Loader2 size={16} className="animate-spin" />
          <strong>Recording finished. Generating code from {recording.stepCount} steps…</strong>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.recording}>
      <div className={styles.recordingHead}>
        <AlertCircle size={16} className={status === 'FAILED' ? 'text-danger' : 'text-muted'} />
        <strong>{status === 'FAILED' ? recording.error : 'Recording cancelled.'}</strong>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>
          <RotateCcw size={13} /> Record again
        </button>
      </div>
    </div>
  );
}

export default function CodegenPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const canEdit = OPERATOR_ROLES.includes(me.role);
  const { scripts, loaded, error, refresh } = useCodegenScripts();
  const { worker, openRecording } = useRecorderStatus();

  const [form, setForm] = useState({ startUrl: '', title: '', sourceCode: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [recordingId, setRecordingId] = useState(null);
  const [dismissed, setDismissed] = useState(null);

  // A recording left open before a reload is picked up again.
  const activeId = recordingId ?? (openRecording && openRecording.id !== dismissed ? openRecording.id : null);

  const url = form.startUrl.trim();
  const command = recorderCommand(url || 'https://your-site.example');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the command is still selectable */
    }
  };

  const record = async () => {
    setSaving(true);
    const result = await startRecording({ startUrl: form.startUrl, title: form.title });
    setSaving(false);
    if (result.ok || result.status === 409) {
      setFieldErrors({});
      setRecordingId(result.data.recording.id);
      return;
    }
    setFieldErrors(result.data.fieldErrors ?? { startUrl: result.data.error ?? 'Could not start the recording' });
  };

  const resetRecording = () => {
    setDismissed(activeId);
    setRecordingId(null);
    refresh();
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const result = await createCodegenScript(form);
    setSaving(false);
    if (result.ok) {
      router.push(`/dashboard/codegen/${result.data.script.id}`);
      return;
    }
    setFieldErrors(result.data.fieldErrors ?? { sourceCode: result.data.error ?? 'Could not create the script' });
  };

  const remove = async (script) => {
    setConfirmDelete(null);
    await deleteCodegenScript(script.id);
    refresh();
  };

  return (
    <>
      <Header title="Codegen" subtitle="Record a flow on any site and turn it into Playwright tests" />
      <div className={styles.content}>
        {canEdit && (
          <div className={`card ${styles.newCard}`} id="codegen-new">
            <div className={styles.step}>
              <span className={styles.stepNo}>1</span>
              <div className={styles.stepBody}>
                <label className="label" htmlFor="codegen-url">Site URL</label>
                <div className={styles.submitRow}>
                  <input
                    id="codegen-url"
                    className="input"
                    placeholder="https://your-site.example/login"
                    value={form.startUrl}
                    onChange={set('startUrl')}
                    disabled={Boolean(activeId)}
                  />
                  <input
                    className={`input ${styles.nameInput}`}
                    placeholder="Name (optional)"
                    value={form.title}
                    onChange={set('title')}
                    aria-label="Name"
                    disabled={Boolean(activeId)}
                  />
                </div>
                {fieldErrors.startUrl && <p className={styles.fieldError}>{fieldErrors.startUrl}</p>}
                {fieldErrors.title && <p className={styles.fieldError}>{fieldErrors.title}</p>}
              </div>
            </div>

            <div className={styles.step}>
              <span className={styles.stepNo}>2</span>
              <div className={styles.stepBody}>
                <span className="label">Record the flow</span>
                {activeId ? (
                  <RecordingPanel key={activeId} id={activeId} onDone={resetRecording} />
                ) : (
                  <>
                    <div>
                      <button type="button" className="btn btn-primary" onClick={record} disabled={saving || !url} id="codegen-record">
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Circle size={14} />} Start recording
                      </button>
                    </div>
                    <WorkerHint worker={worker} />
                  </>
                )}
              </div>
            </div>

            {!activeId && (
              <details className={styles.manual}>
                <summary>No worker? Run the recorder yourself and paste the code</summary>
                <form onSubmit={submit} className={styles.stepBody}>
                  <div className={styles.command}>
                    <code>{command}</code>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={copyCommand} title="Copy command">
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <textarea
                    id="codegen-source"
                    className={`input ${styles.source}`}
                    placeholder={"import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n  await page.goto('https://…');\n  …\n});"}
                    value={form.sourceCode}
                    onChange={set('sourceCode')}
                    spellCheck={false}
                    aria-label="Recorder code"
                  />
                  {fieldErrors.sourceCode && <p className={styles.fieldError}>{fieldErrors.sourceCode}</p>}
                  <div>
                    <button className="btn btn-secondary" disabled={saving || !form.sourceCode.trim()} id="codegen-generate">
                      <Wand2 size={16} /> Generate code
                    </button>
                  </div>
                </form>
              </details>
            )}
            <p className={styles.hint}>
              Passwords and the username typed next to them are replaced with E2E_PASSWORD and E2E_USERNAME before
              anything is saved.
            </p>
          </div>
        )}

        <h3 className={styles.sectionTitle}>Saved scripts</h3>
        {!loaded ? (
          <div className={styles.empty}>
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : error ? (
          <div className={styles.empty}>
            <AlertCircle size={22} />
            <p>{error}</p>
          </div>
        ) : scripts.length === 0 ? (
          <div className={styles.empty}>
            <Code2 size={30} />
            <p>{canEdit ? 'Record a flow above to create the first script.' : 'No scripts yet.'}</p>
          </div>
        ) : (
          <div className={styles.list}>
            {scripts.map((script) => (
              <div key={script.id} className={styles.row}>
                <Link href={`/dashboard/codegen/${script.id}`} className={styles.rowMain}>
                  <Code2 size={18} className={styles.rowIcon} />
                  <div>
                    <div className={styles.rowTitle}>{script.title}</div>
                    <div className={styles.rowMeta}>
                      <Globe size={12} /> {host(script.startUrl)} · {script.stepCount} {script.stepCount === 1 ? 'step' : 'steps'}
                      {script.createdBy ? ` · ${script.createdBy.name}` : ''} · {getRelativeTime(script.updatedAt)}
                    </div>
                  </div>
                </Link>
                {canEdit &&
                  (confirmDelete === script.id ? (
                    <span className={styles.confirm}>
                      Delete?
                      <button className="btn btn-danger btn-sm" onClick={() => remove(script)}>Delete</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn btn-ghost btn-icon" title="Delete script" onClick={() => setConfirmDelete(script.id)}>
                      <Trash2 size={15} />
                    </button>
                  ))}
                <ChevronRight size={16} className={styles.rowChevron} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
