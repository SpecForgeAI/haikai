/**
 * MigrationBookOfWorkReviewWorkspace
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Task Groups 11 + 12 root surface.
 *
 * Owns the review experience: top-level summary, hierarchy tree, filter bar,
 * item drawer, selection controls, save-to-backlog dialog, post-save view.
 * Fetches the draft on mount and coordinates child components.
 *
 * Design-point references:
 *   - Q-7: workstream filter includes the `unknown` sentinel so reviewers can
 *     find items needing reclassification (filter list is the same 14-value
 *     enum as the schema).
 *   - Q-8: save-to-backlog filter modes are
 *     `all` / `selected` / `high_confidence_only` / `ready_for_spec_only`.
 *     The dialog previews per-mode counts BEFORE the user confirms; the
 *     preview includes the parent-inclusion approximation so the count
 *     matches what AMS will actually save (server-side AMS applies the
 *     authoritative parent-inclusion rule -- every saved descendant pulls
 *     its ancestor chain so the backlog never has orphans).
 *   - Q-16: `saveState` lives in FRONTEND STATE ONLY during the review
 *     session (`saveStateById` keyed by itemId, seeded from the persisted
 *     `book_of_work_json.items[].saveState`). The UI surfaces an
 *     "unsaved review changes" indicator when `saveStateById` has diverged
 *     from the persisted baseline. Two write paths flush state back into
 *     `book_of_work_json`:
 *       (a) explicit "Save draft" button -- PUTs to AMS;
 *       (b) save-to-backlog call -- AMS rewrites `book_of_work_json` with
 *           the post-save states.
 *
 * Filter behaviour:
 *   - When a workstream / readiness / confidence filter is applied, all
 *     descendants of a matched ancestor are PROMOTED into the visible set
 *     so the user sees the matched item in its hierarchical context (and
 *     can drill down to its children). Pure leaf-only filtering would hide
 *     the parent chain.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMigrationBookOfWork,
  saveMigrationBookOfWorkToBacklog,
  updateMigrationBookOfWork,
  type MigrationBookOfWorkDraft,
  type MigrationBookOfWorkExpansionState,
  type MigrationBookOfWorkItem,
  type MigrationBookOfWorkSaveState,
  type SaveToBacklogMode,
  type SaveToBacklogResponse,
} from '../../../api/migrationBookOfWorkApi';
import {
  expandAllMigrationBookOfWorkEpics,
  expandMigrationBookOfWorkEpic,
} from '../../../api/migrationDeliveryPlanApi';
import {
  getDbMigrationPackDownloadUrl,
  listDbMigrationPacks,
  type DbMigrationPackDto,
} from '../../../api/dbMigrationPackApi';
import {
  listArchitectures,
  type Architecture,
} from '../../../api/architecturesApi';
import MigrationBookOfWorkHierarchyTree from './MigrationBookOfWorkHierarchyTree';
import MigrationBookOfWorkFilters, {
  EMPTY_FILTERS,
  itemPassesFilters,
  type MigrationBookOfWorkFilterState,
} from './MigrationBookOfWorkFilters';
import MigrationBookOfWorkItemDrawer from './MigrationBookOfWorkItemDrawer';
// Phase 0 (2026-07-20): the ONE readiness function — live generator-input
// preflight consumed by the tree chip + drawer instead of the baked value.
// Phase 1a: the spec lifecycle folds into THIS screen (chips, generation,
// manual supply/ready, deletion) — the standalone Generate Specs screen dies.
import {
  runSpecPreflight,
  SpecPreflightRow,
  SpecGenerationRow,
  fetchSpecGenerationsForBook,
  fetchSpecGenerationSummary,
  startBatchGeneration,
  regenerateSingleStory,
  manualEditSpec,
  setSpecManualReady,
} from '../../../api/specGenerationApi';
import { deleteBookOfWorkStory } from '../../../api/migrationBookOfWorkApi';
// Phase 1b (2026-07-20): the tier-flexible execution rail — kickoff, status,
// pause/approve, and break-glass ride the EXISTING migrate machinery.
import {
  MigrationExecutionRail,
  RailPlane,
  PLANE_ORDER,
  planeForStory,
  type RailPlaneId,
} from './MigrationExecutionRail';
import {
  triggerMigrate,
  getLatestMigrationExecutionRun,
  resumeMigrationRun,
  haltMigrationRun,
  MigrationExecutionRunDto,
  type MigrationExecutionRunItemDto,
  fetchMigrationCredentialsStatus,
  registerRunStageCredentials,
  retryRunDbCompletion,
  resumeFailedMigrationRun,
  MigrationCredentialsStatus,
  type MigrateBlockReason,
} from '../../../api/migrationDeliveryDashboardApi';
import MigrationBookOfWorkSelectionControls from './MigrationBookOfWorkSelectionControls';
import MigrationBookOfWorkSaveToBacklogDialog, {
  type SaveToBacklogCounts,
} from './MigrationBookOfWorkSaveToBacklogDialog';
import MigrationBookOfWorkPostSaveView from './MigrationBookOfWorkPostSaveView';
import { computeFindingsCoverage } from '../../../utils/findingsCoverage';
// Execution-class oracle mirror (Spec 2026-08-04-1): manual stories are human
// work — never spec'ed, never dispatched — so they must not count against the
// per-plane spec gates.
import { isManualExecutionTags } from '../../../utils/executionClass';
// Carry-over accounting panel (2026-07-26): replaces the old advisory
// findings banner with the SERVER gate's truth — behaviour-bearing carry-over
// items must be cited or dismissed before Stage 2 (Service) can start.
import MigrationCarryOverAccountingPanel, {
  type CarryOverStoryOption,
} from './MigrationCarryOverAccountingPanel';
import { type CarryOverCoverageResult } from '../../../api/carryOverCoverageApi';
import { useToast } from '../../../contexts/ToastContext';
import styles from './MigrationBookOfWork.module.css';
import ApiAuthFields, {
  EMPTY_API_AUTH,
  toApiAuthSecret,
  type ApiAuthValue,
} from '../../shared/ApiAuthFields';

/**
 * Group the server gate's blocking reasons by machine code with a friendly
 * title + remedy per dimension (2026-07-26). Pure; exported for tests. The
 * gate has THREE dimensions — spec readiness, the active current-state
 * baseline, and carry-over accounting — and only the first is visible on the
 * plane cards, so the dialog must spell out the other two itself.
 */
export function groupBlockReasons(
  reasons: MigrateBlockReason[],
): Array<{ code: string; title: string; remedy: string | null; messages: string[] }> {
  const META: Record<string, { title: string; remedy: string | null }> = {
    story_not_spec_ready: {
      title: 'Stories without a generated spec',
      remedy:
        'Each listed story needs its implementation spec GENERATED (use ' +
        '"Generate specs (saved)", or supply a manual spec and mark it ' +
        "ready). Note: the table's 'ready_for_spec' badge only means a spec " +
        'CAN be generated — it is not the generated spec itself. A stale ' +
        'spec (amended story) needs regenerating. Or defer the story to ' +
        'drop it from the run.',
    },
    missing_current_baseline: {
      title: 'No active current-state baseline',
      remedy:
        'Capture and save an API behaviour baseline — reconciliation has no ' +
        'oracle without one.',
    },
    carry_over_not_accounted: {
      title: 'Carry-over items not accounted',
      remedy:
        'Each behaviour-bearing carry-over finding/capability must be CITED ' +
        'by a story or DISMISSED with a reason (use "View findings" on this ' +
        'screen) — non-API work has no reconciliation backstop.',
    },
  };
  const byCode = new Map<string, string[]>();
  for (const r of reasons) {
    const list = byCode.get(r.code) ?? [];
    list.push(r.message);
    byCode.set(r.code, list);
  }
  return [...byCode.entries()].map(([code, messages]) => ({
    code,
    title: META[code]?.title ?? code,
    remedy: META[code]?.remedy ?? null,
    messages,
  }));
}

export interface MigrationBookOfWorkReviewWorkspaceProps {
  projectId: string;
  bookId: string;
  /** Used to seed the workspace from the list view when the caller already has the draft loaded. */
  initialDraft?: MigrationBookOfWorkDraft;
  /** Optional navigation callback exposed to the post-save view. */
  onOpenBacklog?: () => void;
  /** Optional "back to the Migration Delivery Plans list" navigation callback. */
  onBackToPlans?: () => void;
  /**
   * Optional "open the spec-generation workspace for this book" navigation
   * callback. Surfaced as a header button so that, after saving stories to the
   * backlog, the user can jump straight to generating their implementation-
   * ready specs (where they can pick a subset to generate).
   */
  /**
   * Auto-select the story owning this WorkItem id once the draft loads
   * (Phase 1c): deep links that used to open the standalone spec-generation
   * drawer land here instead — the drawer's spec section opens in place.
   */
  initialSelectedWorkItemId?: string;
  /**
   * Orchestration scope for the execution rail (Phase 1b): organisation NAME +
   * project name, resolved by the route exactly as the delivery dashboard does.
   * The rail's Start/Approve need both; absent scope disables Start only.
   */
  companyName?: string;
  projectName?: string;
  /**
   * WHY the scope failed to resolve (Spec 2026-07-23) — surfaced under the
   * visibly-disabled Start button instead of a silent no-op.
   */
  scopeHint?: string | null;
  /** Deep link to the delivery dashboard (run forensics). */
  onOpenDelivery?: () => void;
  /**
   * Active architecture id (Residual 2): resolves the pack's DECLARED
   * target-DB binding for the Start-stage dialog prefill.
   */
  activeArchitectureId?: string;
}

/**
 * Compute the initial `saveStateById` map from the persisted draft. Any
 * item whose `saveState` is already populated on the wire (e.g. an
 * already-saved item from a prior save-to-backlog) is honoured verbatim;
 * everything else defaults to `'draft'`.
 */
function seedSaveState(
  items: MigrationBookOfWorkItem[],
): Record<string, MigrationBookOfWorkSaveState> {
  const out: Record<string, MigrationBookOfWorkSaveState> = {};
  for (const i of items) {
    out[i.id] = i.saveState ?? 'draft';
  }
  return out;
}

/**
 * Seed the per-epic expansion-state map from the persisted draft (Spec
 * 2026-06-11 Two-Phase generation). Only EPIC items that carry an
 * `expansionState` participate -- legacy full-plan drafts have none, so
 * every expand affordance stays hidden for them.
 */
function seedExpansionState(
  items: MigrationBookOfWorkItem[],
): Record<string, MigrationBookOfWorkExpansionState> {
  const out: Record<string, MigrationBookOfWorkExpansionState> = {};
  for (const i of items) {
    if (i.type === 'epic' && i.expansionState !== undefined) {
      out[i.id] = i.expansionState;
    }
  }
  return out;
}

/**
 * Build the parent-child adjacency from the flat list. Used for the
 * subtree-select affordance.
 */
function buildChildrenIndex(
  items: MigrationBookOfWorkItem[],
): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const i of items) {
    if (i.parentId) {
      const arr = idx.get(i.parentId) ?? [];
      arr.push(i.id);
      idx.set(i.parentId, arr);
    }
  }
  return idx;
}

