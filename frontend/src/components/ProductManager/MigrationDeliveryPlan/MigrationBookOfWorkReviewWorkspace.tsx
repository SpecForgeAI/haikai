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
import { Link } from 'react-router-dom';
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
import MigrationBookOfWorkSelectionControls from './MigrationBookOfWorkSelectionControls';
import MigrationBookOfWorkSaveToBacklogDialog, {
  type SaveToBacklogCounts,
} from './MigrationBookOfWorkSaveToBacklogDialog';
import MigrationBookOfWorkPostSaveView from './MigrationBookOfWorkPostSaveView';
import { computeFindingsCoverage } from '../../../utils/findingsCoverage';
import { buildUnaddressedFindingEntry } from '../../../config/gapWayfindingRegistry';
import { useToast } from '../../../contexts/ToastContext';
import styles from './MigrationBookOfWork.module.css';

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
  onOpenSpecGeneration?: () => void;
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

/**
 * Severity -> badge class for the unaddressed-findings panel (Spec
 * 2026-06-11 Findings Coverage + Gap Wayfinding, Task Group 4.3). Reuses
 * the existing confidence badge palette: critical = red, high = amber,
 * anything else = neutral.
 */
function severityBadgeClass(severity: string): string {
  const s = (severity || '').toLowerCase();
  if (s === 'critical') return styles.badgeConfidenceLow;
  if (s === 'high') return styles.badgeConfidenceMedium;
  return styles.badge;
}

/** Drag-resizable detail-panel width bounds. */
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 760;
const RIGHT_PANEL_DEFAULT_WIDTH = 420;

export const MigrationBookOfWorkReviewWorkspace: React.FC<
  MigrationBookOfWorkReviewWorkspaceProps
> = ({ projectId, bookId, initialDraft, onOpenBacklog, onBackToPlans, onOpenSpecGeneration }) => {
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
  // Findings-coverage detail modal (2026-07-19 UX): the advisory list opens on
  // demand so it never dominates the review screen.
  const [showFindingsDetail, setShowFindingsDetail] = useState<boolean>(false);
  const [saveResponse, setSaveResponse] = useState<SaveToBacklogResponse | null>(
    null,
  );

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

  /** Latest spec row per story WorkItem id (later rows win). */
  const specRowByWorkItem = useMemo(() => {
    const out = new Map<string, SpecGenerationRow>();
    for (const r of specRows ?? []) {
      if (r.workItemId) out.set(r.workItemId, r);
    }
    return out;
  }, [specRows]);

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
      if (row.manualReady) {
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
  }, [specRows, specRowByWorkItem, draft]);

  /** Header rollup: generated / warnings / blocked / manual. */
  const specCounts = useMemo(() => {
    if (!specRows) return null;
    let ok = 0;
    let warn = 0;
    let blocked = 0;
    let manual = 0;
    for (const r of specRowByWorkItem.values()) {
      if (r.manualReady) manual++;
      else if (r.status === 'generated') ok++;
      else if (r.status === 'generated_with_warnings') warn++;
      else if (
        r.status === 'insufficient_context' ||
        r.status === 'failed' ||
        r.status === 'skipped_blocked'
      )
        blocked++;
    }
    return { ok, warn, blocked, manual };
  }, [specRows, specRowByWorkItem]);

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
          {onOpenSpecGeneration && (
            <button
              type="button"
              className={styles.selectButton}
              onClick={onOpenSpecGeneration}
              title="Open the spec-generation workspace to generate implementation-ready specs for the saved stories (you can pick a subset there)"
              data-testid="open-spec-generation-button"
            >
              Generate specs {'\u2192'}
            </button>
          )}
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

      {/* Findings-coverage panel (Spec 2026-06-11, Task Group 4.3).
          Advisory only -- coverage never gates Save Draft, Save to Backlog, or
          expansion. Collapsed to a ONE-LINE summary (2026-07-19 UX); the full
          list opens in a modal so it never dominates the review screen. Hidden
          entirely when the draft has no snapshot. */}
      {findingsCoverage && (
        <section
          className={styles.coveragePanel}
          data-testid="unaddressed-findings-panel"
        >
          {findingsCoverage.total === 0 ? (
            <p
              className={styles.coveragePanelNote}
              data-testid="unaddressed-findings-empty"
            >
              No accepted critical/high findings to cover.
            </p>
          ) : findingsCoverage.notAddressedCount === 0 ? (
            <p
              className={styles.coveragePanelNote}
              data-testid="unaddressed-findings-all-addressed"
            >
              All {findingsCoverage.total} accepted critical/high findings are
              linked to a work item in this plan.
            </p>
          ) : (
            <p
              className={styles.coveragePanelNote}
              data-testid="unaddressed-findings-summary"
            >
              <span aria-hidden="true">{'ⓘ'} </span>
              {findingsCoverage.notAddressedCount} of {findingsCoverage.total}{' '}
              accepted critical/high findings aren{'’'}t linked to a work
              item yet {'—'} advisory, this doesn{'’'}t block saving.{' '}
              <button
                type="button"
                className={styles.coverageInlineLink}
                onClick={() => setShowFindingsDetail(true)}
                data-testid="unaddressed-findings-view-button"
              >
                View findings ({findingsCoverage.notAddressedCount})
              </button>
            </p>
          )}
        </section>
      )}

      {/* Findings-coverage detail modal — the advisory list, on demand. */}
      {findingsCoverage &&
        showFindingsDetail &&
        findingsCoverage.notAddressedCount > 0 && (
          <div
            className={styles.modalOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowFindingsDetail(false);
            }}
            data-testid="unaddressed-findings-dialog"
          >
            <div
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-label="Findings not linked to a work item"
            >
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>
                  Findings not linked to a work item
                </h2>
              </div>
              <div className={styles.modalBody}>
                <p className={styles.coveragePanelNote}>
                  These {findingsCoverage.notAddressedCount} accepted
                  critical/high finding(s) aren{'’'}t referenced by any work
                  item in this plan. Advisory only {'—'} it never blocks
                  saving. To reduce this, bring the relevant tier into scope so
                  the plan generates work that references them, or open a finding
                  below to act on it.
                </p>
                <ul className={styles.coverageList}>
                  {findingsCoverage.unaddressed.map((finding) => {
                    const entry = buildUnaddressedFindingEntry(finding, {
                      projectId,
                      architectureId: draft.currentArchitectureId,
                    });
                    return (
                      <li
                        key={finding.id}
                        className={styles.coverageRow}
                        data-testid={`unaddressed-finding-row-${finding.id}`}
                      >
                        <span
                          className={`${styles.badge} ${severityBadgeClass(finding.severity)}`}
                          data-testid={`unaddressed-finding-severity-${finding.id}`}
                        >
                          {finding.severity || 'unknown'}
                        </span>
                        <span className={styles.coverageRowTitle}>
                          {entry.title}
                        </span>
                        {entry.destination && (
                          <Link
                            to={entry.destination}
                            className={styles.coverageRowLink}
                            data-testid={`unaddressed-finding-link-${finding.id}`}
                          >
                            {entry.actionLabel}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.selectButton}
                  onClick={() => setShowFindingsDetail(false)}
                  data-testid="unaddressed-findings-dialog-close"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
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
    </div>
  );
};

export default MigrationBookOfWorkReviewWorkspace;
