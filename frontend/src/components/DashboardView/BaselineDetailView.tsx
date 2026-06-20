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
  getBaselineIntegrity,
  getCaptureSession,
  listBaselineItems,
  parseBaselineProvenance,
  updateBaseline,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';
import { DriftReportTab } from './DriftReportTab';
import { formatScorePct } from './CoverageSummaryPanel';
import { BaselineSequenceView } from './BaselineSequenceView';
import { baselineToPostmanCollection } from '../../utils/postmanExport';
import { triggerDownload, sanitizeFilename } from '../../utils/fileOperations';

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

/**
 * Truncate a long lowercase-hex content hash for at-a-glance display while
 * keeping enough entropy to recognise it. The full hash is rendered in a
 * monospace block and surfaced verbatim via a `title` attribute / data attr
 * for copy. Spec 2026-06-17 Baseline Integrity & Provenance -- Task Group 3.
 */
function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

/**
 * Live integrity verdict resolution state. Spec 2026-06-17 (R4).
 *
 *   - 'loading'   : the AMS verify call is in flight; we keep showing the
 *                   at-rest "Hash recorded" badge until the verdict arrives
 *                   (no flash, no premature mismatch).
 *   - 'verified'  : `integrity_verified === true` -- recorded hash matches
 *                   the server-side recompute over the CURRENT stored items.
 *   - 'mismatch'  : `integrity_verified === false` with a non-null
 *                   `content_hash` -- tamper-evident warning.
 *   - 'unverified': the verify call FAILED (network/5xx). Fail-soft: we fall
 *                   back to the at-rest "Hash recorded" badge -- we never
 *                   render a false mismatch on a transient error.
 *
 * Only meaningful for current-state baselines that HAVE a content_hash; a
 * null-hash baseline never triggers the call and stays neutral.
 */
