/**
 * FindingsTab Component
 *
 * Spec 2026-05-16 Discovery Findings -- Task Group 7.
 * Spec 2026-05-28 Bulk Findings Actions -- Task Group 3 adds the bulk
 * toolbar (segmented scope toggle + action buttons), confirmation
 * modal, optimistic delta apply, and inline status banner.
 * Spec F 2026-06-02 Normalize Findings Review Actions -- the review surface
 * becomes exactly Approve / Reject / Defer (candidate-parity verbs); the
 * disposition field is `review_status` carrying
 * pending_review / approved / rejected / deferred; the legacy
 * "Mark Resolved" + "Needs Review" actions and the Resolved pill are removed.
 *
 * Hosts the new "Findings" tab content on the canonical
 * `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx`:
 *   - summary counts strip (total / critical+high / pending_review /
 *     approved / rejected / deferred)
 *   - filter strip (review_status / severity / category / finding_type /
 *     source / text-search)
 *   - bulk-actions toolbar (segmented "All | Filtered" toggle + three
 *     disposition buttons with live counts; opens a confirmation modal that
 *     fires `bulkReviewFindings` against AMS)
 *   - flat table with severity-then-category group headers
 *   - row click opens a right-side detail drawer
 *   - reviewer actions inside the drawer call `findingsApi` and re-render
 *     the local list optimistically
 *
 * AppShell model cache (`project_appshell_model_cache.md`) is deliberately
 * NOT invalidated on review actions (single-row OR bulk) -- findings live
 * outside the architecture model. Equally, the unfiltered `runSummary` is
 * NOT refetched after a bulk action because the AMS
 * `delta_by_from_status` map is exact (it's the server's pre-mutation
 * accumulator) so we apply it directly to the pills.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  listFindings,
  getFinding,
  bulkReviewFindings,
  FindingsApiError,
} from '../../api/findingsApi';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingStatus,
  ListFindingsFilters,
  BulkReviewFindingsRequest,
  BulkReviewFindingsResponse,
} from '../../api/findingsApi';
import { FindingDetailDrawer } from './FindingDetailDrawer';
import { BulkFindingActionConfirmModal } from './BulkFindingActionConfirmModal';
import { labelForFindingType } from './findingTypeLabels';
import { CapabilitiesSection } from './CapabilitiesSection';
import styles from './FindingsTab.module.css';

// ============================================================================
// Severity / status ordering helpers
// ============================================================================

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity?.toLowerCase()] ?? 99;
}

function severityBadgeClass(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return styles.badgeSeverityCritical;
    case 'high':
      return styles.badgeSeverityHigh;
    case 'medium':
      return styles.badgeSeverityMedium;
    case 'low':
      return styles.badgeSeverityLow;
    case 'info':
      return styles.badgeSeverityInfo;
    default:
      return '';
  }
}

function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
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

function formatConfidence(confidence: number | null): string {
  if (confidence === null || confidence === undefined) return '-';
  return `${Math.round(confidence * 100)}%`;
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

// ============================================================================
// Computed summary counts
// ============================================================================

interface FindingsSummary {
  total: number;
  criticalHigh: number;
  // Spec F (2026-06-02) -- candidate-parity disposition pills. The legacy
  // needsReview / accepted / ignored / resolved set is retired.
  pendingReview: number;
  approved: number;
  rejected: number;
  deferred: number;
}

function computeSummary(findings: DiscoveryFindingDto[]): FindingsSummary {
  const summary: FindingsSummary = {
    total: findings.length,
    criticalHigh: 0,
    pendingReview: 0,
    approved: 0,
    rejected: 0,
    deferred: 0,
  };
  for (const f of findings) {
    const s = (f.severity || '').toLowerCase();
    if (s === 'critical' || s === 'high') summary.criticalHigh += 1;
    const st = (f.review_status || '').toLowerCase();
    if (st === 'pending_review') summary.pendingReview += 1;
    else if (st === 'approved') summary.approved += 1;
    else if (st === 'rejected') summary.rejected += 1;
    else if (st === 'deferred') summary.deferred += 1;
  }
  return summary;
}

// ============================================================================
// Filter state
// ============================================================================

interface UiFilters {
  review_status: string;
  severity: string;
  category: string;
  finding_type: string;
  source: string;
  q: string;
}

const EMPTY_FILTERS: UiFilters = {
  review_status: '',
  severity: '',
  category: '',
  finding_type: '',
  source: '',
  q: '',
};

/**
 * AMS caps `size` at 500 (per `DiscoveryFindingService`'s
 * `safeSize = Math.min(size, 500)` guard). We request the cap on every call
 * so a single response covers the typical run; multi-page handling for runs
 * with >500 findings lives in the fetch loop in the component.
 */
const PAGE_SIZE = 500;

