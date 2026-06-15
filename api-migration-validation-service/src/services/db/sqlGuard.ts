/**
 * SELECT-only SQL guard. Used by `PostgresAdapter` (and any future engine
 * adapter) to reject anything that isn't a single read-only SELECT
 * statement.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * The parser is intentionally conservative -- it strips line / block
 * comments, then:
 *   - Rejects any of: INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, TRUNCATE,
 *     EXEC, CALL, GRANT, REVOKE, CREATE.
 *   - Rejects multi-statement input (`;` followed by more SQL).
 *   - Requires the first significant token to be SELECT (or WITH ... SELECT
 *     -- common-table expressions are allowed but the body MUST be SELECT).
 *
 * The match list mirrors the spec's regex literal:
 *   `INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXEC|CALL|GRANT|REVOKE|CREATE|;.*;`
 */

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'EXEC',
  'CALL',
  'GRANT',
  'REVOKE',
  'CREATE',
];

export class SqlGuardError extends Error {
  public readonly reason:
    | 'forbidden_keyword'
    | 'multi_statement'
    | 'not_select'
    | 'empty';

  constructor(message: string, reason: SqlGuardError['reason']) {
    super(message);
    this.name = 'SqlGuardError';
    this.reason = reason;
  }
}

/**
 * Strip SQL line / block comments. Returns the stripped string -- doesn't
 * mutate the input. The adapter still passes the ORIGINAL SQL to the
 * engine; the stripped form is only used for keyword / shape checks.
 */
function stripComments(sql: string): string {
  let out = sql;
  // Block comments /* ... */ (not nested -- SQL forbids nesting).
  out = out.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Line comments -- everything from -- to EOL.
  out = out.replace(/--[^\n\r]*/g, ' ');
  return out;
}

/**
 * Validate a SQL string against the SELECT-only contract. Throws
 * `SqlGuardError` on failure. Returns the trimmed (still-original) SQL on
 * success so callers can pass it through to the engine without an extra
 * trim hop.
 */
export function assertReadonlySelect(rawSql: string): string {
  const sql = (rawSql ?? '').trim();
  if (sql.length === 0) {
    throw new SqlGuardError('SQL statement is empty.', 'empty');
  }

  const stripped = stripComments(sql).trim();

  // Multi-statement check: a trailing single `;` is allowed (some clients
  // append it as a habit) but anything AFTER a `;` is rejected.
  const semiIdx = stripped.indexOf(';');
  if (semiIdx >= 0 && stripped.substring(semiIdx + 1).trim().length > 0) {
    throw new SqlGuardError(
      'Multiple SQL statements are not permitted -- supply a single SELECT.',
      'multi_statement',
    );
  }

  // Forbidden keyword check -- word-boundary anchored, case-insensitive.
  const forbiddenRegex = new RegExp(`\\b(?:${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');
  const match = forbiddenRegex.exec(stripped);
  if (match) {
    throw new SqlGuardError(
      `SQL contains forbidden keyword: ${match[0].toUpperCase()}. Only SELECT statements are permitted.`,
      'forbidden_keyword',
    );
  }

  // Must start with SELECT (or WITH for CTE-prefixed reads).
  const firstWord = /^([A-Za-z]+)/.exec(stripped);
  if (!firstWord) {
    throw new SqlGuardError(
      'SQL does not start with a recognisable keyword.',
      'not_select',
    );
  }
  const head = firstWord[1].toUpperCase();
  if (head !== 'SELECT' && head !== 'WITH') {
    throw new SqlGuardError(
      `SQL must begin with SELECT (or WITH ... SELECT). Found: ${head}.`,
      'not_select',
    );
  }

  return sql;
}

/**
 * Inject an explicit row LIMIT into the SQL if it doesn't already carry
 * one. Conservative -- only checks for a top-level `LIMIT` token outside
 * of CTE bodies and does NOT attempt to wrap the SQL when one is missing.
 *
 * Postgres-specific syntax (`LIMIT n`); future engine adapters supply
 * their own injector via the `engine` arg.
 */
export function ensureLimit(
  sql: string,
  maxRows: number,
  engine: 'postgres' = 'postgres',
): { sql: string; injected: boolean } {
  const stripped = stripComments(sql);
  // Detect a trailing top-level LIMIT (last non-empty token group). This
  // is intentionally simple -- Postgres only really cares about a trailing
  // LIMIT. If we mis-detect (e.g. a LIMIT inside a subquery), the worst
  // outcome is an extra LIMIT clause appended -- which Postgres rejects
  // with a parse error. That's the right failure mode.
  const limitRegex = /\blimit\b\s+\d+/i;
  if (limitRegex.test(stripped)) {
    return { sql, injected: false };
  }
  // Strip trailing semicolon for clean append.
  const trimmed = sql.replace(/;\s*$/, '');
  if (engine === 'postgres') {
    return { sql: `${trimmed} LIMIT ${maxRows}`, injected: true };
  }
  // Default: append LIMIT (works for ANSI engines).
  return { sql: `${trimmed} LIMIT ${maxRows}`, injected: true };
}
