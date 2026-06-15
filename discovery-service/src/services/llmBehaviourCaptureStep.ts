/**
 * Per-method LLM Behaviour-Capture Stage (Gap C).
 *
 * Spec: 2026-05-29 Business-logic behaviour capture for discovery
 * (Java / Spring Classic first) — Task Group 2.
 *
 * A NEW sibling of the per-FILE `llmGapFillStep.ts`. Operates per-METHOD and
 * produces a tech-agnostic, confidence-scored STRUCTURED BEHAVIOUR SPEC (a
 * 7-part block) for each rule-bearing Java/Spring method, attached to the
 * EXISTING `business_logics` candidate keyed by the stable method id
 * `FQN#name(ParamTypes)` that Spec 1 already stamps onto the candidate's
 * `data.methodId`.
 *
 * It deliberately REUSES the gap-fill conventions rather than re-inventing
 * them:
 *   - the gateway LLM relay (`gatewayClient.captureBehaviour`) — NEVER a
 *     direct LLM call from discovery;
 *   - the hand-rolled `promisePool` concurrency limiter (env-tunable);
 *   - `getConfidenceForTag('llm-behaviour-capture', …)` for clamp/midpoint;
 *   - `failures[]` + a max-failure-rate gate that flips the stage to `failed`.
 *
 * Pipeline shape (per method that survives the deterministic selector):
 *   1. Slice the method body from the raw source (best-effort brace matcher).
 *   2. Slice up to N (env-tunable) DIRECT-callee bodies — 1 hop only, no
 *      unbounded fan-out.
 *   3. Compute `source_hash` over the NORMALIZED method body + the callee
 *      bodies fed to the LLM.
 *   4. CACHE: if a prior `behavior` block for this method id carries the same
 *      `source_hash`, SKIP the LLM and carry the prior block forward verbatim.
 *      (Spec 1 data-effect edge changes do NOT invalidate the block — the
 *      edges are linked live at render/consume time, not embedded here.)
 *   5. Otherwise call the gateway relay, parse the 7-part block, score its
 *      confidence, stamp `schema_version` + `source_hash`, and attach it to
 *      the candidate's `data.behavior`.
 *
 * DETERMINISTIC selector (no LLM judgement — bounds cost, reuses Spec 1):
 *   A method qualifies only if ALL hold:
 *     (i)   it is a `business_logics` candidate (caller supplies these), AND
 *     (ii)  it is endpoint-reachable via Spec 1's call graph (its method id is
 *           on a resolved endpoint→data path — `PathHop.methodId`), AND
 *     (iii) it survives a deterministic boilerplate exclusion.
 *   EXCLUDE: getters/setters/`equals`/`hashCode`/`toString`/builders,
 *     Lombok-generated methods, framework `@Override` callbacks, trivial
 *     one-liners.
 *   ALWAYS INCLUDE (overrides the boilerplate exclusion): `@Transactional`
 *     methods, custom-exception throwers, and anything on an endpoint→data
 *     path (which (ii) already guarantees, but the rule is stated for clarity
 *     and to keep the predicate self-documenting).
 *
 * Cost is bounded by the selector (small set) plus an env-tunable per-run
 * METHOD cap and a per-run TOKEN ceiling.
 */

import { createHash } from 'crypto';
import {
  gatewayClient,
  BehaviourCaptureGatewayError,
} from './gatewayClient';
import { getConfidenceForTag } from './confidence';
import type { DiscoveryCandidate } from '../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
} from './extensionPacks/languageIR';
import { hasAnnotation } from './extensionPacks/languageIR';

// ============================================================================
// Schema version + confidence tag
// ============================================================================

/**
 * Internal schema version embedded INSIDE the `behavior` JSONB block (loose
 * JSONB — no DB migration as the shape evolves; mirrors Spec 1's
 * `path_metadata_json` precedent). Bump when the 7-part shape changes in a
 * way a consumer must branch on.
 */
export const BEHAVIOUR_SCHEMA_VERSION = 'behaviour.v1';

const CONFIDENCE_TAG = 'llm-behaviour-capture';

// ============================================================================
// Env-tunable defaults
// ============================================================================