function uiFiltersToApi(ui: UiFilters): ListFindingsFilters {
  return {
    review_status: ui.review_status || null,
    severity: ui.severity || null,
    category: ui.category || null,
    finding_type: ui.finding_type || null,
    source: ui.source || null,
    q: ui.q || null,
    size: PAGE_SIZE,
  };
}

/**
 * Strip out paging + empty values so we can hand the result to the AMS
 * bulk-review endpoint as the `filter` field. The bulk endpoint mirrors
 * the GET list endpoint's filter surface, but it doesn't take page/size
 * (it always targets the entire filtered population).
 */
function uiFiltersToBulkFilter(ui: UiFilters): ListFindingsFilters | null {
  const filter: ListFindingsFilters = {};
  let hasAny = false;
  if (ui.review_status) {
    filter.review_status = ui.review_status;
    hasAny = true;
  }
  if (ui.severity) {
    filter.severity = ui.severity;
    hasAny = true;
  }
  if (ui.category) {
    filter.category = ui.category;
    hasAny = true;
  }
  if (ui.finding_type) {
    filter.finding_type = ui.finding_type;
    hasAny = true;
  }
  if (ui.source) {
    filter.source = ui.source;
    hasAny = true;
  }
  if (ui.q) {
    filter.q = ui.q;
    hasAny = true;
  }
  return hasAny ? filter : null;
}

/**
 * Build the comma-separated active filter text rendered inside the
 * confirmation modal body (Q8). Only non-empty filter fields contribute
 * a `Key=value` pair; the result is intentionally human-readable rather
 * than a faithful URL-encoded query echo.
 */
function buildActiveFilterText(ui: UiFilters): string {
  const parts: string[] = [];
  if (ui.review_status) parts.push(`Status=${ui.review_status}`);
  if (ui.severity) parts.push(`Severity=${ui.severity}`);
  if (ui.category) parts.push(`Category=${ui.category}`);
  if (ui.finding_type) parts.push(`Type=${ui.finding_type}`);
  if (ui.source) parts.push(`Source=${ui.source}`);
  if (ui.q) parts.push(`Search="${ui.q}"`);
  return parts.join(', ');
}

const ZERO_SUMMARY: FindingsSummary = {
  total: 0,
  criticalHigh: 0,
  pendingReview: 0,
  approved: 0,
  rejected: 0,
  deferred: 0,
};

/**
 * Walk every page of a `listFindings` query for the given filter set.
 * Used by BOTH the filtered fetch (drives the table) AND the unfiltered
 * summary fetch (drives the pills). Pages 1..N are issued in parallel after
 * page 0 returns its `total`.
 */
async function fetchAllPages(
  projectId: string,
  architectureId: string,
  runId: string,
  baseFilters: ListFindingsFilters,
): Promise<{ items: DiscoveryFindingDto[]; total: number }> {
  const firstPage = await listFindings(projectId, architectureId, runId, {
    ...baseFilters,
    page: 0,
  });
  const firstItems = firstPage.items ?? [];
  const total = firstPage.total ?? firstItems.length;
  if (total <= firstItems.length) {
    return { items: firstItems, total };
  }
  const remainingPageCount = Math.ceil(total / PAGE_SIZE) - 1;
  const extraResponses = await Promise.all(
    Array.from({ length: remainingPageCount }, (_unused, idx) =>
      listFindings(projectId, architectureId, runId, {
        ...baseFilters,
        page: idx + 1,
      }),
    ),
  );
  return {
    items: firstItems.concat(...extraResponses.map((r) => r.items ?? [])),
    total,
  };
}

// ============================================================================
// Grouping for table render
// ============================================================================

interface GroupedRow {
  kind: 'severityHeader' | 'categoryHeader' | 'finding';
  key: string;
  label?: string;
  finding?: DiscoveryFindingDto;
}

/**
 * Sort findings by severity (descending: critical -> info) then category
 * (alphabetical), then created_at (descending) to break ties. Insert
 * severity + category group headers as we walk the sorted list so the
 * render is a flat list of rows -- this avoids pulling in a tree
 * component and matches the spec's "implement via sort, not a tree".
 */
function buildGroupedRows(findings: DiscoveryFindingDto[]): GroupedRow[] {
  const sorted = [...findings].sort((a, b) => {
    const sa = severityRank(a.severity);
    const sb = severityRank(b.severity);
    if (sa !== sb) return sa - sb;
    const ca = (a.category || '').toLowerCase();
    const cb = (b.category || '').toLowerCase();
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    // Descending created_at within tied severity+category groups
    return b.created_at.localeCompare(a.created_at);
  });

  const rows: GroupedRow[] = [];
  let lastSeverity: string | null = null;
  let lastCategory: string | null = null;
  for (const f of sorted) {
    const sev = (f.severity || '').toLowerCase();
    if (sev !== lastSeverity) {
      rows.push({
        kind: 'severityHeader',
        key: `sev-${sev}`,
        label: sev,
      });
      lastSeverity = sev;
      lastCategory = null;
    }
    const cat = (f.category || '').toLowerCase();
    if (cat !== lastCategory) {
      rows.push({
        kind: 'categoryHeader',
        key: `sev-${sev}-cat-${cat}`,
        label: cat,
      });
      lastCategory = cat;
    }
    rows.push({ kind: 'finding', key: f.id, finding: f });
  }
  return rows;
}

