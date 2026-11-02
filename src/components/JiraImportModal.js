'use client';

import { useRef, useState } from 'react';
import { Loader2, X, Upload, FileSpreadsheet } from 'lucide-react';
import { importRequirements } from '@/lib/qaAgentClient';
import { importProblem, issuesFromJiraCsv } from '@/lib/jiraCsv';
import styles from './JiraImportModal.module.css';

const MAX_FILE_BYTES = 5_000_000;
const SITE_KEY = 'agentqa.jiraImportSite';
const readSavedSite = () => {
  try {
    return window.localStorage.getItem(SITE_KEY) ?? '';
  } catch {
    return '';
  }
};

// Imports tickets from a Jira CSV export as requirements. No Jira connection needed.
export default function JiraImportModal({ project, existingKeys, onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState('');
  const [site, setSite] = useState(() => project.jiraBaseUrl || readSavedSite());
  const [siteError, setSiteError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  // The server checks again, including Jira tickets this list doesn't show.
  const rows = issues.map((issue) => ({ ...issue, problem: importProblem(issue, existingKeys) }));
  const ready = rows.filter((r) => !r.problem);

  const close = () => {
    if (!submitting) onClose();
  };

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setIssues([]);
      setError('That file is larger than 5 MB. Narrow the Jira filter and export again.');
      return;
    }
    const parsed = issuesFromJiraCsv(await file.text());
    setIssues(parsed.issues);
    setError(parsed.error);
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    setSiteError('');
    const result = await importRequirements(project.id, { site, issues: ready });
    setSubmitting(false);
    if (!result.ok) {
      setSiteError(result.data.fieldErrors?.site ?? '');
      setError(result.data.fieldErrors?.site ? '' : result.data.error ?? 'Could not import the tickets');
      return;
    }
    try {
      if (site.trim() && site.trim() !== project.jiraBaseUrl) window.localStorage.setItem(SITE_KEY, site.trim());
    } catch {}
    // Rows the preview already ruled out are part of the report too.
    onImported({ created: result.data.created, skipped: [...rows.filter((r) => r.problem).map((r) => ({ key: r.key || '—', reason: r.problem })), ...result.data.skipped] });
  };

  return (
    <div className="modal-overlay" onClick={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className={`modal ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="jira-import-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 id="jira-import-title">Import Jira tickets</h3>
            <p className={styles.subtitle}>Add tickets from a Jira CSV export as requirements. Jira is not connected or changed.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className={styles.fields}>
            <ol className={styles.howTo}>
              <li>In Jira, open <strong>Filters → View all issues</strong> (or any filter) and narrow it to the tickets to automate.</li>
              <li>
                Choose <strong>Export → Export CSV (all fields)</strong>. All fields include acceptance criteria if your Jira has that field.
              </li>
              <li>Upload the file here. Each ticket keeps its key, so its test is named after it (SCRUM-12 → scrum_12.spec.ts).</li>
            </ol>

            <div className={styles.uploadRow}>
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} id="btn-choose-jira-csv">
                <Upload size={15} /> {fileName ? 'Choose another file' : 'Choose CSV file'}
              </button>
              {fileName && (
                <span className={styles.fileName}>
                  <FileSpreadsheet size={14} /> {fileName}
                </span>
              )}
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={loadFile} data-testid="jira-csv-input" />
            </div>

            <div className={styles.group}>
              <label className={styles.label} htmlFor="jira-import-site">Jira site (for ticket links)</label>
              <input
                id="jira-import-site"
                className="input"
                value={site}
                onChange={(e) => {
                  setSite(e.target.value);
                  setSiteError('');
                }}
                placeholder="https://your-team.atlassian.net"
                aria-invalid={Boolean(siteError)}
              />
              <span className={siteError ? styles.error : styles.hint}>
                {siteError || 'Optional. Each requirement links to its ticket at this address.'}
              </span>
            </div>

            {error && <div className={styles.alert} role="alert">{error}</div>}

            {rows.length > 0 && (
              <div className={styles.group}>
                <span className={styles.label}>
                  {ready.length} of {rows.length} ticket(s) will be imported
                </span>
                <div className={`table-container ${styles.preview}`}>
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Summary</th>
                        <th>Priority</th>
                        <th>Import</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${r.key}-${i}`}>
                          <td className={styles.key}>{r.key || '—'}</td>
                          <td className={styles.summary}>{r.title || '—'}</td>
                          <td>{r.priority}</td>
                          <td className={r.problem ? styles.skip : styles.ok}>{r.problem ? `Skip: ${r.problem}` : 'Yes'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || ready.length === 0} id="btn-import-jira-csv">
            {submitting && <Loader2 size={15} className="animate-spin" />}
            Import {ready.length > 0 ? `${ready.length} ticket(s)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
