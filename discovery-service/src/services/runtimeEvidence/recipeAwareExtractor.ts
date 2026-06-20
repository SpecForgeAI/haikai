/**
 * Recipe-Aware Deterministic Full-File Extractor (Spec
 * 2026-06-20-runtime-log-evidence-format-agnostic-extraction, Task Group 6).
 *
 * STEP 5 (validated-recipe path) of the quality-first runtime-log pipeline.
 * Once Task Group 5 has induced AND held-out-validated a {@link LogRecipe} from
 * a few small REDACTED samples, THIS module applies that recipe across the
 * ENTIRE file -- streamed -- to produce rich HTTP observations.
 *
 * CRITICAL INVARIANT (the whole reason this module exists): the LLM ONLY ever
 * saw the tiny redacted samples in Task Group 5. The WHOLE file is processed
 * here by DETERMINISTIC code -- no model is in this loop. A 27MB file is read
 * line-by-line via `createReadStream` + `readline`; records are assembled
 * incrementally per the recipe's delimiter so we never need the whole file
 * resident as one string.
 *
 * Field extraction is opportunistic and HONEST: method + path are the
 * load-bearing fields; request headers/body and response status/body are pulled
 * ONLY when the record actually contains them. A response is NEVER invented --
 * if the log did not record a response, the observation simply has no response
 * fields. Regex rules are compiled with the `RegExp` constructor (never
 * `eval`); a malformed rule yields no value rather than throwing, preserving the
 * orchestrator's NEVER-throws contract.
 *
 * Paths are run through `endpointPathNormalizer.normalizePath` so extracted
 * paths align with the candidate path templates the matching trio compares
 * against downstream. The emitted {@link RichObservation} shape is reused from
 * the Task Group 3 fast path, so both rich paths feed the SAME Task Group 7
 * evidence-atom builder.
 */

import * as fs from 'fs';
import * as readline from 'readline';

import { normalizePath } from './endpointPathNormalizer';
import { extractPathFromTarget } from './runDiscoveryRuntimeEvidence';
import type { RichObservation } from './knownFormatFastPath';
import type {
  LogRecipe,
  RecipeFieldRule,
  RecipeRecordDelimiter,
} from './logRecipeInduction';

/**
 * The recipe surface this extractor needs. A structural subset of
 * {@link LogRecipe} so tests can pass a minimal recipe object (delimiter +
 * fields) without the persistence keys.
 */
export type ExtractorRecipe = Pick<LogRecipe, 'recordDelimiter' | 'fields'>;

/** Optional per-file metadata stamped onto every emitted observation. */
export interface ExtractorSourceMeta {
  /** Source artifact id (matches `inputArtifacts.logFiles[].artifactId`). */
  sourceArtifactId?: string;
  /** Display filename of the source log file. */
  sourceFileName?: string;
}

/**
 * A {@link RichObservation} plus the line RANGE of the multi-line record it
 * came from, so the Task Group 7 atom builder can populate `logOrigin`
 * (`lineStart`/`lineEnd`) for a multi-line record, not just a single line.
 */
export interface RecipeExtractedObservation extends RichObservation {
  /** 1-based first source line of the record this observation came from. */
  lineStart: number;
  /** 1-based last source line of the record this observation came from. */
  lineEnd: number;
}

// ============================================================================
// Rule application
// ============================================================================

/**
 * Compile a rule's regex once, stripping any `g` flag (we control global
 * matching ourselves). Returns null on a malformed pattern.
 */
function compileRule(rule: RecipeFieldRule): RegExp | null {
  try {
    const flags = rule.flags ? rule.flags.replace(/g/g, '') : undefined;
    return new RegExp(rule.pattern, flags);
  } catch {
    return null;
  }
}

/** Read a dotted JSON key path from a parsed value. */
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
 * Apply a single-value field rule (`regex` first-match, or `json_path`) to a
 * record, returning the trimmed string value or undefined. `line_regex` is NOT
 * handled here -- it is for the key/value header accumulation path.
 */
