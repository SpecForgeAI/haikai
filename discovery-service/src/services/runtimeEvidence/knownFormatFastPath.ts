/**
 * Known-format fast path, RICHNESS-GATED (Spec
 * 2026-06-20-runtime-log-evidence-format-agnostic-extraction, Task Group 3).
 *
 * STEP 2 of the quality-first pipeline. BEFORE spending an LLM call on recipe
 * induction (Task Group 5), try the existing structured parsers
 * (`detectLogFormat` / `parseLogContent` for JSON-lines / framework / syslog /
 * plaintext, and `accessLogParser.parseClfStream` for CLF common/combined). If
 * a known parser yields the RICH field set the log actually supports -- method,
 * path, request headers, request body, response status + body -- we use that
 * deterministic extraction for the WHOLE file and skip the LLM entirely.
 *
 * The GATE is the whole point: we only take the fast path when it is RICH.
 *   - A structured JSON-lines access log that embeds request headers/body and a
 *     response status/body PASSES -> deterministic extraction, no LLM call.
 *   - A plain CLF log carries only method+path+status (no headers, no bodies,
 *     no response body) -> THIN -> we return `{ usedFastPath: false }` so the
 *     caller proceeds to LLM recipe induction. (The LLM cannot invent the
 *     missing fields either, so at worst this costs one extra call; it never
 *     force-fits a thin log to "rich".)
 *
 * CRITICAL invariant (shared with the rest of the feature): NEVER invent a
 * field the log does not contain. A response is emitted ONLY when the record
 * actually logged one; the richness predicate measures what IS present, it does
 * not fabricate.
 *
 * The emitted {@link RichObservation} shape is a superset of the existing
 * `HttpRuntimeObservation` (so it stays compatible with the matching trio) plus
 * the rich request/response fields the Task Group 7 evidence-atom builder will
 * persist.
 */

import { detectLogFormat, parseLogContent, type LogFormat } from '../logParsing';
import { normalizePath } from './endpointPathNormalizer';
import { extractPathFromTarget } from './runDiscoveryRuntimeEvidence';

/**
 * A rich HTTP observation: the base method/path/status + line metadata plus the
 * optional rich fields (request headers/body, response status/headers/body)
 * captured ONLY when the log actually contained them.
 *
 * Field names mirror `HttpRuntimeObservation` where they overlap (`method`,
 * `rawPath`, `normalizedPath`, `status`, `sourceArtifactId`, `sourceFileName`,
 * `lineNumber`) so a `RichObservation` can be fed straight into the existing
 * aggregator/matcher; the additional fields are what makes it "rich".
 */
export interface RichObservation {
  /** Uppercase HTTP method. */
  method: string;
  /** Request path exactly as logged (query preserved), scheme/host stripped. */
  rawPath: string;
  /** Normalized path template (`{id}` placeholders). */
  normalizedPath: string;
  /** Response status code (100..599) when logged; undefined otherwise. */
  status?: number;
  /** ISO 8601 timestamp when the log provides one. */
  timestampIso?: string;
  /** Request headers as a name->value map, when logged. */
  requestHeaders?: Record<string, string>;
  /** Request body (string form), when logged. */
  requestBody?: string;
  /** Response headers as a name->value map, when logged. */
  responseHeaders?: Record<string, string>;
  /** Response body (string form), when logged. */
  responseBody?: string;
  /** Source artifact id (populated by the caller / orchestrator). */
  sourceArtifactId?: string;
  /** Source display filename (populated by the caller / orchestrator). */
  sourceFileName?: string;
  /** 1-based source line number. */
  lineNumber: number;
}

/** Result of the richness-gated known-format fast path. */
export type KnownFormatFastPathResult =
  | { usedFastPath: true; extracted: RichObservation[]; format: LogFormat }
  | { usedFastPath: false; format: LogFormat; reason: string };

/**
 * The five rich fields the gate measures. Used by {@link classifyRecordRichness}
 * to decide whether a single record is rich enough to justify skipping the LLM.
 */
export interface RecordFieldPresence {
  hasMethod: boolean;
  hasPath: boolean;
  hasRequestHeaders: boolean;
  hasRequestBody: boolean;
  hasResponseStatus: boolean;
  hasResponseBody: boolean;
}

/**
 * Minimum fraction of request-bearing records that must be RICH for the whole
 * file to take the deterministic fast path. Below this we fall through to the
 * LLM (the log "clearly carries more" than the thin parse recovered).
 */