/** Direct-callee bodies fed to the LLM per method (1-hop only). */
const DEFAULT_CALLEE_CAP = 6;
/** Concurrent in-flight LLM calls. Mirrors the conservative gap-fill default. */
const DEFAULT_CONCURRENCY = 2;
/** Per-run cap on the number of methods sent to the LLM (after the selector). */
const DEFAULT_METHOD_CAP = 200;
/**
 * Per-run TOKEN ceiling (estimated). Once the cumulative estimate of prompt
 * tokens crosses this, remaining methods are SKIPPED (not failed). Estimated
 * as `ceil(chars / 4)` per prompt — the same heuristic the gateway logs.
 */
const DEFAULT_TOKEN_CEILING = 400_000;
/** Failure-rate gate (over methods that actually attempted the LLM). */
const DEFAULT_MAX_FAILURE_RATE = 0.2;

function readIntEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readRateEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function readCalleeCap(): number {
  return readIntEnv('BEHAVIOUR_CAPTURE_CALLEE_CAP', DEFAULT_CALLEE_CAP, 0);
}
function readConcurrency(): number {
  return readIntEnv('BEHAVIOUR_CAPTURE_CONCURRENCY', DEFAULT_CONCURRENCY);
}
function readMethodCap(): number {
  return readIntEnv('BEHAVIOUR_CAPTURE_MAX_METHODS', DEFAULT_METHOD_CAP, 0);
}
function readTokenCeiling(): number {
  return readIntEnv('BEHAVIOUR_CAPTURE_TOKEN_CEILING', DEFAULT_TOKEN_CEILING, 0);
}
function readMaxFailureRate(): number {
  return readRateEnv('BEHAVIOUR_CAPTURE_MAX_FAILURE_RATE', DEFAULT_MAX_FAILURE_RATE);
}

// ============================================================================
// Boilerplate-exclusion constants
// ============================================================================

const OVERRIDE_ANNOTATION = 'Override';
const TRANSACTIONAL_ANNOTATION = 'Transactional';

/**
 * Lombok markers whose presence on the CLASS means the type's accessor /
 * equals / hashCode / toString / builder methods are generated rather than
 * hand-written business logic. A method on such a class that ALSO matches a
 * boilerplate name shape is treated as Lombok-generated and excluded (unless
 * an always-include rule fires).
 */
const LOMBOK_CLASS_ANNOTATIONS = new Set([
  'Data',
  'Value',
  'Getter',
  'Setter',
  'Builder',
  'SuperBuilder',
  'RequiredArgsConstructor',
  'AllArgsConstructor',
  'NoArgsConstructor',
  'EqualsAndHashCode',
  'ToString',
]);

/** Lombok markers applied directly to a method/field accessor. */
const LOMBOK_METHOD_ANNOTATIONS = new Set(['Getter', 'Setter', 'Builder']);

const BOILERPLATE_METHOD_NAMES = new Set([
  'equals',
  'hashCode',
  'toString',
  'builder',
  'build',
  'toBuilder',
]);

const GETTER_SETTER_RE = /^(get|set|is|has)[A-Z0-9_]/;

/**
 * Custom-exception throwers ALWAYS qualify (they encode a precondition /
 * error→status mapping worth capturing). Heuristic: the method body throws a
 * `*Exception` / `*Error` that is NOT one of the ubiquitous JDK unchecked
 * types (those are too generic to be a domain rule on their own).
 */
const GENERIC_JDK_THROWABLES = new Set([
  'Exception',
  'RuntimeException',
  'Error',
  'Throwable',
  'IllegalArgumentException',
  'IllegalStateException',
  'NullPointerException',
  'UnsupportedOperationException',
]);

// ============================================================================
// Input / output types
// ============================================================================

/**
 * The 7-part structured behaviour block. Typed loosely — each section is free
 * prose (string) or a small structured array; consumers (UI / shape-spec) read
 * defensively. The block additionally carries `schema_version`, `source_hash`,
 * `method_id`, and `confidence` at the top level.
 *
 * Kept intentionally permissive (`[key: string]: unknown`) so the LLM can emit
 * richer sub-structure without the parser dropping the block.
 */
export interface BehaviourBlock {
  schema_version: string;
  method_id: string;
  source_hash: string;
  confidence: number;
  io?: unknown;
  validation?: unknown;
  transformation?: unknown;
  data_effects?: unknown;
  side_effects?: unknown;
  edge_cases?: unknown;
  provenance?: unknown;
  [key: string]: unknown;
}

/**
 * One method selected for behaviour capture. Pairs the `business_logics`
 * candidate with the resolved IR class + function and the raw source so the
 * stage can slice bodies + compute the hash without re-parsing.
 */
