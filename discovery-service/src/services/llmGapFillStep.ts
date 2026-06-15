/**
 * V3 LLM Gap-Fill Stage.
 *
 * Spec: 2026-04-19 V3 Layered Prompt System — Task Group 4.
 *
 * Orchestrates per-file LLM gap-fill calls:
 *
 *   1. Skip heuristic — if the pack already produced >=N candidates for the
 *      file AND no "potential gap" signals trip, skip the LLM call entirely.
 *   2. Compose the prompt via `composePrompt` (layered base + language +
 *      framework + pack-output/IR injection + source).
 *   3. Call `gatewayClient.gapFill` (stateless relay to the LLM).
 *   4. Parse the raw response as a JSON array of candidates.
 *   5. Validate each candidate has the required schema fields
 *      (`type`, `name`, `filePath`, `confidence`).
 *   6. Inject stage-owned fields (`_addedBy`, `sourceClusterIds`, `discoveryRunId`).
 *   7. Dedup the surviving LLM candidates against the pack candidates via
 *      `dedupLlmCandidates`.
 *   8. Bug 4 fix (2026-04-20): run a cross-file coalesce pass over the
 *      surviving LLM candidates keyed on `(type, normalizeName(name))` —
 *      intentionally path-free — merging duplicates that the LLM emitted
 *      from multiple files when it referenced the same shared element.
 *      The merged candidate's `sourceClusterIds` is the UNION of every
 *      LLM-emitted filePath across the collapsed duplicates, so reviewers
 *      can still trace back to every file that flagged the element.
 *
 * Concurrency: per-file calls are parallelized with a simple promise-pool
 * limiter (default 5, env-tunable via `GAP_FILL_CONCURRENCY`).
 *
 * Failure handling: per-file failures (network error, non-JSON response, or a
 * response where every candidate fails schema validation) are recorded on
 * `failures[]`; the run continues. The stage is marked `failed` only if the
 * failure rate exceeds `GAP_FILL_MAX_FAILURE_RATE` (default 0.2).
 *
 * Tier-based `_addedBy` tagging:
 *   - Tier A (framework pack active) -> `'llm-gap-fill'`
 *   - Tier B (language-only, IR present) -> `'llm-ir-guided'`
 *   - Tier C (nothing matches / unclassifiable) -> `'llm-solo'`
 *
 * Tier C files with empty pack output are NOT skipped — per spec Q11, they
 * are routed through the Tier C prompt path anyway so they still get a shot
 * at producing candidates.
 */

import { gatewayClient, GapFillGatewayError } from './gatewayClient';
import {
  composePrompt,
  ComposePromptInput,
  PromptTier,
  PromptVersion,
} from './prompts/composer';
import type {
  PackOutputInjectionItem,
  IrInjectionPayload,
  ExistingEntityInjectionItem,
} from './prompts/injection';
import {
  dedupLlmCandidates,
  DedupCandidate,
  normalizeName,
} from './prompts/dedup';
import type { DiscoveryCandidate } from '../types/candidate';
import type { RuntimeEvidenceLlmContext } from './runtimeEvidence/httpRuntimeObservation';
import { getConfidenceForTag } from './confidence';
// Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 3): content-
// addressed gap-fill LLM-output cache (the gap-fill ANALOGUE of the behaviour
// stage's source_hash cache -- a SEPARATE instance, reusing the APPROACH).
import {
  GapFillResponseCache,
  readGapFillCacheModel,
  GAP_FILL_RELAY_TEMPERATURE,
} from './gapFillResponseCache';

// ============================================================================
// Env-tunable defaults
// ============================================================================

const DEFAULT_SKIP_THRESHOLD = 3;
// Bug-1 fix (rate-limit handling 2026-04-21): lowered from 5 to 2. Combined
// with the 429-aware retry in gatewayClient.gapFill, this keeps a large-file
// run (e.g. ~150+ file frontend) from tripping provider rate limits on first
// attempt. Env-tunable via `GAP_FILL_CONCURRENCY` for tenants with higher
// quotas.
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_FAILURE_RATE = 0.2;

/**
 * Default signal ids considered when deciding whether to override the skip
 * heuristic. Override via `GAP_FILL_SKIP_SIGNALS` (comma-separated).
 */
const DEFAULT_SIGNAL_IDS = [
  'unparsed_xml',
  'low_capture',
  'business_comments',
  'external_imports',
];

/**
 * Minimal business-domain vocabulary used to flag top-level
 * comments/Javadoc that hint at a domain concern the pack may have missed.
 * Kept intentionally small and generic — real projects can extend via code
 * if needed; the signal list itself is env-toggleable.
 */
const DEFAULT_BUSINESS_COMMENT_TERMS = [
  'patient',
  'invoice',
  'order',
  'payment',
  'billing',
  'claim',
  'customer',
  'account',
  'policy',
  'prescription',
  'appointment',
  'shipment',
  'inventory',
  'checkout',
];

/**
 * Imports that signal the file touches concerns outside the spring-classic
 * pack's declared remit. Any match triggers the LLM call even when pack
 * candidates are above the skip threshold. Match is a substring check on each
 * import line so both FQCNs and wildcards are caught.
 */
const SPRING_CLASSIC_EXTERNAL_IMPORT_PATTERNS = [
  'org.springframework.web.client.RestTemplate',
  'RestTemplate',
  'org.springframework.web.reactive.function.client.WebClient',
  'WebClient',
  'FeignClient',
  'openfeign',
  'jakarta.jms',
  'javax.jms',
  'org.springframework.jms',
  'kafka',
  'rabbit',
];

// ============================================================================
// Input / output types
// ============================================================================

/**
 * Per-file input to the gap-fill stage. The caller (the V3 pipeline) is
 * responsible for choosing the tier and projecting pack output + IR into the
 * injection-ready shapes.
 */
export interface GapFillStepFile {
  filePath: string;
  /** Full source contents (already truncated upstream per DISCOVERY_FILE_LINE_LIMIT). */
  sourceCode: string;
  tier: PromptTier;
  /** Language id for prompt layer selection. Null for unclassifiable files. */
  language: string | null;
  /** Framework pack id — only set for Tier A. */
  frameworkPackId: string | null;
  /**
   * Pack-produced candidates for this file. The structural fields
   * (`candidateType` / `name` / `sourceClusterIds[0]`) are enough for dedup;
   * the stage does NOT inspect any other fields.
   */
  packCandidates: DiscoveryCandidate[];
  /** Structural IR summary (classes + methods + imports). Null when unavailable. */
  ir: IrInjectionPayload | null;
}

