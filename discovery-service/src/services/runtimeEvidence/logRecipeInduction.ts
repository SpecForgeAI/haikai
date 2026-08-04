/**
 * LLM Recipe Induction + Held-Out Validation + Bounded Retries (Spec
 * 2026-06-20-runtime-log-evidence-format-agnostic-extraction, Task Group 5).
 *
 * STEP 4 of the quality-first runtime-log pipeline. When the cheap
 * deterministic paths cannot read a log (the known-format fast path came back
 * THIN, Task Group 3), this module asks the LLM -- ONCE, on a small set of
 * REDACTED sample blocks produced by the pre-scan sampler (Task Group 2) -- to
 * RECOGNISE the log's format and return a STRUCTURED RECIPE: a record delimiter
 * plus field rules for method / path / headers / body / response. The recipe is
 * then VALIDATED deterministically against a HELD-OUT block the LLM never saw,
 * and accepted only if it extracts method+path from >=60% of the request-like
 * lines in that block (request-like lines counted via the Task Group 1
 * `detectRequestLikeLine` primitive -- the single source of truth).
 *
 * Critical invariants (all test-pinned):
 *   - The LLM ONLY ever sees the small redacted sample blocks. The whole file
 *     is applied deterministically by the recipe-aware extractor (Task Group 6).
 *   - Bounded cost: induction + up to 2 re-samples = HARD cap of 3 LLM calls
 *     per file. Once exhausted (or on a "no pattern" response), a
 *     deterministic-fallback signal is returned so the orchestrator drops to the
 *     broadened Task Group 1 matcher.
 *   - ONE recipe is induced PER FILE -- no cross-file format assumption.
 *   - The recipe is keyed by a deterministic FORMAT-FINGERPRINT (a hash of the
 *     normalized candidate-line shape) so an identical-format re-run reuses a
 *     persisted recipe WITHOUT another LLM call, with a per-source-file fallback
 *     key. This module owns the recipe object + fingerprint + a reuse-lookup
 *     helper and unit-tests them against an IN-MEMORY `steps_payload` object; the
 *     actual `steps_payload` write is wired by the orchestrator (Task Group 7).
 *
 * The relay itself flows through `gatewayClient.induceLogRecipe` ->
 * `POST /api/v1/discovery/v3/log-recipe`; the model is selected gateway-side
 * (latest Claude per gateway config). NO Anthropic SDK is added here.
 */

import * as crypto from 'crypto';

import { detectRequestLikeLine } from './runDiscoveryRuntimeEvidence';
import type { SampleBlock } from './logPreScanSampler';

/**
 * Hard cap on LLM calls per file: the initial induction plus up to 2
 * re-samples. Enforced by {@link induceAndValidateRecipe}; the retry-budget
 * test asserts the mock relay is never called more than this.
 */
export const MAX_LLM_CALLS_PER_FILE = 3;

/**
 * Held-out acceptance threshold. A recipe is accepted only when it extracts
 * method+path from at least this fraction of the request-like lines in a block
 * the LLM did NOT see.
 */
export const HELD_OUT_ACCEPT_FRACTION = 0.6;

/**
 * Field-rule kinds the LLM may return for a single field. Kept deliberately
 * small and deterministic so the Task Group 6 extractor can apply them without
 * any further model help:
 *   - `regex`     : a JS-compatible regex whose first capture group is the value.
 *   - `json_path` : a dotted key path into a JSON object parsed from the record.
 *   - `line_regex`: like `regex` but matched per-line within a multi-line record
 *                   (e.g. a header line `<id> > name: value`).
 */
export type RecipeFieldRuleKind = 'regex' | 'json_path' | 'line_regex';

/** A single field-extraction rule within a recipe. */
export interface RecipeFieldRule {
  /** Which extraction strategy the Task Group 6 engine applies. */
  kind: RecipeFieldRuleKind;
  /**
   * The rule payload: a regex source string (for `regex` / `line_regex`) or a
   * dotted JSON key path (for `json_path`). Never executed as code -- compiled
   * with the `RegExp` constructor only.
   */
  pattern: string;
  /**
   * Optional regex flags for `regex` / `line_regex` rules (e.g. `'i'`). The
   * global flag is applied by the engine where it needs repeated matches;
   * callers should not include `g` here.
   */
  flags?: string;
  /**
   * For header rules: a name->value line shape may capture BOTH the header name
   * (group 1) and value (group 2). When `captureKeyValue` is true the engine
   * treats group 1 as the key and group 2 as the value, accumulating a map.
   */
  captureKeyValue?: boolean;
}

