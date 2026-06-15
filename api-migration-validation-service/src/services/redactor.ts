/**
 * Redactor -- pure functions that strip secrets from headers, JSON bodies,
 * URLs, and log lines. Reused both by axios interceptors (so a redacted copy
 * is logged) and by the AMS-write flows (so plaintext secrets never cross
 * the AMS boundary).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Constraints:
 *   - Idempotent: a redacted value passed back through the redactor must
 *     remain `[REDACTED]`.
 *   - Deep-walks objects & arrays (configurable depth cap).
 *   - Case-insensitive on header / field name matching.
 *   - NEVER throws -- a malformed input returns a best-effort redacted copy
 *     plus a warning; redaction failure must NOT take down a capture run.
 */

export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Header names that always carry secrets and must be stripped on every code
 * path. Comparison is case-insensitive. The default list is the conservative
 * intersection of OWASP recommendations and provider documentation
 * (Authorization, cookies, common API-key variants, AWS / GCP signed-request
 * headers).
 */
const DEFAULT_SENSITIVE_HEADERS: ReadonlyArray<string> = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-amz-security-token',
  'x-goog-api-key',
];

/**
 * JSON object field names that carry secrets in nested bodies. Comparison is
 * case-insensitive; substring matches are NOT applied (a field named
 * `passwordHint` is NOT redacted -- only the exact name).
 *
 * Email is intentionally NOT in this default list (per spec note: "email
 * optional/configurable"); operators wanting email redaction add it via the
 * `extraFieldNames` option.
 */
const DEFAULT_SENSITIVE_FIELDS: ReadonlyArray<string> = [
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'bearer',
  'ssn',
  'nationalinsurancenumber',
  'national_insurance_number',
  'creditcardnumber',
  'credit_card_number',
  'iban',
  'sessiontoken',
  'session_token',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
];

export interface RedactOptions {
  /** Extra header names to strip (case-insensitive). */
  extraHeaderNames?: ReadonlyArray<string>;
  /** Extra JSON field names to strip (case-insensitive, exact match). */
  extraFieldNames?: ReadonlyArray<string>;
  /**
   * Maximum recursion depth for nested objects / arrays. Default 12 -- caps
   * pathological deeply-nested payloads without truncating realistic API
   * shapes.
   */
  maxDepth?: number;
}

function lowerSet(values: ReadonlyArray<string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) out.add(v.toLowerCase());
  return out;
}

/**
 * Redact a header bag. Returns a new object -- the input is not mutated.
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
  options: RedactOptions = {},
): Record<string, string | string[]> {
  if (!headers || typeof headers !== 'object') return {};
  const sensitive = lowerSet([
    ...DEFAULT_SENSITIVE_HEADERS,
    ...(options.extraHeaderNames ?? []),
  ]);
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (sensitive.has(k.toLowerCase())) {
      out[k] = REDACTED_PLACEHOLDER;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Recursively redact a JSON-like value. Strings, numbers, booleans, and null
 * pass through untouched (they don't carry field names); objects and arrays
 * are walked and matching field names overwritten with `[REDACTED]`.
 *
 * Bearer-token style strings inside object VALUES are NOT redacted by this
 * pass -- redaction is keyed by field name, not by content shape, to avoid
 * false positives on legitimate JWT-shaped business data. Header / URL
 * redaction (which DO match by content) is handled separately.
 */
export function redactJson(
  value: unknown,
  options: RedactOptions = {},
  depth = 0,
): unknown {
  const maxDepth = options.maxDepth ?? 12;
  if (depth > maxDepth) return REDACTED_PLACEHOLDER;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  const sensitive = lowerSet([
    ...DEFAULT_SENSITIVE_FIELDS,
    ...(options.extraFieldNames ?? []),
  ]);

  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, options, depth + 1));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (sensitive.has(k.toLowerCase())) {
      out[k] = REDACTED_PLACEHOLDER;
    } else {
      out[k] = redactJson(v, options, depth + 1);
    }
  }
  return out;
}

/**
 * Strip `Authorization: Bearer <token>` and `Authorization: Basic <base64>`
 * prefixes from a free-form log string -- regex-based, defensive, used as a
 * last-resort scrub on log lines that may have escaped header redaction.
 *
 * Also strips obvious `password=...` / `apikey=...` / `token=...` URL or
 * query-string fragments.
 */
export function redactLogString(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input;

  // Authorization headers in either header-line or stringified form.
  out = out.replace(
    /(authorization\s*[:=]\s*)(bearer|basic)\s+[^\s,;"']+/gi,
    `$1$2 ${REDACTED_PLACEHOLDER}`,
  );

  // Bearer tokens floating loose ("Bearer eyJhbGciOi..." style).
  out = out.replace(
    /\b(bearer)\s+([A-Za-z0-9._\-+\/=]{8,})/gi,
    `$1 ${REDACTED_PLACEHOLDER}`,
  );

  // password=... / apikey=... / token=... fragments in querystrings or DSNs.
  out = out.replace(
    /\b(password|passwd|pwd|apikey|api_key|token|secret|access_token|refresh_token)\s*=\s*([^&\s"']+)/gi,
    `$1=${REDACTED_PLACEHOLDER}`,
  );

  // Custom header-line shape ("X-Api-Key: abc123").
  out = out.replace(
    /\b(x-(?:api-key|auth-token|access-token))\s*:\s*([^\s,;"']+)/gi,
    `$1: ${REDACTED_PLACEHOLDER}`,
  );

  // Postgres-style DSN passwords: postgres://user:pass@host -> postgres://user:[REDACTED]@host
  out = out.replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s]+:)([^@\s]+)(@)/gi,
    `$1${REDACTED_PLACEHOLDER}$3`,
  );

  return out;
}

/**
 * Convenience helper: redact a URL by stripping any `password=...` / token
 * query-string fragments AND scrubbing user-info in the URL authority.
 * Falls back to `redactLogString` if the input isn't a parseable URL.
 */
export function redactUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return url;
  try {
    const u = new URL(url);
    // Strip any sensitive query params.
    const sensitive = lowerSet(DEFAULT_SENSITIVE_FIELDS);
    for (const key of Array.from(u.searchParams.keys())) {
      if (sensitive.has(key.toLowerCase())) {
        u.searchParams.set(key, REDACTED_PLACEHOLDER);
      }
    }
    if (u.password) {
      u.password = REDACTED_PLACEHOLDER;
    }
    return u.toString();
  } catch {
    return redactLogString(url);
  }
}