/**
 * Top-level stage input.
 */
export interface GapFillStepInput {
  runId: string;
  files: GapFillStepFile[];
  /**
   * Optional run-level runtime evidence context produced by the
   * runtime-evidence sub-stage (Spec 5). Threaded into every per-file
   * prompt composition so the LLM can reason about endpoint usage
   * patterns alongside `packCandidates` and `ir`. When absent or
   * `{ skipped: true }`-equivalent the prompt composer renders a
   * one-line stub (or omits the section entirely) -- existing
   * non-runtime behaviour is preserved byte-for-byte.
   *
   * Spec: 2026-05-10 Web Access Log Runtime Endpoint Evidence -- Task Group 4.
   */
  runtimeEvidenceContext?: RuntimeEvidenceLlmContext;
  /**
   * Optional LEAN existing-entity index (Model-Aware Discovery, 2026-05-30).
   *
   * Loaded run-level from the existing (project, architecture) model and
   * threaded into EVERY per-file prompt composition as the "these already
   * exist -- don't restate; propose enrich/link" nudge. Lean
   * (`type` / `name` / `parentOrTableHint`) only -- no attributes /
   * descriptions / relationship payloads. Absent on a first run (empty model).
   *
   * NUDGE only: the load-bearing dedup / match against existing entities runs
   * deterministically in CODE at save-back, NEVER here.
   *
   * Spec: 2026-05-30 Model-Aware Discovery -- Task Group 2 (model-as-input).
   */
  existingEntities?: ExistingEntityInjectionItem[];
}

/**
 * Per-file failure record captured on `steps_payload.gapFill.failures[]`.
 */
export interface GapFillFailure {
  filePath: string;
  error: string;
}

/**
 * Stage output consumed by `runDiscoveryV3` (Task Group 5).
 */
export interface GapFillStepOutput {
  /** Surviving (post-dedup) LLM candidates, tagged with tier-appropriate _addedBy. */
  llmCandidates: DiscoveryCandidate[];
  stageStatus: 'completed' | 'failed';
  failures: GapFillFailure[];
  /**
   * Per-file gap-fill failure count (Spec 2026-05-30 Oracle Integrity &
   * Determinism, Task Group 2). Derived as `failures.length` -- the SAME array
   * surfaced above, exposed as a scalar so the run-integrity computation in
   * `discoveryV3Pipeline.ts` can wire the real count into the run record's
   * `filesFailed` (replacing the historical hardcoded `0`) and treat a nonzero
   * count as a degraded trigger. A failed file produces zero candidates but the
   * run still COMPLETES -- this scalar is the advisory visibility signal, NOT a
   * blocking gate (the `GAP_FILL_MAX_FAILURE_RATE` -> `stageStatus` semantics
   * are unchanged).
   */
  filesFailed: number;
  dedupDroppedCount: number;
  /**
   * Bug 4 fix (2026-04-20): number of LLM candidates collapsed by the
   * cross-file coalesce pass. Keyed on `(candidateType, normalizeName(name))`
   * with filePath intentionally excluded — multiple files may have flagged
   * the same architectural element (e.g. a shared entity referenced from
   * repositories/services/controllers) and prior to this fix each file's
   * emission survived separately, inflating the candidate set. Surfaced here
   * so observability can monitor how often this happens.
   */
  crossFileDedupCount: number;
  /**
   * Prompt version from a representative file (the first file the stage
   * actually invoked the LLM for — not a skipped file). Falls back to a
   * synthetic all-empty-string composition when every file skipped.
   */
  promptVersion: PromptVersion;
}

// ============================================================================
// Env reader helpers
// ============================================================================

function readSkipThreshold(): number {
  const raw = process.env.GAP_FILL_SKIP_THRESHOLD;
  if (!raw) return DEFAULT_SKIP_THRESHOLD;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SKIP_THRESHOLD;
}

function readConcurrency(): number {
  const raw = process.env.GAP_FILL_CONCURRENCY;
  if (!raw) return DEFAULT_CONCURRENCY;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONCURRENCY;
}

function readMaxFailureRate(): number {
  const raw = process.env.GAP_FILL_MAX_FAILURE_RATE;
  if (!raw) return DEFAULT_MAX_FAILURE_RATE;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : DEFAULT_MAX_FAILURE_RATE;
}

function readEnabledSignals(): Set<string> {
  const raw = process.env.GAP_FILL_SKIP_SIGNALS;
  if (!raw || !raw.trim()) return new Set(DEFAULT_SIGNAL_IDS);
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(ids.length > 0 ? ids : DEFAULT_SIGNAL_IDS);
}

// ============================================================================
// Signal detection
// ============================================================================

/**
 * Detect the set of "potential gap" signals tripped by a file. Any one of
 * these forces the LLM call to proceed even when the pack produced enough
 * candidates to otherwise skip the file.
 */