/**
 * The per-field rule set. `method` + `path` are the load-bearing fields (the
 * gate measures them); the rest are pulled opportunistically by Task Group 6
 * ONLY when the log actually contains them (never invented).
 */
export interface RecipeFieldRules {
  method?: RecipeFieldRule;
  path?: RecipeFieldRule;
  requestHeaders?: RecipeFieldRule;
  requestBody?: RecipeFieldRule;
  responseStatus?: RecipeFieldRule;
  responseBody?: RecipeFieldRule;
}

/**
 * How the Task Group 6 engine splits the full file into RECORDS before applying
 * the field rules. A multi-line bespoke trace (the SampleSvc case) groups several
 * physical lines into one logical record.
 *
 *   - `single_line`  : one record per physical line (CLF-ish / JSON-lines-ish).
 *   - `blank_line`   : records separated by a blank (or whitespace-only) line.
 *   - `start_regex`  : a new record BEGINS whenever a line matches `pattern`
 *                      (e.g. the SampleSvc `^<id> > METHOD ` request-start line);
 *                      every following line accumulates until the next start.
 */
export interface RecipeRecordDelimiter {
  kind: 'single_line' | 'blank_line' | 'start_regex';
  /** Required for `start_regex`: the JS regex source identifying a record start. */
  pattern?: string;
  /** Optional flags for the `start_regex` pattern. */
  flags?: string;
}

/**
 * A structured, deterministic extraction recipe inferred by the LLM and
 * validated against held-out data. Persisted (shape-only here) under
 * `steps_payload.v3.runtimeEvidence.recipe` keyed by {@link LogRecipe.fingerprint}.
 */
export interface LogRecipe {
  /** How the full file is split into logical records. */
  recordDelimiter: RecipeRecordDelimiter;
  /** Per-field extraction rules (method/path load-bearing; rest opportunistic). */
  fields: RecipeFieldRules;
  /** Deterministic format-fingerprint used as the reuse key. */
  fingerprint: string;
  /** Per-source-file fallback key (used when no fingerprint match exists). */
  sourceFileKey: string;
  /** Held-out validation yield (0..1) at acceptance time, for auditability. */
  validationYield: number;
  /** Number of LLM calls spent inducing this recipe (1..MAX_LLM_CALLS_PER_FILE). */
  llmCallsUsed: number;
  /** Free-text origin note ('llm_induction' | 'reused' | ...). */
  origin: string;
}

/**
 * The reason an induction attempt produced no usable recipe. Surfaced to the
 * orchestrator so it can drop to the Task Group 1 deterministic fallback and,
 * later, record the Task Group 8 diagnostic.
 */
export type RecipeInductionFailureReason =
  | 'no_pattern' // the LLM explicitly reported no recognisable pattern
  | 'validation_failed_exhausted' // every attempt fell below the held-out threshold
  | 'no_samples' // the sampler produced nothing to induce from
  | 'malformed_recipe'; // the LLM content could not be parsed into a recipe

/** Outcome of {@link induceAndValidateRecipe}. */
export type RecipeInductionResult =
  | {
      status: 'accepted';
      recipe: LogRecipe;
      /** Total LLM calls spent (<= MAX_LLM_CALLS_PER_FILE). */
      llmCallsUsed: number;
    }
  | {
      status: 'fallback';
      reason: RecipeInductionFailureReason;
      /** Total LLM calls spent (<= MAX_LLM_CALLS_PER_FILE). */
      llmCallsUsed: number;
    };

/**
 * The relay surface this module depends on. A structural subset of
 * `gatewayClient` so tests can pass a tiny mock without an HTTP stack. Mirrors
 * the `induceLogRecipe` sibling added to `gatewayClient.ts`.
 */
export interface LogRecipeRelay {
  induceLogRecipe(
    payload: { prompt: string; filePath?: string },
    runId: string,
  ): Promise<{ content: string; usage?: unknown }>;
}

/**
 * The shape of `steps_payload.v3.runtimeEvidence` this module reads/writes for
 * recipe reuse. Declared loosely (index signature) so it composes with the
 * orchestrator's larger payload without a type fight.
 */
export interface RuntimeEvidenceStepsPayloadSlice {
  recipe?: LogRecipe | Record<string, LogRecipe>;
  [key: string]: unknown;
}

// ============================================================================
// Format fingerprint
// ============================================================================

