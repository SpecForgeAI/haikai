/**
 * T-SQL dialect classifier + proc-call extraction (Spec 2026-07-06-f —
 * T-SQL Affinity & Consumer Revalidation, Code-Tier Oracle Program).
 *
 * DETERMINISTIC pattern classification over Java-side SQL texts (resolved
 * data-effect `query_text`s, unresolved-persistence findings' SQL, MyBatis
 * XML statements). Deliberately NOT a T-SQL parser — pattern families are
 * auditable, dependency-free, and fail-honest (`unknown` for fragmentary /
 * dynamic SQL rather than a guess).
 *
 * Suggested PostgreSQL equivalents come from the SINGLE-SOURCE
 * {@link NON_PORTABLE_DEFAULT_FUNCTIONS} table (imported, not duplicated —
 * the same table the DB pack's translation pre-pass mirrors), extended here
 * with the code-side construct families the DB pack never sees (lock hints,
 * legacy joins, TOP, temp tables, RAISERROR, SET ROWCOUNT, …).
 */

import { NON_PORTABLE_DEFAULT_FUNCTIONS } from './databasePackFindingScanners/databasePackFindingBuilders';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NonPortableConstruct {
  /** Stable construct name (e.g. 'getdate', 'HOLDLOCK', 'legacy_outer_join'). */
  construct: string;
  /** The verbatim matched text. */
  matched_text: string;
  /** Character offset of the match in the input SQL. */
  position: number;
  /** Suggested PostgreSQL equivalent; null = flagged, no exact equivalent. */
  suggested_equivalent: string | null;
  /** Human note (carried into spec text verbatim — guidance, never a rewrite). */
  note: string;
}

export type SqlDialect = 'tsql' | 'ansi' | 'unknown';

export interface SqlDialectClassification {
  dialect: SqlDialect;
  non_portable_constructs: NonPortableConstruct[];
}

// ---------------------------------------------------------------------------
// Pattern families
// ---------------------------------------------------------------------------

interface PatternFamily {
  construct: string;
  pattern: RegExp;
  suggested: string | null;
  note: string;
}

