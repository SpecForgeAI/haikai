/**
 * Stakeholder migration progress summary (2026-08-16).
 *
 * The single deterministic aggregation behind the stakeholder progress report
 * screen (`.../migration-books-of-work/:bookId/progress`). Assembles, from
 * ALREADY-PERSISTED data only (no live DB/service access, no credentials, no
 * LLM):
 *
 *   - the 7-stage pipeline banner (discovery -> conversation -> plan ->
 *     execution -> reconciliation) with per-stage status + key facts;
 *   - the DATABASE reconciliation section (current vs target totals, the
 *     worst->best table buckets, views/procs migration counts) from the
 *     persisted load report (`data_migration_reports`), parity report
 *     (`data_parity_reports`) and the DB migration pack;
 *   - the SERVICE (API) reconciliation section (interfaces/endpoints totals,
 *     failed-to-migrate / failed-reconciliation / fully-reconciled endpoint
 *     buckets, the per-operation break rollup) from the run items, the break
 *     store and the pinned baseline.
 *
 * EXTERNAL-ONLY service counts (shakedown fix, 2026-08-16): interfaces typed
 * INTERNAL_PROCESSING / INTERNAL_PROCESS (batch classes, schedulers,
 * listeners — never HTTP-exercisable; the same set the capture harness and
 * the AMS inventory reconciliation exclude) are OUT of every service-section
 * total and bucket, together with their endpoints. Stakeholders count the
 * externally-reachable API surface, mirroring the Live-behaviour cell.
 *
 * DISCOVERY stage truth (shakedown fix, 2026-08-16): stage completion +
 * findings counts read the per-kind discovery runs LIST (authoritative),
 * not the discovery-context roll-up — the context caps its run highlights
 * to the most recent runs, so a completed code run silently vanished from
 * the banner once a later DB run pushed it out.
 *
 * FAIL-SOFT EVERYWHERE: a missing report / unreadable read nulls that block
 * (the frontend renders grey `[TBC - execute migration plan]` cells) and
 * appends a warning — it never throws the whole report away. Sections render
 * only for planes in the book's scope (plane composition via
 * {@link planeForItem}); there is no UI-plane reconciliation in v1.
 *
 * All reads are injected ({@link ProgressSummaryDeps}) so the aggregation is
 * unit-testable with mocks, mirroring the RunParityStatusDeps pattern.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  BookOfWork,
  BookOfWorkItem,
  ApiBehaviourBaseline,
  ApiBehaviourBaselineItemWire,
  SpecGeneration,
  fetchActiveCurrentBaseline,
  fetchBaselineItems,
  fetchBookOfWork,
  fetchSpecGenerationsForBook,
} from './migrationDriverAmsReads';
import {
  MigrationExecutionRun,
  MigrationExecutionRunItem,
  RUN_STATUS,
  getMigrationExecutionRunsForBook,
} from './migrationExecutionRunClient';
import { MigrationPlane, planeForItem } from './migrationExecutionDriver';
import { isManualExecutionItem } from './migrationExecutionClass';
import {
  MigrationDiscoveryContext,
  fetchMigrationDiscoveryContext,
} from './migrationDiscoveryContextClient';
import { fetchLatestCapturedDecisions } from './targetStateCapturedDecisionsClient';
import { architectureDecisionValues } from './migrationTargetStackSpecSection';
import {
  FetchPackViewFn,
  PackView,
  defaultFetchPackView,
  orderedTables,
} from './migrationDbPackPlanner';
import {
  BREAK_DISPOSITION,
  MigrationReconciliationBreak,
  getReconciliationBreaksForRun,
} from './migrationReconciliationBreakClient';

// ============================================================================
// Output types (camelCase — a gateway-built response, not an AMS proxy)
// ============================================================================

/** `failed` renders like `not_started` (error X, very light red) but keeps the honest word. */
export type ProgressStageStatus = 'complete' | 'in_progress' | 'not_started' | 'failed';

export interface ProgressStage {
  key:
    | 'db_discovery'
    | 'code_discovery'
    | 'live_behaviour'
    | 'target_conversation'
    | 'plan_created'
    | 'plan_executed'
    | 'reconciliation';
  label: string;
  status: ProgressStageStatus;
  /** Up to two short fact lines, already worded for the cell. */
  facts: string[];
}

export interface DbSectionTotals {
  tables: number | null;
  rows: number | null;
  views: number | null;
  procs: number | null;
}

export interface DbSection {
  /** Foundations Spec 4 (2026-08-22): the EXPLICIT excluded-from-
   *  reconciliation slice — excluded tables count in neither numerator nor
   *  denominator, but are never silently absent. Null when the pack has no
   *  receipt (pre-foundations packs). */
  scope_receipt?: {
    excluded_count: number;
    volatile_count: number;
    note: string;
  } | null;
  current: DbSectionTotals;
  /** Null until execution produced reports — the frontend renders TBC. */
  target: DbSectionTotals | null;
  /** Worst -> best; sums to `current.tables` when both are present. */
  buckets: {
    failedToLoad: number;
    rowCountMismatch: number;
    dataMismatch: number;
    fullyReconciled: number;
  } | null;
  /**
   * MIGRATED counts (2026-08-16, positive phrasing — the earlier
   * not-migrated fields were a confusing double negative): views/procs with
   * an approved `translate` translation, out of `current.views`/`current.procs`.
   */
  viewsMigrated: number | null;
  procsMigrated: number | null;
}

export interface ServiceSectionTotals {
  interfaces: number | null;
  endpoints: number | null;
}

export interface ServiceSection {
  current: ServiceSectionTotals;
  /** Null until the service plane deployed — the frontend renders TBC. */
  target: ServiceSectionTotals | null;
  /** Worst -> best; sums to `current.endpoints` when both are present. */
  buckets: {
    failedToMigrate: number;
    failedReconciliation: number;
    fullyReconciled: number;
  } | null;
  perOperation: {
    replayed: number;
    matching: number;
    underInvestigation: number;
    accepted: number;
    fixed: number;
  } | null;
}

