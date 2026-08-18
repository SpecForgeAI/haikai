/**
 * Log-replay corpus extraction (Capture-State Discipline & Log-Replay
 * program, Spec 5, 2026-08-18).
 *
 * Reuses the EXACT runtime-evidence parsing machinery (user ruling): the
 * CLF/Combined access-log parser (URL grade — tier 2a), the deterministic
 * JSON-lines rich fast path (tier 3), and the recipe-aware extractor seam
 * for formats a prior LLM induction already learned. The corpus is REQUESTS
 * ONLY: logged responses are never oracles (they describe production state
 * at logging time, not S0) — the logged status is retained as a diagnostic.
 *
 * Usefulness rules (design agreement):
 *   - body-less methods (GET / DELETE / HEAD / OPTIONS): a concrete logged
 *     URL IS the complete request (auth/standard headers are re-injected at
 *     replay time) -> useful at `url_only` richness;
 *   - body-ful methods (POST / PUT / PATCH): useful ONLY with a parseable
 *     logged request body -> `with_body`; otherwise discarded loudly
 *     (`no_request_body` — the coverage report names the gap, never hides it).
 *
 * Matching: observations match committed-model endpoints on method +
 * placeholder-equivalent normalized templates (the SAME normalizer +
 * equivalence the runtime-evidence matcher uses). Unmatched-but-API-shaped
 * calls are counted AND listed — they are missed-endpoint evidence for the
 * wizard's discovery-gaps section, never silent attrition.
 *
 * Dedup: identical requests (method + concrete path + body) collapse into
 * one item with an occurrence count — distribution preserved, zero wasted
 * replays.
 */

import * as crypto from 'crypto';

import { detectLogFormat } from '../logParsing';
import { parseClfLine } from '../runtimeEvidence/accessLogParser';
import {
  tryKnownFormatFastPathContent,
  type RichObservation,
} from '../runtimeEvidence/knownFormatFastPath';
import {
  extractWithRecipeFromContent,
  type ExtractorRecipe,
} from '../runtimeEvidence/recipeAwareExtractor';
import {
  arePathsEquivalentByPlaceholder,
  normalizePath,
} from '../runtimeEvidence/endpointPathNormalizer';

/** Methods whose request is fully determined by a concrete URL. */
const BODY_LESS_METHODS = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);
/** Methods whose essential detail rides in the request body. */
const BODY_FUL_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export interface CorpusEndpoint {
  id: string;
  method: string;
  /** The committed-model path template (named placeholders allowed). */
  template: string;
}

export interface CorpusItem {
  method: string;
  path_template: string;
  concrete_path: string;
  request_json: Record<string, unknown> | null;
  response_status: number | null;
  occurrence_count: number;
  richness: 'url_only' | 'with_body';
  matched_endpoint_id: string | null;
  source_file_name: string | null;
  line_number: number | null;
}

export interface CorpusFunnel {
  lines_total: number;
  observations_parsed: number;
  matched_endpoint: number;
  useful: number;
  discarded_no_matching_endpoint: number;
  discarded_no_request_body: number;
  deduplicated_into: number;
  format_detected: string;
  parse_mode: 'clf' | 'json_lines_rich' | 'recipe' | 'unreadable';
  /** Distinct unmatched METHOD + template — missed-endpoint evidence. */
  unmatched_endpoints: string[];
}

export interface CorpusExtractionResult {
  items: CorpusItem[];
  funnel: CorpusFunnel;
}