/** Function-token regex: token not embedded in a longer identifier. */
function tokenPattern(token: string): RegExp {
  if (token.startsWith('@@')) {
    return new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
  return new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])`, 'gi');
}

/** Postgres spellings for the single-source function table's tokens. */
const FUNCTION_EQUIVALENTS: Record<string, string | null> = {
  getdate: 'now()',
  getutcdate: "(now() AT TIME ZONE 'UTC')",
  sysdatetime: 'now()',
  newid: 'gen_random_uuid()',
  newsequentialid: null,
  suser_name: 'current_user',
  suser_sname: 'current_user',
  user_name: 'current_user',
  host_name: null,
  db_name: 'current_database()',
  app_name: "current_setting('application_name')",
  '@@spid': 'pg_backend_pid()',
  '@@servername': null,
};

/** The single-source function/global family, from the DB-pack detection table. */
const FUNCTION_FAMILY: PatternFamily[] = NON_PORTABLE_DEFAULT_FUNCTIONS.map((entry) => ({
  construct: entry.token,
  pattern: tokenPattern(entry.token),
  suggested: FUNCTION_EQUIVALENTS[entry.token] ?? null,
  note: entry.note,
}));

/** Code-side construct families the DB pack's default-detection never sees. */
const CODE_SIDE_FAMILIES: PatternFamily[] = [
  // --- further T-SQL functions common in inline code SQL ---
  {
    construct: 'dateadd',
    pattern: tokenPattern('dateadd'),
    suggested: 'date/interval arithmetic (`ts + interval \'…\'`)',
    note: 'T-SQL dateadd(part, n, d) -> Postgres d + (n * interval \'1 part\')',
  },
  {
    construct: 'datediff',
    pattern: tokenPattern('datediff'),
    suggested: 'age()/extract(epoch from …) arithmetic',
    note: 'T-SQL datediff(part, a, b) -> Postgres extract/age arithmetic (semantics differ: T-SQL counts boundaries)',
  },
  {
    construct: 'datepart',
    pattern: tokenPattern('datepart'),
    suggested: 'extract(part from …)',
    note: 'T-SQL datepart(part, d) -> Postgres extract(part FROM d)',
  },
  {
    construct: 'convert',
    pattern: /(?<![A-Za-z0-9_])convert\s*\(/gi,
    suggested: 'CAST(x AS type) / to_char(...)',
    note: 'T-SQL convert(type, x[, style]) -> Postgres CAST / to_char with an explicit format',
  },
  {
    construct: 'isnull',
    pattern: tokenPattern('isnull'),
    suggested: 'coalesce(a, b)',
    note: 'T-SQL isnull(a, b) -> Postgres coalesce(a, b)',
  },
  {
    construct: 'charindex',
    pattern: tokenPattern('charindex'),
    suggested: 'position(needle IN haystack) / strpos(haystack, needle)',
    note: 'T-SQL charindex(needle, haystack) -> Postgres strpos(haystack, needle) (ARG ORDER FLIPS)',
  },
  {
    construct: 'stuff',
    pattern: tokenPattern('stuff'),
    suggested: 'overlay(s placing r from n for m)',
    note: 'T-SQL stuff(s, n, m, r) -> Postgres overlay(...)',
  },
  {
    construct: 'patindex',
    pattern: tokenPattern('patindex'),
    suggested: 'position() with regexp / similar to',
    note: 'T-SQL patindex has no direct Postgres equivalent — regexp functions approximate',
  },
  {
    construct: 'str',
    pattern: /(?<![A-Za-z0-9_])str\s*\(/gi,
    suggested: 'to_char(n, format)',
    note: 'T-SQL str(n, len, dec) -> Postgres to_char with an explicit numeric format',
  },
  // --- globals ---
  {
    construct: '@@identity',
    pattern: /@@identity/gi,
    suggested: 'RETURNING id / lastval()',
    note: 'T-SQL @@identity -> Postgres INSERT … RETURNING (preferred) or lastval()',
  },
  {
    construct: '@@rowcount',
    pattern: /@@rowcount/gi,
    suggested: 'GET DIAGNOSTICS … ROW_COUNT / driver update count',
    note: 'T-SQL @@rowcount -> Postgres ROW_COUNT diagnostics (JDBC executeUpdate return preferred in code)',
  },
  {
    construct: '@@error',
    pattern: /@@error/gi,
    suggested: 'exception handling (BEGIN … EXCEPTION)',
    note: 'T-SQL @@error -> Postgres exception blocks; no ambient error variable',
  },
  {
    construct: '@@trancount',
    pattern: /@@trancount/gi,
    suggested: null,
    note: 'T-SQL @@trancount has no Postgres equivalent (no nested transaction counter; savepoints differ)',
  },
  // --- lock hints ---
  {
    construct: 'HOLDLOCK',
    pattern: tokenPattern('holdlock'),
    suggested: 'SELECT … FOR UPDATE / isolation-level review',
    note: 'Sybase HOLDLOCK does not map onto Postgres MVCC — review the locking intent (FOR UPDATE / SERIALIZABLE)',
  },
  {
    construct: 'NOLOCK',
    pattern: tokenPattern('nolock'),
    suggested: 'remove (MVCC reads are non-blocking)',
    note: 'NOLOCK/READUNCOMMITTED is a no-op need under Postgres MVCC — remove the hint',
  },
  {
    construct: 'READPAST',
    pattern: tokenPattern('readpast'),
    suggested: 'SELECT … FOR UPDATE SKIP LOCKED',
    note: 'T-SQL READPAST -> Postgres FOR UPDATE SKIP LOCKED',
  },
  {
    construct: 'UPDLOCK',
    pattern: tokenPattern('updlock'),
    suggested: 'SELECT … FOR UPDATE',
    note: 'T-SQL UPDLOCK -> Postgres SELECT … FOR UPDATE',
  },
  // --- legacy joins ---
  {
    construct: 'legacy_outer_join',
    pattern: /\*=|=\*/g,
    suggested: 'ANSI LEFT/RIGHT JOIN',
    note: 'Sybase legacy outer join (*= / =*) -> ANSI JOIN syntax (semantics can differ on filters)',
  },
  // --- TOP (with or without parens) ---
  {
    construct: 'TOP',
    pattern: /(?<![A-Za-z0-9_])top\s*\(?\s*\d+\s*\)?/gi,
    suggested: 'LIMIT n',
    note: 'T-SQL TOP n -> Postgres LIMIT n (ORDER BY required for determinism)',
  },
  // --- temp tables + SELECT INTO # ---
  {
    construct: 'select_into_temp',
    pattern: /select\b[\s\S]{0,200}?\binto\s+#[A-Za-z_][A-Za-z0-9_]*/gi,
    suggested: 'CREATE TEMP TABLE … AS SELECT',
    note: 'Sybase SELECT … INTO #tmp -> Postgres CREATE TEMP TABLE … AS SELECT',
  },
  {
    construct: 'temp_table',
    pattern: /#[A-Za-z_][A-Za-z0-9_]*/g,
    suggested: 'CREATE TEMP TABLE (session-scoped)',
    note: 'Sybase #temp table -> Postgres TEMP TABLE (lifetime + visibility semantics differ)',
  },
  // --- procedural / misc ---
  {
    construct: 'RAISERROR',
    pattern: tokenPattern('raiserror'),
    suggested: 'RAISE EXCEPTION',
    note: 'T-SQL RAISERROR -> Postgres RAISE (severity model differs)',
  },
  {
    construct: 'PRINT',
    pattern: /(?<![A-Za-z0-9_])print\s+/gi,
    suggested: 'RAISE NOTICE',
    note: 'T-SQL PRINT -> Postgres RAISE NOTICE',
  },
  {
    construct: 'SET_ROWCOUNT',
    pattern: /set\s+rowcount\s+\d+/gi,
    suggested: 'LIMIT n on the statement',
    note: 'Sybase SET ROWCOUNT n -> per-statement LIMIT (no session-scoped row cap in Postgres)',
  },
  {
    construct: 'EXEC',
    pattern: /(?<![A-Za-z0-9_])exec(?:ute)?\s+[A-Za-z_#[\]][\w.#[\]$]*/gi,
    suggested: 'CALL proc(...) / SELECT function(...)',
    note: 'T-SQL EXEC proc -> Postgres CALL (procedures) or SELECT (functions) — signature review required',
  },
  {
    construct: 'sp_prefix_proc',
    pattern: /(?<![A-Za-z0-9_])(?:sp|xp)_[A-Za-z0-9_]+/gi,
    suggested: null,
    note: 'sp_/xp_ system-procedure conventions are engine-specific — map to Postgres catalog/functions case by case',
  },
];

const ALL_FAMILIES: PatternFamily[] = [...FUNCTION_FAMILY, ...CODE_SIDE_FAMILIES];

/** SQL-ish keyword gate: a text with none of these is fragmentary/dynamic. */
const SQL_KEYWORD_REGEX =
  /\b(select|insert|update|delete|exec|execute|call|merge|from|into|create|alter|drop)\b/i;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify one SQL text. `tsql` iff ≥1 non-portable construct matched;
 * `unknown` when the text carries no recognisable SQL keyword (dynamic /
 * fragmentary — concatenated Java expressions, bare identifiers); `ansi`
 * otherwise. Constructs are de-duplicated per (construct, position).
 */
export function classifySqlDialect(sql: string | null | undefined): SqlDialectClassification {
  const text = (sql ?? '').trim();
  if (text.length === 0 || !SQL_KEYWORD_REGEX.test(text)) {
    return { dialect: 'unknown', non_portable_constructs: [] };
  }

  const constructs: NonPortableConstruct[] = [];
  const seen = new Set<string>();
  for (const family of ALL_FAMILIES) {
    family.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = family.pattern.exec(text)) !== null) {
      const key = `${family.construct}@${match.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        constructs.push({
          construct: family.construct,
          matched_text: match[0],
          position: match.index,
          suggested_equivalent: family.suggested,
          note: family.note,
        });
      }
      if (match.index === family.pattern.lastIndex) family.pattern.lastIndex += 1;
    }
  }

  // A temp_table hit inside a select_into_temp span is the same evidence —
  // drop the narrower duplicate at the contained position.
  const intoSpans = constructs
    .filter((c) => c.construct === 'select_into_temp')
    .map((c) => [c.position, c.position + c.matched_text.length] as const);
  const deduped = constructs.filter(
    (c) =>
      c.construct !== 'temp_table' ||
      !intoSpans.some(([start, end]) => c.position >= start && c.position < end),
  );

  deduped.sort((a, b) => a.position - b.position);
  return {
    dialect: deduped.length > 0 ? 'tsql' : 'ansi',
    non_portable_constructs: deduped,
  };
}

// ---------------------------------------------------------------------------
// Proc-call extraction + matching (§2)
// ---------------------------------------------------------------------------

/** Normalise a proc reference: strip brackets/quotes + `dbo.` schema, lowercase. */
export function normalizeProcName(raw: string): string {
  const cleaned = raw.replace(/[[\]"'`]/g, '').trim();
  const parts = cleaned.split('.');
  const bare = parts[parts.length - 1] ?? cleaned;
  return bare.toLowerCase();
}