function extractScalar(rule: RecipeFieldRule, record: string): string | undefined {
  if (rule.kind === 'json_path') {
    let obj: unknown;
    try {
      obj = JSON.parse(record);
    } catch {
      return undefined;
    }
    const value = readJsonPath(obj, rule.pattern);
    if (value === undefined || value === null) return undefined;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  const re = compileRule(rule);
  if (!re) return undefined;
  if (rule.kind === 'line_regex') {
    for (const line of record.split('\n')) {
      const m = re.exec(line);
      if (m && (m[1] ?? m[0])) return (m[1] ?? m[0]).trim();
    }
    return undefined;
  }
  const m = re.exec(record);
  if (!m) return undefined;
  const captured = m[1] ?? m[0];
  return captured ? captured.trim() : undefined;
}

/**
 * Accumulate a headers map from a per-line header rule. The rule's regex is run
 * over EACH line of the record; when `captureKeyValue` is set, group 1 is the
 * header name and group 2 the value. Returns the map (or undefined if empty --
 * we never emit an empty headers object, which would falsely imply "present").
 */
function extractHeaders(rule: RecipeFieldRule, record: string): Record<string, string> | undefined {
  const re = compileRule(rule);
  if (!re) return undefined;
  const out: Record<string, string> = {};
  for (const line of record.split('\n')) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (!m) continue;
    if (rule.captureKeyValue) {
      const key = (m[1] ?? '').trim();
      const value = (m[2] ?? '').trim();
      if (key) out[key] = value;
    } else if (m[1]) {
      // No key/value capture: treat the single capture as a serialized blob
      // under a positional key so we still surface that headers were present.
      out[`header_${Object.keys(out).length}`] = m[1].trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Coerce a status string to an integer in [100,599], else undefined. */
function coerceStatus(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /(\d{3})/.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 100 && n <= 599 ? n : undefined;
}

// ============================================================================
// Record -> observation
// ============================================================================

/**
 * Apply the recipe's field rules to one assembled record, returning a rich
 * observation or null when method+path could not be recovered (the record is
 * not a usable HTTP request). Response/header/body fields are populated ONLY
 * when present -- nothing is invented.
 */
export function extractRecord(
  recipe: ExtractorRecipe,
  record: string,
  lineStart: number,
  lineEnd: number,
  meta: ExtractorSourceMeta = {},
): RecipeExtractedObservation | null {
  const { fields } = recipe;

  const methodRaw = fields.method ? extractScalar(fields.method, record) : undefined;
  const pathRawValue = fields.path ? extractScalar(fields.path, record) : undefined;
  if (!methodRaw || !pathRawValue) return null;

  const method = methodRaw.trim().toUpperCase();
  // The path rule may capture a bare `/path` OR an absolute URL -> strip to its
  // path (same helper the broadened TG1 matcher uses).
  const rawPath = extractPathFromTarget(pathRawValue.trim());
  if (!rawPath || rawPath[0] !== '/') return null;

  const requestHeaders = fields.requestHeaders
    ? extractHeaders(fields.requestHeaders, record)
    : undefined;
  const requestBodyRaw = fields.requestBody ? extractScalar(fields.requestBody, record) : undefined;
  const requestBody = requestBodyRaw && requestBodyRaw.length > 0 ? requestBodyRaw : undefined;

  // Response fields: ONLY emitted when the log actually carried them.
  const status = fields.responseStatus
    ? coerceStatus(extractScalar(fields.responseStatus, record))
    : undefined;
  const responseBodyRaw = fields.responseBody
    ? extractScalar(fields.responseBody, record)
    : undefined;
  const responseBody = responseBodyRaw && responseBodyRaw.length > 0 ? responseBodyRaw : undefined;

  return {
    method,
    rawPath,
    normalizedPath: normalizePath(rawPath),
    status,
    requestHeaders,
    requestBody,
    responseBody,
    sourceArtifactId: meta.sourceArtifactId,
    sourceFileName: meta.sourceFileName,
    lineNumber: lineStart,
    lineStart,
    lineEnd,
  };
}

// ============================================================================
// Streaming record assembly
// ============================================================================

/**
 * A tiny stateful record-assembler driven by the recipe's record delimiter. Fed
 * one line at a time (`push`), it emits a completed record (text + 1-based line
 * range) whenever the delimiter says the current record has ended. The streamed
 * extractor calls `push` per line and `flush` at EOF so no whole-file buffer is
 * required (only the in-progress record).
 */
class RecordAssembler {
  private readonly kind: RecipeRecordDelimiter['kind'];
  private readonly startRe: RegExp | null;
  private bufLines: string[] = [];
  private bufStartLine = 0; // 1-based

  constructor(delim: RecipeRecordDelimiter) {
    this.kind = delim.kind;
    if (delim.kind === 'start_regex' && delim.pattern) {
      try {
        this.startRe = new RegExp(delim.pattern, delim.flags ? delim.flags.replace(/g/g, '') : undefined);
      } catch {
        this.startRe = null;
      }
    } else {
      this.startRe = null;
    }
  }

  /**
   * Feed one line (1-based `lineNumber`). Returns a completed record when the
   * delimiter boundary is crossed, else null.
   */
  push(line: string, lineNumber: number): { text: string; start: number; end: number } | null {
    if (this.kind === 'single_line') {
      if (line.trim().length === 0) return null;
      return { text: line, start: lineNumber, end: lineNumber };
    }

    if (this.kind === 'blank_line') {
      if (line.trim().length === 0) {
        return this.flush();
      }
      if (this.bufLines.length === 0) this.bufStartLine = lineNumber;
      this.bufLines.push(line);
      return null;
    }

    // start_regex: a matching line BEGINS a new record; emit the previous one.
    if (this.startRe && this.startRe.test(line)) {
      const completed = this.flush();
      this.bufLines = [line];
      this.bufStartLine = lineNumber;
      return completed;
    }
    // Continuation line: accumulate ONLY if a record is open (lines before the
    // first start-line are pre-amble / noise and are dropped).
    if (this.bufLines.length > 0) {
      this.bufLines.push(line);
    }
    return null;
  }

  /** Emit any in-progress record (call at EOF). Returns null when empty. */
  flush(): { text: string; start: number; end: number } | null {
    if (this.bufLines.length === 0) return null;
    const text = this.bufLines.join('\n');
    const start = this.bufStartLine;
    const end = this.bufStartLine + this.bufLines.length - 1;
    this.bufLines = [];
    this.bufStartLine = 0;
    return { text, start, end };
  }
}

/**
 * Apply a validated recipe across already-loaded log CONTENT (the in-memory
 * variant; the streaming file variant is {@link extractWithRecipe}). Used by
 * tests and by callers that already hold the content. Interleaved noise lines
 * (e.g. log4j `[thread] [logger]` banners) do NOT corrupt assembly: with a
 * `start_regex` delimiter they are dropped as pre-amble or absorbed as
 * continuation only inside an open record, and `extractRecord` ignores records
 * that yield no method+path.
 */
export function extractWithRecipeFromContent(
  recipe: ExtractorRecipe,
  content: string,
  meta: ExtractorSourceMeta = {},
): RecipeExtractedObservation[] {
  const assembler = new RecordAssembler(recipe.recordDelimiter);
  const observations: RecipeExtractedObservation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const completed = assembler.push(lines[i], i + 1);
    if (completed) {
      const obs = extractRecord(recipe, completed.text, completed.start, completed.end, meta);
      if (obs) observations.push(obs);
    }
  }
  const tail = assembler.flush();
  if (tail) {
    const obs = extractRecord(recipe, tail.text, tail.start, tail.end, meta);
    if (obs) observations.push(obs);
  }
  return observations;
}

/**
 * Apply a validated recipe across the WHOLE file, STREAMED. Reads the file
 * line-by-line via `createReadStream` + `readline` (the 27MB target case is
 * processed without buffering the file as a single string -- only the
 * in-progress multi-line record is held). Emits one rich observation per
 * usable record.
 *
 * @param filePath absolute path to the log file (already size-capped by caller).
 * @param recipe   the held-out-validated recipe from Task Group 5.
 * @param meta     per-file metadata stamped onto every observation.
 */
export async function extractWithRecipe(
  filePath: string,
  recipe: ExtractorRecipe,
  meta: ExtractorSourceMeta = {},
): Promise<RecipeExtractedObservation[]> {
  const assembler = new RecordAssembler(recipe.recordDelimiter);
  const observations: RecipeExtractedObservation[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let lineNumber = 0;
  try {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      lineNumber += 1;
      const completed = assembler.push(line, lineNumber);
      if (completed) {
        const obs = extractRecord(recipe, completed.text, completed.start, completed.end, meta);
        if (obs) observations.push(obs);
      }
    }
  } finally {
    stream.close();
  }
  const tail = assembler.flush();
  if (tail) {
    const obs = extractRecord(recipe, tail.text, tail.start, tail.end, meta);
    if (obs) observations.push(obs);
  }
  return observations;
}