/**
 * Normalize a single candidate line to its structural SHAPE so that two lines
 * of the same format (differing only in ids / timestamps / values) collapse to
 * the same fingerprint token. Digits -> `#`, quoted strings -> `"…"`, runs of
 * whitespace -> single space. This is the per-line basis of the format
 * fingerprint hash.
 */
function normalizeLineShape(line: string): string {
  return line
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute a deterministic format-fingerprint for a file from a representative
 * set of lines (typically the assembled sample). The fingerprint is the SHA-256
 * of the sorted set of distinct request-like line SHAPES; if no request-like
 * lines exist, it falls back to the sorted set of all distinct line shapes
 * (bounded). Identical-format inputs hash identically; different formats do not.
 *
 * Exported so the orchestrator (Task Group 7) and tests can derive the same key
 * the recipe is stored under.
 */
export function computeFormatFingerprint(lines: string[]): string {
  const hitShapes = new Set<string>();
  for (const line of lines) {
    if (detectRequestLikeLine(line)) {
      hitShapes.add(normalizeLineShape(line));
    }
  }
  let basis: string[];
  if (hitShapes.size > 0) {
    basis = Array.from(hitShapes).sort();
  } else {
    const allShapes = new Set<string>();
    for (const line of lines) {
      const shape = normalizeLineShape(line);
      if (shape) allShapes.add(shape);
      if (allShapes.size >= 64) break;
    }
    basis = Array.from(allShapes).sort();
  }
  const digest = crypto.createHash('sha256').update(basis.join('\n')).digest('hex');
  return `fmt_${digest.slice(0, 32)}`;
}

/**
 * Derive the fingerprint directly from a {@link SampleBlock} set (the common
 * caller shape). Splits each block back into lines and delegates to
 * {@link computeFormatFingerprint}.
 */
export function fingerprintFromBlocks(blocks: SampleBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    for (const line of block.text.split('\n')) lines.push(line);
  }
  return computeFormatFingerprint(lines);
}

// ============================================================================
// Recipe parsing (LLM content -> LogRecipe shell)
// ============================================================================

/** The raw recipe shape the LLM is asked to emit (before we attach keys). */
interface RawRecipePayload {
  noPattern?: boolean;
  recordDelimiter?: RecipeRecordDelimiter;
  fields?: RecipeFieldRules;
}

/**
 * Extract a JSON object from raw LLM content, tolerating prose / code fences
 * around it. Returns the parsed object, the literal `"no pattern"` sentinel, or
 * null when nothing parseable is present.
 */
function parseRecipeContent(content: string): RawRecipePayload | 'no_pattern' | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (/^no[\s_-]*pattern$/i.test(trimmed)) return 'no_pattern';

  // Pull the first balanced-looking JSON object out of the content.
  const fenced = trimmed.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonText = fenced.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.noPattern === true || obj.no_pattern === true) return 'no_pattern';
  return {
    recordDelimiter: obj.recordDelimiter as RecipeRecordDelimiter | undefined,
    fields: obj.fields as RecipeFieldRules | undefined,
  };
}

/**
 * Validate the structural minimum of a parsed recipe: a usable record delimiter
 * AND method + path field rules (the two fields the held-out gate measures).
 * Returns a normalized {@link LogRecipe} shell (keys/yield attached by the
 * caller) or null when the minimum is not met.
 */
function buildRecipeShell(raw: RawRecipePayload): Omit<
  LogRecipe,
  'fingerprint' | 'sourceFileKey' | 'validationYield' | 'llmCallsUsed' | 'origin'
> | null {
  const delim = raw.recordDelimiter;
  if (!delim || typeof delim !== 'object') return null;
  if (
    delim.kind !== 'single_line' &&
    delim.kind !== 'blank_line' &&
    delim.kind !== 'start_regex'
  ) {
    return null;
  }
  if (delim.kind === 'start_regex' && (!delim.pattern || typeof delim.pattern !== 'string')) {
    return null;
  }
  const fields = raw.fields;
  if (!fields || typeof fields !== 'object') return null;
  if (!isUsableRule(fields.method) || !isUsableRule(fields.path)) return null;

  return {
    recordDelimiter: delim,
    fields: {
      method: fields.method,
      path: fields.path,
      requestHeaders: isUsableRule(fields.requestHeaders) ? fields.requestHeaders : undefined,
      requestBody: isUsableRule(fields.requestBody) ? fields.requestBody : undefined,
      responseStatus: isUsableRule(fields.responseStatus) ? fields.responseStatus : undefined,
      responseBody: isUsableRule(fields.responseBody) ? fields.responseBody : undefined,
    },
  };
}