export interface SelectedMethod {
  /** Stable method id `FQN#name(ParamTypes)` (== candidate.data.methodId). */
  methodId: string;
  /** The business_logics candidate the block attaches to. */
  candidate: DiscoveryCandidate;
  /** The owning class IR (for callee resolution within the same class). */
  cls: ClassIR;
  /** The method IR. */
  method: FunctionIR;
  /** The raw source-file text the method lives in (for body slicing). */
  sourceCode: string;
  /** The file path (logging / provenance). */
  filePath: string;
}

/**
 * Input to the selector + stage. The caller (the V3 pipeline) supplies the IR,
 * the `business_logics` candidates, and the set of endpoint-reachable method
 * ids (from Spec 1's resolver — `PathHop.methodId`).
 */
export interface BehaviourCaptureSelectorInput {
  /** All `business_logics` candidates from the run. */
  businessLogicCandidates: DiscoveryCandidate[];
  /** Source-file IR keyed by file path (Stage 1 output). */
  irFiles: Map<string, SourceFileIR>;
  /**
   * The set of method ids that sit on a resolved endpoint→data path, taken
   * from Spec 1's `resolveEndpointDataEffects(...).resolved[*].path[*].methodId`.
   * Endpoint-reachability is checked against THIS set — the stage does NOT
   * re-derive a call graph.
   */
  endpointReachableMethodIds: Set<string>;
}

export interface BehaviourCaptureStepInput extends BehaviourCaptureSelectorInput {
  runId: string;
  /** Run tier — the caller only invokes when tier-gating admits the stage. */
  tier: 'A' | 'B' | 'C';
  /**
   * Prior `behavior` blocks keyed by method id (from the previous run's
   * candidates). Used for the `source_hash` cache-hit path. Empty on a first
   * run.
   */
  priorBlocksByMethodId?: Map<string, BehaviourBlock>;
}

/** Per-method failure record persisted on `steps_payload.v3.behaviourCapture`. */
export interface BehaviourCaptureFailure {
  methodId: string;
  error: string;
}

export interface BehaviourCaptureStepOutput {
  stageStatus: 'completed' | 'failed';
  /** Methods that were sent to the LLM and produced a parsed block. */
  processed: number;
  /** Methods skipped (cache hit OR over the method/token caps). */
  skipped: number;
  /** Methods skipped specifically because of an unchanged `source_hash`. */
  cacheHits: number;
  failures: BehaviourCaptureFailure[];
  /** Total candidates the selector admitted (before caps). */
  selectedCount: number;
  /**
   * TRUE when the per-run METHOD cap (`BEHAVIOUR_CAPTURE_MAX_METHODS` /
   * `DEFAULT_METHOD_CAP`) OR the per-run TOKEN ceiling
   * (`BEHAVIOUR_CAPTURE_TOKEN_CEILING` / `DEFAULT_TOKEN_CEILING`) caused at
   * least one selected method to be SKIPPED -- i.e. capture was truncated.
   *
   * Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): a cap-hit is
   * one of the run-level `degraded` triggers (capture was bounded, so the model
   * may be partial). Advisory only -- the cap is a deliberate cost guard and the
   * run still COMPLETES; this flag merely makes the truncation VISIBLE upstream.
   * Distinct from `skipped`, which also counts cache hits and no-body methods.
   */
  capHit: boolean;
}

// ============================================================================
// Method-body slicing (best-effort, dependency-free)
// ============================================================================

/**
 * Slice a method's source text starting at its declaration line, balancing
 * braces to find the closing `}`. `startLine` is 0-based (matches the IR's
 * `FunctionIR.line`). Returns the trimmed slice, or null when the body cannot
 * be located (e.g. abstract / interface method with no `{`). Best-effort —
 * tolerant of strings/comments containing braces only insofar as it does not
 * crash; a slightly-off slice is acceptable (it feeds an LLM + a hash, both of
 * which degrade gracefully).
 */
