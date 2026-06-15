/**
 * CapabilitiesSection Component
 *
 * Spec: 2026-06-14 D2 -- Capability Synthesis + Batch Spines -- Task Group 5.
 * Spec: 2026-06-14 D4 -- Carry-over Completeness Gate -- Task Group 4 extends
 * this view in-place (NO new standalone panel) with the carry_over coverage
 * accounting pass.
 *
 * A "Capabilities" section that lives INSIDE the Findings review
 * (`FindingsTab.tsx`). NO standalone "Discovered Capabilities" tab (that is the
 * Option-B graduation, deferred).
 *
 * D2's synthesis turns scattered per-file operational findings into coherent,
 * durable, migrate-able CAPABILITIES (e.g. "Daily Risk Hierarchy Load Pipeline")
 * with their batch spine. This section:
 *   - lists each synthesised capability: name, kind, member count, confidence;
 *   - on expand, shows the capability's members + a batch-spine summary (the
 *     JIL-DAG topology / the typed `invocations[]` chain / schedule / external
 *     systems / folded operational artifacts from `detail_json`).
 *
 * D4 (Carry-over Completeness Gate) extends the same surface — ONLY when a
 * `bookId` is supplied (i.e. the Capabilities review opened in a
 * book-of-work-scoped completeness pass; the discovery-run review opens it
 * read-only with no book and the original D2 view is unchanged):
 *   - a per-capability COVERAGE-STATUS column (un-actioned / cited-by-story /
 *     dismissed), sourced from GET .../carry-over-coverage (server-computed —
 *     the UI never re-derives the gate);
 *   - a per-capability CITE ("Create story") action calling
 *     `append-capability-story` -> the capability flips to `cited-by-story`;
 *   - a per-capability DISMISS action capturing a MANDATORY non-empty reason
 *     -> `review_status = dismissed`;
 *   - a "Generate all capability stories" BATCH trigger.
 * Every action refetches the coverage so the column self-updates.
 *
 * Scope of the capability LIST (D4 wiring pass): the discovery-run review hosts
 * this with a single `runId` and lists that run's capabilities. The
 * book-of-work-scoped completeness review (opened from the Migrate panel's
 * carry_over deep-link) spans ALL the discovery runs the book's coverage covers,
 * so it is mounted WITHOUT a `runId` and lists the architecture-wide capability
 * set (matching the gateway coverage, which reads the project+architecture
 * capabilities). The carry-over coverage read + cite/dismiss/batch are
 * book-scoped (or capability-self-scoped) regardless, so they are unaffected.
 *
 * It reuses the FindingDetailDrawer's expand / member-detail visual patterns
 * (meta grid, section titles, badges, monospace JSON) and the findingTypeLabels
 * title-case fallback convention for humanising the polymorphic `member_type`
 * and the capability `kind`.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  listCapabilitiesByRun,
  listCapabilitiesByProjectAndArchitecture,
  readCapabilityDetail,
  CapabilitiesApiError,
} from '../../api/capabilitiesApi';
import type {
  DiscoveryCapabilityDto,
  DiscoveryCapabilityMemberDto,
  CapabilityInvocationEdge,
} from '../../api/capabilitiesApi';
import {
  getCarryOverCoverage,
  citeCapability,
  dismissCarryOverItem,
  generateAllCapabilityStories,
  CarryOverApiError,
} from '../../api/carryOverCoverageApi';
import type {
  CarryOverCoverageResult,
  CoverageStatus,
} from '../../api/carryOverCoverageApi';
import styles from './CapabilitiesSection.module.css';

// ============================================================================
// Display helpers
// ============================================================================

/** Title-case a snake_case / hyphen-case token for a legible label. */
function humanise(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  return trimmed
    .split(/[_\-]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function formatConfidence(confidence: number | null): string {
  if (confidence === null || confidence === undefined) return '-';
  return `${Math.round(confidence * 100)}%`;
}

function statusBadgeClass(status: string): string {
  switch ((status || '').toLowerCase()) {
    case 'approved':
      return styles.badgeStatusApproved;
    case 'rejected':
      return styles.badgeStatusRejected;
    case 'deferred':
      return styles.badgeStatusDeferred;
    case 'pending_review':
      return styles.badgeStatusPendingReview;
    default:
      return '';
  }
}

/**
 * Style class for a carry_over coverage status pill (D4). `cited-by-story` reads
 * as accounted-for (green), `dismissed` as consciously-excluded (yellow), and
 * `un-actioned` as gating (red).
 */
function coverageBadgeClass(status: CoverageStatus): string {
  switch (status) {
    case 'cited-by-story':
      return styles.badgeStatusApproved;
    case 'dismissed':
      return styles.badgeStatusDeferred;
    case 'un-actioned':
    default:
      return styles.badgeStatusRejected;
  }
}

/** Friendly label for a polymorphic `member_type`. */
const MEMBER_TYPE_LABELS: Record<string, string> = {
  discovery_finding: 'Finding',
  discovery_candidate: 'Candidate',
  architecture_element: 'Architecture element',
  discovery_relationship: 'Relationship',
};

function memberTypeLabel(memberType: string): string {
  return MEMBER_TYPE_LABELS[memberType] ?? humanise(memberType);
}

/** Render one invocation edge as a compact "from --[mechanism]--> to" line. */
function describeEdge(edge: CapabilityInvocationEdge): string {
  const from = edge.from ?? '?';
  const to = edge.to ?? '?';
  const mech = edge.mechanism ?? 'invokes';
  const conf =
    typeof edge.confidence === 'number'
      ? ` (${Math.round(edge.confidence * 100)}%)`
      : '';
  return `${from} --[${mech}]--> ${to}${conf}`;
}

// ============================================================================
// Props
// ============================================================================

export interface CapabilitiesSectionProps {
  projectId: string;
  architectureId: string;
  /**
   * The discovery run to list capabilities for. Required for the discovery-run
   * review (FindingsTab is run-scoped). OMITTED for the book-of-work-scoped
   * carry_over completeness review, which spans every run the book's coverage
   * covers and therefore lists the architecture-wide capability set instead.
   */
  runId?: string | null;
  /**
   * D4 (Carry-over Completeness Gate). When supplied, the section runs the
   * book-of-work-scoped completeness accounting pass: it fetches per-item
   * coverage from GET .../carry-over-coverage and renders the status column +
   * cite / dismiss / batch actions. When absent (the discovery-run review), the
   * section stays the pure read-only D2 view — no coverage fetch, no actions.
   */
  bookId?: string | null;
}

// ============================================================================
// Component
// ============================================================================

export const CapabilitiesSection: React.FC<CapabilitiesSectionProps> = ({
  projectId,
  architectureId,
  runId,
  bookId,
}) => {
  const [capabilities, setCapabilities] = useState<DiscoveryCapabilityDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // D4 coverage state (only populated when a bookId is supplied).
  const [coverage, setCoverage] = useState<CarryOverCoverageResult | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  // The id of the capability whose inline dismiss-reason prompt is open.
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  // A short-lived banner reporting the result of an action.
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<boolean>(false);

  const gateEnabled = typeof bookId === 'string' && bookId.length > 0;
  const hasRun = typeof runId === 'string' && runId.length > 0;

  // Fetch the capabilities on mount / scope change. The discovery-run review
  // lists the host run's capabilities (matching how FindingsTab fetches its
  // findings by run); the book-of-work completeness review (no runId) lists the
  // architecture-wide set, since the book's coverage spans every run. A failed
  // fetch surfaces a small inline message and an empty list (the section never
  // crashes the tab).
  useEffect(() => {
    let cancelled = false;
    async function doFetch() {
      setLoading(true);
      setError(null);
      try {
        const items = hasRun
          ? await listCapabilitiesByRun(projectId, architectureId, runId as string)
          : await listCapabilitiesByProjectAndArchitecture(
              projectId,
              architectureId,
            );
        if (!cancelled) setCapabilities(Array.isArray(items) ? items : []);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof CapabilitiesApiError
              ? err.body.message ?? err.message
              : err instanceof Error
                ? err.message
                : 'Failed to load capabilities';
          setError(message);
          setCapabilities([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void doFetch();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, runId, hasRun]);

  // D4: load the carry_over coverage (book-of-work-scoped). Re-callable so each
  // cite / dismiss / batch action refreshes the status column. A failed fetch
  // surfaces a small inline message but never crashes the section.
  const loadCoverage = useCallback(async () => {
    if (!gateEnabled || !bookId) return;
    setCoverageError(null);
    try {
      const result = await getCarryOverCoverage(projectId, bookId);
      setCoverage(result);
    } catch (err) {
      const message =
        err instanceof CarryOverApiError
          ? err.body.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load carry-over coverage';
      setCoverageError(message);
    }
  }, [gateEnabled, bookId, projectId]);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  // Auto-dismiss the action banner after ~5s.
  useEffect(() => {
    if (!actionBanner) return;
    const handle = window.setTimeout(() => setActionBanner(null), 5000);
    return () => window.clearTimeout(handle);
  }, [actionBanner]);

  // id -> coverage status, derived from the coverage items list.
  const coverageStatusById = useMemo(() => {
    const map = new Map<string, CoverageStatus>();
    for (const item of coverage?.items ?? []) {
      if (item.kind === 'capability') map.set(item.id, item.status);
    }
    return map;
  }, [coverage]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // ----- D4 actions -------------------------------------------------------

  const onCite = useCallback(
    async (cap: DiscoveryCapabilityDto) => {
      if (!gateEnabled || !bookId) return;
      setActionInFlight(true);
      setActionBanner(null);
      try {
        await citeCapability(projectId, bookId, {
          source_capability_id: cap.id,
          title: cap.name || cap.id,
        });
        setActionBanner(`Created a story for "${cap.name || cap.id}".`);
        await loadCoverage();
      } catch (err) {
        const message =
          err instanceof CarryOverApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to create the story';
        setActionBanner(`Cite failed: ${message}.`);
      } finally {
        setActionInFlight(false);
      }
    },
    [gateEnabled, bookId, projectId, loadCoverage],
  );

  const onDismiss = useCallback(
    async (cap: DiscoveryCapabilityDto, reason: string) => {
      if (!gateEnabled) return;
      const trimmed = reason.trim();
      if (trimmed.length === 0) return; // mandatory reason — guard
      setActionInFlight(true);
      setActionBanner(null);
      try {
        await dismissCarryOverItem(projectId, {
          kind: 'capability',
          id: cap.id,
          architecture_id: architectureId,
          // A capability carries its own run_id; fall back to the host run when
          // listed run-scoped, else leave null (the dismiss is capability-keyed).
          run_id: cap.run_id ?? (hasRun ? (runId as string) : null),
          reason: trimmed,
        });
        setDismissingId(null);
        setActionBanner(`Dismissed "${cap.name || cap.id}".`);
        await loadCoverage();
      } catch (err) {
        const message =
          err instanceof CarryOverApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to dismiss the capability';
        setActionBanner(`Dismiss failed: ${message}.`);
      } finally {
        setActionInFlight(false);
      }
    },
    [gateEnabled, projectId, architectureId, runId, hasRun, loadCoverage],
  );

  const onGenerateAll = useCallback(async () => {
    if (!gateEnabled || !bookId) return;
    setActionInFlight(true);
    setActionBanner(null);
    try {
      const result = await generateAllCapabilityStories(projectId, bookId);
      const failedSuffix =
        result.failures.length > 0
          ? `; ${result.failures.length} failed`
          : '';
      setActionBanner(
        `Generated ${result.citedCount} stor${result.citedCount === 1 ? 'y' : 'ies'}; ` +
          `${result.skippedCount} skipped${failedSuffix}.`,
      );
      await loadCoverage();
    } catch (err) {
      const message =
        err instanceof CarryOverApiError
          ? err.body.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to generate capability stories';
      setActionBanner(`Generate all failed: ${message}.`);
    } finally {
      setActionInFlight(false);
    }
  }, [gateEnabled, bookId, projectId, loadCoverage]);

  // The un-accounted behaviour-bearing count (for the gate summary line).
  const unaccountedCount = coverage?.unaccounted.length ?? 0;

  return (
    <section className={styles.capabilitiesSection} data-testid="capabilities-section">
      <div className={styles.header}>
        <h3 className={styles.heading}>Capabilities</h3>
        <span className={styles.subheading}>
          {gateEnabled
            ? 'Account for every behaviour-bearing capability before Migrate (cite or dismiss)'
            : 'Synthesised current-state groupings (read-only)'}
        </span>
        {gateEnabled && (
          <button
            type="button"
            className={styles.row}
            style={{ width: 'auto', fontWeight: 600 }}
            data-testid="capabilities-generate-all-stories"
            onClick={() => void onGenerateAll()}
            disabled={actionInFlight}
            title="Cite once per un-covered approved behaviour-bearing capability"
          >
            Generate all capability stories
          </button>
        )}
      </div>

      {gateEnabled && (
        <div
          className={styles.subheading}
          style={{ padding: '8px 16px 0' }}
          data-testid="capabilities-gate-summary"
        >
          {unaccountedCount > 0
            ? `${unaccountedCount} behaviour-bearing item${unaccountedCount === 1 ? '' : 's'} still un-accounted (blocks Migrate).`
            : 'All behaviour-bearing carry-over work is accounted for.'}
        </div>
      )}

      {gateEnabled && coverageError && (
        <div
          className={styles.errorMessage}
          data-testid="capabilities-coverage-error"
        >
          {coverageError}
        </div>
      )}

      {gateEnabled && actionBanner && (
        <div
          className={styles.subheading}
          style={{ padding: '8px 16px 0' }}
          data-testid="capabilities-action-banner"
        >
          {actionBanner}
        </div>
      )}

      {loading ? (
        <div className={styles.loadingState} data-testid="capabilities-loading">
          Loading capabilities...
        </div>
      ) : error ? (
        <div className={styles.errorMessage} data-testid="capabilities-error">
          {error}
        </div>
      ) : capabilities.length === 0 ? (
        <div className={styles.emptyState} data-testid="capabilities-empty">
          No synthesised capabilities for this run.
        </div>
      ) : (
        <ul className={styles.list} data-testid="capabilities-list">
          {capabilities.map((cap) => (
            <CapabilityRow
              key={cap.id}
              capability={cap}
              expanded={expandedId === cap.id}
              onToggle={() => toggleExpand(cap.id)}
              gateEnabled={gateEnabled}
              coverageStatus={coverageStatusById.get(cap.id) ?? null}
              dismissing={dismissingId === cap.id}
              actionInFlight={actionInFlight}
              onCite={() => void onCite(cap)}
              onOpenDismiss={() => setDismissingId(cap.id)}
              onCancelDismiss={() => setDismissingId(null)}
              onConfirmDismiss={(reason) => void onDismiss(cap, reason)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

// ============================================================================
// One capability row (+ inline expand)
// ============================================================================

interface CapabilityRowProps {
  capability: DiscoveryCapabilityDto;
  expanded: boolean;
  onToggle: () => void;
  /** D4: when true, render the coverage status column + cite/dismiss actions. */
  gateEnabled: boolean;
  coverageStatus: CoverageStatus | null;
  dismissing: boolean;
  actionInFlight: boolean;
  onCite: () => void;
  onOpenDismiss: () => void;
  onCancelDismiss: () => void;
  onConfirmDismiss: (reason: string) => void;
}

const CapabilityRow: React.FC<CapabilityRowProps> = ({
  capability,
  expanded,
  onToggle,
  gateEnabled,
  coverageStatus,
  dismissing,
  actionInFlight,
  onCite,
  onOpenDismiss,
  onCancelDismiss,
  onConfirmDismiss,
}) => {
  const memberCount = (capability.members ?? []).length;
  const kindLabel = capability.kind ? humanise(capability.kind) : 'Capability';
  const [dismissReason, setDismissReason] = useState<string>('');

  return (
    <li className={styles.rowWrapper}>
      <button
        type="button"
        className={styles.row}
        onClick={onToggle}
        data-testid="capability-row"
        data-capability-id={capability.id}
        aria-expanded={expanded}
      >
        <span className={styles.expandIcon} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className={styles.rowName}>{capability.name}</span>
        <span
          className={styles.kindBadge}
          data-testid="capability-kind"
          title={capability.kind ?? ''}
        >
          {kindLabel}
        </span>
        <span
          className={`${styles.statusBadge} ${statusBadgeClass(capability.review_status)}`}
          data-testid="capability-status"
        >
          {capability.review_status}
        </span>
        {gateEnabled && (
          <span
            className={`${styles.statusBadge} ${coverageStatus ? coverageBadgeClass(coverageStatus) : ''}`}
            data-testid={`capability-coverage-${capability.id}`}
            title="Carry-over coverage status"
          >
            {coverageStatus ?? '—'}
          </span>
        )}
        <span className={styles.metaPill}>
          <span className={styles.metaPillLabel}>Members</span>
          <span className={styles.metaPillValue} data-testid="capability-member-count">
            {memberCount}
          </span>
        </span>
        <span className={styles.metaPill}>
          <span className={styles.metaPillLabel}>Confidence</span>
          <span className={styles.metaPillValue} data-testid="capability-confidence">
            {formatConfidence(capability.confidence)}
          </span>
        </span>
      </button>

      {/* D4 actions row (cite / dismiss). Rendered next to the row when the gate
          is active; only un-accounted items realistically need them but they
          stay available so a reviewer can re-cite / re-dismiss. */}
      {gateEnabled && (
        <div
          className={styles.detail}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          data-testid={`capability-actions-${capability.id}`}
        >
          <button
            type="button"
            className={styles.kindBadge}
            style={{ cursor: 'pointer', border: 'none' }}
            data-testid={`capability-cite-${capability.id}`}
            onClick={onCite}
            disabled={actionInFlight}
            title="Create a migration story citing this capability"
          >
            Create story
          </button>
          {!dismissing ? (
            <button
              type="button"
              className={styles.statusBadge}
              style={{ cursor: 'pointer', border: 'none' }}
              data-testid={`capability-dismiss-${capability.id}`}
              onClick={onOpenDismiss}
              disabled={actionInFlight}
              title="Dismiss this capability with a reason"
            >
              Dismiss…
            </button>
          ) : (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className={styles.metaValue}
                style={{ minWidth: 220, padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4 }}
                placeholder="Reason (required)…"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                data-testid={`capability-dismiss-reason-${capability.id}`}
              />
              <button
                type="button"
                className={styles.kindBadge}
                style={{ cursor: 'pointer', border: 'none' }}
                data-testid={`capability-dismiss-confirm-${capability.id}`}
                onClick={() => onConfirmDismiss(dismissReason)}
                disabled={actionInFlight || dismissReason.trim().length === 0}
                title={
                  dismissReason.trim().length === 0
                    ? 'A non-empty reason is required'
                    : 'Confirm dismissal'
                }
              >
                Confirm
              </button>
              <button
                type="button"
                className={styles.statusBadge}
                style={{ cursor: 'pointer', border: 'none' }}
                data-testid={`capability-dismiss-cancel-${capability.id}`}
                onClick={() => {
                  setDismissReason('');
                  onCancelDismiss();
                }}
                disabled={actionInFlight}
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      )}

      {expanded && (
        <CapabilityDetail capability={capability} />
      )}
    </li>
  );
};

// ============================================================================
// Capability detail (members + batch-spine summary)
// ============================================================================

interface CapabilityDetailProps {
  capability: DiscoveryCapabilityDto;
}

const CapabilityDetail: React.FC<CapabilityDetailProps> = ({ capability }) => {
  const detail = useMemo(
    () => readCapabilityDetail(capability.detail_json),
    [capability.detail_json],
  );
  const members = capability.members ?? [];
  const topology = detail.jilTopology;
  const scheduleStr = detail.schedule ? JSON.stringify(detail.schedule, null, 2) : null;

  return (
    <div
      className={styles.detail}
      data-testid={`capability-detail-${capability.id}`}
    >
      {/* Summary */}
      {capability.summary && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Summary</h4>
          <p className={styles.summaryText} data-testid="capability-summary">
            {capability.summary}
          </p>
        </div>
      )}

      {/* Meta grid (mirrors the FindingDetailDrawer meta grid) */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Meta</h4>
        <div className={styles.metaGrid}>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>Kind</span>
            <span className={styles.metaValue}>{capability.kind ?? '-'}</span>
          </div>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>Source</span>
            <span className={styles.metaValue}>{capability.source ?? '-'}</span>
          </div>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>Stage</span>
            <span className={styles.metaValue}>
              {capability.created_by_stage ?? '-'}
            </span>
          </div>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>Behaviour-bearing</span>
            <span className={styles.metaValue}>
              {detail.behaviourBearing === null
                ? '-'
                : detail.behaviourBearing
                  ? 'yes'
                  : 'no'}
            </span>
          </div>
        </div>
      </div>

      {/* Members panel */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Members ({members.length})</h4>
        {members.length === 0 ? (
          <span className={styles.emptyInline}>No members.</span>
        ) : (
          <ul className={styles.membersList} data-testid="capability-members">
            {members.map((m: DiscoveryCapabilityMemberDto) => (
              <li key={m.id} className={styles.memberItem}>
                <span className={styles.memberTypeBadge}>
                  {memberTypeLabel(m.member_type)}
                </span>
                <span className={styles.memberId}>{m.member_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Batch-spine summary */}
      <div
        className={styles.section}
        data-testid="capability-batch-spine"
      >
        <h4 className={styles.sectionTitle}>Batch spine</h4>

        {/* Schedule / trigger */}
        {scheduleStr ? (
          <div className={styles.spineBlock}>
            <span className={styles.spineLabel}>Schedule / trigger</span>
            <pre className={styles.detailJson}>{scheduleStr}</pre>
          </div>
        ) : (
          <div className={styles.spineBlock}>
            <span className={styles.spineLabel}>Schedule / trigger</span>
            <span className={styles.emptyInline}>none</span>
          </div>
        )}

        {/* External systems */}
        <div className={styles.spineBlock}>
          <span className={styles.spineLabel}>External systems</span>
          {detail.externalSystems.length === 0 ? (
            <span className={styles.emptyInline}>none</span>
          ) : (
            <div className={styles.tagRow}>
              {detail.externalSystems.map((sys) => (
                <span key={sys} className={styles.tag}>
                  {sys}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* JIL-DAG topology snapshot */}
        <div className={styles.spineBlock}>
          <span className={styles.spineLabel}>Orchestration topology (JIL-DAG)</span>
          {topology ? (
            <div className={styles.topologySummary}>
              <span className={styles.topologyStat}>
                {(topology.boxes ?? []).length} box
                {(topology.boxes ?? []).length === 1 ? '' : 'es'}
              </span>
              <span className={styles.topologyStat}>
                {(topology.jobs ?? []).length} job
                {(topology.jobs ?? []).length === 1 ? '' : 's'}
              </span>
              <span className={styles.topologyStat}>
                {(topology.fileWatchers ?? []).length} file-watcher
                {(topology.fileWatchers ?? []).length === 1 ? '' : 's'}
              </span>
              <span className={styles.topologyStat}>
                {(topology.edges ?? []).length} edge
                {(topology.edges ?? []).length === 1 ? '' : 's'}
              </span>
            </div>
          ) : (
            <span className={styles.emptyInline}>
              not orchestrated (co-location seed)
            </span>
          )}
        </div>

        {/* Invocation chain (typed cross-language edges) */}
        <div className={styles.spineBlock}>
          <span className={styles.spineLabel}>
            Invocation chain ({detail.invocations.length})
          </span>
          {detail.invocations.length === 0 ? (
            <span className={styles.emptyInline}>none</span>
          ) : (
            <ul className={styles.edgeList} data-testid="capability-invocations">
              {detail.invocations.map((edge, idx) => (
                <li key={idx} className={styles.edgeItem}>
                  {describeEdge(edge)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Folded operational artifacts (their substance rides in detail_json) */}
        {detail.artifacts.length > 0 && (
          <div className={styles.spineBlock}>
            <span className={styles.spineLabel}>
              Operational artifacts ({detail.artifacts.length})
            </span>
            <ul className={styles.artifactList} data-testid="capability-artifacts">
              {detail.artifacts.map((a, idx) => (
                <li key={a.filePath ?? idx} className={styles.artifactItem}>
                  <span className={styles.memberTypeBadge}>
                    {a.artifactKind ? humanise(a.artifactKind) : 'Artifact'}
                  </span>
                  <span className={styles.memberId}>{a.filePath ?? '(unknown path)'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
