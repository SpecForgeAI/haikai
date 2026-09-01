/**
 * Deterministic CODE-stream plan generation from the committed architecture
 * model (Spec 2026-07-06-g — Deterministic Code-Stream Planning, Code-Tier
 * Oracle Program). Mirrors the DB planner (`migrationDbPackPlanner.ts`) idiom:
 * NO LLM anywhere in this module, NO silent freeform fallback, coverage as a
 * code guarantee.
 *
 * Replaces the LLM for BOTH phases of the CODE delivery streams:
 *
 *   `api_migration`                          — REST + SOAP endpoints (ONE generic
 *                                              API stream; protocol is carried into
 *                                              each spec, not split into streams —
 *                                              Spec V, 2026-07-17)
 *   `internal_processing_implementation`     — non-HTTP entry points
 *
 *   Phase 1 (skeleton): initiative -> epics (foundations / baseline capture /
 *   interface implementation / exceptional endpoints / closure) -> ONE FEATURE
 *   PER INTERFACE, each feature stamped with its committed endpoint ids.
 *
 *   Phase 2 (expansion): deterministic stories — ONE story per interface
 *   (the anti-story-explosion guarantee: 400 endpoints across 40 interfaces
 *   ≈ 40 cluster stories, never 400), verb-group splits (GETs / POSTs+PUTs+
 *   PATCH / other verbs) then path-sorted chunks when an interface exceeds
 *   MIGRATION_PLAN_API_CLUSTER_MAX_ENDPOINTS, individual stories ONLY for
 *   flagged endpoints, MANUAL-GATE capture stories for interfaces below the
 *   baseline-coverage floor.
 *
 * Partition rules (user decisions, gap analysis §7):
 *   - `direction: 'outbound'` endpoints are EXCLUDED (integration surface,
 *     not implementable inbound endpoints) — counted, never silent.
 *   - SOAP = interface_type or endpoint_type/protocol mentions SOAP.
 *   - INTERNAL = no HTTP verb resolvable from operation_verb or the leading
 *     name token (message listeners / scheduled entry points committed as
 *     endpoints). `endpoint_subtype` does NOT survive commit today (verified
 *     2026-07-06) so this is a documented heuristic; Spec M completes it.
 *   - REST = everything else.
 *
 * Flags are computed at SKELETON time and STAMPED into feature extras — the
 * expansion trusts the stamped plan and re-reads the model only for the DRIFT
 * check (endpoint set changed since skeleton → throw "regenerate the migration
 * plan", both directions). This mirrors the DB pack's staleness model:
 * regeneration is the refresh mechanism.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  GeneratedMigrationBookOfWork,
  MigrationBookOfWorkItem,
  MigrationBookOfWorkWorkstream,
} from './generatedMigrationBookOfWorkSchema';
import { fetchEndpointBaselineCoverage } from './apiBehaviourBaselineCoverageClient';
// Findings enrichment reads the RUN-SCOPED findings list rather than the
// Migration Discovery Context: the context read is capped (maxFindings=100 by
// default) AND returns only `highPriorityFindings`, so on a large estate it
// sees a fraction; and it does not expose `detail_json`, where the code
// scanners record the endpoint route the route-identity tier joins on.
import {
  DiscoveryFindingWire,
  fetchDiscoveryRunsForArchitecture,
  fetchFindingsForRun,
} from './migrationCarryOverCoverageReads';
// The SAME path normalisation the SCL story->endpoint join uses, so a finding
// and a story resolve an endpoint by identical rules.
import { normalisePath } from './sclEndpointIdentityJoin';
import {
  MANUAL_EXECUTION_TAG,
  recommendedNextActionForItem,
} from './migrationExecutionClass';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * The deterministically-planned code streams (Spec V, 2026-07-17). REST + SOAP
 * are ONE generic `api_migration` stream — the planner no longer partitions by
 * protocol at the STREAM level; each endpoint's protocol is preserved internally
 * (SOAP-aware clustering + WSDL-metadata flagging) and carried into its spec.
 */
export const CODE_DELIVERY_STREAMS: readonly string[] = [
  'api_migration',
  'internal_processing_implementation',
];

/** Tag carried by every deterministically model-derived code item. */
export const CODE_PROVENANCE_TAG = 'provenance:plan-deterministic';

/** Tag reused from the DB planner for prerequisite items. */
export const CODE_PREREQUISITE_TAG = 'provenance:prerequisite';

/**
 * Manual-gate execution marker: stories the execution driver must NEVER
 * dispatch to the implement-verify service (human/wizard work — baseline
 * capture sessions, parity sign-off sweeps). Spec G amendment 2026-07-06.
 */
export const MANUAL_GATE_TAG = 'execution:manual-gate';

const HTTP_VERBS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
]);

// ---------------------------------------------------------------------------
// Model view types + default AMS read
// ---------------------------------------------------------------------------

/** One committed endpoint row, normalised from the AMS full-model read. */
export interface CodeEndpointRow {
  id: string;
  name: string;
  interfaceId: string | null;
  interfaceName: string;
  interfaceType: string;
  endpointType: string;
  protocol: string;
  /** Upper-cased HTTP verb when resolvable, else null (internal heuristic). */
  verb: string | null;
  path: string | null;
  direction: string;
  /** True when protocol_metadata_json is present (SOAP completeness signal). */
  hasProtocolMetadata: boolean;
  /**
   * Owning class from `protocol_metadata_json.className` (persisted since the
   * 2026-07-23 commit change), for the join's last-resort class tier.
   * Optional so the row constructor in `buildCodeEpicStories` — which rebuilds
   * rows from stamped feature facts and only ever joins by route — needs no
   * change.
   */
  className?: string | null;
}

/** Everything the planner needs about the committed code surface, one read. */
export interface CodeModelView {
  endpoints: CodeEndpointRow[];
  /** endpoint element id -> active baseline id (absent = no coverage). */
  baselineByEndpointId: Map<string, string>;
  /** endpoint element id -> attached finding ids (best-effort enrichment). */
  findingIdsByEndpointId: Map<string, string[]>;
  /**
   * The subset of {@link findingIdsByEndpointId} that WARRANTS individual
   * attention, i.e. excluding {@link NON_ESCALATING_FINDING_SEVERITIES}
   * (`info` + `low`, 2026-09-01).
   *
   * <p>Carriage and escalation are deliberately different questions. Every
   * attached finding should ride on its story (`findingIds`), but only a
   * material one should pull an endpoint OUT of its interface cluster into an
   * individual "exceptional" story. On a live estate every route-matched
   * finding was severity `info` + status `approved`; flagging on mere presence
   * escalated three quarters of the endpoints, which breaks this module's
   * stated anti-story-explosion guarantee (see the header: ~40 cluster stories
   * for 400 endpoints, never 400).</p>
   *
   * <p>Optional and ABSENT-tolerant: {@link flagEndpoint} falls back to
   * `findingIdsByEndpointId` when this is not supplied, so existing callers and
   * tests keep their current behaviour.</p>
   */
  escalatingFindingIdsByEndpointId?: Map<string, string[]>;
  /**
   * Endpoints the DB-change consumer computation marked DIALECT-AFFECTED
   * (Spec 2026-07-06-f — touches a translated proc, carries T-SQL SQL, or
   * touches a shape-altered table). Optional + absent by default: the
   * book-of-work handler computes it fail-soft via
   * `dbChangeConsumerResolver`; absent = no dialect flags (legacy planning
   * byte-identical).
   */
  dialectAffectedEndpointIds?: Set<string>;
}

export type FetchCodeModelViewFn = (
  projectId: string,
  currentArchitectureId: string
) => Promise<CodeModelView | null>;

interface RawInterfaceDto {
  id?: string;
  name?: string;
  interface_type?: string;
  interfaceType?: string;
}

