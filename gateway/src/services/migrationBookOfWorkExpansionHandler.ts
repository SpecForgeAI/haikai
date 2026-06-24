/**
 * Gateway phase-2 expansion orchestration for the Migration Delivery Plan.
 *
 * Spec: 2026-06-11 Two-Phase Migration Delivery Plan Generation
 * (Skeleton → Expand) — Task Group 4.
 *
 * Phase 1 (migrationBookOfWorkHandler.ts) produces a story-less
 * initiative → epic → feature skeleton with every epic seeded
 * `expansionState='not_expanded'`. THIS module expands ONE epic at a time
 * into detailed stories, atomically, with the per-epic pipeline:
 *
 *   fetch real inventory (AMS architecture MODEL via architectureModelClient
 *     — the same source the shape-spec stage uses; the summary-level
 *     Migration Discovery Context is NOT the batching source)
 *   → deterministic partition into batches of
 *     MIGRATION_PLAN_EXPANSION_BATCH_SIZE (computed in code BEFORE any LLM
 *     call — predictive sizing from counts, never reactive timeout discovery)
 *   → one expansion LLM call per batch (templates per work type +
 *     standard/exceptional classification + bespoke stories for exceptions),
 *     run through the ONE shared bounded-concurrency pool
 *   → template stamping across standard items IN CODE with real model facts
 *   → layered verification (layers 1-3 below; layer 4 = the EXISTING
 *     downstream per-story shape-spec stage — the implementation-correctness
 *     safety net; nothing is built for it here, by design)
 *   → ONE atomic append per epic via the AMS `items/append` merge endpoint.
 *
 * Layered verification:
 *   Layer 1 (blocking, deterministic): code-level referential checks on every
 *     stamped item — the inventory item exists in the fetched model facts,
 *     the cited baseline resolves, data-effect entities/mappings resolve.
 *     The stamping substitutions are drawn from the SAME facts these checks
 *     validate, so a passing check guarantees a correct stamp.
 *   Layer 2 (code overrides): items with attached findings, live conflicts,
 *     missing baselines, complex SOAP message schemas, or readiness other
 *     than `ready_for_spec` are ALWAYS routed to the bespoke LLM path,
 *     regardless of the LLM's classification.
 *   Layer 3 (LLM judge): ONE verdict-only judge call per stamped batch;
 *     flagged items are re-routed to the bespoke path and rewritten
 *     individually. Judge transport/validation failure after one retry →
 *     epic `failed` (retryable); a flagged item's bespoke rewrite failing
 *     after retry → epic `failed` (retryable). Unverified stamped content
 *     NEVER silently lands in the draft.
 *   Layer 4: the existing downstream per-story shape-spec generation stage
 *     (migrationShapeSpecGenerationHandler.ts) re-derives every story's
 *     implementation detail from the model at spec time — it is the final
 *     implementation-correctness safety net. NOTHING is built for it here.
 *
 * Per-epic state machine (the ONE shared shape from
 * generatedMigrationBookOfWorkSchema.ts, persisted INSIDE book_of_work_json
 * via the AMS items/append merge — the draft document is the single source
 * of truth across page reloads):
 *
 *   not_expanded → expanding → expanded | failed
 *
 *   - `failed` is retryable and re-runs ONLY that epic;
 *   - `expanded` is terminal (never re-expanded);
 *   - stale `expanding` (gateway restarted mid-expansion — persisted state
 *     with no live in-process pipeline) is treated as retryable.
 *
 * Atomicity: stories land via ONE append per epic, only after the epic's
 * FULL pipeline (all batches + verification) succeeds. A failed epic leaves
 * every other epic's stories intact. The `expanding` / `failed` transitions
 * persist via STATE-ONLY appends (empty items array) on the same endpoint.
 *
 * ALL LLM calls (expansion batches, judge passes, bespoke rewrites,
 * non-inventory single calls) run through the ONE shared
 * bounded-concurrency pool (`getMigrationPlanLlmPool`) — total in-flight LLM
 * requests never exceed MIGRATION_PLAN_LLM_CONCURRENCY regardless of how
 * many epics expand concurrently during "Expand all".
 */

import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config';
import { logger } from './logger';
import { extractJson } from './plannerResponseValidator';
import {
  MigrationBookOfWorkItem,
  MigrationBookOfWorkExpansionState,
  MigrationBookOfWorkWorkstream,
  MIGRATION_BOOK_OF_WORK_WORKSTREAMS,
  validateBookOfWorkHierarchy,
  validateMigrationBookOfWorkItem,
} from './generatedMigrationBookOfWorkSchema';
import {
  ExpansionBatchResponse,
  ExpansionStoryTemplate,
  validateBespokeStoryResponse,
  validateExpansionBatchResponse,
  validateJudgeResponse,
  validateNonInventoryExpansionResponse,
} from './migrationBookOfWorkExpansionValidators';
import { LlmCallerFn } from './migrationBookOfWorkHandler';
import { LlmConcurrencyPool, getMigrationPlanLlmPool } from './llmConcurrencyPool';
import { getElementsInventory } from './architectureModelClient';
import { fetchMigrationDiscoveryContext } from './migrationDiscoveryContextClient';
import { fetchEndpointBaselineCoverage } from './apiBehaviourBaselineCoverageClient';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Work-type discriminator for inventory-driven stories. */
export type InventoryWorkItemKind = 'api_endpoint' | 'db_table';

/**
 * One authoritative inventory item (API endpoint or database table) from the
 * AMS architecture model, enriched with the model facts the stamping
 * substitutions AND the layer-1 referential checks both draw from.
 */
export interface InventoryWorkItem {
  /** Stable model element id (batching sort key, story identity). */
  id: string;
  /** Display name, e.g. `GET /customers/{id}` or `customers`. */
  name: string;
  kind: InventoryWorkItemKind;
  /** HTTP method (endpoints; parsed from the model name when available). */
  method?: string | null;
  /** Endpoint path (endpoints). */
  path?: string | null;
  /** Resolved API Behaviour Baseline id; null/absent = MISSING baseline. */
  baselineId?: string | null;
  /** Discovery finding ids attached to this element. */
  attachedFindingIds?: string[];
  /** True when the element has a live (unresolved) conflict. */
  hasLiveConflict?: boolean;
  /** True for complex SOAP message schemas. */
  isComplexSoap?: boolean;
  /** Element readiness; anything other than `ready_for_spec` → bespoke. */
  readiness?: string | null;
  /** Data-effect entity names/ids touched by this item. */
  dataEntities?: string[];
  /** Current→target mapping ids relevant to this item. */
  mappingIds?: string[];
}

