/**
 * BaselineDetailView Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 * Task 8.5.
 *
 * + Spec 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 5:
 *   kind-conditional header banner. When `baseline.kind === 'target'` and
 *   `baseline.paired_with_baseline_id` is set, the view renders a header
 *   banner that reads "Target-side API capture (paired with: [source
 *   baseline name])" where the name is fetched via the existing
 *   `getBaseline` client on mount. The source name is rendered as a link
 *   to the source baseline's detail page. Current-state baselines render
 *   the existing header unchanged.
 *
 * + Spec 2026-05-25 API Test Harness -- Diff Engine -- Task Group 5:
 *   Small structural refactor introducing a tab container ONLY when
 *   `baseline.kind === 'target'`. Tab 1 ("Baseline detail") wraps the
 *   existing flat Summary + Baseline-items content. Tab 2 ("Drift report")
 *   hosts the new `DriftReportTab`. When `baseline.kind === 'current'`,
 *   no tabs are rendered -- the view stays exactly flat as before (the
 *   reverse-drift lookup is deferred to v2 per accepted Q9).
 *
 * Read-only detail view for a single saved baseline. Renders the baseline
 * header (name, status, accepted-capture / operation counts, notes) and a
 * list of `api_behaviour_baseline_items` rows -- one row per accepted
 * (operation x scenario) -- showing the captured request shape, the
 * response status code, the response body shape, and any business notes.
 *
 * Notes:
 *   - All numeric counts on the baseline DTO are boxed (`number | null`) per
 *     the AMS PATCH primitive-wipe pitfall; this view tolerates null by
 *     coercing to `0` or showing an em-dash.
 *   - Baseline items are listed in a stable order (method, path, scenario
 *     name) so the same baseline always renders deterministically.
 *   - Per spec there is no inline edit -- baselines are immutable once
 *     promoted to `active`. The view never mutates server-side state.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiBehaviourBaselineDto,
  ApiBehaviourBaselineItemDto,
  getBaseline,
  listBaselineItems,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';
import { DriftReportTab } from './DriftReportTab';

export interface BaselineDetailViewProps {
  projectId: string;
  architectureId: string;
  baselineId: string;
  onClose?: () => void;
}

function statusClass(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'draft':
      return styles.statusDraft;
    case 'active':
      return styles.statusActive;
    case 'archived':
      return styles.statusArchived;
    default:
      return styles.statusDraft;
  }
}

function compareItems(
  a: ApiBehaviourBaselineItemDto,
  b: ApiBehaviourBaselineItemDto,
): number {
  const am = (a.method ?? '').toUpperCase();
  const bm = (b.method ?? '').toUpperCase();
  if (am !== bm) return am < bm ? -1 : 1;
  const ap = a.path ?? '';
  const bp = b.path ?? '';
  if (ap !== bp) return ap < bp ? -1 : 1;
  const an = a.scenario_name ?? '';
  const bn = b.scenario_name ?? '';
  if (an !== bn) return an < bn ? -1 : 1;
  return 0;
}

function formatJson(value: Record<string, unknown> | null): string {
  if (value === null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Tab identifier for the target-side tabs nav. */
type TargetTabId = 'detail' | 'drift';