interface RawEndpointDto {
  id?: string;
  name?: string;
  interface_id?: string;
  interfaceId?: string;
  endpoint_type?: string;
  endpointType?: string;
  path_or_address?: string;
  pathOrAddress?: string;
  protocol?: string;
  operation_verb?: string;
  operationVerb?: string;
  direction?: string;
  protocol_metadata_json?: unknown;
  protocolMetadataJson?: unknown;
}

function firstToken(value: string): string {
  return value.trim().split(/\s+/)[0] ?? '';
}

/** Resolve the HTTP verb from operation_verb or the leading name token. */
function resolveVerb(operationVerb: string, name: string): string | null {
  const fromField = operationVerb.trim().toUpperCase();
  if (HTTP_VERBS.has(fromField)) return fromField;
  const fromName = firstToken(name).toUpperCase();
  if (HTTP_VERBS.has(fromName)) return fromName;
  return null;
}

/**
 * Default view fetch: the AMS full-model read
 * (`GET /api/model/projects/{p}/architectures/{a}` ->
 * `{ metaModel: { entities: { interfaces, endpoints } } }`) joined with the
 * canonical endpoint→baseline coverage. Returns null on ANY read failure —
 * the caller degrades to the explicit PREREQUISITE skeleton, never a guess.
 * Findings enrichment is applied HERE as a best-effort pass (it was previously
 * left to callers, and no caller ever applied it), in two tiers:
 * {@link attachFindingMentions} by endpoint name, then
 * {@link attachFindingRoutes} by structured route identity — see the
 * enrichment block below.
 */