/** True when a field rule is structurally usable (kind + non-empty pattern). */
function isUsableRule(rule: RecipeFieldRule | undefined): rule is RecipeFieldRule {
  if (!rule || typeof rule !== 'object') return false;
  if (rule.kind !== 'regex' && rule.kind !== 'json_path' && rule.kind !== 'line_regex') {
    return false;
  }
  return typeof rule.pattern === 'string' && rule.pattern.length > 0;
}

// ============================================================================
// Held-out validation
// ============================================================================

/**
 * Apply a single field rule to a record string, returning the extracted value
 * (string) or undefined. `json_path` parses the record as JSON. Regexes are
 * compiled with the `RegExp` constructor (NEVER `eval`); a malformed pattern
 * yields undefined rather than throwing.
 */
function applyRuleToRecord(rule: RecipeFieldRule, record: string): string | undefined {
  try {
    if (rule.kind === 'json_path') {
      const obj = JSON.parse(record);
      const value = readJsonPath(obj, rule.pattern);
      return value === undefined || value === null ? undefined : String(value);
    }
    const re = new RegExp(rule.pattern, rule.flags ? rule.flags.replace(/g/g, '') : undefined);
    if (rule.kind === 'line_regex') {
      for (const line of record.split('\n')) {
        const m = re.exec(line);
        if (m && (m[1] ?? m[0])) return (m[1] ?? m[0]).trim();
      }
      return undefined;
    }
    const m = re.exec(record);
    if (!m) return undefined;
    return (m[1] ?? m[0]).trim();
  } catch {
    return undefined;
  }
}

/** Read a dotted key path from a parsed JSON value. */
function readJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Split a block of text into logical records per the recipe's record delimiter.
 * This mirrors the Task Group 6 record assembly closely enough to validate
 * method+path yield WITHOUT importing the full extractor (kept dependency-light;
 * Task Group 6 owns the streaming production engine).
 */
function splitIntoRecords(text: string, delim: RecipeRecordDelimiter): string[] {
  const lines = text.split('\n');
  if (delim.kind === 'single_line') {
    return lines.filter((l) => l.trim().length > 0);
  }
  if (delim.kind === 'blank_line') {
    const records: string[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      if (line.trim().length === 0) {
        if (buf.length > 0) records.push(buf.join('\n'));
        buf = [];
      } else {
        buf.push(line);
      }
    }
    if (buf.length > 0) records.push(buf.join('\n'));
    return records;
  }
  // start_regex
  let startRe: RegExp | null = null;
  try {
    startRe = new RegExp(delim.pattern as string, delim.flags ? delim.flags.replace(/g/g, '') : undefined);
  } catch {
    startRe = null;
  }
  if (!startRe) return lines.filter((l) => l.trim().length > 0);
  const records: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (startRe.test(line)) {
      if (buf.length > 0) records.push(buf.join('\n'));
      buf = [line];
    } else if (buf.length > 0) {
      buf.push(line);
    }
  }
  if (buf.length > 0) records.push(buf.join('\n'));
  return records;
}

/**
 * Validate a recipe against a HELD-OUT block the LLM did NOT see. Counts the
 * request-like lines in the block (via the Task Group 1 detector -- the shared
 * source of truth) and the records from which the recipe extracts BOTH a method
 * and a `/path`. Returns the yield (extracted / request-like). A block with no
 * request-like lines yields 0 (cannot confirm the recipe -> treated as weak).
 *
 * Exported for direct unit testing of the acceptance threshold.
 */
export function validateRecipeAgainstBlock(
  recipe: Pick<LogRecipe, 'recordDelimiter' | 'fields'>,
  heldOutBlockText: string,
): number {
  const requestLikeCount = heldOutBlockText
    .split('\n')
    .reduce((n, line) => (detectRequestLikeLine(line) ? n + 1 : n), 0);
  if (requestLikeCount === 0) return 0;

  const records = splitIntoRecords(heldOutBlockText, recipe.recordDelimiter);
  let extracted = 0;
  for (const record of records) {
    const method = recipe.fields.method ? applyRuleToRecord(recipe.fields.method, record) : undefined;
    const pathRaw = recipe.fields.path ? applyRuleToRecord(recipe.fields.path, record) : undefined;
    if (method && pathRaw && pathRaw.includes('/')) {
      extracted += 1;
    }
  }
  // Yield is bounded by the request-like line count (the denominator the spec
  // pins): a recipe that extracts from MORE records than request-like lines
  // (multi-match) still caps at 1.0.
  return Math.min(1, extracted / requestLikeCount);
}