export const BaselineDetailView: React.FC<BaselineDetailViewProps> = ({
  projectId,
  architectureId,
  baselineId,
  onClose,
}) => {
  const [baseline, setBaseline] = useState<ApiBehaviourBaselineDto | null>(null);
  const [items, setItems] = useState<ApiBehaviourBaselineItemDto[]>([]);
  const [sourceBaselineItems, setSourceBaselineItems] = useState<
    ApiBehaviourBaselineItemDto[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TargetTabId>('detail');

  // ---- Spec 2026-05-25 Task Group 5: paired-source-name resolution ---
  // When the loaded baseline is `kind='target'` we fetch the source
  // baseline by id to render its name in the header banner. The banner is
  // shown as "loading…" until the fetch resolves; on failure we fall back
  // to the UUID so the link still works.
  const [sourceBaseline, setSourceBaseline] = useState<ApiBehaviourBaselineDto | null>(
    null,
  );
  const [sourceBaselineLoading, setSourceBaselineLoading] = useState<boolean>(false);
  /**
   * Tri-state: `undefined` while we haven't tried to resolve; `null` when
   * the source baseline is confirmed deleted (404); a DTO when present.
   * The DriftReportTab uses this distinction to render the "Source baseline
   * has been deleted" empty state correctly without flashing.
   */
  const [sourceBaselineStatus, setSourceBaselineStatus] = useState<
    'unresolved' | 'present' | 'deleted'
  >('unresolved');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [b, is] = await Promise.all([
          getBaseline(projectId, architectureId, baselineId),
          listBaselineItems(projectId, architectureId, baselineId),
        ]);
        if (!cancelled) {
          setBaseline(b);
          setItems(is);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load baseline');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, baselineId]);

  // Resolve the source baseline name when the loaded baseline is kind='target'.
  // Soft-fails: any error leaves the banner showing the UUID rather than
  // bubbling up an error state for the whole view. A 404 (source deleted)
  // is captured into `sourceBaselineStatus='deleted'` so the Drift report tab
  // can render its dedicated empty state.
  useEffect(() => {
    if (!baseline) return;
    if ((baseline.kind ?? 'current') !== 'target') {
      setSourceBaseline(null);
      setSourceBaselineStatus('unresolved');
      return;
    }
    const srcId = baseline.paired_with_baseline_id;
    if (!srcId) {
      setSourceBaseline(null);
      setSourceBaselineStatus('deleted');
      return;
    }
    let cancelled = false;
    setSourceBaselineLoading(true);
    setSourceBaselineStatus('unresolved');
    void (async () => {
      try {
        const src = await getBaseline(projectId, architectureId, srcId);
        if (!cancelled) {
          setSourceBaseline(src);
          setSourceBaselineStatus('present');
        }
      } catch (err) {
        if (!cancelled) {
          setSourceBaseline(null);
          // Treat any error (including 404) as deleted -- the diff is
          // CASCADE-removed when the source goes, so the tab's empty
          // state is the right rendering even on transient failures.
          setSourceBaselineStatus('deleted');
        }
      } finally {
        if (!cancelled) setSourceBaselineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseline, projectId, architectureId]);

  // Load source baseline items so the diff modal can render them. Only when
  // the source is resolved + the kind is target -- skips a wasted fetch on
  // current-state baselines (no diff tab).
  useEffect(() => {
    if (!baseline) return;
    if ((baseline.kind ?? 'current') !== 'target') {
      setSourceBaselineItems([]);
      return;
    }
    const srcId = baseline.paired_with_baseline_id;
    if (!srcId || sourceBaselineStatus !== 'present') {
      setSourceBaselineItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const itemsSrc = await listBaselineItems(projectId, architectureId, srcId);
        if (!cancelled) setSourceBaselineItems(itemsSrc);
      } catch {
        if (!cancelled) setSourceBaselineItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseline, projectId, architectureId, sourceBaselineStatus]);

  const sortedItems = useMemo(() => [...items].sort(compareItems), [items]);

  if (loading) {
    return (
      <div className={styles.detailContainer} data-testid="baseline-detail-view">
        <div className={styles.emptyMessage}>Loading…</div>
      </div>
    );
  }

  if (error && !baseline) {
    return (
      <div className={styles.detailContainer} data-testid="baseline-detail-view">
        <div className={styles.errorBanner}>{error}</div>
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className={styles.detailContainer} data-testid="baseline-detail-view">
        <div className={styles.emptyMessage}>Baseline not found.</div>
      </div>
    );
  }

  const kind = (baseline.kind ?? 'current') as 'current' | 'target';
  const pairedWithId = baseline.paired_with_baseline_id ?? null;

  // Build the paired-source display fragment. Three branches:
  //   - resolved baseline -> show the name (or "(unnamed)") as a link
  //   - loading           -> show "loading…"
  //   - resolution failed -> show the UUID as a link so the user can still navigate
  let pairedSourceFragment: React.ReactNode = null;
  if (kind === 'target' && pairedWithId) {
    const target = `/projects/${projectId}/architectures/${architectureId}/api-behaviour/baselines/${pairedWithId}`;
    if (sourceBaselineLoading) {
      pairedSourceFragment = (
        <span data-testid="baseline-detail-paired-loading">loading…</span>
      );
    } else if (sourceBaseline) {
      pairedSourceFragment = (
        <Link
          to={target}
          data-testid="baseline-detail-paired-link"
          data-paired-with-id={pairedWithId}
        >
          {sourceBaseline.name || '(unnamed)'}
        </Link>
      );
    } else {
      pairedSourceFragment = (
        <Link
          to={target}
          data-testid="baseline-detail-paired-link"
          data-paired-with-id={pairedWithId}
        >
          {pairedWithId}
        </Link>
      );
    }
  }

  // -- Reusable "flat" detail content. Used directly when `kind='current'`
  // (no tab container) and wrapped under the "Baseline detail" tab when
  // `kind='target'` so the existing structure is preserved verbatim. -----
  const flatDetailContent = (
    <>
      <div className={styles.detailSection}>
        <h3>Summary</h3>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Operations covered:</span>
          {baseline.operation_count ?? 0}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Accepted captures:</span>
          {baseline.accepted_capture_count ?? 0}
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Session id:</span>
          {baseline.session_id ?? '—'}
        </div>
        {baseline.notes && (
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Notes:</span>
            {baseline.notes}
          </div>
        )}
      </div>

      <div className={styles.detailSection}>
        <h3>Baseline items ({sortedItems.length})</h3>
        {sortedItems.length === 0 && (
          <div className={styles.emptyMessage} data-testid="baseline-detail-items-empty">
            This baseline has no accepted items yet.
          </div>
        )}
        {sortedItems.length > 0 && (
          <ul className={styles.list} data-testid="baseline-detail-items-list">
            {sortedItems.map((item) => (
              <li
                key={item.id}
                className={styles.row}
                style={{ display: 'block' }}
                data-testid="baseline-detail-item"
                data-baseline-item-id={item.id}
              >
                <div className={styles.detailRow}>
                  <strong>{item.method ?? '?'}</strong> {item.path ?? '(no path)'}
                  {item.scenario_name ? (
                    <>
                      {' '}
                      <span style={{ color: '#666' }}>— {item.scenario_name}</span>
                    </>
                  ) : null}
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailKey}>Response status:</span>
                  {item.response_status ?? '—'}
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailKey}>Request:</span>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {formatJson(item.request_json)}
                  </pre>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailKey}>Response:</span>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {formatJson(item.response_json)}
                  </pre>
                </div>
                {item.business_notes && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailKey}>Notes:</span>
                    {item.business_notes}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <div
      className={styles.detailContainer}
      data-testid="baseline-detail-view"
      data-baseline-id={baseline.id}
      data-status={baseline.status}
      data-kind={kind}
    >
      <div className={styles.detailHeader}>
        <h2>
          Baseline{baseline.name ? `: ${baseline.name}` : ''}{' '}
          <span className={`${styles.statusBadge} ${statusClass(baseline.status)}`}>
            {baseline.status}
          </span>
        </h2>
        {onClose && (
          <button
            type="button"
            className={styles.backButton}
            onClick={onClose}
            data-testid="baseline-detail-back"
          >
            Back
          </button>
        )}
      </div>

      {/* Spec 2026-05-25 Task Group 5: pairing header banner for target baselines */}
      {kind === 'target' && (
        <div
          className={styles.pairedBanner}
          data-testid="baseline-detail-paired-banner"
        >
          Target-side API capture
          {pairedWithId ? (
            <>
              {' '}(paired with: {pairedSourceFragment})
            </>
          ) : null}
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {/*
        Spec 2026-05-25 Diff Engine Task Group 5: tab container.
        - When kind='target': render the tabs nav strip + the active tab content.
        - When kind='current': render the existing flat content with NO tab strip
          (the reverse-drift list is deferred to v2 per accepted Q9).
      */}
      {kind === 'target' ? (
        <>
          <div
            className={styles.tabsNav}
            data-testid="baseline-detail-tabs-nav"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'detail'}
              className={
                activeTab === 'detail'
                  ? `${styles.tabButton} ${styles.tabButtonActive}`
                  : styles.tabButton
              }
              onClick={() => setActiveTab('detail')}
              data-testid="baseline-detail-tab-detail"
            >
              Baseline detail
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'drift'}
              className={
                activeTab === 'drift'
                  ? `${styles.tabButton} ${styles.tabButtonActive}`
                  : styles.tabButton
              }
              onClick={() => setActiveTab('drift')}
              data-testid="baseline-detail-tab-drift"
            >
              Drift report
            </button>
          </div>
          {activeTab === 'detail' && flatDetailContent}
          {activeTab === 'drift' && (
            <DriftReportTab
              projectId={projectId}
              architectureId={architectureId}
              targetBaseline={baseline}
              sourceBaseline={
                sourceBaselineStatus === 'present'
                  ? sourceBaseline
                  : sourceBaselineStatus === 'deleted'
                    ? null
                    : undefined
              }
              targetBaselineItems={items}
              sourceBaselineItems={sourceBaselineItems}
            />
          )}
        </>
      ) : (
        flatDetailContent
      )}
    </div>
  );
};

export default BaselineDetailView;
