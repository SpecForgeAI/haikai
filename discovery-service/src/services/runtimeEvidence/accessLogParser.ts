/**
 * Apache / Nginx Access Log Parser (Common + Combined Log Format)
 *
 * Adds the only access-log format the brief explicitly requires that
 * none of the existing parsers under `logParsing/` cover. JSONL,
 * syslog, framework-pattern, and plaintext continue to flow through
 * the existing `parseLogContent` pathway — this module is strictly
 * additive.
 *
 * Common Log Format (CLF):
 *   host ident authuser [date] "method path proto" status bytes
 *
 * Combined Log Format:
 *   host ident authuser [date] "method path proto" status bytes "referrer" "user-agent"
 *
 * Per the spec privacy rule, the host (IP), referrer, and user-agent
 * fields are PARSED but DISCARDED — they never appear in the
 * `HttpRuntimeObservation` rows produced here.
 *
 * Date conversion: Apache/Nginx produce `[10/Oct/2026:13:55:36 +0000]`,
 * which is converted to ISO 8601 (`2026-10-10T13:55:36.000Z` for UTC
 * lines, or the local-zone equivalent) for downstream timeline use.
 *
 * Streaming: `parseClfStream` uses `fs.createReadStream +
 * readline.createInterface` so very large log files can be processed
 * without loading the whole file into memory (Spec 4 cap is 100MB
 * per file, 2000MB / 2 GB total).
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

import { HttpRuntimeObservation } from './httpRuntimeObservation';
import { normalizePath } from './endpointPathNormalizer';

/**
 * Lightweight intermediate row produced by `parseClfLine`.
 *
 * Distinct from `HttpRuntimeObservation` because the per-line parser
 * does not know its `sourceArtifactId` / `sourceFileName` (those are
 * supplied by the streaming wrapper). Callers that want a full
 * observation should either use `parseClfStream` (which does the
 * enrichment) or attach the artifact identifiers themselves.
 */
export interface ParsedAccessLogEntry {
  method: string;
  rawPath: string;
  normalizedPath: string;
  status: number;
  timestampIso?: string;
  lineNumber: number;
  /** The original line, capped at 200 chars for snippet display. */
  snippet: string;
}

const MONTH_TO_NUMBER: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/**
 * Tokeniser that respects "double-quoted" segments.
 *
 * Apache/Nginx CLF lines mix unquoted whitespace-separated tokens
 * with quoted strings (the request line, referrer, and user-agent).
 * Bracketed `[date]` fields are also treated as a single token.
 *
 * Returns the tokens with surrounding quotes / brackets stripped. The
 * bracketed date span (which legitimately contains an inner space
 * between the time and the timezone offset) becomes a single token —
 * so a Common Log Format line yields 7 tokens, and a Combined Log
 * Format line yields 9.
 */
function tokenizeClfLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = line.indexOf('"', i + 1);
      if (end === -1) {
        tokens.push(line.substring(i + 1));
        return tokens;
      }
      tokens.push(line.substring(i + 1, end));
      i = end + 1;
      continue;
    }
    if (ch === '[') {
      const end = line.indexOf(']', i + 1);
      if (end === -1) {
        tokens.push(line.substring(i + 1));
        return tokens;
      }
      tokens.push(line.substring(i + 1, end));
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < line.length && line[end] !== ' ' && line[end] !== '\t') {
      end++;
    }
    tokens.push(line.substring(i, end));
    i = end;
  }
  return tokens;
}

/**
 * Converts an Apache/Nginx CLF date token (`10/Oct/2026:13:55:36 +0000`)
 * into an ISO 8601 string. Returns undefined if the token cannot be
 * parsed — the caller treats observations without timestamps as
 * "unknown when".
 */