function detectSignals(
  file: GapFillStepFile,
  enabled: Set<string>,
): string[] {
  const hits: string[] = [];
  const src = file.sourceCode || '';

  if (enabled.has('unparsed_xml')) {
    if (
      src.includes('<?xml') ||
      src.includes('<beans') ||
      /(^|\n)---\s*\n/.test(src)
    ) {
      hits.push('unparsed_xml');
    }
  }

  if (enabled.has('low_capture')) {
    const lineCount = src.split(/\r?\n/).length;
    if (lineCount > 200 && file.packCandidates.length < 3) {
      hits.push('low_capture');
    }
  }

  if (enabled.has('business_comments')) {
    // Top-of-file comments only — scan the first ~40 lines for a business term
    // in a comment context. Kept intentionally lightweight.
    const headLines = src.split(/\r?\n/).slice(0, 40);
    const commentLines = headLines
      .filter((l) => /^\s*(\/\/|\/\*|\*|#|<!--)/.test(l))
      .join(' ')
      .toLowerCase();
    for (const term of DEFAULT_BUSINESS_COMMENT_TERMS) {
      if (commentLines.includes(term)) {
        hits.push('business_comments');
        break;
      }
    }
  }

  if (enabled.has('external_imports')) {
    // We only check the spring-classic pack's remit explicitly; other
    // framework packs can extend this later (Spec 4 scope).
    if (file.frameworkPackId === 'spring-classic' || file.frameworkPackId === null) {
      for (const pattern of SPRING_CLASSIC_EXTERNAL_IMPORT_PATTERNS) {
        if (src.includes(pattern)) {
          hits.push('external_imports');
          break;
        }
      }
    }
  }

  return hits;
}

/**
 * Decide whether to skip the LLM call for a file.
 *
 * Skip rule (per spec Q5):
 *   Skip only when BOTH:
 *     - pack produced >=N candidates, AND
 *     - zero gap signals tripped
 *
 * Any signal overrides the skip; any file below N proceeds to the LLM.
 */
function shouldSkip(
  file: GapFillStepFile,
  threshold: number,
  enabledSignals: Set<string>,
): { skip: boolean; signals: string[] } {
  const signals = detectSignals(file, enabledSignals);
  if (file.packCandidates.length >= threshold && signals.length === 0) {
    return { skip: true, signals };
  }
  return { skip: false, signals };
}

// ============================================================================
// Tier -> _addedBy mapping
// ============================================================================

function addedByForTier(tier: PromptTier): 'llm-gap-fill' | 'llm-ir-guided' | 'llm-solo' {
  if (tier === 'A') return 'llm-gap-fill';
  if (tier === 'B') return 'llm-ir-guided';
  return 'llm-solo';
}

// ============================================================================
// Pack candidate projection (for injection + dedup)
// ============================================================================

/**
 * Project a `DiscoveryCandidate` into the compact shape accepted by the
 * pack-output injection renderer. Only the fields the LLM needs to see.
 *
 * Abstraction-mapping fields (`tableName`, `columnName`, `entityClassName`)
 * are surfaced from `data` when the adapter attached them, so the LLM can
 * recognise Java↔SQL equivalences and obey the base-prompt abstraction-layer
 * rule (e.g. not re-emit `physical_entity: owners` when the pack already
 * emitted `physical_entity: Owner` with `tableName: "owners"`).
 */
function projectPackCandidateForInjection(c: DiscoveryCandidate): PackOutputInjectionItem {
  const filePath = Array.isArray(c.sourceClusterIds) && c.sourceClusterIds.length > 0
    ? c.sourceClusterIds[0]
    : '';
  const data = (c.data ?? {}) as Record<string, unknown>;
  const out: PackOutputInjectionItem = {
    type: c.candidateType,
    name: c.name,
    filePath,
  };
  if (typeof data.tableName === 'string' && data.tableName.length > 0) {
    out.tableName = data.tableName;
  }
  if (typeof data.columnName === 'string' && data.columnName.length > 0) {
    out.columnName = data.columnName;
  }
  if (typeof data.entityClassName === 'string' && data.entityClassName.length > 0) {
    out.entityClassName = data.entityClassName;
  }
  // Role-hint pass: when the angularjs-classic adapter classified a row
  // as `ui_components`, attach a hint reminding the LLM not to promote
  // it to `ui_screens`. The adapter is authoritative on screen-vs-component
  // for AngularJS 1.x because it scans every file for `$routeProvider`/
  // `$stateProvider` bindings — the LLM only sees one file per call and
  // would otherwise infer "screen" from suffix shape (`*Ctrl`, `*Modal`).
  // The dedup type-swap guard catches this if the LLM re-emits anyway,
  // but the prompt-side hint discourages the emission in the first place.
  const addedBy =
    typeof data._addedBy === 'string' ? (data._addedBy as string) : undefined;
  if (
    addedBy === 'angularjs-classic-adapter' &&
    c.candidateType === 'ui_components'
  ) {
    out.hint = 'role: ui_components (no $routeProvider/$stateProvider binding found in any file) — do NOT re-emit as ui_screens';
  }
  return out;
}

/**
 * Project a `DiscoveryCandidate` into the shape `dedupLlmCandidates` needs.
 *
 * `addedBy` is forwarded from `data._addedBy` (the adapter source tag set
 * inside each pack adapter's `makeCandidate`) so the dedup type-swap guard
 * can recognise candidates from trusted classifier adapters. Adapters not
 * enrolled in `TRUSTED_CLASSIFIER_ADAPTERS` simply have no effect on the
 * guard; their `addedBy` is forwarded but ignored.
 */
function projectPackCandidateForDedup(c: DiscoveryCandidate): DedupCandidate {
  const filePath = Array.isArray(c.sourceClusterIds) && c.sourceClusterIds.length > 0
    ? c.sourceClusterIds[0]
    : '';
  const addedBy =
    c.data && typeof (c.data as Record<string, unknown>)._addedBy === 'string'
      ? ((c.data as Record<string, unknown>)._addedBy as string)
      : undefined;
  return {
    type: c.candidateType,
    name: c.name,
    filePath,
    addedBy,
  };
}

// ============================================================================
// Parse + validate LLM response
// ============================================================================

/**
 * Shape the LLM is prompted to emit per candidate. Schema validation happens
 * against this shape; missing required fields drop the candidate.
 */
interface RawLlmCandidate {
  type?: unknown;
  name?: unknown;
  filePath?: unknown;
  confidence?: unknown;
  description?: unknown;
  [key: string]: unknown;
}

const REQUIRED_LLM_FIELDS: Array<keyof RawLlmCandidate> = [
  'type',
  'name',
  'filePath',
  'confidence',
];

function isValidRawCandidate(raw: RawLlmCandidate): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  if (typeof raw.type !== 'string' || raw.type.length === 0) return false;
  if (typeof raw.name !== 'string' || raw.name.length === 0) return false;
  if (typeof raw.filePath !== 'string' || raw.filePath.length === 0) return false;
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence)) return false;
  return true;
}

/**
 * Auto-enrich a raw LLM candidate by inferring missing structured fields
 * from its `name` when the name follows a recognisable convention. Mutates
 * `raw` in place.
 *
 * Why: the OpenMRS scan (2026-04-25) showed LLM rows like
 * `business_logics: Daemon.isDaemonUser` and
 * `physical_data_attributes: Alert.dateCreated` arriving with empty
 * `className` / `entityClassName` data fields. The `Class.field` shape is
 * already in `name`; we can recover the structured metadata cheaply rather
 * than dropping the row.
 */
