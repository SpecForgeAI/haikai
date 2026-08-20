/**
 * Endpoint Path Normalizer
 *
 * Three-tier path-segment normalization used by the runtime-evidence
 * sub-stage. Replaces ID-bearing segments with a canonical `{id}`
 * placeholder so that observations against `/users/123` and
 * `/users/456` aggregate against the same key.
 *
 * Tier order (per segment, after query string is stripped):
 *   1. Numeric — `^\d+$` → `{id}`
 *   2. UUID    — `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (case-insensitive) → `{id}`
 *   3. Long token — `^[a-zA-Z0-9_.:-]{16,}$` AND `/\d/.test(segment)` → `{id}`
 *
 * The Tier-3 character class includes `.` and `:` so deployment-style
 * IDs like `cloudprod-green.1777556997748.367530` (dot-segmented) and
 * `host:port:1700000000000` (colon-segmented) are recognised as IDs.
 *
 * Slug-only segments (no digits) are NOT normalized — `my-product-name`
 * stays as-is.
 *
 * The existing inline normalization in
 * `discovery-service/src/services/logExtractors/endpointUsageExtractor.ts`
 * is left untouched (it serves the manual reprocess route); this module
 * supersedes it for the new runtime-evidence pipeline.
 */

const NUMERIC_SEGMENT_REGEX = /^\d+$/;
const UUID_SEGMENT_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Hotfix (Image #5 — Fix 3a): include `.` and `:` in the long-token
 * character class so deployment-style IDs like
 * `cloudprod-green.1777556997748.367530` (dot-segmented) and
 * `host:port:1700000000000` (colon-segmented) are recognised. Without
 * the dots, those segments stay literal and never aggregate with their
 * `{id}` template, so they show as separate untracked routes.
 */
const LONG_TOKEN_REGEX = /^[a-zA-Z0-9_.:-]{16,}$/;
const HAS_DIGIT_REGEX = /\d/;

/**
 * Returns true if the segment matches one of the three ID-bearing
 * tiers and should be replaced by the `{id}` placeholder.
 */
function isIdSegment(segment: string): boolean {
  // Tier 1 — numeric
  if (NUMERIC_SEGMENT_REGEX.test(segment)) return true;
  // Tier 2 — UUID
  if (UUID_SEGMENT_REGEX.test(segment)) return true;
  // Tier 3 — long token (16+ chars and contains at least one digit)
  if (LONG_TOKEN_REGEX.test(segment) && HAS_DIGIT_REGEX.test(segment)) return true;
  return false;
}

/**
 * Normalizes a raw URL path by stripping the query string and replacing
 * each ID-bearing segment with `{id}`. Empty segments (leading slash,
 * doubled slashes) are preserved so the output retains the same
 * leading-slash shape as the input.
 *
 * Examples:
 *   normalizePath("/users/123")          => "/users/{id}"
 *   normalizePath("/users/123?x=1")      => "/users/{id}"
 *   normalizePath("/orders/<UUID>")      => "/orders/{id}"
 *   normalizePath("/objects/a1b2c3d4e5f6g7h8") => "/objects/{id}"
 *   normalizePath("/products/my-product-name") => "/products/my-product-name"
 *
 * @param rawPath - URL path as it appeared in the log line, possibly with `?query`
 * @returns Normalized path with `{id}` placeholders for ID-bearing segments
 */
export function normalizePath(rawPath: string): string {
  // Strip query string BEFORE per-segment normalization
  const queryIndex = rawPath.indexOf('?');
  const pathOnly = queryIndex === -1 ? rawPath : rawPath.substring(0, queryIndex);

  // Split on '/' — preserves leading empty segment so '/a/b' splits to ['', 'a', 'b']
  const segments = pathOnly.split('/');
  const normalized = segments.map((seg) => (isIdSegment(seg) ? '{id}' : seg));
  return normalized.join('/');
}

/**
 * Returns true if the two paths are equivalent under placeholder-name
 * collapse — i.e. any `{xyz}` segment in either path is treated as
 * structurally equal to any other `{abc}` segment in the same position,
 * AND a placeholder on either side dominates a literal on the other in
 * the same position (so `/owners/{id}` matches `/owners/123`).
 *
 * Used by the runtime matcher to allow code candidates that declare
 * named placeholders (e.g. `/owners/{ownerId}/pets/{petId}`) to match
 * normalized log paths that use the canonical `{id}` placeholder
 * (e.g. `/owners/{id}/pets/{id}`), and to allow code candidates with a
 * placeholder to match log paths whose ID segments did not normalize
 * (e.g. a slug-shaped numeric ID that fell through Tier 3).
 *
 * Both inputs are first run through `normalizePath` so query strings
 * are stripped consistently.
 *
 * Examples:
 *   arePathsEquivalentByPlaceholder("/owners/{id}/pets/{id}", "/owners/{ownerId}/pets/{petId}") => true
 *   arePathsEquivalentByPlaceholder("/users/{id}", "/users/{id}") => true
 *   arePathsEquivalentByPlaceholder("/users/{id}", "/users/me") => true   // placeholder dominates literal
 *   arePathsEquivalentByPlaceholder("/owners/{id}", "/owners/123") => true // placeholder dominates literal
 *   arePathsEquivalentByPlaceholder("/a/{id}", "/b/{id}") => false        // different literal first segment
 */
export function arePathsEquivalentByPlaceholder(a: string, b: string): boolean {
  const aSegs = normalizePath(a).split('/');
  const bSegs = normalizePath(b).split('/');
  if (aSegs.length !== bSegs.length) return false;

  for (let i = 0; i < aSegs.length; i++) {
    const aSeg = aSegs[i];
    const bSeg = bSegs[i];
    const aIsPlaceholder = isPlaceholderSegment(aSeg);
    const bIsPlaceholder = isPlaceholderSegment(bSeg);
    // Hotfix (Image #5 — Fix 3b): placeholder on EITHER side dominates a
    // literal on the other in the same position. Previously this used
    // `&&`, which only collapsed when BOTH sides were placeholders, so
    // a code candidate `/owners/{id}` would not bind to a log line
    // `/owners/123` whose Tier-3 normalization left the `123` literal
    // intact.
    if (aIsPlaceholder || bIsPlaceholder) {
      continue;
    }
    if (aSeg !== bSeg) return false;
  }
  return true;
}

const PLACEHOLDER_SEGMENT_REGEX = /^\{[^/{}]+\}$/;

function isPlaceholderSegment(segment: string): boolean {
  return PLACEHOLDER_SEGMENT_REGEX.test(segment);
}

/**
 * Returns true if a segment is a TEMPLATE PARAM that should collapse to the
 * canonical placeholder token in `canonicalEndpointPath`. This is broader than
 * `isPlaceholderSegment`: it accepts BOTH a well-formed `{name}` AND any segment
 * that carries a PARTIAL / unbalanced brace (`businessDate}` with the opening
 * `{` lost, `{businessDate` with the closing `}` lost). A malformed brace almost
 * always means a template param that was mangled during upstream string assembly
 * (e.g. a path that begins and ends with a param segment getting its outer braces
 * stripped by an array-literal unwrapper). Collapsing the malformed form to the
 * same token as its well-formed twin lets the Spec-0 identity key recognise them
 * as the SAME endpoint and merge them, instead of keeping two rows.
 *
 * A brace-LESS segment (no `{` or `}` at all) is deliberately NOT treated as a
 * param here — that would wrongly collapse genuine static segments. The brace-less
 * twin is fixed at SOURCE (the spring-classic path assembler now emits a balanced
 * `{name}`); this predicate only has to rescue the partial-brace case.
 */
function isTemplateParamSegment(segment: string): boolean {
  // Well-formed `{name}` — the common, correct case.
  if (isPlaceholderSegment(segment)) return true;
  // Partial / unbalanced brace — a mangled template param. Any `{` or `}` in a
  // non-empty segment is enough; static segments never contain a brace.
  return segment.length > 0 && (segment.includes('{') || segment.includes('}'));
}

/**
 * The single positional token every `{anything}` placeholder segment collapses
 * to in `canonicalEndpointPath`. A literal `{p}` is intentionally NOT a path
 * any real route would carry, so it cannot collide with a static segment.
 */
const CANONICAL_PLACEHOLDER_TOKEN = '{p}';

/**
 * Produce a SINGLE canonical, hashable string for a raw endpoint path so it can
 * be used directly as a `Map` key (cf. `arePathsEquivalentByPlaceholder`, which
 * is only a pairwise comparator and therefore unusable as a key).
 *
 * Composes the two existing primitives, in order:
 *   1. `normalizePath` — strips the query string and rewrites ID-bearing
 *      LITERAL segments (numeric / UUID / long-token-with-digit) to `{id}`.
 *   2. Placeholder collapse — every TEMPLATE-PARAM segment is collapsed to ONE
 *      positional token (`{p}`), so two templates that differ only in placeholder
 *      NAME hash to the same key. A param segment is recognised both in its
 *      well-formed `{id}` / `{ownerId}` shape AND in a PARTIAL / unbalanced-brace
 *      shape (`businessDate}`, `{businessDate`) — the latter is what an upstream
 *      array-literal unwrapper produces when it mistakes a path that begins and
 *      ends with a param for a `{"...","..."}` array and strips the outer braces.
 *      Collapsing the malformed form to the same `{p}` token as its well-formed
 *      twin makes the Spec-0 identity key treat them as the SAME endpoint, so the
 *      merge keeps one row instead of two.
 *
 * Static (literal, non-ID, brace-less) segments are preserved verbatim, so a
 * static route stays DISTINCT from a templated one at the key level:
 *
 *   canonicalEndpointPath('/users/123')                     => '/users/{p}'
 *   canonicalEndpointPath('/users/{id}')                    => '/users/{p}'
 *   canonicalEndpointPath('/users/{theString}')             => '/users/{p}'
 *   canonicalEndpointPath('/owners/{ownerId}/pets/{petId}') => '/owners/{p}/pets/{p}'
 *   canonicalEndpointPath('/hierarchy/businessDate}/{orgUnitId}') => '/hierarchy/{p}/{p}'  (malformed twin)
 *   canonicalEndpointPath('/hierarchy/{businessDate}/{orgUnitId}') => '/hierarchy/{p}/{p}' (well-formed twin)
 *   canonicalEndpointPath('/users/me')                      => '/users/me'  (distinct)
 *
 * Note: this canonicalizer deliberately does NOT implement the
 * placeholder-dominates-literal rule of `arePathsEquivalentByPlaceholder`
 * (that rule is pairwise and cannot be expressed as a single key); a static
 * `/users/me` and a templated `/users/{id}` are NOT forced equal here.
 *
 * @param rawPath - endpoint path (possibly with `?query`, possibly templated)
 * @returns a single canonical string suitable as a Map key
 */
export function canonicalEndpointPath(rawPath: string): string {
  if (typeof rawPath !== 'string') return '';
  // Step 1 — literal-ID rewrite + query strip (reuses normalizePath).
  const normalized = normalizePath(rawPath);
  // Step 2 — collapse every template-param segment (well-formed OR
  // partial-brace) to one positional token.
  const segments = normalized.split('/');
  const collapsed = segments.map((seg) =>
    isTemplateParamSegment(seg) ? CANONICAL_PLACEHOLDER_TOKEN : seg,
  );
  return collapsed.join('/');
}
