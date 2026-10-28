'use client';

import { Suspense, use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useCurrentUser } from '@/lib/teamStore';
import { useCodegenScript, updateCodegenScript, downloadUrl } from '@/lib/codegenClient';
import { emitPlain, emitPom, pageGroups } from '@/lib/codegen/emit';
import {
  ArrowLeft,
  Download,
  Copy,
  Check,
  Loader2,
  Scissors,
  Merge,
  X,
  RotateCcw,
  KeyRound,
  AlertCircle,
  ShieldAlert,
  Layers,
  FileCode,
} from 'lucide-react';
import RunPanel from './RunPanel';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];
const SAVE_DELAY_MS = 500;

const STEP_TAG = {
  goto: { label: 'Open', className: 'badge-info' },
  action: { label: null, className: 'badge-neutral' },
  assert: { label: 'Check', className: 'badge-success' },
  raw: { label: 'Code', className: 'badge-warning' },
};

function describe(step) {
  if (step.kind === 'goto') return step.url;
  if (step.kind === 'action') return `${step.locator}${step.args.length && step.action !== 'click' ? `  ←  ${step.args[0]}` : ''}`;
  if (step.kind === 'assert') return `${step.locator ?? step.target}${step.matcher}`;
  return step.source.split('\n')[0];
}

// The spec first, then page objects.
const orderFiles = (files) => Object.keys(files).sort((a, b) => (a.startsWith('tests/') ? -1 : b.startsWith('tests/') ? 1 : a.localeCompare(b)));