function enrichRawCandidate(raw: RawLlmCandidate): void {
  if (typeof raw.name !== 'string') return;

  // Pattern A: `Class.field` / `Class.method`. Auto-derive parent + child.
  const dotMatch = /^([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(raw.name);
  if (dotMatch) {
    const [, parentName, childName] = dotMatch;
    switch (raw.type) {
      case 'business_logics':
        if (typeof raw.className !== 'string' || raw.className.length === 0) {
          raw.className = parentName;
        }
        break;
      case 'physical_data_attributes':
        if (typeof raw.entityClassName !== 'string' || raw.entityClassName.length === 0) {
          raw.entityClassName = parentName;
        }
        if (typeof raw.fieldName !== 'string' || raw.fieldName.length === 0) {
          raw.fieldName = childName;
        }
        break;
      case 'logical_data_attributes':
        if (typeof raw.logicalEntityName !== 'string' || raw.logicalEntityName.length === 0) {
          raw.logicalEntityName = parentName;
        }
        if (typeof raw.fieldName !== 'string' || raw.fieldName.length === 0) {
          raw.fieldName = childName;
        }
        break;
    }
  }

  // Pattern B: `Source → Target` / `Source -> Target` for relationship and
  // interface↔entity rows. Mirrors the canonical `name` form the adapter
  // emits, so when the LLM imitates that form without populating the
  // structured fields, we recover them here. Accepts both the Unicode
  // arrow (U+2192) and ASCII `->`. Whitespace tolerant.
  // Bug-context: OpenMRS LLM gap-fill (2026-04-25) emitted
  // `Encounter → Patient` rows with empty sourceEntity/targetEntity that
  // the structured-metadata gate would otherwise drop.
  const arrowMatch = /^([A-Z][A-Za-z0-9_]*)\s*(?:→|->)\s*([A-Z][A-Za-z0-9_]*)$/.exec(
    raw.name.trim(),
  );
  if (arrowMatch) {
    const [, source, target] = arrowMatch;
    switch (raw.type) {
      case 'logical_data_entity_relationships':
        if (typeof raw.sourceEntity !== 'string' || raw.sourceEntity.length === 0) {
          raw.sourceEntity = source;
        }
        if (typeof raw.targetEntity !== 'string' || raw.targetEntity.length === 0) {
          raw.targetEntity = target;
        }
        break;
      case 'interface_logical_entities':
        if (typeof raw.interfaceClassName !== 'string' || raw.interfaceClassName.length === 0) {
          raw.interfaceClassName = source;
        }
        if (typeof raw.logicalEntityName !== 'string' || raw.logicalEntityName.length === 0) {
          raw.logicalEntityName = target;
        }
        break;
    }
  }
}

/**
 * Per-candidate-type structured-metadata gate. Returns `true` if the row
 * carries enough context to be useful downstream and to participate in
 * dedup; `false` if the row should be dropped as "name only, no
 * structure" — those are noise more often than signal in practice.
 *
 * The gate is checked AFTER `enrichRawCandidate`, so `Class.field`-style
 * names that have been auto-split into structured fields pass.
 *
 * Drop policies (returning false drops the row):
 *
 *   endpoints                          → `httpMethod` AND `fullPath`/`path`/`url`
 *                                        (the OpenMRS run produced an
 *                                         `endpoints: MESSAGE ADT_A28` row
 *                                         with neither — pure hallucination)
 *   physical_data_attributes           → `entityClassName`
 *   logical_data_attributes            → `logicalEntityName`
 *   interface_logical_entities         → `interfaceClassName` AND
 *                                        `logicalEntityName`
 *   logical_data_entity_relationships  → `sourceEntity` AND `targetEntity`
 *   business_logics                    → `className` (after enrichment)
 *   physical_data_entities             → `entityClassName` OR `tableName`
 *
 * Types intentionally NOT gated (the bare `name` is enough on its own):
 *   interfaces, logical_data_entities, ui_screens, ui_components
 */
function hasRequiredStructuredFields(raw: RawLlmCandidate): boolean {
  const has = (k: string): boolean =>
    typeof raw[k] === 'string' && (raw[k] as string).length > 0;
  switch (raw.type) {
    case 'endpoints':
      return has('httpMethod') && (has('fullPath') || has('path') || has('url'));
    case 'physical_data_attributes':
      return has('entityClassName');
    case 'logical_data_attributes':
      return has('logicalEntityName');
    case 'interface_logical_entities':
      return has('interfaceClassName') && has('logicalEntityName');
    case 'logical_data_entity_relationships':
      return has('sourceEntity') && has('targetEntity');
    case 'business_logics':
      return has('className');
    case 'interfaces': {
      // (6) 2026-04-25: drop interfaces whose `name` is ALL_CAPS_WITH_UNDERSCORES.
      // The OpenMRS LLM gap-fill emitted rows like `ATTR_VIEW_TYPE` (a static
      // int constant) as `interfaces`. Constants are never architectural
      // interfaces — they're data, not contracts. base.md's "must be a
      // concrete named type" rule should catch this; the gate enforces.
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
      return true;
    }
    // `physical_data_entities`, `logical_data_entities`, `interfaces`,
    // `ui_screens`, `ui_components` intentionally have NO structured-field
    // gate — the architectural identity rides on `name` alone. Adding a
    // gate would drop the LLM's most useful "I noticed a missed
    // table/entity/component" emissions when it can't derive the matching
    // structured fields without seeing the rest of the codebase.
    default:
      return true;
  }
}

/**
 * Parse the raw LLM content into an array of validated raw candidates.
 *
 * Throws when:
 *   - the content is not valid JSON
 *   - the JSON is not an array
 *   - the array is non-empty but every element fails validation
 *
 * An empty array parses cleanly and produces zero candidates (valid outcome).
 */
function parseAndValidate(content: string): RawLlmCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM response was not valid JSON: ${msg}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('LLM response JSON was not an array');
  }
  if (parsed.length === 0) return [];

  const valid: RawLlmCandidate[] = [];
  let droppedShape = 0;
  let droppedStructure = 0;
  for (const item of parsed) {
    const raw = item as RawLlmCandidate;
    if (!isValidRawCandidate(raw)) {
      droppedShape++;
      continue;
    }
    enrichRawCandidate(raw);
    if (!hasRequiredStructuredFields(raw)) {
      droppedStructure++;
      continue;
    }
    valid.push(raw);
  }
  if (droppedShape > 0 || droppedStructure > 0) {
    console.log(
      `[llmGapFill] parseAndValidate dropped ${droppedShape} shape-fail + ${droppedStructure} structured-metadata-fail rows; kept ${valid.length}`,
    );
  }
  if (valid.length === 0 && parsed.length > 0) {
    throw new Error(
      `LLM response had ${parsed.length} item(s) but none passed validation ` +
        `(shape-fail=${droppedShape}, structured-metadata-fail=${droppedStructure}; ` +
        `required shape: ${REQUIRED_LLM_FIELDS.join(', ')}; ` +
        `per-type structured fields enforced via hasRequiredStructuredFields)`,
    );
  }
  return valid;
}

// ============================================================================
// Build a DiscoveryCandidate from a validated LLM raw candidate
// ============================================================================