export function sliceMethodBody(
  sourceCode: string,
  startLine: number,
): string | null {
  const lines = sourceCode.split(/\r?\n/);
  if (startLine < 0 || startLine >= lines.length) return null;

  // Walk forward from the declaration line to the first `{`.
  let openIdx = -1;
  let openCol = -1;
  for (let i = startLine; i < lines.length && i < startLine + 50; i += 1) {
    const col = lines[i].indexOf('{');
    if (col >= 0) {
      openIdx = i;
      openCol = col;
      break;
    }
    // A `;` before any `{` means an abstract / interface method declaration.
    if (/;\s*$/.test(lines[i])) return null;
  }
  if (openIdx < 0) return null;

  let depth = 0;
  const out: string[] = [];
  for (let i = openIdx; i < lines.length; i += 1) {
    const line = lines[i];
    const from = i === openIdx ? openCol : 0;
    out.push(i === startLine ? line : line);
    for (let c = from; c < line.length; c += 1) {
      const ch = line[c];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          // Include the declaration head + everything up to and including this
          // line. Reconstruct from startLine for full signature context.
          const head = lines.slice(startLine, openIdx);
          const body = lines.slice(openIdx, i + 1);
          return [...head, ...body].join('\n').trim();
        }
      }
    }
  }
  // Unbalanced — return what we have from the declaration line, capped.
  return lines.slice(startLine, Math.min(lines.length, startLine + 200)).join('\n').trim();
}

/**
 * Normalize a body slice for hashing: strip line/block comments, collapse all
 * runs of whitespace to a single space, and trim. This makes the `source_hash`
 * insensitive to reformatting / comment-only edits while still busting on any
 * real token change.
 */
export function normalizeForHash(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ') // line comments
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute the `source_hash` over the normalized method body PLUS the
 * normalized 1-hop callee bodies actually fed to the LLM. Callee bodies are
 * sorted so ordering does not affect the hash.
 */
export function computeSourceHash(
  methodBody: string,
  calleeBodies: string[],
): string {
  const norm = normalizeForHash(methodBody);
  const calleeNorm = calleeBodies.map(normalizeForHash).sort();
  const h = createHash('sha256');
  h.update(norm);
  h.update(' ');
  for (const c of calleeNorm) {
    h.update(c);
    h.update(' ');
  }
  return h.digest('hex');
}

// ============================================================================
// Deterministic selector
// ============================================================================

interface ClassMethodIndex {
  /** All classes across the IR, keyed by FQN-less simple name (last wins). */
  bySimpleName: Map<string, { cls: ClassIR; file: SourceFileIR }>;
  /** Every method keyed by its stable method id. */
  byMethodId: Map<string, { cls: ClassIR; file: SourceFileIR; method: FunctionIR }>;
}

function buildClassMethodIndex(irFiles: Map<string, SourceFileIR>): ClassMethodIndex {
  const bySimpleName = new Map<string, { cls: ClassIR; file: SourceFileIR }>();
  const byMethodId = new Map<
    string,
    { cls: ClassIR; file: SourceFileIR; method: FunctionIR }
  >();
  for (const file of irFiles.values()) {
    for (const cls of file.classes) {
      bySimpleName.set(cls.name, { cls, file });
      for (const method of cls.methods) {
        if (method.methodId) {
          byMethodId.set(method.methodId, { cls, file, method });
        }
      }
    }
  }
  return { bySimpleName, byMethodId };
}

/** True when the class carries any Lombok class-level marker. */
function classHasLombok(cls: ClassIR): boolean {
  return cls.annotations.some((a) => LOMBOK_CLASS_ANNOTATIONS.has(a.name));
}

/** Does this method's body throw a non-generic (custom) exception/error? */
function throwsCustomException(method: FunctionIR, sourceCode: string): boolean {
  const body = sliceMethodBody(sourceCode, method.line);
  if (!body) return false;
  const re = /\bthrow\s+new\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const type = m[1];
    if (!GENERIC_JDK_THROWABLES.has(type) && /(Exception|Error)$/.test(type)) {
      return true;
    }
  }
  return false;
}

/** Trivial one-liner: a body whose single statement is short and side-effect-light. */
function isTrivialOneLiner(method: FunctionIR, sourceCode: string): boolean {
  const body = sliceMethodBody(sourceCode, method.line);
  if (!body) return false;
  // Extract between the first `{` and last `}`.
  const open = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (open < 0 || close <= open) return false;
  const inner = body.slice(open + 1, close).trim();
  const norm = normalizeForHash(inner);
  if (norm.length === 0) return true; // empty body
  // One statement (no inner `;` except a single trailing one) AND short.
  const statementCount = norm.split(';').filter((s) => s.trim().length > 0).length;
  return statementCount <= 1 && norm.length <= 80;
}

/**
 * Boilerplate exclusion — returns true if the method should be EXCLUDED, given
 * no always-include rule fired. Pure-ish: `sourceCode` is read only to gauge
 * triviality.
 */