function descendantIds(
  rootId: string,
  childrenIdx: Map<string, string[]>,
): string[] {
  const out: string[] = [];
  const stack = [...(childrenIdx.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    const kids = childrenIdx.get(id) ?? [];
    for (const k of kids) stack.push(k);
  }
  return out;
}

/**
 * Compute the set of items that would be admitted by a given saveMode +
 * the current frontend `saveStateById` map. Used to preview counts in the
 * save-to-backlog dialog. Mirrors the AMS filter semantics but applies on
 * the frontend snapshot.
 *
 * The parent-inclusion rule (Q-8) is approximated here so the dialog
 * counts are representative; the authoritative pass happens server-side.
 */
function admitForMode(
  items: MigrationBookOfWorkItem[],
  saveStateById: Record<string, MigrationBookOfWorkSaveState>,
  mode: SaveToBacklogMode,
  childrenIdx: Map<string, string[]>,
): MigrationBookOfWorkItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const baseAdmitted = new Set<string>();
  for (const i of items) {
    const state = saveStateById[i.id] ?? 'draft';
    if (state === 'excluded' || state === 'saved') continue;
    switch (mode) {
      case 'all':
        baseAdmitted.add(i.id);
        break;
      case 'selected':
        if (state === 'selected') baseAdmitted.add(i.id);
        break;
      case 'high_confidence_only':
        if (i.confidence === 'high') baseAdmitted.add(i.id);
        break;
      case 'ready_for_spec_only':
        if (i.readiness === 'ready_for_spec') baseAdmitted.add(i.id);
        break;
    }
  }
  // Apply parent-inclusion rule: any admitted item pulls its ancestor
  // chain through.
  const result = new Set<string>(baseAdmitted);
  for (const id of baseAdmitted) {
    let cursor = byId.get(id)?.parentId ?? null;
    while (cursor) {
      result.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  // childrenIdx kept available for future "subtree expand" semantics; not
  // strictly needed here.
  void childrenIdx;
  return items.filter((i) => result.has(i.id));
}

function countsForAdmitted(
  admitted: MigrationBookOfWorkItem[],
): SaveToBacklogCounts {
  const counts: SaveToBacklogCounts = {
    initiatives: 0,
    epics: 0,
    features: 0,
    stories: 0,
    total: 0,
    lowConfidenceCount: 0,
    blockedCount: 0,
  };
  for (const i of admitted) {
    counts.total += 1;
    if (i.type === 'initiative') counts.initiatives += 1;
    else if (i.type === 'epic') counts.epics += 1;
    else if (i.type === 'feature') counts.features += 1;
    else if (i.type === 'story') counts.stories += 1;
    if (i.confidence === 'low') counts.lowConfidenceCount += 1;
    if (i.readiness === 'blocked') counts.blockedCount += 1;
  }
  return counts;
}

/** Drag-resizable detail-panel width bounds. */
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 760;
const RIGHT_PANEL_DEFAULT_WIDTH = 420;

export const MigrationBookOfWorkReviewWorkspace: React.FC<
  MigrationBookOfWorkReviewWorkspaceProps
> = ({
  projectId,
  bookId,
  initialDraft,
  onOpenBacklog,
  onBackToPlans,
  initialSelectedWorkItemId,
  companyName,
  projectName,
  scopeHint,
  onOpenDelivery,
  activeArchitectureId,
}) => {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<MigrationBookOfWorkDraft | null>(
    initialDraft ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!initialDraft);
  const [error, setError] = useState<string | null>(null);

  // Save-draft feedback (point 1): the previous implementation gave no
  // positive signal on success and silently swallowed failures. We now track
  // an explicit lifecycle so the header can show saving / saved / error.
  const [saveDraftState, setSaveDraftState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  // Drag-resizable detail panel. Width lives in component state; the handle
  // between the two panels drives it from the body's right edge.
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(
    RIGHT_PANEL_DEFAULT_WIDTH,
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const startRightPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current || !bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const next = Math.max(
        RIGHT_PANEL_MIN_WIDTH,
        Math.min(RIGHT_PANEL_MAX_WIDTH, rect.right - ev.clientX),
      );
      setRightPanelWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  }, []);

  const items: MigrationBookOfWorkItem[] = useMemo(
    () => draft?.bookOfWork?.items ?? [],
    [draft],
  );

  // Deterministic findings coverage (Spec 2026-06-11, Task Group 4.3):
  // computed ON READ from the create-time snapshot + the CURRENT items, so
  // it self-updates when an epic expansion refreshes the draft. `null`
  // (legacy / fail-softed drafts) hides every coverage element (D8).
  const findingsCoverage = useMemo(
    () => computeFindingsCoverage(draft?.generationSummary, items),
    [draft?.generationSummary, items],
  );

  // Per Q-16 saveState lives in frontend state during review. Seeded from
  // the persisted wire value on draft load; deltas vs. seed flag the
  // "unsaved review changes" indicator.
  const [saveStateById, setSaveStateById] = useState<
    Record<string, MigrationBookOfWorkSaveState>
  >({});
  const [persistedSaveStateById, setPersistedSaveStateById] = useState<
    Record<string, MigrationBookOfWorkSaveState>
  >({});

  const [filters, setFilters] = useState<MigrationBookOfWorkFilterState>(
    EMPTY_FILTERS,
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // ----- DB migration pack attachment (Spec 2026-06-11, Task 6.7) -----
  // Best-effort lookup of the project's DB migration packs so the item
  // drawer can show the pack chip + download action on the attached DB
  // epic (`db_migration_packs.work_item_id`). Soft-fails to an empty list
  // -- the review workspace stays fully usable without the pack surface.
  const [dbMigrationPacks, setDbMigrationPacks] = useState<DbMigrationPackDto[]>(
    [],
  );
  useEffect(() => {
    let cancelled = false;
    void listDbMigrationPacks(projectId)
      .then((packs) => {
        if (!cancelled) setDbMigrationPacks(packs);
      })
      .catch(() => {
        /* soft-fail: no pack chips */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ----- Architecture name resolution (Spec 2026-06-26, Task Group 4) -----
  // One `listArchitectures(projectId)` fetch serves BOTH the inspector's
  // architecture-reference chips (via `resolveRef`) and the header's
  // current/target arch ids. Soft-fails to an empty list so every arch id
  // falls back to its raw UUID -- never blank, never blocking.
  const [architectures, setArchitectures] = useState<Architecture[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listArchitectures(projectId)
      .then((list) => {
        if (!cancelled) setArchitectures(list);
      })
      .catch(() => {
        /* soft-fail: raw arch ids everywhere */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const archNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of architectures) {
      if (a && typeof a.id === 'string' && typeof a.name === 'string') {
        m.set(a.id, a.name);
      }
    }
    return m;
  }, [architectures]);

  // Discovery-finding titles come from the already-loaded create-time
  // snapshot (`generationSummary.findingsCoverage.findings`) -- ZERO new
  // fetch. Findings without a usable title fall back to the raw id.
  const findingTitleById = useMemo(() => {
    const m = new Map<string, string>();
    const findings =
      draft?.generationSummary?.findingsCoverage?.findings ?? [];
    for (const f of findings) {
      if (
        f &&
        typeof f.id === 'string' &&
        typeof f.title === 'string' &&
        f.title.length > 0
      ) {
        m.set(f.id, f.title);
      }
    }
    return m;
  }, [draft?.generationSummary]);

  // Render-time resolver injected into the presentational drawer. Returns
  // `"name (id)"` / `"title (id)"` on a hit and the raw id on a miss (never
  // blank). Only architecture + discovery-finding refs opt in.
  const resolveRef = useCallback(
    (type: 'architecture' | 'discoveryFinding', id: string): string => {
      if (type === 'architecture') {
        const name = archNameById.get(id);
        return name ? `${name} (${id})` : id;
      }
      const title = findingTitleById.get(id);
      return title ? `${title} (${id})` : id;
    },
    [archNameById, findingTitleById],
  );

  // Header arch-id formatter (FR7): same `listArchitectures` result, raw-id
  // fallback on miss / fetch failure.
  const formatArchId = useCallback(
    (id: string | null | undefined): string => {
      if (!id) return id ?? '';
      const name = archNameById.get(id);
      return name ? `${name} (${id})` : id;
    },
    [archNameById],
  );
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<SaveToBacklogMode>('all');
  const [saveResponse, setSaveResponse] = useState<SaveToBacklogResponse | null>(
    null,
  );

  // ----- Carry-over accounting (2026-07-26) -----
  // Server-computed coverage held here so the Stage-2 (Service) rail card can
  // render `carry-over accounted M/N` and gate its Start — mirroring the
  // server gate that ALREADY blocks service starts on it (3b162be). The panel
  // owns the fetch; this is its latest read.
  const [carryOverCoverage, setCarryOverCoverage] =
    useState<CarryOverCoverageResult | null>(null);
  const handleCarryOverCoverageChanged = useCallback(
    (coverage: CarryOverCoverageResult | null) => setCarryOverCoverage(coverage),
    [],
  );
  /** The plan's STORY items — the accounting panel's cite/amend picker. */
  const carryOverStoryOptions = useMemo((): CarryOverStoryOption[] => {
    return items
      .filter((i) => i.type === 'story')
      .map((i) => ({ id: i.id, title: i.title, description: i.description ?? '' }));
  }, [items]);

  // ----- Phase-2 expansion state (Spec 2026-06-11, Task Group 5) -----
  // Seeded from the persisted draft (the `book_of_work_json` document is
  // the single source of truth, so state survives page reloads) and
  // updated live from expand-response payloads -- no streaming/SSE.
  const [expansionStateById, setExpansionStateById] = useState<
    Record<string, MigrationBookOfWorkExpansionState>
  >({});
  // Epic ids with an expand request in flight in THIS session. A persisted
  // `expanding` NOT in this set is stale (e.g. reload mid-expansion) and
  // presents as retryable.
  const [liveExpandingEpicIds, setLiveExpandingEpicIds] = useState<Set<string>>(
    new Set(),
  );
  // Ref mirror of `liveExpandingEpicIds` so async callbacks (e.g. the
  // post-expansion draft refresh) can read the CURRENT in-flight set
  // without a stale closure.
  const liveExpandingRef = useRef<Set<string>>(new Set());
  const mutateLiveExpanding = useCallback((mutate: (next: Set<string>) => void) => {
    const next = new Set(liveExpandingRef.current);
    mutate(next);
    liveExpandingRef.current = next;
    setLiveExpandingEpicIds(next);
  }, []);
  const [expansionError, setExpansionError] = useState<string | null>(null);

  // ----- Spec preflight (Phase 0) -----
  // Live generator-input check per story; null until the first run completes.
  // Re-run on demand ("Re-check readiness") and after expansion refreshes.
  const [preflightRows, setPreflightRows] = useState<SpecPreflightRow[] | null>(
    null,
  );
  const [preflightLoading, setPreflightLoading] = useState<boolean>(false);

  const refreshPreflight = useCallback(async () => {
    setPreflightLoading(true);
    try {
      const rows = await runSpecPreflight(projectId, bookId);
      setPreflightRows(rows);
    } catch {
      // Fail-soft: chips fall back to the baked readiness until the next run.
      setPreflightRows(null);
    } finally {
      setPreflightLoading(false);
    }
  }, [projectId, bookId]);

  useEffect(() => {
    // First preflight once the draft is available (archived drafts are
    // read-only history — no live check).
    if (draft && draft.status !== 'archived') void refreshPreflight();
  }, [draft, refreshPreflight]);

  const preflightById = useMemo(() => {
    if (!preflightRows) return undefined;
    const out: Record<string, { ready: boolean; missingCount: number }> = {};
    for (const r of preflightRows) {
      out[r.bookItemId] = { ready: r.ready, missingCount: r.missingInputs.length };
    }
    return out;
  }, [preflightRows]);

  // ----- Spec lifecycle (Phase 1a) -----
  const [specRows, setSpecRows] = useState<SpecGenerationRow[] | null>(null);
  const [specBatchInProgress, setSpecBatchInProgress] = useState<boolean>(false);
  const [specActionError, setSpecActionError] = useState<string | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] =
    useState<MigrationBookOfWorkItem | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState<boolean>(false);

  const refreshSpecRows = useCallback(async () => {
    try {
      setSpecRows(await fetchSpecGenerationsForBook(projectId, bookId));
    } catch {
      // Fail-soft: chips simply don't render until the next successful read.
    }
  }, [projectId, bookId]);

  useEffect(() => {
    if (draft) void refreshSpecRows();
  }, [draft, refreshSpecRows]);

  /**
   * Latest spec row per story WorkItem id — the SAME latest-row rule the
   * server gate uses (highest attempt number, then latest createdAt;
   * 2026-07-27). The old "later list rows win" shortcut could pick a
   * different row than the gate when a work item carries several attempts,
   * letting the card and the server disagree about readiness.
   */
  const specRowByWorkItem = useMemo(() => {
    const out = new Map<string, SpecGenerationRow>();
    for (const r of specRows ?? []) {
      if (!r.workItemId) continue;
      const prev = out.get(r.workItemId);
      if (!prev) {
        out.set(r.workItemId, r);
        continue;
      }
      const an = r.generationAttemptNumber ?? 0;
      const bn = prev.generationAttemptNumber ?? 0;
      if (an > bn || (an === bn && (r.createdAt ?? '') >= (prev.createdAt ?? ''))) {
        out.set(r.workItemId, r);
      }
    }
    return out;
  }, [specRows]);

  /**
   * Staleness is EITHER flag (2026-07-27, mirrors the server gate): the
   * target-architecture mark-stale stamps `stale` with NO reason; the
   * story-amend path stamps both. Checking only one let surfaces disagree.
   */
  const isRowStale = useCallback(
    (row: SpecGenerationRow): boolean => row.stale === true || !!row.staleReason,
    [],
  );

  /** Spec chip per story BOOK-ITEM id for the tree. */
  const specStateById = useMemo(() => {
    if (!specRows) return undefined;
    const out: Record<
      string,
      { label: string; kind: 'generating' | 'ok' | 'warn' | 'blocked' | 'manual' }
    > = {};
    for (const item of draft?.bookOfWork?.items ?? []) {
      if (item.type !== 'story') continue;
      const wi = (item as { workItemId?: string | null }).workItemId;
      const row = wi ? specRowByWorkItem.get(wi) : undefined;
      if (!row) continue;
      if (isRowStale(row)) {
        // Carry-over triage (2026-07-26): an amended story's spec is stale —
        // it needs REgeneration (the batch picks it up) and the server gate
        // refuses it, so the chip must not read as satisfied.
        out[item.id] = { label: 'spec stale ↻', kind: 'warn' };
      } else if (row.manualReady) {
        out[item.id] = { label: 'spec ✎ manual', kind: 'manual' };
      } else if (row.status === 'generated') {
        out[item.id] = {
          label: `spec ✓${row.confidence ? ` ${row.confidence}` : ''}`,
          kind: 'ok',
        };
      } else if (row.status === 'generated_with_warnings') {
        out[item.id] = {
          label: `spec ⚠ (${row.warnings.length})`,
          kind: 'warn',
        };
      } else if (
        row.status === 'insufficient_context' ||
        row.status === 'failed' ||
        row.status === 'skipped_blocked'
      ) {
        out[item.id] = { label: 'spec ✕', kind: 'blocked' };
      }
    }
    return out;
  }, [specRows, specRowByWorkItem, draft, isRowStale]);

  /** Header rollup: generated / warnings / blocked / manual / stale. */
  const specCounts = useMemo(() => {
    if (!specRows) return null;
    let ok = 0;
    let warn = 0;
    let blocked = 0;
    let manual = 0;
    let stale = 0;
    for (const r of specRowByWorkItem.values()) {
      if (isRowStale(r)) stale++;
      else if (r.manualReady) manual++;
      else if (r.status === 'generated') ok++;
      else if (r.status === 'generated_with_warnings') warn++;
      else if (
        r.status === 'insufficient_context' ||
        r.status === 'failed' ||
        r.status === 'skipped_blocked'
      )
        blocked++;
    }
    return { ok, warn, blocked, manual, stale };
  }, [specRows, specRowByWorkItem, isRowStale]);

  /**
   * Generate specs for every saved, not-yet-attempted story — batches loop
   * until the book reports none remaining (bounded), then spec rows AND the
   * preflight refresh so chips stay live.
   */
  const handleGenerateSpecs = useCallback(async () => {
    setSpecActionError(null);
    setSpecBatchInProgress(true);
    try {
      for (let i = 0; i < 20; i++) {
        await startBatchGeneration({ projectId, bookOfWorkId: bookId });
        const summary = await fetchSpecGenerationSummary(projectId, bookId);
        if (summary.notAttemptedCount <= 0) break;
      }
      await Promise.all([refreshSpecRows(), refreshPreflight()]);
    } catch (err) {
      setSpecActionError(
        err instanceof Error ? err.message : 'Spec generation failed.',
      );
      await refreshSpecRows();
    } finally {
      setSpecBatchInProgress(false);
    }
  }, [projectId, bookId, refreshSpecRows, refreshPreflight]);

  /** Per-story regenerate from the drawer (confirmOverwrite pass-through). */
  const handleRegenerateSpec = useCallback(
    async (workItemId: string, confirmOverwrite: boolean) => {
      await regenerateSingleStory({
        projectId,
        bookOfWorkId: bookId,
        workItemId,
        ...(confirmOverwrite
          ? { confirmOverwrite: true, overwriteManuallyEdited: true }
          : {}),
      });
      await Promise.all([refreshSpecRows(), refreshPreflight()]);
    },
    [projectId, bookId, refreshSpecRows, refreshPreflight],
  );

  const handleSaveSpecEdit = useCallback(
    async (specId: string, specText: string) => {
      await manualEditSpec(projectId, specId, specText, 'plan-screen-user');
      await refreshSpecRows();
    },
    [projectId, refreshSpecRows],
  );

  const handleSetManualReady = useCallback(
    async (specId: string, ready: boolean) => {
      await setSpecManualReady(projectId, specId, ready, 'plan-screen-user');
      await refreshSpecRows();
    },
    [projectId, refreshSpecRows],
  );

  /** Confirmed story deletion: tombstone at AMS, then full refresh. */
  const handleDeleteStoryConfirmed = useCallback(async () => {
    if (!deleteConfirmItem) return;
    setDeleteInProgress(true);
    setSpecActionError(null);
    try {
      await deleteBookOfWorkStory(projectId, bookId, deleteConfirmItem.id);
      setDeleteConfirmItem(null);
      setSelectedItemId(null);
      const d = await getMigrationBookOfWork(projectId, bookId);
      setDraft(d);
      const seeded = seedSaveState(d.bookOfWork?.items ?? []);
      setSaveStateById(seeded);
      setPersistedSaveStateById(seeded);
      await Promise.all([refreshSpecRows(), refreshPreflight()]);
    } catch (err) {
      setSpecActionError(
        err instanceof Error ? err.message : 'Story deletion failed.',
      );
    } finally {
      setDeleteInProgress(false);
    }
  }, [
    deleteConfirmItem,
    projectId,
    bookId,
    refreshSpecRows,
    refreshPreflight,
  ]);

  // ----- Execution rail (Phase 1b) -----
  const [run, setRun] = useState<MigrationExecutionRunDto | null>(null);
  const [railBusy, setRailBusy] = useState<boolean>(false);
  const [railError, setRailError] = useState<string | null>(null);
  const [railBlockers, setRailBlockers] = useState<Array<
    Record<string, unknown>
  > | null>(null);

  const refreshRun = useCallback(async () => {
    try {
      setRun(await getLatestMigrationExecutionRun(projectId, bookId));
    } catch {
      // No run yet / read hiccup — the rail simply shows the pre-run state.
      setRun(null);
    }
  }, [projectId, bookId]);

  useEffect(() => {
    if (draft) void refreshRun();
  }, [draft, refreshRun]);

  // Poll while a run is in flight so cards + the pause banner stay live.
  useEffect(() => {
    const status = run?.status ?? null;
    if (!status || !['dispatching', 'awaiting_approval'].includes(status)) {
      return;
    }
    const t = setInterval(() => void refreshRun(), 10000);
    return () => clearInterval(t);
  }, [run?.status, refreshRun]);

  /** Tier-flexible plane rollups — cards derive from the plan's content. */
  const railPlanes = useMemo((): RailPlane[] => {
    const stories = (draft?.bookOfWork?.items ?? []).filter(
      (i) => i.type === 'story',
    );
    if (stories.length === 0) return [];
    const byPlane = new Map<string, typeof stories>();
    for (const s of stories) {
      const plane = planeForStory(s);
      const bucket = byPlane.get(plane) ?? [];
      bucket.push(s);
      byPlane.set(plane, bucket);
    }
    // Robustness R2: carry the WHOLE item (not just its status) — the rail
    // needs failed counts (halted-mid-stage detection) + the armed-retry
    // shape (retry chip) in addition to done progress.
    const runItemsByWorkItem = new Map<string, MigrationExecutionRunItemDto>();
    for (const it of run?.items ?? []) {
      if (it.work_item_id) runItemsByWorkItem.set(it.work_item_id, it);
    }
    return PLANE_ORDER.filter((p) => (byPlane.get(p) ?? []).length > 0).map(
      (p) => {
        const planeStories = byPlane.get(p)!;
        // Execution-class split (Spec 2026-08-04-1): MANUAL stories are human
        // work — the server never specs or dispatches them — so they are
        // excluded from the spec-gate denominator ("specs X/Y") and never
        // listed as blockers. Run progress still scans every story (manual
        // ones simply never appear in run items).
        const gateStories = planeStories.filter(
          (s) => !isManualExecutionTags(s.tags),
        );
        const blockers: Array<{ id: string; title: string }> = [];
        let satisfied = 0;
        let runDone = 0;
        let runTotal = 0;
        let runFailed = 0;
        let armedRetryAttempt: number | null = null;
        for (const s of planeStories) {
          const wi = (s as { workItemId?: string | null }).workItemId;
          const row = wi ? specRowByWorkItem.get(wi) : undefined;
          const isManual = isManualExecutionTags(s.tags);
          // A STALE row is NOT satisfied (2026-07-26): the story was amended
          // (e.g. for a carry-over finding) and its spec must regenerate —
          // the server gate refuses stale, so the card must too. Either stale
          // flag counts (2026-07-27, mirrors isStorySpecReady).
          const ok =
            !!row &&
            !isRowStale(row) &&
            (row.manualReady === true ||
              row.status === 'generated' ||
              row.status === 'generated_with_warnings');
          if (!isManual) {
            if (ok) satisfied++;
            else blockers.push({ id: s.id, title: s.title });
          }
          if (wi && runItemsByWorkItem.has(wi)) {
            runTotal++;
            const item = runItemsByWorkItem.get(wi)!;
            const st = item.status ?? '';
            if (st === 'implemented' || st === 'deployed') runDone++;
            if (st === 'failed') runFailed++;
            // Armed auto-retry (Robustness R2): pending + attempts consumed
            // + a scheduled next attempt = the driver is in backoff. N
            // attempts consumed means the NEXT try is attempt N+1 (matching
            // the error_detail's "retry N+1/3 scheduled").
            if (
              st === 'pending' &&
              (item.retry_attempt_count ?? 0) > 0 &&
              item.retry_next_attempt_at
            ) {
              const attempt = (item.retry_attempt_count ?? 0) + 1;
              if (armedRetryAttempt === null || attempt > armedRetryAttempt) {
                armedRetryAttempt = attempt;
              }
            }
          }
        }
        return {
          plane: p,
          totalStories: gateStories.length,
          satisfiedStories: satisfied,
          blockers,
          runDone,
          runTotal,
          runFailed,
          armedRetryAttempt,
          // Carry-over accounting rides ONLY the service card (the server gate
          // blocks service starts on it; DB/UI stages are unaffected —
          // 3b162be). Null until the panel's first coverage read lands.
          carryOver:
            p === 'service' && carryOverCoverage
              ? {
                  accounted: carryOverCoverage.accountedCount,
                  total: carryOverCoverage.totalMustAccount,
                }
              : null,
        };
      },
    );
  }, [draft, specRowByWorkItem, run, carryOverCoverage, isRowStale]);

  const railScopeReady = Boolean(companyName && projectName);

  // ----- Start-stage dialog (Residual 2) -----
  // The plan DECLARED the target-DB binding (it creates the target database),
  // so the dialog prefills coordinates and asks for SECRETS only. Mode
  // 'start' = confirm + trigger the run + register creds against the new
  // runId; mode 'register' = (re)register creds for the ACTIVE run (e.g.
  // after a gateway restart dropped the in-memory store).
  const [startDialog, setStartDialog] = useState<{
    open: boolean;
    /**
     * 'start' = confirm + trigger the run + register; 'register' = re-register
     * for the active run; 'retry-db' (2026-07-31) = the stage-1 credentials
     * modal with "Retry DB build" as the confirm action — re-runs the DB
     * execution chain on a halted run WITHOUT re-running the specs.
     */
    mode: 'start' | 'register' | 'retry-db';
    /** The plane this start targets (per-plane runs, 2026-07-26). */
    plane?: RailPlaneId;
    /** Stage number for the dialog title (derived from the rail card). */
    stageNo?: number;
  }>({ open: false, mode: 'start' });
  // Parity-only refusal of a service start renders the break-glass option
  // (mirrors the resume-time break-glass; the override is recorded).
  const [showParityBreakGlass, setShowParityBreakGlass] = useState(false);
  // Run-branch chaining (2026-08-06): unticked (default) = this stage's first
  // worktree branch CONTINUES from the previous stage's last good spec branch
  // (sees its unmerged work); ticked = start fresh from the main branch (the
  // previous stage's MR is already merged). Reset on every dialog open.
  const [startFromMain, setStartFromMain] = useState(false);
  const [credsStatus, setCredsStatus] =
    useState<MigrationCredentialsStatus | null>(null);
  const [targetDbFields, setTargetDbFields] = useState({
    host: 'localhost',
    port: 5432,
    database: 'haikai_target',
    schema: 'public',
    username: 'postgres',
  });
  const [targetDbPassword, setTargetDbPassword] = useState('');
  // Stage-1 SOURCE database section (2026-07-31): previously only
  // registerable via the drift-watch flow — the live run halted at the DB
  // chain's inputs guard because of exactly that gap.
  const [sourceDbFields, setSourceDbFields] = useState({
    host: '',
    port: 5000,
    database: '',
    schema: '',
    username: '',
  });
  const [sourceDbPassword, setSourceDbPassword] = useState('');
  // Stage-2 TARGET service serve spec (2026-07-31): prefilled from the
  // derived binding; command executes verbatim via haibox — operator input.
  const [serveFields, setServeFields] = useState({
    command: '',
    healthPath: '/',
    portEnv: 'PORT',
    readinessTimeout: 30,
    setup: '',
  });
  /** KEY=VALUE per line (e.g. the migrated service's datasource settings). */
  const [serveEnvText, setServeEnvText] = useState('');
  // Stage-2 SOURCE service (current system API) section (2026-07-31).
  const [sourceApiFields, setSourceApiFields] = useState({
    baseUrl: '',
  });
  // The SAME auth surface as the API Behaviour Baseline Capture wizard
  // (2026-08-13): none | bearer | basic | ssoToken header | custom header —
  // internal systems authenticate with the ssoToken header, which the old
  // none|bearer dropdown could not express.
  const [sourceApiAuth, setSourceApiAuth] = useState<ApiAuthValue>({
    ...EMPTY_API_AUTH,
  });
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The server gate's verbatim blocking reasons (2026-07-26): the plane cards
  // only visualise SPEC readiness, but the gate also blocks on the current
  // baseline and unaccounted carry-over findings/capabilities — pointing the
  // user at all-green cards for those was a dead end. Rendered grouped under
  // the dialog error.
  const [dialogBlockReasons, setDialogBlockReasons] = useState<
    MigrateBlockReason[] | null
  >(null);

  const refreshCredsStatus = useCallback(async () => {
    try {
      const status = await fetchMigrationCredentialsStatus(projectId, {
        architectureId: activeArchitectureId,
        runId: run?.id,
      });
      setCredsStatus(status);
      return status;
    } catch {
      setCredsStatus(null);
      return null;
    }
  }, [projectId, activeArchitectureId, run?.id]);

  useEffect(() => {
    // Presence indicator stays live while a run exists.
    if (run?.id) void refreshCredsStatus();
  }, [run?.id, refreshCredsStatus]);

  const openStartDialog = useCallback(
    async (
      mode: 'start' | 'register' | 'retry-db',
      plane?: RailPlaneId,
      stageNo?: number,
    ) => {
      setDialogError(null);
      setDialogBlockReasons(null);
      setShowParityBreakGlass(false);
      setTargetDbPassword('');
      setSourceDbPassword('');
      const status = await refreshCredsStatus();
      const b = status?.targetBinding;
      if (b) {
        setTargetDbFields({
          host: b.host,
          port: b.port,
          database: b.database,
          schema: b.schema,
          username: b.username,
        });
      }
      // Stage-1 SOURCE DB prefill: non-secret coordinates from a previous
      // registration in this gateway process (password always re-entered).
      const s = status?.source;
      if (s?.registered) {
        setSourceDbFields({
          host: s.host ?? '',
          port: s.port ?? 5000,
          database: s.database ?? '',
          schema: '',
          username: s.username ?? '',
        });
      }
      // Stage-2 prefills: the tool-DECLARED serve spec + any previously
      // registered source-API coordinates.
      const sb = status?.serviceBinding;
      if (sb) {
        setServeFields({
          command: sb.command,
          healthPath: sb.health_path,
          portEnv: sb.port_env,
          readinessTimeout: sb.readiness_timeout,
          setup: sb.setup ?? '',
        });
      }
      const sa = status?.sourceApi;
      if (sa?.registered) {
        setSourceApiFields((f) => ({
          ...f,
          baseUrl: sa.current_base_url ?? '',
          authType: sa.auth_type ?? 'none',
        }));
      }
      setStartFromMain(false);
      setStartDialog({ open: true, mode, plane, stageNo });
    },
    [refreshCredsStatus],
  );

  /** Parse the env textarea (KEY=VALUE per line). Returns null on a bad line. */
  const parseServeEnv = (text: string): Record<string, string> | null => {
    const env: Record<string, string> = {};
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (line === '') continue;
      const eq = line.indexOf('=');
      const key = eq > 0 ? line.slice(0, eq).trim() : '';
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
      env[key] = line.slice(eq + 1);
    }
    return env;
  };

  const confirmStartDialog = useCallback(async (parityOverride = false) => {
    if (!companyName || !projectName) return;
    setDialogBusy(true);
    setDialogError(null);
    setDialogBlockReasons(null);
    setShowParityBreakGlass(false);
    setRailBlockers(null);
    try {
      let runId: string | null = null;
      if (startDialog.mode === 'start') {
        const result = await triggerMigrate(projectId, bookId, {
          company: companyName,
          project: projectName,
          plane: startDialog.plane,
          parityOverride,
          baseMode: startFromMain ? 'fresh' : 'chain',
        });
        if (result.status === 'blocked') {
          setDialogError(
            `Start refused by the server gate — ${result.reasons.length} blocking reason(s):`,
          );
          setDialogBlockReasons(result.reasons);
          // Parity-only refusal (the preceding DB plane's data parity is not
          // clean) → offer the recorded break-glass, mirroring the resume path.
          setShowParityBreakGlass(
            result.reasons.length > 0 &&
              result.reasons.every((r) => r.code.startsWith('data_parity_')),
          );
          return;
        }
        if (result.status === 'error') {
          setDialogError(result.message);
          return;
        }
        runId = result.runId;
      } else {
        runId = run?.id ?? null;
      }
      // Register the stage's SOURCE + TARGET details against the run
      // (2026-07-31; skippable per section: an empty password/command means
      // "not now" — the affected step fail-softs and its gate blocks until
      // provided, exactly as Spec W designed).
      const dialogPlane: RailPlaneId = startDialog.plane ?? 'db';
      if (runId) {
        const opts: Parameters<typeof registerRunStageCredentials>[2] = {};
        if (dialogPlane !== 'service') {
          if (targetDbPassword.trim().length > 0) {
            opts.targetDb = {
              dbType: 'postgres',
              ...targetDbFields,
              password: targetDbPassword,
            };
          }
          if (sourceDbPassword.trim().length > 0 && sourceDbFields.host.trim() !== '') {
            opts.sourceDb = {
              dbType: 'sybase',
              host: sourceDbFields.host,
              port: sourceDbFields.port,
              database: sourceDbFields.database,
              schema: sourceDbFields.schema.trim() === '' ? null : sourceDbFields.schema,
              username: sourceDbFields.username,
              password: sourceDbPassword,
            };
          }
        } else {
          if (serveFields.command.trim() !== '') {
            const env = parseServeEnv(serveEnvText);
            if (env === null) {
              setDialogError(
                'Environment variables must be KEY=VALUE, one per line (keys: letters/digits/underscore).',
              );
              return;
            }
            opts.service = {
              command: serveFields.command.trim(),
              healthPath: serveFields.healthPath,
              portEnv: serveFields.portEnv,
              readinessTimeout: serveFields.readinessTimeout,
              ...(serveFields.setup.trim() !== '' ? { setup: serveFields.setup.trim() } : {}),
              ...(Object.keys(env).length > 0 ? { env } : {}),
            };
          }
          if (sourceApiFields.baseUrl.trim() !== '') {
            opts.sourceApi = {
              currentBaseUrl: sourceApiFields.baseUrl.trim(),
              // Full auth secret (2026-08-13): the wizard-shaped form value
              // maps to the gateway's ApiAuthSecret (sso_token -> the fixed
              // `ssoToken` custom header, value trimmed).
              auth: toApiAuthSecret(sourceApiAuth),
            };
          }
        }
        if (Object.keys(opts).length > 0) {
          try {
            await registerRunStageCredentials(projectId, runId, opts);
          } catch (err) {
            setRailError(
              `Run started, but credential registration failed: ${
                err instanceof Error ? err.message : 'unknown'
              } — use "Provide credentials…" on the DB card.`,
            );
          }
        }
      }
      // Retry mode (2026-07-31): re-kick the DB execution chain on the
      // halted run. A refusal keeps the dialog open with the driver's
      // fail-closed reason.
      if (startDialog.mode === 'retry-db' && runId && companyName && projectName) {
        const result = await retryRunDbCompletion(projectId, runId, {
          company: companyName,
          project: projectName,
          bookId,
        });
        if (result.status !== 'retrying') {
          setDialogError(`Retry refused: ${result.reason ?? result.status}`);
          return;
        }
      }
      setStartDialog({ open: false, mode: 'start' });
      setTargetDbPassword('');
      setSourceDbPassword('');
      await refreshRun();
      await refreshCredsStatus();
    } finally {
      setDialogBusy(false);
    }
  }, [
    companyName,
    projectName,
    projectId,
    bookId,
    startDialog.mode,
    startDialog.plane,
    startFromMain,
    run?.id,
    targetDbFields,
    targetDbPassword,
    sourceDbFields,
    sourceDbPassword,
    serveFields,
    serveEnvText,
    sourceApiFields,
    sourceApiAuth,
    refreshRun,
    refreshCredsStatus,
  ]);

  const handleRailApprove = useCallback(
    async (override: boolean) => {
      if (!companyName || !projectName || !run?.id) return;
      setRailBusy(true);
      setRailError(null);
      try {
        const result = await resumeMigrationRun(projectId, run.id, {
          company: companyName,
          project: projectName,
          ...(override ? { override: true } : {}),
        });
        if (result.status === 'blocked') {
          // Unclean parity — surface the reasons + the break-glass action.
          setRailBlockers(
            result.reasons as unknown as Array<Record<string, unknown>>,
          );
        } else {
          setRailBlockers(null);
          if (result.status === 'not_paused' || result.status === 'error') {
            setRailError(result.message);
          }
        }
        await refreshRun();
      } finally {
        setRailBusy(false);
      }
    },
    [companyName, projectName, run?.id, projectId, refreshRun],
  );

  // Operator "halt run" (2026-07-28): abandon a wedged run so Start returns.
  const handleRailHalt = useCallback(async () => {
    if (!run?.id) return;
    const confirmed = window.confirm(
      'Halt this run? Its in-flight items will be marked failed, and a fresh Start becomes possible.',
    );
    if (!confirmed) return;
    setRailBusy(true);
    setRailError(null);
    try {
      const result = await haltMigrationRun(
        projectId,
        run.id,
        'operator abandon via execution rail',
      );
      if (result.status === 'error') {
        setRailError(result.message);
      }
      await refreshRun();
    } finally {
      setRailBusy(false);
    }
  }, [projectId, run?.id, refreshRun]);

  // Operator "Resume stage N" (Robustness R2, 2026-08-05): a HALTED run
  // continues from its first FAILED spec — implemented items are never
  // re-run. The driver's fail-closed refusal (409) surfaces its reason on
  // the rail's existing error affordance.
  const handleRailResumeFailed = useCallback(async () => {
    if (!companyName || !projectName || !run?.id) return;
    setRailBusy(true);
    setRailError(null);
    try {
      const result = await resumeFailedMigrationRun(projectId, run.id, {
        company: companyName,
        project: projectName,
        bookId,
      });
      if (!result.resumed) {
        setRailError(`Resume refused: ${result.reason}`);
      }
      await refreshRun();
    } catch (err) {
      setRailError(
        err instanceof Error ? err.message : 'Failed to resume the run.',
      );
    } finally {
      setRailBusy(false);
    }
  }, [companyName, projectName, projectId, bookId, run?.id, refreshRun]);

  const archived = draft?.status === 'archived';

  // ----- Initial load -----
  useEffect(() => {
    if (initialDraft) {
      const seeded = seedSaveState(initialDraft.bookOfWork?.items ?? []);
      setSaveStateById(seeded);
      setPersistedSaveStateById(seeded);
      setExpansionStateById(
        seedExpansionState(initialDraft.bookOfWork?.items ?? []),
      );
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getMigrationBookOfWork(projectId, bookId)
      .then((d) => {
        if (cancelled) return;
        setDraft(d);
        const seeded = seedSaveState(d.bookOfWork?.items ?? []);
        setSaveStateById(seeded);
        setPersistedSaveStateById(seeded);
        setExpansionStateById(seedExpansionState(d.bookOfWork?.items ?? []));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load draft.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, bookId, initialDraft]);

  // ----- Deep-link auto-select (Phase 1c) -----
  // ?workItemId=... selects the owning story once the draft is available so
  // its drawer (incl. the spec section) opens — the replacement for the old
  // spec-generation workspace's auto-open drawer.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!initialSelectedWorkItemId || autoSelectedRef.current || !draft) return;
    const match = (draft.bookOfWork?.items ?? []).find(
      (i) =>
        i.type === 'story' &&
        (i as { workItemId?: string | null }).workItemId ===
          initialSelectedWorkItemId,
    );
    if (match) {
      setSelectedItemId(match.id);
      autoSelectedRef.current = true;
    }
  }, [initialSelectedWorkItemId, draft]);

  // ----- Filtered items (visible in tree) -----
  const visibleItems = useMemo(() => {
    // For the hierarchy tree to render parents of admitted descendants,
    // an item is visible if it passes filters OR any of its descendants
    // passes. Otherwise filtering would visually orphan deep matches.
    const passing = new Set<string>();
    const childrenIdx = buildChildrenIndex(items);
    for (const i of items) {
      if (itemPassesFilters(i, filters)) passing.add(i.id);
    }
    // Promote ancestors of any passing item.
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of [...passing]) {
      let cursor = byId.get(id)?.parentId ?? null;
      while (cursor) {
        passing.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    // Promote descendants of any directly-passing item so the user sees
    // the subtree intact when they filter on an initiative.
    for (const i of items) {
      if (itemPassesFilters(i, filters)) {
        for (const d of descendantIds(i.id, childrenIdx)) {
          passing.add(d);
        }
      }
    }
    return items.filter((i) => passing.has(i.id));
  }, [items, filters]);

  // ----- Unsaved review changes indicator (Q-16) -----
  const hasUnsavedChanges = useMemo(() => {
    const ids = new Set([
      ...Object.keys(saveStateById),
      ...Object.keys(persistedSaveStateById),
    ]);
    for (const id of ids) {
      if (
        (saveStateById[id] ?? 'draft') !==
        (persistedSaveStateById[id] ?? 'draft')
      ) {
        return true;
      }
    }
    return false;
  }, [saveStateById, persistedSaveStateById]);

  // ----- Selection control handlers -----
  const setStateFor = (
    targetIds: Iterable<string>,
    newState: MigrationBookOfWorkSaveState,
  ) => {
    setSaveStateById((prev) => {
      const next = { ...prev };
      for (const id of targetIds) {
        // Never overwrite a saved item -- those have a real workItemId.
        if (next[id] === 'saved') continue;
        next[id] = newState;
      }
      return next;
    });
  };

  const handleSelectAll = useCallback(() => {
    setStateFor(
      items.map((i) => i.id),
      'selected',
    );
  }, [items]);

  const handleDeselectAll = useCallback(() => {
    setStateFor(
      items.map((i) => i.id),
      'draft',
    );
  }, [items]);

  const handleSelectSubtree = useCallback(() => {
    if (!selectedItemId) return;
    const childrenIdx = buildChildrenIndex(items);
    const ids = [selectedItemId, ...descendantIds(selectedItemId, childrenIdx)];
    setStateFor(ids, 'selected');
  }, [items, selectedItemId]);

  // Per-row checkbox toggle (point 2). Toggling any node cascades to its whole
  // subtree so a parent checkbox selects/deselects every child. We never touch
  // `saved` items (they hold a real workItemId). On select we skip `excluded`
  // items (a deliberate keep-out); on deselect we only flip items currently
  // `selected` back to `draft`, leaving `excluded` marks intact.
  const handleToggleSelectItem = useCallback(
    (itemId: string, selected: boolean) => {
      const childrenIdx = buildChildrenIndex(items);
      const ids = [itemId, ...descendantIds(itemId, childrenIdx)];
      setSaveStateById((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const cur = next[id] ?? 'draft';
          if (cur === 'saved') continue;
          if (selected) {
            if (cur !== 'excluded') next[id] = 'selected';
          } else if (cur === 'selected') {
            next[id] = 'draft';
          }
        }
        return next;
      });
    },
    [items],
  );

  const handleExcludeSelected = useCallback(() => {
    const ids = Object.entries(saveStateById)
      .filter(([, s]) => s === 'selected')
      .map(([id]) => id);
    if (ids.length === 0 && selectedItemId) {
      // Fall back to the currently focused item when nothing is in 'selected'.
      setStateFor([selectedItemId], 'excluded');
      return;
    }
    setStateFor(ids, 'excluded');
  }, [saveStateById, selectedItemId]);

  const handleIncludeSelected = useCallback(() => {
    const ids = Object.entries(saveStateById)
      .filter(([, s]) => s === 'excluded')
      .map(([id]) => id);
    setStateFor(ids, 'draft');
  }, [saveStateById]);

  // ----- Phase-2 expansion flow (Spec 2026-06-11, Task Group 5.3/5.5) -----

  /**
   * Re-fetch the draft after an expansion completes so the appended
   * stories land in the tree. Local review (`saveState`) deltas are
   * preserved for existing items; NEW items (the appended stories) are
   * seeded from their persisted wire value. Expansion states re-sync from
   * the persisted document except for epics still expanding live.
   */
  const refreshDraftAfterExpansion = useCallback(async () => {
    const d = await getMigrationBookOfWork(projectId, bookId);
    setDraft(d);
    const refreshedItems = d.bookOfWork?.items ?? [];
    const seedNew = (
      prev: Record<string, MigrationBookOfWorkSaveState>,
    ): Record<string, MigrationBookOfWorkSaveState> => {
      const next = { ...prev };
      for (const i of refreshedItems) {
        if (!(i.id in next)) next[i.id] = i.saveState ?? 'draft';
      }
      return next;
    };
    setSaveStateById(seedNew);
    setPersistedSaveStateById(seedNew);
    const live = liveExpandingRef.current;
    setExpansionStateById((prev) => {
      const next = { ...prev };
      for (const [epicId, state] of Object.entries(
        seedExpansionState(refreshedItems),
      )) {
        if (!live.has(epicId)) next[epicId] = state;
      }
      return next;
    });
  }, [projectId, bookId]);

  const handleExpandEpic = useCallback(
    async (epicId: string) => {
      setExpansionError(null);
      setExpansionStateById((prev) => ({ ...prev, [epicId]: 'expanding' }));
      mutateLiveExpanding((next) => next.add(epicId));
      try {
        const outcome = await expandMigrationBookOfWorkEpic(
          projectId,
          bookId,
          epicId,
        );
        setExpansionStateById((prev) => ({
          ...prev,
          [epicId]: outcome.expansionState,
        }));
        if (outcome.expansionState === 'failed' && outcome.error) {
          setExpansionError(
            `Expansion of epic ${epicId} failed: ${outcome.error}`,
          );
        }
        await refreshDraftAfterExpansion();
      } catch (err) {
        // Transport / precondition error -- the persisted state may still
        // be `failed` (the gateway persists pipeline failures); surface the
        // message and present the epic as retryable.
        setExpansionStateById((prev) => ({ ...prev, [epicId]: 'failed' }));
        setExpansionError(
          err instanceof Error ? err.message : 'Epic expansion failed.',
        );
      } finally {
        mutateLiveExpanding((next) => {
          next.delete(epicId);
        });
      }
    },
    [projectId, bookId, refreshDraftAfterExpansion, mutateLiveExpanding],
  );

  /**
   * Epic ids the bulk control would target: `not_expanded`, `failed`, and
   * stale-`expanding` (persisted state with no live request). `expanded`
   * epics are terminal and never re-expanded; the gateway applies the same
   * selection server-side.
   */
  const expandableEpicIds = useMemo(() => {
    return Object.entries(expansionStateById)
      .filter(
        ([epicId, state]) =>
          state === 'not_expanded' ||
          state === 'failed' ||
          (state === 'expanding' && !liveExpandingEpicIds.has(epicId)),
      )
      .map(([epicId]) => epicId);
  }, [expansionStateById, liveExpandingEpicIds]);

  /**
   * "Expand all" targets: every tracked epic EXCEPT a live in-flight one —
   * i.e. `expandableEpicIds` plus the already-`expanded` epics (which are
   * re-expanded, replacing their stories, 2026-07-19).
   */
  const reExpandableEpicIds = useMemo(() => {
    return Object.entries(expansionStateById)
      .filter(
        ([epicId, state]) =>
          state !== undefined &&
          !(state === 'expanding' && liveExpandingEpicIds.has(epicId)),
      )
      .map(([epicId]) => epicId);
  }, [expansionStateById, liveExpandingEpicIds]);

  const anyExpansionInFlight = liveExpandingEpicIds.size > 0;

  const handleExpandAll = useCallback(
    async (includeExpanded: boolean) => {
    const targets = includeExpanded ? reExpandableEpicIds : expandableEpicIds;
    if (targets.length === 0) return;
    setExpansionError(null);
    setExpansionStateById((prev) => {
      const next = { ...prev };
      for (const id of targets) next[id] = 'expanding';
      return next;
    });
    mutateLiveExpanding((next) => {
      for (const id of targets) next.add(id);
    });
    try {
      const outcome = await expandAllMigrationBookOfWorkEpics(
        projectId,
        bookId,
        includeExpanded,
      );
      setExpansionStateById((prev) => {
        const next = { ...prev };
        for (const r of outcome.results) next[r.epicId] = r.expansionState;
        return next;
      });
      const failures = outcome.results.filter(
        (r) => r.expansionState === 'failed',
      );
      if (failures.length > 0) {
        setExpansionError(
          `${failures.length} epic(s) failed to expand and can be retried.`,
        );
      }
      await refreshDraftAfterExpansion();
    } catch (err) {
      // Roll the optimistic `expanding` marks back to retryable.
      setExpansionStateById((prev) => {
        const next = { ...prev };
        for (const id of targets) {
          if (next[id] === 'expanding') next[id] = 'failed';
        }
        return next;
      });
      setExpansionError(
        err instanceof Error ? err.message : 'Expand all epics failed.',
      );
    } finally {
      mutateLiveExpanding((next) => {
        for (const id of targets) next.delete(id);
      });
    }
  }, [
    expandableEpicIds,
    reExpandableEpicIds,
    projectId,
    bookId,
    refreshDraftAfterExpansion,
    mutateLiveExpanding,
  ]);

  // ----- Save-to-backlog flow -----
  const openSaveDialog = useCallback((mode: SaveToBacklogMode) => {
    setDialogMode(mode);
    setDialogOpen(true);
  }, []);

  const confirmSave = useCallback(
    async (opts: {
      includeTraceabilityInDescription: boolean;
      includeReadinessInDescription: boolean;
      tagPrefix: string;
    }): Promise<void> => {
      const selectedItemIds =
        dialogMode === 'selected'
          ? Object.entries(saveStateById)
              .filter(([, s]) => s === 'selected')
              .map(([id]) => id)
          : undefined;
      const excludedItemIds = Object.entries(saveStateById)
        .filter(([, s]) => s === 'excluded')
        .map(([id]) => id);
      const response = await saveMigrationBookOfWorkToBacklog(
        projectId,
        bookId,
        {
          selectedItemIds,
          excludedItemIds: excludedItemIds.length > 0 ? excludedItemIds : undefined,
          saveMode: dialogMode,
          includeTraceabilityInDescription:
            opts.includeTraceabilityInDescription,
          includeReadinessInDescription: opts.includeReadinessInDescription,
          tagPrefix: opts.tagPrefix.length > 0 ? opts.tagPrefix : undefined,
        },
      );
      setSaveResponse(response);
      // Merge the post-save states from the response back into local state
      // and the persisted-snapshot baseline (the AMS write-back persists
      // saveState to book_of_work_json per Q-16).
      const postItems = response.bookOfWork?.items ?? [];
      const nextState: Record<string, MigrationBookOfWorkSaveState> = {
        ...saveStateById,
      };
      for (const i of postItems) {
        if (i.saveState) nextState[i.id] = i.saveState;
      }
      setSaveStateById(nextState);
      setPersistedSaveStateById(nextState);
      // Reflect the updated draft in the workspace shell.
      if (draft) {
        setDraft({
          ...draft,
          status: response.status,
          bookOfWork: response.bookOfWork,
        });
      }
    },
    [projectId, bookId, dialogMode, saveStateById, draft],
  );

  const handleSaveDraft = useCallback(async () => {
    if (!draft) return;
    if (!hasUnsavedChanges) {
      // Nothing to persist -- give explicit feedback rather than a dead click.
      showToast('No unsaved review changes to save.', 'info');
      return;
    }
    // Apply the current frontend saveStateById onto the items blob and
    // PUT the whole `book_of_work_json` back so the deltas are persisted.
    const updatedItems: MigrationBookOfWorkItem[] = items.map((i) => ({
      ...i,
      saveState: saveStateById[i.id] ?? 'draft',
    }));
    // Guard against the "blank Save-Draft wipe": never PUT an empty-items blob.
    // Save-draft only flushes per-item saveState deltas, so with zero items
    // there is nothing legitimate to persist -- and writing `{items: []}` over
    // a populated book would destroy every saveState/workItemId stamp (which
    // previously left spec-generation with no saved stories). The AMS PATCH has
    // a matching server-side backstop; this avoids the round-trip entirely.
    if (updatedItems.length === 0) {
      showToast('Nothing to save: this plan has no items loaded.', 'info');
      return;
    }
    setSaveDraftState('saving');
    const nextBlob = {
      ...(draft.bookOfWork ?? { items: [] }),
      items: updatedItems,
    };
    try {
      const updated = await updateMigrationBookOfWork(projectId, bookId, {
        bookOfWork: nextBlob,
      });
      setDraft(updated);
      setPersistedSaveStateById({ ...saveStateById });
      setSaveDraftState('saved');
      showToast('Draft saved.', 'success');
    } catch (err) {
      setSaveDraftState('error');
      showToast(
        err instanceof Error
          ? `Failed to save draft: ${err.message}`
          : 'Failed to save draft.',
        'error',
      );
    }
  }, [
    draft,
    items,
    saveStateById,
    projectId,
    bookId,
    hasUnsavedChanges,
    showToast,
  ]);

  // ----- Render -----
  if (loading) {
    return (
      <div className={styles.workspace} data-testid="review-workspace-loading">
        Loading draft...
      </div>
    );
  }
  if (error || !draft) {
    return (
      <div className={styles.workspace} data-testid="review-workspace-error">
        {error ?? 'No draft loaded.'}
      </div>
    );
  }

  const selectedItem = selectedItemId
    ? items.find((i) => i.id === selectedItemId) ?? null
    : null;

  const childrenIdx = buildChildrenIndex(items);
  const previewAdmitted = admitForMode(
    items,
    saveStateById,
    dialogMode,
    childrenIdx,
  );
  const previewCounts = countsForAdmitted(previewAdmitted);
  // Non-blocking partial-save warning input (Spec 2026-06-11, 5.6): count
  // admitted epics whose expansion state is anything other than `expanded`.
  // Epics without expansion state (legacy drafts) never warn.
  const unexpandedEpicCount = previewAdmitted.filter(
    (i) =>
      i.type === 'epic' &&
      expansionStateById[i.id] !== undefined &&
      expansionStateById[i.id] !== 'expanded',
  ).length;
  // Expansion controls only apply to editable drafts of the two-phase
  // (skeleton) shape -- i.e. at least one epic carries expansion state.
  const expansionTracked = Object.keys(expansionStateById).length > 0;
  const showExpandControls = expansionTracked && !archived;

  return (
    <div className={styles.workspace} data-testid="review-workspace">
      <div className={styles.workspaceHeader}>
        <div>
          {onBackToPlans && (
            <button
              type="button"
              className={styles.backLink}
              onClick={onBackToPlans}
              data-testid="back-to-plans-button"
            >
              {'\u2190'} Back to plans
            </button>
          )}
          <h1 className={styles.workspaceTitle}>
            {draft.title ?? 'Migration Delivery Plan'}
          </h1>
          <p className={styles.workspaceSubtitle}>
            Status: <code>{draft.status}</code> &middot;{' '}
            Current arch:{' '}
            <span data-testid="review-current-arch">
              {formatArchId(draft.currentArchitectureId)}
            </span>{' '}
            &middot;{' '}
            Target arch:{' '}
            <span data-testid="review-target-arch">
              {formatArchId(draft.targetArchitectureId)}
            </span>
            {findingsCoverage && (
              <span data-testid="review-coverage-summary">
                {' '}
                &middot; Findings addressed:{' '}
                {findingsCoverage.addressedCount} / {findingsCoverage.total}
              </span>
            )}
            {specCounts && (
              <span data-testid="review-spec-summary">
                {' '}
                &middot; Specs: {specCounts.ok} {'✓'} · {specCounts.warn} {'⚠'} ·{' '}
                {specCounts.blocked} {'✕'} · {specCounts.manual} {'✎'}
                {specCounts.stale > 0 && (
                  <> · {specCounts.stale} stale {'↻'}</>
                )}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!archived && (
            <button
              type="button"
              className={styles.selectButton}
              onClick={() => void refreshPreflight()}
              disabled={preflightLoading}
              data-testid="recheck-readiness-button"
              title="Re-run the generator's own input check for every story (no LLM) \u2014 chips update in place"
            >
              {preflightLoading ? 'Checking\u2026' : 'Re-check readiness'}
            </button>
          )}
          {!archived && (
            <button
              type="button"
              className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
              onClick={() => void handleGenerateSpecs()}
              disabled={specBatchInProgress}
              data-testid="generate-specs-saved-button"
              title="Generate implementation specs for every SAVED story not yet generated (batched; chips update as results land)"
            >
              {specBatchInProgress ? 'Generating specs\u2026' : 'Generate specs (saved)'}
            </button>
          )}
          {showExpandControls && (
            <>
              <button
                type="button"
                className={styles.selectButton}
                onClick={() => void handleExpandAll(false)}
                disabled={expandableEpicIds.length === 0 || anyExpansionInFlight}
                data-testid="expand-remaining-epics-button"
                title="Expand only the not-yet-expanded (and failed) epics into detailed stories"
              >
                {anyExpansionInFlight ? 'Expanding\u2026' : 'Expand remaining'}
              </button>
              <button
                type="button"
                className={styles.selectButton}
                onClick={() => void handleExpandAll(true)}
                disabled={reExpandableEpicIds.length === 0 || anyExpansionInFlight}
                data-testid="expand-all-epics-button"
                title="Expand every epic, RE-expanding already-expanded ones (replaces their stories against the current pack)"
              >
                {anyExpansionInFlight ? 'Expanding\u2026' : 'Expand all epics'}
              </button>
            </>
          )}
          {hasUnsavedChanges ? (
            <span
              className={styles.unsavedIndicator}
              data-testid="unsaved-review-changes-indicator"
            >
              Unsaved review changes
            </span>
          ) : (
            saveDraftState === 'saved' && (
              <span
                className={styles.savedIndicator}
                data-testid="draft-saved-indicator"
              >
                {'\u2713'} All changes saved
              </span>
            )
          )}
          <button
            type="button"
            className={styles.selectButton}
            onClick={() => void handleSaveDraft()}
            disabled={archived || saveDraftState === 'saving'}
            title={
              hasUnsavedChanges
                ? 'Persist your review selections to this draft'
                : 'No unsaved review changes'
            }
            data-testid="save-draft-button"
          >
            {saveDraftState === 'saving' ? 'Saving\u2026' : 'Save draft'}
          </button>
        </div>
      </div>

      {expansionError && (
        <div
          className={styles.expansionErrorBanner}
          role="alert"
          data-testid="expansion-error-banner"
        >
          {expansionError}
        </div>
      )}

      {specActionError && (
        <div
          className={styles.expansionErrorBanner}
          role="alert"
          data-testid="spec-action-error-banner"
        >
          {specActionError}
        </div>
      )}

      {saveResponse && (
        <MigrationBookOfWorkPostSaveView
          response={saveResponse}
          onOpenBacklog={onOpenBacklog}
        />
      )}

      {/* Carry-over accounting panel (2026-07-26). REPLACES the old advisory
          findings banner — that one said "doesn't block saving" while the
          server gate refused Stage-2 starts on the SAME items (doublespeak the
          user called out). This panel states the gate's truth ("N items need
          citing or dismissing before Stage 2 (Service) can start"), lists the
          items WITH content, and wires the four accounting actions (cite /
          amend / new story / dismiss). Archived plans are read-only history. */}
      {!archived && (
        <MigrationCarryOverAccountingPanel
          projectId={projectId}
          bookId={bookId}
          stories={carryOverStoryOptions}
          onCoverageChanged={handleCarryOverCoverageChanged}
        />
      )}

      <div
        className={styles.workspaceBody}
        ref={bodyRef}
        data-testid="workspace-body"
      >
        <div className={styles.leftPanel}>
          {/* Action toolbar pinned ABOVE the scrollable hierarchy (point 4)
              so every action stays visible regardless of tree scroll. */}
          <MigrationBookOfWorkSelectionControls
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onSelectSubtree={handleSelectSubtree}
            onExcludeSelected={handleExcludeSelected}
            onIncludeSelected={handleIncludeSelected}
            onSave={openSaveDialog}
            subtreeDisabled={!selectedItemId}
            readOnly={archived}
          />
          <MigrationBookOfWorkFilters value={filters} onChange={setFilters} />
          <MigrationBookOfWorkHierarchyTree
            items={visibleItems}
            selectedItemId={selectedItemId}
            saveStateById={saveStateById}
            onSelectItem={setSelectedItemId}
            onToggleSelect={archived ? undefined : handleToggleSelectItem}
            expansionStateById={expansionStateById}
            liveExpandingEpicIds={liveExpandingEpicIds}
            onExpandEpic={
              showExpandControls
                ? (epicId) => void handleExpandEpic(epicId)
                : undefined
            }
            preflightById={preflightById}
            specStateById={specStateById}
          />
        </div>
        <div
          className={styles.resizeHandle}
          onMouseDown={startRightPanelResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize detail panel"
          data-testid="right-panel-resize-handle"
        />
        <div
          className={styles.rightPanel}
          style={{ width: rightPanelWidth }}
          data-testid="right-panel"
        >
          <MigrationBookOfWorkItemDrawer
            item={selectedItem}
            preflight={
              selectedItem
                ? (preflightRows?.find(
                    (r) => r.bookItemId === selectedItem.id,
                  ) ?? null)
                : null
            }
            spec={
              selectedItem?.type === 'story'
                ? (specRowByWorkItem.get(
                    (selectedItem as { workItemId?: string | null })
                      .workItemId ?? '',
                  ) ?? null)
                : null
            }
            onRegenerateSpec={
              archived ? undefined : (wi, confirm) => handleRegenerateSpec(wi, confirm)
            }
            onSaveSpecEdit={
              archived ? undefined : (specId, text) => handleSaveSpecEdit(specId, text)
            }
            onSetManualReady={
              archived
                ? undefined
                : (specId, ready) => handleSetManualReady(specId, ready)
            }
            onDeleteStory={
              archived || !selectedItem || selectedItem.type !== 'story'
                ? undefined
                : () => setDeleteConfirmItem(selectedItem)
            }
            resolveRef={resolveRef}
            dbMigrationPack={(() => {
              if (!selectedItem) return null;
              const attached = dbMigrationPacks.find(
                (p) => p.work_item_id === selectedItem.id,
              );
              return attached
                ? { packId: attached.id, workItemId: attached.work_item_id }
                : null;
            })()}
            onDownloadDbMigrationPack={(packId) =>
              window.open(
                getDbMigrationPackDownloadUrl(projectId, packId),
                '_blank',
              )
            }
          />
        </div>
      </div>

      {/* Execution rail (Phase 1b) — tier-flexible plane cards. */}
      {!archived && railPlanes.length > 0 && (
        <MigrationExecutionRail
          planes={railPlanes}
          runStatus={run?.status ?? null}
          scopeReady={railScopeReady}
          scopeHint={scopeHint}
          busy={railBusy}
          error={railError}
          pausedBlockers={railBlockers}
          onStart={(plane) =>
            void openStartDialog(
              'start',
              plane,
              railPlanes.findIndex((rp) => rp.plane === plane) + 1,
            )
          }
          onApprove={() => void handleRailApprove(false)}
          onBreakGlass={() => void handleRailApprove(true)}
          onSelectStory={(id) => setSelectedItemId(id)}
          onOpenDelivery={onOpenDelivery}
          dbCredsRegistered={credsStatus ? credsStatus.targetRegistered : null}
          onProvideCreds={() => void openStartDialog('register')}
          onHaltRun={() => void handleRailHalt()}
          onRetryDbBuild={() => void openStartDialog('retry-db', 'db', 1)}
          onResumeFailed={() => void handleRailResumeFailed()}
        />
      )}

      <MigrationBookOfWorkSaveToBacklogDialog
        open={dialogOpen}
        saveMode={dialogMode}
        counts={previewCounts}
        unexpandedEpicCount={unexpandedEpicCount}
        onClose={() => setDialogOpen(false)}
        onConfirm={confirmSave}
      />

      {/* Story-deletion confirm (Phase 1a) — per-story, never bulk. */}
      {deleteConfirmItem && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleteInProgress)
              setDeleteConfirmItem(null);
          }}
          data-testid="delete-story-dialog"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Delete story"
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Delete story?</h2>
            </div>
            <div className={styles.modalBody}>
              <p>
                Delete <strong>{deleteConfirmItem.title}</strong> from this
                plan? Use this only when the plan created something unwanted —
                a story with an unresolved problem should be fixed or given a
                manual spec instead.
              </p>
              <ul className={styles.bulletList}>
                <li>
                  The story is tombstoned: re-expanding its epic will NOT
                  recreate it.
                </li>
                {(deleteConfirmItem as { workItemId?: string | null })
                  .workItemId && (
                  <li>Its saved backlog work item will be archived.</li>
                )}
                <li>
                  Reconciliation scope is unchanged — if this story's surfaces
                  mattered, data parity will say so.
                </li>
              </ul>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.selectButton}
                onClick={() => setDeleteConfirmItem(null)}
                disabled={deleteInProgress}
                data-testid="delete-story-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                onClick={() => void handleDeleteStoryConfirmed()}
                disabled={deleteInProgress}
                data-testid="delete-story-confirm"
              >
                {deleteInProgress ? 'Deleting…' : 'Delete story'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start-stage / provide-credentials dialog (Residual 2). The plan
          DECLARED the target-DB binding — coordinates come prefilled; the
          operator supplies the password only. */}
      {startDialog.open && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget && !dialogBusy)
              setStartDialog({ open: false, mode: 'start' });
          }}
          data-testid="start-stage-dialog"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={
              startDialog.mode === 'start'
                ? 'Start stage'
                : startDialog.mode === 'retry-db'
                  ? 'Retry DB build'
                  : 'Provide target credentials'
            }
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {startDialog.mode === 'start'
                  ? `Start stage ${startDialog.stageNo ?? 1}`
                  : startDialog.mode === 'retry-db'
                    ? 'Retry DB build'
                    : 'Provide credentials'}
              </h2>
            </div>
            <div className={styles.modalBody}>
              {startDialog.mode === 'start' && (
                <p className={styles.coveragePanelNote}>
                  Runs THIS plane end-to-end (build {'→'} verify {'→'}{' '}
                  reconcile). The next stage unlocks when it completes.
                </p>
              )}
              {startDialog.mode === 'start' && (startDialog.stageNo ?? 1) > 1 && (
                <label
                  className={styles.modalHint}
                  style={{ display: 'block', margin: '8px 0' }}
                  data-testid="start-stage-base-mode"
                >
                  <input
                    type="checkbox"
                    checked={startFromMain}
                    onChange={(e) => setStartFromMain(e.target.checked)}
                    data-testid="start-stage-base-mode-checkbox"
                  />{' '}
                  Start from the main branch — use when the previous
                  stage&apos;s changes are already merged. Unticked (default),
                  this stage&apos;s work continues from the previous
                  stage&apos;s branch so its unmerged code is visible to every
                  spec.
                </label>
              )}
              {startDialog.mode === 'retry-db' && (
                <p className={styles.coveragePanelNote}>
                  Re-runs the DB build (assemble {'→'} schema apply {'→'} data
                  load {'→'} reconcile) on this halted run WITHOUT re-running
                  the specs. Confirm both database sections first — the chain
                  reads the source and writes the target.
                </p>
              )}
              {(startDialog.plane ?? 'db') !== 'service' && (
                <>
                  <p data-testid="start-stage-source-db-note">
                    <strong>Source database (the current system):</strong> the
                    data load and parity reconcile READ from it.
                    {credsStatus?.source.registered
                      ? ' Previously registered — confirm and re-enter the password.'
                      : ''}
                  </p>
                  <div className={styles.modalInputRow}>
                    <label htmlFor="src-host">Host</label>
                    <input
                      id="src-host"
                      className={styles.modalInput}
                      value={sourceDbFields.host}
                      onChange={(e) =>
                        setSourceDbFields((f) => ({ ...f, host: e.target.value }))
                      }
                      data-testid="start-stage-source-host"
                    />
                    <label htmlFor="src-port">Port</label>
                    <input
                      id="src-port"
                      className={styles.modalInput}
                      type="number"
                      value={sourceDbFields.port}
                      onChange={(e) =>
                        setSourceDbFields((f) => ({
                          ...f,
                          port: Number(e.target.value),
                        }))
                      }
                      data-testid="start-stage-source-port"
                    />
                    <label htmlFor="src-db">Database</label>
                    <input
                      id="src-db"
                      className={styles.modalInput}
                      value={sourceDbFields.database}
                      onChange={(e) =>
                        setSourceDbFields((f) => ({
                          ...f,
                          database: e.target.value,
                        }))
                      }
                      data-testid="start-stage-source-database"
                    />
                    <label htmlFor="src-user">Username</label>
                    <input
                      id="src-user"
                      className={styles.modalInput}
                      value={sourceDbFields.username}
                      onChange={(e) =>
                        setSourceDbFields((f) => ({
                          ...f,
                          username: e.target.value,
                        }))
                      }
                      data-testid="start-stage-source-username"
                    />
                    <label htmlFor="src-pass">Password</label>
                    <input
                      id="src-pass"
                      className={styles.modalInput}
                      type="password"
                      value={sourceDbPassword}
                      onChange={(e) => setSourceDbPassword(e.target.value)}
                      data-testid="start-stage-source-password"
                    />
                    <span className={styles.modalHint}>
                      Sybase (the source engine). In gateway memory only —
                      never persisted, never logged. Leave the password blank
                      to skip: the data load will halt with a named
                      &quot;source DB credentials are not registered&quot;
                      error until provided.
                    </span>
                  </div>
                  <p data-testid="start-stage-binding-note">
                    <strong>Target database (declared by this plan):</strong>{' '}
                    {credsStatus?.targetBinding
                      ? 'the coordinates below come from the pack — confirm, don’t re-type.'
                      : 'no pack binding found — enter the target coordinates.'}
                  </p>
                  <div className={styles.modalInputRow}>
                    <label htmlFor="tgt-host">Host</label>
                    <input
                      id="tgt-host"
                      className={styles.modalInput}
                      value={targetDbFields.host}
                      onChange={(e) =>
                        setTargetDbFields((f) => ({ ...f, host: e.target.value }))
                      }
                      data-testid="start-stage-host"
                    />
                    <label htmlFor="tgt-port">Port</label>
                    <input
                      id="tgt-port"
                      className={styles.modalInput}
                      type="number"
                      value={targetDbFields.port}
                      onChange={(e) =>
                        setTargetDbFields((f) => ({
                          ...f,
                          port: Number(e.target.value),
                        }))
                      }
                      data-testid="start-stage-port"
                    />
                    <label htmlFor="tgt-db">Database</label>
                    <input
                      id="tgt-db"
                      className={styles.modalInput}
                      value={targetDbFields.database}
                      onChange={(e) =>
                        setTargetDbFields((f) => ({
                          ...f,
                          database: e.target.value,
                        }))
                      }
                      data-testid="start-stage-database"
                    />
                    <label htmlFor="tgt-user">Username</label>
                    <input
                      id="tgt-user"
                      className={styles.modalInput}
                      value={targetDbFields.username}
                      onChange={(e) =>
                        setTargetDbFields((f) => ({
                          ...f,
                          username: e.target.value,
                        }))
                      }
                      data-testid="start-stage-username"
                    />
                    <label htmlFor="tgt-pass">Password</label>
                    <input
                      id="tgt-pass"
                      className={styles.modalInput}
                      type="password"
                      value={targetDbPassword}
                      onChange={(e) => setTargetDbPassword(e.target.value)}
                      data-testid="start-stage-password"
                    />
                    <span className={styles.modalHint}>
                      In memory only, for this run — never persisted, never
                      logged. Leave blank to skip: the data load + parity will
                      skip and the approval gate blocks until provided.
                    </span>
                  </div>
                </>
              )}
              {(startDialog.plane ?? 'db') === 'service' && (
                <>
                  <p data-testid="start-stage-source-api-note">
                    <strong>Source service (the current system API):</strong>{' '}
                    optional — the reconcile replays the pinned baseline
                    against the target; this feeds baseline drift-watching.
                  </p>
                  <div className={styles.modalInputRow}>
                    <label htmlFor="src-api-url">Base URL</label>
                    <input
                      id="src-api-url"
                      className={styles.modalInput}
                      placeholder="http://current-system:8080"
                      value={sourceApiFields.baseUrl}
                      onChange={(e) =>
                        setSourceApiFields((f) => ({ ...f, baseUrl: e.target.value }))
                      }
                      data-testid="start-stage-source-api-url"
                    />
                    {/* Shared auth surface (2026-08-13): the SAME methods as
                        the API Behaviour Baseline Capture wizard — incl. the
                        ssoToken header internal systems require. */}
                    <ApiAuthFields
                      value={sourceApiAuth}
                      onChange={(patch) =>
                        setSourceApiAuth((v) => ({ ...v, ...patch }))
                      }
                      classNames={{
                        fieldGroup: styles.modalInputRow,
                        label: '',
                        input: styles.modalInput,
                        select: styles.modalInput,
                      }}
                      testIdPrefix="start-stage-source-api"
                      selectId="src-api-auth"
                      selectLabel="Auth"
                    />
                  </div>
                  <p data-testid="start-stage-serve-note">
                    <strong>Target service (how to run it):</strong>{' '}
                    {credsStatus?.serviceBinding?.source === 'derived'
                      ? `derived from the target stack (${credsStatus.serviceBinding.runtime_hint ?? 'captured decisions'}) — confirm or adjust.`
                      : 'no runtime could be derived — enter the serve command.'}{' '}
                    Host is 127.0.0.1; the port is assigned automatically and
                    injected via the port env var.
                  </p>
                  <div className={styles.modalInputRow}>
                    <label htmlFor="srv-cmd">Serve command</label>
                    <input
                      id="srv-cmd"
                      className={styles.modalInput}
                      placeholder="mvn spring-boot:run"
                      value={serveFields.command}
                      onChange={(e) =>
                        setServeFields((f) => ({ ...f, command: e.target.value }))
                      }
                      data-testid="start-stage-serve-command"
                    />
                    <label htmlFor="srv-setup">Setup command</label>
                    <input
                      id="srv-setup"
                      className={styles.modalInput}
                      placeholder="npm install (optional — runs once before the serve command)"
                      value={serveFields.setup}
                      onChange={(e) =>
                        setServeFields((f) => ({ ...f, setup: e.target.value }))
                      }
                      data-testid="start-stage-serve-setup"
                    />
                    <label htmlFor="srv-health">Health path</label>
                    <input
                      id="srv-health"
                      className={styles.modalInput}
                      value={serveFields.healthPath}
                      onChange={(e) =>
                        setServeFields((f) => ({ ...f, healthPath: e.target.value }))
                      }
                      data-testid="start-stage-serve-health"
                    />
                    <label htmlFor="srv-port-env">Port env var</label>
                    <input
                      id="srv-port-env"
                      className={styles.modalInput}
                      value={serveFields.portEnv}
                      onChange={(e) =>
                        setServeFields((f) => ({ ...f, portEnv: e.target.value }))
                      }
                      data-testid="start-stage-serve-port-env"
                    />
                    <label htmlFor="srv-timeout">Readiness (s)</label>
                    <input
                      id="srv-timeout"
                      className={styles.modalInput}
                      type="number"
                      value={serveFields.readinessTimeout}
                      onChange={(e) =>
                        setServeFields((f) => ({
                          ...f,
                          readinessTimeout: Number(e.target.value),
                        }))
                      }
                      data-testid="start-stage-serve-timeout"
                    />
                    <label htmlFor="srv-env">Env vars</label>
                    <textarea
                      id="srv-env"
                      className={styles.modalInput}
                      rows={3}
                      placeholder={'SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/haikai_target\nSPRING_DATASOURCE_USERNAME=postgres'}
                      value={serveEnvText}
                      onChange={(e) => setServeEnvText(e.target.value)}
                      data-testid="start-stage-serve-env"
                    />
                    <span className={styles.modalHint}>
                      KEY=VALUE, one per line — the migrated service usually
                      needs its target-DB datasource settings to boot. In
                      gateway memory only. Leave the command blank to skip:
                      the plane will implement + open MRs but will NOT deploy
                      or run the API reconcile.
                    </span>
                  </div>
                </>
              )}
              {dialogError && (
                <div
                  className={styles.modalWarning}
                  role="alert"
                  data-testid="start-stage-error"
                >
                  {dialogError}
                  {dialogBlockReasons && dialogBlockReasons.length > 0 && (
                    <div data-testid="start-stage-block-reasons">
                      {groupBlockReasons(dialogBlockReasons).map((group) => (
                        <div key={group.code}>
                          <strong>
                            {group.title} ({group.messages.length})
                          </strong>
                          {group.remedy && <p>{group.remedy}</p>}
                          <ul>
                            {group.messages.slice(0, 8).map((m, i) => (
                              <li key={`${group.code}-${i}`}>{m}</li>
                            ))}
                            {group.messages.length > 8 && (
                              <li>…and {group.messages.length - 8} more.</li>
                            )}
                          </ul>
                        </div>
                      ))}
                      {showParityBreakGlass && (
                        <div>
                          Recommended: fix parity first. Continuing means this
                          plane&apos;s API reconcile runs under KNOWN data
                          divergence — its breaks will be ambiguous where they
                          touch the divergent data. The override is recorded on
                          the run.
                          <div style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className={styles.selectButton}
                              style={{ borderColor: '#b45309', color: '#b45309' }}
                              disabled={dialogBusy}
                              onClick={() => void confirmStartDialog(true)}
                              data-testid="start-stage-break-glass"
                            >
                              {'⚠'} Break glass: start with unclean parity
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.selectButton}
                onClick={() => setStartDialog({ open: false, mode: 'start' })}
                disabled={dialogBusy}
                data-testid="start-stage-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
                onClick={() => void confirmStartDialog()}
                disabled={dialogBusy}
                data-testid="start-stage-confirm"
              >
                {dialogBusy
                  ? 'Working…'
                  : startDialog.mode === 'start'
                    ? '▶ Start'
                    : startDialog.mode === 'retry-db'
                      ? '↻ Retry DB build'
                      : 'Register credentials'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MigrationBookOfWorkReviewWorkspace;
