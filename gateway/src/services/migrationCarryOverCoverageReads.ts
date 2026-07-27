/**
 * Carry-over completeness-gate AMS reads (gateway -> AMS).
 *
 * Spec: D4 — Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) — Task
 * Group 2.
 *
 * The async fetch seam that assembles the inputs for the PURE coverage
 * computation in {@link ./migrationCarryOverCoverage}. It uses the Group-1 AMS
 * reads, all of which already exist (NO new AMS endpoints):
 *
 *   - capabilities for a project + architecture (members embedded) — gives each
 *     capability's `review_status`, `detail_json.behaviourBearing`, `run_id`,
 *     and its `discovery_capability_member` membership (the roll-up source);
 *   - findings per discovery run (the run-scoped, paged findings list) — gives
 *     each finding's `review_status` / `reviewer_notes` / `detail_json`;
 *   - the work-items list (already fetched by the Driver) — gives each
 *     work_item's `source_capability_id` (the changeset-185 column) so a
 *     capability's cited-state is a structured join, not a blob re-parse.
 *
 * Run scope (D5): the book identifies project + `current_architecture_id`; the
 * set of discovery runs to evaluate is derived from the synthesised
 * capabilities' `run_id` set (the runs that fed the plan), unioned with any
 * explicitly-passed run ids. Behaviour-bearing filtering happens in the gateway
 * (the SOLE predicate is `detail_json.behaviourBearing == true`).
 *
 * Wire shape is snake_case (the AMS global default). Every collaborator is the
 * DI seam the gate mocks in unit tests — no live AMS, no LLM.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import { WorkItem, BookOfWork } from './migrationDriverAmsReads';
import {
  CoverageCapabilityInput,
  CoverageFindingInput,
  capabilityBehaviourBearing,
  findingBehaviourBearing,
} from './migrationCarryOverCoverage';

// ============================================================================
// Wire types (subset of the AMS DTOs)
// ============================================================================

/** One polymorphic membership edge embedded on a capability. */
export interface CapabilityMemberWire {
  member_type?: string | null;
  member_id?: string | null;
}

/** A `discovery_capability` row (members embedded) — the AMS DTO subset. */
export interface DiscoveryCapabilityWire {
  id?: string;
  run_id?: string | null;
  name?: string | null;
  kind?: string | null;
  summary?: string | null;
  review_status?: string | null;
  detail_json?: Record<string, unknown> | null;
  members?: CapabilityMemberWire[] | null;
}

/** A `discovery_findings` row — the AMS DTO subset (snake_case at the wire). */
export interface DiscoveryFindingWire {
  id?: string;
  title?: string | null;
  summary?: string | null;
  severity?: string | null;
  category?: string | null;
  finding_type?: string | null;
  review_status?: string | null;
  reviewer_notes?: string | null;
  detail_json?: Record<string, unknown> | null;
}

/** The run-scoped findings list response envelope. */
interface DiscoveryFindingSearchResponseWire {
  items?: DiscoveryFindingWire[];
}

