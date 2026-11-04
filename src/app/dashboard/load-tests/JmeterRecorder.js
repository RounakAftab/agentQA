'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Download, FileUp, ListChecks, Loader2, Radio, X } from 'lucide-react';
import { importJmeterRecording } from '@/lib/loadTestClient';
import { MAX_JMX_BYTES, RECORDER_PORT, defaultSelection, recordingPlanFileName, recordingPlanJmx, stepsFromRecording } from '@/lib/jmeterRecording';
import styles from './JmeterRecorder.module.css';

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

// Record a scenario with JMeter's HTTP(S) Test Script Recorder (a Non-Test Element): download a plan
// with the recorder set up for the project's app, record in JMeter, then import the saved .jmx and pick
// the requests to keep. onUse(steps, { fileName, notes }) puts them in the scenario editor.
export default function JmeterRecorder({ project, maxSteps, onUse }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(null); // { fileName, requests, notes }
  const [selected, setSelected] = useState([]);
  const [used, setUsed] = useState(null); // { count, notes } after "Use as steps"
  const fileRef = useRef(null);
  const base = origin(project?.appBaseUrl ?? '');

  const downloadPlan = () => {
    const xml = recordingPlanJmx({ projectName: project.name, appBaseUrl: project.appBaseUrl });
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = recordingPlanFileName(project.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setUsed(null);
    if (file.size > MAX_JMX_BYTES) return setError(`${file.name} is over ${MAX_JMX_BYTES / 1024 / 1024} MB.`);
    setLoading(true);
    const result = await importJmeterRecording(project.id, await file.text(), file.name);
    setLoading(false);
    if (!result.ok) {
      setRecording(null);
      return setError(result.data.error ?? 'Could not read the recording');
    }
    setRecording({ fileName: file.name, requests: result.data.requests, notes: result.data.notes ?? [] });
    setSelected(defaultSelection(result.data.requests, maxSteps));
  };

  const toggle = (key) => setSelected((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  const full = selected.length >= maxSteps;

  const use = () => {
    onUse(stepsFromRecording(recording.requests, selected), { fileName: recording.fileName });
    setUsed({ count: selected.length, notes: recording.notes });
    setRecording(null);
  };

  return (
    <details className={styles.panel} id="load-jmeter-panel">
      <summary>
        <Radio size={14} /> Record a scenario with JMeter
      </summary>

      {!project ? (
        <p className={styles.hint}>Choose a project below first.</p>
      ) : !base ? (
        <p className={styles.hint}>Set the project’s app link (Projects → Edit project → Test environment) first.</p>
      ) : (
        <>
          <ol className={styles.howTo}>
            <li>
              <div>
                <strong>Download the recording plan.</strong> It has JMeter’s HTTP(S) Test Script Recorder (under Non-Test Elements)
                set up on port {RECORDER_PORT}: it only records {base}, skips scripts, styles, images and fonts, keeps headers, doesn’t
                follow redirects, and saves the pause before each request as think time.
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={downloadPlan} id="load-jmeter-plan">
                <Download size={14} /> Download .jmx
              </button>
            </li>
            <li>
              <div>
                <strong>Record in JMeter.</strong> Open the plan, select <em>HTTP(S) Test Script Recorder</em> and click Start. Point your
                browser’s proxy at localhost:{RECORDER_PORT} (for an https app, trust <code>ApacheJMeterTemporaryRootCA.crt</code> from
                JMeter’s bin folder), use the app the way a user would, then Stop and save the plan.
              </div>
            </li>
            <li>
              <div>
                <strong>Import the saved plan.</strong> Pick up to {maxSteps} of the recorded requests as scenario steps.
              </div>
              <input ref={fileRef} type="file" accept=".jmx,.xml" hidden onChange={importFile} id="load-jmeter-file" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={loading} id="load-jmeter-import">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} Import .jmx
              </button>
            </li>
          </ol>

          {error && <p className={styles.error}>{error}</p>}

          {recording && (
            <div className={styles.picker}>
              <div className={styles.pickerHead}>
                <strong>
                  {recording.fileName}: {recording.requests.length} {recording.requests.length === 1 ? 'request' : 'requests'}
                </strong>
                <span className={full ? styles.countFull : styles.count}>
                  {selected.length} of {maxSteps} steps
                </span>
              </div>
              <ul className={styles.requests}>
                {recording.requests.map((r) => {
                  const on = selected.includes(r.key);
                  return (
                    <li key={r.key} className={r.problem ? styles.unusable : undefined}>
                      <label>
                        <input type="checkbox" checked={on} disabled={Boolean(r.problem) || (!on && full)} onChange={() => toggle(r.key)} />
                        <span className={styles.method}>{r.method}</span>
                        <span className={styles.path} title={r.path}>
                          {r.path}
                        </span>
                      </label>
                      {(r.problem || r.warnings.length > 0) && (
                        <span className={styles.warning}>
                          <AlertTriangle size={12} /> {r.problem ?? r.warnings.join(' · ')}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {recording.notes.length > 0 && (
                <ul className={styles.notes}>
                  {recording.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <button type="button" className="btn btn-primary btn-sm" onClick={use} disabled={selected.length === 0} id="load-jmeter-use">
                  <ListChecks size={14} /> Use {selected.length} as scenario steps
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecording(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {used && (
            <div className={styles.done} role="status">
              <div className={styles.pickerHead}>
                <strong>
                  Added {used.count} {used.count === 1 ? 'step' : 'steps'} to the scenario below. Review them, then save.
                </strong>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setUsed(null)} aria-label="Dismiss">
                  <X size={14} />
                </button>
              </div>
              {used.notes.length > 0 && (
                <ul className={styles.notes}>
                  {used.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </details>
  );
}
