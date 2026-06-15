/**
 * Shared snippet-redaction utility for Discovery Finding scanners.
 *
 * Spec: 2026-05-16 Wire Java + Spring Classic + Maven Findings (D6).
 * Hardened: 2026-05-29 DB Structural Fidelity (Group B) -- full-body secret
 * scrub + a generous size cap with a `truncated` flag.
 * Re-targeted: 2026-06-11 DB Object Translation Drafts (Task Group 1) -- the
 * FULL-BODY path replaces the blanket quoted-literal collapse with a TARGETED
 * secret scrub so proc/trigger/view bodies stay translatable, and the result
 * carries a `literal_policy` version marker.
 *
 * TWO ENTRY POINTS
 * ----------------
 *  - {@link redactSnippet}  -- the ORIGINAL string-returning helper. Used by
 *    the code-pack scanners (`javaFindingScanner.ts`,
 *    `springClassicFindingScanner.ts`) and the DB-pack profilers
 *    (`postgresProfiler.ts` / `sybaseProfiler.ts`). It keeps the historical
 *    behaviour EXACTLY: secret scrub + BLANKET quoted-literal collapse + a
 *    HARD truncate at `maxLen` (default 200). These call sites depend on the
 *    small snippet shape and MUST NOT change.
 *  - {@link redactFullBody} -- the object-returning helper for the DB-pack
 *    procedural-object bodies (stored procedures / triggers / views /
 *    sequences). It applies the SAME steps 1-2 secret scrub, but instead of
 *    collapsing EVERY string literal it scrubs ONLY literals assigned to a
 *    secret-named target (`password|passwd|pwd|secret|token|key|credential`,
 *    case-insensitive, on the assignment target / column / variable name) --
 *    covering `SET @password = '...'`, `pwd_column = '...'` and
 *    declare-with-default forms. Ordinary literals (`WHERE status =
 *    'ACTIVE'`, `PRINT 'starting'`) survive VERBATIM so the captured body is
 *    a faithful translation input. The GENEROUS size cap (~64KB) and the
 *    `{ body, redacted, truncated }` shape are unchanged; the result
 *    additionally carries `literal_policy: 'targeted_v2'` so downstream
 *    consumers can detect legacy blanket-collapsed bodies by the marker's
 *    ABSENCE. NO unbounded bodies.
 *
 * The secret-scrub steps (1-2) are SHARED between both entry points; ONLY the
 * string-literal handling (step 3) differs per path.
 *
 * Order of operations:
 *   1. Drop `Authorization: Basic ...` header lines (token replaced with
 *      `<REDACTED>`; the prefix is preserved so the shape stays recognisable).
 *   2. Mask values of secret-bearing keys -- `password=`, `pwd=`, `secret=`,
 *      `token=`, `api_key=`, `api-key=` -- in query-string AND property-file
 *      forms; ALSO scrub JDBC/connection-string credentials and standalone
 *      cloud-key tokens (AWS / bearer / private-key blocks).
 *   3. String literals:
 *      - snippet path: replace ALL quoted string literals (`"..."`, `'...'`)
 *        with `?` (historical blanket collapse, byte-identical).
 *      - full-body path: replace ONLY literals assigned to a secret-named
 *        target with `'<REDACTED>'`; all other literals preserved verbatim.
 *        (Runs BEFORE steps 1-2 on this path so the key=value masking cannot
 *        break the target-to-literal adjacency; the steps themselves are
 *        unchanged.)
 *   4. Bound the output: `redactSnippet` hard-truncates at `maxLen`;
 *      `redactFullBody` size-caps at ~64KB with a `truncated` flag.
 *
 * Pure functions -- no I/O, no side effects, no global state.
 */

/**
 * Default truncation cap for {@link redactSnippet}. Set to 200 per D6. The
 * code-pack scanners + DB-pack profilers rely on this exact value.
 */
export const DEFAULT_SNIPPET_MAX_LEN = 200;

/**
 * Generous size cap for {@link redactFullBody}. ~64KB. A body longer than this
 * is truncated (and the `truncated` flag set) so the findings table + the
 * migration-context transport are not bloated by a giant proc.
 */
export const FULL_BODY_MAX_BYTES = 64 * 1024;

/**
 * Redaction-policy version marker stamped on every {@link redactFullBody}
 * result (Spec 2026-06-11 DB Object Translation Drafts). Bodies captured
 * BEFORE this policy (blanket literal collapse) are detectable downstream by
 * the marker's ABSENCE on the finding detail -- they are flagged
 * `legacy_redacted` by the translation seeder and re-scanning is recommended.
 */
export const FULL_BODY_LITERAL_POLICY = 'targeted_v2' as const;

/**
 * Redaction sentinel string used everywhere a value is removed.
 * Kept short so the truncation budget is not eaten by the placeholder.
 */