export const RICHNESS_ACCEPT_FRACTION = 0.6;

/**
 * Classify a single record as rich vs thin given which fields are present.
 *
 * A record is RICH when it carries method + path AND a meaningful slice of the
 * request/response payload: at least one of (request headers, request body)
 * AND at least one of (response status, response body). Method+path ALONE
 * (the CLF case) is explicitly THIN -- that is the signal to fall through to
 * the LLM rather than settle for a method+path-only extraction.
 *
 * Pure predicate; exported for direct unit testing (tasks.md 3.1 bullet 3).
 */
export function classifyRecordRichness(fields: RecordFieldPresence): boolean {
  if (!fields.hasMethod || !fields.hasPath) return false;
  const hasRequestDetail = fields.hasRequestHeaders || fields.hasRequestBody;
  const hasResponseDetail = fields.hasResponseStatus || fields.hasResponseBody;
  return hasRequestDetail && hasResponseDetail;
}

/** Coerce an unknown header-ish value into a `Record<string,string>` or undefined. */
function coerceHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Coerce an unknown body-ish value into a string body or undefined. */
function coerceBody(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (typeof value === 'object') {
    const s = JSON.stringify(value);
    return s && s !== '{}' && s !== '[]' ? s : undefined;
  }
  return String(value);
}

/** Read the first present key from a candidate list on an object. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

const METHOD_KEYS = ['method', 'http_method', 'httpMethod', 'verb', 'req_method'];
const PATH_KEYS = ['path', 'url', 'uri', 'request_uri', 'requestUri', 'target', 'route'];
const STATUS_KEYS = ['status', 'status_code', 'statusCode', 'response_status', 'responseStatus', 'http_status'];
const REQ_HEADER_KEYS = ['request_headers', 'requestHeaders', 'req_headers', 'reqHeaders', 'headers'];
const REQ_BODY_KEYS = ['request_body', 'requestBody', 'req_body', 'reqBody', 'body', 'payload'];
const RES_HEADER_KEYS = ['response_headers', 'responseHeaders', 'res_headers', 'resHeaders'];
const RES_BODY_KEYS = ['response_body', 'responseBody', 'res_body', 'resBody', 'response'];

/**
 * Try to extract a rich record from a single parsed JSON-lines object.
 *
 * Handles both FLAT shapes (`{ method, path, request_headers, request_body,
 * status, response_body }`) and NESTED shapes (`{ request: { method, url,
 * headers, body }, response: { status, headers, body } }`). Returns the
 * extracted observation plus its measured field presence, or null when the
 * object carries no method+path at all (not request-bearing).
 */
function extractRichFromJsonObject(
  obj: Record<string, unknown>,
  lineNumber: number,
): { observation: RichObservation; presence: RecordFieldPresence } | null {
  const request =
    obj.request && typeof obj.request === 'object' && !Array.isArray(obj.request)
      ? (obj.request as Record<string, unknown>)
      : undefined;
  const response =
    obj.response && typeof obj.response === 'object' && !Array.isArray(obj.response)
      ? (obj.response as Record<string, unknown>)
      : undefined;

  // Method + path can live at the top level or inside `request`.
  const methodRaw = pick(obj, METHOD_KEYS) ?? (request ? pick(request, METHOD_KEYS) : undefined);
  const pathRaw = pick(obj, PATH_KEYS) ?? (request ? pick(request, PATH_KEYS) : undefined);
  if (typeof methodRaw !== 'string' || typeof pathRaw !== 'string') return null;
  if (!methodRaw.trim() || !pathRaw.trim()) return null;

  const method = methodRaw.trim().toUpperCase();
  const rawPath = extractPathFromTarget(pathRaw.trim());
  if (!rawPath || rawPath[0] !== '/') return null;

  // Request headers/body: top-level or nested under `request`.
  const requestHeaders =
    coerceHeaders(pick(obj, REQ_HEADER_KEYS)) ??
    (request ? coerceHeaders(pick(request, ['headers', ...REQ_HEADER_KEYS])) : undefined);
  const requestBody =
    coerceBody(pick(obj, REQ_BODY_KEYS)) ??
    (request ? coerceBody(pick(request, ['body', 'payload'])) : undefined);

  // Response status/headers/body: top-level or nested under `response`.
  const statusRaw =
    pick(obj, STATUS_KEYS) ?? (response ? pick(response, ['status', 'code', ...STATUS_KEYS]) : undefined);
  let status: number | undefined;
  if (typeof statusRaw === 'number' && Number.isFinite(statusRaw)) {
    status = statusRaw;
  } else if (typeof statusRaw === 'string' && /^\d{3}$/.test(statusRaw.trim())) {
    status = Number(statusRaw.trim());
  }
  if (status !== undefined && (status < 100 || status > 599)) status = undefined;

  const responseHeaders =
    coerceHeaders(pick(obj, RES_HEADER_KEYS)) ??
    (response ? coerceHeaders(pick(response, ['headers'])) : undefined);
  const responseBody =
    coerceBody(pick(obj, RES_BODY_KEYS)) ??
    (response ? coerceBody(pick(response, ['body'])) : undefined);

  const timestampRaw = pick(obj, ['timestamp', 'time', '@timestamp', 'ts']);
  const timestampIso = typeof timestampRaw === 'string' ? timestampRaw : undefined;

  const presence: RecordFieldPresence = {
    hasMethod: true,
    hasPath: true,
    hasRequestHeaders: requestHeaders !== undefined,
    hasRequestBody: requestBody !== undefined,
    hasResponseStatus: status !== undefined,
    hasResponseBody: responseBody !== undefined,
  };

  const observation: RichObservation = {
    method,
    rawPath,
    normalizedPath: normalizePath(rawPath),
    status,
    timestampIso,
    requestHeaders,
    requestBody,
    responseHeaders,
    responseBody,
    lineNumber,
  };

  return { observation, presence };
}