// ============================================================================
// Bulk-action helpers
// ============================================================================

/**
 * Reviewer-valid target dispositions (Spec F). `pending_review` is
 * intentionally NOT in this list -- it's the pre-review state and the AMS
 * bulk endpoint rejects it. The single-row drawer follows the same
 * convention (Approve / Reject / Defer).
 */
const BULK_TARGET_STATUSES: DiscoveryFindingStatus[] = [
  'approved',
  'rejected',
  'deferred',
];

const STATUS_BUTTON_LABEL: Record<DiscoveryFindingStatus, string> = {
  pending_review: 'Pending Review',
  approved: 'Approve',
  rejected: 'Reject',
  deferred: 'Defer',
};

const STATUS_DISPLAY_LABEL: Record<DiscoveryFindingStatus, string> = {
  pending_review: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
};

/**
 * Count findings inside `scope` whose current disposition differs from the
 * action's target. Drives the live `[Approve (X)]` counts on the toolbar.
 * AMS will silently skip rows already in the target disposition, so this is
 * the "would actually mutate" upper bound. Transitions are unrestricted
 * (Spec F) so there is no forbidden-transition gap to also exclude.
 */
function countActionableFindings(
  scope: DiscoveryFindingDto[],
  target: DiscoveryFindingStatus,
): number {
  let n = 0;
  for (const f of scope) {
    if ((f.review_status || '').toLowerCase() !== target) n += 1;
  }
  return n;
}

// ============================================================================
// Props
// ============================================================================

export interface FindingsTabProps {
  projectId: string;
  architectureId: string;
  runId: string;
  /**
   * Optional callback for "open" affordance on linked items in the
   * detail drawer. Threaded through; the drawer disables the "Open" button
   * when this is absent.
   */
  onOpenLinkedTarget?: (targetType: string, targetId: string) => void;
  /**
   * Spec 2026-06-11 Findings Coverage + Gap Wayfinding -- Task Group 3.
   * When set (from the `?findingId=` route param), the tab fetches THAT
   * single finding via `GET .../findings/{findingId}` (so paging / filters
   * cannot hide it) and opens the existing `FindingDetailDrawer` once, on
   * mount. An unknown/404 id silently no-ops -- no drawer, no crash, no
   * error banner.
   */
  initialFindingId?: string | null;
  /**
   * Spec 2026-06-14 D4 -- Carry-over Completeness Gate. When supplied (the
   * book-of-work-scoped completeness review), the hosted CapabilitiesSection
   * runs the carry_over accounting pass (coverage status column + cite /
   * dismiss / batch). Absent on the plain discovery-run review (read-only D2).
   */
  bookId?: string | null;
}

// ============================================================================
// Component
// ============================================================================

type BulkScope = 'all' | 'filtered';

interface BulkBanner {
  kind: 'success' | 'error';
  message: string;
}