function bodyHash(body: unknown): string {
  if (body === undefined || body === null) return '-';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Parse a query string into a plain map (repeat keys keep the LAST value). */
function parseQuery(concretePath: string): Record<string, string> | null {
  const at = concretePath.indexOf('?');
  if (at === -1) return null;
  const out: Record<string, string> = {};
  for (const pair of concretePath.slice(at + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decodeURIComponentSafe(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decodeURIComponentSafe(pair.slice(eq + 1));
    if (key.length > 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Best-effort body parse: JSON stays structured; anything else rides raw. */
function parseBody(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

interface RawRequestObservation {
  method: string;
  /** Concrete request-target as logged, query preserved. */
  concretePath: string;
  status: number | null;
  requestHeaders: Record<string, string> | null;
  requestBody: string | undefined;
  lineNumber: number;
}

/**
 * Stage 1 — parse the file into raw request observations via the existing
 * machinery. Mode precedence: rich JSON-lines fast path; CLF/Combined line
 * parser; caller-supplied recipe; otherwise unreadable.
 */
export function parseRequestObservations(
  content: string,
  recipe?: ExtractorRecipe | null,
): { observations: RawRequestObservation[]; format: string; parseMode: CorpusFunnel['parse_mode'] } {
  const lines = content.split('\n');
  const format = detectLogFormat(lines);

  if (format === 'clf_common' || format === 'clf_combined') {
    const observations: RawRequestObservation[] = [];
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseClfLine(lines[i], format, i + 1);
      if (!parsed) continue;
      observations.push({
        method: parsed.method.toUpperCase(),
        // parseClfLine's rawPath is the FULL request-target from the log
        // line — query string preserved (the corpus replay URL).
        concretePath: parsed.rawPath,
        status: Number.isFinite(parsed.status) ? parsed.status : null,
        requestHeaders: null,
        requestBody: undefined,
        lineNumber: parsed.lineNumber,
      });
    }
    return { observations, format, parseMode: 'clf' };
  }

  const fastPath = tryKnownFormatFastPathContent(content);
  if (fastPath.usedFastPath) {
    return {
      observations: fastPath.extracted.map((o: RichObservation) => ({
        method: o.method.toUpperCase(),
        concretePath: o.rawPath,
        status: typeof o.status === 'number' ? o.status : null,
        requestHeaders: o.requestHeaders ?? null,
        requestBody: o.requestBody,
        lineNumber: o.lineNumber,
      })),
      format,
      parseMode: 'json_lines_rich',
    };
  }

  if (recipe) {
    const extracted = extractWithRecipeFromContent(recipe, content, {});
    return {
      observations: extracted.map((o) => ({
        method: o.method.toUpperCase(),
        concretePath: o.rawPath,
        status: typeof o.status === 'number' ? o.status : null,
        requestHeaders: o.requestHeaders ?? null,
        requestBody: o.requestBody,
        lineNumber: o.lineNumber,
      })),
      format,
      parseMode: 'recipe',
    };
  }

  return { observations: [], format, parseMode: 'unreadable' };
}

/**
 * Stage 2 — assemble the corpus: match, classify usefulness, dedup, account.
 */
export function extractReplayCorpus(args: {
  content: string;
  fileName?: string | null;
  endpoints: CorpusEndpoint[];
  recipe?: ExtractorRecipe | null;
}): CorpusExtractionResult {
  const { observations, format, parseMode } = parseRequestObservations(
    args.content,
    args.recipe ?? null,
  );

  const endpointIndex = args.endpoints
    .filter((e) => e.method && e.template)
    .map((e) => ({
      id: e.id,
      method: e.method.toUpperCase(),
      normalizedTemplate: normalizePath(e.template.split('?')[0]),
    }));

  const funnel: CorpusFunnel = {
    lines_total: args.content.split('\n').length,
    observations_parsed: observations.length,
    matched_endpoint: 0,
    useful: 0,
    discarded_no_matching_endpoint: 0,
    discarded_no_request_body: 0,
    deduplicated_into: 0,
    format_detected: format,
    parse_mode: parseMode,
    unmatched_endpoints: [],
  };

  const unmatched = new Set<string>();
  const byDedupKey = new Map<string, CorpusItem>();

  for (const obs of observations) {
    const pathOnly = obs.concretePath.split('?')[0];
    const normalized = normalizePath(pathOnly);

    const match = endpointIndex.find(
      (e) =>
        e.method === obs.method &&
        arePathsEquivalentByPlaceholder(e.normalizedTemplate, normalized),
    );
    if (!match) {
      funnel.discarded_no_matching_endpoint += 1;
      unmatched.add(`${obs.method} ${normalized}`);
      continue;
    }
    funnel.matched_endpoint += 1;

    let richness: CorpusItem['richness'];
    let body: unknown;
    if (BODY_LESS_METHODS.has(obs.method)) {
      richness = 'url_only';
      body = undefined;
    } else if (BODY_FUL_METHODS.has(obs.method)) {
      body = parseBody(obs.requestBody);
      if (body === undefined) {
        funnel.discarded_no_request_body += 1;
        continue;
      }
      richness = 'with_body';
    } else {
      // Unknown verbs never replay.
      funnel.discarded_no_matching_endpoint += 1;
      continue;
    }
    funnel.useful += 1;

    const key = `${obs.method}|${obs.concretePath}|${bodyHash(body)}`;
    const existing = byDedupKey.get(key);
    if (existing) {
      existing.occurrence_count += 1;
      continue;
    }
    const query = parseQuery(obs.concretePath);
    const requestJson: Record<string, unknown> = {};
    if (query) requestJson.query = query;
    if (obs.requestHeaders && Object.keys(obs.requestHeaders).length > 0) {
      requestJson.headers = obs.requestHeaders;
    }
    if (body !== undefined) requestJson.body = body;
    byDedupKey.set(key, {
      method: obs.method,
      path_template: match.normalizedTemplate,
      concrete_path: obs.concretePath,
      request_json: Object.keys(requestJson).length > 0 ? requestJson : null,
      response_status: obs.status,
      occurrence_count: 1,
      richness,
      matched_endpoint_id: match.id,
      source_file_name: args.fileName ?? null,
      line_number: obs.lineNumber,
    });
  }

  funnel.deduplicated_into = byDedupKey.size;
  funnel.unmatched_endpoints = [...unmatched].sort();

  const items = [...byDedupKey.values()].sort((a, b) =>
    `${a.method} ${a.concrete_path}`.localeCompare(`${b.method} ${b.concrete_path}`),
  );
  return { items, funnel };
}