type IntegrityVerdict = 'loading' | 'verified' | 'mismatch' | 'unverified';

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

  // ---- Spec 2026-06-20 Baseline Save & Review (R5) ----------------------
  // Detail-view density toggle. Defaults to a compact TABLE (Method / Path /
  // Scenario / Status); 'full' reveals today's per-item request/response JSON
  // dump (including the BaselineSequenceView for sequence items). Reuses the
  // existing tabsNav toggle pattern.
  const [viewMode, setViewMode] = useState<'table' | 'full'>('table');

  // ---- Spec 2026-06-20 Baseline Save & Review (R3 + R6) -----------------
  // Toolbar action state for Make Active (draft -> active) + Export Postman
  // Collection. `actionError` / `actionNotice` surface inline feedback;
  // `activating` / `exporting` guard against double-submits.
  const [activating, setActivating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // ---- Spec 2026-06-17 Baseline Integrity & Provenance -- R4 (live badge) ---
  // Server-side verify verdict for current-state baselines that carry a
  // content_hash. Resolved via the AMS verify endpoint in the effect below.
  const [integrityVerdict, setIntegrityVerdict] =
    useState<IntegrityVerdict>('loading');

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

  // ---- Spec 2026-06-17 R4: live integrity verification -----------------
  // For a current-state baseline that HAS a content_hash, call the AMS
  // verify endpoint (recomputes the hash over the CURRENT stored items) and
  // map the verdict onto the live badge. Mirrors the view's existing
  // useEffect + cancelled-flag data-loading pattern.
  //
  // Fail-soft contract:
  //   - null/absent content_hash  -> never call; verdict stays irrelevant
  //     (the render falls through to the neutral at-rest "no hash" badge).
  //   - call errors               -> 'unverified' -> render falls back to the
  //     at-rest "Hash recorded" badge (NO false mismatch, NO crash).
  useEffect(() => {
    if (!baseline) return;
    const kindLocal = (baseline.kind ?? 'current') as 'current' | 'target';
    const hash = baseline.content_hash ?? null;
    // Target baselines are out of scope; null-hash baselines stay neutral and
    // must NOT hit the endpoint.
    if (kindLocal !== 'current' || !(typeof hash === 'string' && hash.length > 0)) {
      setIntegrityVerdict('loading');
      return;
    }
    let cancelled = false;
    setIntegrityVerdict('loading');
    void (async () => {
      try {
        const verdict = await getBaselineIntegrity(
          projectId,
          architectureId,
          baseline.id,
        );
        if (cancelled) return;
        if (verdict.integrity_verified === true) {
          setIntegrityVerdict('verified');
        } else if (verdict.content_hash !== null) {
          // integrity_verified === false with a recorded hash -> tamper-evident
          // mismatch. (A null content_hash from AMS would be the neutral case,
          // but we only reach here for a baseline whose hash is already set.)
          setIntegrityVerdict('mismatch');
        } else {
          setIntegrityVerdict('unverified');
        }
      } catch {
        // Fail-soft: keep the at-rest "Hash recorded" view; never a false
        // mismatch on a transient/verify failure.
        if (!cancelled) setIntegrityVerdict('unverified');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseline, projectId, architectureId]);

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

  // ---- Spec 2026-06-20 (R3): manual Make Active ------------------------
  // Deliberate draft -> active promotion via the EXISTING updateBaseline
  // status path (which stamps the integrity hash + provenance server-side
  // at the transition -- unchanged here). On success we replace the local
  // baseline with the returned DTO so the status badge flips to active.
  const handleMakeActive = async (): Promise<void> => {
    if (!baseline || baseline.status !== 'draft' || activating) return;
    setActivating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const updated = await updateBaseline(projectId, architectureId, baseline.id, {
        status: 'active',
      });
      setBaseline(updated);
      setActionNotice('Baseline activated.');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to activate baseline',
      );
    } finally {
      setActivating(false);
    }
  };

  // ---- Spec 2026-06-20 (R6): export Postman Collection -----------------
  // Pure-frontend export available on ANY saved baseline (draft or active).
  // The {{baseUrl}} variable is fail-soft prefilled from the capture
  // session's api_base_url when the baseline carries a session_id; any
  // fetch error (or absent session) leaves it blank. The collection is
  // built by the TG7 util and downloaded via the shared file helpers.
  const handleExportPostman = async (): Promise<void> => {
    if (!baseline || exporting) return;
    setExporting(true);
    setActionError(null);
    setActionNotice(null);
    try {
      let baseUrl = '';
      if (baseline.session_id) {
        try {
          const session = await getCaptureSession(
            projectId,
            architectureId,
            baseline.session_id,
          );
          baseUrl = session.api_base_url ?? '';
        } catch {
          // Fail-soft: a missing/forbidden session leaves baseUrl blank.
          baseUrl = '';
        }
      }
      const collection = baselineToPostmanCollection(
        baseline.name ?? '',
        items,
        baseUrl,
      );
      const filename = `${sanitizeFilename(
        baseline.name && baseline.name.trim() ? baseline.name : 'baseline',
      )}.postman_collection.json`;
      triggerDownload(JSON.stringify(collection, null, 2), filename);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to export Postman collection',
      );
    } finally {
      setExporting(false);
    }
  };

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

  // ---- Spec 2026-06-17 Baseline Integrity & Provenance -- Task Group 3 ----
  // Surface the recorded content hash + provenance + coverage score, plus an
  // integrity badge, on current-state (oracle) baselines only. `content_hash`
  // is stamped SERVER-SIDE at the draft -> active transition; `null` =
  // pre-existing / never-activated = "no integrity hash recorded" (NEUTRAL,
  // never an error). The at-rest view shows the recorded hash + provenance.
  //
  // R4 (live badge): for a hash-bearing current baseline we additionally
  // consume the AMS verify endpoint and render a LIVE verdict --
  // "Integrity verified" (green) on a match, "Integrity MISMATCH" (red,
  // tamper-evident) on a mismatch. While the verify call is in flight, or if
  // it fails, we fall back to the at-rest "Hash recorded" badge (fail-soft).
  // Target baselines are out of scope (no integrity/provenance).
  const contentHash = baseline.content_hash ?? null;
  const provenance = parseBaselineProvenance(baseline.provenance_json ?? null);
  const hasIntegrityHash = typeof contentHash === 'string' && contentHash.length > 0;

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

  // -- Live integrity badge for a hash-bearing current baseline (R4). -------
  // Verified -> green; Mismatch -> red (tamper-evident). 'loading' and
  // 'unverified' (verify call failed) BOTH fall back to the at-rest
  // "Hash recorded" badge so a transient failure never shows a false alarm
  // and the hash-recorded fact is always communicated.
  const renderIntegrityBadge = (): React.ReactNode => {
    if (integrityVerdict === 'verified') {
      return (
        <span
          className={`${styles.statusBadge} ${styles.integrityVerified}`}
          data-testid="baseline-detail-integrity-badge"
          data-integrity-state="verified"
        >
          Integrity verified
        </span>
      );
    }
    if (integrityVerdict === 'mismatch') {
      return (
        <span
          className={`${styles.statusBadge} ${styles.integrityMismatch}`}
          data-testid="baseline-detail-integrity-badge"
          data-integrity-state="mismatch"
        >
          Integrity MISMATCH
        </span>
      );
    }
    // 'loading' or 'unverified' -> at-rest hash-recorded fallback.
    return (
      <span
        className={`${styles.statusBadge} ${styles.integrityVerified}`}
        data-testid="baseline-detail-integrity-badge"
        data-integrity-state="hash-recorded"
      >
        Hash recorded
      </span>
    );
  };

  // -- Reusable "flat" detail content. Used directly when `kind='current'`
  // (no tab container) and wrapped under the "Baseline detail" tab when
  // `kind='target'` so the existing structure is preserved verbatim. -----
  const flatDetailContent = (
    <>
      {/*
        Spec 2026-06-20 Baseline Save & Review (R2 + R3 + R6) -- NET-NEW
        toolbar for a saved baseline. Make Active is gated to draft (it uses
        the existing updateBaseline status path which stamps the hash); Export
        Postman Collection is available on ANY saved baseline (draft OR
        active). Inline notice/error feedback sits beneath the buttons.
      */}
      <div className={styles.headerActions} data-testid="baseline-detail-toolbar">
        {baseline.status === 'draft' && (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleMakeActive()}
            disabled={activating}
            data-testid="baseline-detail-make-active"
          >
            {activating ? 'Activating…' : 'Make Active'}
          </button>
        )}
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void handleExportPostman()}
          disabled={exporting}
          data-testid="baseline-detail-export-postman"
        >
          {exporting ? 'Exporting…' : 'Export Postman Collection'}
        </button>
      </div>
      {actionNotice && (
        <div className={styles.testResultOk} data-testid="baseline-detail-action-notice">
          {actionNotice}
        </div>
      )}
      {actionError && (
        <div className={styles.errorBanner} data-testid="baseline-detail-action-error">
          {actionError}
        </div>
      )}
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

        {/*
          Spec 2026-06-17 Baseline Integrity & Provenance -- Task Group 3 + R4.
          Current-state oracle baselines only; target baselines are out of
          scope. Renders the integrity badge + recorded content hash (or the
          neutral "no integrity hash recorded" state), provenance rows, and
          the coverage score (from provenance_json.coverage_score = Spec A's
          overall_score, formatted as a percent).

          When a content_hash is present, the badge is the LIVE verify verdict
          (verified / mismatch), falling back to the at-rest "Hash recorded"
          badge while loading or on a verify failure (fail-soft).
        */}
        {kind === 'current' && (
          <div
            className={styles.detailRow}
            data-testid="baseline-detail-integrity"
          >
            <span className={styles.detailKey}>Integrity:</span>
            {hasIntegrityHash ? (
              <>
                {renderIntegrityBadge()}
                <pre
                  className={styles.contentHash}
                  style={{ margin: '4px 0 0 0', whiteSpace: 'pre-wrap' }}
                  title={contentHash ?? undefined}
                  data-testid="baseline-detail-content-hash"
                  data-content-hash={contentHash ?? undefined}
                >
                  {truncateHash(contentHash as string)}
                </pre>
              </>
            ) : (
              <span
                className={`${styles.statusBadge} ${styles.integrityNeutral}`}
                data-testid="baseline-detail-integrity-badge"
                data-integrity-state="no-hash"
              >
                No integrity hash recorded
              </span>
            )}
          </div>
        )}

        {kind === 'current' && provenance && (
          <div data-testid="baseline-detail-provenance">
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>Environment:</span>
              {provenance.environment_name ?? '—'}
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>Activated at:</span>
              {provenance.activated_at ?? '—'}
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailKey}>Coverage score:</span>
              <span data-testid="baseline-detail-coverage-score">
                {provenance.coverage_score === null
                  ? '—'
                  : formatScorePct(provenance.coverage_score)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailHeader}>
          <h3 style={{ margin: 0 }}>Baseline items ({sortedItems.length})</h3>
          {/*
            Spec 2026-06-20 (R5): density toggle. Defaults to the compact
            table; 'Full detail' reveals the per-item request/response JSON
            dump (incl. BaselineSequenceView). Reuses the tabsNav styling.
          */}
          <div
            className={styles.tabsNav}
            data-testid="baseline-detail-view-mode-toggle"
            role="tablist"
            style={{ borderBottom: 'none' }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'table'}
              className={
                viewMode === 'table'
                  ? `${styles.tabButton} ${styles.tabButtonActive}`
                  : styles.tabButton
              }
              onClick={() => setViewMode('table')}
              data-testid="baseline-detail-view-mode-table"
            >
              Table
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'full'}
              className={
                viewMode === 'full'
                  ? `${styles.tabButton} ${styles.tabButtonActive}`
                  : styles.tabButton
              }
              onClick={() => setViewMode('full')}
              data-testid="baseline-detail-view-mode-full"
            >
              Full detail
            </button>
          </div>
        </div>
        {sortedItems.length === 0 && (
          <div className={styles.emptyMessage} data-testid="baseline-detail-items-empty">
            This baseline has no accepted items yet.
          </div>
        )}
        {/*
          Spec 2026-06-20 (R5): compact default table -- Method / Path /
          Scenario / Status. Reuses the review-style `driftItemsTable` look.
        */}
        {sortedItems.length > 0 && viewMode === 'table' && (
          <table
            className={styles.driftItemsTable}
            data-testid="baseline-detail-items-table"
          >
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Scenario</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr
                  key={item.id}
                  data-testid="baseline-detail-item-row"
                  data-baseline-item-id={item.id}
                >
                  <td>
                    <strong>{item.method ?? '?'}</strong>
                  </td>
                  <td>{item.path ?? '(no path)'}</td>
                  <td>{item.scenario_name ?? '—'}</td>
                  <td>{item.response_status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sortedItems.length > 0 && viewMode === 'full' && (
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
                {/*
                  Spec 2026-06-18 Stateful Sequence Scenarios (Spec D) -- TG4.
                  When this baseline item carries a pinned sequence chain,
                  render its ordered steps + role badges + inter-step refs.
                  Null sequence_json => nothing renders (single-shot item,
                  unchanged).
                */}
                <BaselineSequenceView sequenceJson={item.sequence_json} />
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