// Edits a name locally and saves it on blur or Enter, so class names don't change on every key.
function NameInput({ value, onCommit, disabled, className, ariaLabel }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      className={className}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function ScriptEditor({ initial, canEdit }) {
  const [script, setScript] = useState(initial);
  const [edits, setEdits] = useState(initial.edits ?? {});
  const [style, setStyle] = useState('pom');
  const [selectedFile, setSelectedFile] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // saving | saved | error
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);
  const [source, setSource] = useState(initial.sourceCode);
  const [sourceError, setSourceError] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const current = useMemo(() => ({ title: script.title, recording: script.recording, edits }), [script, edits]);
  const groups = useMemo(() => pageGroups(current), [current]);
  const files = useMemo(() => (style === 'pom' ? emitPom(current) : emitPlain(current)), [current, style]);
  const paths = orderFiles(files);
  const file = files[selectedFile] ? selectedFile : paths[0];
  const removedCount = edits.removed?.length ?? 0;

  const save = async (changes) => {
    setSaveState('saving');
    const result = await updateCodegenScript(script.id, changes);
    if (result.ok) {
      setScript(result.data.script);
      setSaveState('saved');
      setSaveError('');
    } else {
      setSaveState('error');
      setSaveError(result.data.error ?? 'Could not save');
    }
    return result;
  };

  // Edits apply at once in the preview and are saved shortly after the last change.
  const changeEdits = (next) => {
    setEdits(next);
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save({ edits: next }), SAVE_DELAY_MS);
  };

  const removeStep = (step) => changeEdits({ ...edits, removed: [...(edits.removed ?? []), step.id] });
  const restoreSteps = () => changeEdits({ ...edits, removed: [] });
  const splitAt = (step) => changeEdits({ ...edits, pageNames: { ...edits.pageNames, [step.id]: `Section ${groups.length + 1}` } });
  const mergeAt = (step) => {
    const pageNames = { ...edits.pageNames };
    delete pageNames[step.id];
    changeEdits({ ...edits, pageNames });
  };
  // A page started with "New page here" is renamed where it starts; any other page is renamed
  // everywhere it appears.
  const renameGroup = (group, name) => {
    const first = group.steps[0].id;
    if (edits.pageNames?.[first]) changeEdits({ ...edits, pageNames: { ...edits.pageNames, [first]: name } });
    else changeEdits({ ...edits, renames: { ...edits.renames, [group.basePage]: name } });
  };

  const replaceSource = async () => {
    clearTimeout(timer.current);
    const result = await save({ sourceCode: source });
    if (result.ok) {
      setEdits(result.data.script.edits);
      setSource(result.data.script.sourceCode);
      setSourceError('');
    } else {
      setSourceError(result.data.fieldErrors?.sourceCode ?? result.data.error ?? 'Could not read the code');
      setSaveState('saved');
    }
  };

  // An applied heal replaces the recording, so the steps, edits and recorder code all reload.
  const replaceScript = (next) => {
    clearTimeout(timer.current);
    setScript(next);
    setEdits(next.edits);
    setSource(next.sourceCode);
    setSaveState('saved');
  };
  const openFile = (nextStyle, path) => {
    setStyle(nextStyle);
    setSelectedFile(path);
  };

  const copyFile = async () => {
    try {
      await navigator.clipboard.writeText(files[file]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  const secrets = script.recording.secrets ?? [];
  const { errors = [], warnings = [] } = script.checks ?? {};

  return (
    <div className={styles.content}>
      <div className={styles.topBar}>
        <Link href="/dashboard/codegen" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Scripts
        </Link>
        <NameInput
          key={script.title}
          className={styles.titleInput}
          value={script.title}
          disabled={!canEdit}
          ariaLabel="Script name"
          onCommit={(title) => save({ title })}
        />
        <span className={styles.saveState}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? <span className="text-danger">{saveError}</span> : 'Saved'}
        </span>
        {saveState === 'saving' ? (
          <button className="btn btn-primary" disabled>
            <Loader2 size={16} className="animate-spin" /> Download ZIP
          </button>
        ) : (
          <a className="btn btn-primary" href={downloadUrl(script.id, style)} id="codegen-download">
            <Download size={16} /> Download ZIP{style === 'pom' ? ' (POM)' : ''}
          </a>
        )}
      </div>

      {secrets.length > 0 && (
        <div className={`${styles.notice} ${styles.noticeInfo}`}>
          <KeyRound size={15} />
          <span>
            Typed credentials were removed from the code and read from {secrets.join(' and ')} instead. Set them in the
            project&apos;s <code>.env</code> file after downloading.
          </span>
        </div>
      )}
      {errors.length > 0 && (
        <div className={`${styles.notice} ${styles.noticeDanger}`}>
          <ShieldAlert size={15} />
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className={`${styles.notice} ${styles.noticeWarning}`}>
          <AlertCircle size={15} />
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3><Layers size={15} /> Steps by page</h3>
            {removedCount > 0 && canEdit && (
              <button className="btn btn-ghost btn-sm" onClick={restoreSteps}>
                <RotateCcw size={13} /> Restore {removedCount} removed
              </button>
            )}
          </div>
          <p className={styles.panelHint}>
            Each page becomes a class in the Page Object Model. Rename a page, or start a new one at any step.
          </p>
          {groups.map((group, gi) => (
            <div key={`${group.page}-${group.steps[0].id}`} className={styles.group}>
              <div className={styles.groupHeader}>
                <NameInput
                  key={group.page}
                  className={styles.pageInput}
                  value={group.page}
                  disabled={!canEdit || group.basePage === null}
                  ariaLabel="Page name"
                  onCommit={(name) => renameGroup(group, name)}
                />
                {canEdit && gi > 0 && edits.pageNames?.[group.steps[0].id] && (
                  <button className="btn btn-ghost btn-sm" title="Join with the page above" onClick={() => mergeAt(group.steps[0])}>
                    <Merge size={13} /> Join above
                  </button>
                )}
              </div>
              <ol className={styles.steps}>
                {group.steps.map((step, si) => {
                  const tag = STEP_TAG[step.kind];
                  return (
                    <li key={step.id} className={styles.stepRow}>
                      <span className={`badge ${tag.className} ${styles.stepTag}`}>{tag.label ?? step.action}</span>
                      <code className={styles.stepText} title={step.source}>{describe(step)}</code>
                      {canEdit && (
                        <span className={styles.stepActions}>
                          {step.kind !== 'raw' && si > 0 && (
                            <button className="btn btn-ghost btn-icon" title="New page from this step" onClick={() => splitAt(step)}>
                              <Scissors size={13} />
                            </button>
                          )}
                          <button className="btn btn-ghost btn-icon" title="Leave this step out" onClick={() => removeStep(step)}>
                            <X size={13} />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <div className="tabs">
            <button className={`tab ${style === 'plain' ? 'active' : ''}`} onClick={() => setStyle('plain')} id="codegen-tab-plain">
              Plain spec
            </button>
            <button className={`tab ${style === 'pom' ? 'active' : ''}`} onClick={() => setStyle('pom')} id="codegen-tab-pom">
              Page Object Model
            </button>
          </div>
          <div className={styles.fileBar}>
            <div className={styles.fileTabs}>
              {paths.map((path) => (
                <button
                  key={path}
                  className={`${styles.fileTab} ${path === file ? styles.fileTabActive : ''}`}
                  onClick={() => setSelectedFile(path)}
                >
                  <FileCode size={12} /> {path}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={copyFile} title="Copy this file">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className={styles.code}>{files[file]}</pre>
        </section>
      </div>

      <RunPanel
        script={script}
        style={style}
        canEdit={canEdit}
        onScriptChange={setScript}
        onReplaced={replaceScript}
        onOpenLine={openFile}
      />

      {canEdit && (
        <details className={styles.sourceBox}>
          <summary>Recorder code</summary>
          <p className={styles.panelHint}>
            Paste a new recording to replace the steps. Page names and removed steps are reset.
          </p>
          <textarea className={`input ${styles.sourceInput}`} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} />
          {sourceError && <p className="text-danger text-xs">{sourceError}</p>}
          <button className="btn btn-secondary btn-sm" onClick={replaceSource} disabled={source === script.sourceCode}>
            Replace recording
          </button>
        </details>
      )}
    </div>
  );
}

function ScriptDetail({ params }) {
  const { id } = use(params);
  const me = useCurrentUser();
  const { script, loaded, error } = useCodegenScript(id);

  return (
    <>
      <Header title="Codegen" subtitle={script ? script.startUrl : 'Recorded flow'} />
      {!loaded ? (
        <div className={styles.loading}>
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : !script ? (
        <div className={styles.loading}>
          <AlertCircle size={22} />
          <p>{error || 'Script not found'}</p>
          <Link href="/dashboard/codegen" className="btn btn-secondary btn-sm">Back to scripts</Link>
        </div>
      ) : (
        <ScriptEditor key={script.id} initial={script} canEdit={OPERATOR_ROLES.includes(me.role)} />
      )}
    </>
  );
}

export default function CodegenScriptPage({ params }) {
  return (
    <Suspense fallback={<div className={styles.loading}>Loading script…</div>}>
      <ScriptDetail params={params} />
    </Suspense>
  );
}