export interface ExpandEpicInput {
  projectId: string;
  bookId: string;
  epicId: string;
}

export interface ExpandEpicOutcome {
  epicId: string;
  expansionState: Extract<MigrationBookOfWorkExpansionState, 'expanded' | 'failed'>;
  storiesAppended: number;
  error?: string;
}

export interface ExpandAllOutcome {
  results: ExpandEpicOutcome[];
  /** Epics NOT expanded by this run, with the reason. */
  skipped: Array<{ epicId: string; expansionState?: string; reason: string }>;
}

/** Parsed view of the AMS book draft the expansion pipeline needs. */
export interface FetchedBookOfWork {
  bookId: string;
  status: string;
  currentArchitectureId: string | null;
  targetArchitectureId: string | null;
  items: MigrationBookOfWorkItem[];
}

/** Body of the AMS items/append merge call (snake_case wire — see AMS DTO). */
export interface AppendItemsRequestBody {
  epic_id: string;
  items: MigrationBookOfWorkItem[];
  expansion_state: MigrationBookOfWorkExpansionState;
}

export type FetchBookFn = (projectId: string, bookId: string) => Promise<FetchedBookOfWork>;
export type AppendItemsFn = (
  projectId: string,
  bookId: string,
  body: AppendItemsRequestBody
) => Promise<void>;
export type FetchEpicInventoryFn = (args: {
  projectId: string;
  currentArchitectureId: string | null;
  targetArchitectureId: string | null;
  stream: string;
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
}) => Promise<InventoryWorkItem[]>;

export interface MigrationBookOfWorkExpansionDeps {
  fetchBook?: FetchBookFn;
  appendItems?: AppendItemsFn;
  fetchEpicInventory?: FetchEpicInventoryFn;
  callLlm?: LlmCallerFn;
  /** Defaults to the ONE shared migration-plan pool. */
  llmPool?: LlmConcurrencyPool;
  systemPromptOverride?: string;
  /** Defaults to config `migrationPlanExpansionBatchSize` (env knob). */
  batchSizeOverride?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Precondition failures the route maps to a specific HTTP status. */
export class ExpansionPreconditionError extends Error {
  public readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ExpansionPreconditionError';
    this.statusCode = statusCode;
  }
}

/** Non-2xx from an AMS call — the route round-trips status + body. */
export class AmsRoundTripError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`AMS returned ${status}: ${body || '<empty body>'}`);
    this.name = 'AmsRoundTripError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// In-flight registry — distinguishes a LIVE `expanding` pipeline from a STALE
// persisted `expanding` state (gateway restarted mid-expansion). Stale
// `expanding` is retryable; a live one is skipped.
// ---------------------------------------------------------------------------

const activeExpansions = new Set<string>();

function activeKey(bookId: string, epicId: string): string {
  return `${bookId}::${epicId}`;
}

/** Test seam: clear the in-process in-flight registry. */
export function resetActiveExpansionsForTests(): void {
  activeExpansions.clear();
}

// ---------------------------------------------------------------------------
// State-machine helpers (4.2)
// ---------------------------------------------------------------------------

export interface ExpandableEpicSelection {
  expandable: Array<{
    epicId: string;
    previousState: MigrationBookOfWorkExpansionState | undefined;
    reason: 'not_expanded' | 'failed' | 'stale_expanding';
  }>;
  skipped: Array<{ epicId: string; expansionState?: string; reason: string }>;
}

/**
 * Selects the epics "Expand all" should run: `not_expanded` (including epics
 * with no state — pre-feature drafts), `failed` (retryable), and STALE
 * `expanding` (persisted state with no live in-process pipeline). `expanded`
 * epics are terminal and never re-expanded; live `expanding` epics are
 * skipped so a double-click cannot double-run a pipeline.
 */
export function selectExpandableEpics(
  bookId: string,
  items: MigrationBookOfWorkItem[]
): ExpandableEpicSelection {
  const expandable: ExpandableEpicSelection['expandable'] = [];
  const skipped: ExpandableEpicSelection['skipped'] = [];
  for (const item of items) {
    if (item.type !== 'epic') continue;
    const state = item.expansionState;
    if (state === 'expanded') {
      skipped.push({ epicId: item.id, expansionState: state, reason: 'already expanded (terminal)' });
      continue;
    }
    if (state === 'expanding') {
      if (activeExpansions.has(activeKey(bookId, item.id))) {
        skipped.push({ epicId: item.id, expansionState: state, reason: 'expansion in flight' });
      } else {
        // Stale `expanding` — the gateway restarted mid-expansion. Retryable.
        expandable.push({ epicId: item.id, previousState: state, reason: 'stale_expanding' });
      }
      continue;
    }
    if (state === 'failed') {
      expandable.push({ epicId: item.id, previousState: state, reason: 'failed' });
      continue;
    }
    // `not_expanded` or absent (legacy drafts created before this feature).
    expandable.push({ epicId: item.id, previousState: state, reason: 'not_expanded' });
  }
  return { expandable, skipped };
}

// ---------------------------------------------------------------------------
// Deterministic inventory batching (4.3)
// ---------------------------------------------------------------------------

/**
 * Stable, deterministic sort key: kind, then path-or-name, then id. The same
 * inventory ALWAYS yields the same order (and therefore the same batches),
 * input order notwithstanding.
 */
function inventorySortKey(item: InventoryWorkItem): string {
  return `${item.kind} ${item.path ?? item.name} ${item.id}`;
}

/**
 * Partition the inventory into deterministic batches of `batchSize`
 * (MIGRATION_PLAN_EXPANSION_BATCH_SIZE, default 12) BEFORE any LLM call —
 * predictive sizing from counts, never reactive timeout discovery.
 */
