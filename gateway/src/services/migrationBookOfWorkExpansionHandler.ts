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
import { createTracer } from '../trace';

// PLAN-stage predicate emission (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only.
const trace = createTracer('gateway');
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
import { DB_PACK_DELIVERY_STREAMS, LlmCallerFn } from './migrationBookOfWorkHandler';
import { LlmConcurrencyPool, getMigrationPlanLlmPool } from './llmConcurrencyPool';
import {
  EnsurePackFn,
  EnsurePackOutcome,
  ensureFreshDbMigrationPack,
} from './dbMigrationPackEnsure';
import {
  CODE_DELIVERY_STREAMS,
  CODE_PROVENANCE_TAG,
  CodeModelView,
  FetchCodeModelViewFn,
  buildCodeEpicStories,
  defaultFetchCodeModelView,
} from './migrationCodeStreamPlanner';
// SCL corpus-derived spec planner (SCL pipeline spec 7, 2026-08-18 design).
// ADDITIVE + FAIL-SOFT: when no corpus plan loads, the legacy expansion below
// runs byte-identically.
import {
  LoadCorpusPlanFn,
  SclCorpusPlan,
  SclPlannedStory,
  loadCorpusPlan as defaultLoadCorpusPlan,
} from './sclCorpusPlanner';
import {
  JoinableEndpoint,
  joinSclStoryToEndpoints,
} from './sclEndpointIdentityJoin';
import {
  FetchPackViewFn,
  PackView,
  buildDbEpicStories,
  defaultFetchPackView,
} from './migrationDbPackPlanner';
import {
  packObjectSetFromTranslations,
  planTimeDialectAffectedSet,
  resolveAffectedConsumers,
} from './dbChangeConsumerResolver';
import { getElementsInventory } from './architectureModelClient';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts as defaultFetchLatestTargetManifestArtifacts,
} from './targetManifestArtifactsClient';
// Scaffold gate diagnosis (2026-08-14): names WHY the scaffold could not
// inject (no manifest / wrong-architecture upload / no target arch) — the
// silent [] paths cost a live plan its scaffold story.
import {
  diagnoseScaffoldManifestGate,
  scaffoldManifestGateRemedy,
} from './migrationScaffoldManifestGate';
import { fetchMigrationDiscoveryContext } from './migrationDiscoveryContextClient';
import { fetchEndpointBaselineCoverage } from './apiBehaviourBaselineCoverageClient';
import { recommendedNextActionForItem } from './migrationExecutionClass';

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
  /**
   * When true, AMS first removes the epic's PRIOR expansion output (descendant
   * stories + any `expansionGenerated` item) before appending — a RE-expand
   * replaces the epic's stories instead of duplicating them. Set only on the
   * success append; the `expanding` / `failed` state marks leave it unset so a
   * failed re-expand keeps the old stories.
   */
  replace_epic_expansion?: boolean;
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
  /**
   * Confirmed target-manifest reader for the expansion-time scaffold gate
   * (Spec 2026-06-26). Defaults to the real gateway -> AMS client; injected
   * in tests. CALLER owns the fail-soft posture.
   */
  fetchTargetManifestArtifacts?: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<TargetManifestArtifactWire[]>;
  /**
   * Target-state `services` reader for scaffold service-name resolution.
   * Defaults to the Applications-domain services walk; injected in tests.
   */
  fetchScaffoldServices?: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<ScaffoldServiceElement[]>;
  /**
   * DB-pack collaborators for the deterministic DB-epic expansion
   * (Spec 2026-07-02-b). The ensure step re-runs at expansion time (the user
   * may expand days after plan creation) and the pack view feeds the
   * deterministic story builder. Both injected in tests.
   */
  ensurePack?: EnsurePackFn;
  fetchPackView?: FetchPackViewFn;
  /** Cluster-cap override for tests (defaults to config knob, then 25). */
  dbClusterCapOverride?: number;
  /**
   * Committed-model reader for the deterministic CODE-epic expansion
   * (Spec 2026-07-06-g). Injected in tests; a read failure THROWS (epic
   * `failed`, retryable) — expansion never proceeds on a guessed model.
   */
  fetchCodeModelView?: FetchCodeModelViewFn;
  /** API cluster-cap override for tests (defaults to config knob, then 15). */
  apiClusterCapOverride?: number;
  /**
   * DB-change consumer resolver (Spec 2026-07-06-f §4, Tier-1 batch): the
   * expansion recomputes the dialect-affected set with the SAME rule the
   * skeleton used so the drift check judges flags against identical facts.
   * Injected in tests.
   */
  resolveAffectedConsumers?: typeof resolveAffectedConsumers;
  /**
   * SCL corpus-plan loader (SCL pipeline spec 7 — corpus-derived spec
   * planner). Defaults to the AMS-backed `loadCorpusPlan`; injected in tests.
   * FAIL-SOFT at the call site: a null plan OR a loader throw leaves the
   * legacy service-plane expansion byte-identical.
   */
  loadCorpusPlan?: LoadCorpusPlanFn;
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

/**
 * Ids of an epic's prior EXPANSION OUTPUT: every transitive descendant that is a
 * `story` OR is tagged `expansionGenerated` (an injected scaffold feature). The
 * skeleton (the epic + its untagged features) is excluded. Mirrors the AMS
 * replace rule so the gateway's pre-append hierarchy check validates the same
 * document AMS will persist after a re-expand replace. Fixed-point walk over
 * `parentId`, so hierarchy order in the array does not matter.
 */
export function epicExpansionOutputIds(
  items: MigrationBookOfWorkItem[],
  epicId: string
): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of items) {
      const pid = it.parentId ?? undefined;
      if (!it.id || !pid || descendants.has(it.id)) continue;
      if (pid === epicId || descendants.has(pid)) {
        descendants.add(it.id);
        changed = true;
      }
    }
  }
  const output = new Set<string>();
  for (const it of items) {
    if (!it.id || !descendants.has(it.id)) continue;
    if (it.type === 'story' || it.expansionGenerated === true) {
      output.add(it.id);
    }
  }
  return output;
}

export interface ExpandableEpicSelection {
  expandable: Array<{
    epicId: string;
    previousState: MigrationBookOfWorkExpansionState | undefined;
    reason: 'not_expanded' | 'failed' | 'stale_expanding' | 're_expand';
  }>;
  skipped: Array<{ epicId: string; expansionState?: string; reason: string }>;
}

/**
 * Selects the epics an "Expand" run should process: `not_expanded` (including
 * epics with no state — pre-feature drafts), `failed` (retryable), and STALE
 * `expanding` (persisted state with no live in-process pipeline). Live
 * `expanding` epics are always skipped so a double-click cannot double-run a
 * pipeline.
 *
 * `expanded` epics are terminal for **Expand remaining** (`includeExpanded`
 * omitted/false) but are RE-expanded for **Expand all**
 * (`includeExpanded: true`) — the pipeline re-runs against the current pack and
 * replaces the epic's stories (2026-07-19).
 */