/**
 * Extract candidate proc names from a SQL/Java text: `EXEC x` / `EXECUTE x`,
 * JDBC escape `{call x(...)}`, and bare `CALL x`. Returns VERBATIM names
 * (schema-qualified as written) deduplicated in first-seen order.
 */
export function extractProcCallNames(text: string | null | undefined): string[] {
  const input = text ?? '';
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined): void => {
    const trimmed = (name ?? '').trim().replace(/[(;,].*$/, '');
    if (!trimmed) return;
    const key = normalizeProcName(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  // The exec arm tolerates the Sybase RETURN-STATUS form `exec @rc = proc`
  // (Spec 1, 2026-09-09 — mirrors the SCL emitter's PROC_CALL_RE; without
  // it `proc_call_unmatched` under-reported on exactly that idiom).
  const execRe = /(?<![A-Za-z0-9_])exec(?:ute)?\s+(?:@[A-Za-z0-9_]+\s*=\s*)?([A-Za-z_[][\w.$[\]]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = execRe.exec(input)) !== null) push(match[1]);

  const jdbcCallRe = /\{\s*\??\s*=?\s*call\s+([A-Za-z_[][\w.$[\]]*)/gi;
  while ((match = jdbcCallRe.exec(input)) !== null) push(match[1]);

  const bareCallRe = /(?<![A-Za-z0-9_{])call\s+([A-Za-z_[][\w.$[\]]*)/gi;
  while ((match = bareCallRe.exec(input)) !== null) push(match[1]);

  return out;
}

export interface ProcMatchResult {
  /** Proc names (verbatim) that matched the inventory, with the inventory name. */
  matched: Array<{ verbatim: string; inventoryName: string }>;
  /** Proc names (verbatim) with NO inventory match — never silent. */
  unmatched: string[];
}

/**
 * Match extracted proc names against the discovered proc inventory
 * (case-insensitive, schema-tolerant: `dbo.x` ≡ `x`).
 */
export function matchProcCalls(
  verbatimNames: string[],
  procInventory: Iterable<string>,
): ProcMatchResult {
  const inventoryByKey = new Map<string, string>();
  for (const name of procInventory) {
    inventoryByKey.set(normalizeProcName(name), name);
  }
  const matched: ProcMatchResult['matched'] = [];
  const unmatched: string[] = [];
  for (const verbatim of verbatimNames) {
    const hit = inventoryByKey.get(normalizeProcName(verbatim));
    if (hit !== undefined) {
      matched.push({ verbatim, inventoryName: hit });
    } else {
      unmatched.push(verbatim);
    }
  }
  return { matched, unmatched };
}