/**
 * Normalise an LLM-proposed `operation` value (Model-Aware Discovery,
 * 2026-05-30). Anything other than the two enrich/link operations -- including
 * undefined / a typo / a non-string -- collapses to `create`, the safe
 * default. The LLM only PROPOSES the operation; the load-bearing target match
 * runs deterministically in CODE at save-back, so a misclassified operation
 * here can never silently corrupt the model -- at worst it surfaces as a
 * reviewable candidate.
 */
function normalizeOperation(raw: unknown): 'create' | 'enrich' | 'link' {
  if (raw === 'enrich' || raw === 'link') return raw;
  return 'create';
}

/**
 * Project a validated raw LLM candidate into the `DiscoveryCandidate` shape
 * the rest of the pipeline expects, injecting stage-owned fields.
 *
 * Note: `id`, `runId`, `status`, `synthesizedAt` remain responsibilities of
 * the merge/persist stage downstream (Task Group 5/6). We fill them with
 * sensible defaults so tests / callers can pass candidates around without
 * tripping the compiler, and downstream can overwrite as needed.
 */
function buildDiscoveryCandidate(
  raw: RawLlmCandidate,
  tier: PromptTier,
  runId: string,
): DiscoveryCandidate {
  const addedBy = addedByForTier(tier);
  const baseData: Record<string, unknown> = {};
  // Pass through optional LLM fields (description, etc.) on `data` so they
  // remain visible to downstream stages without polluting the top-level shape.
  for (const [key, value] of Object.entries(raw)) {
    if (!(REQUIRED_LLM_FIELDS as string[]).includes(key)) {
      baseData[key] = value;
    }
  }
  // Spec hotfix 2026-04-20: persist `_addedBy` INSIDE `data` (not just at
  // the top level) so it survives the bulkSaveCandidates -> archModelClient
  // round-trip into the Java model service. The persistence layer only
  // serialises canonical entity fields plus whatever lives on `data`; any
  // top-level _addedBy on the in-process candidate is stripped on the way
  // out. Pack adapters already follow this convention (e.g. springClassic
  // sets data._addedBy = 'spring-classic-adapter') -- this aligns the LLM
  // stage with the same contract so the resulting candidate rows carry
  // their tag.
  baseData._addedBy = addedBy;

  const candidate: DiscoveryCandidate & Record<string, unknown> = {
    id: '',
    runId,
    candidateType: raw.type as DiscoveryCandidate['candidateType'],
    name: raw.name as string,
    // Spec 2026-04-20 Task Group 3: apply centralized confidence so LLM
    // values are clamped into the tag range and missing values fall back to
    // the tag midpoint (llm-gap-fill=0.75, llm-ir-guided=0.6, llm-solo=0.4).
    confidence: getConfidenceForTag(addedBy, typeof raw.confidence === 'number' ? raw.confidence : undefined),
    status: 'proposed',
    // Model-Aware Discovery (2026-05-30): the operation dimension. Defaults to
    // 'create'; the LLM may PROPOSE 'enrich' / 'link', in which case the
    // target entity NAME(s) + confidence ride on `data` (e.g.
    // `targetEntityName` for enrich; `logicalEntityName` + `physicalEntityName`
    // for link) and are resolved to ids LATE at save-back -- NEVER a resolved
    // id, NEVER a `*_points` wrapper here.
    operation: normalizeOperation(raw.operation),
    sourceClusterIds: [],
    data: baseData,
    synthesizedAt: new Date().toISOString(),
    // Stage-owned injected fields — placed at the top level so callers can
    // inspect them without reaching into `data`. `_addedBy` uses an
    // underscore prefix to mark it as a stage-injected flag rather than a
    // canonical model field.
    _addedBy: addedBy,
    discoveryRunId: runId,
  };

  // Surface the optional `description` at the top level too if emitted, since
  // existing downstream hooks may look for it. Harmless duplication.
  if (typeof raw.description === 'string') {
    (candidate as Record<string, unknown>).description = raw.description;
  }

  return candidate;
}

// ============================================================================
// Concurrency pool
// ============================================================================

/**
 * Run `worker(item)` for every item in `items` with at most `limit` workers
 * in flight at once. Preserves the input order in the returned array.
 *
 * Hand-rolled to avoid adding a dependency (Task Group 4 spec: "no new
 * dependencies").
 */