function isBoilerplate(
  cls: ClassIR,
  method: FunctionIR,
  sourceCode: string,
): boolean {
  const name = method.name;
  if (BOILERPLATE_METHOD_NAMES.has(name)) return true;
  if (GETTER_SETTER_RE.test(name)) return true;
  // Lombok-generated accessor: the method carries a Lombok marker, OR the
  // class is a Lombok data class AND the method is accessor-shaped (already
  // caught by the getter/setter test, but the class marker covers
  // canonical-named generated methods too).
  if (method.annotations.some((a) => LOMBOK_METHOD_ANNOTATIONS.has(a.name))) {
    return true;
  }
  if (classHasLombok(cls) && (GETTER_SETTER_RE.test(name) || BOILERPLATE_METHOD_NAMES.has(name))) {
    return true;
  }
  // Framework @Override callback (e.g. lifecycle / interface impls) with no
  // domain signal of its own.
  if (hasAnnotation(method.annotations, OVERRIDE_ANNOTATION)) return true;
  // Trivial one-liners.
  if (isTrivialOneLiner(method, sourceCode)) return true;
  return false;
}

/**
 * Always-include override — returns true if the method must be captured
 * REGARDLESS of the boilerplate exclusion: `@Transactional`, a custom-exception
 * thrower, or (by construction of the caller) on an endpoint→data path.
 */
function isAlwaysInclude(
  cls: ClassIR,
  method: FunctionIR,
  sourceCode: string,
): boolean {
  if (
    hasAnnotation(method.annotations, TRANSACTIONAL_ANNOTATION) ||
    hasAnnotation(cls.annotations, TRANSACTIONAL_ANNOTATION)
  ) {
    return true;
  }
  if (throwsCustomException(method, sourceCode)) return true;
  return false;
}

/**
 * Run the DETERMINISTIC method selector.
 *
 * A `business_logics` candidate qualifies only if its `data.methodId`:
 *   (i)   is set (rule-bearing methods Spec 1 stamped), AND
 *   (ii)  is in `endpointReachableMethodIds` (Spec 1 reachability), AND
 *   (iii) survives the boilerplate exclusion — UNLESS an always-include rule
 *         (@Transactional / custom-exception thrower / on an endpoint path)
 *         overrides it.
 *
 * Returns the selected methods with their resolved IR + raw source so the
 * stage can slice bodies without re-parsing. Deterministic + pure (no I/O, no
 * LLM).
 */
export function selectBehaviourCaptureMethods(
  input: BehaviourCaptureSelectorInput,
): SelectedMethod[] {
  const { businessLogicCandidates, irFiles, endpointReachableMethodIds } = input;
  const index = buildClassMethodIndex(irFiles);
  const selected: SelectedMethod[] = [];
  const seen = new Set<string>();

  for (const candidate of businessLogicCandidates) {
    if (candidate.candidateType !== 'business_logics') continue;
    const data = (candidate.data ?? {}) as Record<string, unknown>;
    const methodId = typeof data.methodId === 'string' ? data.methodId : '';
    if (!methodId) continue; // (i) no stable id -> not a selectable rule-bearing method
    if (seen.has(methodId)) continue;

    // (ii) endpoint-reachability via Spec 1's call graph.
    if (!endpointReachableMethodIds.has(methodId)) continue;

    const resolved = index.byMethodId.get(methodId);
    if (!resolved) continue; // candidate without matching IR (defensive)
    const { cls, file, method } = resolved;
    const sourceCode = file.rawContent ?? '';
    if (!sourceCode) continue;

    // (iii) boilerplate exclusion, with always-include override. Endpoint
    // reachability ALSO counts as an always-include (the candidate is on a
    // data path by construction), so a reachable getter-shaped repository
    // accessor is still excluded ONLY if it's pure boilerplate AND not an
    // always-include — but reachability here means it IS on a path, so we
    // keep it. We therefore short-circuit: reachable => always include,
    // UNLESS it is unambiguous accessor/equals/hashCode/toString boilerplate
    // with no domain signal, in which case we still drop the noise.
    const alwaysInclude =
      isAlwaysInclude(cls, method, sourceCode);
    if (!alwaysInclude && isBoilerplate(cls, method, sourceCode)) {
      continue;
    }

    seen.add(methodId);
    selected.push({ methodId, candidate, cls, method, sourceCode, filePath: file.filePath });
  }

  return selected;
}

// ============================================================================
// 1-hop direct-callee body collection
// ============================================================================