export const defaultFetchCodeModelView: FetchCodeModelViewFn = async (
  projectId,
  currentArchitectureId
) => {
  try {
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(currentArchitectureId)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      logger.warn('Code planner model read returned non-OK', {
        projectId,
        status: response.status,
      });
      return null;
    }
    const body = (await response.json()) as {
      metaModel?: {
        entities?: { interfaces?: RawInterfaceDto[]; endpoints?: RawEndpointDto[] };
      };
    };
    const rawInterfaces = body?.metaModel?.entities?.interfaces ?? [];
    const rawEndpoints = body?.metaModel?.entities?.endpoints ?? [];
    const interfacesById = new Map<string, RawInterfaceDto>();
    for (const iface of rawInterfaces) {
      if (iface.id) interfacesById.set(iface.id, iface);
    }

    const endpoints: CodeEndpointRow[] = [];
    for (const raw of rawEndpoints) {
      if (!raw.id) continue;
      const name = raw.name ?? '';
      const interfaceId = raw.interface_id ?? raw.interfaceId ?? null;
      const iface = interfaceId ? interfacesById.get(interfaceId) : undefined;
      const operationVerb = raw.operation_verb ?? raw.operationVerb ?? '';
      const verb = resolveVerb(operationVerb, name);
      const path = raw.path_or_address ?? raw.pathOrAddress ?? null;
      // The owning class rides in protocol_metadata_json (persisted since the
      // 2026-07-23 commit change) — previously this blob was read only to
      // compute the boolean below and its content discarded.
      const protocolMetadata = raw.protocol_metadata_json ?? raw.protocolMetadataJson;
      const className =
        protocolMetadata != null && typeof protocolMetadata === 'object'
          ? ((protocolMetadata as Record<string, unknown>).className as string | undefined)
          : undefined;
      endpoints.push({
        id: raw.id,
        name,
        interfaceId,
        interfaceName: iface?.name ?? '(unassigned interface)',
        interfaceType: iface?.interface_type ?? iface?.interfaceType ?? '',
        endpointType: raw.endpoint_type ?? raw.endpointType ?? '',
        protocol: raw.protocol ?? '',
        verb,
        path: path && path.length > 0 ? path : null,
        direction: (raw.direction ?? '').toLowerCase(),
        hasProtocolMetadata: protocolMetadata != null,
        className: typeof className === 'string' && className.length > 0 ? className : null,
      });
    }

    let baselineByEndpointId = new Map<string, string>();
    try {
      baselineByEndpointId = await fetchEndpointBaselineCoverage(
        projectId,
        currentArchitectureId
      );
    } catch (error) {
      // Coverage read failure is NOT fatal: endpoints stay conservatively
      // uncovered (missing_baseline flags + capture stories), never silent.
      logger.warn('Code planner baseline-coverage read failed; endpoints treated as uncovered', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Findings enrichment (2026-08-30 carriage gap). This pass used to be
    // left to "the caller", but NO caller ever applied it, so
    // `findingIdsByEndpointId` was ALWAYS empty in production. Two things
    // silently died as a result: the `attached_finding` endpoint flag could
    // never fire (no endpoint was ever routed to the exceptional epic for a
    // finding), and every corpus story's `findingIds` came out `[]` — the
    // carry-over discovery findings had no story-level home even though the
    // consumer in `buildCorpusEndpointGroupItems` was built and tested for it.
    // Applied HERE so the skeleton and the expansion judge flag against
    // IDENTICAL facts (both read the view through this function).
    // Fail-soft, matching the baseline-coverage posture above: a findings read
    // failure leaves the map empty and planning continues unchanged.
    let findingIdsByEndpointId = new Map<string, string[]>();
    let escalatingFindingIdsByEndpointId = new Map<string, string[]>();
    try {
      // Run-scoped findings across every discovery run of this architecture,
      // de-duped by finding id (a finding can surface under more than one run).
      const runs = await fetchDiscoveryRunsForArchitecture(projectId, currentArchitectureId);
      const findingsById = new Map<string, DiscoveryFindingWire>();
      for (const run of runs) {
        if (typeof run.id !== 'string' || run.id.length === 0) continue;
        const rows = await fetchFindingsForRun(projectId, currentArchitectureId, run.id);
        for (const row of rows) {
          if (typeof row.id === 'string' && row.id.length > 0 && !findingsById.has(row.id)) {
            findingsById.set(row.id, row);
          }
        }
      }
      const findings = [...findingsById.values()];

      // TIER ORDER IS LOAD-BEARING: the name pass ASSIGNS each endpoint's
      // list, the route pass MERGES into it. Running routes first would let
      // the name pass overwrite the route hits.
      let enriched: CodeModelView = {
        endpoints,
        baselineByEndpointId,
        findingIdsByEndpointId,
      };
      enriched = attachFindingMentions(
        enriched,
        findings.map((f) => ({
          findingId: f.id as string,
          title: f.title ?? '',
          summary: f.summary ?? null,
        }))
      );
      enriched = attachFindingRoutes(enriched, findingRouteRefsOf(findings));
      findingIdsByEndpointId = enriched.findingIdsByEndpointId;

      // The ESCALATION subset: the same two tiers over material findings only,
      // so `attached_finding` reflects "needs individual attention" rather
      // than "has any finding at all". Reuses the identical matchers — no
      // second matching rule to keep in step.
      const material = findings.filter((f) => !isNonEscalatingFinding(f));
      let escalatingView: CodeModelView = {
        endpoints,
        baselineByEndpointId,
        findingIdsByEndpointId: new Map(),
      };
      escalatingView = attachFindingMentions(
        escalatingView,
        material.map((f) => ({
          findingId: f.id as string,
          title: f.title ?? '',
          summary: f.summary ?? null,
        }))
      );
      escalatingView = attachFindingRoutes(escalatingView, findingRouteRefsOf(material));
      escalatingFindingIdsByEndpointId = escalatingView.findingIdsByEndpointId;

      logger.info('Code planner findings enrichment applied', {
        projectId,
        runCount: runs.length,
        findingCount: findings.length,
        materialFindingCount: material.length,
        endpointsWithFindings: findingIdsByEndpointId.size,
        endpointsEscalated: escalatingFindingIdsByEndpointId.size,
      });
    } catch (error) {
      logger.warn('Code planner findings enrichment failed; endpoints carry no finding linkage', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      endpoints,
      baselineByEndpointId,
      findingIdsByEndpointId,
      escalatingFindingIdsByEndpointId,
    };
  } catch (error) {
    logger.warn('Code planner model read failed', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/**
 * Best-effort finding attachment by title/summary mention of the endpoint
 * name (the unchanged expansion heuristic). Pure; mutates a COPY of the map.
 */
export function attachFindingMentions(
  view: CodeModelView,
  findings: Array<{ findingId: string; title: string; summary?: string | null }>
): CodeModelView {
  if (findings.length === 0) return view;
  const normalise = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  const findingIdsByEndpointId = new Map(view.findingIdsByEndpointId);
  for (const endpoint of view.endpoints) {
    const needle = normalise(endpoint.name);
    if (!needle) continue;
    const hits = findings
      .filter((f) => normalise(`${f.title} ${f.summary ?? ''}`).includes(needle))
      .map((f) => f.findingId);
    if (hits.length > 0) findingIdsByEndpointId.set(endpoint.id, hits);
  }
  return { ...view, findingIdsByEndpointId };
}

/**
 * Severities that ride along as story-level carriage but must never escalate
 * an endpoint out of its interface cluster (2026-09-01: `low` joined `info`
 * after a real plan run — low-severity notes are review material, not
 * individual-story material). Only `medium`/`high`/`critical` escalate.
 *
 * An UNKNOWN or missing severity still escalates: an unrecognised signal gets
 * surfaced rather than quietly demoted.
 */
export const NON_ESCALATING_FINDING_SEVERITIES: ReadonlySet<string> = new Set([
  'info',
  'low',
]);

export function isNonEscalatingFinding(finding: DiscoveryFindingWire): boolean {
  return NON_ESCALATING_FINDING_SEVERITIES.has(
    (finding.severity ?? '').trim().toLowerCase()
  );
}

/** One finding's endpoint route, as the code discovery scanners record it. */
export interface FindingRouteRef {
  findingId: string;
  /** Upper-cased verb from whichever key pair matched; null when absent. */
  verb: string | null;
  /**
   * The endpoint identifier from whichever key pair matched — an HTTP route for
   * REST endpoints, a fully-qualified class name for internal entry points.
   */
  path: string;
}

/**
 * The `detail_json` key spellings the finding emitters use for an endpoint
 * route, MOST-SPECIFIC FIRST (2026-09-01). Two emitters, two spellings:
 * the runtime-evidence pipeline (`runtimeEvidence/` via
 * `findings/emissionSources.ts`) records `codeEndpointMethod` +
 * `codeEndpointPath` but needs runtime logs to fire; the REST-WADL scanner
 * (`findings/packFindingScanners/restWadl/`) runs on an ordinary code scan and
 * records plain `method` + `path`. Reading only the first spelling silently
 * dropped every WADL-pair finding.
 */
const FINDING_ROUTE_KEY_PAIRS: ReadonlyArray<{ verbKey: string; pathKey: string }> = [
  { verbKey: 'codeEndpointMethod', pathKey: 'codeEndpointPath' },
  { verbKey: 'method', pathKey: 'path' },
];

/** Read a non-empty trimmed string off a detail blob, else null. */
function detailString(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Read the endpoint ROUTE off each finding's `detail_json`, trying each
 * emitter key-pair spelling in {@link FINDING_ROUTE_KEY_PAIRS} (most-specific
 * wins; a finding carrying both spellings attaches ONCE). Findings without a
 * route in any spelling are skipped (DB-profiling findings carry
 * `schemaName`/`tableName` instead — they belong to the DB streams).
 *
 * NOTE: `path` is not always an HTTP route — internal entry points record a
 * fully-qualified class name that matches the committed `path_or_address`
 * verbatim. Do NOT add a shape filter (e.g. `startsWith('/')`) here: it was
 * tried and measurably discarded real matches. {@link attachFindingRoutes}
 * already fails closed — a value matching no committed endpoint is dropped
 * there, so shape guessing can only lose real matches.
 */
export function findingRouteRefsOf(findings: DiscoveryFindingWire[]): FindingRouteRef[] {
  const refs: FindingRouteRef[] = [];
  for (const finding of findings) {
    if (typeof finding.id !== 'string' || finding.id.length === 0) continue;
    const detail = finding.detail_json;
    if (detail == null || typeof detail !== 'object') continue;
    const blob = detail as Record<string, unknown>;
    for (const { verbKey, pathKey } of FINDING_ROUTE_KEY_PAIRS) {
      const path = detailString(blob, pathKey);
      if (path == null) continue;
      const verb = detailString(blob, verbKey);
      refs.push({
        findingId: finding.id,
        verb: verb != null ? verb.toUpperCase() : null,
        path,
      });
      break; // most-specific pair wins; never double-attach one finding
    }
  }
  return refs;
}

/**
 * Attach findings to endpoints by ROUTE IDENTITY (verb + normalised path).
 *
 * <p><b>Why this exists (2026-09-01).</b> {@link attachFindingMentions} matches
 * an endpoint's NAME as a substring of a finding's title/summary. That works
 * for internal batch entry points, whose committed name IS a fully-qualified
 * class that appears verbatim in finding prose. It essentially never fires for
 * REST endpoints, whose names look like `GET /views/{viewId}` and do not
 * appear verbatim in a human-written summary. Measured on a live estate the
 * name tier reached a handful of endpoints (almost none of them REST), while
 * the findings carrying a structured route matched their endpoints on the
 * EXACT verb+path tier — no fuzzy fallback, never guessed at.</p>
 *
 * <p>Matching mirrors the story join: exact verb+path first, then path alone
 * when the finding records no verb. A route that resolves to nothing is
 * skipped, never guessed at.</p>
 *
 * <p>MERGES into the existing map (unlike the name pass, which assigns), so it
 * must run AFTER {@link attachFindingMentions} or that assignment would drop
 * these hits. Pure; copies the map.</p>
 */
export function attachFindingRoutes(
  view: CodeModelView,
  refs: FindingRouteRef[]
): CodeModelView {
  if (refs.length === 0) return view;

  const byVerbPath = new Map<string, string[]>();
  const byPath = new Map<string, string[]>();
  const index = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const endpoint of view.endpoints) {
    const path = normalisePath(endpoint.path);
    if (path == null) continue;
    index(byPath, path, endpoint.id);
    const verb = (endpoint.verb ?? '').trim().toUpperCase();
    if (verb.length > 0) index(byVerbPath, `${verb} ${path}`, endpoint.id);
  }

  const findingIdsByEndpointId = new Map(view.findingIdsByEndpointId);
  for (const ref of refs) {
    const path = normalisePath(ref.path);
    if (path == null) continue;
    const hits =
      (ref.verb != null ? byVerbPath.get(`${ref.verb} ${path}`) : undefined) ??
      byPath.get(path);
    if (hits == null || hits.length === 0) continue;
    for (const endpointId of hits) {
      const existing = findingIdsByEndpointId.get(endpointId) ?? [];
      if (existing.includes(ref.findingId)) continue;
      findingIdsByEndpointId.set(endpointId, [...existing, ref.findingId].sort());
    }
  }
  return { ...view, findingIdsByEndpointId };
}

// ---------------------------------------------------------------------------
// Partition + flags + clustering (pure, exported for tests)
// ---------------------------------------------------------------------------

export interface CodePartition {
  rest: CodeEndpointRow[];
  soap: CodeEndpointRow[];
  internal: CodeEndpointRow[];
  excludedOutbound: CodeEndpointRow[];
}

function isSoapRow(row: CodeEndpointRow): boolean {
  const haystack =
    `${row.interfaceType} ${row.endpointType} ${row.protocol}`.toUpperCase();
  return haystack.includes('SOAP');
}

/** Deterministic protocol/direction partition (module-header rules). */
export function partitionEndpoints(view: CodeModelView): CodePartition {
  const partition: CodePartition = {
    rest: [],
    soap: [],
    internal: [],
    excludedOutbound: [],
  };
  for (const row of view.endpoints) {
    if (row.direction === 'outbound') {
      partition.excludedOutbound.push(row);
    } else if (isSoapRow(row)) {
      partition.soap.push(row);
    } else if (row.verb === null) {
      partition.internal.push(row);
    } else {
      partition.rest.push(row);
    }
  }
  return partition;
}

export type EndpointFlag =
  | 'missing_baseline'
  | 'attached_finding'
  | 'soap_metadata_missing'
  | 'dialect_affected';

/**
 * Flag rules (Spec G §2). SOAP endpoints missing baselines are flagged the
 * same as REST — a 100%-SOAP estate still captures baselines (Spec J makes
 * them first-class). Internal endpoints have NO baseline concept and are
 * never flagged missing_baseline.
 */
export function flagEndpoint(
  row: CodeEndpointRow,
  view: CodeModelView,
  kind: 'rest' | 'soap' | 'internal'
): EndpointFlag[] {
  const flags: EndpointFlag[] = [];
  if (kind !== 'internal' && !view.baselineByEndpointId.has(row.id)) {
    flags.push('missing_baseline');
  }
  // Escalate on MATERIAL findings only. Falls back to the full carriage map
  // when the escalating subset was not computed (pre-existing callers/tests).
  const escalating =
    view.escalatingFindingIdsByEndpointId ?? view.findingIdsByEndpointId;
  if ((escalating.get(row.id) ?? []).length > 0) {
    flags.push('attached_finding');
  }
  if (kind === 'soap' && !row.hasProtocolMetadata) {
    flags.push('soap_metadata_missing');
  }
  // Spec 2026-07-06-f: a dialect-affected endpoint (translated proc / T-SQL
  // SQL / shape-altered table) needs an INDIVIDUAL story carrying the
  // rewrite guidance — it must not hide inside an interface cluster.
  if (view.dialectAffectedEndpointIds?.has(row.id)) {
    flags.push('dialect_affected');
  }
  return flags;
}

export interface InterfaceGroup {
  interfaceId: string;
  interfaceName: string;
  endpoints: CodeEndpointRow[];
}

/** Stable grouping by interface (unassigned endpoints share a pseudo-group). */
export function groupByInterface(rows: CodeEndpointRow[]): InterfaceGroup[] {
  const groups = new Map<string, InterfaceGroup>();
  for (const row of rows) {
    const key = row.interfaceId ?? 'unassigned';
    let group = groups.get(key);
    if (!group) {
      group = { interfaceId: key, interfaceName: row.interfaceName, endpoints: [] };
      groups.set(key, group);
    }
    group.endpoints.push(row);
  }
  const out = [...groups.values()];
  for (const group of out) {
    group.endpoints.sort(
      (a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name) || a.id.localeCompare(b.id)
    );
  }
  out.sort((a, b) => a.interfaceName.localeCompare(b.interfaceName) || a.interfaceId.localeCompare(b.interfaceId));
  return out;
}

export interface EndpointCluster {
  /** 'all' | 'get' | 'mutate' | 'other' | 'ops' (+ '-<n>' chunk suffix). */
  clusterKey: string;
  label: string;
  endpoints: CodeEndpointRow[];
}

function chunkClusters(
  base: string,
  label: string,
  rows: CodeEndpointRow[],
  cap: number
): EndpointCluster[] {
  if (rows.length <= cap) {
    return [{ clusterKey: base, label, endpoints: rows }];
  }
  const clusters: EndpointCluster[] = [];
  for (let i = 0; i < rows.length; i += cap) {
    const n = clusters.length + 1;
    clusters.push({
      clusterKey: `${base}-${n}`,
      label: `${label} (part ${n})`,
      endpoints: rows.slice(i, i + cap),
    });
  }
  return clusters;
}

/**
 * The user-agreed cluster ladder: one story per interface; over the cap ->
 * verb groups (GETs / POSTs+PUTs+PATCH / other verbs); a verb group over the
 * cap -> deterministic path-sorted chunks. SOAP interfaces have no verbs:
 * alphabetical operation chunks ('ops').
 */
export function clusterInterfaceEndpoints(
  group: InterfaceGroup,
  cap: number,
  protocol: 'rest' | 'soap' | 'internal'
): EndpointCluster[] {
  const rows = group.endpoints;
  if (rows.length <= cap) {
    return [{ clusterKey: 'all', label: 'all endpoints', endpoints: rows }];
  }
  if (protocol !== 'rest') {
    return chunkClusters('ops', 'operations', rows, cap);
  }
  const get = rows.filter((r) => r.verb === 'GET');
  const mutate = rows.filter((r) => r.verb === 'POST' || r.verb === 'PUT' || r.verb === 'PATCH');
  const other = rows.filter((r) => !get.includes(r) && !mutate.includes(r));
  return [
    ...(get.length > 0 ? chunkClusters('get', 'GET endpoints', get, cap) : []),
    ...(mutate.length > 0 ? chunkClusters('mutate', 'POST/PUT/PATCH endpoints', mutate, cap) : []),
    ...(other.length > 0 ? chunkClusters('other', 'other-verb endpoints', other, cap) : []),
  ];
}

// ---------------------------------------------------------------------------
// Item factory (DB planner idiom)
// ---------------------------------------------------------------------------

interface ItemSeed {
  id: string;
  type: MigrationBookOfWorkItem['type'];
  parentId: string | null;
  title: string;
  description: string;
  workstream: MigrationBookOfWorkWorkstream;
  sequenceOrder: number;
  acceptanceCriteria?: string[];
  tags?: string[];
  confidence?: MigrationBookOfWorkItem['confidence'];
  readiness?: MigrationBookOfWorkItem['readiness'];
  readinessReasons?: string[];
  missingInputs?: string[];
  recommendedNextAction?: string;
  traceabilitySummary?: string;
  /** Extra non-schema keys carried on the item blob (scaffold precedent). */
  extras?: Record<string, unknown>;
}

function mkItem(seed: ItemSeed): MigrationBookOfWorkItem {
  const item: MigrationBookOfWorkItem = {
    id: seed.id,
    type: seed.type,
    parentId: seed.parentId,
    title: seed.title,
    description: seed.description,
    acceptanceCriteria: seed.acceptanceCriteria ?? [],
    workstream: seed.workstream,
    sequenceOrder: seed.sequenceOrder,
    tags: seed.tags ?? [],
    confidence: seed.confidence ?? 'high',
    readiness: seed.readiness ?? 'ready_for_spec',
    readinessReasons: seed.readinessReasons ?? [],
    missingInputs: seed.missingInputs ?? [],
    // Execution-class aware (2026-08-30). The flat automated default told the
    // operator to "Generate the focused shape-spec" on MANUAL items, which the
    // eligibility filter forbids — a button that could never produce anything.
    recommendedNextAction:
      seed.recommendedNextAction ??
      recommendedNextActionForItem({ tags: seed.tags ?? [] }),
    traceabilitySummary:
      seed.traceabilitySummary ??
      'Derived deterministically from the committed architecture model.',
  };
  return { ...item, ...(seed.extras ?? {}) } as MigrationBookOfWorkItem;
}

function boundedList(values: string[], max = 10): string {
  if (values.length <= max) return values.join(', ');
  return `${values.slice(0, max).join(', ')} (+${values.length - max} more)`;
}

// ---------------------------------------------------------------------------
// Phase 1 — deterministic skeleton per code stream
// ---------------------------------------------------------------------------

export interface BuildCodeStreamSkeletonArgs {
  stream: string;
  view: CodeModelView | null;
  clusterCap: number;
}

/** Stream-level kind. `api_migration` is `api` (REST + SOAP together). */
type StreamKind = 'api' | 'internal';
/** Per-endpoint protocol kind — drives flagging + clustering within a stream. */
type EndpointKind = 'rest' | 'soap' | 'internal';

interface StreamScope {
  kind: StreamKind;
  rows: CodeEndpointRow[];
  partition: CodePartition;
}

function scopeForStream(stream: string, view: CodeModelView): StreamScope {
  const partition = partitionEndpoints(view);
  if (stream === 'internal_processing_implementation') {
    return { kind: 'internal', rows: partition.internal, partition };
  }
  // api_migration (Spec V): ONE generic API stream covering REST + SOAP. The
  // per-endpoint protocol survives as an endpoint/interface kind (below), so
  // SOAP still clusters as operations and flags missing WSDL metadata; the
  // protocol is carried into each generated spec, not split into a stream.
  return { kind: 'api', rows: [...partition.rest, ...partition.soap], partition };
}

/** Per-endpoint protocol kind (drives flagging — e.g. SOAP metadata gaps). */
function rowKind(row: CodeEndpointRow): EndpointKind {
  if (isSoapRow(row)) return 'soap';
  return row.verb === null ? 'internal' : 'rest';
}

/** Per-interface protocol kind (drives clustering: verb-groups vs SOAP ops). */
function interfaceKind(group: InterfaceGroup): 'rest' | 'soap' {
  return group.endpoints.some(isSoapRow) ? 'soap' : 'rest';
}

function assembleSkeleton(
  stream: string,
  items: MigrationBookOfWorkItem[],
  meta: Record<string, unknown>,
  confidence: 'high' | 'low'
): GeneratedMigrationBookOfWork {
  return {
    title: `Deterministic code plan — ${stream}`,
    summary:
      'Generated deterministically from the committed architecture model (no LLM).',
    generationInputs: { codePlanner: meta },
    generationSummary: { generationMode: meta.generationMode, confidence },
    qualityAssessment: {},
    items,
  };
}

function prerequisiteSkeleton(
  stream: string,
  reason: string
): GeneratedMigrationBookOfWork {
  const ws = stream as MigrationBookOfWorkWorkstream;
  const initId = `${stream}-init`;
  const epicId = `${stream}-epic-prereq`;
  const items = [
    mkItem({
      id: initId,
      type: 'initiative',
      parentId: null,
      title: streamTitle(stream),
      description: 'Blocked pending committed code-surface prerequisites.',
      workstream: ws,
      sequenceOrder: 1,
      confidence: 'low',
      readiness: 'blocked',
      readinessReasons: [reason],
      missingInputs: [reason],
      tags: [CODE_PREREQUISITE_TAG],
      recommendedNextAction:
        'Run code discovery, review and COMMIT the endpoint/interface candidates, then regenerate the plan.',
      traceabilitySummary: 'Deterministic prerequisite skeleton (code planner).',
    }),
    mkItem({
      id: epicId,
      type: 'epic',
      parentId: initId,
      title: 'Code discovery prerequisites',
      description: reason,
      workstream: ws,
      sequenceOrder: 2,
      confidence: 'low',
      readiness: 'blocked',
      readinessReasons: [reason],
      missingInputs: [reason],
      tags: [CODE_PREREQUISITE_TAG],
      extras: { codeEpicKind: 'prerequisites' },
    }),
    mkItem({
      id: `${stream}-f-prereq`,
      type: 'feature',
      parentId: epicId,
      title: 'Unblock code-stream planning',
      description: 'Prerequisite work items (expanded deterministically).',
      workstream: ws,
      sequenceOrder: 3,
      confidence: 'low',
      readiness: 'blocked',
      readinessReasons: [reason],
      tags: [CODE_PREREQUISITE_TAG],
      extras: { codeFeatureKind: 'prerequisites', codePrereqReason: reason },
    }),
  ];
  return assembleSkeleton(
    stream,
    items,
    { generationMode: 'deterministic-code-plan-prerequisite', reason },
    'low'
  );
}

function streamTitle(stream: string): string {
  switch (stream) {
    case 'internal_processing_implementation':
      return 'Internal processing implementation (jobs, listeners, batch)';
    case 'api_migration':
    default:
      return 'Target API implementation — REST + SOAP (like-for-like)';
  }
}

/**
 * Build the story-less phase-1 skeleton for ONE code stream. Flags and the
 * baseline-coverage floor are computed HERE and stamped into feature extras;
 * expansion trusts the stamped plan (regenerate = refresh).
 */
export function buildCodeStreamSkeleton(
  args: BuildCodeStreamSkeletonArgs
): GeneratedMigrationBookOfWork {
  const { stream, view, clusterCap } = args;
  const ws = stream as MigrationBookOfWorkWorkstream;

  if (!view) {
    return prerequisiteSkeleton(
      stream,
      'Committed architecture model could not be read (AMS full-model read failed).'
    );
  }
  const scope = scopeForStream(stream, view);
  if (scope.rows.length === 0) {
    if (stream === 'internal_processing_implementation' && view.endpoints.length > 0) {
      // Model HAS endpoints but none classify internal. Since Spec 2026-07-23
      // the save-back COMMITS internal entry-point candidates (previously
      // dropped wholesale as orphans — a scheduler/listener class has no
      // parent interface candidate) and persists their subtype into
      // protocol_metadata_json — so re-scan + commit is a REAL remedy now,
      // not the dead end the old wording papered over.
      return prerequisiteSkeleton(
        stream,
        'No internal (non-HTTP) entry points exist on the committed model. ' +
          'If this app has scheduled jobs / listeners / batch entrypoints: re-run code ' +
          'discovery, COMMIT the internal endpoint candidates at save-back (they land ' +
          'under the synthesized "Internal Processing" interface), then regenerate this ' +
          'plan. If the app genuinely has none, delete this story.'
      );
    }
    return prerequisiteSkeleton(
      stream,
      `No committed ${scope.kind.toUpperCase()} endpoints exist for this stream (protocol partition found 0).`
    );
  }

  const items: MigrationBookOfWorkItem[] = [];
  let seq = 0;
  const next = () => ++seq;
  const baseTags = [CODE_PROVENANCE_TAG, `stream:${stream}`];

  const groups = groupByInterface(scope.rows);
  const flagsById = new Map<string, EndpointFlag[]>();
  for (const row of scope.rows) {
    const flags = flagEndpoint(row, view, rowKind(row));
    if (flags.length > 0) flagsById.set(row.id, flags);
  }
  const flaggedIds = new Set(flagsById.keys());
  const belowFloorGroups = groups.filter((g) =>
    scope.kind === 'internal'
      ? false
      : g.endpoints.some((e) => !view.baselineByEndpointId.has(e.id))
  );

  const initId = `${stream}-init`;
  items.push(
    mkItem({
      id: initId,
      type: 'initiative',
      parentId: null,
      title: streamTitle(stream),
      description: `${scope.rows.length} committed endpoints across ${groups.length} interfaces, planned deterministically.`,
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      traceabilitySummary: `Committed model: ${scope.rows.length} ${scope.kind} endpoints, ${flaggedIds.size} flagged, ${belowFloorGroups.length} interfaces below the baseline-coverage floor.`,
    })
  );

  // Epic 1 — foundations & cross-cutting.
  const foundationsEpicId = `${stream}-epic-foundations`;
  items.push(
    mkItem({
      id: foundationsEpicId,
      type: 'epic',
      parentId: initId,
      title:
        scope.kind === 'internal'
          ? 'Internal processing foundations'
          : 'Foundations & cross-cutting parity',
      description:
        scope.kind === 'internal'
          ? 'Scheduler / queue infrastructure rehoming and shared job conventions.'
          : 'Security/auth parity, serialization & error-mapping conventions, environment wiring.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { codeEpicKind: 'foundations' },
    }),
    mkItem({
      id: `${stream}-f-foundations`,
      type: 'feature',
      parentId: foundationsEpicId,
      title: 'Cross-cutting foundations',
      description: 'Deterministic foundation stories (expanded in phase 2).',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { codeFeatureKind: 'foundations', codeStreamKind: scope.kind },
    })
  );

  // Epic 2 — baseline capture & coverage (REST/SOAP only; Spec G amendment).
  if (scope.kind !== 'internal' && belowFloorGroups.length > 0) {
    const captureEpicId = `${stream}-epic-capture`;
    items.push(
      mkItem({
        id: captureEpicId,
        type: 'epic',
        parentId: initId,
        title: 'Baseline capture & coverage',
        description: `${belowFloorGroups.length} interfaces have endpoints without accepted API-behaviour baselines. Capture work is planned BEFORE implementation (manual-gate stories).`,
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        extras: { codeEpicKind: 'capture' },
      }),
      mkItem({
        id: `${stream}-f-capture`,
        type: 'feature',
        parentId: captureEpicId,
        title: `Capture baselines for ${belowFloorGroups.length} interfaces`,
        description: boundedList(belowFloorGroups.map((g) => g.interfaceName)),
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        extras: {
          codeFeatureKind: 'capture',
          captureInterfaces: belowFloorGroups.map((g) => ({
            apiInterfaceId: g.interfaceId,
            interfaceName: g.interfaceName,
            apiEndpointIds: g.endpoints
              .filter((e) => !view.baselineByEndpointId.has(e.id))
              .map((e) => e.id),
          })),
        },
      })
    );
  }

  // Epic 3 — interface implementation: ONE FEATURE PER INTERFACE.
  const interfacesEpicId = `${stream}-epic-interfaces`;
  items.push(
    mkItem({
      id: interfacesEpicId,
      type: 'epic',
      parentId: initId,
      title:
        scope.kind === 'internal'
          ? `Internal processes (${groups.length} groups)`
          : `Interface implementation (${groups.length} interfaces)`,
      description: `One deterministic cluster story per interface (cap ${clusterCap} endpoints; verb-group split above the cap). Flagged endpoints are extracted to the exceptional epic.`,
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { codeEpicKind: 'interfaces' },
    })
  );
  for (const group of groups) {
    const unflagged = group.endpoints.filter((e) => !flaggedIds.has(e.id));
    items.push(
      mkItem({
        id: `${stream}-f-iface-${group.interfaceId}`,
        type: 'feature',
        parentId: interfacesEpicId,
        title: `${group.interfaceName} — ${group.endpoints.length} endpoints`,
        description: boundedList(group.endpoints.map((e) => e.name)),
        workstream: ws,
        sequenceOrder: next(),
        tags: [...baseTags, `interface:${group.interfaceId}`],
        extras: {
          codeFeatureKind: 'interface',
          codeStreamKind: interfaceKind(group),
          apiInterfaceId: group.interfaceId,
          interfaceName: group.interfaceName,
          apiEndpointIds: unflagged.map((e) => e.id),
          endpointFacts: unflagged.map((e) => ({
            id: e.id,
            name: e.name,
            verb: e.verb,
            path: e.path,
            baselineId: view.baselineByEndpointId.get(e.id) ?? null,
          })),
        },
      })
    );
  }

  // Epic 4 — exceptional endpoints (individual stories).
  if (flaggedIds.size > 0) {
    const exceptionalEpicId = `${stream}-epic-exceptional`;
    const flaggedRows = scope.rows.filter((r) => flaggedIds.has(r.id));
    items.push(
      mkItem({
        id: exceptionalEpicId,
        type: 'epic',
        parentId: initId,
        title: `Exceptional endpoints (${flaggedRows.length})`,
        description: `Endpoints needing individual attention: ${boundedList(flaggedRows.map((r) => r.name))}.`,
        workstream: ws,
        sequenceOrder: next(),
        readiness: 'needs_focused_context',
        readinessReasons: ['Flagged endpoints (missing baseline / findings / SOAP metadata gaps).'],
        tags: baseTags,
        extras: { codeEpicKind: 'exceptional' },
      }),
      mkItem({
        id: `${stream}-f-exceptional`,
        type: 'feature',
        parentId: exceptionalEpicId,
        title: 'Individually-planned endpoints',
        description: 'One deterministic story per flagged endpoint.',
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        extras: {
          codeFeatureKind: 'exceptional',
          codeStreamKind: scope.kind,
          flaggedEndpoints: flaggedRows.map((r) => ({
            id: r.id,
            name: r.name,
            verb: r.verb,
            path: r.path,
            interfaceId: r.interfaceId ?? 'unassigned',
            interfaceName: r.interfaceName,
            flags: flagsById.get(r.id) ?? [],
            baselineId: view.baselineByEndpointId.get(r.id) ?? null,
            findingIds: view.findingIdsByEndpointId.get(r.id) ?? [],
          })),
        },
      })
    );
  }

  // Epic 5 — closure & full-surface parity.
  const closureEpicId = `${stream}-epic-closure`;
  items.push(
    mkItem({
      id: closureEpicId,
      type: 'epic',
      parentId: initId,
      title:
        scope.kind === 'internal'
          ? 'Closure — side-by-side job parity'
          : 'Closure — full-surface parity',
      description:
        scope.kind === 'internal'
          ? 'Side-by-side internal job runs compared via the DB-delta oracle before sign-off.'
          : 'Unscoped replay + diff across the whole stream surface before sign-off.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { codeEpicKind: 'closure' },
    }),
    mkItem({
      id: `${stream}-f-closure`,
      type: 'feature',
      parentId: closureEpicId,
      title: 'Parity sign-off',
      description: 'Deterministic closure story (manual gate).',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { codeFeatureKind: 'closure', codeStreamKind: scope.kind },
    })
  );

  return assembleSkeleton(
    stream,
    items,
    {
      generationMode: 'deterministic-code-plan',
      streamKind: scope.kind,
      endpointCount: scope.rows.length,
      interfaceCount: groups.length,
      flaggedCount: flaggedIds.size,
      belowFloorInterfaceCount: belowFloorGroups.length,
      excludedOutboundCount: scope.partition.excludedOutbound.length,
      internalHeuristicCount: scope.partition.internal.length,
      subtypeNote:
        'internal partition uses the no-HTTP-verb heuristic (endpoint_subtype is not persisted at commit; Spec M completes it)',
    },
    'high'
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — deterministic stories per code epic
// ---------------------------------------------------------------------------

export interface BuildCodeEpicStoriesArgs {
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  stream: string;
  /** Fresh view for the DRIFT check (null = view read failed -> throw). */
  view: CodeModelView | null;
  clusterCap: number;
  maxSequence: number;
}

type FeatureBlob = MigrationBookOfWorkItem & {
  codeFeatureKind?: string;
  codeStreamKind?: 'rest' | 'soap' | 'internal' | 'api';
  codePrereqReason?: string;
  apiInterfaceId?: string;
  interfaceName?: string;
  apiEndpointIds?: string[];
  endpointFacts?: Array<{
    id: string;
    name: string;
    verb: string | null;
    path: string | null;
    baselineId: string | null;
  }>;
  captureInterfaces?: Array<{
    apiInterfaceId: string;
    interfaceName: string;
    apiEndpointIds: string[];
  }>;
  flaggedEndpoints?: Array<{
    id: string;
    name: string;
    verb: string | null;
    path: string | null;
    interfaceId: string;
    interfaceName: string;
    flags: EndpointFlag[];
    baselineId: string | null;
    findingIds: string[];
  }>;
};

const REGENERATE_SUFFIX =
  'The committed model no longer matches the planned skeleton — regenerate the migration plan.';

/**
 * Drift check: the fresh model's endpoint set for this stream must EXACTLY
 * match the skeleton-planned union (interface features + flagged + capture).
 * Both directions throw — a grown model means unplanned endpoints, a shrunk
 * model means stories for endpoints that no longer exist.
 */
export function assertNoModelDrift(
  stream: string,
  plannedIds: Set<string>,
  view: CodeModelView
): void {
  const scope = scopeForStream(stream, view);
  const freshIds = new Set(scope.rows.map((r) => r.id));
  const missing = [...freshIds].filter((id) => !plannedIds.has(id));
  const stale = [...plannedIds].filter((id) => !freshIds.has(id));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `Code plan drift for ${stream}: ${missing.length} unplanned endpoint(s) ` +
        `[${boundedList(missing, 5)}], ${stale.length} planned-but-gone endpoint(s) ` +
        `[${boundedList(stale, 5)}]. ${REGENERATE_SUFFIX}`
    );
  }
}

/** Union of endpoint ids stamped across a stream's interface + exceptional features. */
export function plannedEndpointIdsFromFeatures(features: FeatureBlob[]): Set<string> {
  const ids = new Set<string>();
  for (const f of features) {
    for (const id of f.apiEndpointIds ?? []) ids.add(id);
    for (const row of f.flaggedEndpoints ?? []) ids.add(row.id);
  }
  return ids;
}

function parityAc(count: number): string[] {
  return [
    `Behavioural parity with the captured current-state baseline for all ${count} endpoint(s) in this story: the same request produces the exact same response (verified by the parity loop).`,
  ];
}

/**
 * Deterministic phase-2 stories for ONE code epic. NO LLM on any path.
 * Coverage guarantee: every endpoint id stamped on this epic's features lands
 * in exactly one story, or this throws (epic -> failed, retryable).
 */
export function buildCodeEpicStories(args: BuildCodeEpicStoriesArgs): MigrationBookOfWorkItem[] {
  const { epic, stream, clusterCap, maxSequence } = args;
  const features = args.features as FeatureBlob[];
  const ws = stream as MigrationBookOfWorkWorkstream;
  const baseTags = [CODE_PROVENANCE_TAG, `stream:${stream}`];
  let seq = maxSequence;
  const next = () => ++seq;
  const stories: MigrationBookOfWorkItem[] = [];

  if (args.view === null) {
    throw new Error(
      `Code plan expansion for ${stream}: the committed model could not be read. ` +
        'Retry the expansion once AMS is reachable.'
    );
  }

  const epicKind =
    ((epic as FeatureBlob & { codeEpicKind?: string }).codeEpicKind as string | undefined) ??
    inferEpicKind(features);

  // Drift + duplicate checks run once per INTERFACES epic (the
  // coverage-bearing epic).
  if (epicKind === 'interfaces') {
    // DUPLICATES: an endpoint id stamped on more than one interface feature
    // would yield two stories for one endpoint — corrupt plan, regenerate.
    const seen = new Set<string>();
    for (const f of features) {
      for (const id of f.apiEndpointIds ?? []) {
        if (seen.has(id)) {
          throw new Error(
            `Code plan coverage failure for ${stream}: endpoint ${id} is stamped on more ` +
              `than one interface feature. ${REGENERATE_SUFFIX}`
          );
        }
        seen.add(id);
      }
    }
    // Planned union spans the whole stream: interface features (this epic) +
    // the sibling exceptional/capture features are not visible here, so the
    // planned set is reconstructed from THIS epic's features plus the fresh
    // view's flagged rows — the skeleton stamped unflagged ids only.
    const plannedHere = plannedEndpointIdsFromFeatures(features);
    const scope = scopeForStream(stream, args.view);
    const freshIds = new Set(scope.rows.map((r) => r.id));
    for (const row of scope.rows) {
      if (!plannedHere.has(row.id)) {
        // Row must be one the skeleton flagged (exceptional epic) — verify it
        // WOULD flag under the stamped facts; if it has no flag markers at
        // all, the model has drifted.
        const flags = flagEndpoint(row, args.view, rowKind(row));
        if (flags.length === 0) {
          throw new Error(
            `Code plan drift for ${stream}: endpoint ${row.id} (${row.name}) is not covered ` +
              `by any planned story and carries no flags. ${REGENERATE_SUFFIX}`
          );
        }
      }
    }
    // PLANNED-BUT-GONE: a stamped endpoint no longer on the committed model
    // would produce a story for a dead endpoint — regenerate.
    const gone = [...plannedHere].filter((id) => !freshIds.has(id));
    if (gone.length > 0) {
      throw new Error(
        `Code plan drift for ${stream}: ${gone.length} planned endpoint(s) no longer exist ` +
          `on the committed model [${boundedList(gone, 5)}]. ${REGENERATE_SUFFIX}`
      );
    }
  }

  for (const feature of features) {
    const kind = feature.codeFeatureKind;
    if (kind === 'prerequisites') {
      stories.push(
        mkItem({
          id: `${feature.id}-s-1`,
          type: 'story',
          parentId: feature.id,
          title: 'Resolve code-discovery prerequisites',
          description:
            feature.codePrereqReason ??
            'Run code discovery, review and commit the endpoint/interface candidates, then regenerate the plan.',
          workstream: ws,
          sequenceOrder: next(),
          confidence: 'low',
          readiness: 'blocked',
          readinessReasons: [feature.codePrereqReason ?? 'prerequisites unresolved'],
          missingInputs: [feature.codePrereqReason ?? 'prerequisites unresolved'],
          tags: [CODE_PREREQUISITE_TAG, `stream:${stream}`],
          recommendedNextAction: 'Complete discovery + commit, then regenerate the migration plan.',
        })
      );
      continue;
    }
    if (kind === 'foundations') {
      // 2026-08-15: 'Data access & persistence conventions' added — the live
      // run's biggest scoping gap: 60 endpoint stories all needed database
      // reads, and with no persistence foundation, endpoint story #1 would
      // have invented the pattern for stories #2-60 to copy.
      const foundationTitles =
        feature.codeStreamKind === 'internal'
          ? ['Scheduler & queue infrastructure rehoming']
          : [
              'Security & auth parity foundations',
              'Serialization & error-mapping conventions',
              'Environment & configuration wiring',
              'Data access & persistence conventions',
            ];
      const foundationDescriptions: Record<string, string> = {
        'Data access & persistence conventions':
          'The ONE data-access pattern every endpoint and internal-process ' +
          'story consumes: the repository/DAO layer shape, the concrete access ' +
          'technology per the captured db.* decisions (driver, connection ' +
          'pool), transaction demarcation per db.transactionStrategy, and ' +
          'read-replica routing per db.readReplicaUsage. Establish the ' +
          'package home + one worked reference repository so implementation ' +
          'stories copy an existing convention instead of inventing one.',
      };
      foundationTitles.forEach((title, i) => {
        stories.push(
          mkItem({
            id: `${feature.id}-s-${i + 1}`,
            type: 'story',
            parentId: feature.id,
            title,
            description:
              foundationDescriptions[title] ??
              `${title} for the ${streamTitle(stream)} stream (cross-cutting; applies to every interface story).`,
            workstream: ws,
            sequenceOrder: next(),
            tags: baseTags,
            extras: { codeStoryKind: 'foundation' },
          })
        );
      });
      continue;
    }
    if (kind === 'capture') {
      (feature.captureInterfaces ?? []).forEach((ci, i) => {
        stories.push(
          mkItem({
            id: `${feature.id}-s-${i + 1}`,
            type: 'story',
            parentId: feature.id,
            title: `Capture API behaviour baseline — ${ci.interfaceName}`,
            description:
              `Run capture sessions against the CURRENT system until every endpoint of ${ci.interfaceName} ` +
              `has accepted canonical captures (${ci.apiEndpointIds.length} endpoint(s) currently uncovered). ` +
              'Manual-gate work: performed via the capture wizard, never dispatched to the implement service.',
            workstream: ws,
            sequenceOrder: next(),
            acceptanceCriteria: [
              `Coverage floor met for all ${ci.apiEndpointIds.length} uncovered endpoint(s) of ${ci.interfaceName}.`,
            ],
            tags: [...baseTags, MANUAL_GATE_TAG, MANUAL_EXECUTION_TAG, `interface:${ci.apiInterfaceId}`],
            extras: {
              codeStoryKind: 'capture',
              captureWork: true,
              apiInterfaceId: ci.apiInterfaceId,
              apiEndpointIds: ci.apiEndpointIds,
            },
          })
        );
      });
      continue;
    }
    if (kind === 'interface') {
      const facts = feature.endpointFacts ?? [];
      if (facts.length === 0) {
        // Every endpoint of this interface was flagged (individual stories in
        // the exceptional epic) — the cluster feature legitimately yields no
        // story. Coverage holds: 0 facts, 0 stories.
        continue;
      }
      const rows: CodeEndpointRow[] = facts.map((f) => ({
        id: f.id,
        name: f.name,
        interfaceId: feature.apiInterfaceId ?? 'unassigned',
        interfaceName: feature.interfaceName ?? '(interface)',
        interfaceType: '',
        endpointType: '',
        protocol: '',
        verb: f.verb,
        path: f.path,
        direction: 'inbound',
        hasProtocolMetadata: true,
      }));
      const group: InterfaceGroup = {
        interfaceId: feature.apiInterfaceId ?? 'unassigned',
        interfaceName: feature.interfaceName ?? '(interface)',
        endpoints: rows,
      };
      const clusters = clusterInterfaceEndpoints(
        group,
        clusterCap,
        feature.codeStreamKind === 'soap' ? 'soap' : 'rest',
      );
      const covered = new Set<string>();
      clusters.forEach((cluster, i) => {
        cluster.endpoints.forEach((e) => covered.add(e.id));
        const baselineByEndpointId: Record<string, string | null> = {};
        for (const e of cluster.endpoints) {
          const fact = facts.find((f) => f.id === e.id);
          baselineByEndpointId[e.id] = fact?.baselineId ?? null;
        }
        stories.push(
          mkItem({
            id: `${feature.id}-s-${i + 1}`,
            type: 'story',
            parentId: feature.id,
            title:
              clusters.length === 1
                ? `Implement ${group.interfaceName} (${cluster.endpoints.length} endpoints)`
                : `Implement ${group.interfaceName} — ${cluster.label} (${cluster.endpoints.length})`,
            description: boundedList(cluster.endpoints.map((e) => e.name)),
            workstream: ws,
            sequenceOrder: next(),
            acceptanceCriteria: parityAc(cluster.endpoints.length),
            tags: [...baseTags, `interface:${group.interfaceId}`],
            extras: {
              codeStoryKind: 'interface-cluster',
              apiInterfaceId: group.interfaceId,
              apiEndpointIds: cluster.endpoints.map((e) => e.id),
              baselineByEndpointId,
              verbGroup: cluster.clusterKey,
              protocol: feature.codeStreamKind ?? 'rest',
            },
          })
        );
      });
      // Coverage guarantee within the feature.
      const missing = facts.filter((f) => !covered.has(f.id)).map((f) => f.id);
      if (missing.length > 0 || covered.size !== facts.length) {
        throw new Error(
          `Code plan coverage failure for ${stream} / ${group.interfaceName}: ` +
            `${missing.length} endpoint(s) not covered by any cluster story ` +
            `[${boundedList(missing, 5)}]. ${REGENERATE_SUFFIX}`
        );
      }
      continue;
    }
    if (kind === 'exceptional') {
      const flagged = feature.flaggedEndpoints ?? [];
      flagged.forEach((row, i) => {
        const blockedOnBaseline = row.flags.includes('missing_baseline');
        stories.push(
          mkItem({
            id: `${feature.id}-s-${i + 1}`,
            type: 'story',
            parentId: feature.id,
            title: `Implement ${row.name} (exceptional: ${row.flags.join(', ')})`,
            description:
              `${row.interfaceName} endpoint requiring individual attention. Flags: ${row.flags.join(', ')}.` +
              (row.findingIds.length > 0
                ? ` Attached findings: ${row.findingIds.join(', ')}.`
                : ''),
            workstream: ws,
            sequenceOrder: next(),
            acceptanceCriteria: parityAc(1),
            confidence: 'medium',
            readiness: blockedOnBaseline ? 'needs_focused_context' : 'ready_for_spec',
            readinessReasons: blockedOnBaseline
              ? ['No accepted baseline yet — capture story precedes this one.']
              : [],
            tags: [...baseTags, `interface:${row.interfaceId}`],
            extras: {
              codeStoryKind: 'exceptional-endpoint',
              apiInterfaceId: row.interfaceId,
              apiEndpointIds: [row.id],
              flagReason: row.flags.join(','),
              baselineByEndpointId: { [row.id]: row.baselineId },
              findingIds: row.findingIds,
            },
          })
        );
      });
      // Coverage: one story per flagged endpoint, exactly.
      if (flagged.length !== stories.filter((s) => s.parentId === feature.id).length) {
        throw new Error(
          `Code plan coverage failure for ${stream}: flagged-endpoint stories mismatch. ${REGENERATE_SUFFIX}`
        );
      }
      continue;
    }
    if (kind === 'closure') {
      stories.push(
        mkItem({
          id: `${feature.id}-s-1`,
          type: 'story',
          parentId: feature.id,
          title:
            feature.codeStreamKind === 'internal'
              ? 'Side-by-side internal job parity sweep'
              : 'Full-surface parity verification sweep',
          description:
            feature.codeStreamKind === 'internal'
              ? 'Run every internal process on current and target with pinned inputs and compare DB deltas + outputs (Spec M oracle). Sign off the stream.'
              : 'Unscoped replay of the full baseline against the target followed by a clean diff (no non-waived drift). Sign off the stream.',
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            feature.codeStreamKind === 'internal'
              ? 'Every internal process shows identical DB deltas and outputs on current and target.'
              : 'An UNSCOPED diff over the full stream surface is clean or every remaining difference carries an explicit waiver.',
          ],
          tags: [...baseTags, MANUAL_GATE_TAG, MANUAL_EXECUTION_TAG],
          extras: { codeStoryKind: 'closure' },
        })
      );
      continue;
    }
    // Unknown feature kind on a code epic: fail loudly (never guess).
    throw new Error(
      `Code plan expansion for ${stream}: feature ${feature.id} has unknown codeFeatureKind ` +
        `'${String(kind)}'. ${REGENERATE_SUFFIX}`
    );
  }

  return stories;
}

function inferEpicKind(features: FeatureBlob[]): string {
  const kinds = new Set(features.map((f) => f.codeFeatureKind).filter(Boolean));
  if (kinds.has('interface')) return 'interfaces';
  if (kinds.has('capture')) return 'capture';
  if (kinds.has('exceptional')) return 'exceptional';
  if (kinds.has('closure')) return 'closure';
  if (kinds.has('prerequisites')) return 'prerequisites';
  return 'foundations';
}