async function promisePool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  for (let w = 0; w < effectiveLimit; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ============================================================================
// Per-file processing
// ============================================================================

/**
 * Pair a built DiscoveryCandidate with the raw filePath the LLM emitted for
 * it. The LLM-emitted path is what dedup compares against the pack's
 * `(type, normalize(name), filePath)` key — NOT the file-under-analysis path
 * — so that an LLM emitting a candidate pointing at a DIFFERENT file from
 * the one it was analyzing (valid when the LLM spots a cross-file reference)
 * does not get falsely deduped away.
 */
interface BuiltCandidate {
  candidate: DiscoveryCandidate;
  llmFilePath: string;
}

interface PerFileResult {
  file: GapFillStepFile;
  skipped: boolean;
  /** Undeduped LLM candidates from this file (pre-dedup against pack output). */
  built: BuiltCandidate[];
  failure: GapFillFailure | null;
  promptVersion: PromptVersion | null;
}

async function processFile(
  file: GapFillStepFile,
  runId: string,
  threshold: number,
  enabledSignals: Set<string>,
  runtimeEvidenceContext: RuntimeEvidenceLlmContext | undefined,
  existingEntities: ExistingEntityInjectionItem[] | undefined,
  cache: GapFillResponseCache,
  cacheModel: string,
): Promise<PerFileResult> {
  const { skip, signals } = shouldSkip(file, threshold, enabledSignals);
  if (skip) {
    console.log(
      `[GapFill] SKIP ${file.filePath}: pack=${file.packCandidates.length} >= ${threshold}, signals=[]`,
    );
    return {
      file,
      skipped: true,
      built: [],
      failure: null,
      promptVersion: null,
    };
  }

  // Compose the prompt.
  const composeInput: ComposePromptInput = {
    tier: file.tier,
    language: file.language ?? undefined,
    frameworkPackId: file.frameworkPackId ?? undefined,
    packOutput: file.packCandidates.map(projectPackCandidateForInjection),
    ir: file.ir ?? undefined,
    sourceFile: { filePath: file.filePath, content: file.sourceCode },
    runtimeEvidenceContext,
    existingEntities,
  };
  const { prompt, promptVersion } = composePrompt(composeInput);

  if (signals.length > 0) {
    console.log(
      `[GapFill] PROCEED ${file.filePath}: tier=${file.tier}, signals=[${signals.join(',')}]`,
    );
  } else {
    console.log(
      `[GapFill] PROCEED ${file.filePath}: tier=${file.tier}, pack=${file.packCandidates.length} < ${threshold}`,
    );
  }

  // Content-addressed cache (Spec 2026-05-30, Task Group 3): key on
  // (normalized-prompt + model + temperature). On a HIT, reuse the prior
  // response with NO relay/LLM call (reproducibility + cost). The key includes
  // W2's temperature: 0. Cache miss -> call the relay, then store the response.
  const cacheKey = cache.keyFor(prompt, cacheModel, GAP_FILL_RELAY_TEMPERATURE);
  let rawContent: string;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(
      `[GapFill] CACHE-HIT ${file.filePath}: reusing prior response (no LLM call), contentLen=${cached.content.length}`,
    );
    rawContent = cached.content;
  } else {
    // Call the gateway relay.
    try {
      const response = await gatewayClient.gapFill(prompt, file.filePath, runId);
      rawContent = response?.content ?? '';
      // Store the fresh response so a later byte-identical prompt reuses it.
      cache.set(cacheKey, { content: rawContent });
    } catch (err) {
      const message = err instanceof GapFillGatewayError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
      return {
        file,
        skipped: false,
        built: [],
        failure: { filePath: file.filePath, error: message },
        promptVersion,
      };
    }
  }

  // Parse + validate.
  let rawCandidates: RawLlmCandidate[];
  try {
    rawCandidates = parseAndValidate(rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      file,
      skipped: false,
      built: [],
      failure: { filePath: file.filePath, error: message },
      promptVersion,
    };
  }

  const allBuilt: BuiltCandidate[] = rawCandidates.map((raw) => ({
    candidate: buildDiscoveryCandidate(raw, file.tier, runId),
    llmFilePath: raw.filePath as string,
  }));

  // Bug-15 fix (2026-04-21): drop attribute / relationship candidates whose
  // parent will be filtered by the adapter pack as UI plumbing (e.g. React
  // component `*Props` / Redux `*State`). The LLM emits attributes like
  // `RuleState.name` and `CreateChangeViewDefinitionDialogProps.onDismiss`
  // but the pack's `isLikelyDto` rejects the corresponding parent entity
  // (via `NON_DOMAIN_INTERFACE_SUFFIXES`), so the attribute ends up orphaned
  // at save-back. Drop them at the gap-fill stage so they never clutter the
  // candidate set in the first place. Keeps this predicate in-sync with the
  // `NON_DOMAIN_INTERFACE_SUFFIXES` regex in
  // `frameworkAdapters/reactAxios/index.ts`.
  const FILTERED_PARENT_SUFFIX =
    /(Props|State|Action|Payload|Args|Options|Config|Context|Event|Handler|Callback)$/;
  const parentName = (name: string): string | null => {
    const dot = name.indexOf('.');
    return dot > 0 ? name.slice(0, dot) : null;
  };
  const relArrowSplit = (name: string): { src: string; tgt: string } | null => {
    const parts = name.split(/\s*(?:→|->|-->)\s*/);
    return parts.length === 2 ? { src: parts[0].trim(), tgt: parts[1].trim() } : null;
  };

  // Bug 4 fix (2026-04-21): the LLM sometimes emits the same element twice
  // within a single response (e.g. two `buildProductionData` entries when it
  // sees the same shape across sibling stub providers). The cross-file
  // coalesce pass handles cross-file duplicates but not same-file ones, so
  // drop them here before they reach the coalesce pass.
  const seenKeys = new Set<string>();
  const built: BuiltCandidate[] = [];
  let filteredOrphanCount = 0;
  for (const b of allBuilt) {
    // Bug-15 orphan filter — check BEFORE same-file dedup.
    const type = b.candidate.candidateType;
    if (
      type === 'logical_data_attributes' ||
      type === 'physical_data_attributes'
    ) {
      const pname = parentName(b.candidate.name);
      if (pname && FILTERED_PARENT_SUFFIX.test(pname)) {
        filteredOrphanCount++;
        continue;
      }
    } else if (type === 'logical_data_entity_relationships') {
      const parts = relArrowSplit(b.candidate.name);
      if (parts && (FILTERED_PARENT_SUFFIX.test(parts.src) || FILTERED_PARENT_SUFFIX.test(parts.tgt))) {
        filteredOrphanCount++;
        continue;
      }
    }

    const key = `${b.candidate.candidateType}\u0000${b.candidate.name.trim().toLowerCase().replace(/[\s_\-]+/g, ' ')}`;
    if (seenKeys.has(key)) {
      console.log(
        `[GapFill:same-file-dedup] dropping duplicate LLM candidate in ${file.filePath}: ` +
          `type=${b.candidate.candidateType} name="${b.candidate.name}"`,
      );
      continue;
    }
    seenKeys.add(key);
    built.push(b);
  }
  if (filteredOrphanCount > 0) {
    console.log(
      `[GapFill:orphan-filter] dropped ${filteredOrphanCount} LLM candidates in ${file.filePath} ` +
        `whose parent matches NON_DOMAIN_INTERFACE_SUFFIXES (Props/State/Action/Payload/...)`,
    );
  }

  return {
    file,
    skipped: false,
    built,
    failure: null,
    promptVersion,
  };
}

// ============================================================================
// Cross-file coalesce pass (Bug 4 fix — 2026-04-20)
// ============================================================================

/**
 * Carrier pairing a post-per-file-dedup LLM candidate with the filePath the
 * LLM emitted for it. The filePath is kept as a SIDECAR (not mutated onto
 * `candidate.sourceClusterIds`) so that the single-candidate case preserves
 * the pre-Bug-4 contract of `sourceClusterIds === []` for in-process callers
 * that have not yet started relying on the new traceability field.
 */
interface CoalesceInput {
  candidate: DiscoveryCandidate;
  llmFilePath: string;
}