/**
 * Collect up to `cap` DIRECT-callee bodies for a method (1 hop only). A callee
 * is resolved by:
 *   - same-class: a method on the owning class whose name matches the call, OR
 *   - cross-class: when the receiver names an autowired field whose type is a
 *     class in the IR, a method on that class matching the call name.
 * Returns the sliced bodies (deduped by source). Best-effort, bounded, never
 * throws.
 */
function collectCalleeBodies(
  selected: SelectedMethod,
  index: ClassMethodIndex,
  cap: number,
): string[] {
  if (cap <= 0) return [];
  const bodies: string[] = [];
  const seen = new Set<string>();
  const calls = selected.method.calls ?? [];

  // Index the owning class's fields by name so we can resolve a receiver to a
  // collaborator class.
  const fieldTypeByName = new Map<string, string>();
  for (const f of selected.cls.fields) {
    const t = (f.type || '').trim();
    const lt = t.indexOf('<');
    const base = lt > 0 ? t.slice(0, lt) : t;
    const dot = base.lastIndexOf('.');
    fieldTypeByName.set(f.name, dot >= 0 ? base.slice(dot + 1) : base);
  }

  for (const call of calls) {
    if (bodies.length >= cap) break;
    const calleeName = call.methodName ?? '';
    if (!calleeName) continue;

    // Resolve the target class: same-class (self receiver / no receiver) or
    // an autowired collaborator field's type.
    let targetCls: ClassIR | null = null;
    let targetFile: SourceFileIR | null = null;
    const receiver = call.receiver;
    if (receiver == null || receiver === 'this') {
      targetCls = selected.cls;
      // Source for same-class callees is the same file.
      targetFile = null;
    } else {
      const fieldType = fieldTypeByName.get(receiver);
      if (fieldType) {
        const hit = index.bySimpleName.get(fieldType);
        if (hit) {
          targetCls = hit.cls;
          targetFile = hit.file;
        }
      }
    }
    if (!targetCls) continue;

    const calleeMethod = targetCls.methods.find((m) => m.name === calleeName);
    if (!calleeMethod) continue;
    // Don't recurse into the method itself.
    if (calleeMethod.methodId && calleeMethod.methodId === selected.methodId) continue;

    const src =
      targetFile?.rawContent ?? selected.sourceCode; // same-class -> same file
    const body = sliceMethodBody(src, calleeMethod.line);
    if (!body) continue;
    const key = `${targetCls.name}#${calleeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bodies.push(body);
  }

  return bodies;
}

// ============================================================================
// Prompt composition
// ============================================================================

/**
 * Compose the behaviour-capture prompt. Self-contained (the gateway relay is
 * stateless and injects no system prompt) — it states the role, the 7-part
 * output contract, the exact JSON shape, and embeds the method body + callee
 * bodies. The LLM is asked for a STRICT JSON object (no prose around it).
 */
export function composeBehaviourPrompt(
  selected: SelectedMethod,
  methodBody: string,
  calleeBodies: string[],
): string {
  const calleeSection =
    calleeBodies.length > 0
      ? calleeBodies
          .map((b, i) => `// --- direct callee #${i + 1} ---\n${b}`)
          .join('\n\n')
      : '(no direct-callee bodies resolved)';

  return [
    'You are a migration analyst. Capture a TECH-AGNOSTIC, structured behaviour',
    'specification for ONE Java method, rich enough that another engineer (or an',
    'LLM) could faithfully RE-IMPLEMENT equivalent behaviour in a different stack',
    'WITHOUT seeing this source. Describe WHAT the method does, not Java specifics.',
    '',
    `Method id: ${selected.methodId}`,
    `Class: ${selected.cls.name}`,
    '',
    'Return STRICT JSON only (no markdown, no prose outside the object) with EXACTLY',
    'these 7 parts as keys:',
    '  "io"            : { "inputs": [{ "name", "type", "meaning" }], "output": { "type", "meaning" } }',
    '  "validation"    : [{ "check", "on_failure" }]  // precondition + error/exception -> HTTP status / SOAP fault',
    '  "transformation": string | object   // formulas, field mappings, aggregations, branches, sort/order, defaulting (pseudo-logic + prose)',
    '  "data_effects"  : string | object   // entities/tables read/written + access mode (reuse what you can infer; do NOT invent schema)',
    '  "side_effects"  : string | object   // external calls, events, audit, idempotency',
    '  "edge_cases"    : [string]          // null/empty/boundary per branch',
    '  "provenance"    : { "method_id": string, "notes"?: string }',
    'Also include "confidence": number in [0,1] reflecting how sure you are.',
    'Use null / empty arrays for parts that genuinely do not apply. Do not fabricate.',
    '',
    '=== METHOD UNDER ANALYSIS ===',
    methodBody,
    '',
    '=== DIRECT CALLEES (1 hop, context only) ===',
    calleeSection,
  ].join('\n');
}

// ============================================================================
// Parse + validate the 7-part block
// ============================================================================

/**
 * Parse the LLM response into a `BehaviourBlock`. Tolerant per the gap-fill
 * `parseAndValidate` precedent: strips a ```json fence if present, parses, and
 * requires a JSON OBJECT (not array/scalar). Throws on unparseable / wrong-shape
 * content so the caller records a failure and the run continues.
 *
 * The 7 parts are OPTIONAL on the parsed object (the block is loose JSONB); we
 * only require that the response is a usable object. `schema_version`,
 * `method_id`, `source_hash`, and `confidence` are stamped by the stage AFTER
 * parsing, so a model that omits them does not fail the parse.
 */
export function parseBehaviourResponse(content: string): Record<string, unknown> {
  let text = (content ?? '').trim();
  if (text.length === 0) {
    throw new Error('Behaviour-capture LLM response was empty');
  }
  // Strip a leading/trailing markdown fence if the model added one.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Behaviour-capture response was not valid JSON: ${msg}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Behaviour-capture response JSON was not an object');
  }
  return parsed as Record<string, unknown>;
}