/** A `discovery_runs` row — the AMS DTO subset (the run-scope FALLBACK list). */
export interface DiscoveryRunWire {
  id?: string;
  status?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function baseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

async function getJsonOrNull<T>(url: string, label: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      logger.warn(`[diag-gateway] carry_over_coverage ${label} AMS non-OK`, {
        status: response.status,
        url,
      });
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    logger.warn(`[diag-gateway] carry_over_coverage ${label} AMS read failed`, {
      url,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

const FINDINGS_PAGE_SIZE = 200;

// ============================================================================
// Reads
// ============================================================================

/**
 * GET all synthesised capabilities for a project + architecture (members
 * embedded). The capability carries `run_id`, `review_status`,
 * `detail_json.behaviourBearing`, and its members.
 */
export async function fetchCapabilitiesForArchitecture(
  projectId: string,
  architectureId: string
): Promise<DiscoveryCapabilityWire[]> {
  const url =
    `${baseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/discovery/capabilities`;
  const rows = await getJsonOrNull<DiscoveryCapabilityWire[]>(url, 'fetch_capabilities');
  return Array.isArray(rows) ? rows : [];
}

/**
 * GET all findings for a discovery run (the run-scoped, paged AMS list). Walks
 * pages until a short page. No status / severity filter — the gate needs the
 * full disposition + `detail_json.behaviourBearing` of every finding to resolve
 * coverage (behaviour-bearing filtering is applied in the gateway).
 */
export async function fetchFindingsForRun(
  projectId: string,
  architectureId: string,
  runId: string
): Promise<DiscoveryFindingWire[]> {
  const out: DiscoveryFindingWire[] = [];
  let page = 0;
  for (;;) {
    const url =
      `${baseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(architectureId)}` +
      `/discovery/runs/${encodeURIComponent(runId)}/findings` +
      `?page=${page}&size=${FINDINGS_PAGE_SIZE}`;
    const result = await getJsonOrNull<DiscoveryFindingSearchResponseWire>(url, 'fetch_findings');
    const items = result?.items ?? [];
    for (const item of items) out.push(item);
    if (items.length < FINDINGS_PAGE_SIZE) break;
    page += 1;
  }
  return out;
}

/**
 * GET the architecture's discovery runs — the run-scope FALLBACK (2026-07-27).
 * The canonical run scope derives from the synthesised capabilities' run ids
 * (D5), but a project with NO capabilities left that set EMPTY — zero findings
 * were ever evaluated and the gate read clear (fail-OPEN, live-confirmed on
 * the user's estate: capabilities `[]`, gate ✓, ~37 behaviour-bearing findings
 * invisible). When the derived set is empty, the architecture's own run list
 * is the scope.
 */
export async function fetchDiscoveryRunsForArchitecture(
  projectId: string,
  architectureId: string
): Promise<DiscoveryRunWire[]> {
  const url =
    `${baseUrl()}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/discovery/runs`;
  const rows = await getJsonOrNull<DiscoveryRunWire[]>(url, 'fetch_runs');
  return Array.isArray(rows) ? rows : [];
}

/** The injectable read surface (the DI seam the gate mocks in tests). */
export interface CarryOverCoverageReadsDeps {
  fetchCapabilitiesForArchitecture: typeof fetchCapabilitiesForArchitecture;
  fetchFindingsForRun: typeof fetchFindingsForRun;
  /**
   * The run-scope fallback (2026-07-27). OPTIONAL so pre-existing test seams
   * keep compiling; the production default always supplies it. When absent
   * AND the capability-derived run set is empty, the gather logs and yields
   * an empty scope (the diagnostics make that state visible).
   */
  fetchDiscoveryRunsForArchitecture?: typeof fetchDiscoveryRunsForArchitecture;
}

/** The default (production) reads surface. */
export function defaultCarryOverCoverageReadsDeps(): CarryOverCoverageReadsDeps {
  return {
    fetchCapabilitiesForArchitecture,
    fetchFindingsForRun,
    fetchDiscoveryRunsForArchitecture,
  };
}

// ============================================================================
// Assembly — gather the pure-module inputs for a book of work
// ============================================================================

/**
 * Human-readable content for ONE coverage item (capability or finding) — the
 * accounting panel + LLM triage side-output (2026-07-26). The pure coverage
 * module never reads these; they ride ALONGSIDE its inputs so the coverage
 * route / triage prompt can present items with real content instead of bare
 * UUIDs, and so a finding dismissal has its run id to hand (the AMS finding
 * review is run-scoped).
 */
export interface CarryOverItemDetail {
  kind: 'capability' | 'finding';
  title: string | null;
  summary: string | null;
  /** Findings only (null for capabilities). */
  severity: string | null;
  category: string | null;
  /** The owning discovery run — REQUIRED to dismiss a finding. */
  runId: string | null;
  reviewStatus: string | null;
  /** Capabilities only: how many member findings roll up under it. */
  memberFindingCount: number | null;
}

/** The assembled inputs for {@link computeCarryOverCoverage}. */
export interface CarryOverCoverageInputs {
  capabilities: CoverageCapabilityInput[];
  findings: CoverageFindingInput[];
  citedCapabilityIds: Set<string>;
  citedFindingIds: Set<string>;
  /**
   * Capability id -> its human label (\`name\`). A side-output the batch ("Generate
   * all capability stories") uses for the created story title; the pure coverage
   * module never needs it.
   */
  capabilityTitleById: Map<string, string>;
  /**
   * Item id (capability OR finding) -> its human content (2026-07-26). Feeds
   * the review-screen accounting panel and the triage LLM prompt.
   */
  itemDetailById: Map<string, CarryOverItemDetail>;
  /**
   * Scope diagnostics (2026-07-27): what the gather actually evaluated, so an
   * empty coverage is EXPLAINABLE instead of a mystery zero ("No items to
   * account for" once hid a fail-open where zero runs were evaluated).
   */
  scope: CarryOverScopeDiagnostics;
}

/** What the coverage gather actually evaluated. */
export interface CarryOverScopeDiagnostics {
  /** Capability rows read for the architecture. */
  capabilityCount: number;
  /** Discovery runs whose findings were evaluated. */
  runCount: number;
  /** Behaviour-bearing findings evaluated (post-filter). */
  findingCount: number;
  /**
   * Where the run scope came from: the capabilities' run ids (canonical D5),
   * the architecture's own run list (the 2026-07-27 fallback when no
   * capabilities exist), or nowhere (no capabilities AND no runs — nothing to
   * evaluate, honestly).
   */
  runScopeSource: 'capabilities' | 'architecture_runs' | 'none';
}

/**
 * Collect every capability id cited by a story: a `work_item.source_capability_id`
 * (the changeset-185 column) off the work-items list the Driver already fetched.
 */
export function collectCitedCapabilityIds(workItems: WorkItem[]): Set<string> {
  const out = new Set<string>();
  for (const wi of workItems) {
    const sid = wi.source_capability_id;
    if (typeof sid === 'string' && sid.length > 0) out.add(sid);
  }
  return out;
}

/**
 * Collect every finding id directly cited by a book item's
 * `discoveryFindingReferences` (the finding-citation mechanism, reused as-is).
 */
export function collectCitedFindingIds(book: BookOfWork): Set<string> {
  const out = new Set<string>();
  for (const item of book.book_of_work_json?.items ?? []) {
    const refs = item.discoveryFindingReferences;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (typeof ref === 'string' && ref.length > 0) out.add(ref);
    }
  }
  return out;
}

/**
 * Gather the carry_over coverage inputs for a book of work: read the
 * project+architecture capabilities, derive the run set that fed the plan, read
 * each run's findings, and assemble the pure-module inputs (behaviour-bearing
 * filtering + the cited-sets derived from the work items + book blob).
 *
 * @param projectId      the book's project
 * @param architectureId the book's `current_architecture_id`
 * @param book           the book of work (for `discoveryFindingReferences`)
 * @param workItems      the work-items list (for `source_capability_id`)
 * @param extraRunIds    optional explicit run ids to union into the run scope
 * @param deps           the AMS reads seam (mocked in tests)
 */
export async function gatherCarryOverCoverageInputs(params: {
  projectId: string;
  architectureId: string;
  book: BookOfWork;
  workItems: WorkItem[];
  extraRunIds?: string[];
  deps?: CarryOverCoverageReadsDeps;
}): Promise<CarryOverCoverageInputs> {
  const deps = params.deps ?? defaultCarryOverCoverageReadsDeps();

  const capabilityRows = await deps.fetchCapabilitiesForArchitecture(
    params.projectId,
    params.architectureId
  );

  const capabilities: CoverageCapabilityInput[] = capabilityRows
    .filter((c): c is DiscoveryCapabilityWire & { id: string } => typeof c.id === 'string')
    .map((c) => ({
      id: c.id,
      behaviourBearing: capabilityBehaviourBearing(c.detail_json),
      reviewStatus: c.review_status ?? null,
      reviewerNotes: readReviewerNotes(c.detail_json),
      memberFindingIds: (c.members ?? [])
        .filter((m) => m.member_type === 'discovery_finding')
        .map((m) => m.member_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    }));

  // Resolve the run set that fed the plan: the capabilities' run_ids unioned
  // with any explicitly-passed run ids (D5 — the runs that fed the plan).
  const runIds = new Set<string>();
  for (const c of capabilityRows) {
    if (typeof c.run_id === 'string' && c.run_id.length > 0) runIds.add(c.run_id);
  }
  for (const rid of params.extraRunIds ?? []) {
    if (typeof rid === 'string' && rid.length > 0) runIds.add(rid);
  }

  // Run-scope FALLBACK (2026-07-27): a project with NO capabilities left the
  // derived run set EMPTY — zero findings were ever evaluated, so the gate
  // read clear while behaviour-bearing findings sat invisible (fail-OPEN,
  // live-confirmed). When the canonical derivation yields nothing, the
  // architecture's own discovery-run list IS the scope.
  let runScopeSource: CarryOverScopeDiagnostics['runScopeSource'] =
    runIds.size > 0 ? 'capabilities' : 'none';
  if (runIds.size === 0) {
    if (deps.fetchDiscoveryRunsForArchitecture) {
      const runs = await deps.fetchDiscoveryRunsForArchitecture(
        params.projectId,
        params.architectureId
      );
      for (const run of runs) {
        if (typeof run.id === 'string' && run.id.length > 0) runIds.add(run.id);
      }
      if (runIds.size > 0) runScopeSource = 'architecture_runs';
      logger.info('[diag-gateway] carry_over_coverage run_scope_fallback', {
        projectId: params.projectId,
        architectureId: params.architectureId,
        runCount: runIds.size,
      });
    } else {
      logger.warn(
        '[diag-gateway] carry_over_coverage run_scope_empty_no_fallback_dep',
        { projectId: params.projectId, architectureId: params.architectureId }
      );
    }
  }

  // Read each run's findings (run-scoped, paged) and keep only behaviour-bearing
  // ones — the SOLE gating predicate. De-dupe by finding id across runs. The
  // owning run id is captured per finding (the AMS finding review — and
  // therefore the DISMISS action — is run-scoped).
  const itemDetailById = new Map<string, CarryOverItemDetail>();
  const findingsById = new Map<string, CoverageFindingInput>();
  for (const runId of runIds) {
    const rows = await deps.fetchFindingsForRun(
      params.projectId,
      params.architectureId,
      runId
    );
    for (const f of rows) {
      if (typeof f.id !== 'string' || f.id.length === 0) continue;
      if (findingsById.has(f.id)) continue;
      if (!findingBehaviourBearing(f.detail_json)) continue;
      findingsById.set(f.id, {
        id: f.id,
        behaviourBearing: true,
        reviewStatus: f.review_status ?? null,
        reviewerNotes: f.reviewer_notes ?? null,
      });
      itemDetailById.set(f.id, {
        kind: 'finding',
        title: f.title ?? null,
        summary: f.summary ?? null,
        severity: f.severity ?? null,
        category: f.category ?? null,
        runId,
        reviewStatus: f.review_status ?? null,
        memberFindingCount: null,
      });
    }
  }

  const capabilityTitleById = new Map<string, string>();
  for (const c of capabilityRows) {
    if (typeof c.id === 'string' && c.id.length > 0) {
      capabilityTitleById.set(c.id, typeof c.name === 'string' && c.name.length > 0 ? c.name : c.id);
      itemDetailById.set(c.id, {
        kind: 'capability',
        title: typeof c.name === 'string' && c.name.length > 0 ? c.name : null,
        summary: c.summary ?? null,
        severity: null,
        category: c.kind ?? null,
        runId: typeof c.run_id === 'string' && c.run_id.length > 0 ? c.run_id : null,
        reviewStatus: c.review_status ?? null,
        memberFindingCount: (c.members ?? []).filter(
          (m) => m.member_type === 'discovery_finding'
        ).length,
      });
    }
  }

  return {
    capabilities,
    findings: [...findingsById.values()],
    citedCapabilityIds: collectCitedCapabilityIds(params.workItems),
    citedFindingIds: collectCitedFindingIds(params.book),
    capabilityTitleById,
    itemDetailById,
    scope: {
      capabilityCount: capabilities.length,
      runCount: runIds.size,
      findingCount: findingsById.size,
      runScopeSource,
    },
  };
}

/** Read `detail_json.reviewerNotes` (the capability dismissal reason store). */
function readReviewerNotes(
  detailJson: Record<string, unknown> | null | undefined
): string | null {
  if (!detailJson || typeof detailJson !== 'object') return null;
  const notes = (detailJson as Record<string, unknown>).reviewerNotes;
  return typeof notes === 'string' ? notes : null;
}