function parseClfDate(token: string): string | undefined {
  // Format: dd/MMM/yyyy:HH:mm:ss ±zzzz
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?:\s+([+-]\d{4}))?$/.exec(
    token
  );
  if (!match) return undefined;
  const [, day, monthAbbrev, year, hour, minute, second, tz] = match;
  const month = MONTH_TO_NUMBER[monthAbbrev];
  if (!month) return undefined;

  // Build an ISO-style string with the timezone offset preserved when
  // present. Without a timezone we treat the timestamp as UTC, which
  // matches the brief's lossy-but-deterministic policy.
  let isoOffset = 'Z';
  if (tz) {
    isoOffset = `${tz.substring(0, 3)}:${tz.substring(3)}`;
  }
  const candidate = `${year}-${month}-${day}T${hour}:${minute}:${second}${isoOffset}`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/**
 * Parses a single CLF Common or CLF Combined line.
 *
 * Returns null when the line does not match the expected token layout
 * (e.g. blank line, malformed entry); callers skip such lines without
 * counting them as parse failures.
 *
 * IPs (`host`), `referrer`, and `user-agent` are intentionally
 * consumed-and-discarded — they are never returned to the caller.
 */
export function parseClfLine(
  line: string,
  format: 'clf_common' | 'clf_combined',
  lineNumber: number
): ParsedAccessLogEntry | null {
  if (!line || !line.trim()) return null;

  const tokens = tokenizeClfLine(line);

  // Token layout (post-tokenisation; brackets / quotes stripped, so the
  // date and request-line each occupy a single token):
  //   tokens[0]    = host (DISCARDED — privacy)
  //   tokens[1]    = ident (RFC 1413 — usually "-")
  //   tokens[2]    = authuser (usually "-")
  //   tokens[3]    = date (bracket-stripped; e.g. "10/Oct/2026:13:55:36 +0000")
  //   tokens[4]    = "method path proto" (quote-stripped — single string)
  //   tokens[5]    = status
  //   tokens[6]    = bytes
  //   tokens[7..]  = combined-only: referrer (DISCARDED), user-agent (DISCARDED)
  // Common  => 7 tokens minimum, Combined => 9 tokens minimum.
  const minTokens = format === 'clf_combined' ? 9 : 7;
  if (tokens.length < minTokens) return null;

  const dateToken = tokens[3];
  const requestLine = tokens[4];
  const statusToken = tokens[5];

  const requestParts = requestLine.split(/\s+/);
  if (requestParts.length < 2) return null;
  const method = requestParts[0].toUpperCase();
  const rawPath = requestParts[1];

  const status = Number(statusToken);
  if (!Number.isFinite(status) || status < 100 || status > 599) return null;

  const timestampIso = parseClfDate(dateToken);
  const normalizedPath = normalizePath(rawPath);

  // Snippet — capped at 200 chars per evidence-atom snippet convention.
  // We deliberately use a sanitized form (the request line + status) so
  // raw IPs / user agents never bleed into evidence.
  const snippetSource = `${method} ${rawPath} ${status}`;
  const snippet = snippetSource.length > 200 ? snippetSource.substring(0, 200) : snippetSource;

  return {
    method,
    rawPath,
    normalizedPath,
    status,
    timestampIso,
    lineNumber,
    snippet,
  };
}

/**
 * Streams a CLF Common or Combined log file from disk and yields one
 * `HttpRuntimeObservation` per parsable line.
 *
 * Uses `fs.createReadStream + readline.createInterface` so memory use
 * stays bounded even at the 100MB per-file cap. Lines that fail to
 * parse are silently skipped (per the spec's failure-mode policy:
 * record warnings at the orchestrator level, not per-line).
 */
export async function* parseClfStream(
  filePath: string,
  format: 'clf_common' | 'clf_combined',
  sourceArtifactId: string,
  sourceFileName: string
): AsyncIterable<HttpRuntimeObservation> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    const parsed = parseClfLine(line, format, lineNumber);
    if (!parsed) continue;
    yield {
      method: parsed.method,
      rawPath: parsed.rawPath,
      normalizedPath: parsed.normalizedPath,
      status: parsed.status,
      timestampIso: parsed.timestampIso,
      sourceArtifactId,
      sourceFileName,
      lineNumber: parsed.lineNumber,
      snippet: parsed.snippet,
    };
  }
}