// ============================================================================
// Concurrency pool (hand-rolled, mirrors llmGapFillStep)
// ============================================================================

async function promisePool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
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
// Per-method processing
// ============================================================================

interface PreparedMethod {
  selected: SelectedMethod;
  methodBody: string;
  calleeBodies: string[];
  sourceHash: string;
  /** Estimated prompt tokens (chars/4) — drives the per-run token ceiling. */
  estTokens: number;
}

type PerMethodResult =
  | { kind: 'processed'; methodId: string; block: BehaviourBlock; candidate: DiscoveryCandidate }
  | { kind: 'cache-hit'; methodId: string; block: BehaviourBlock; candidate: DiscoveryCandidate }
  | { kind: 'failure'; methodId: string; error: string };

async function processMethod(
  prepared: PreparedMethod,
  runId: string,
): Promise<PerMethodResult> {
  const { selected, methodBody, calleeBodies, sourceHash } = prepared;
  const prompt = composeBehaviourPrompt(selected, methodBody, calleeBodies);

  let content: string;
  try {
    const response = await gatewayClient.captureBehaviour(prompt, selected.methodId, runId);
    content = response?.content ?? '';
  } catch (err) {
    const message =
      err instanceof BehaviourCaptureGatewayError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { kind: 'failure', methodId: selected.methodId, error: message };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseBehaviourResponse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failure', methodId: selected.methodId, error: message };
  }

  // Score confidence via the shared tag logic (clamp model value into the tag
  // range; midpoint fallback when absent / invalid).
  const rawConf =
    typeof parsed.confidence === 'number' ? (parsed.confidence as number) : undefined;
  const confidence = getConfidenceForTag(CONFIDENCE_TAG, rawConf);

  const block: BehaviourBlock = {
    ...parsed,
    schema_version: BEHAVIOUR_SCHEMA_VERSION,
    method_id: selected.methodId,
    source_hash: sourceHash,
    confidence,
  };

  return { kind: 'processed', methodId: selected.methodId, block, candidate: selected.candidate };
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Run the per-method behaviour-capture stage.
 *
 * Mutates the selected `business_logics` candidates IN PLACE, attaching the
 * 7-part block to `candidate.data.behavior` (keyed implicitly by the candidate
 * the block belongs to; the block also carries `method_id`). On a cache hit the
 * prior block is carried forward verbatim (its `source_hash` unchanged).
 *
 * The caller is responsible for tier-gating (only invoking when the run tier
 * admits the stage) and for persisting the returned metrics.
 */
export async function runBehaviourCapture(
  input: BehaviourCaptureStepInput,
): Promise<BehaviourCaptureStepOutput> {
  const { runId, irFiles } = input;
  const priorBlocks = input.priorBlocksByMethodId ?? new Map<string, BehaviourBlock>();

  const calleeCap = readCalleeCap();
  const concurrency = readConcurrency();
  const methodCap = readMethodCap();
  const tokenCeiling = readTokenCeiling();
  const maxFailureRate = readMaxFailureRate();

  const selected = selectBehaviourCaptureMethods(input);
  const index = buildClassMethodIndex(irFiles);

  console.log(
    `[BehaviourCapture] Stage start: runId=${runId}, tier=${input.tier}, ` +
      `selected=${selected.length}, methodCap=${methodCap}, tokenCeiling=${tokenCeiling}, ` +
      `calleeCap=${calleeCap}, concurrency=${concurrency}, maxFailureRate=${maxFailureRate}`,
  );

  let cacheHits = 0;
  let skipped = 0;
  // Spec 2026-05-30 Oracle Integrity & Determinism (Task Group 2): set when the
  // method cap OR token ceiling truncates capture (a run-level degraded trigger).
  let capHit = false;
  const failures: BehaviourCaptureFailure[] = [];

  // 1) Prepare each method: slice body + callees, compute hash, resolve cache.
  // Cache hits are applied immediately (no LLM); cache misses that fit under
  // the caps go into the LLM batch.
  const toCall: PreparedMethod[] = [];
  let cumulativeTokens = 0;

  for (const sel of selected) {
    const methodBody = sliceMethodBody(sel.sourceCode, sel.method.line);
    if (!methodBody) {
      // No followable body (abstract / interface contract method): skip
      // silently — there is nothing to capture.
      skipped += 1;
      continue;
    }
    const calleeBodies = collectCalleeBodies(sel, index, calleeCap);
    const sourceHash = computeSourceHash(methodBody, calleeBodies);

    // CACHE: unchanged source_hash -> carry the prior block forward verbatim.
    const prior = priorBlocks.get(sel.methodId);
    if (prior && typeof prior.source_hash === 'string' && prior.source_hash === sourceHash) {
      attachBlock(sel.candidate, prior);
      cacheHits += 1;
      skipped += 1;
      continue;
    }

    // Per-run METHOD cap: once we've queued methodCap LLM calls, skip the rest.
    if (methodCap > 0 && toCall.length >= methodCap) {
      skipped += 1;
      capHit = true;
      continue;
    }

    const prompt = composeBehaviourPrompt(sel, methodBody, calleeBodies);
    const estTokens = Math.ceil(prompt.length / 4);

    // Per-run TOKEN ceiling: skip methods that would push us over the budget.
    if (tokenCeiling > 0 && cumulativeTokens + estTokens > tokenCeiling) {
      skipped += 1;
      capHit = true;
      continue;
    }
    cumulativeTokens += estTokens;

    toCall.push({ selected: sel, methodBody, calleeBodies, sourceHash, estTokens });
  }

  // 2) Fire the LLM calls under the concurrency pool.
  const results = await promisePool<PreparedMethod, PerMethodResult>(
    toCall,
    concurrency,
    (prepared) => processMethod(prepared, runId),
  );

  let processed = 0;
  for (const r of results) {
    if (r.kind === 'failure') {
      failures.push({ methodId: r.methodId, error: r.error });
      continue;
    }
    // processed (cache hits were applied earlier and never reach here).
    attachBlock(r.candidate, r.block);
    processed += 1;
  }

  // 3) Failure-rate gate over methods that ATTEMPTED the LLM (mirror gap-fill).
  const attempted = toCall.length;
  const failureRate = attempted > 0 ? failures.length / attempted : 0;
  const stageStatus: 'completed' | 'failed' =
    failureRate > maxFailureRate ? 'failed' : 'completed';

  console.log(
    `[BehaviourCapture] Stage done: runId=${runId}, selected=${selected.length}, ` +
      `processed=${processed}, cacheHits=${cacheHits}, skipped=${skipped}, ` +
      `failures=${failures.length}, failureRate=${failureRate.toFixed(3)}, status=${stageStatus}`,
  );

  return {
    stageStatus,
    processed,
    skipped,
    cacheHits,
    failures,
    selectedCount: selected.length,
    capHit,
  };
}

/**
 * Attach the behaviour block to a candidate's `data.behavior`. The block rides
 * on `data` so it auto-persists into `discovery_candidates.data` via
 * `bulkSaveCandidates` (and on save-approved maps to AMS `business_logics.behavior`).
 */
function attachBlock(candidate: DiscoveryCandidate, block: BehaviourBlock): void {
  const data = (candidate.data ?? {}) as Record<string, unknown>;
  data.behavior = block;
  candidate.data = data;
}