export function selectExpandableEpics(
  bookId: string,
  items: MigrationBookOfWorkItem[],
  opts: { includeExpanded?: boolean } = {}
): ExpandableEpicSelection {
  const expandable: ExpandableEpicSelection['expandable'] = [];
  const skipped: ExpandableEpicSelection['skipped'] = [];
  for (const item of items) {
    if (item.type !== 'epic') continue;
    const state = item.expansionState;
    if (state === 'expanded') {
      if (opts.includeExpanded) {
        expandable.push({ epicId: item.id, previousState: state, reason: 're_expand' });
      } else {
        skipped.push({ epicId: item.id, expansionState: state, reason: 'already expanded (terminal)' });
      }
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
  // NOTE (Spec 2026-07-06-g): the API entries below are UNREACHABLE in
  // production — the deterministic code-epic branch intercepts those streams
  // before fetchEpicInventory runs (same situation as the DB entries after
  // Spec 2026-07-02-b). Kept for the legacy tests + as cleanup candidates.
  // `api_migration` is the Spec V canonical stream; the two pre-reframe keys
  // are retained for legacy plans.
  api_migration: {
    domain: 'Applications',
    types: ['Endpoints'],
    kind: 'api_endpoint',
  },
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
  > & {
    systemPrompt: string;
    batchSize: number;
    ensurePack: EnsurePackFn;
    fetchPackView: FetchPackViewFn;
    dbClusterCap: number;
    fetchCodeModelView: FetchCodeModelViewFn;
    apiClusterCap: number;
    resolveAffectedConsumers: typeof resolveAffectedConsumers;
    loadCorpusPlan: LoadCorpusPlanFn;
  };
}): Promise<MigrationBookOfWorkItem[]> {
  const { projectId, book, epic, features, stream, deps } = args;
  const featureIds = new Set(features.map((f) => f.id));
  const maxSequence = book.items.reduce((m, i) => Math.max(m, i.sequenceOrder ?? 0), 0);

  // ----- Deterministic DB-epic expansion (Spec 2026-07-02-b) -----
  //
  // DB epics NEVER take the LLM paths below — neither the inventory batching
  // nor the freeform non-inventory single call (the old silent-hallucination
  // path, Gap #5). The ensure step re-runs so a stale/missing pack is
  // regenerated (or the epic degrades to explicit prerequisite stories), and
  // the story builder enforces its own coverage guarantee (throw → epic
  // `failed`, retryable).
  if (DB_PACK_DELIVERY_STREAMS.includes(stream)) {
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=expansion_db_deterministic ` +
        `projectId=${projectId} epicId=${epic.id} stream=${stream}`
    );
    let ensureOutcome: EnsurePackOutcome | null = null;
    if (book.targetArchitectureId) {
      ensureOutcome = await deps.ensurePack({
        projectId,
        currentArchitectureId: book.currentArchitectureId ?? '',
        targetArchitectureId: book.targetArchitectureId,
      });
    }
    let packView: PackView | null = null;
    if (ensureOutcome === null || ensureOutcome.packId) {
      try {
        packView = await deps.fetchPackView(
          projectId,
          book.currentArchitectureId ?? ''
        );
      } catch (error) {
        logger.warn('Pack view read failed at expansion; DB epic degrades to prerequisites', {
          projectId,
          epicId: epic.id,
          error: error instanceof Error ? error.message : String(error),
        });
        packView = null;
      }
    }
    return buildDbEpicStories({
      epic,
      features,
      stream,
      packView,
      ensureOutcome,
      clusterCap: deps.dbClusterCap,
      maxSequence,
    });
  }

  // ----- Deterministic CODE-epic expansion (Spec 2026-07-06-g) -----
  //
  // Code epics NEVER take the LLM paths below. Stories are stamped from the
  // feature extras the skeleton planner wrote; the fresh model read feeds the
  // DRIFT check only (model changed since skeleton → throw "regenerate").
  // A model read failure THROWS (epic `failed`, retryable) — never a guess.
  if (CODE_DELIVERY_STREAMS.includes(stream)) {
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=expansion_code_deterministic ` +
        `projectId=${projectId} epicId=${epic.id} stream=${stream}`
    );
    const view: CodeModelView | null = await deps.fetchCodeModelView(
      projectId,
      book.currentArchitectureId ?? ''
    );
    // Spec 2026-07-06-f §4 (Tier-1 batch): recompute the dialect-affected set
    // with the SAME rule the skeleton used (tsql + translated procs) so the
    // drift check below judges flags against identical facts. A pack read
    // failure degrades to translations=[] (the tsql dimension still
    // resolves); an unreadable model inside the resolver yields an EMPTY set,
    // which the drift check surfaces as "regenerate" — fail-closed,
    // retryable, never a silently narrower plan.
    if (view) {
      let translations: PackView['translations'] = [];
      try {
        const packView = await deps.fetchPackView(projectId, book.currentArchitectureId ?? '');
        translations = packView?.translations ?? [];
      } catch {
        // Pack absent/unreadable — proc dimension empty; tsql still applies.
      }
      const affected = await deps.resolveAffectedConsumers({
        projectId,
        currentArchitectureId: book.currentArchitectureId ?? '',
        packObjects: packObjectSetFromTranslations(translations),
      });
      const planTimeAffected = planTimeDialectAffectedSet(affected);
      if (planTimeAffected.size > 0) {
        view.dialectAffectedEndpointIds = planTimeAffected;
      }
    }
    // ----- SCL corpus-derived spec plan (SCL pipeline spec 7) -----
    //
    // ADDITIVE + FAIL-SOFT: the corpus plan loads AFTER the legacy inputs are
    // assembled; when NO plan loads (no SCL scan, empty/rootless corpus, or
    // any read failure) the legacy deterministic expansion below runs
    // byte-identically. Only the SERVICE-PLANE stream (`api_migration`)
    // consults the corpus.
    //
    // Prior corpus-generated FEATURES (tagged `provenance:scl_corpus`) are
    // filtered out of the legacy builder's input: a re-expand fetches them on
    // the book BEFORE the AMS replace prunes them, and the legacy builder
    // fails loudly on their unknown `codeFeatureKind`. For books the corpus
    // never touched, the filter is a no-op — legacy stays byte-identical.
    const legacyFeatures = features.filter(
      (f) => !(f.tags ?? []).includes(SCL_CORPUS_PROVENANCE_TAG)
    );
    let corpusPlan: SclCorpusPlan | null = null;
    if (stream === CORPUS_PLAN_STREAM) {
      try {
        corpusPlan = await deps.loadCorpusPlan(projectId, book.currentArchitectureId ?? '');
      } catch (error) {
        // Loader throw ⇒ WARN + legacy path (never blocks the expansion).
        logger.warn('SCL corpus plan load failed; expansion takes the legacy path', {
          projectId,
          epicId: epic.id,
          error: error instanceof Error ? error.message : String(error),
        });
        corpusPlan = null;
      }
    }
    if (corpusPlan) {
      const epicKind =
        ((epic as MigrationBookOfWorkItem & { codeEpicKind?: string }).codeEpicKind as
          | string
          | undefined) ??
        (legacyFeatures.some(
          (f) => (f as MigrationBookOfWorkItem & { codeFeatureKind?: string }).codeFeatureKind === 'interface'
        )
          ? 'interfaces'
          : legacyFeatures.some(
                (f) =>
                  (f as MigrationBookOfWorkItem & { codeFeatureKind?: string }).codeFeatureKind ===
                  'foundations'
              )
            ? 'foundations'
            : 'other');

      if (epicKind === 'foundations') {
        // "Rulings round 2": a NEW SIBLING FEATURE "Corpus-derived
        // foundations" (6 layer stories) joins the existing cross-cutting
        // foundations feature under the SAME epic. Legacy foundation stories
        // are kept — the corpus layers are ADDITIVE here.
        const legacyStories = buildCodeEpicStories({
          epic,
          features: legacyFeatures,
          stream,
          view,
          clusterCap: deps.apiClusterCap,
          maxSequence,
        });
        const seqAfterLegacy = legacyStories.reduce(
          (m, s) => Math.max(m, s.sequenceOrder ?? 0),
          maxSequence
        );
        const corpusItems = buildCorpusFoundationItems({
          epic,
          stream,
          plan: corpusPlan,
          startSequence: seqAfterLegacy,
        });
        console.log(
          `[diag-gateway] migration_bow_expansion corpus_plan_used ` +
            `stories=${corpusItems.filter((i) => i.type === 'story').length} ` +
            `clustering_rule=${corpusPlan.stats.clusteringRule ?? 'row_budget'} ` +
            `over_budget=${(corpusPlan.stats.overBudgetStories ?? []).length} ` +
            `constants_evicted=${(corpusPlan.stats.constantsEvicted ?? []).length} ` +
            `forward_refs=${(corpusPlan.stats.forwardReferences ?? []).length} ` +
            `dep_cycles=${(corpusPlan.stats.dependencyCycles ?? []).length} ` +
            `projectId=${projectId} epicId=${epic.id} epicKind=foundations`
        );
        // A forward reference means a foundation story will be asked to build
        // against a type a LATER story owns — the defect that cost three
        // overnight runs. The partition now orders by dependency, so this should
        // be unreachable; if it fires, say so at plan time rather than letting an
        // implementer discover it hours later as a blocked task.
        for (const violation of corpusPlan.stats.forwardReferences ?? []) {
          logger.warn('[diag-gateway] SCL corpus plan FORWARD REFERENCE between foundation stories', {
            projectId,
            epicId: epic.id,
            violation,
          });
        }
        for (const cycle of corpusPlan.stats.dependencyCycles ?? []) {
          logger.warn('[diag-gateway] SCL corpus plan dependency CYCLE (emitted in symbol order)', {
            projectId,
            epicId: epic.id,
            members: cycle.slice(0, 12),
            memberCount: cycle.length,
          });
        }
        return [...legacyStories, ...corpusItems];
      }
      if (epicKind === 'interfaces') {
        // CLEAN-SLATE ruling (round 2): when a corpus plan EXISTS, the corpus
        // endpoint groups REPLACE the legacy interface-story expansion for
        // the service plane — external groups FIRST, then internal groups,
        // one feature per legacy controller class, 1–n endpoint stories per
        // controller under the row budget. The legacy model-drift checks are
        // deliberately NOT run here: the SCL corpus (not the committed
        // endpoint model) is the construction truth on this path.
        const corpusItems = buildCorpusEndpointGroupItems({
          epic,
          stream,
          plan: corpusPlan,
          startSequence: maxSequence,
          // The SCL corpus stays the CONSTRUCTION truth on this path; the
          // committed endpoints are supplied only to resolve endpoint element
          // ids for traceability, coverage gating and parity scoping.
          endpoints: view?.endpoints ?? [],
          findingIdsByEndpointId: view?.findingIdsByEndpointId,
          baselineByEndpointId: view?.baselineByEndpointId,
        });
        const joinedStories = corpusItems.filter((item) => {
          if (item.type !== 'story') return false;
          const ids = (item as unknown as Record<string, unknown>).apiEndpointIds;
          return Array.isArray(ids) && ids.length > 0;
        }).length;
        console.log(
          `[diag-gateway] migration_bow_expansion corpus_plan_used ` +
            `stories=${corpusItems.filter((i) => i.type === 'story').length} ` +
            `endpoint_joined_stories=${joinedStories} ` +
            `projectId=${projectId} epicId=${epic.id} epicKind=interfaces`
        );
        return corpusItems;
      }
      // Other code epic kinds (capture / exceptional / closure /
      // prerequisites) are untouched by the corpus plan — legacy path.
    } else if (stream === CORPUS_PLAN_STREAM) {
      console.log(
        `[diag-gateway] migration_bow_expansion corpus_plan_absent legacy_path ` +
          `projectId=${projectId} epicId=${epic.id}`
      );
    }
    return buildCodeEpicStories({
      epic,
      features: legacyFeatures,
      stream,
      view,
      clusterCap: deps.apiClusterCap,
      maxSequence,
    });
  }

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
  const extras = [...storiesByItemId.keys()].filter(
    (id) =>
      !factsById.has(id) &&
      // FR4 (Spec 2026-06-26): a non-inventory scaffold seed story
      // (tags:['seed_build_files']) is injected post-pipeline, outside this
      // map, so it must never count as an inventory "extra" -- exclude it
      // defensively by tag should one ever surface here.
      !(storiesByItemId.get(id)?.tags ?? []).includes(SEED_BUILD_FILES_TAG)
  );
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

// ---------------------------------------------------------------------------
// Scaffold homing helpers (Spec 2026-06-26 Book-of-Work Scaffold + Reference
// Names, Task Group 2) - ecosystem -> workstream, host-epic selection, and
// service-name resolution. PURE over their inputs (no I/O) so they unit-test
// cleanly; the orchestrator fetches the manifests + services and feeds them in.
// ---------------------------------------------------------------------------

/**
 * Code-owned manifest-ecosystem -> book-of-work workstream map. Only the two
 * implementation workstreams the scaffold homes into are mapped; every other
 * ecosystem yields `null` (no scaffold host). Case-insensitive on the manifest
 * `ecosystem` field.
 */
export const ECOSYSTEM_WORKSTREAM_MAP: Readonly<
  Record<string, MigrationBookOfWorkWorkstream>
> = {
  maven: 'api_migration', // Spec V: Java service scaffold homes into the merged API stream
  npm: 'target_frontend_implementation',
};

/** Resolve a manifest ecosystem to its workstream (case-insensitive), or null. */
export function workstreamForEcosystem(
  ecosystem: string | null | undefined
): MigrationBookOfWorkWorkstream | null {
  if (typeof ecosystem !== 'string') return null;
  return ECOSYSTEM_WORKSTREAM_MAP[ecosystem.trim().toLowerCase()] ?? null;
}

/** Last-resort human label for the `<service>` token, by workstream. */
export function workstreamServiceLabel(
  workstream: MigrationBookOfWorkWorkstream | null
): string {
  if (workstream === 'target_frontend_implementation') return 'frontend';
  if (workstream === 'api_migration') return 'service API';
  return 'service';
}

/**
 * The effective workstream of an epic: its `workstream` field when it is a known
 * non-`unknown` value, else the stream parsed from its `stream:` tag / namespaced
 * id (`streamOfEpic`). Keeps host-epic selection robust against skeleton epics
 * that left `workstream` at the `unknown` sentinel.
 */
function effectiveWorkstreamOfEpic(epic: MigrationBookOfWorkItem): string {
  const ws = epic.workstream;
  if (
    typeof ws === 'string' &&
    ws !== 'unknown' &&
    (MIGRATION_BOOK_OF_WORK_WORKSTREAMS as readonly string[]).includes(ws)
  ) {
    return ws;
  }
  return streamOfEpic(epic);
}

export interface ScaffoldHostResolution {
  /** True iff the epic passed IS the scaffold host for a confirmed manifest. */
  isHost: boolean;
  /** The mapped workstream the scaffold homes into, or null when none applies. */
  workstream: MigrationBookOfWorkWorkstream | null;
  /** The lowest-`sequenceOrder` epic id in the mapped workstream, or null. */
  hostEpicId: string | null;
  /** The confirmed manifest selected for this workstream, or null. */
  manifest: TargetManifestArtifactWire | null;
}

/**
 * Decide whether `epic` is the scaffold HOST for any confirmed manifest, and if
 * so which manifest. Pure over its inputs:
 *
 *   1. Index manifests by mapped workstream (first manifest wins per
 *      workstream - multi-codebase homing is out of scope).
 *   2. Take the epic's effective workstream; if no manifest maps to it -> not a
 *      host (isHost:false, manifest:null).
 *   3. The host epic is the lowest-`sequenceOrder` epic in that workstream
 *      (tie-break by id for determinism); isHost iff that epic is `epic`.
 *
 * Works identically under single-epic expand and "Expand all": the answer
 * depends only on the fetched book + manifests, never on click order.
 */
export function resolveScaffoldHostForEpic(args: {
  epic: MigrationBookOfWorkItem;
  items: MigrationBookOfWorkItem[];
  manifests: TargetManifestArtifactWire[];
}): ScaffoldHostResolution {
  const { epic, items, manifests } = args;

  const byWorkstream = new Map<MigrationBookOfWorkWorkstream, TargetManifestArtifactWire>();
  for (const manifest of manifests ?? []) {
    const ws = workstreamForEcosystem(manifest?.ecosystem);
    if (ws && !byWorkstream.has(ws)) byWorkstream.set(ws, manifest);
  }

  const epicWorkstream = effectiveWorkstreamOfEpic(epic);
  const manifest = byWorkstream.get(epicWorkstream as MigrationBookOfWorkWorkstream) ?? null;
  if (!manifest) {
    return { isHost: false, workstream: null, hostEpicId: null, manifest: null };
  }
  const workstream = epicWorkstream as MigrationBookOfWorkWorkstream;

  let host: MigrationBookOfWorkItem | null = null;
  for (const candidate of items) {
    if (candidate.type !== 'epic') continue;
    if (effectiveWorkstreamOfEpic(candidate) !== workstream) continue;
    const cs = candidate.sequenceOrder ?? 0;
    const hs = host?.sequenceOrder ?? 0;
    if (host === null || cs < hs || (cs === hs && candidate.id < host.id)) {
      host = candidate;
    }
  }
  const hostEpicId = host?.id ?? null;
  return { isHost: hostEpicId === epic.id, workstream, hostEpicId, manifest };
}

export interface ScaffoldServiceElement {
  id: string;
  name: string;
}

export interface ResolvedScaffoldService {
  /** Display name for the `<service>` token. Never empty (never blocks). */
  serviceName: string;
  /** Resolved service element id for traceability; null when unresolved. */
  serviceId: string | null;
}

/**
 * Resolve the `<service>` label + traceability id for the scaffold story with a
 * graceful fallback chain (FR5). NEVER blocks:
 *   1. Spec-4 `target_service_element_id` FK -> the bound `services` element
 *      name (when that element resolves in `services`).
 *   2. Else, a single service by cardinality -> that service's name.
 *   3. Else, the workstream/ecosystem label ("service API" / "frontend").
 * Pure over its inputs.
 */
export function resolveScaffoldServiceName(args: {
  manifest: TargetManifestArtifactWire;
  workstream: MigrationBookOfWorkWorkstream | null;
  services: ScaffoldServiceElement[];
}): ResolvedScaffoldService {
  const { manifest, workstream, services } = args;
  const fk =
    typeof manifest?.target_service_element_id === 'string' &&
    manifest.target_service_element_id.length > 0
      ? manifest.target_service_element_id
      : null;
  const list = Array.isArray(services) ? services : [];

  // 1. FK -> bound services element name.
  if (fk) {
    const bound = list.find((s) => s.id === fk);
    if (bound && typeof bound.name === 'string' && bound.name.length > 0) {
      return { serviceName: bound.name, serviceId: fk };
    }
  }

  // 2. Single service by cardinality.
  if (list.length === 1 && typeof list[0].name === 'string' && list[0].name.length > 0) {
    return { serviceName: list[0].name, serviceId: fk ?? list[0].id };
  }

  // 3. Workstream/ecosystem label - last resort, never blocks.
  return { serviceName: workstreamServiceLabel(workstream), serviceId: fk };
}

/** Filename of the confirmed manifest for the scaffold story seed text. */
export function scaffoldManifestFilename(manifest: TargetManifestArtifactWire): string {
  const manifestPath = manifest?.manifest_path;
  if (typeof manifestPath === 'string' && manifestPath.trim().length > 0) {
    const segments = manifestPath.trim().split(/[\\/]/);
    return segments[segments.length - 1] || manifestPath.trim();
  }
  const tag = manifest?.tag;
  return typeof tag === 'string' && tag.length > 0 ? tag : 'the build manifest';
}

// ---------------------------------------------------------------------------
// Scaffold feature+story injection (Spec 2026-06-26 Book-of-Work Scaffold +
// Reference Names, Task Group 3). The scaffold work is parented properly into
// the hierarchy (feature under the host epic, story under the feature) and rides
// the SAME stamp -> schema-validate -> merged-hierarchy-validate -> single atomic
// append path as the epic's stories, so it is hierarchy-legal BY CONSTRUCTION.
// ---------------------------------------------------------------------------

/** Code-owned scaffold feature title (FR3). */
export const SCAFFOLD_FEATURE_TITLE = 'Scaffold & build foundation';

/** The marker tag the downstream seed-build-files carriage keys on (FR4). */
export const SEED_BUILD_FILES_TAG = 'seed_build_files';

export interface ScaffoldInjection {
  feature: MigrationBookOfWorkItem;
  story: MigrationBookOfWorkItem;
}

/**
 * Build the code-owned scaffold FEATURE ("Scaffold & build foundation",
 * sequenced as the host epic's FIRST feature) and its single scaffold STORY
 * (under that feature). PURE over its inputs and hierarchy-legal by
 * construction (feature.parent = host epic; story.parent = scaffold feature).
 */
export function buildScaffoldFeatureAndStory(args: {
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  stream: string;
  workstream: MigrationBookOfWorkWorkstream | null;
  serviceName: string;
  serviceId: string | null;
  manifestFilename: string;
}): ScaffoldInjection {
  const { epic, features, stream, workstream, serviceName, serviceId, manifestFilename } = args;

  // FIRST feature: sit one below the epic's lowest existing feature sequence.
  const minFeatureSeq = features.reduce(
    (m, f) => Math.min(m, f.sequenceOrder ?? 0),
    features[0]?.sequenceOrder ?? 0
  );
  const featureSeq = minFeatureSeq - 1;
  const ws = (workstream ?? workstreamForEpic(epic)) as MigrationBookOfWorkWorkstream;
  const featureId = `${epic.id}-scaffold-feature`;
  const storyId = `${epic.id}-scaffold-story`;

  const feature: MigrationBookOfWorkItem = {
    id: featureId,
    type: 'feature',
    parentId: epic.id,
    title: SCAFFOLD_FEATURE_TITLE,
    description:
      `Scaffold the ${serviceName} application from the confirmed target dependency ` +
      `manifest (${manifestFilename}) so the rest of the build is constructed on top of ` +
      `the authoritative file. Sequenced FIRST under this epic.`,
    acceptanceCriteria: [],
    workstream: ws,
    sequenceOrder: featureSeq,
    tags: [`stream:${stream}`, 'provenance:scaffold'],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: 'Expand the scaffold story and seed the build file(s) FIRST.',
    traceabilitySummary:
      'Code-owned scaffold feature injected at expansion for the confirmed target manifest.',
  };

  // FR3 seed sentence shared by title + description + acceptance criterion.
  const seed =
    `Scaffold the ${serviceName} app and reproduce ${manifestFilename} exactly as ` +
    `confirmed, dependency-for-dependency.`;

  const story: MigrationBookOfWorkItem = {
    id: storyId,
    type: 'story',
    parentId: featureId,
    title: seed,
    description: seed,
    acceptanceCriteria: [seed],
    workstream: ws,
    sequenceOrder: featureSeq,
    // seed_build_files marks it for the downstream verbatim-manifest carriage;
    // stream + provenance mirror the existing stamped-story tag conventions.
    tags: [SEED_BUILD_FILES_TAG, `stream:${stream}`, 'provenance:scaffold'],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction:
      'Write the verbatim confirmed dependency manifest at its resolved module path FIRST.',
    traceabilitySummary:
      `Carries the confirmed target dependency manifest (${manifestFilename}) for the ${serviceName} service.`,
    // Carry the resolved service id for traceability + future multi-service
    // homing (null when unresolved).
    architectureReferences: serviceId ? [serviceId] : [],
    // Opaque non-schema marker read off the blob by the description-grounded
    // spec-gen flavour selector (mirrors how the old seed story stamped `kind`).
    ...({ kind: 'operational' } as Record<string, unknown>),
  } as MigrationBookOfWorkItem;

  return { feature, story };
}

/**
 * Default reader for the target-state `services` elements used by the scaffold
 * service-name resolution. Collects the Applications-domain instances whose type
 * name mentions "service". The CALLER owns the fail-soft posture.
 */
async function defaultFetchScaffoldServices(
  projectId: string,
  architectureId: string
): Promise<ScaffoldServiceElement[]> {
  const inventory = await getElementsInventory(projectId, architectureId);
  const services: ScaffoldServiceElement[] = [];
  for (const domain of inventory.domains ?? []) {
    if (domain.name !== 'Applications') continue;
    for (const type of domain.types ?? []) {
      if (!/service/i.test(type.name)) continue;
      for (const instance of type.instances ?? []) {
        services.push({ id: instance.id, name: instance.name });
      }
    }
  }
  return services;
}

/**
 * Resolve the scaffold feature+story to inject for THIS epic, or [] when none
 * applies. Gated (FR2/FR3) on a confirmed manifest existing AT EXPANSION TIME
 * AND this epic being the scaffold host (Group 2). FAIL-SOFT on the manifest /
 * services reads: a read throw -> no scaffold, expand normally.
 */
async function buildScaffoldInjectionForEpic(args: {
  projectId: string;
  book: FetchedBookOfWork;
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  stream: string;
  fetchTargetManifestArtifacts: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<TargetManifestArtifactWire[]>;
  fetchScaffoldServices: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<ScaffoldServiceElement[]>;
}): Promise<MigrationBookOfWorkItem[]> {
  const {
    projectId,
    book,
    epic,
    features,
    stream,
    fetchTargetManifestArtifacts,
    fetchScaffoldServices,
  } = args;

  const targetArchitectureId = book.targetArchitectureId;
  if (!targetArchitectureId) {
    // LOUD (2026-08-14): the silent [] here cost a live plan its scaffold
    // story — eleven service-plane specs with no runnable application.
    console.log(
      `[diag-gateway] pm_migration_delivery_plan stage=scaffold_gate_skipped ` +
        `projectId=${projectId} epicId=${epic.id} reason=no_target_architecture_id`
    );
    return [];
  }

  let manifests: TargetManifestArtifactWire[] = [];
  try {
    manifests = await fetchTargetManifestArtifacts(projectId, targetArchitectureId);
  } catch (error) {
    logger.warn('Scaffold manifest gate read failed; expanding without scaffold', {
      projectId,
      epicId: epic.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
  if (!Array.isArray(manifests) || manifests.length === 0) {
    // LOUD (2026-08-14): name the precise failure mode — including the
    // upload/plan architecture-binding mismatch class, where the manifest
    // exists but under a different target architecture than the plan's.
    // The spec preflight surfaces the same diagnosis as a user-facing
    // warning with the remedy; here we log it at expansion time.
    try {
      const diagnosis = await diagnoseScaffoldManifestGate(
        projectId,
        targetArchitectureId
      );
      console.log(
        `[diag-gateway] pm_migration_delivery_plan stage=scaffold_gate_skipped ` +
          `projectId=${projectId} epicId=${epic.id} status=${diagnosis.status} ` +
          `bookArch=${targetArchitectureId} ` +
          `otherArch=${diagnosis.otherArchitectureId ?? 'none'} ` +
          `remedy=${JSON.stringify(scaffoldManifestGateRemedy(diagnosis))}`
      );
    } catch {
      // The diagnosis itself is best-effort; the gate outcome is unchanged.
    }
    return [];
  }

  const host = resolveScaffoldHostForEpic({ epic, items: book.items, manifests });
  if (!host.isHost || !host.manifest) return [];

  let services: ScaffoldServiceElement[] = [];
  try {
    services = await fetchScaffoldServices(projectId, targetArchitectureId);
  } catch (error) {
    logger.warn('Scaffold services read failed; falling back to workstream label', {
      projectId,
      epicId: epic.id,
      error: error instanceof Error ? error.message : String(error),
    });
    services = [];
  }

  const { serviceName, serviceId } = resolveScaffoldServiceName({
    manifest: host.manifest,
    workstream: host.workstream,
    services,
  });
  const manifestFilename = scaffoldManifestFilename(host.manifest);
  const { feature, story } = buildScaffoldFeatureAndStory({
    epic,
    features,
    stream,
    workstream: host.workstream,
    serviceName,
    serviceId,
    manifestFilename,
  });

  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=scaffold_injected projectId=${projectId} ` +
      `epicId=${epic.id} featureId=${feature.id} storyId=${story.id} ` +
      `manifest=${manifestFilename} service=${JSON.stringify(serviceName)} serviceId=${serviceId ?? 'null'}`
  );
  return [feature, story];
}



// ---------------------------------------------------------------------------
// SCL corpus-derived plan integration (SCL pipeline spec 7, 2026-08-18 design
// "Spec plan restructure" + "Rulings round 2"). PURE item builders — the
// corpus plan (from sclCorpusPlanner) is turned into book-of-work items that
// follow the exact conventions of the deterministic code planner:
// full item-json shape, `provenance:plan-deterministic` for downstream
// routing, extras flattened onto the blob (codeStoryKind / codeFeatureKind),
// deterministic ids under the epic. Corpus-specific facts ride the blob as
// `scl_contract_keys` / `scl_row_count` (+ layer/controller markers).
// ---------------------------------------------------------------------------

/** The service-plane stream the corpus plan applies to. */
export const CORPUS_PLAN_STREAM = 'api_migration';

/** Provenance tag on every corpus-derived item (feature AND story). */
export const SCL_CORPUS_PROVENANCE_TAG = 'provenance:scl_corpus';

/** Title of the corpus foundations feature (sibling of the legacy one). */
export const CORPUS_FOUNDATIONS_FEATURE_TITLE = 'Corpus-derived foundations';

function corpusItem(seed: {
  id: string;
  type: MigrationBookOfWorkItem['type'];
  parentId: string;
  title: string;
  description: string;
  workstream: MigrationBookOfWorkWorkstream;
  sequenceOrder: number;
  acceptanceCriteria?: string[];
  tags: string[];
  recommendedNextAction?: string;
  traceabilitySummary: string;
  extras?: Record<string, unknown>;
}): MigrationBookOfWorkItem {
  const item: MigrationBookOfWorkItem = {
    id: seed.id,
    type: seed.type,
    parentId: seed.parentId,
    title: seed.title,
    description: seed.description,
    acceptanceCriteria: seed.acceptanceCriteria ?? [],
    workstream: seed.workstream,
    sequenceOrder: seed.sequenceOrder,
    tags: seed.tags,
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    // Execution-class aware (2026-08-30) — see migrationExecutionClass. The
    // flat automated default instructed the operator to generate a spec on
    // MANUAL items, which never generate one.
    recommendedNextAction:
      seed.recommendedNextAction ??
      recommendedNextActionForItem({ tags: seed.tags ?? [] }),
    traceabilitySummary: seed.traceabilitySummary,
  };
  return { ...item, ...(seed.extras ?? {}) } as MigrationBookOfWorkItem;
}

function corpusTags(stream: string, planned: SclPlannedStory): string[] {
  // provenance:plan-deterministic keeps the downstream driver/carriage
  // routing (isCodeFoundationStory & co.); provenance:scl_corpus is the
  // corpus marker; the planner's own tags carry the layer/endpoint facet.
  return Array.from(
    new Set([CODE_PROVENANCE_TAG, `stream:${stream}`, SCL_CORPUS_PROVENANCE_TAG, ...planned.tags])
  );
}

/**
 * The "Corpus-derived foundations" FEATURE (a NEW SIBLING of the existing
 * cross-cutting foundations feature, under the SAME epic) + one story per
 * non-empty foundation layer, in layer order. PURE over its inputs.
 */
export function buildCorpusFoundationItems(args: {
  epic: MigrationBookOfWorkItem;
  stream: string;
  plan: SclCorpusPlan;
  startSequence: number;
}): MigrationBookOfWorkItem[] {
  const { epic, stream, plan } = args;
  const ws = workstreamForEpic(epic);
  let seq = args.startSequence;
  const featureId = `${epic.id}-corpus-foundations`;
  const items: MigrationBookOfWorkItem[] = [];

  items.push(
    corpusItem({
      id: featureId,
      type: 'feature',
      parentId: epic.id,
      title: CORPUS_FOUNDATIONS_FEATURE_TITLE,
      description:
        `Corpus-derived foundational layers (fan-in >= 2 hoisting) from the SCL scan: ` +
        `${plan.foundationStories.length} layer(s) over ${plan.stats.sharedContractCount} ` +
        `shared contract(s). Built in layer order, BEFORE the endpoint stories.`,
      workstream: ws,
      sequenceOrder: ++seq,
      tags: [CODE_PROVENANCE_TAG, `stream:${stream}`, SCL_CORPUS_PROVENANCE_TAG, 'scl'],
      recommendedNextAction:
        'Generate the focused shape-spec for each foundation layer story, in layer order.',
      traceabilitySummary:
        'Derived deterministically from the SCL corpus (latest scan contracts).',
      extras: { codeFeatureKind: 'corpus-foundations' },
    })
  );

  plan.foundationStories.forEach((planned, i) => {
    items.push(
      corpusItem({
        id: `${featureId}-s-${i + 1}`,
        type: 'story',
        parentId: featureId,
        title: planned.title,
        description: planned.description,
        workstream: ws,
        sequenceOrder: ++seq,
        tags: corpusTags(stream, planned),
        traceabilitySummary:
          `SCL corpus foundation layer '${planned.layer}': ${planned.contractKeys.length} ` +
          `contract(s), ${planned.rowCount} behaviour row(s).`,
        extras: {
          // Routes like the legacy planner-authored foundation stories
          // (cross-cutting, endpoint-less — description-grounded spec gen).
          codeStoryKind: 'foundation',
          scl_layer: planned.layer,
          scl_contract_keys: planned.contractKeys,
          scl_boundary_keys: planned.boundaryKeys ?? [],
          scl_row_count: planned.rowCount,
        },
      })
    );
  });
  return items;
}

/**
 * Corpus endpoint-group items for the interfaces epic: one NEW FEATURE per
 * legacy controller class with its 1–n endpoint stories (row-budget parts),
 * EXTERNAL controllers first, then INTERNAL. PURE over its inputs.
 *
 * Story blobs mirror the legacy interface-cluster story shape the downstream
 * carriage reads (apiInterfaceId / apiEndpointIds / baselineByEndpointId /
 * protocol markers) — with apiEndpointIds EMPTY: corpus stories are keyed by
 * SCL contract keys (`scl_contract_keys`), not committed endpoint element ids.
 */
export function buildCorpusEndpointGroupItems(args: {
  epic: MigrationBookOfWorkItem;
  stream: string;
  plan: SclCorpusPlan;
  startSequence: number;
  /**
   * Committed endpoint surface, for resolving each corpus story's declared
   * routes to endpoint element ids. Optional: when omitted the join resolves
   * nothing and `apiEndpointIds` stays empty exactly as before.
   */
  endpoints?: JoinableEndpoint[];
  /**
   * endpoint element id -> attached discovery finding ids. Used to populate
   * `findingIds` on the corpus stories once their endpoints resolve, so
   * carry-over findings have a story-level home. Previously `findingIds` was
   * populated ONLY for flagged/exceptional endpoints, leaving every corpus
   * story with no finding linkage at all.
   */
  findingIdsByEndpointId?: Map<string, string[]>;
  /**
   * Canonical endpoint -> ACTIVE baseline coverage (AMS join, 2026-09-03):
   * corpus stories used to stamp `baselineByEndpointId: {}` even when the
   * baseline was saved minutes earlier, so no acceptance criterion could name
   * the captures to replay (Kiro review MECH-02 / IMPL-07 / Join 4).
   */
  baselineByEndpointId?: Map<string, string>;
}): MigrationBookOfWorkItem[] {
  const { epic, stream, plan } = args;
  const joinEndpoints = args.endpoints ?? [];
  const findingsByEndpoint = args.findingIdsByEndpointId ?? new Map<string, string[]>();
  const baselineCoverage = args.baselineByEndpointId ?? new Map<string, string>();
  const ws = workstreamForEpic(epic);
  let seq = args.startSequence;
  const items: MigrationBookOfWorkItem[] = [];

  const emitGroups = (groups: SclPlannedStory[], kind: 'external' | 'internal') => {
    // One feature per controller; a split controller's parts stay under the
    // one feature. Insertion order preserves the plan's deterministic
    // class-sorted order.
    const byController = new Map<string, SclPlannedStory[]>();
    for (const planned of groups) {
      const controller = planned.controllerClass ?? planned.title;
      const list = byController.get(controller) ?? [];
      if (list.length === 0) byController.set(controller, list);
      list.push(planned);
    }
    for (const [controller, stories] of byController) {
      const simple = controller.includes('.')
        ? controller.slice(controller.lastIndexOf('.') + 1)
        : controller;
      const controllerSlug = controller.replace(/[^A-Za-z0-9]+/g, '-');
      const featureId = `${epic.id}-corpus-${kind}-${controllerSlug}`;
      const totalRows = stories.reduce((sum, s) => sum + s.rowCount, 0);
      items.push(
        corpusItem({
          id: featureId,
          type: 'feature',
          parentId: epic.id,
          title: `${simple} — corpus endpoint group (${kind})`,
          description:
            `${stories.length} corpus-derived stor${stories.length === 1 ? 'y' : 'ies'} ` +
            `implementing the ${kind} endpoints of ${controller} ` +
            `(${totalRows} behaviour-table row(s), row budget ${plan.stats.rowBudget}).`,
          workstream: ws,
          sequenceOrder: ++seq,
          tags: [
            CODE_PROVENANCE_TAG,
            `stream:${stream}`,
            SCL_CORPUS_PROVENANCE_TAG,
            'scl',
            `scl:endpoint:${kind}`,
          ],
          traceabilitySummary:
            `SCL corpus ${kind} endpoint group for ${controller} (latest scan).`,
          extras: {
            codeFeatureKind: 'corpus-endpoint-group',
            scl_controller_class: controller,
          },
        })
      );
      stories.forEach((planned, i) => {
        // Endpoint-identity join (2026-08-30). `apiEndpointIds` used to be
        // hardcoded empty, which made every corpus story invisible to the
        // endpoint coverage gate (it only considers stories with ids) and left
        // "which join implements endpoint X" mechanically unanswerable.
        const join = joinSclStoryToEndpoints({
          routes: planned.httpRoutes,
          endpoints: joinEndpoints,
          // Last-resort class tier (2026-09-01): this is the exact value the
          // grouping above keys on, matched against the endpoints' persisted
          // protocol_metadata_json.className when no routes were declared.
          controllerClass: controller,
        });
        // Discovery findings attached to the endpoints this story implements.
        // Deduped + sorted so the blob stays deterministic.
        const findingIds = [
          ...new Set(join.endpointIds.flatMap((id) => findingsByEndpoint.get(id) ?? [])),
        ].sort();
        const acceptanceCriteria = [
          `All ${planned.rowCount} behaviour-table row(s) across ` +
            `${planned.contractKeys.length} SCL contract(s) are implemented and verified ` +
            `row-by-row (the row is the verification unit, regardless of grouping).`,
        ];
        if (findingIds.length > 0) {
          acceptanceCriteria.push(
            `The ${findingIds.length} discovery finding(s) attached to this story's ` +
              'endpoints are addressed or explicitly carried forward with a reason.'
          );
        }
        if (join.endpointIds.length > 0) {
          acceptanceCriteria.push(
            `Parity holds for all ${join.endpointIds.length} committed endpoint(s) ` +
              'this story implements, against their captured behaviour baselines.'
          );
        }
        const traceabilityTail = join.resolvedByClass
          ? ` Joined to ${join.endpointIds.length} committed endpoint(s) by controller` +
            ' class (no routes declared; class resolved uniquely).'
          : join.endpointIds.length > 0
            ? ` Joined to ${join.endpointIds.length} committed endpoint(s) by route identity.`
            : join.joinable
              ? ` Declared ${join.unresolved.length} route(s) that match NO committed endpoint.`
              : ' No routing annotations and the controller class resolves no' +
                ' committed endpoint uniquely; scoped by SCL contract key only.';
        items.push(
          corpusItem({
            id: `${featureId}-s-${i + 1}`,
            type: 'story',
            parentId: featureId,
            title: planned.title,
            description: planned.description,
            workstream: ws,
            sequenceOrder: ++seq,
            acceptanceCriteria,
            tags: corpusTags(stream, planned),
            traceabilitySummary:
              `SCL corpus ${kind} endpoint story for ${controller}: ` +
              `${planned.contractKeys.length} contract(s), ${planned.rowCount} row(s).` +
              traceabilityTail,
            extras: {
              codeStoryKind: 'scl-endpoint-group',
              // Mirror of the legacy interface-cluster marker set the
              // downstream carriage tolerates. `apiEndpointIds` is now RESOLVED
              // by route identity where the endpoint declares a route; it stays
              // empty only when the join genuinely cannot apply.
              apiInterfaceId: null,
              apiEndpointIds: join.endpointIds,
              // Join 4 (2026-09-03): the baselines that cover the endpoints this
              // story resolved to, so the spec's acceptance criteria can name
              // the exact captures to replay.
              baselineByEndpointId: Object.fromEntries(
                join.endpointIds
                  .filter((id) => baselineCoverage.has(id))
                  .map((id) => [id, baselineCoverage.get(id)!])
              ),
              findingIds,
              protocol: null,
              scl_layer: planned.layer,
              scl_contract_keys: planned.contractKeys,
              scl_boundary_keys: planned.boundaryKeys ?? [],
              scl_row_count: planned.rowCount,
              scl_controller_class: controller,
              scl_declared_routes: (planned.httpRoutes ?? []).map(
                (r) => `${r.verb ?? 'ANY'} ${r.path ?? '(no path)'}`
              ),
              // Explicit, inspectable provenance for the join outcome so a gap
              // is visible in the blob instead of looking like "no endpoints".
              // Class identity is weaker than route identity, so it must not
              // read as a route match — it gets its own provenance value.
              scl_endpoint_join: join.resolvedByClass
                ? 'resolved_by_class'
                : join.joinable
                  ? join.unresolved.length > 0
                    ? 'partial'
                    : 'resolved'
                  : 'not_applicable',
              scl_unresolved_routes: join.unresolved.map(
                (r) => `${r.verb ?? 'ANY'} ${r.path ?? '(no path)'}`
              ),
            },
          })
        );
      });
    }
  };

  // External endpoint specs FIRST, then internal (design build order).
  emitGroups(plan.externalEndpointGroups, 'external');
  emitGroups(plan.internalEndpointGroups, 'internal');
  return items;
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
  const fetchTargetManifestArtifacts =
    deps.fetchTargetManifestArtifacts ?? defaultFetchLatestTargetManifestArtifacts;
  const fetchScaffoldServices =
    deps.fetchScaffoldServices ?? defaultFetchScaffoldServices;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const llmPool = deps.llmPool ?? getMigrationPlanLlmPool();
  const systemPrompt = deps.systemPromptOverride ?? readDefaultSystemPrompt();
  const ensurePack = deps.ensurePack ?? ensureFreshDbMigrationPack;
  const fetchPackView = deps.fetchPackView ?? defaultFetchPackView;
  let batchSize = deps.batchSizeOverride;
  if (batchSize === undefined) {
    try {
      batchSize = getConfig().migrationPlanExpansionBatchSize;
    } catch {
      batchSize = 12; // config unavailable in some unit-test contexts
    }
  }
  let dbClusterCap = deps.dbClusterCapOverride;
  if (dbClusterCap === undefined) {
    try {
      dbClusterCap = getConfig().migrationPlanDbClusterMaxTables;
    } catch {
      dbClusterCap = 25; // config unavailable in some unit-test contexts
    }
  }
  const fetchCodeModelView = deps.fetchCodeModelView ?? defaultFetchCodeModelView;
  const loadCorpusPlanFn = deps.loadCorpusPlan ?? defaultLoadCorpusPlan;
  let apiClusterCap = deps.apiClusterCapOverride;
  if (apiClusterCap === undefined) {
    try {
      apiClusterCap = getConfig().migrationPlanApiClusterMaxEndpoints;
    } catch {
      apiClusterCap = 15; // config unavailable in some unit-test contexts
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
  // Re-expansion is supported (2026-07-19): an already-`expanded` epic re-runs
  // its pipeline and REPLACES its stories via the AMS replace step on the
  // success append below — no longer a terminal state. Only a LIVE in-flight
  // expansion is rejected (a double-click cannot double-run a pipeline).
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
        deps: {
          callLlm,
          llmPool,
          fetchEpicInventory,
          systemPrompt,
          batchSize,
          ensurePack,
          fetchPackView,
          dbClusterCap,
          fetchCodeModelView,
          apiClusterCap,
          resolveAffectedConsumers:
            deps.resolveAffectedConsumers ?? resolveAffectedConsumers,
          loadCorpusPlan: loadCorpusPlanFn,
        },
      });

      // Scaffold injection (Spec 2026-06-26 FR2/FR3/FR5): when a confirmed
      // manifest exists AND this epic is the scaffold host (Group 2), inject
      // ONE code-owned feature + story, riding the SAME validate + atomic
      // append path below so they are hierarchy-legal by construction. [] when
      // no confirmed manifest or this epic is not the host (expand normally).
      // DB epics skip the gate outright (Spec 2026-07-02-b): the scaffold
      // maps only maven/npm ecosystems, so a DB epic can never host —
      // skipping avoids a pointless AMS read per DB epic. CODE epics do NOT
      // skip it (Spec 2026-07-06-g): a confirmed MAVEN manifest homes into
      // the API workstream, whose epics are deterministic now — the scaffold
      // feature+story inject onto the stream's lowest-sequence epic
      // (foundations) and ride the same validate + atomic append.
      const scaffoldItems = DB_PACK_DELIVERY_STREAMS.includes(stream)
        ? []
        : await buildScaffoldInjectionForEpic({
            projectId,
            book,
            epic,
            features,
            stream,
            fetchTargetManifestArtifacts,
            fetchScaffoldServices,
          });

      // Tag every expansion-produced item so a later RE-expand can find and
      // replace exactly this output. The AMS replace step (below) drops the
      // epic's descendant stories + any `expansionGenerated` item; the
      // skeleton's untagged features are kept for the fresh stories to parent to.
      const expansionItems: MigrationBookOfWorkItem[] = [...scaffoldItems, ...stories].map(
        (it) => ({ ...it, expansionGenerated: true })
      );

      // Validate every story against the item schema, then the FULL merged
      // hierarchy (no orphans/cycles/level-jumps/duplicate ids against the
      // merged document) BEFORE the atomic append.
      const itemErrors: string[] = [];
      expansionItems.forEach((story, idx) => {
        const result = validateMigrationBookOfWorkItem(story, idx);
        if (!result.ok) itemErrors.push(...result.errors);
      });
      if (itemErrors.length > 0) {
        throw new Error(`Expanded stories failed schema validation: ${itemErrors.join('; ')}`);
      }
      // Validate against the book with THIS epic's prior expansion output pruned
      // (mirrors the AMS replace), so a re-run whose stories carry deterministic
      // ids does not trip the duplicate-id guard on the rows about to be replaced.
      const priorOutputIds = epicExpansionOutputIds(book.items, epicId);
      const survivors = book.items.filter((it) => !priorOutputIds.has(it.id));
      const merged = validateBookOfWorkHierarchy([...survivors, ...expansionItems]);
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
        items: expansionItems,
        expansion_state: 'expanded',
        // Replace, not append: AMS drops the epic's prior output first. A no-op
        // on a first expand (nothing tagged yet); on a re-expand it swaps the
        // stale stories for the fresh ones in one transaction.
        replace_epic_expansion: true,
      });
      console.log(
        `[diag-gateway] pm_migration_delivery_plan stage=expansion_complete projectId=${projectId} ` +
          `epicId=${epicId} stories=${stories.length}`
      );
      trace.predicate(
        'PLAN.EXP.02', 'epic expanded atomically with verified stories', true,
        'stories appended in one atomic append after layered verification',
        `epicId=${epicId} stories=${stories.length}`,
        { project: projectId },
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
      trace.predicate(
        'PLAN.EXP.02', 'epic expanded atomically with verified stories', false,
        'stories appended in one atomic append after layered verification',
        `epicId=${epicId} FAILED (retryable): ${message.slice(0, 200)}`,
        { project: projectId },
      );
      return { epicId, expansionState: 'failed', storiesAppended: 0, error: message };
    }
  } finally {
    activeExpansions.delete(key);
  }
}

/**
 * Expand ALL expandable epics of a book: `not_expanded`, `failed`
 * (retryable), and STALE `expanding`. With `input.includeExpanded` (the
 * "Expand all" button) already-`expanded` epics are RE-expanded too; without it
 * ("Expand remaining") they are skipped. Live in-flight epics are always
 * skipped. Per-epic pipelines fan out concurrently, but every LLM call still goes
 * through the ONE shared pool — total in-flight LLM requests never exceed
 * MIGRATION_PLAN_LLM_CONCURRENCY regardless of epic count.
 */
export async function expandAllMigrationBookOfWorkEpics(
  input: { projectId: string; bookId: string; includeExpanded?: boolean },
  deps: MigrationBookOfWorkExpansionDeps = {}
): Promise<ExpandAllOutcome> {
  const fetchBook = deps.fetchBook ?? defaultFetchBook;
  const book = await fetchBook(input.projectId, input.bookId);
  const selection = selectExpandableEpics(input.bookId, book.items, {
    includeExpanded: input.includeExpanded === true,
  });
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