/**
 * Run the richness-gated known-format fast path over already-loaded log
 * content.
 *
 * @param content raw log file content.
 * @returns a {@link KnownFormatFastPathResult}: `usedFastPath: true` with the
 *   rich observations when the structured parse is rich, else
 *   `usedFastPath: false` (caller proceeds to the LLM recipe path).
 */
export function tryKnownFormatFastPathContent(content: string): KnownFormatFastPathResult {
  const lines = content.split('\n');
  const format = detectLogFormat(lines);

  // CLF carries no request bodies/headers and no response body -> THIN by
  // construction. The status-only parse is exactly the method+path-only case
  // the gate rejects, so we fall through to the LLM without parsing.
  if (format === 'clf_common' || format === 'clf_combined') {
    return {
      usedFastPath: false,
      format,
      reason: 'clf_is_thin_no_request_or_response_payload',
    };
  }

  // Only JSON-lines is reliably rich deterministically. Framework / syslog /
  // plaintext request bodies are bespoke multi-line shapes the LLM recipe path
  // (TG5/TG6) handles -- they are THIN for this deterministic gate.
  if (format !== 'json_lines') {
    return {
      usedFastPath: false,
      format,
      reason: `format_${format}_not_richly_structured_deterministically`,
    };
  }

  const richObservations: RichObservation[] = [];
  let requestBearingRecords = 0;
  let richRecords = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;

    const extracted = extractRichFromJsonObject(obj as Record<string, unknown>, i + 1);
    if (!extracted) continue;

    requestBearingRecords += 1;
    if (classifyRecordRichness(extracted.presence)) {
      richRecords += 1;
    }
    richObservations.push(extracted.observation);
  }

  if (requestBearingRecords === 0) {
    return {
      usedFastPath: false,
      format,
      reason: 'no_request_bearing_records',
    };
  }

  const richFraction = richRecords / requestBearingRecords;
  if (richFraction < RICHNESS_ACCEPT_FRACTION) {
    // The log clearly carries request/response payloads on some records but the
    // deterministic parse only recovered thin records on most -> do NOT settle;
    // hand off to the LLM recipe path.
    return {
      usedFastPath: false,
      format,
      reason: `thin_fraction_${richFraction.toFixed(2)}_below_${RICHNESS_ACCEPT_FRACTION}`,
    };
  }

  return { usedFastPath: true, extracted: richObservations, format };
}

/**
 * File-path variant. Reads the file (the caller has already enforced the
 * per-file size cap) and delegates to {@link tryKnownFormatFastPathContent}.
 *
 * Kept separate from the streaming sampler because the richness gate needs to
 * see whole JSON records, and `parseLogContent` already operates on full
 * content; the existing non-CLF extraction path in the orchestrator also reads
 * the file whole, so this is consistent with the module's memory profile.
 */
export async function tryKnownFormatFastPath(
  filePath: string,
  readFile: (p: string) => Promise<string>,
): Promise<KnownFormatFastPathResult> {
  const content = await readFile(filePath);
  return tryKnownFormatFastPathContent(content);
}