export const FindingsTab: React.FC<FindingsTabProps> = ({
  projectId,
  architectureId,
  runId,
  onOpenLinkedTarget,
  initialFindingId,
  bookId,
}) => {
  const [findings, setFindings] = useState<DiscoveryFindingDto[]>([]);
  const [runSummary, setRunSummary] = useState<FindingsSummary>(ZERO_SUMMARY);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UiFilters>(EMPTY_FILTERS);
  const [selectedFinding, setSelectedFinding] = useState<DiscoveryFindingDto | null>(null);

  // Bulk-toolbar state. Sticky in-component only (Q6 -- no localStorage).
  // Reset to 'all' on Clear filters.
  const [bulkScope, setBulkScope] = useState<BulkScope>('all');
  // The pending modal action (which target-disposition button was clicked).
  // `null` means the modal is closed.
  const [pendingBulkStatus, setPendingBulkStatus] =
    useState<DiscoveryFindingStatus | null>(null);
  const [bulkInFlight, setBulkInFlight] = useState<boolean>(false);
  const [bulkBanner, setBulkBanner] = useState<BulkBanner | null>(null);

  // Deep-link single-finding fetch (Spec 2026-06-11, Task Group 3): when the
  // route carried `?findingId=`, fetch THAT finding directly (paging /
  // filters cannot hide it) and open the existing drawer ONCE, on mount.
  // The consumed REF guards the once-only semantics (a ref, not state, so
  // flipping it cannot re-run this effect and cancel its own in-flight
  // fetch via the cleanup); a failed fetch (unknown/404 id, network error)
  // is swallowed -- the error message is extracted for the console only
  // (the FindingsApiError.body.message idiom), and NO drawer / NO error
  // banner is shown.
  const initialFindingConsumedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!initialFindingId || initialFindingConsumedRef.current) return;
    initialFindingConsumedRef.current = true;
    let cancelled = false;
    async function doFetch() {
      try {
        const finding = await getFinding(
          projectId,
          architectureId,
          runId,
          initialFindingId as string,
        );
        if (!cancelled) setSelectedFinding(finding);
      } catch (err) {
        // Unknown/404 finding id -> silently no drawer, no error banner.
        const message =
          err instanceof FindingsApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        // eslint-disable-next-line no-console
        console.warn('[FindingsTab] deep-linked finding fetch failed', {
          findingId: initialFindingId,
          message,
        });
      }
    }
    void doFetch();
    return () => {
      cancelled = true;
    };
  }, [initialFindingId, projectId, architectureId, runId]);

  // Unfiltered summary fetch — drives the summary pills.
  // Runs once per (project, architecture, run) tuple and intentionally does
  // NOT depend on `filters` so applying a filter (e.g. severity=high) doesn't
  // change the pill numbers. Counts always reflect the FULL run.
  useEffect(() => {
    let cancelled = false;
    async function doFetch() {
      try {
        const { items: allItems, total } = await fetchAllPages(
          projectId,
          architectureId,
          runId,
          uiFiltersToApi(EMPTY_FILTERS),
        );
        if (!cancelled) {
          const computed = computeSummary(allItems);
          // Prefer the server-supplied total over the local items length;
          // they should match (we paged through everything) but the server
          // value is authoritative against a concurrent insert.
          computed.total = total;
          setRunSummary(computed);
        }
      } catch {
        if (!cancelled) setRunSummary(ZERO_SUMMARY);
      }
    }
    void doFetch();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, runId]);

  // Filtered fetch — drives the table + filter dropdowns + grouped rows.
  // Re-fetches whenever the filter set OR scoping ids change. Multi-page
  // loop ensures runs with >500 findings render completely.
  useEffect(() => {
    let cancelled = false;
    async function doFetch() {
      setLoading(true);
      setError(null);
      try {
        const { items: allItems } = await fetchAllPages(
          projectId,
          architectureId,
          runId,
          uiFiltersToApi(filters),
        );
        if (!cancelled) {
          setFindings(allItems);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof FindingsApiError
              ? err.body.message ?? err.message
              : err instanceof Error
                ? err.message
                : 'Failed to load findings';
          setError(message);
          setFindings([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void doFetch();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, runId, filters]);

  const groupedRows = useMemo(() => buildGroupedRows(findings), [findings]);

  // Distinct values for the category / type / source filter selects --
  // derived from the loaded findings so the UI stays consistent with what
  // the user can actually see, rather than enumerating a global vocab.
  const distinctCategories = useMemo(
    () => Array.from(new Set(findings.map((f) => f.category))).sort(),
    [findings],
  );
  const distinctFindingTypes = useMemo(
    () => Array.from(new Set(findings.map((f) => f.finding_type))).sort(),
    [findings],
  );
  const distinctSources = useMemo(
    () =>
      Array.from(
        new Set(findings.map((f) => f.source).filter((s): s is string => !!s)),
      ).sort(),
    [findings],
  );

  // Derived bulk-toolbar inputs ------------------------------------------------

  const isFilterActive = useMemo(() => {
    return Object.values(filters).some((v) => v !== '');
  }, [filters]);

  // The actual list the bulk action targets (drives the live action counts
  // AND the approximate-skipped preview in the modal).
  const scopedFindings = useMemo(() => {
    if (bulkScope === 'filtered') return findings;
    // 'all' scope -- but we don't keep a full unfiltered list in component
    // state (only the unfiltered SUMMARY is cached in `runSummary`). The
    // best client-side proxy we have for "all in the run" is the filtered
    // list when no filter is active. The action counts at scope=All fall
    // back to deriving from `runSummary` directly to stay accurate even
    // when a filter is also active.
    return findings;
  }, [bulkScope, findings]);

  /**
   * Live action count for a single target disposition under the current
   * scope. Scope=Filtered uses the loaded filtered list directly. Scope=All
   * derives from `runSummary` (the unfiltered server-side counts) so it
   * stays accurate even when the filtered list doesn't reflect the full
   * population.
   */
  const computeActionCount = useCallback(
    (target: DiscoveryFindingStatus): number => {
      if (bulkScope === 'filtered') {
        return countActionableFindings(scopedFindings, target);
      }
      // scope=All -- derive from runSummary pills.
      const totalAll = runSummary.total;
      if (target === 'approved') return totalAll - runSummary.approved;
      if (target === 'rejected') return totalAll - runSummary.rejected;
      if (target === 'deferred') return totalAll - runSummary.deferred;
      return 0;
    },
    [bulkScope, scopedFindings, runSummary],
  );

  const onFilterChange = useCallback(
    (key: keyof UiFilters, value: string) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
      // Filter change clears any post-action banner so the user isn't
      // looking at stale "Marked N findings..." text after retargeting.
      setBulkBanner(null);
    },
    [],
  );

  const onClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    // Per Q6: scope toggle is sticky in-component, but resets to 'all'
    // on Clear filters because Filtered loses its meaning.
    setBulkScope('all');
    setBulkBanner(null);
  }, []);

  // Auto-dismiss the inline banner after ~5s.
  useEffect(() => {
    if (!bulkBanner) return;
    const handle = window.setTimeout(() => setBulkBanner(null), 5000);
    return () => window.clearTimeout(handle);
  }, [bulkBanner]);

  // When the drawer reports a successful update, splice the fresh row into
  // the local filtered list (preserves filter state without a full re-fetch)
  // AND optimistically delta the unfiltered `runSummary` status counts so the
  // summary pills reflect the reviewer action immediately. The setFindings
  // updater runs synchronously over the previous filtered list, giving us
  // the pre-update disposition to compute the delta against. Note: AppShell
  // model cache is intentionally NOT invalidated -- findings live outside the
  // architecture model.
  const onFindingUpdated = useCallback(
    (updated: DiscoveryFindingDto) => {
      setFindings((prev) => {
        const old = prev.find((f) => f.id === updated.id);
        if (old && old.review_status !== updated.review_status) {
          setRunSummary((prevSummary) => {
            const oldSt = (old.review_status || '').toLowerCase();
            const newSt = (updated.review_status || '').toLowerCase();
            const next: FindingsSummary = { ...prevSummary };
            if (oldSt === 'pending_review') next.pendingReview -= 1;
            else if (oldSt === 'approved') next.approved -= 1;
            else if (oldSt === 'rejected') next.rejected -= 1;
            else if (oldSt === 'deferred') next.deferred -= 1;
            if (newSt === 'pending_review') next.pendingReview += 1;
            else if (newSt === 'approved') next.approved += 1;
            else if (newSt === 'rejected') next.rejected += 1;
            else if (newSt === 'deferred') next.deferred += 1;
            return next;
          });
        }
        return prev.map((f) => (f.id === updated.id ? updated : f));
      });
      setSelectedFinding(updated);
    },
    [],
  );

  const onCloseDrawer = useCallback(() => {
    setSelectedFinding(null);
  }, []);

  // Bulk-action handlers -------------------------------------------------------

  const openBulkConfirm = useCallback(
    (target: DiscoveryFindingStatus) => {
      // Modal opens for every action (Q3 -- no count threshold). The
      // disabled-state on the button itself is what guards against
      // opening with a zero-count action.
      setPendingBulkStatus(target);
    },
    [],
  );

  const closeBulkConfirm = useCallback(() => {
    if (bulkInFlight) return;
    setPendingBulkStatus(null);
  }, [bulkInFlight]);

  const applyBulkDelta = useCallback(
    (
      response: BulkReviewFindingsResponse,
      target: DiscoveryFindingStatus,
    ) => {
      setRunSummary((prev) => {
        const next: FindingsSummary = { ...prev };
        // Decrement each from-status pill by its server-supplied count.
        // A `pending_review` from-status decrements the Pending Review pill.
        const delta = response.delta_by_from_status || {};
        for (const fromStatus of Object.keys(delta)) {
          const count = delta[fromStatus] || 0;
          switch (fromStatus.toLowerCase()) {
            case 'pending_review':
              next.pendingReview -= count;
              break;
            case 'approved':
              next.approved -= count;
              break;
            case 'rejected':
              next.rejected -= count;
              break;
            case 'deferred':
              next.deferred -= count;
              break;
            default:
              break;
          }
        }
        // Increment the to-status pill by `updated_count`.
        switch (target) {
          case 'pending_review':
            next.pendingReview += response.updated_count;
            break;
          case 'approved':
            next.approved += response.updated_count;
            break;
          case 'rejected':
            next.rejected += response.updated_count;
            break;
          case 'deferred':
            next.deferred += response.updated_count;
            break;
          default:
            break;
        }
        return next;
      });
    },
    [],
  );

  const confirmBulkAction = useCallback(
    async (payload: { reviewerNotes?: string }) => {
      if (!pendingBulkStatus) return;
      const target = pendingBulkStatus;
      const scope: BulkScope = bulkScope;
      const scopedTotal =
        scope === 'filtered' ? findings.length : runSummary.total;

      setBulkInFlight(true);
      setBulkBanner(null);
      try {
        // Build the request body. We use the `filter` field rather than
        // a pre-collected `ids` list because the filtered list could be
        // arbitrarily large; sending the AMS query filter lets the server
        // resolve the candidate set transactionally in a single trip.
        const body: BulkReviewFindingsRequest = { review_status: target };
        if (scope === 'filtered') {
          const bulkFilter = uiFiltersToBulkFilter(filters);
          if (bulkFilter) {
            body.filter = bulkFilter;
          }
        }
        // `reviewer_notes` is only sent when non-empty after trim (Q5);
        // the modal already trimmed before invoking us.
        if (payload.reviewerNotes) {
          body.reviewer_notes = payload.reviewerNotes;
        }

        const response = await bulkReviewFindings(
          projectId,
          architectureId,
          runId,
          body,
        );

        // 1) Optimistic pill delta in one pass.
        applyBulkDelta(response, target);

        // 2) Re-fetch the filtered table so the rows reflect their new
        //    disposition. The unfiltered summary is NOT refetched -- the
        //    delta we just applied is exact.
        try {
          const { items: refreshedItems } = await fetchAllPages(
            projectId,
            architectureId,
            runId,
            uiFiltersToApi(filters),
          );
          setFindings(refreshedItems);
        } catch {
          // Swallow the refresh error -- the action itself succeeded.
          // The summary banner still reports the success counts.
        }

        // 3) Inline status banner with the precise counts.
        const targetLabel = STATUS_DISPLAY_LABEL[target];
        setBulkBanner({
          kind: 'success',
          message:
            `Marked ${response.updated_count} of ${scopedTotal} findings ` +
            `as ${targetLabel}; ${response.skipped_count} skipped ` +
            `(already in target disposition).`,
        });

        // 4) Close the modal.
        setPendingBulkStatus(null);
      } catch (err) {
        const message =
          err instanceof FindingsApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        setBulkBanner({
          kind: 'error',
          message: `Bulk review failed: ${message}.`,
        });
      } finally {
        setBulkInFlight(false);
      }
    },
    [
      pendingBulkStatus,
      bulkScope,
      filters,
      findings.length,
      runSummary.total,
      projectId,
      architectureId,
      runId,
      applyBulkDelta,
    ],
  );

  // Modal-input derivations.
  const modalActionCount = pendingBulkStatus
    ? computeActionCount(pendingBulkStatus)
    : 0;
  const modalScopeLabel: 'All' | 'Filtered' =
    bulkScope === 'all' ? 'All' : 'Filtered';
  const modalActiveFilterText = useMemo(
    () => buildActiveFilterText(filters),
    [filters],
  );
  // Approximate skipped (Q13). Only computable from the loaded filtered
  // list -- count rows in scope that are already in the target. We tilde-
  // prefix it in the modal so the user knows it's a client-side estimate
  // rather than the precise post-action skip count.
  const modalApproximateSkipped = useMemo(() => {
    if (!pendingBulkStatus) return 0;
    const target = pendingBulkStatus;
    let n = 0;
    for (const f of scopedFindings) {
      if ((f.review_status || '').toLowerCase() === target) n += 1;
    }
    return n;
  }, [pendingBulkStatus, scopedFindings]);

  return (
    <div className={styles.findingsTab} data-testid="findings-tab">
      {/* Summary counts strip */}
      <div className={styles.summaryStrip} data-testid="findings-summary-strip">
        <div className={styles.summaryPill} data-testid="findings-summary-total">
          <span className={styles.summaryPillLabel}>Total</span>
          <span className={styles.summaryPillValue}>{runSummary.total}</span>
        </div>
        <div
          className={`${styles.summaryPill} ${runSummary.criticalHigh > 0 ? styles.summaryPillAlert : ''}`}
          data-testid="findings-summary-critical-high"
        >
          <span className={styles.summaryPillLabel}>Critical + High</span>
          <span className={styles.summaryPillValue}>{runSummary.criticalHigh}</span>
        </div>
        <div className={styles.summaryPill} data-testid="findings-summary-pending-review">
          <span className={styles.summaryPillLabel}>Pending Review</span>
          <span className={styles.summaryPillValue}>{runSummary.pendingReview}</span>
        </div>
        <div className={styles.summaryPill} data-testid="findings-summary-approved">
          <span className={styles.summaryPillLabel}>Approved</span>
          <span className={styles.summaryPillValue}>{runSummary.approved}</span>
        </div>
        <div className={styles.summaryPill} data-testid="findings-summary-rejected">
          <span className={styles.summaryPillLabel}>Rejected</span>
          <span className={styles.summaryPillValue}>{runSummary.rejected}</span>
        </div>
        <div className={styles.summaryPill} data-testid="findings-summary-deferred">
          <span className={styles.summaryPillLabel}>Deferred</span>
          <span className={styles.summaryPillValue}>{runSummary.deferred}</span>
        </div>
      </div>

      {/* Filter strip */}
      <div className={styles.filterStrip} data-testid="findings-filter-strip">
        <div className={styles.filterControl}>
          <label className={styles.filterLabel} htmlFor="findings-filter-status">
            Status
          </label>
          <select
            id="findings-filter-status"
            className={styles.filterSelect}
            value={filters.review_status}
            onChange={(e) => onFilterChange('review_status', e.target.value)}
            data-testid="findings-filter-status"
          >
            <option value="">All</option>
            <option value="pending_review">pending_review</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="deferred">deferred</option>
          </select>
        </div>
        <div className={styles.filterControl}>
          <label className={styles.filterLabel} htmlFor="findings-filter-severity">
            Severity
          </label>
          <select
            id="findings-filter-severity"
            className={styles.filterSelect}
            value={filters.severity}
            onChange={(e) => onFilterChange('severity', e.target.value)}
            data-testid="findings-filter-severity"
          >
            <option value="">All</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
            <option value="info">info</option>
          </select>
        </div>
        <div className={styles.filterControl}>
          <label className={styles.filterLabel} htmlFor="findings-filter-category">
            Category
          </label>
          <select
            id="findings-filter-category"
            className={styles.filterSelect}
            value={filters.category}
            onChange={(e) => onFilterChange('category', e.target.value)}
            data-testid="findings-filter-category"
          >
            <option value="">All</option>
            {distinctCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterControl}>
          <label className={styles.filterLabel} htmlFor="findings-filter-type">
            Type
          </label>
          <select
            id="findings-filter-type"
            className={styles.filterSelect}
            value={filters.finding_type}
            onChange={(e) => onFilterChange('finding_type', e.target.value)}
            data-testid="findings-filter-type"
          >
            <option value="">All</option>
            {distinctFindingTypes.map((t) => (
              <option key={t} value={t}>
                {labelForFindingType(t)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterControl}>
          <label className={styles.filterLabel} htmlFor="findings-filter-source">
            Source
          </label>
          <select
            id="findings-filter-source"
            className={styles.filterSelect}
            value={filters.source}
            onChange={(e) => onFilterChange('source', e.target.value)}
            data-testid="findings-filter-source"
          >
            <option value="">All</option>
            {distinctSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterControl}>
          <label className={styles.filterLabel} htmlFor="findings-filter-search">
            Search
          </label>
          <input
            id="findings-filter-search"
            type="text"
            className={styles.filterInput}
            value={filters.q}
            onChange={(e) => onFilterChange('q', e.target.value)}
            placeholder="title / summary..."
            data-testid="findings-filter-search"
          />
        </div>
        <button
          type="button"
          className={styles.filterClearButton}
          onClick={onClearFilters}
          data-testid="findings-filter-clear"
        >
          Clear
        </button>
      </div>

      {/* Bulk-actions toolbar */}
      <div className={styles.bulkToolbar} data-testid="findings-bulk-toolbar">
        <div className={styles.bulkToolbarRow}>
          <span className={styles.bulkScopeLabel}>Bulk apply to:</span>
          <div
            className={styles.bulkScopeToggle}
            role="group"
            aria-label="Bulk scope"
          >
            <button
              type="button"
              className={`${styles.bulkScopeToggleButton} ${bulkScope === 'all' ? styles.bulkScopeToggleButtonActive : ''}`}
              onClick={() => setBulkScope('all')}
              disabled={bulkInFlight}
              data-testid="findings-bulk-scope-all"
            >
              All ({runSummary.total})
            </button>
            <button
              type="button"
              className={`${styles.bulkScopeToggleButton} ${bulkScope === 'filtered' ? styles.bulkScopeToggleButtonActive : ''}`}
              onClick={() => setBulkScope('filtered')}
              disabled={!isFilterActive || bulkInFlight}
              title={
                !isFilterActive ? 'Apply a filter to enable' : undefined
              }
              data-testid="findings-bulk-scope-filtered"
            >
              Filtered ({findings.length})
            </button>
          </div>
        </div>
        <div className={styles.bulkToolbarRow}>
          {BULK_TARGET_STATUSES.map((target) => {
            const count = computeActionCount(target);
            const disabled = count === 0 || bulkInFlight;
            const targetDisplay = STATUS_DISPLAY_LABEL[target];
            return (
              <button
                key={target}
                type="button"
                className={styles.bulkActionButton}
                onClick={() => openBulkConfirm(target)}
                disabled={disabled}
                title={
                  count === 0
                    ? `All findings in scope are already ${targetDisplay.toLowerCase()}`
                    : undefined
                }
                data-testid={`findings-bulk-action-${target}`}
              >
                {STATUS_BUTTON_LABEL[target]} ({count})
              </button>
            );
          })}
        </div>
        {bulkBanner && (
          <div
            className={`${styles.bulkBanner} ${
              bulkBanner.kind === 'success'
                ? styles.bulkBannerSuccess
                : styles.bulkBannerError
            }`}
            data-testid={`findings-bulk-banner-${bulkBanner.kind}`}
          >
            {bulkBanner.message}
          </div>
        )}
      </div>

      {/* Read-only Capabilities section (D2 -- Capability Synthesis +
          Batch Spines). Lives inside the Findings review; NO standalone
          tab (Option-B deferred), NO review actions / cascade UI. */}
      <CapabilitiesSection
        projectId={projectId}
        architectureId={architectureId}
        runId={runId}
        bookId={bookId}
      />

      {/* Table */}
      {loading ? (
        <div className={styles.loadingState} data-testid="findings-loading">
          Loading findings...
        </div>
      ) : error ? (
        <div className={styles.errorMessage} data-testid="findings-error">
          {error}
        </div>
      ) : findings.length === 0 ? (
        <div className={styles.emptyState} data-testid="findings-empty">
          No findings for this run.
        </div>
      ) : (
        <div className={styles.tableSection}>
          <table className={styles.table} data-testid="findings-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Category</th>
                <th>Type</th>
                <th>Title</th>
                <th>Summary</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Source / Stage</th>
                <th>Links</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((row) => {
                if (row.kind === 'severityHeader') {
                  return (
                    <tr
                      key={row.key}
                      className={styles.severityGroupHeader}
                      data-testid="findings-severity-group-header"
                    >
                      <td colSpan={10}>Severity: {row.label}</td>
                    </tr>
                  );
                }
                if (row.kind === 'categoryHeader') {
                  return (
                    <tr
                      key={row.key}
                      className={styles.categoryGroupHeader}
                      data-testid="findings-category-group-header"
                    >
                      <td colSpan={10}>Category: {row.label}</td>
                    </tr>
                  );
                }
                const f = row.finding!;
                return (
                  <tr
                    key={f.id}
                    className={styles.row}
                    data-testid="findings-row"
                    data-finding-id={f.id}
                    onClick={() => setSelectedFinding(f)}
                  >
                    <td>
                      <span
                        className={`${styles.badge} ${severityBadgeClass(f.severity)}`}
                      >
                        {f.severity}
                      </span>
                    </td>
                    <td>{f.category}</td>
                    <td>{labelForFindingType(f.finding_type)}</td>
                    <td>{f.title}</td>
                    <td className={styles.truncate} title={f.summary ?? ''}>
                      {f.summary ?? ''}
                    </td>
                    <td className={styles.confidenceCell}>
                      {formatConfidence(f.confidence)}
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${statusBadgeClass(f.review_status)}`}
                      >
                        {f.review_status}
                      </span>
                    </td>
                    <td>
                      <div>{f.source ?? '-'}</div>
                      {f.created_by_stage && (
                        <div style={{ fontSize: 10, color: '#64748b' }}>
                          {f.created_by_stage}
                        </div>
                      )}
                    </td>
                    <td>{(f.links ?? []).length}</td>
                    <td>{formatDate(f.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer (mounted only when a finding is selected) */}
      {selectedFinding && (
        <FindingDetailDrawer
          projectId={projectId}
          architectureId={architectureId}
          runId={runId}
          finding={selectedFinding}
          onClose={onCloseDrawer}
          onFindingUpdated={onFindingUpdated}
          onOpenLinkedTarget={onOpenLinkedTarget}
        />
      )}

      {/* Bulk-action confirmation modal */}
      <BulkFindingActionConfirmModal
        isOpen={pendingBulkStatus !== null}
        targetStatus={pendingBulkStatus ?? 'approved'}
        actionCount={modalActionCount}
        scopeLabel={modalScopeLabel}
        activeFilterText={modalActiveFilterText}
        approximateSkipped={modalApproximateSkipped}
        inFlight={bulkInFlight}
        onClose={closeBulkConfirm}
        onConfirm={confirmBulkAction}
      />
    </div>
  );
};

// Re-export helpers used by parent components (summary counts strip on the
// run-detail view typically wants to compute its own totals against a
// loaded list -- but the FindingsTab is the canonical owner of the counts
// today). Exported for test ergonomics.
export type { FindingsSummary };

/**
 * Re-export DTO marker types so downstream consumers can import them from
 * this module without a second `findingsApi` import. Pure re-exports do
 * not need a local binding.
 */
export type {
  DiscoveryFindingStatus,
  DiscoveryFindingSeverity,
} from '../../api/findingsApi';