export interface MigrationProgressSummary {
  productName: string | null;
  currentStateLabel: string | null;
  targetStateLabel: string | null;
  scope: { db: boolean; service: boolean };
  /** True once every in-scope plane's latest run is deployed. */
  executed: boolean;
  stages: ProgressStage[];
  db: DbSection | null;
  service: ServiceSection | null;
  warnings: string[];
}

// ============================================================================
// AMS wire shapes
// ============================================================================

export interface LatestDataMigrationReport {
  status?: string | null;
  created_at?: string | null;
  migration_pair?: string | null;
  tables_total?: number | null;
  tables_loaded?: number | null;
  tables_mismatched?: number | null;
  tables_unverifiable?: number | null;
  rows_loaded?: number | null;
  report_json?: {
    tables?: Array<{
      schema?: string | null;
      table?: string;
      status?: string;
      sourceCount?: number | null;
      loadedCount?: number | null;
      targetCount?: number | null;
      reason?: string | null;
    }>;
    summary?: { rows_loaded?: number | null; tables?: number | null };
  } | null;
}

export interface LatestDataParityReportRow {
  status?: string | null;
  created_at?: string | null;
  migration_pair?: string | null;
  report_json?: {
    tables?: Array<{
      schema?: string | null;
      table?: string;
      verdict?: string;
      divergence_class?: string | null;
      source_count?: number | null;
      target_count?: number | null;
    }>;
  } | null;
}

/** One discovery run row (AMS `GET .../discovery/runs`, snake_case). */
export interface DiscoveryRunRow {
  id?: string;
  status?: string | null;
  discovery_kind?: string | null;
}

/**
 * The internal-aware service inventory of ONE architecture (from the AMS
 * full-model read). "External" excludes every interface typed
 * INTERNAL_PROCESSING / INTERNAL_PROCESS — byte-identical to the AMS
 * inventory-reconciliation + capture-scope exclusion set — and the endpoints
 * those interfaces own.
 */
export interface ServiceInventory {
  interfacesTotal: number;
  externalInterfaces: number;
  endpointsTotal: number;
  /** External endpoint ids (the service-section denominator). */
  externalEndpointIds: Set<string>;
  /** Normalised `"METHOD /path"` -> external endpoint id (break attribution). */
  endpointIdByKey: Map<string, string>;
}

/** Both spellings tolerated — mirrors the AMS INTERNAL_INTERFACE_TYPES set. */
const INTERNAL_INTERFACE_TYPES = new Set(['INTERNAL_PROCESSING', 'INTERNAL_PROCESS']);

// ============================================================================
// Deps (DI seam)
// ============================================================================

export interface ProgressSummaryDeps {
  fetchBookOfWork: typeof fetchBookOfWork;
  fetchSpecGenerationsForBook: typeof fetchSpecGenerationsForBook;
  getRunsForBook: typeof getMigrationExecutionRunsForBook;
  fetchDiscoveryContext(
    projectId: string,
    currentArchitectureId: string,
    targetArchitectureId: string | null,
  ): Promise<MigrationDiscoveryContext | null>;
  /** The authoritative per-kind discovery run list (banner stage truth). */
  listDiscoveryRuns(projectId: string, architectureId: string): Promise<DiscoveryRunRow[]>;
  /** Findings total for ONE run (page=0&size=1 read of the search total). */
  countFindingsForRun(
    projectId: string,
    architectureId: string,
    runId: string,
  ): Promise<number | null>;
  /**
   * SAVED architecture candidates for ONE run (2026-08-16): distinct
   * candidates with a save-back candidate->entity mapping, FALLING BACK to
   * the run's `status=committed` candidate count (the save-back's other
   * footprint — older saves wrote no provenance mappings). The banner's
   * "architecture items" fact: actually-saved, not merely approved.
   */
  countSavedCandidatesForRun(
    projectId: string,
    architectureId: string,
    runId: string,
  ): Promise<number | null>;
  fetchActiveCurrentBaseline: typeof fetchActiveCurrentBaseline;
  fetchBaselineItems: typeof fetchBaselineItems;
  fetchLatestCapturedDecisions: typeof fetchLatestCapturedDecisions;
  fetchPackView: FetchPackViewFn;
  fetchLatestDataMigrationReport(
    projectId: string,
    architectureId: string,
  ): Promise<LatestDataMigrationReport | null>;
  fetchLatestDataParityReport(
    projectId: string,
    architectureId: string,
  ): Promise<LatestDataParityReportRow | null>;
  getBreaksForRun: typeof getReconciliationBreaksForRun;
  fetchServiceInventory(
    projectId: string,
    architectureId: string,
  ): Promise<ServiceInventory | null>;
}