const REDACTED = '<REDACTED>';

/**
 * Regex matching secret-bearing keys followed by `=` and a value.
 *
 * The key list is case-insensitive (`/i` flag). The key alternation matches
 * the bare keywords plus any property-key form that ends with one of the
 * keywords (e.g. `spring.datasource.password`, `session_secret`,
 * `MY_API_KEY`). We anchor the start with a non-key character (or start of
 * string) so we do not match a substring that begins in the middle of a
 * larger identifier.
 *
 * The value side stops at `&`, `;`, whitespace, `"`, `'`, or end-of-line so
 * both query-string and property-file forms work; quoted literals are
 * separately handled in step 3.
 *
 * Hardened (2026-05-29): the keyword set additionally covers `passwd`,
 * `access[_-]?key`, `secret[_-]?key`, `private[_-]?key`, `client[_-]?secret`,
 * and `auth[_-]?token` so full proc/trigger bodies that embed cloud / service
 * credentials are scrubbed reliably.
 */
const SECRET_KEY_REGEX =
  /(^|[^A-Za-z0-9])([A-Za-z0-9_.-]*?(?:passwd|password|pwd|client[_-]?secret|secret[_-]?key|secret|auth[_-]?token|token|access[_-]?key|api[_-]?key|private[_-]?key))(\s*=\s*)([^&;\s"'\r\n]*)/gi;

/**
 * Regex matching an `Authorization: Basic <token>` header line. Case
 * insensitive on the scheme prefix; token replaced with `<REDACTED>`.
 */
const BASIC_AUTH_HEADER_REGEX =
  /(Authorization\s*:\s*Basic\s+)([A-Za-z0-9+/=]+)/gi;

/**
 * Regex matching a `Bearer <token>` value (Authorization header or inline).
 * Token replaced with `<REDACTED>`; the `Bearer ` prefix is preserved.
 */
const BEARER_TOKEN_REGEX = /(Bearer\s+)([A-Za-z0-9._\-+/=]{8,})/gi;

/**
 * Regex matching credentials embedded in a JDBC / URI connection string of the
 * form `scheme://user:password@host`. The password segment (between `:` and
 * `@`, after a `//user`) is replaced; the rest of the URI shape is preserved.
 * Hardened path (2026-05-29) -- proc bodies frequently build connection
 * strings inline.
 */
const URI_CREDENTIALS_REGEX =
  /(\/\/[^/\s:@]+:)([^@\s/]+)(@)/g;

/**
 * Regex matching an AWS access-key id (`AKIA` / `ASIA` + 16 alnum) anywhere in
 * the text. Standalone tokens like this are not `key=value` shaped so the
 * SECRET_KEY_REGEX would miss them.
 */
const AWS_ACCESS_KEY_REGEX = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;

/**
 * Regex matching a PEM private-key block. The whole block (header to footer)
 * collapses to the sentinel.
 */
const PEM_PRIVATE_KEY_REGEX =
  /-----BEGIN(?:[A-Z ]+)PRIVATE KEY-----[\s\S]*?-----END(?:[A-Z ]+)PRIVATE KEY-----/g;

/**
 * Regex matching double-quoted string literals. Non-greedy body; supports a
 * simple `\"` escape so we don't merge two adjacent literals. We do NOT
 * attempt full lexical correctness -- this is a redaction heuristic only.
 */
const DOUBLE_QUOTED_LITERAL_REGEX = /"(?:[^"\\]|\\.)*"/g;

/**
 * Regex matching single-quoted string literals. Same non-greedy + escape
 * heuristic as the double-quoted form.
 */
const SINGLE_QUOTED_LITERAL_REGEX = /'(?:[^'\\]|\\.)*'/g;

/**
 * Secret-keyword test applied to the ASSIGNMENT TARGET name in the full-body
 * targeted scrub (Spec 2026-06-11). Contains-matching, case-insensitive, so
 * `@Password`, `pwd_column`, `api_TOKEN`, `userCredentials` all hit -- the
 * spec'd pattern set is `password|token|key|secret|credential` plus the
 * `passwd`/`pwd` spellings already covered by {@link SECRET_KEY_REGEX}.
 * Deliberately broad: over-scrubbing the rare benign `...key...`-named column
 * costs one literal; under-scrubbing leaks a credential.
 */
const SECRET_TARGET_NAME_REGEX =
  /(?:password|passwd|pwd|secret|token|key|credential)/i;