/**
 * Collapse LLM candidates that refer to the same architectural element across
 * different files.
 *
 * Context: each file's gap-fill call runs independently. When the LLM sees the
 * same shared entity (e.g. `specialties`) referenced from several files, it
 * may emit a candidate for that entity from EACH file's call. The existing
 * per-file dedup (against pack candidates) uses a filePath-aware key and
 * cannot spot these cross-file duplicates — so they all survive and inflate
 * the candidate set with N copies of the same thing.
 *
 * This pass runs AFTER all per-file processing completes and AFTER per-file
 * dedup-against-pack. Key: `(candidateType, normalizeName(name))` —
 * intentionally without filePath so cross-file emissions collapse.
 *
 * Merge rules:
 *   - Keep the candidate with the highest `confidence` (tiebreak: first seen,
 *     preserving deterministic order based on the input array).
 *   - Merge `sourceClusterIds` — UNION across all duplicates (deduped). The
 *     LLM-emitted filePath of every collapsed entry is folded in alongside
 *     any pre-existing cluster ids on the candidate itself, so reviewers
 *     can trace back to every file that flagged the element.
 *   - Preserve all other fields from the KEPT candidate (the winner by
 *     confidence); discarded candidates contribute only their filePaths.
 *
 * Non-duplicate candidates (bucket of size 1) pass through unchanged —
 * `sourceClusterIds` stays whatever the build step set (currently `[]`),
 * preserving the pre-Bug-4 contract.
 *
 * Returns the surviving candidates plus the number of duplicates collapsed.
 * When input length <= 1, returns `{ kept, collapsedCount: 0 }` fast.
 */