export function partitionInventory(
  items: InventoryWorkItem[],
  batchSize: number
): InventoryWorkItem[][] {
  const size = Number.isFinite(batchSize) && Math.floor(batchSize) >= 1 ? Math.floor(batchSize) : 12;
  const sorted = [...items].sort((a, b) =>
    inventorySortKey(a) < inventorySortKey(b) ? -1 : inventorySortKey(a) > inventorySortKey(b) ? 1 : 0
  );
  const batches: InventoryWorkItem[][] = [];
  for (let i = 0; i < sorted.length; i += size) {
    batches.push(sorted.slice(i, i + size));
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Layer-2 hard-wired bespoke overrides (4.5)
// ---------------------------------------------------------------------------

/**
 * Returns the override reason when an item must ALWAYS take the bespoke LLM
 * path regardless of the LLM's standard/exceptional classification, else null.
 */
export function bespokeOverrideReason(item: InventoryWorkItem): string | null {
  if ((item.attachedFindingIds?.length ?? 0) > 0) return 'attached_finding';
  if (item.hasLiveConflict) return 'live_conflict';
  if (item.kind === 'api_endpoint' && !item.baselineId) return 'missing_baseline';
  if (item.isComplexSoap) return 'complex_soap';
  if (item.readiness && item.readiness !== 'ready_for_spec') return 'not_ready_for_spec';
  return null;
}

// ---------------------------------------------------------------------------
// Template stamping (4.4)
// ---------------------------------------------------------------------------

/** Deterministic story id for an inventory item under its epic. */
export function storyIdForInventoryItem(epicId: string, inventoryItemId: string): string {
  // Stays consistent with the `<stream>:<id>` namespacing convention: epicId
  // is already `<stream>:<localId>`, so the story id keeps the stream prefix.
  return `${epicId}-s-${inventoryItemId}`;
}

/**
 * Substitute real model facts into a template string. Supported placeholders
 * (case-insensitive): {method} {METHOD} {path} {name} {table} {baselineId}
 * {baseline_id} {id} (= baseline id when resolved, else element id)
 * {entities} {mappings}.
 */
export function substituteTemplate(template: string, item: InventoryWorkItem): string {
  const lookup: Record<string, string> = {
    method: (item.method ?? '').toUpperCase(),
    path: item.path ?? item.name,
    name: item.name,
    table: item.name,
    baselineid: item.baselineId ?? '',
    baseline_id: item.baselineId ?? '',
    id: item.baselineId ?? item.id,
    entities: (item.dataEntities ?? []).join(', '),
    mappings: (item.mappingIds ?? []).join(', '),
  };
  return template.replace(/\{([a-zA-Z_]+)\}/g, (match, token: string) => {
    const key = token.toLowerCase();
    return key in lookup ? lookup[key] : match;
  });
}

function workstreamForEpic(epic: MigrationBookOfWorkItem): MigrationBookOfWorkWorkstream {
  return (MIGRATION_BOOK_OF_WORK_WORKSTREAMS as readonly string[]).includes(epic.workstream)
    ? epic.workstream
    : 'unknown';
}

/** Default templated acceptance criterion per work type, always stamped. */
function defaultAcceptanceCriterion(item: InventoryWorkItem): string {
  if (item.kind === 'api_endpoint') {
    return substituteTemplate(
      'Behavioural parity with baseline {baselineId} for {METHOD} {path}',
      item
    );
  }
  return substituteTemplate(
    'Schema migration for table {table} preserves all columns, constraints, and data',
    item
  );
}

/**
 * Stamp ONE template across ONE standard inventory item IN CODE, substituting
 * real model facts — the SAME facts the layer-1 referential checks validate,
 * so a passing check guarantees a correct stamp. The result is a full
 * `MigrationBookOfWorkItem` story with a SMALL set of templated acceptance
 * criteria; deep implementation detail stays with the downstream shape-spec
 * stage (verification layer 4).
 */
export function stampStoryFromTemplate(
  template: ExpansionStoryTemplate,
  item: InventoryWorkItem,
  ctx: {
    stream: string;
    epic: MigrationBookOfWorkItem;
    parentFeatureId: string;
    sequenceOrder: number;
  }
): MigrationBookOfWorkItem {
  const acceptanceCriteria = template.acceptanceCriteriaTemplates.map((t) =>
    substituteTemplate(t, item)
  );
  const defaultAc = defaultAcceptanceCriterion(item);
  if (!acceptanceCriteria.some((ac) => item.baselineId && ac.includes(item.baselineId))) {
    // Guarantee the parity criterion carries the verified fact set even when
    // the LLM template omitted the baseline placeholder.
    if (!acceptanceCriteria.includes(defaultAc)) acceptanceCriteria.push(defaultAc);
  }
  const facts: string[] = [`model element ${item.id} (${item.name})`];
  if (item.baselineId) facts.push(`API behaviour baseline ${item.baselineId}`);
  if ((item.dataEntities?.length ?? 0) > 0) {
    facts.push(`data-effect entities: ${item.dataEntities!.join(', ')}`);
  }
  return {
    id: storyIdForInventoryItem(ctx.epic.id, item.id),
    type: 'story',
    parentId: ctx.parentFeatureId,
    title: substituteTemplate(template.titleTemplate, item),
    description: substituteTemplate(template.descriptionTemplate, item),
    acceptanceCriteria,
    workstream: workstreamForEpic(ctx.epic),
    sequenceOrder: ctx.sequenceOrder,
    // Provenance: stamped-in-code, mirroring the `stream:<name>` per-item tag
    // convention from the per-stream assembly.
    tags: [`stream:${ctx.stream}`, 'provenance:stamped', `inventory:${item.id}`],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: 'Generate the focused shape-spec for this story.',
    traceabilitySummary: `Stamped in code from the ${template.workType} story template using verified model facts: ${facts.join('; ')}.`,
    architectureReferences: [item.id],
    apiBaselineReferences: item.baselineId ? [item.baselineId] : [],
  };
}

// ---------------------------------------------------------------------------
// Layer-1 referential checks (4.5) — deterministic, BLOCKING
// ---------------------------------------------------------------------------

/**
 * Code-level referential checks on every stamped story: the inventory item
 * exists in the fetched model facts, the cited baseline resolves to THAT
 * item's baseline, and data-effect entity references resolve. Any error
 * blocks the epic (→ `failed`); unverified stamped content never lands.
 */
export function runReferentialChecks(
  stamped: Array<{ story: MigrationBookOfWorkItem; inventoryItemId: string }>,
  factsById: ReadonlyMap<string, InventoryWorkItem>
): string[] {
  const errors: string[] = [];
  for (const { story, inventoryItemId } of stamped) {
    const item = factsById.get(inventoryItemId);
    if (!item) {
      errors.push(
        `story ${story.id}: inventory item ${inventoryItemId} does not exist in the architecture model inventory`
      );
      continue;
    }
    for (const ref of story.architectureReferences ?? []) {
      if (ref !== item.id) {
        errors.push(`story ${story.id}: architecture reference ${ref} does not resolve to model element ${item.id}`);
      }
    }
    if (item.kind === 'api_endpoint') {
      if (!item.baselineId) {
        errors.push(
          `story ${story.id}: stamped API endpoint ${item.id} has no resolvable API behaviour baseline`
        );
      } else {
        for (const ref of story.apiBaselineReferences ?? []) {
          if (ref !== item.baselineId) {
            errors.push(
              `story ${story.id}: baseline reference ${ref} does not resolve to baseline ${item.baselineId}`
            );
          }
        }
      }
    }
    // Data-effect entities/mappings cited by the story must resolve in the
    // SAME model facts the stamp was built from.
    const knownMappings = new Set(item.mappingIds ?? []);
    for (const ref of story.mappingReferences ?? []) {
      if (!knownMappings.has(ref)) {
        errors.push(`story ${story.id}: mapping reference ${ref} does not resolve in the model facts`);
      }
    }
    const knownFindings = new Set(item.attachedFindingIds ?? []);
    for (const ref of story.discoveryFindingReferences ?? []) {
      if (!knownFindings.has(ref)) {
        errors.push(`story ${story.id}: finding reference ${ref} does not resolve in the model facts`);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Defaults — production wiring
// ---------------------------------------------------------------------------

function readDefaultSystemPrompt(): string {
  const promptPath = path.resolve(
    __dirname,
    '..',
    'config',
    'prompts',
    'product-manager.migration-delivery-plan.task.md'
  );
  return fs.readFileSync(promptPath, 'utf-8');
}

const defaultCallLlm: LlmCallerFn = async ({ systemPrompt, userPrompt, projectId }) => {
  // Lazy-import to keep tests cleanly mockable (mirrors the phase-1 handler).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `pm-migration-plan-expansion-${Date.now()}`,
    `pm-migration-plan-expansion-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultFetchBook: FetchBookFn = async (projectId, bookId) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await response.text().catch(() => '');
  if (response.status === 404) {
    throw new ExpansionPreconditionError(404, `Migration book of work ${bookId} not found`);
  }
  if (!response.ok) {
    throw new AmsRoundTripError(response.status, text);
  }
  const dto = JSON.parse(text) as {
    status?: string;
    current_architecture_id?: string | null;
    target_architecture_id?: string | null;
    book_of_work_json?: { items?: unknown[] } | null;
  };
  const items = Array.isArray(dto.book_of_work_json?.items)
    ? (dto.book_of_work_json!.items as MigrationBookOfWorkItem[])
    : [];
  return {
    bookId,
    status: dto.status ?? '',
    currentArchitectureId: dto.current_architecture_id ?? null,
    targetArchitectureId: dto.target_architecture_id ?? null,
    items,
  };
};

const defaultAppendItems: AppendItemsFn = async (projectId, bookId, body) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/items/append`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AmsRoundTripError(response.status, text);
  }
};

/**
 * Stream → authoritative model-inventory source. Streams with no entry are
 * NON-INVENTORY epics (cutover, reconciliation, test pack, ...) and expand
 * via a single whole-epic LLM call — no batching/stamping/judge machinery
 * where one call already fits.
 */
const INVENTORY_STREAM_SOURCES: Record<
  string,
  { domain: string; types: string[]; kind: InventoryWorkItemKind }
> = {
  target_service_api_implementation: {
    domain: 'Applications',
    types: ['Endpoints'],
    kind: 'api_endpoint',
  },
  api_soap_integration_compatibility: {
    domain: 'Applications',
    types: ['Endpoints'],
    kind: 'api_endpoint',
  },
  target_database_schema_implementation: {
    domain: 'Data',
    types: ['Physical Data Entities'],
    kind: 'db_table',
  },
  data_migration: {
    domain: 'Data',
    types: ['Physical Data Entities'],
    kind: 'db_table',
  },
};

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i;

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Default inventory assembler: the authoritative endpoint/table list comes
 * from the AMS architecture MODEL via `getElementsInventory` (the same model
 * source the shape-spec stage uses) against the CURRENT architecture — the
 * like-for-like migration inventory is "everything that exists today".
 * The summary-level Migration Discovery Context is used ONLY for best-effort
 * baseline/finding fact enrichment, never as the batching source
 * (`migrationDiscoveryContextClient` itself is unchanged).
 *
 * Enrichment is deliberately conservative: an endpoint whose baseline cannot
 * be resolved keeps `baselineId=null`, which the layer-2 override routes to
 * the bespoke path (`missing_baseline`) — unverifiable facts are never
 * stamped.
 *
 * Baseline resolution uses the CANONICAL AMS endpoint→baseline coverage join
 * (`fetchEndpointBaselineCoverage`, keyed by the endpoint element id) — NOT
 * the old baseline-NAME substring match, which never matched a descriptively
 * named baseline and so reported every endpoint as "missing baseline" even at
 * full capture coverage. Finding attachment is a separate best-effort pass.
 */
const defaultFetchEpicInventory: FetchEpicInventoryFn = async ({
  projectId,
  currentArchitectureId,
  targetArchitectureId,
  stream,
}) => {
  const source = INVENTORY_STREAM_SOURCES[stream];
  const architectureId = currentArchitectureId ?? targetArchitectureId;
  if (!source || !architectureId) return [];

  const inventory = await getElementsInventory(projectId, architectureId);
  const items: InventoryWorkItem[] = [];
  for (const domain of inventory.domains ?? []) {
    if (domain.name !== source.domain) continue;
    for (const type of domain.types ?? []) {
      if (!source.types.includes(type.name)) continue;
      for (const instance of type.instances ?? []) {
        const match = HTTP_METHOD_PATTERN.exec(instance.name ?? '');
        items.push({
          id: instance.id,
          name: instance.name,
          kind: source.kind,
          method: match ? match[1].toUpperCase() : null,
          path: match ? match[2] : null,
          baselineId: null,
          attachedFindingIds: [],
        });
      }
    }
  }

  // Baseline + finding enrichment applies ONLY to API endpoints (database
  // tables have no baseline concept). Both passes are best-effort: a failure
  // degrades the affected endpoints to the conservative bespoke path and never
  // blocks expansion.
  if (items.length > 0 && source.kind === 'api_endpoint') {
    // Baselines: canonical endpoint→baseline coverage from AMS, joined by the
    // endpoint element id (matches the inventory instance id).
    try {
      const coverage = await fetchEndpointBaselineCoverage(projectId, architectureId);
      for (const item of items) {
        const baselineId = coverage.get(item.id);
        if (baselineId) item.baselineId = baselineId;
      }
    } catch (error) {
      logger.warn('Expansion baseline coverage lookup failed; endpoints stay conservative (bespoke path)', {
        projectId,
        stream,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Findings: best-effort attachment by title/summary mention of the
    // endpoint name (unchanged heuristic; drives the `attached_finding`
    // bespoke override).
    try {
      const context = await fetchMigrationDiscoveryContext(projectId, {
        currentArchitectureId: currentArchitectureId ?? architectureId,
        targetArchitectureId: targetArchitectureId ?? undefined,
      });
      const findings = context.highPriorityFindings ?? [];
      for (const item of items) {
        const needle = normalise(item.name);
        item.attachedFindingIds = findings
          .filter((f) => normalise(`${f.title} ${f.summary ?? ''}`).includes(needle))
          .map((f) => f.findingId);
      }
    } catch (error) {
      logger.warn('Expansion finding enrichment failed; items stay conservative (bespoke path)', {
        projectId,
        stream,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return items;
};

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function describeEpic(epic: MigrationBookOfWorkItem, features: MigrationBookOfWorkItem[]): string {
  const lines: string[] = [];
  lines.push(`Epic id: ${epic.id}`);
  lines.push(`Epic title: ${epic.title}`);
  lines.push(`Epic description: ${epic.description}`);
  lines.push(`Workstream: ${epic.workstream}`);
  lines.push('Existing feature ids (the ONLY legal story parents):');
  for (const f of features) {
    lines.push(`  - ${f.id} — ${f.title}`);
  }
  return lines.join('\n');
}

function describeInventoryItem(item: InventoryWorkItem): string {
  const parts = [
    `id=${item.id}`,
    `kind=${item.kind}`,
    `name=${JSON.stringify(item.name)}`,
  ];
  if (item.method) parts.push(`method=${item.method}`);
  if (item.path) parts.push(`path=${item.path}`);
  // baselineId is an API-endpoint-only concept. NEVER surface it for db_table
  // items — describing a table as `baselineId=MISSING` makes the LLM apply a
  // bogus "missing baseline" readiness reason to schema stories.
  if (item.kind === 'api_endpoint') {
    parts.push(`baselineId=${item.baselineId ?? 'MISSING'}`);
  }
  if ((item.attachedFindingIds?.length ?? 0) > 0) {
    parts.push(`attachedFindings=[${item.attachedFindingIds!.join(', ')}]`);
  }
  if (item.hasLiveConflict) parts.push('liveConflict=true');
  if (item.isComplexSoap) parts.push('complexSoap=true');
  if (item.readiness) parts.push(`readiness=${item.readiness}`);
  if ((item.dataEntities?.length ?? 0) > 0) {
    parts.push(`dataEntities=[${item.dataEntities!.join(', ')}]`);
  }
  return `  - ${parts.join(' ')}`;
}

export function buildExpansionBatchPrompt(args: {
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  batch: InventoryWorkItem[];
  batchIndex: number;
  batchCount: number;
}): string {
  const lines: string[] = [];
  lines.push('PHASE 2 — EPIC EXPANSION — INVENTORY BATCH');
  lines.push('==========================================');
  lines.push(describeEpic(args.epic, args.features));
  lines.push('');
  lines.push(
    `INVENTORY BATCH ${args.batchIndex + 1} of ${args.batchCount} (deterministically computed in code):`
  );
  for (const item of args.batch) lines.push(describeInventoryItem(item));
  lines.push('');
  lines.push('Respond with ONLY a JSON object of this exact shape:');
  lines.push(
    '{ "templates": [ { "workType": string, "titleTemplate": string, "descriptionTemplate": string, "acceptanceCriteriaTemplates": [string, ...] } ],'
  );
  lines.push(
    '  "classifications": [ { "itemId": string, "classification": "standard"|"exceptional", "workType": string, "parentFeatureId": string, "reason"?: string } ],'
  );
  lines.push('  "bespokeStories": [ { "itemId": string, "story": { ...full MigrationBookOfWorkItem story shape... } } ] }');
  lines.push('');
  lines.push('Hard rules:');
  lines.push('- Classify EVERY inventory item above exactly once. NEVER add items outside this batch.');
  lines.push('- parentFeatureId MUST be one of the feature ids listed above. NEVER invent ids.');
  lines.push(
    '- Templates may use placeholders {METHOD} {path} {name} {table} {baselineId} {entities} — the gateway stamps them with verified model facts in code.'
  );
  lines.push('- Write full bespoke stories ONLY for items you classify "exceptional".');
  lines.push(
    '- Classify "exceptional" when the facts show attached findings, live conflicts, a MISSING baseline (API endpoints ONLY — database tables have no baseline; never cite a missing baseline for a db_table item), complex SOAP schemas, or readiness other than ready_for_spec.'
  );
  return lines.join('\n');
}

export function buildJudgePrompt(args: {
  epic: MigrationBookOfWorkItem;
  stamped: Array<{ story: MigrationBookOfWorkItem; inventoryItemId: string; item: InventoryWorkItem }>;
}): string {
  const lines: string[] = [];
  lines.push('PHASE 2 — EXPANSION JUDGE (VERDICT ONLY)');
  lines.push('========================================');
  lines.push(
    'Review the stamped stories below against their inventory items\' contracts/baselines/findings. Flag any story whose stamped content does not faithfully cover its item.'
  );
  lines.push(`Epic: ${args.epic.id} — ${args.epic.title}`);
  lines.push('');
  for (const { story, inventoryItemId, item } of args.stamped) {
    lines.push(`ITEM ${inventoryItemId}:`);
    lines.push(describeInventoryItem(item));
    lines.push(`  STORY: ${JSON.stringify({ id: story.id, title: story.title, description: story.description, acceptanceCriteria: story.acceptanceCriteria })}`);
  }
  lines.push('');
  lines.push('Respond with ONLY a JSON object: { "flaggedItemIds": [ "<inventory item id>", ... ] }');
  lines.push('Flag NOTHING when every stamped story is faithful — an empty array is a valid verdict.');
  return lines.join('\n');
}

export function buildBespokeRewritePrompt(args: {
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  item: InventoryWorkItem;
  parentFeatureId: string;
  reason: string;
}): string {
  const lines: string[] = [];
  lines.push('PHASE 2 — EPIC EXPANSION — BESPOKE STORY');
  lines.push('========================================');
  lines.push(describeEpic(args.epic, args.features));
  lines.push('');
  lines.push(`Write ONE full bespoke story for this inventory item (bespoke reason: ${args.reason}):`);
  lines.push(describeInventoryItem(args.item));
  lines.push('');
  lines.push(
    `Respond with ONLY a JSON object: { "story": { ...full MigrationBookOfWorkItem story shape, "type":"story", "parentId":"${args.parentFeatureId}"... } }`
  );
  lines.push('- Use ONLY the supplied facts. Do NOT invent contracts, schemas, or baselines.');
  lines.push('- Surface the bespoke reason in readinessReasons/missingInputs where it affects readiness.');
  return lines.join('\n');
}

export function buildNonInventoryExpansionPrompt(args: {
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
}): string {
  const lines: string[] = [];
  lines.push('PHASE 2 — EPIC EXPANSION — NON-INVENTORY EPIC (SINGLE CALL)');
  lines.push('===========================================================');
  lines.push(describeEpic(args.epic, args.features));
  lines.push('');
  lines.push(
    'This epic has no endpoint/table inventory mapping (e.g. cutover, reconciliation). Expand the WHOLE epic into its detailed stories in this one call.'
  );
  lines.push('Respond with ONLY a JSON object: { "stories": [ { ...full MigrationBookOfWorkItem story shape... }, ... ] }');
  lines.push('- Every story MUST parent to one of the feature ids listed above. NEVER invent ids.');
  lines.push('- Keep acceptance criteria small; deep detail belongs to the downstream shape-spec stage.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM call helper — shared pool + one retry (mirrors one-retry-per-stream)
// ---------------------------------------------------------------------------

function parseLlmJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const extracted = extractJson(content);
    if (!extracted) throw new Error('No JSON found in LLM response');
    return JSON.parse(extracted);
  }
}

async function callWithRetry<T>(args: {
  label: string;
  projectId: string;
  systemPrompt: string;
  userPrompt: string;
  callLlm: LlmCallerFn;
  llmPool: LlmConcurrencyPool;
  validate: (payload: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };
}): Promise<T> {
  const attempt = async (): Promise<T> => {
    const { content } = await args.llmPool.run(() =>
      args.callLlm({
        systemPrompt: args.systemPrompt,
        userPrompt: args.userPrompt,
        projectId: args.projectId,
      })
    );
    const parsed = parseLlmJson(content);
    const result = args.validate(parsed);
    if (!result.ok) {
      throw new Error(`${args.label} response failed validation: ${result.errors.join('; ')}`);
    }
    return result.value;
  };
  try {
    return await attempt();
  } catch (firstError) {
    logger.warn('Migration plan expansion LLM call failed; retrying once', {
      projectId: args.projectId,
      label: args.label,
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });
    try {
      return await attempt();
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`${args.label} failed after retry: ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-epic pipeline (4.3 – 4.7)
// ---------------------------------------------------------------------------

interface PendingBespoke {
  item: InventoryWorkItem;
  parentFeatureId: string;
  reason: string;
}

async function runEpicPipeline(args: {
  projectId: string;
  book: FetchedBookOfWork;
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  stream: string;
  deps: Required<
    Pick<MigrationBookOfWorkExpansionDeps, 'callLlm' | 'llmPool' | 'fetchEpicInventory'>
  > & { systemPrompt: string; batchSize: number };
}): Promise<MigrationBookOfWorkItem[]> {
  const { projectId, book, epic, features, stream, deps } = args;
  const featureIds = new Set(features.map((f) => f.id));
  const maxSequence = book.items.reduce((m, i) => Math.max(m, i.sequenceOrder ?? 0), 0);

  const inventory = await deps.fetchEpicInventory({
    projectId,
    currentArchitectureId: book.currentArchitectureId,
    targetArchitectureId: book.targetArchitectureId,
    stream,
    epic,
    features,
  });

  // ----- Non-inventory epic: ONE whole-epic call (4.7) -----
  if (!inventory || inventory.length === 0) {
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=expansion_single_call projectId=${projectId} epicId=${epic.id}`
    );
    const response = await callWithRetry({
      label: `Non-inventory expansion for epic ${epic.id}`,
      projectId,
      systemPrompt: deps.systemPrompt,
      userPrompt: buildNonInventoryExpansionPrompt({ epic, features }),
      callLlm: deps.callLlm,
      llmPool: deps.llmPool,
      validate: (payload) => validateNonInventoryExpansionResponse(payload, featureIds),
    });
    return response.stories.map((story, idx) => ({
      ...story,
      id: `${epic.id}-s-${idx + 1}`,
      sequenceOrder: maxSequence + idx + 1,
      tags: Array.from(
        new Set([...(story.tags ?? []), `stream:${stream}`, 'provenance:generated'])
      ),
    }));
  }

  // ----- Inventory-driven epic: deterministic batches (4.3) -----
  const batches = partitionInventory(inventory, deps.batchSize);
  const factsById = new Map(inventory.map((i) => [i.id, i] as const));
  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=expansion_batching projectId=${projectId} ` +
      `epicId=${epic.id} inventory=${inventory.length} batches=${batches.length} batch_size=${deps.batchSize}`
  );

  // Per-batch expansion calls — all submitted through the SHARED pool; one
  // retry per batch (mirroring one-retry-per-stream); a batch failing after
  // retry fails the whole epic (→ `failed`, retryable).
  const batchResponses: ExpansionBatchResponse[] = await Promise.all(
    batches.map((batch, idx) => {
      console.log(
        `[diag-gateway] pm_migration_delivery_plan stage=expansion_batch projectId=${projectId} ` +
          `epicId=${epic.id} batch=${idx + 1}/${batches.length} items=${batch.length}`
      );
      return callWithRetry({
        label: `Expansion batch ${idx + 1}/${batches.length} for epic ${epic.id}`,
        projectId,
        systemPrompt: deps.systemPrompt,
        userPrompt: buildExpansionBatchPrompt({
          epic,
          features,
          batch,
          batchIndex: idx,
          batchCount: batches.length,
        }),
        callLlm: deps.callLlm,
        llmPool: deps.llmPool,
        validate: (payload) =>
          validateExpansionBatchResponse(payload, {
            batchItemIds: new Set(batch.map((i) => i.id)),
            featureIds,
          }),
      });
    })
  );

  // ----- Classification + layer-2 overrides + stamping (4.4 / 4.5) -----
  const storiesByItemId = new Map<string, MigrationBookOfWorkItem>();
  const stampedByBatch: Array<
    Array<{ story: MigrationBookOfWorkItem; inventoryItemId: string; item: InventoryWorkItem }>
  > = batches.map(() => []);
  const pendingBespoke: PendingBespoke[] = [];
  let sequenceCursor = maxSequence;

  const decorateBespoke = (
    story: MigrationBookOfWorkItem,
    item: InventoryWorkItem
  ): MigrationBookOfWorkItem => {
    sequenceCursor += 1;
    return {
      ...story,
      id: storyIdForInventoryItem(epic.id, item.id),
      sequenceOrder: sequenceCursor,
      tags: Array.from(
        new Set([
          ...(story.tags ?? []),
          `stream:${stream}`,
          'provenance:generated',
          `inventory:${item.id}`,
        ])
      ),
    };
  };

  for (let b = 0; b < batchResponses.length; b++) {
    const response = batchResponses[b];
    const bespokeByItemId = new Map(response.bespokeStories.map((s) => [s.itemId, s.story]));
    for (const classification of response.classifications) {
      const item = factsById.get(classification.itemId)!;
      // Layer 2: hard-wired override — ALWAYS bespoke regardless of the
      // LLM's classification.
      const overrideReason = bespokeOverrideReason(item);
      if (overrideReason) {
        const llmBespoke = bespokeByItemId.get(item.id);
        if (llmBespoke) {
          storiesByItemId.set(item.id, decorateBespoke(llmBespoke, item));
        } else {
          // LLM said `standard`; the override routes it to an individual
          // bespoke rewrite call below.
          pendingBespoke.push({
            item,
            parentFeatureId: classification.parentFeatureId,
            reason: overrideReason,
          });
        }
        continue;
      }
      if (classification.classification === 'exceptional') {
        const llmBespoke = bespokeByItemId.get(item.id)!;
        storiesByItemId.set(item.id, decorateBespoke(llmBespoke, item));
        continue;
      }
      // Standard: stamp the template IN CODE with real model facts.
      const template = response.templates.find((t) => t.workType === classification.workType)!;
      sequenceCursor += 1;
      const story = stampStoryFromTemplate(template, item, {
        stream,
        epic,
        parentFeatureId: classification.parentFeatureId,
        sequenceOrder: sequenceCursor,
      });
      storiesByItemId.set(item.id, story);
      stampedByBatch[b].push({ story, inventoryItemId: item.id, item });
    }
  }

  // ----- Layer 1: blocking referential checks on every stamped item -----
  const referentialErrors = runReferentialChecks(
    stampedByBatch.flat().map(({ story, inventoryItemId }) => ({ story, inventoryItemId })),
    factsById
  );
  if (referentialErrors.length > 0) {
    throw new Error(
      `Referential checks failed for epic ${epic.id}: ${referentialErrors.join('; ')}`
    );
  }

  // ----- Layer 3: ONE verdict-only judge call per stamped batch -----
  for (let b = 0; b < stampedByBatch.length; b++) {
    const stamped = stampedByBatch[b];
    if (stamped.length === 0) continue;
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=expansion_judge projectId=${projectId} ` +
        `epicId=${epic.id} batch=${b + 1}/${batches.length} stamped=${stamped.length}`
    );
    const verdict = await callWithRetry({
      label: `Judge pass for epic ${epic.id} batch ${b + 1}`,
      projectId,
      systemPrompt: deps.systemPrompt,
      userPrompt: buildJudgePrompt({ epic, stamped }),
      callLlm: deps.callLlm,
      llmPool: deps.llmPool,
      validate: (payload) =>
        validateJudgeResponse(payload, new Set(stamped.map((s) => s.inventoryItemId))),
    });
    for (const flaggedItemId of verdict.flaggedItemIds) {
      const flagged = stamped.find((s) => s.inventoryItemId === flaggedItemId)!;
      storiesByItemId.delete(flaggedItemId);
      pendingBespoke.push({
        item: flagged.item,
        parentFeatureId: flagged.story.parentId ?? features[0]?.id ?? '',
        reason: 'judge_flagged',
      });
    }
  }

  // ----- Bespoke rewrites (overrides + judge-flagged), via the SHARED pool -----
  if (pendingBespoke.length > 0) {
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=expansion_bespoke_rewrites projectId=${projectId} ` +
        `epicId=${epic.id} count=${pendingBespoke.length}`
    );
    const rewritten = await Promise.all(
      pendingBespoke.map((pending) =>
        callWithRetry({
          label: `Bespoke rewrite for item ${pending.item.id} (${pending.reason})`,
          projectId,
          systemPrompt: deps.systemPrompt,
          userPrompt: buildBespokeRewritePrompt({
            epic,
            features,
            item: pending.item,
            parentFeatureId: pending.parentFeatureId,
            reason: pending.reason,
          }),
          callLlm: deps.callLlm,
          llmPool: deps.llmPool,
          validate: (payload) => validateBespokeStoryResponse(payload, featureIds),
        }).then((story) => ({ pending, story }))
      )
    );
    for (const { pending, story } of rewritten) {
      storiesByItemId.set(pending.item.id, decorateBespoke(story, pending.item));
    }
  }

  // ----- Coverage check (code guarantee): EXACTLY one story per item -----
  const missing = inventory.filter((i) => !storiesByItemId.has(i.id)).map((i) => i.id);
  const extras = [...storiesByItemId.keys()].filter((id) => !factsById.has(id));
  if (missing.length > 0 || extras.length > 0) {
    throw new Error(
      `Coverage check failed for epic ${epic.id}: ` +
        `${missing.length > 0 ? `missing stories for [${missing.join(', ')}]` : ''}` +
        `${extras.length > 0 ? ` extra stories for [${extras.join(', ')}]` : ''}`.trim()
    );
  }

  // Deterministic output order: inventory order (already deterministic).
  const orderedIds = batches.flat().map((i) => i.id);
  return orderedIds.map((id) => storiesByItemId.get(id)!);
}

// ---------------------------------------------------------------------------
// Public entry points (4.2 / 4.6 / 4.8 backing)
// ---------------------------------------------------------------------------

function streamOfEpic(epic: MigrationBookOfWorkItem): string {
  const streamTag = (epic.tags ?? []).find((t) => t.startsWith('stream:'));
  if (streamTag) return streamTag.substring('stream:'.length);
  const colon = epic.id.indexOf(':');
  if (colon > 0) return epic.id.substring(0, colon);
  return epic.workstream;
}

/**
 * Expand ONE epic end-to-end. Pipeline failures (batch/judge/rewrite after
 * retry, referential/coverage failures, hierarchy-validation failures) are
 * caught, persisted as `expansion_state='failed'` (state-only merge — the
 * draft is the single source of truth), and reported in the outcome so the
 * frontend can render the retryable failed badge. Precondition failures
 * (unknown book/epic, already expanded, in flight) throw
 * `ExpansionPreconditionError` for the route to map; AMS errors on the
 * initial `expanding` mark throw `AmsRoundTripError` for round-tripping.
 */
export async function expandMigrationBookOfWorkEpic(
  input: ExpandEpicInput,
  deps: MigrationBookOfWorkExpansionDeps = {}
): Promise<ExpandEpicOutcome> {
  const { projectId, bookId, epicId } = input;
  const fetchBook = deps.fetchBook ?? defaultFetchBook;
  const appendItems = deps.appendItems ?? defaultAppendItems;
  const fetchEpicInventory = deps.fetchEpicInventory ?? defaultFetchEpicInventory;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const llmPool = deps.llmPool ?? getMigrationPlanLlmPool();
  const systemPrompt = deps.systemPromptOverride ?? readDefaultSystemPrompt();
  let batchSize = deps.batchSizeOverride;
  if (batchSize === undefined) {
    try {
      batchSize = getConfig().migrationPlanExpansionBatchSize;
    } catch {
      batchSize = 12; // config unavailable in some unit-test contexts
    }
  }

  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=expanding_epic projectId=${projectId} ` +
      `bookId=${bookId} epicId=${epicId}`
  );

  const book = await fetchBook(projectId, bookId);
  const epic = book.items.find((i) => i.id === epicId && i.type === 'epic');
  if (!epic) {
    throw new ExpansionPreconditionError(404, `No epic "${epicId}" in book ${bookId}`);
  }
  if (epic.expansionState === 'expanded') {
    throw new ExpansionPreconditionError(
      409,
      `Epic "${epicId}" is already expanded — re-expansion is out of scope`
    );
  }
  const key = activeKey(bookId, epicId);
  if (activeExpansions.has(key)) {
    throw new ExpansionPreconditionError(409, `Epic "${epicId}" expansion is already in flight`);
  }
  const features = book.items.filter((i) => i.type === 'feature' && i.parentId === epicId);
  if (features.length === 0) {
    throw new ExpansionPreconditionError(
      400,
      `Epic "${epicId}" has no features — stories must parent to a feature`
    );
  }

  activeExpansions.add(key);
  try {
    // Mark `expanding` FIRST (state-only merge) so a reload mid-pipeline sees
    // the in-flight state in the draft document. Failure here is a
    // precondition-class failure (e.g. non-draft book → AMS 400) and
    // round-trips to the caller.
    await appendItems(projectId, bookId, {
      epic_id: epicId,
      items: [],
      expansion_state: 'expanding',
    });

    try {
      const stream = streamOfEpic(epic);
      const stories = await runEpicPipeline({
        projectId,
        book,
        epic,
        features,
        stream,
        deps: { callLlm, llmPool, fetchEpicInventory, systemPrompt, batchSize },
      });

      // Validate every story against the item schema, then the FULL merged
      // hierarchy (no orphans/cycles/level-jumps/duplicate ids against the
      // merged document) BEFORE the atomic append.
      const itemErrors: string[] = [];
      stories.forEach((story, idx) => {
        const result = validateMigrationBookOfWorkItem(story, idx);
        if (!result.ok) itemErrors.push(...result.errors);
      });
      if (itemErrors.length > 0) {
        throw new Error(`Expanded stories failed schema validation: ${itemErrors.join('; ')}`);
      }
      const merged = validateBookOfWorkHierarchy([...book.items, ...stories]);
      if (!merged.ok) {
        throw new Error(
          `Merged book-of-work hierarchy validation failed: ${merged.errors.join('; ')}`
        );
      }

      // ONE atomic append per epic — stories + `expanded` ride together.
      console.log(
        `[diag-gateway] pm_migration_delivery_plan stage=expansion_append projectId=${projectId} ` +
          `epicId=${epicId} stories=${stories.length}`
      );
      await appendItems(projectId, bookId, {
        epic_id: epicId,
        items: stories,
        expansion_state: 'expanded',
      });
      console.log(
        `[diag-gateway] pm_migration_delivery_plan stage=expansion_complete projectId=${projectId} ` +
          `epicId=${epicId} stories=${stories.length}`
      );
      return { epicId, expansionState: 'expanded', storiesAppended: stories.length };
    } catch (pipelineError) {
      const message =
        pipelineError instanceof Error ? pipelineError.message : String(pipelineError);
      logger.warn('Migration plan epic expansion failed; marking epic failed (retryable)', {
        projectId,
        bookId,
        epicId,
        error: message,
      });
      console.warn(
        `[diag-gateway] pm_migration_delivery_plan stage=expansion_failed projectId=${projectId} ` +
          `epicId=${epicId}`
      );
      // Persist `failed` (state-only merge). Unverified content NEVER lands —
      // the only story-carrying append is the success path above. A failed
      // epic leaves every other epic's stories intact (per-epic merge).
      try {
        await appendItems(projectId, bookId, {
          epic_id: epicId,
          items: [],
          expansion_state: 'failed',
        });
      } catch (markError) {
        logger.error('Failed to persist failed expansion state', {
          projectId,
          bookId,
          epicId,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      }
      return { epicId, expansionState: 'failed', storiesAppended: 0, error: message };
    }
  } finally {
    activeExpansions.delete(key);
  }
}

/**
 * Expand ALL expandable epics of a book: `not_expanded`, `failed`
 * (retryable), and STALE `expanding`; `expanded` epics are skipped (terminal).
 * Per-epic pipelines fan out concurrently, but every LLM call still goes
 * through the ONE shared pool — total in-flight LLM requests never exceed
 * MIGRATION_PLAN_LLM_CONCURRENCY regardless of epic count.
 */
export async function expandAllMigrationBookOfWorkEpics(
  input: { projectId: string; bookId: string },
  deps: MigrationBookOfWorkExpansionDeps = {}
): Promise<ExpandAllOutcome> {
  const fetchBook = deps.fetchBook ?? defaultFetchBook;
  const book = await fetchBook(input.projectId, input.bookId);
  const selection = selectExpandableEpics(input.bookId, book.items);
  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=expand_all projectId=${input.projectId} ` +
      `bookId=${input.bookId} expandable=${selection.expandable.length} skipped=${selection.skipped.length}`
  );
  const results = await Promise.all(
    selection.expandable.map((e) =>
      expandMigrationBookOfWorkEpic(
        { projectId: input.projectId, bookId: input.bookId, epicId: e.epicId },
        deps
      ).catch((error): ExpandEpicOutcome => {
        // Precondition races (e.g. another tab expanded first) surface as a
        // failed outcome for THIS epic rather than aborting the whole fan-out.
        return {
          epicId: e.epicId,
          expansionState: 'failed',
          storiesAppended: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      })
    )
  );
  return { results, skipped: selection.skipped };
}