/**
 * Regex matching `[<preceding-ident>] <target> [(type-size)] = <string-literal>`
 * -- a string literal being ASSIGNED to a named target. Capture groups:
 *   1. an OPTIONAL preceding identifier on the same line -- the declared
 *      variable in a declare-with-default form (`DECLARE @pwd VARCHAR(50) =
 *      '...'`, where the immediate identifier before `=` is the TYPE, not the
 *      name) or just the keyword before a simple assignment (`SET`, `WHERE`,
 *      `AND`, ...);
 *   2. the identifier immediately before the `=` -- a T-SQL variable
 *      (`@x` / `#x`), a plain / dotted / bracket- or double-quote-delimited
 *      column name, or a type name in the declare-with-default form;
 *   3. an OPTIONAL parenthesized type size (`(100)`, `(10,2)`, `(max)`);
 *   4. the string literal itself (single- or double-quoted, tolerating
 *      backslash escapes and T-SQL doubled-quote escapes, with an optional
 *      `N` national-string prefix).
 *
 * The replacer keeps the match verbatim unless EITHER identifier (groups 1-2)
 * matches {@link SECRET_TARGET_NAME_REGEX} -- testing both is what makes the
 * `SET @password = '...'` / `pwd_column = '...'` / `DECLARE @token
 * VARCHAR(64) = '...'` forms all hit while `WHERE status = 'ACTIVE'` (target
 * `status`, preceding `WHERE`) stays verbatim.
 */