// ============================================================================
// Prompt composition
// ============================================================================

/**
 * Compose the induction prompt from a set of already-redacted sample blocks.
 * The blocks are joined with labelled separators; the LLM is asked to emit a
 * STRICT JSON recipe or the literal `no pattern`. Exported so the orchestrator
 * and tests can assert prompt content (e.g. the redaction invariant -- only
 * `block.text`, which the sampler already redacted, is ever embedded).
 */
export function composeRecipePrompt(blocks: SampleBlock[]): string {
  const sampleSection = blocks
    .map((b, i) => `--- SAMPLE BLOCK ${i + 1} (lines ${b.startLineIndex}-${b.endLineIndex}) ---\n${b.text}`)
    .join('\n\n');
  return [
    'You are analysing redacted samples from an application log of UNKNOWN format.',
    'Infer a DETERMINISTIC extraction recipe that downstream code will apply to the',
    'WHOLE file. Identify how records are delimited and how to extract, per record:',
    'HTTP method, request path, request headers, request body, response status, and',
    'response body. Only describe fields the log ACTUALLY contains; never invent a',
    'field. If there is no recognisable HTTP-request pattern, reply exactly: no pattern.',
    '',
    'Respond with STRICT JSON only, matching this TypeScript shape:',
    '{ "recordDelimiter": { "kind": "single_line"|"blank_line"|"start_regex", "pattern"?: string, "flags"?: string },',
    '  "fields": { "method"?: Rule, "path"?: Rule, "requestHeaders"?: Rule, "requestBody"?: Rule,',
    '              "responseStatus"?: Rule, "responseBody"?: Rule } }',
    'where Rule = { "kind": "regex"|"json_path"|"line_regex", "pattern": string, "flags"?: string, "captureKeyValue"?: boolean }.',
    'Regex rules MUST put the captured value in capture group 1.',
    '',
    'SAMPLES:',
    sampleSection,
  ].join('\n');
}

// ============================================================================
// Induction orchestration
// ============================================================================

/** Inputs to {@link induceAndValidateRecipe}. */
export interface InduceRecipeArgs {
  /** All sample blocks from the pre-scan sampler (Task Group 2). */
  blocks: SampleBlock[];
  /** The relay (gatewayClient.induceLogRecipe or a mock). */
  relay: LogRecipeRelay;
  /** Discovery run id (logging / correlation). */
  runId: string;
  /** Source log file path (correlation; also the per-file fallback key basis). */
  sourceFilePath: string;
}

/**
 * Partition the blocks into a candidate set (shown to the LLM) and a held-out
 * block (used ONLY to validate). The held-out block is rotated by attempt so
 * each retry validates against -- and induces from -- a DIFFERENT slice of the
 * sample, exactly as the spec's "re-sample different/more blocks" requires.
 *
 * Strategy per 0-based attempt `n`:
 *   - held-out index = the n-th block from the END (so attempt 0 holds out the
 *     last block, attempt 1 the second-to-last, ...), guaranteeing the held-out
 *     block was NOT in the candidate set.
 *   - candidate set  = all OTHER blocks, capped to keep the prompt bounded.
 */
function partitionBlocks(
  blocks: SampleBlock[],
  attempt: number,
): { candidates: SampleBlock[]; heldOut: SampleBlock | null } {
  if (blocks.length === 0) return { candidates: [], heldOut: null };
  if (blocks.length === 1) {
    // Cannot truly hold out with one block; validate against the same block
    // (degenerate but bounded -- better than skipping validation entirely).
    return { candidates: blocks, heldOut: blocks[0] };
  }
  const heldOutIdx = Math.max(0, blocks.length - 1 - (attempt % blocks.length));
  const heldOut = blocks[heldOutIdx];
  const candidates = blocks.filter((_, i) => i !== heldOutIdx);
  return { candidates, heldOut };
}

/**
 * Induce a structured recipe from the redacted sample blocks, validate it
 * against a held-out block, and retry on weak yield -- all under a HARD cap of
 * {@link MAX_LLM_CALLS_PER_FILE} relay calls. Returns either an accepted recipe
 * (keyed by format-fingerprint) or a `fallback` signal directing the
 * orchestrator to the Task Group 1 deterministic matcher.
 *
 * The LLM ONLY ever sees `block.text` (already redacted by the sampler); this
 * function embeds nothing else.
 */
