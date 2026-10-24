'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import { getStatusLabel, getStatusColor, getRelativeTime, formatDuration } from '@/lib/format';
import { useProjects, useCiRuns, refreshCiRuns } from '@/lib/dataStores';
import {
  Activity,
  CheckCircle2,
  XCircle,
  GitBranch,
  GitCommit,
  Clock,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
  AlertTriangle,
  Play,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import styles from './page.module.css';

const STATUS_BADGE = { passed: 'success', failed: 'danger', cancelled: 'neutral', running: 'info' };

export default function CIResultsPage() {
  const { projects } = useProjects();
  const { runs: runsList, loaded } = useCiRuns();
  const [selectedId, setSelectedId] = useState(null);
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Reports arrive from GitHub while the page is open, so check for new ones now and then.
  useEffect(() => {
    refreshCiRuns();
    const timer = setInterval(refreshCiRuns, 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshCiRuns();
    setRefreshing(false);
  };

  const filteredRuns = runsList.filter((r) => {
    if (projectFilter !== 'all' && r.projectId !== projectFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.commitMessage.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        r.commit.toLowerCase().includes(q)
      );
    }
    return true;
  });
  const selectedRun = filteredRuns.find((r) => r.id === selectedId) ?? null;

  const totalRuns = runsList.length;
  const passedRuns = runsList.filter((r) => r.status === 'passed').length;
  const failedRuns = runsList.filter((r) => r.status === 'failed').length;
  const totalFailures = runsList.reduce((acc, r) => acc + (r.failures?.length || 0), 0);
  const reportingProjects = new Set(runsList.map((r) => r.projectId)).size;
  const timedRuns = runsList.filter((r) => r.duration != null);
  const pct = (n, total) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <>
      <Header
        title="CI Results"
        subtitle="Playwright test reports sent by your test repositories' GitHub Actions workflows"
      />

      <div className={styles.content}>
        {/* Top Summary Metrics */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statIconWrap}>
              <Activity size={20} className={styles.iconBlue} />
            </div>
            <div>
              <div className={styles.statLabel}>Total CI Runs</div>
              <div className={styles.statValue}>{totalRuns}</div>
              <div className={styles.statSub}>From {reportingProjects} {reportingProjects === 1 ? 'project' : 'projects'}</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIconWrap}>
              <CheckCircle2 size={20} className={styles.iconGreen} />
            </div>
            <div>
              <div className={styles.statLabel}>Pass Rate</div>
              <div className={styles.statValue}>{totalRuns === 0 ? '—' : `${Math.round((passedRuns / totalRuns) * 100)}%`}</div>
              <div className={styles.statSub}>{passedRuns} passed / {failedRuns} failed</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIconWrap}>
              <Sparkles size={20} className={styles.iconPurple} />
            </div>
            <div>
              <div className={styles.statLabel}>Failing Tests</div>
              <div className={styles.statValue}>{totalFailures}</div>
              <div className={styles.statSub}>Across all reported runs</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIconWrap}>
              <Clock size={20} className={styles.iconAmber} />
            </div>
            <div>
              <div className={styles.statLabel}>Avg Run Duration</div>
              <div className={styles.statValue}>
                {timedRuns.length === 0
                  ? '—'
                  : formatDuration(Math.round(timedRuns.reduce((sum, r) => sum + r.duration, 0) / timedRuns.length))}
              </div>
              <div className={styles.statSub}>Per workflow run</div>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className={styles.controlBar}>
          <div className={styles.searchBox}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              className="input"
              placeholder="Search commit, branch, or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              id="ci-search-input"
            />
          </div>

          <div className={styles.filtersGroup}>
            <select
              className="select"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              id="ci-project-filter"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <select
              className="select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              id="ci-status-filter"
            >
              <option value="all">All Statuses</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button className="btn btn-secondary" onClick={handleRefresh} disabled={refreshing} id="btn-refresh-ci">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {/* Two-Column Layout: Runs List on Left, Run Detail & AI Failure Analysis on Right */}
        <div className={styles.ciLayout}>
          {/* Runs Table / List */}
          <div className={styles.runsPane}>
            <div className={styles.runsHeader}>
              <h3 className={styles.runsTitle}>
                <Activity size={16} /> CI Execution History ({filteredRuns.length})
              </h3>
            </div>

            <div className={styles.runsList}>
              {!loaded ? (
                <p className={styles.emptyRuns}>Loading CI runs…</p>
              ) : runsList.length === 0 ? (
                <p className={styles.emptyRuns} id="ci-empty">
                  No CI runs yet. Add the AgentQA workflow (ci-templates/agentqa-playwright.yml) to your test repository;
                  each run reports here when it finishes.
                </p>
              ) : (
                filteredRuns.length === 0 && <p className={styles.emptyRuns}>No CI runs match the filters.</p>
              )}
              {filteredRuns.map((run) => {
                const project = projects.find((p) => p.id === run.projectId);
                const isSelected = selectedRun?.id === run.id;
                const isFailed = run.status === 'failed';

                return (
                  <div
                    key={run.id}
                    className={`${styles.runCard} ${isSelected ? styles.selectedRunCard : ''}`}
                    onClick={() => setSelectedId(run.id)}
                    id={`ci-run-${run.id}`}
                  >
                    <div className={styles.runCardTop}>
                      <span className={`badge badge-${STATUS_BADGE[run.status] ?? 'neutral'}`}>
                        {isFailed ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                        {run.status.toUpperCase()}
                      </span>
                      <span className={styles.runProjectBadge}>{project?.name}</span>
                      <span className={styles.runTime}>{getRelativeTime(run.startedAt)}</span>
                    </div>

                    <div className={styles.commitMsg}>{run.commitMessage}</div>

                    <div className={styles.runCardMeta}>
                      <span className={styles.metaBadge}>
                        <GitBranch size={12} /> {run.branch}
                      </span>
                      <span className={styles.metaBadge}>
                        <GitCommit size={12} /> {run.commit}
                      </span>
                      <span className={styles.metaBadge}>
                        <Clock size={12} /> {formatDuration(run.duration)}
                      </span>
                    </div>

                    <div className={styles.runCardProgress}>
                      <div className={styles.testCounters}>
                        <span className={styles.textGreen}>{run.passed} passed</span>
                        {run.failed > 0 && <span className={styles.textRed}>{run.failed} failed</span>}
                        {run.skipped > 0 && <span className={styles.textMuted}>{run.skipped} skipped</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Run Detail & AI Failure Analysis Pane */}
          <div className={styles.detailPane}>
            {selectedRun ? (
              <div className={styles.detailCard}>
                {/* Header */}
                <div className={styles.detailTop}>
                  <div>
                    <div className={styles.detailBadgeGroup}>
                      <span className={`badge badge-${STATUS_BADGE[selectedRun.status] ?? 'neutral'}`}>
                        {selectedRun.status === 'failed' ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                        {selectedRun.status.toUpperCase()}
                      </span>
                      <span className="badge badge-neutral">Trigger: {selectedRun.triggeredBy}</span>
                    </div>
                    <h2 className={styles.detailCommitTitle}>{selectedRun.commitMessage}</h2>
                    <div className={styles.detailSubInfo}>
                      <span>Branch: <strong>{selectedRun.branch}</strong></span>
                      <span>•</span>
                      <span>Commit: <code>{selectedRun.commit}</code></span>
                      <span>•</span>
                      <span>Duration: <strong>{formatDuration(selectedRun.duration)}</strong></span>
                    </div>
                  </div>

                  {selectedRun.runUrl && (
                    <a className="btn btn-secondary" href={selectedRun.runUrl} target="_blank" rel="noreferrer" id="btn-open-ci-run">
                      <ExternalLink size={15} /> Open in GitHub
                    </a>
                  )}
                </div>

                {/* Test Suite Breakdown Bar */}
                <div className={styles.breakdownBox}>
                  <div className={styles.breakdownBar}>
                    <div
                      className={styles.barPassed}
                      style={{ width: `${pct(selectedRun.passed, selectedRun.totalTests)}%` }}
                      title={`${selectedRun.passed} passed`}
                    />
                    <div
                      className={styles.barFailed}
                      style={{ width: `${pct(selectedRun.failed, selectedRun.totalTests)}%` }}
                      title={`${selectedRun.failed} failed`}
                    />
                    <div
                      className={styles.barSkipped}
                      style={{ width: `${pct(selectedRun.skipped, selectedRun.totalTests)}%` }}
                      title={`${selectedRun.skipped} skipped`}
                    />
                  </div>

                  <div className={styles.breakdownStats}>
                    <span className={styles.statPassed}>
                      <CheckCircle2 size={14} /> {selectedRun.passed} Passed ({Math.round(pct(selectedRun.passed, selectedRun.totalTests))}%)
                    </span>
                    <span className={styles.statFailed}>
                      <XCircle size={14} /> {selectedRun.failed} Failed
                    </span>
                    <span className={styles.statSkipped}>
                      {selectedRun.skipped} Skipped
                    </span>
                  </div>
                </div>

                {/* AI-Assisted Failure Analysis Section */}
                {selectedRun.failures && selectedRun.failures.length > 0 ? (
                  <div className={styles.failureSection}>
                    <div className={styles.failureSectionHeader}>
                      <div className={styles.failureHeaderTitle}>
                        <Sparkles size={18} className={styles.sparkleIcon} />
                        <h3>Failures</h3>
                      </div>
                      <span className={styles.aiTriageBadge}>
                        {selectedRun.failures.length} {selectedRun.failures.length === 1 ? 'failure' : 'failures'}
                      </span>
                    </div>

                    <div className={styles.failureList}>
                      {selectedRun.failures.map((f) => (
                        <div key={f.id} className={styles.failureItem}>
                          <div className={styles.failureItemHeader}>
                            <div className={styles.failureItemTitleGroup}>
                              <AlertTriangle size={16} className={styles.iconAlert} />
                              <span className={styles.failureTestName}>{f.testName}</span>
                            </div>
                            {f.className && <span className={styles.failureDuration}>{f.className}</span>}
                            <span className={styles.failureDuration}>{f.duration}s</span>
                          </div>

                          <div className={styles.errorStack}>
                            <code>{f.error}</code>
                          </div>

                          {f.likelyCause && (
                            <div className={styles.aiInsightCard}>
                              <div className={styles.aiInsightHeader}>
                                <Sparkles size={14} />
                                <span>Likely cause (from the error message):</span>
                              </div>
                              <p className={styles.aiInsightText}>{f.likelyCause}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={styles.allGreenCard}>
                    <CheckCircle2 size={40} className={styles.allGreenIcon} />
                    <h3 className={styles.allGreenTitle}>
                      {selectedRun.status === 'cancelled' ? 'Run cancelled' : 'All tests passed'}
                    </h3>
                    <p className={styles.allGreenDesc}>
                      {selectedRun.status === 'cancelled'
                        ? 'The workflow was cancelled before it finished.'
                        : `${selectedRun.passed} of ${selectedRun.totalTests} tests passed${selectedRun.skipped ? `, ${selectedRun.skipped} skipped` : ''}.`}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.noRunSelected}>
                <Activity size={32} />
                <p>Select a CI run from the list to see its test results and failures</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
