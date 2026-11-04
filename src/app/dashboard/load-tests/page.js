'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useCurrentUser } from '@/lib/teamStore';
import { useProjects } from '@/lib/dataStores';
import { getRelativeTime } from '@/lib/format';
import { useLoadTests, deleteLoadTest, LOAD_RUN_STATUS, formatMs, formatSeconds } from '@/lib/loadTestClient';
import { Gauge, Plus, Loader2, AlertCircle, Trash2, ChevronRight, Users, Timer } from 'lucide-react';
import { matchTestType, testTypeLabel } from '@/lib/loadPresets';
import LoadTestForm from './LoadTestForm';
import styles from './page.module.css';

const OPERATOR_ROLES = ['Admin', 'QA Lead', 'QA Engineer'];

export default function LoadTestsPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const canEdit = OPERATOR_ROLES.includes(me.role);
  const { tests, limits, loaded, error, refresh } = useLoadTests();
  const { projects, loaded: projectsLoaded } = useProjects();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const remove = async (test) => {
    setConfirmDelete(null);
    await deleteLoadTest(test.id);
    refresh();
  };

  const noAppLinks = projectsLoaded && !projects.some((p) => p.appBaseUrl);

  return (
    <>
      <Header title="Load Tests" subtitle="Send many requests at once with k6 and see how your app holds up" />
      <div className={styles.content}>
        {canEdit && (
          <div className={`card ${styles.newCard}`}>
            {creating ? (
              projectsLoaded ? (
                <LoadTestForm projects={projects} limits={limits} onSaved={(test) => router.push(`/dashboard/load-tests/${test.id}`)} onCancel={() => setCreating(false)} />
              ) : (
                <Loader2 size={18} className="animate-spin" />
              )
            ) : (
              <div className={styles.newRow}>
                <div>
                  <strong>New load test</strong>
                  <p className={styles.hint}>
                    Pick a request or a flow of steps on a project’s app, then a kind of test, from a 30-second quick check to
                    finding the limit, and how fast it must stay. The worker runs it with k6.
                  </p>
                  {noAppLinks && (
                    <p className={`${styles.hint} ${styles.hintWarn}`}>
                      <AlertCircle size={12} /> No project has an app link yet. Set one in Projects → Edit project → Test environment.
                    </p>
                  )}
                </div>
                <button className="btn btn-primary" onClick={() => setCreating(true)} id="load-new">
                  <Plus size={15} /> New load test
                </button>
              </div>
            )}
          </div>
        )}

        <h3 className={styles.sectionTitle}>Load tests</h3>
        {!loaded ? (
          <div className={styles.empty}>
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : error ? (
          <div className={styles.empty}>
            <AlertCircle size={22} />
            <p>{error}</p>
          </div>
        ) : tests.length === 0 ? (
          <div className={styles.empty}>
            <Gauge size={30} />
            <p>{canEdit ? 'Create a load test above to get started.' : 'No load tests yet.'}</p>
          </div>
        ) : (
          <div className={styles.list}>
            {tests.map((test) => {
              const status = test.lastRun ? LOAD_RUN_STATUS[test.lastRun.status] : null;
              const summary = test.lastRun?.summary;
              return (
                <div key={test.id} className={styles.row}>
                  <Link href={`/dashboard/load-tests/${test.id}`} className={styles.rowMain}>
                    <Gauge size={18} className={styles.rowIcon} />
                    <div className={styles.rowText}>
                      <div className={styles.rowTitle}>{test.name}</div>
                      <div className={styles.rowMeta}>
                        {test.kind === 'scenario' ? (
                          <>
                            <span className={styles.method}>SCENARIO</span>
                            <span className={styles.url}>{test.steps.map((s) => s.name).join(' → ')}</span>
                          </>
                        ) : (
                          <>
                            <span className={styles.method}>{test.method}</span>
                            <span className={styles.url}>{test.url}</span>
                          </>
                        )}
                      </div>
                      <div className={styles.rowMeta}>
                        {test.project?.name} · {testTypeLabel(matchTestType(test, limits))} · <Users size={12} /> {test.vus} · <Timer size={12} /> {formatSeconds(test.rampUpSec + test.durationSec)}
                      </div>
                    </div>
                    <div className={styles.lastRun}>
                      {status ? (
                        <>
                          <span className={`badge badge-${status.color}`}>{status.label}</span>
                          <span className={styles.rowMeta}>
                            {summary ? `p95 ${formatMs(summary.p95Ms)} · ${summary.errorPct}% errors · ` : ''}
                            {getRelativeTime(test.lastRun.createdAt)}
                          </span>
                        </>
                      ) : (
                        <span className={styles.rowMeta}>Not run yet</span>
                      )}
                    </div>
                  </Link>
                  {canEdit &&
                    (confirmDelete === test.id ? (
                      <span className={styles.confirm}>
                        Delete?
                        <button className="btn btn-danger btn-sm" onClick={() => remove(test)}>Delete</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="btn btn-ghost btn-icon" title="Delete load test" onClick={() => setConfirmDelete(test.id)}>
                        <Trash2 size={15} />
                      </button>
                    ))}
                  <ChevronRight size={16} className={styles.rowChevron} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