export async function induceAndValidateRecipe(
  args: InduceRecipeArgs,
): Promise<RecipeInductionResult> {
  const { blocks, relay, runId, sourceFilePath } = args;
  if (!blocks || blocks.length === 0) {
    return { status: 'fallback', reason: 'no_samples', llmCallsUsed: 0 };
  }

  const fingerprint = fingerprintFromBlocks(blocks);
  const sourceFileKey = `file:${sourceFilePath}`;

  let llmCallsUsed = 0;
  let lastReason: RecipeInductionFailureReason = 'validation_failed_exhausted';

  for (let attempt = 0; attempt < MAX_LLM_CALLS_PER_FILE; attempt += 1) {
    const { candidates, heldOut } = partitionBlocks(blocks, attempt);
    if (candidates.length === 0 || !heldOut) {
      lastReason = 'no_samples';
      break;
    }

    const prompt = composeRecipePrompt(candidates);
    llmCallsUsed += 1;
    let content: string;
    try {
      const resp = await relay.induceLogRecipe({ prompt, filePath: sourceFilePath }, runId);
      content = resp?.content ?? '';
    } catch {
      // A relay failure consumes a call (bounded) and falls through to retry /
      // exhaustion; never throws (orchestrator NEVER-throws contract).
      lastReason = 'validation_failed_exhausted';
      continue;
    }

    const parsed = parseRecipeContent(content);
    if (parsed === 'no_pattern') {
      // An explicit "no pattern" is a definitive answer: stop spending calls.
      return { status: 'fallback', reason: 'no_pattern', llmCallsUsed };
    }
    if (parsed === null) {
      lastReason = 'malformed_recipe';
      continue;
    }

    const shell = buildRecipeShell(parsed);
    if (!shell) {
      lastReason = 'malformed_recipe';
      continue;
    }

    const yieldFraction = validateRecipeAgainstBlock(shell, heldOut.text);
    if (yieldFraction >= HELD_OUT_ACCEPT_FRACTION) {
      const recipe: LogRecipe = {
        ...shell,
        fingerprint,
        sourceFileKey,
        validationYield: yieldFraction,
        llmCallsUsed,
        origin: 'llm_induction',
      };
      return { status: 'accepted', recipe, llmCallsUsed };
    }
    lastReason = 'validation_failed_exhausted';
  }

  return { status: 'fallback', reason: lastReason, llmCallsUsed };
}

// ============================================================================
// Persistence shape + reuse lookup
// ============================================================================

/**
 * The recipe map stored under `steps_payload.v3.runtimeEvidence.recipe`. Keyed
 * by fingerprint with the per-source-file key ALSO recorded so a re-run can
 * look up either way. The orchestrator (Task Group 7) performs the actual
 * read-modify-write; this module owns the shape + the helpers.
 */
export type RecipeStore = Record<string, LogRecipe>;

/**
 * Merge an accepted recipe into an in-memory recipe store (returning a NEW
 * object; never mutates the input). The recipe is stored under BOTH its
 * fingerprint and its per-source-file fallback key so either lookup hits.
 *
 * Exported + unit-tested against an in-memory `steps_payload` slice (the actual
 * write is the orchestrator's job in Task Group 7).
 */
export function upsertRecipeIntoStore(
  store: RecipeStore | undefined,
  recipe: LogRecipe,
): RecipeStore {
  const next: RecipeStore = { ...(store ?? {}) };
  next[recipe.fingerprint] = recipe;
  next[recipe.sourceFileKey] = recipe;
  return next;
}

/**
 * Look up a previously-persisted recipe by format-fingerprint, falling back to
 * the per-source-file key. Returns the recipe (so the orchestrator can SKIP the
 * LLM entirely on an identical-format re-run) or null on a miss.
 *
 * Exported + unit-tested: a same-fingerprint re-run reuses the recipe WITHOUT
 * another LLM call.
 */
export function lookupReusableRecipe(
  store: RecipeStore | undefined,
  fingerprint: string,
  sourceFileKey?: string,
): LogRecipe | null {
  if (!store) return null;
  if (fingerprint && store[fingerprint]) return store[fingerprint];
  if (sourceFileKey && store[sourceFileKey]) return store[sourceFileKey];
  return null;
}