function coalesceCrossFile(
  inputs: CoalesceInput[],
): { kept: DiscoveryCandidate[]; collapsedCount: number } {
  if (inputs.length <= 1) {
    return {
      kept: inputs.map((i) => i.candidate),
      collapsedCount: 0,
    };
  }

  // Group by (type, normalizeName(name)) preserving insertion order.
  const groups = new Map<string, CoalesceInput[]>();
  for (const input of inputs) {
    const key = `${input.candidate.candidateType}\u0000${normalizeName(input.candidate.name)}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(input);
    } else {
      groups.set(key, [input]);
    }
  }

  const kept: DiscoveryCandidate[] = [];
  let collapsedCount = 0;

  for (const [, bucket] of groups) {
    if (bucket.length === 1) {
      // No cross-file duplication for this key — pass through unchanged so
      // the candidate's `sourceClusterIds` keeps whatever it had before.
      kept.push(bucket[0].candidate);
      continue;
    }

    // Pick the winner: highest confidence, tiebreak first seen (bucket is
    // already in insertion order, so stable reduce keeps the earliest tie).
    let winnerIndex = 0;
    for (let i = 1; i < bucket.length; i += 1) {
      const c = bucket[i].candidate;
      const wc = typeof bucket[winnerIndex].candidate.confidence === 'number'
        ? bucket[winnerIndex].candidate.confidence
        : 0;
      const cc = typeof c.confidence === 'number' ? c.confidence : 0;
      if (cc > wc) {
        winnerIndex = i;
      }
    }
    const winner = bucket[winnerIndex].candidate;

    // Union of sourceClusterIds across all duplicates in the bucket, plus
    // the LLM-emitted filePath of every entry. Using a Set gives us the
    // dedup-aware union.
    const clusterSet = new Set<string>();
    for (const entry of bucket) {
      if (Array.isArray(entry.candidate.sourceClusterIds)) {
        for (const id of entry.candidate.sourceClusterIds) {
          if (typeof id === 'string' && id.length > 0) {
            clusterSet.add(id);
          }
        }
      }
      if (typeof entry.llmFilePath === 'string' && entry.llmFilePath.length > 0) {
        clusterSet.add(entry.llmFilePath);
      }
    }

    // Build the merged candidate from the winner plus the unioned cluster ids.
    // Shallow clone so we don't mutate objects other callers may hold refs to.
    const merged: DiscoveryCandidate = {
      ...winner,
      sourceClusterIds: Array.from(clusterSet),
    };

    collapsedCount += bucket.length - 1;
    kept.push(merged);

    const normalized = normalizeName(winner.name);
    console.log(
      `[GapFill:cross-file-dedup] collapsed ${bucket.length} candidates into 1: ` +
        `type=${winner.candidateType} name="${winner.name}" (normalized="${normalized}") ` +
        `keptConfidence=${typeof winner.confidence === 'number' ? winner.confidence.toFixed(3) : 'n/a'} ` +
        `unionSourceClusterIds=${clusterSet.size}`,
    );
  }

  return { kept, collapsedCount };
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Run the LLM gap-fill stage across every file in `input.files`.
 *
 * See module doc comment for the contract. Returns dedup-applied surviving
 * LLM candidates plus stage-level metrics for persistence.
 */
export async function runLlmGapFill(input: GapFillStepInput): Promise<GapFillStepOutput> {
  const { runId, files } = input;

  const threshold = readSkipThreshold();
  const concurrency = readConcurrency();
  const maxFailureRate = readMaxFailureRate();
  const enabledSignals = readEnabledSignals();

  // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 3): a per-run
  // content-addressed cache for the gap-fill relay. Keyed on
  // (normalized-prompt + model + temperature) -- a byte-identical prompt reuses
  // the prior response with NO LLM call. Fresh per run (cold start); a SEPARATE
  // instance from the behaviour stage's source_hash cache.
  const responseCache = new GapFillResponseCache();
  const cacheModel = readGapFillCacheModel();

  console.log(
    `[GapFill] Stage start: runId=${runId}, files=${files.length}, threshold=${threshold}, concurrency=${concurrency}, maxFailureRate=${maxFailureRate}, cacheModel=${cacheModel}, signals=[${Array.from(enabledSignals).join(',')}]`,
  );

  const perFile = await promisePool<GapFillStepFile, PerFileResult>(
    files,
    concurrency,
    (file) => processFile(file, runId, threshold, enabledSignals, input.runtimeEvidenceContext, input.existingEntities, responseCache, cacheModel),
  );

  // Aggregate dedup input: pack candidates from every non-skipped file that
  // actually produced LLM output. Dedup runs per-file so each file's LLM
  // output is compared only against that file's pack candidates (stricter +
  // cheaper than a global cross-file dedup).
  //
  // Bug 4 fix (2026-04-20): collect surviving LLM candidates into a
  // `CoalesceInput[]` so the downstream cross-file coalesce pass knows the
  // filePath the LLM emitted for each candidate — WITHOUT mutating
  // `candidate.sourceClusterIds` on the happy (non-duplicate) path.
  const coalesceInputs: CoalesceInput[] = [];
  let dedupDroppedCount = 0;
  const failures: GapFillFailure[] = [];
  let firstRealPromptVersion: PromptVersion | null = null;
  let processedFiles = 0;

  for (const result of perFile) {
    if (result.skipped) {
      continue;
    }
    processedFiles += 1;
    if (result.failure) {
      failures.push(result.failure);
      continue;
    }
    if (result.promptVersion && !firstRealPromptVersion) {
      firstRealPromptVersion = result.promptVersion;
    }
    const packForDedup = result.file.packCandidates.map(projectPackCandidateForDedup);
    // Dedup uses each LLM candidate's OWN emitted filePath so that
    // cross-file references (valid per spec) are not wrongly collapsed
    // against the file-under-analysis path.
    const llmForDedup = result.built.map((b) => ({
      type: b.candidate.candidateType,
      name: b.candidate.name,
      filePath: b.llmFilePath,
      __carrier: b.candidate,
      __llmFilePath: b.llmFilePath,
    }));
    const { kept, droppedCount } = dedupLlmCandidates(packForDedup, llmForDedup);
    dedupDroppedCount += droppedCount;
    for (const item of kept) {
      const carrier = (item as any).__carrier as DiscoveryCandidate;
      const llmFilePath = (item as any).__llmFilePath as string;
      coalesceInputs.push({ candidate: carrier, llmFilePath });
    }
  }

  // Bug 4 fix (2026-04-20): cross-file coalesce pass. Collapses LLM
  // candidates that refer to the same architectural element from different
  // files down to one (merging sourceClusterIds, keeping highest confidence).
  // This runs AFTER per-file dedup-against-pack and ONLY touches LLM
  // candidates among themselves.
  const { kept: coalescedBeforeGlobal, collapsedCount: crossFileDedupCountRaw } =
    coalesceCrossFile(coalesceInputs);

  // Bug-10 fix (2026-04-21) — final-pass belt-and-braces: in practice the
  // frontend run still surfaced duplicate LLM candidates with identical
  // `(candidateType, normalize(name))` even though `coalesceCrossFile` was
  // invoked. Root cause is still under investigation (empty-filePath
  // candidates on some LLM responses may defeat the bucket merge), so this
  // additional keep-first dedup runs unconditionally AFTER the coalesce and
  // guarantees no candidate with the same `(type, normalized name)` survives
  // twice.
  //
  // Bug-19 fix (2026-04-22): ALSO dedup LLM output against the pack's
  // output on `(type, normalized name)` IGNORING filePath. The per-file
  // `dedupLlmCandidates` compares on `(type, name, filePath)` and
  // naturally misses cases where the pack emits a kebab-case name from
  // the registration file (`articleMeta` in `.component.js`) and the
  // LLM emits the PascalCase controller name (`ArticleMeta` from the
  // same component's class declaration) — the filePath differs so they
  // don't collapse. This second pass is filePath-agnostic.
  // Bug 19 fix (2026-04-22): collect pack candidates from ALL files
  // (including SKIPPED ones). Files that get skipped from gap-fill are
  // typically those with ENOUGH pack coverage — they're exactly the
  // ones whose pack candidates we need in the dedup set. A prior version
  // bailed on `result.skipped || result.failure`, leaving those pack
  // names absent and letting the LLM re-emit them from a different file
  // (e.g. pack emits `articleMeta` from the `.component.js` registration
  // that was then skipped; LLM emits `ArticleMeta` from the controller
  // class file that was processed — without ALL pack names, dedup missed).
  const packNormalizedKeys = new Set<string>();
  for (const file of files) {
    for (const pk of file.packCandidates) {
      const n = pk.name.trim().toLowerCase().replace(/[\s_\-]+/g, ' ');
      packNormalizedKeys.add(`${pk.candidateType}\u0000${n}`);
    }
  }
  const globalSeen = new Map<string, DiscoveryCandidate>();
  let globalDroppedCount = 0;
  let packNameDedupCount = 0;
  for (const c of coalescedBeforeGlobal) {
    const normalized = c.name
      .trim()
      .toLowerCase()
      .replace(/[\s_\-]+/g, ' ');
    const key = `${c.candidateType}\u0000${normalized}`;
    // Bug-19: drop if the pack already has this `(type, name)`.
    if (packNormalizedKeys.has(key)) {
      packNameDedupCount += 1;
      console.log(
        `[GapFill:pack-name-dedup] dropping LLM candidate duplicating pack output by name: ` +
          `type=${c.candidateType} name="${c.name}" (normalized="${normalized}")`,
      );
      continue;
    }
    const existing = globalSeen.get(key);
    if (!existing) {
      globalSeen.set(key, c);
      continue;
    }
    // Keep the higher-confidence one; tie-break: prefer the one already kept.
    const existingConf = typeof existing.confidence === 'number' ? existing.confidence : 0;
    const newConf = typeof c.confidence === 'number' ? c.confidence : 0;
    if (newConf > existingConf) {
      globalSeen.set(key, c);
    }
    globalDroppedCount += 1;
    console.log(
      `[GapFill:post-coalesce-dedup] dropping duplicate LLM candidate: ` +
        `type=${c.candidateType} name="${c.name}" (normalized="${normalized}")`,
    );
  }
  const coalesced: DiscoveryCandidate[] = Array.from(globalSeen.values());
  const crossFileDedupCount = crossFileDedupCountRaw + globalDroppedCount + packNameDedupCount;

  // Stage status: per spec, failure rate is computed over ALL files — NOT
  // just processed files — so that a run where most files skipped but the
  // minority that ran all failed is still flagged. Using `files.length`
  // aligns with the spec bullet ("if failures.length / files.length >
  // GAP_FILL_MAX_FAILURE_RATE"). With zero files, we trivially complete.
  const denominator = files.length;
  const failureRate = denominator > 0 ? failures.length / denominator : 0;
  const stageStatus: 'completed' | 'failed' =
    failureRate > maxFailureRate ? 'failed' : 'completed';

  // If no file was actually processed (everyone skipped), fall back to a
  // synthetic empty promptVersion so the output shape stays stable. Four
  // 8-char hashes of the empty string are a recognizable sentinel in logs.
  const promptVersion: PromptVersion = firstRealPromptVersion ?? {
    base: 'e3b0c442',
    language: 'e3b0c442',
    framework: 'e3b0c442',
    composed: 'e3b0c442',
  };

  console.log(
    `[GapFill] Stage done: runId=${runId}, processed=${processedFiles}, skipped=${files.length - processedFiles}, llmCandidates=${coalesced.length}, dedupDropped=${dedupDroppedCount}, crossFileDedup=${crossFileDedupCount}, cacheHits=${responseCache.hitCount}, failures=${failures.length}, failureRate=${failureRate.toFixed(3)}, stageStatus=${stageStatus}`,
  );

  return {
    llmCandidates: coalesced,
    stageStatus,
    failures,
    // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): surface the
    // real per-file failure count as a scalar (== failures.length) so the
    // run-integrity computation can wire it into the run record's `filesFailed`
    // and treat a nonzero count as a degraded trigger. Advisory only.
    filesFailed: failures.length,
    dedupDroppedCount,
    crossFileDedupCount,
    promptVersion,
  };
}