async function amsLatestOrNull<T>(url: string, label: string): Promise<T | null> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${label} read failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function defaultProgressSummaryDeps(): ProgressSummaryDeps {
  const amsBase = () => getConfig().architectureModelServiceBaseUrl;
  return {
    fetchBookOfWork,
    fetchSpecGenerationsForBook,
    getRunsForBook: getMigrationExecutionRunsForBook,
    async fetchDiscoveryContext(projectId, currentArchitectureId, targetArchitectureId) {
      try {
        return await fetchMigrationDiscoveryContext(projectId, {
          currentArchitectureId,
          targetArchitectureId,
          // The banner needs roll-ups only — cap the heavy highlight lists.
          includeEvidence: false,
          maxFindings: 1,
          maxEvidenceItems: 1,
        });
      } catch (error) {
        logger.warn('[diag-gateway] migration_progress discovery_context_failed', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    async listDiscoveryRuns(projectId, architectureId) {
      const url =
        `${amsBase()}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/discovery/runs`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`discovery runs read failed: HTTP ${response.status}`);
      }
      const rows = (await response.json()) as DiscoveryRunRow[];
      return Array.isArray(rows) ? rows : [];
    },
    async countFindingsForRun(projectId, architectureId, runId) {
      const url =
        `${amsBase()}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}` +
        `/discovery/runs/${encodeURIComponent(runId)}/findings?page=0&size=1`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      const body = (await response.json()) as { total?: number };
      return typeof body.total === 'number' ? body.total : null;
    },
    async countSavedCandidatesForRun(projectId, architectureId, runId) {
      const runBase =
        `${amsBase()}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}` +
        `/discovery/runs/${encodeURIComponent(runId)}`;
      // Footprint 1: save-back provenance mappings (candidate -> entity).
      const response = await fetch(`${runBase}/candidate-entity-mappings`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const rows = (await response.json()) as Array<{ candidate_id?: string | null }>;
      if (!Array.isArray(rows)) return null;
      // Distinct CANDIDATES saved (a candidate may map to several entities —
      // create + link rows); rows without a candidate id count individually.
      const distinct = new Set<string>();
      let anonymous = 0;
      for (const row of rows) {
        if (row.candidate_id) distinct.add(row.candidate_id);
        else anonymous += 1;
      }
      const fromMappings = distinct.size + anonymous;
      if (fromMappings > 0) return fromMappings;
      // Footprint 2 (shakedown 2026-08-16, live data had NO mapping rows):
      // the save-back also transitions each saved candidate's `status` to
      // 'committed' — count those. Older saves that never wrote provenance
      // mappings still carry this transition.
      const committed = await fetch(`${runBase}/candidates?status=committed`, {
        headers: { Accept: 'application/json' },
      });
      if (!committed.ok) return fromMappings;
      const committedRows = (await committed.json()) as unknown[];
      return Array.isArray(committedRows) ? committedRows.length : fromMappings;
    },
    fetchActiveCurrentBaseline,
    fetchBaselineItems,
    fetchLatestCapturedDecisions,
    fetchPackView: defaultFetchPackView,
    async fetchLatestDataMigrationReport(projectId, architectureId) {
      const url =
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/data-migration-reports/latest`;
      return amsLatestOrNull<LatestDataMigrationReport>(url, 'latest data-migration report');
    },
    async fetchLatestDataParityReport(projectId, architectureId) {
      const url =
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/data-parity-reports/latest`;
      return amsLatestOrNull<LatestDataParityReportRow>(url, 'latest data-parity report');
    },
    getBreaksForRun: getReconciliationBreaksForRun,
    async fetchServiceInventory(projectId, architectureId) {
      const url =
        `${amsBase()}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`model read failed: HTTP ${response.status}`);
      }
      const model = (await response.json()) as {
        metaModel?: {
          entities?: {
            interfaces?: Array<{ id?: string; interface_type?: string | null }>;
            endpoints?: Array<{
              id?: string;
              interface_id?: string | null;
              operation_verb?: string | null;
              path_or_address?: string | null;
            }>;
          };
        };
      };
      const interfaces = model.metaModel?.entities?.interfaces ?? [];
      const endpoints = model.metaModel?.entities?.endpoints ?? [];
      const internalInterfaceIds = new Set<string>();
      let externalInterfaces = 0;
      for (const iface of interfaces) {
        const type = (iface.interface_type ?? '').trim().toUpperCase();
        if (INTERNAL_INTERFACE_TYPES.has(type)) {
          if (iface.id) internalInterfaceIds.add(iface.id);
        } else {
          externalInterfaces += 1;
        }
      }
      const externalEndpointIds = new Set<string>();
      const endpointIdByKey = new Map<string, string>();
      for (const ep of endpoints) {
        if (!ep.id) continue;
        if (ep.interface_id && internalInterfaceIds.has(ep.interface_id)) continue;
        externalEndpointIds.add(ep.id);
        const verb = (ep.operation_verb ?? '').toUpperCase();
        const path = ep.path_or_address ?? '';
        if (verb && path) endpointIdByKey.set(`${verb} ${path}`, ep.id);
      }
      return {
        interfacesTotal: interfaces.length,
        externalInterfaces,
        endpointsTotal: endpoints.length,
        externalEndpointIds,
        endpointIdByKey,
      };
    },
  };
}

// ============================================================================
// Small helpers
// ============================================================================

/** Book items may carry `apiEndpointIds` as a carriage extra key. */
type ProgressBookItem = BookOfWorkItem & { apiEndpointIds?: string[] | null };

const SPEC_READY_STATUSES = new Set(['generated', 'generated_with_warnings']);

/** Break dispositions a stakeholder reads as RESOLVED (not "under investigation"). */
const RESOLVED_BREAK_DISPOSITIONS = new Set<string>([
  BREAK_DISPOSITION.FIXED_CONFIRMED,
  BREAK_DISPOSITION.ACCEPTED,
  BREAK_DISPOSITION.WONT_REPORT,
  BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
  BREAK_DISPOSITION.EXPECTED_NET_NEW,
  BREAK_DISPOSITION.EXPECTED_VOLATILE,
]);

const ACCEPTED_BREAK_DISPOSITIONS = new Set<string>([
  BREAK_DISPOSITION.ACCEPTED,
  BREAK_DISPOSITION.WONT_REPORT,
  BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
  BREAK_DISPOSITION.EXPECTED_NET_NEW,
  BREAK_DISPOSITION.EXPECTED_VOLATILE,
]);

function tableKey(schema: string | null | undefined, table: string | undefined): string | null {
  if (!table) return null;
  return `${(schema ?? '').toLowerCase()}.${table.toLowerCase()}`;
}

/** "sybase" -> "Sybase", "postgresql" -> "PostgreSQL" (display only). */
function prettyEngine(raw: string): string {
  const lowered = raw.toLowerCase();
  if (lowered.startsWith('postgres')) return 'PostgreSQL';
  if (lowered === 'mssql' || lowered === 'sqlserver') return 'SQL Server';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Latest spec-generation row per work item (highest attempt, then created_at). */
function latestSpecGenByWorkItem(rows: SpecGeneration[]): Map<string, SpecGeneration> {
  const latest = new Map<string, SpecGeneration>();
  for (const row of rows) {
    const key = row.work_item_id ?? '';
    if (!key) continue;
    const existing = latest.get(key);
    if (!existing) {
      latest.set(key, row);
      continue;
    }
    const a = existing.generation_attempt_number ?? 0;
    const b = row.generation_attempt_number ?? 0;
    if (b > a || (b === a && (row.created_at ?? '') > (existing.created_at ?? ''))) {
      latest.set(key, row);
    }
  }
  return latest;
}

function isSpecReady(row: SpecGeneration | undefined): boolean {
  if (!row) return false;
  if (row.stale === true || (row.stale_reason ?? '') !== '') return false;
  if (row.manual_ready === true) return true;
  return SPEC_READY_STATUSES.has(row.status ?? '');
}

/**
 * Newest-first latest run item per work item across ALL runs (retries and
 * plane-scoped runs collapse to each story's most recent outcome).
 */
function latestRunItemByWorkItem(
  runs: MigrationExecutionRun[],
): Map<string, MigrationExecutionRunItem> {
  const latest = new Map<string, MigrationExecutionRunItem>();
  for (const run of runs) {
    for (const item of run.items ?? []) {
      const key = item.work_item_id ?? '';
      if (!key || latest.has(key)) continue;
      latest.set(key, item);
    }
  }
  return latest;
}

// ============================================================================
// The aggregation
// ============================================================================

export async function computeMigrationProgressSummary(
  args: { projectId: string; architectureId: string; bookId: string },
  deps: ProgressSummaryDeps = defaultProgressSummaryDeps(),
): Promise<MigrationProgressSummary> {
  const { projectId, architectureId, bookId } = args;
  const warnings: string[] = [];
  const soft = async <T>(label: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (error) {
      warnings.push(`${label} could not be read (${error instanceof Error ? error.message : String(error)}).`);
      return null;
    }
  };

  // --- Book of work: scope + stories + target architecture id. -------------
  const book: BookOfWork | null = await soft('Book of work', () =>
    deps.fetchBookOfWork(projectId, bookId),
  );
  const items: ProgressBookItem[] = (book?.book_of_work_json?.items ?? []) as ProgressBookItem[];
  const stories = items.filter((i) => (i.type ?? '').toLowerCase() === 'story');
  const planeOf = new Map<ProgressBookItem, MigrationPlane>();
  for (const story of stories) planeOf.set(story, planeForItem(story));

  const dbStories = stories.filter((s) => planeOf.get(s) === 'db');
  const serviceStories = stories.filter((s) => planeOf.get(s) === 'service');
  const targetArchitectureId = book?.target_architecture_id ?? null;

  const scope = {
    db: dbStories.length > 0,
    service: serviceStories.length > 0,
  };
  if (stories.length === 0) {
    // Pre-plan there is nothing to scope on — show everything rather than a
    // blank page, and say why.
    scope.db = true;
    scope.service = true;
    warnings.push('The book of work has no stories yet — showing both planes by default.');
  }

  // --- Shared reads (all fail-soft). ---------------------------------------
  const [context, discoveryRuns, decisions, baseline, runsRead, packView] = await Promise.all([
    deps.fetchDiscoveryContext(projectId, architectureId, targetArchitectureId),
    soft('Discovery runs', () => deps.listDiscoveryRuns(projectId, architectureId)),
    targetArchitectureId
      ? soft('Captured decisions', () =>
          deps.fetchLatestCapturedDecisions(projectId, targetArchitectureId),
        )
      : Promise.resolve(null),
    soft('Current baseline', () => deps.fetchActiveCurrentBaseline(projectId, architectureId)),
    soft('Execution runs', () => deps.getRunsForBook(projectId, bookId)),
    scope.db ? soft('DB migration pack', () => deps.fetchPackView(projectId, architectureId)) : Promise.resolve(null),
  ]);
  const runs: MigrationExecutionRun[] = runsRead ?? [];

  const baselineItems: ApiBehaviourBaselineItemWire[] = baseline?.id
    ? (await soft('Baseline items', () => deps.fetchBaselineItems(projectId, baseline.id as string))) ?? []
    : [];

  const [loadReport, parityReport] = scope.db
    ? await Promise.all([
        soft('Data-migration (load) report', () =>
          deps.fetchLatestDataMigrationReport(projectId, architectureId),
        ),
        soft('Data-parity report', () =>
          deps.fetchLatestDataParityReport(projectId, architectureId),
        ),
      ])
    : [null, null];

  const currentInventory = scope.service
    ? await soft('Current service inventory', () =>
        deps.fetchServiceInventory(projectId, architectureId),
      )
    : null;

  // --- Run rollups shared by stages + service section. ---------------------
  const latestItemByStory = latestRunItemByWorkItem(runs);
  const dispatchableStories = stories.filter(
    (s) => !isManualExecutionItem(s) && !!s.workItemId,
  );
  const planeOfWorkItemId = new Map<string, MigrationPlane>();
  for (const story of dispatchableStories) {
    planeOfWorkItemId.set(story.workItemId as string, planeOf.get(story) ?? 'service');
  }

  const inScopePlanes: MigrationPlane[] = [
    ...(scope.db ? (['db'] as const) : []),
    ...(scope.service ? (['service'] as const) : []),
  ];
  /** Newest run touching >=1 story of the plane (the driver's per-plane latest). */
  const latestRunForPlane = (plane: MigrationPlane): MigrationExecutionRun | null => {
    for (const run of runs) {
      const touches = (run.items ?? []).some(
        (item) => planeOfWorkItemId.get(item.work_item_id ?? '') === plane,
      );
      if (touches) return run;
    }
    return runs[0] ?? null;
  };
  const planeDeployed = (plane: MigrationPlane): boolean =>
    latestRunForPlane(plane)?.status === RUN_STATUS.DEPLOYED;
  const executed = inScopePlanes.length > 0 && inScopePlanes.every(planeDeployed);

  // --- DB section. ----------------------------------------------------------
  let db: DbSection | null = null;
  if (scope.db) {
    db = buildDbSection(packView, loadReport, parityReport, warnings);
  }

  // --- Service section. -----------------------------------------------------
  let service: ServiceSection | null = null;
  let serviceBreaks: MigrationReconciliationBreak[] = [];
  if (scope.service) {
    // Breaks live on the run that reconciled — newest run that has any.
    for (const run of runs) {
      if (!run.id) continue;
      const breaks = (await soft('Reconciliation breaks', () =>
        deps.getBreaksForRun(projectId, run.id as string),
      )) ?? [];
      if (breaks.length > 0) {
        serviceBreaks = breaks;
        break;
      }
    }
    const targetInventory =
      planeDeployed('service') && targetArchitectureId
        ? await soft('Target service inventory', () =>
            deps.fetchServiceInventory(projectId, targetArchitectureId),
          )
        : null;
    service = buildServiceSection({
      serviceStories,
      latestItemByStory,
      breaks: serviceBreaks,
      baselineItems,
      currentInventory,
      targetInventory,
      serviceDeployed: planeDeployed('service'),
      warnings,
    });
  }

  // --- Discovery facts per kind: findings from the LATEST completed run;
  // "architecture items" (SAVED candidates) from the newest completed run
  // that actually HAS save-back mappings. The two can differ: a fresh
  // re-scan completes with zero saved candidates until the operator saves
  // it — binding both counts to that run showed a false 0 on live data
  // while an older run held the real saved set (shakedown 2026-08-16).
  const discoveryFactsForKind = async (
    kinds: string[],
    kindLabel: string,
  ): Promise<{ findings: number | null; savedItems: number | null }> => {
    if (!discoveryRuns) return { findings: null, savedItems: null };
    // The AMS list is newest-first.
    const completed = discoveryRuns.filter(
      (r) =>
        kinds.includes((r.discovery_kind ?? 'code').toLowerCase()) &&
        (r.status ?? '').toUpperCase() === 'COMPLETED' &&
        !!r.id,
    );
    if (completed.length === 0) return { findings: null, savedItems: null };
    const findingsPromise = soft('Discovery findings count', () =>
      deps.countFindingsForRun(projectId, architectureId, completed[0].id as string),
    );
    let savedItems: number | null = null;
    for (const run of completed) {
      const count = await soft('Saved candidate count', () =>
        deps.countSavedCandidatesForRun(projectId, architectureId, run.id as string),
      );
      if (count !== null) {
        savedItems = savedItems ?? 0;
        if (count > 0) {
          savedItems = count;
          break;
        }
      }
    }
    if (savedItems === 0) {
      // A true zero is self-explaining on screen, never a silent puzzle.
      warnings.push(
        `${kindLabel}: no SAVED architecture candidates on any of the ${completed.length} completed run(s) — approve + save a run's candidates to populate its architecture items.`,
      );
    }
    return { findings: await findingsPromise, savedItems };
  };
  const dbDiscoveryFacts = scope.db
    ? await discoveryFactsForKind(['database', 'combined'], 'DB discovery')
    : { findings: null, savedItems: null };
  const codeDiscoveryFacts = scope.service
    ? await discoveryFactsForKind(['code', 'combined'], 'Code/logs discovery')
    : { findings: null, savedItems: null };

  // --- Stages. --------------------------------------------------------------
  const stages = buildStages({
    scope,
    context,
    discoveryRuns,
    dbDiscoveryFacts,
    codeDiscoveryFacts,
    baseline,
    baselineItems,
    decisionsCount: decisions?.length ?? 0,
    dbStoryCount: dbStories.filter((s) => !isManualExecutionItem(s)).length,
    serviceStoryCount: serviceStories.filter((s) => !isManualExecutionItem(s)).length,
    specGens: (await soft('Spec generations', () =>
      deps.fetchSpecGenerationsForBook(projectId, bookId),
    )) ?? [],
    dispatchableStories,
    latestItemByStory,
    runs,
    executed,
    db,
    service,
    breakCount: serviceBreaks.length,
    unresolvedBreakCount: serviceBreaks.filter(
      (b) => !RESOLVED_BREAK_DISPOSITIONS.has(b.disposition_status ?? BREAK_DISPOSITION.OPEN),
    ).length,
  });

  // --- Labels. --------------------------------------------------------------
  const engines = context?.databaseDiscoverySummary?.sourceEngines ?? [];
  const currentStateLabel = engines.length > 0 ? engines.map(prettyEngine).join(' / ') : null;
  let targetStateLabel: string | null = null;
  if (decisions && decisions.length > 0) {
    const values = architectureDecisionValues(decisions);
    const parts = [
      scope.db ? values.get('db.engine') : null,
      scope.service ? values.get('service.runtime') ?? values.get('service.language') : null,
    ].filter((v): v is string => !!v && v.length > 0);
    targetStateLabel = parts.length > 0 ? parts.join(' / ') : null;
  }

  logger.info('[diag-gateway] migration_progress summary_computed', {
    projectId,
    bookId,
    scope,
    executed,
    stages: stages.map((s) => `${s.key}=${s.status}`).join(','),
    warnings: warnings.length,
  });

  return {
    productName: null, // the frontend renders its own project display name
    currentStateLabel,
    targetStateLabel,
    scope,
    executed,
    stages,
    db,
    service,
    warnings,
  };
}

// ============================================================================
// DB section
// ============================================================================

function buildDbSection(
  packView: PackView | null,
  loadReport: LatestDataMigrationReport | null,
  parityReport: LatestDataParityReportRow | null,
  warnings: string[],
): DbSection {
  const loadTables = loadReport?.report_json?.tables ?? [];
  const parityTables = parityReport?.report_json?.tables ?? [];

  const capturedViews =
    packView?.manifest?.structural_accounting?.code_objects_captured?.view ?? null;
  const capturedProcs =
    packView?.manifest?.structural_accounting?.code_objects_captured?.stored_procedure ?? null;
  const packTableCount = packView ? orderedTables(packView.manifest).length : null;

  const sourceRowTotal = loadTables.reduce<number | null>((sum, t) => {
    if (typeof t.sourceCount !== 'number') return sum;
    return (sum ?? 0) + t.sourceCount;
  }, null);

  const current: DbSectionTotals = {
    tables: loadReport?.tables_total ?? (packTableCount && packTableCount > 0 ? packTableCount : null),
    // Row counts only enter the system via the load report — TBC before it.
    rows: sourceRowTotal,
    views: capturedViews,
    procs: capturedProcs,
  };

  const receipt = packView?.manifest?.scope_receipt ?? null;
  const scopeReceipt = receipt
    ? {
        excluded_count: receipt.excluded.length,
        volatile_count: receipt.volatile.length,
        note:
          `${receipt.excluded.length} excluded / ${receipt.volatile.length} volatile table(s) ` +
          'are OUT of migration + reconciliation by foundation decision ' +
          `(${[...receipt.excluded, ...receipt.volatile]
            .map((e) => e.decision_ref)
            .filter((r, i, all) => r && all.indexOf(r) === i)
            .join(', ') || 'no refs'})`,
      }
    : null;

  const anyReport = !!loadReport || !!parityReport;
  if (!anyReport) {
    return {
      scope_receipt: scopeReceipt,
      current,
      target: null,
      buckets: null,
      viewsMigrated: null,
      procsMigrated: null,
    };
  }

  // Approved translations = the migrated views/procs on the target side.
  const approved = (packView?.translations ?? []).filter(
    (t) => t.disposition === 'translate' && t.review_status === 'approved',
  );
  const migratedViews = packView ? approved.filter((t) => t.kind === 'view').length : null;
  const migratedProcs = packView
    ? approved.filter((t) => t.kind === 'stored_procedure').length
    : null;

  const targetTablesFromParity = parityTables.filter(
    (t) => typeof t.target_count === 'number',
  ).length;
  const targetTablesFromLoad = loadTables.filter((t) => typeof t.targetCount === 'number').length;
  const target: DbSectionTotals = {
    tables: parityTables.length > 0 ? targetTablesFromParity : targetTablesFromLoad || null,
    rows:
      loadReport?.rows_loaded ??
      loadReport?.report_json?.summary?.rows_loaded ??
      loadTables.reduce<number | null>((sum, t) => {
        if (typeof t.loadedCount !== 'number') return sum;
        return (sum ?? 0) + t.loadedCount;
      }, null),
    views: migratedViews,
    procs: migratedProcs,
  };

  // Bucket every current-state table into exactly ONE bucket, worst-first.
  const parityByKey = new Map<string, { verdict?: string; divergence_class?: string | null }>();
  for (const t of parityTables) {
    const key = tableKey(t.schema, t.table);
    if (key) parityByKey.set(key, t);
  }
  const inventory = loadTables.length > 0 ? loadTables : parityTables.map((t) => ({
    schema: t.schema,
    table: t.table,
    status: undefined as string | undefined,
  }));
  let failedToLoad = 0;
  let rowCountMismatch = 0;
  let dataMismatch = 0;
  let fullyReconciled = 0;
  for (const t of inventory) {
    const key = tableKey(t.schema, t.table);
    const parity = key ? parityByKey.get(key) : undefined;
    if (t.status === 'unverifiable') {
      failedToLoad += 1;
    } else if (
      t.status === 'reconciled_mismatch' ||
      parity?.divergence_class === 'count_mismatch'
    ) {
      rowCountMismatch += 1;
    } else if (parity?.verdict === 'divergent' || parity?.verdict === 'unverifiable') {
      // A parity-unverifiable table is NOT reconciled — count it as a data
      // mismatch rather than silently promoting it to fully-reconciled.
      dataMismatch += 1;
    } else {
      fullyReconciled += 1;
    }
  }
  const buckets = { failedToLoad, rowCountMismatch, dataMismatch, fullyReconciled };
  if (current.tables !== null && inventory.length !== current.tables) {
    warnings.push(
      `DB buckets cover ${inventory.length} report tables against ${current.tables} current-state tables.`,
    );
  }

  return {
    scope_receipt: scopeReceipt,
    current,
    target,
    buckets,
    viewsMigrated: migratedViews,
    procsMigrated: migratedProcs,
  };
}

// ============================================================================
// Service section
// ============================================================================

function buildServiceSection(args: {
  serviceStories: ProgressBookItem[];
  latestItemByStory: Map<string, MigrationExecutionRunItem>;
  breaks: MigrationReconciliationBreak[];
  baselineItems: ApiBehaviourBaselineItemWire[];
  currentInventory: ServiceInventory | null;
  targetInventory: ServiceInventory | null;
  serviceDeployed: boolean;
  warnings: string[];
}): ServiceSection {
  const {
    serviceStories,
    latestItemByStory,
    breaks,
    baselineItems,
    currentInventory,
    targetInventory,
    serviceDeployed,
    warnings,
  } = args;

  // The denominator is the EXTERNAL endpoint inventory of the current
  // architecture (internal-processing interfaces + their endpoints excluded)
  // — the externally-reachable API surface a stakeholder counts, mirroring
  // the Live-behaviour cell. Story endpoint carriage only ATTRIBUTES the
  // failure buckets; it never defines the total.
  const external = currentInventory?.externalEndpointIds ?? null;

  const current: ServiceSectionTotals = {
    interfaces: currentInventory?.externalInterfaces ?? null,
    endpoints: external ? external.size : null,
  };

  const target: ServiceSectionTotals | null = serviceDeployed
    ? {
        interfaces: targetInventory?.externalInterfaces ?? null,
        endpoints: targetInventory ? targetInventory.externalEndpointIds.size : null,
      }
    : null;

  const reconciliationSeen = breaks.length > 0;
  if (!serviceDeployed && !reconciliationSeen) {
    return { current, target, buckets: null, perOperation: null };
  }

  // ---- Buckets: partition the external endpoints, worst-first. ------------
  let buckets: ServiceSection['buckets'] = null;
  if (external && external.size > 0) {
    const failedStoriesEndpoints = new Set<string>();
    for (const story of serviceStories) {
      if (isManualExecutionItem(story) || !story.workItemId) continue;
      const item = latestItemByStory.get(story.workItemId);
      const status = item?.status ?? '';
      if (status !== 'failed' && status !== 'rejected') continue;
      const ids = (story.apiEndpointIds ?? []).filter((id): id is string => !!id);
      if (ids.length === 0) {
        warnings.push(
          `Story "${story.title ?? story.workItemId}" failed but carries no endpoint ids — its endpoints cannot be attributed to the failed-to-migrate bucket.`,
        );
      }
      for (const id of ids) {
        if (external.has(id)) failedStoriesEndpoints.add(id);
      }
    }

    // Breaks -> endpoints via the "METHOD /path" key of the CURRENT inventory.
    const endpointIdByKey = currentInventory?.endpointIdByKey ?? new Map<string, string>();
    const unresolvedBreakEndpoints = new Set<string>();
    let unmappableUnresolved = 0;
    for (const b of breaks) {
      const disposition = b.disposition_status ?? BREAK_DISPOSITION.OPEN;
      if (RESOLVED_BREAK_DISPOSITIONS.has(disposition)) continue;
      const detail = (b.detail_json ?? {}) as { method?: unknown; path?: unknown };
      const method = typeof detail.method === 'string' ? detail.method.toUpperCase() : '';
      const path = typeof detail.path === 'string' ? detail.path : '';
      const endpointId = method && path ? endpointIdByKey.get(`${method} ${path}`) : undefined;
      if (endpointId && external.has(endpointId)) {
        unresolvedBreakEndpoints.add(endpointId);
      } else {
        unmappableUnresolved += 1;
      }
    }
    if (unmappableUnresolved > 0) {
      warnings.push(
        `${unmappableUnresolved} unresolved break(s) could not be mapped to an external endpoint and are excluded from the endpoint buckets.`,
      );
    }

    let failedToMigrate = 0;
    let failedReconciliation = 0;
    let fullyReconciled = 0;
    for (const id of external) {
      if (failedStoriesEndpoints.has(id)) failedToMigrate += 1;
      else if (unresolvedBreakEndpoints.has(id)) failedReconciliation += 1;
      else fullyReconciled += 1;
    }
    buckets = { failedToMigrate, failedReconciliation, fullyReconciled };
  }

  // ---- Per-operation rollup. ----------------------------------------------
  let perOperation: ServiceSection['perOperation'] = null;
  if (baselineItems.length > 0 || breaks.length > 0) {
    const underInvestigation = breaks.filter(
      (b) => !RESOLVED_BREAK_DISPOSITIONS.has(b.disposition_status ?? BREAK_DISPOSITION.OPEN),
    ).length;
    const accepted = breaks.filter((b) =>
      ACCEPTED_BREAK_DISPOSITIONS.has(b.disposition_status ?? ''),
    ).length;
    const fixed = breaks.filter(
      (b) => (b.disposition_status ?? '') === BREAK_DISPOSITION.FIXED_CONFIRMED,
    ).length;
    const replayed = baselineItems.length;
    perOperation = {
      replayed,
      matching: Math.max(0, replayed - breaks.length),
      underInvestigation,
      accepted,
      fixed,
    };
  }

  return { current, target, buckets, perOperation };
}

// ============================================================================
// Stages
// ============================================================================

function buildStages(args: {
  scope: { db: boolean; service: boolean };
  context: MigrationDiscoveryContext | null;
  discoveryRuns: DiscoveryRunRow[] | null;
  dbDiscoveryFacts: { findings: number | null; savedItems: number | null };
  codeDiscoveryFacts: { findings: number | null; savedItems: number | null };
  baseline: ApiBehaviourBaseline | null;
  baselineItems: ApiBehaviourBaselineItemWire[];
  decisionsCount: number;
  dbStoryCount: number;
  serviceStoryCount: number;
  specGens: SpecGeneration[];
  dispatchableStories: ProgressBookItem[];
  latestItemByStory: Map<string, MigrationExecutionRunItem>;
  runs: MigrationExecutionRun[];
  executed: boolean;
  db: DbSection | null;
  service: ServiceSection | null;
  breakCount: number;
  unresolvedBreakCount: number;
}): ProgressStage[] {
  const {
    scope,
    context,
    discoveryRuns,
    dbDiscoveryFacts,
    codeDiscoveryFacts,
    baseline,
    baselineItems,
    decisionsCount,
    dbStoryCount,
    serviceStoryCount,
    specGens,
    dispatchableStories,
    latestItemByStory,
    runs,
    executed,
    db,
    service,
    breakCount,
    unresolvedBreakCount,
  } = args;
  const stages: ProgressStage[] = [];

  // Authoritative per-kind run rows (the runs LIST); the context's capped
  // highlight list is only the fallback when the list read failed.
  const runRowsOfKind = (kinds: string[]): Array<{ status: string }> => {
    if (discoveryRuns) {
      return discoveryRuns
        .filter((r) => kinds.includes((r.discovery_kind ?? 'code').toLowerCase()))
        .map((r) => ({ status: (r.status ?? '').toUpperCase() }));
    }
    return (context?.discoveryRunsSummary?.runs ?? [])
      .filter((r) => kinds.includes((r.discoveryKind ?? 'code').toLowerCase()))
      .map((r) => ({ status: (r.status ?? '').toUpperCase() }));
  };

  const discoveryStage = (
    key: 'db_discovery' | 'code_discovery',
    label: string,
    kinds: string[],
    facts_: { findings: number | null; savedItems: number | null },
  ): ProgressStage => {
    const ofKind = runRowsOfKind(kinds);
    const completed = ofKind.some((r) => r.status === 'COMPLETED');
    const anyStarted = ofKind.length > 0;
    const allFailed =
      anyStarted && ofKind.every((r) => r.status === 'FAILED' || r.status === 'CANCELLED');
    const facts: string[] = [];
    // "architecture items" = the SAVED architecture candidates of the latest
    // completed run of the kind (2026-08-16 — replaces the derived
    // model-entity tally, which was not what discovery itself reports).
    if (completed && facts_.savedItems !== null) {
      facts.push(`${facts_.savedItems} architecture items`);
    }
    if (completed && facts_.findings !== null) facts.push(`${facts_.findings} findings`);
    if (!anyStarted) facts.push('not started');
    return {
      key,
      label,
      status: completed ? 'complete' : allFailed ? 'failed' : anyStarted ? 'in_progress' : 'not_started',
      facts,
    };
  };

  if (scope.db) {
    stages.push(
      discoveryStage('db_discovery', 'DB discovery', ['database', 'combined'], dbDiscoveryFacts),
    );
  }
  if (scope.service) {
    stages.push(
      discoveryStage('code_discovery', 'Code/logs discovery', ['code', 'combined'], codeDiscoveryFacts),
    );

    // Live behaviour rides the service plane only.
    const distinctEndpoints = new Set(
      baselineItems.map((i) => `${(i.method ?? '').toUpperCase()} ${i.path ?? ''}`),
    ).size;
    const anyBaselines = (context?.apiBehaviourBaselineSummary?.totalBaselines ?? 0) > 0;
    stages.push({
      key: 'live_behaviour',
      label: 'Live behaviour',
      status: baseline ? 'complete' : anyBaselines ? 'in_progress' : 'not_started',
      facts: baseline
        ? [`${distinctEndpoints} endpoints`, `${baselineItems.length} captured behaviours`]
        : ['not started'],
    });
  }

  stages.push({
    key: 'target_conversation',
    label: 'Target conversation',
    status: decisionsCount > 0 ? 'complete' : 'not_started',
    facts: decisionsCount > 0 ? [`${decisionsCount} questions answered`] : ['not started'],
  });

  // --- Plan created. --------------------------------------------------------
  const latestSpecs = latestSpecGenByWorkItem(specGens);
  const expected = dispatchableStories.length;
  const readyCount = dispatchableStories.filter((s) =>
    isSpecReady(latestSpecs.get(s.workItemId as string)),
  ).length;
  const planFacts: string[] = [];
  if (scope.db) planFacts.push(`${dbStoryCount} DB specs`);
  if (scope.service) planFacts.push(`${serviceStoryCount} service specs`);
  stages.push({
    key: 'plan_created',
    label: 'Migration Plan Created',
    status:
      expected > 0 && readyCount === expected
        ? 'complete'
        : specGens.length > 0 || expected > 0
          ? readyCount > 0
            ? 'in_progress'
            : expected > 0
              ? 'in_progress'
              : 'not_started'
          : 'not_started',
    facts: expected > 0 ? planFacts : ['not started'],
  });

  // --- Plan executed. -------------------------------------------------------
  const doneStories = dispatchableStories.filter((s) => {
    const item = latestItemByStory.get(s.workItemId as string);
    return item?.status === 'deployed' || item?.status === 'implemented';
  }).length;
  const latestRun = runs[0] ?? null;
  stages.push({
    key: 'plan_executed',
    label: 'Migration Plan Executed',
    status:
      runs.length === 0
        ? 'not_started'
        : executed
          ? 'complete'
          : latestRun?.status === RUN_STATUS.FAILED
            ? 'failed'
            : 'in_progress',
    facts: runs.length === 0 ? ['not started'] : [`${doneStories}/${expected} specs`],
  });

  // --- Reconciliation. ------------------------------------------------------
  const dbSeen = !!db?.buckets;
  const serviceSeen = !!service?.buckets || breakCount > 0;
  const anySeen = dbSeen || serviceSeen;
  const dbClean =
    !scope.db ||
    (!!db?.buckets &&
      db.buckets.failedToLoad === 0 &&
      db.buckets.rowCountMismatch === 0 &&
      db.buckets.dataMismatch === 0 &&
      // Positive framing (2026-08-16): clean = everything captured is
      // migrated; unknown counts stay clean (same posture as before).
      (db.current.views === null ||
        db.viewsMigrated === null ||
        db.viewsMigrated >= db.current.views) &&
      (db.current.procs === null ||
        db.procsMigrated === null ||
        db.procsMigrated >= db.current.procs));
  const serviceClean =
    !scope.service ||
    (!!service?.buckets &&
      service.buckets.failedToMigrate === 0 &&
      service.buckets.failedReconciliation === 0 &&
      unresolvedBreakCount === 0);
  stages.push({
    key: 'reconciliation',
    label: 'Reconciliation',
    status: !anySeen ? 'not_started' : dbClean && serviceClean && executed ? 'complete' : 'in_progress',
    facts: [!anySeen ? 'not started' : dbClean && serviceClean && executed ? 'complete' : 'in progress'],
  });

  return stages;
}