const ASSIGNED_STRING_LITERAL_REGEX =
  /(?:([@#]?[A-Za-z_][\w$.]*)[ \t]+)?([[\]"]?[@#]?[A-Za-z_][\w$.[\]"]*)\s*(\(\s*(?:\d+|max)\s*(?:,\s*\d+\s*)?\))?\s*=\s*(N?'(?:[^']|'')*'|"[^"]*")/gi;

/**
 * Steps 1-2 of the shared secret scrub: auth headers, bearer tokens, PEM
 * blocks, AWS keys, URI credentials and secret-bearing `key=value` pairs.
 * Returns the scrubbed text plus a flag indicating whether ANY rule fired.
 * String-literal handling (step 3) is per-entry-point and lives in
 * {@link collapseAllLiterals} / {@link scrubSecretAssignedLiterals}.
 */
function scrubSecretsCore(input: string): { text: string; redacted: boolean } {
  let out = input;
  let redacted = false;

  const before1 = out;
  out = out.replace(BASIC_AUTH_HEADER_REGEX, `$1${REDACTED}`);
  out = out.replace(BEARER_TOKEN_REGEX, `$1${REDACTED}`);
  if (out !== before1) redacted = true;

  const before2 = out;
  out = out.replace(PEM_PRIVATE_KEY_REGEX, REDACTED);
  out = out.replace(AWS_ACCESS_KEY_REGEX, REDACTED);
  out = out.replace(URI_CREDENTIALS_REGEX, `$1${REDACTED}$3`);
  // Capture groups: 1=leading-boundary char (or empty at start), 2=full key,
  // 3=`=` with surrounding whitespace, 4=value. Replace the value with the
  // sentinel; preserve groups 1-3 verbatim.
  out = out.replace(SECRET_KEY_REGEX, (_m, lead, key, eq) => `${lead}${key}${eq}${REDACTED}`);
  if (out !== before2) redacted = true;

  return { text: out, redacted };
}

/**
 * Step 3, SNIPPET path: blanket-collapse every quoted string literal to `?`
 * (shape-preserving; not a "secret scrubbed" signal on its own). HISTORICAL
 * behaviour -- the code-pack scanners + DB-pack profilers depend on this
 * exact output and it MUST NOT change.
 */
function collapseAllLiterals(input: string): string {
  let out = input;
  out = out.replace(DOUBLE_QUOTED_LITERAL_REGEX, '?');
  out = out.replace(SINGLE_QUOTED_LITERAL_REGEX, '?');
  return out;
}

/**
 * Step 3, FULL-BODY path (Spec 2026-06-11): TARGETED scrub. Preserve string
 * literals verbatim EXCEPT where the assignment target / column / variable
 * name matches the secret pattern set -- those literals collapse to the
 * quoted sentinel (quote style preserved so the body stays parseable SQL).
 * A fired targeted rule IS a "secret scrubbed" signal (unlike the blanket
 * collapse) so it contributes to the `redacted` flag.
 */
function scrubSecretAssignedLiterals(input: string): { text: string; redacted: boolean } {
  let fired = false;
  const text = input.replace(
    ASSIGNED_STRING_LITERAL_REGEX,
    (
      match: string,
      preceding: string | undefined,
      target: string,
      _typeSize: string | undefined,
      literal: string,
    ) => {
      const secretNamed =
        SECRET_TARGET_NAME_REGEX.test(target) ||
        (preceding !== undefined && SECRET_TARGET_NAME_REGEX.test(preceding));
      if (!secretNamed) {
        return match;
      }
      fired = true;
      // Replace ONLY the literal; everything before it (target, optional type
      // spec, `=`) is preserved verbatim. Quote style preserved so the body
      // stays parseable SQL.
      const quote = literal[literal.length - 1];
      return (
        match.slice(0, match.length - literal.length) +
        `${quote}${REDACTED}${quote}`
      );
    },
  );
  return { text, redacted: fired };
}

/**
 * Apply all redaction rules to a snippet and HARD-truncate at `maxLen`.
 *
 * ORIGINAL contract -- preserved for the code-pack scanners + DB-pack
 * profilers, INCLUDING the blanket quoted-literal collapse. Returns a plain
 * string. An empty / null-ish input collapses to the empty string.
 *
 * @param text   raw snippet text (may be empty or longer than `maxLen`).
 * @param maxLen optional truncation cap (default {@link DEFAULT_SNIPPET_MAX_LEN}).
 */
export function redactSnippet(
  text: string,
  maxLen: number = DEFAULT_SNIPPET_MAX_LEN,
): string {
  if (text === null || text === undefined) return '';
  const { text: core } = scrubSecretsCore(String(text));
  const scrubbed = collapseAllLiterals(core);
  // Step 4: hard truncate (historical behaviour).
  if (maxLen > 0 && scrubbed.length > maxLen) {
    return scrubbed.slice(0, maxLen);
  }
  return scrubbed;
}

/**
 * Result of a full-body redaction. `body` is the scrubbed + size-capped text;
 * `redacted` is TRUE when a secret-bearing rule fired (steps 1-2 OR the
 * targeted literal scrub); `truncated` is TRUE when the size cap clipped the
 * body; `literal_policy` is the redaction-policy version marker
 * ({@link FULL_BODY_LITERAL_POLICY}) -- callers thread it into the finding
 * detail_json so legacy blanket-collapsed bodies are detectable downstream by
 * its absence.
 */
export interface RedactedBody {
  body: string;
  redacted: boolean;
  truncated: boolean;
  literal_policy: typeof FULL_BODY_LITERAL_POLICY;
}

/**
 * Redact a FULL procedural-object body (stored procedure / trigger / view /
 * sequence). Applies the SAME steps 1-2 secret scrub as {@link redactSnippet}
 * but replaces the blanket literal collapse with the TARGETED secret scrub
 * (ordinary literals preserved verbatim; secret-named assignment targets
 * scrubbed) and the hard 200-char truncate with a GENEROUS size cap
 * ({@link FULL_BODY_MAX_BYTES}, ~64KB), reporting the `redacted` /
 * `truncated` flags plus the {@code literal_policy} marker. NO unbounded
 * bodies.
 *
 * The targeted literal scrub runs BEFORE steps 1-2 so the `key=value` masking
 * (which can inject a sentinel between `=` and a quoted value) cannot break
 * the target-to-literal adjacency; the steps themselves are unchanged.
 *
 * The cap is measured in UTF-8 bytes (not JS string length) so a body of
 * multi-byte characters cannot exceed the byte budget the findings table /
 * transport must carry. When the cap clips inside a multi-byte sequence we
 * trim back to the last whole character so the result stays valid UTF-8.
 *
 * @param text     raw body text (may be empty / null-ish -> empty result).
 * @param maxBytes optional byte cap (default {@link FULL_BODY_MAX_BYTES}).
 */
export function redactFullBody(
  text: string | null | undefined,
  maxBytes: number = FULL_BODY_MAX_BYTES,
): RedactedBody {
  if (text === null || text === undefined || String(text).length === 0) {
    return {
      body: '',
      redacted: false,
      truncated: false,
      literal_policy: FULL_BODY_LITERAL_POLICY,
    };
  }
  const targeted = scrubSecretAssignedLiterals(String(text));
  const core = scrubSecretsCore(targeted.text);
  const scrubbed = core.text;
  const redacted = targeted.redacted || core.redacted;

  const cap = maxBytes > 0 ? maxBytes : FULL_BODY_MAX_BYTES;
  const encoded = Buffer.from(scrubbed, 'utf8');
  if (encoded.length <= cap) {
    return {
      body: scrubbed,
      redacted,
      truncated: false,
      literal_policy: FULL_BODY_LITERAL_POLICY,
    };
  }
  // Clip to the byte cap, then trim back to a valid UTF-8 boundary by decoding
  // a slice and dropping a trailing replacement character if the cut landed
  // mid-sequence.
  let sliceLen = cap;
  // Avoid splitting a multi-byte sequence: walk back while the byte at the cut
  // is a UTF-8 continuation byte (0b10xxxxxx).
  while (sliceLen > 0 && (encoded[sliceLen] & 0xc0) === 0x80) {
    sliceLen -= 1;
  }
  const body = encoded.subarray(0, sliceLen).toString('utf8');
  return {
    body,
    redacted,
    truncated: true,
    literal_policy: FULL_BODY_LITERAL_POLICY,
  };
}
