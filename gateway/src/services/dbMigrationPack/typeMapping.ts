/**
 * Fixed deterministic Sybase ASE -> PostgreSQL type-mapping table (v1).
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 2.3.
 *
 * RULES (spec "Fixed deterministic Sybase ASE → PostgreSQL type-mapping
 * table"):
 *   - The mapping list below is the EXACT spec table, versioned `v1`.
 *   - Identity columns -> `GENERATED ALWAYS AS IDENTITY` (handled by the
 *     emitter; the base type still maps here).
 *   - Ambiguous/unmappable types are NEVER guessed: Sybase `timestamp`
 *     (rowversion semantics), any type not in the table, and any column whose
 *     findings flag a hazard the mapping cannot neutralize each become a
 *     needs_decision with concrete options.
 *   - Computed columns translate to `GENERATED ALWAYS AS (expr) STORED` ONLY
 *     when the expression passes deterministic token translation; otherwise a
 *     `computed_column` needs_decision carries the verbatim Sybase expression.
 *   - Collation hazards -> `collation` needs_decision (citext | expression
 *     indexes + app discipline | accept case-sensitive change).
 *   - Non-portable defaults rewritten where a SAFE equivalent exists
 *     (`getdate()` -> `now()`); otherwise flagged.
 *
 * NO LLM — pure deterministic code.
 */

import { IrColumn } from './types';

export const TYPE_MAPPING_VERSION = 'v1';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type TypeMappingResult =
  | {
      kind: 'mapped';
      /** The full PostgreSQL type (e.g. `numeric(19,4)` / `varchar(50)`). */
      postgresType: string;
      /** Bulk-extract cast note aligned to this mapping (Group 3). */
      castNote: string | null;
    }
  | {
      kind: 'needs_decision';
      question: string;
      options: string[];
    };

// ---------------------------------------------------------------------------
// Source-type parsing
// ---------------------------------------------------------------------------

/** Parse `varchar(50)` / `numeric(10,2)` into base + numeric args. */
export function parseSourceType(raw: string): {
  base: string;
  args: number[];
} {
  const trimmed = (raw ?? '').trim().toLowerCase();
  const m = trimmed.match(/^([a-z_][a-z0-9_ ]*?)\s*\(\s*([0-9]+(?:\s*,\s*[0-9]+)?)\s*\)$/);
  if (!m) {
    return { base: trimmed, args: [] };
  }
  return {
    base: m[1].trim(),
    args: m[2].split(',').map((a) => parseInt(a.trim(), 10)),
  };
}

// ---------------------------------------------------------------------------
// The v1 mapping table — EXACTLY the spec list
// ---------------------------------------------------------------------------

/** Sybase `timestamp` is rowversion semantics, never a guessable mapping. */
export const SYBASE_TIMESTAMP_OPTIONS = [
  'map_to_bytea',
  'drop_column',
  'application_managed',
];

export const UNLISTED_TYPE_OPTIONS = ['specify_target_type', 'drop_column'];

/**
 * Map one source column type to its deterministic PostgreSQL type, or a
 * `needs_decision` when the v1 table cannot answer. Length/precision/scale
 * are taken from the parsed inline `(n[,m])` first, then the attribute's
 * `maxLength`/`precision`/`scale` columns (verbatim from discovery).
 */
export function mapSourceType(column: {
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
}): TypeMappingResult {
  const { base, args } = parseSourceType(column.dataType);
  const length = args.length >= 1 ? args[0] : column.maxLength;
  const precision = args.length >= 1 ? args[0] : column.precision;
  const scale = args.length >= 2 ? args[1] : column.scale;

  const withLength = (pgBase: string): string =>
    length !== null && length !== undefined && Number.isFinite(length)
      ? `${pgBase}(${length})`
      : pgBase;

  switch (base) {
    case 'int':
    case 'integer':
      return mapped('integer');
    case 'smallint':
      return mapped('smallint');
    case 'tinyint':
      return mapped('smallint', 'tinyint -> smallint (Postgres has no 1-byte integer)');
    case 'bigint':
      return mapped('bigint');
    case 'unsigned int':
      return mapped('bigint', 'unsigned int -> bigint (Postgres has no unsigned types)');
    case 'numeric':
    case 'decimal': {
      if (
        precision !== null &&
        precision !== undefined &&
        Number.isFinite(precision)
      ) {
        const s =
          scale !== null && scale !== undefined && Number.isFinite(scale)
            ? scale
            : 0;
        return mapped(`numeric(${precision},${s})`);
      }
      return mapped('numeric');
    }
    case 'money':
      return mapped('numeric(19,4)', 'money -> numeric(19,4): extract with convert(numeric(19,4), <col>)');
    case 'smallmoney':
      return mapped('numeric(10,4)', 'smallmoney -> numeric(10,4): extract with convert(numeric(10,4), <col>)');
    case 'float':
      return mapped('double precision');
    case 'real':
      return mapped('real');
    case 'bit':
      return mapped('boolean', "bit -> boolean: 0/1 are valid Postgres boolean COPY literals");
    case 'char':
    case 'nchar':
      return mapped(withLength('char'));
    case 'varchar':
    case 'nvarchar':
    case 'univarchar':
    case 'sysname':
      return mapped(withLength('varchar'));
    case 'text':
    case 'unitext':
      return mapped('text');
    case 'image':
      return mapped('bytea', 'image -> bytea: extract via bcp binary mode or hex-encode');
    case 'binary':
    case 'varbinary':
      return mapped('bytea', `${base} -> bytea: extract via bcp binary mode or hex-encode`);
    case 'datetime':
    case 'smalldatetime':
    case 'bigdatetime':
      // `timestamp` WITHOUT time zone (2026-08-11): ASE datetimes are
      // zoneless wall-clock values, and the load/parity wire carries them as
      // naive strings. The previous `timestamptz` mapping made PostgreSQL
      // re-interpret every naive insert in the SESSION time zone and render
      // it back offset-shifted — on a BST/GMT server that shifted every
      // summer-dated value one hour (the live 1000/1000 parity key-miss
      // class) while winter values passed. A zoneless source maps to the
      // zoneless target type; no session zone can then touch the value.
      return mapped(
        'timestamp',
        `${base} -> timestamp (without time zone): zoneless wall-clock, like-for-like; ` +
          `extract with convert(char(23), <col>, 23) (ISO 8601)`
      );
    case 'date':
      return mapped('date');
    case 'time':
    case 'bigtime':
      return mapped('time');
    case 'timestamp':
      // Sybase `timestamp` is a ROWVERSION, not a point in time — NEVER guess.
      return {
        kind: 'needs_decision',
        question:
          `Sybase 'timestamp' has rowversion semantics (an automatic row-change marker), ` +
          `not a point in time. There is no behavioural PostgreSQL equivalent — choose: ` +
          `map_to_bytea (preserve the raw value), drop_column (the marker is engine-internal), ` +
          `or application_managed (the application supplies its own concurrency token).`,
        options: SYBASE_TIMESTAMP_OPTIONS,
      };
    default:
      return {
        kind: 'needs_decision',
        question:
          `Source type '${column.dataType}' is not in the deterministic v1 ` +
          `Sybase ASE -> PostgreSQL mapping table. The generator never guesses — ` +
          `specify the target type (specify_target_type with resolution_json.target_type) ` +
          `or drop the column (drop_column).`,
        options: UNLISTED_TYPE_OPTIONS,
      };
  }

  function mapped(postgresType: string, castNote: string | null = null): TypeMappingResult {
    return { kind: 'mapped', postgresType, castNote };
  }
}

// ---------------------------------------------------------------------------
// Non-portable default rewriting — SAFE rewrites only, else flag
// ---------------------------------------------------------------------------

/**
 * Engine-specific default functions with a SAFE deterministic Postgres
 * equivalent. Anything detected as non-portable (via the finding) but NOT in
 * this table is flagged, never guessed. Tokens are matched with the same
 * word-boundary discipline as discovery's `detectNonPortableDefault`.
 */
const SAFE_DEFAULT_REWRITES: ReadonlyArray<{ token: string; replacement: string }> = [
  { token: 'getdate', replacement: 'now()' },
  { token: 'getutcdate', replacement: "(now() AT TIME ZONE 'UTC')" },
  { token: 'sysdatetime', replacement: 'now()' },
  { token: 'db_name', replacement: 'current_database()' },
  { token: 'suser_name', replacement: 'current_user' },
  { token: 'suser_sname', replacement: 'current_user' },
  { token: 'user_name', replacement: 'current_user' },
];

export const NON_PORTABLE_DEFAULT_OPTIONS = ['use_expression', 'drop_default'];

export type DefaultTranslationResult =
  | { kind: 'unchanged'; expression: string | null }
  | { kind: 'rewritten'; expression: string; note: string }
  | { kind: 'needs_decision'; question: string; options: string[] };

/**
 * Translate a column default. A `non_portable_default` finding (merged into
 * the IR) drives the decision: safe tokens are rewritten deterministically,
 * unsafe ones are flagged. A column with no non-portable finding keeps its
 * default verbatim (it is portable by detection).
 */
export function translateDefault(column: IrColumn): DefaultTranslationResult {
  const expr = column.defaultExpression;
  if (expr === null || expr === undefined || expr.trim() === '') {
    return { kind: 'unchanged', expression: null };
  }
  if (!column.nonPortableDefault) {
    return { kind: 'unchanged', expression: expr };
  }
  const token = column.nonPortableDefault.token.toLowerCase();
  const safe = SAFE_DEFAULT_REWRITES.find((s) => s.token === token);
  if (safe) {
    // Replace the token call (with optional parens / wrapping parens kept
    // out: the whole default collapses to the equivalent expression when the
    // default IS the call; otherwise rewrite the call in place).
    const callPattern = new RegExp(`${escapeRegExp(safe.token)}\\s*\\(\\s*\\)`, 'gi');
    const stripped = stripWrappingParens(expr.trim());
    let rewritten: string;
    if (callPattern.test(stripped) && stripped.replace(callPattern, '').trim() === '') {
      rewritten = safe.replacement;
    } else {
      rewritten = stripped.replace(
        new RegExp(`${escapeRegExp(safe.token)}\\s*\\(\\s*\\)`, 'gi'),
        safe.replacement
      );
    }
    return {
      kind: 'rewritten',
      expression: rewritten,
      note: `${safe.token}() -> ${safe.replacement}`,
    };
  }
  return {
    kind: 'needs_decision',
    question:
      `Column default '${expr}' uses the engine-specific built-in ` +
      `'${column.nonPortableDefault.token}' with no safe deterministic PostgreSQL ` +
      `equivalent (${column.nonPortableDefault.note}). Provide the target expression ` +
      `(use_expression with resolution_json.expression) or drop the default (drop_default).`,
    options: NON_PORTABLE_DEFAULT_OPTIONS,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripWrappingParens(expr: string): string {
  let e = expr.trim();
  while (e.startsWith('(') && e.endsWith(')')) {
    // Only strip when the parens actually wrap the whole expression.
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < e.length; i++) {
      if (e[i] === '(') depth++;
      else if (e[i] === ')') {
        depth--;
        if (depth === 0 && i < e.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

// ---------------------------------------------------------------------------
// Computed-column expression translation — deterministic token translation
// ---------------------------------------------------------------------------

export const COMPUTED_COLUMN_OPTIONS = [
  'provide_target_expression',
  'plain_column_populated_by_load',
  'drop_column',
];

/** Function tokens translatable 1:1 (lowercased). */
const COMPUTED_FN_TRANSLATIONS: Record<string, string> = {
  isnull: 'coalesce',
  getdate: 'now',
  upper: 'upper',
  lower: 'lower',
  abs: 'abs',
  round: 'round',
  coalesce: 'coalesce',
};

export type ComputedTranslationResult =
  | { kind: 'translated'; expression: string }
  | { kind: 'needs_decision'; question: string; options: string[] };

/**
 * Deterministic token translation of a Sybase computed-column expression.
 * The expression translates ONLY when every token is an identifier, numeric
 * literal, quoted string literal, arithmetic operator, comma, dot, paren, or
 * a whitelisted function name. Anything else (T-SQL built-ins, CASE, string
 * concatenation with `+` is allowed as arithmetic-ambiguous? NO — `+` over
 * strings differs cross-engine, so `+` is only allowed when no string
 * literal appears in the expression) becomes a `computed_column`
 * needs_decision carrying the verbatim Sybase expression.
 */
export function translateComputedExpression(
  verbatimExpression: string
): ComputedTranslationResult {
  const expr = verbatimExpression.trim();
  const tokens = expr.match(/[a-zA-Z_][a-zA-Z0-9_]*|[0-9]+(?:\.[0-9]+)?|'(?:[^']|'')*'|[-+*/(),.]|\S/g) ?? [];

  const hasStringLiteral = tokens.some((t) => t.startsWith("'"));
  let translated = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) {
      const isFunctionCall = tokens[i + 1] === '(';
      if (isFunctionCall) {
        const fn = COMPUTED_FN_TRANSLATIONS[t.toLowerCase()];
        if (!fn) {
          return needsDecision();
        }
        translated += fn;
      } else {
        // Bare identifier (column reference) — passes through verbatim.
        translated += t;
      }
    } else if (/^[0-9]+(\.[0-9]+)?$/.test(t) || t.startsWith("'")) {
      translated += t;
    } else if (['-', '*', '/', '(', ')', ',', '.'].includes(t)) {
      translated += t;
    } else if (t === '+') {
      if (hasStringLiteral) {
        // `+` over strings is T-SQL concatenation — NOT deterministic here.
        return needsDecision();
      }
      translated += t;
    } else {
      return needsDecision();
    }
    // Re-insert minimal spacing around operators for readability.
    if (t === ',') {
      translated = translated.slice(0, -1) + ', ';
    } else if (['-', '+', '*', '/'].includes(t)) {
      translated = translated.slice(0, -1) + ` ${t} `;
    }
  }
  return { kind: 'translated', expression: translated.replace(/\s+/g, ' ').trim() };

  function needsDecision(): ComputedTranslationResult {
    return {
      kind: 'needs_decision',
      question:
        `Computed-column expression '${verbatimExpression}' is not expressible by ` +
        `deterministic token translation. Provide the PostgreSQL generation expression ` +
        `(provide_target_expression with resolution_json.expression), keep a plain column ` +
        `populated by the data load (plain_column_populated_by_load), or drop the column ` +
        `(drop_column).`,
      options: COMPUTED_COLUMN_OPTIONS,
    };
  }
}

// ---------------------------------------------------------------------------
// Check-constraint expression translation — deterministic or skipped loudly
// ---------------------------------------------------------------------------

/**
 * Function tokens translatable 1:1 inside check expressions (lowercased).
 * Superset of the computed-column table: checks commonly wrap length/trim
 * style built-ins that have exact PostgreSQL spellings.
 */
const CHECK_FN_TRANSLATIONS: Record<string, string> = {
  isnull: 'coalesce',
  getdate: 'now',
  upper: 'upper',
  lower: 'lower',
  abs: 'abs',
  round: 'round',
  coalesce: 'coalesce',
  len: 'length',
  char_length: 'char_length',
  ltrim: 'ltrim',
  rtrim: 'rtrim',
  floor: 'floor',
  ceiling: 'ceil',
};

/**
 * Bare keywords allowed verbatim inside a check expression (lowercased).
 * Checked BEFORE the function-call rule so `status IN ('A','B')` is a list,
 * not a call to an unknown function `in`.
 */
const CHECK_KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'between',
  'like',
  'is',
  'null',
  'escape',
  'true',
  'false',
]);

export type CheckTranslationResult =
  | { kind: 'translated'; expression: string; changed: boolean }
  | { kind: 'non_portable'; reason: string };

/**
 * Deterministic token translation of a Sybase check-constraint expression,
 * mirroring `translateComputedExpression`'s conservative whitelist walker
 * (identifiers, literals, comparison/boolean operators, whitelisted function
 * names). The previous behaviour copied expressions VERBATIM into the DDL,
 * so any T-SQL built-in (datalength / isdate / convert / dateadd ...) failed
 * at schema-apply time. Now: portable expressions emit (with safe renames
 * like getdate()->now(), len()->length()); anything outside the whitelist is
 * NON-PORTABLE and the emitter SKIPS the constraint with a loud comment
 * carrying the verbatim source — never a guessed emission, never a silent
 * drop. T-SQL string concatenation (`+` with a string literal present) is
 * non-portable for the same reason as computed columns.
 */
export function translateCheckExpression(
  verbatimExpression: string
): CheckTranslationResult {
  const expr = verbatimExpression.trim();
  const tokens =
    expr.match(
      /[a-zA-Z_][a-zA-Z0-9_]*|[0-9]+(?:\.[0-9]+)?|'(?:[^']|'')*'|>=|<=|<>|!=|[-+*/(),.%=<>]|\S/g
    ) ?? [];
  if (tokens.length === 0) {
    return { kind: 'non_portable', reason: 'empty expression' };
  }

  const hasStringLiteral = tokens.some((t) => t.startsWith("'"));
  const parts: string[] = [];
  let changed = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) {
      if (CHECK_KEYWORDS.has(t.toLowerCase())) {
        parts.push(t);
        continue;
      }
      const isFunctionCall = tokens[i + 1] === '(';
      if (isFunctionCall) {
        const fn = CHECK_FN_TRANSLATIONS[t.toLowerCase()];
        if (!fn) {
          return { kind: 'non_portable', reason: `function '${t}'` };
        }
        if (fn !== t.toLowerCase()) changed = true;
        parts.push(`${fn}(`);
        i++; // consume the '('
        continue;
      }
      parts.push(t); // bare column reference — verbatim
      continue;
    }
    if (/^[0-9]+(\.[0-9]+)?$/.test(t) || t.startsWith("'")) {
      parts.push(t);
      continue;
    }
    if (t === '+') {
      if (hasStringLiteral) {
        return {
          kind: 'non_portable',
          reason: "string '+' concatenation (T-SQL semantics)",
        };
      }
      parts.push(t);
      continue;
    }
    if (
      ['-', '*', '/', '%', '(', ')', ',', '.', '=', '>', '<', '>=', '<=', '<>', '!='].includes(t)
    ) {
      parts.push(t);
      continue;
    }
    return { kind: 'non_portable', reason: `token '${t}'` };
  }

  // Join with spaces, then tighten punctuation. SQL correctness does not
  // depend on the spacing; this is for readable DDL.
  const joined = parts
    .join(' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',')
    .replace(/\s+\.\s+/g, '.');
  return { kind: 'translated', expression: joined, changed };
}

// ---------------------------------------------------------------------------
// Collation hazard — always a decision, never a silent default
// ---------------------------------------------------------------------------

export const COLLATION_OPTIONS = [
  'citext',
  'expression_indexes_app_discipline',
  'accept_case_sensitive_change',
];

export function collationDecisionQuestion(column: IrColumn): string {
  return (
    `Column ${column.schemaName}.${column.tableName}.${column.columnName} uses the ` +
    `case-INSENSITIVE source collation '${column.collation ?? 'unknown'}'. PostgreSQL ` +
    `collates case-SENSITIVELY by default — choose: citext (case-insensitive column type), ` +
    `expression_indexes_app_discipline (keep the mapped type; add lower() expression ` +
    `indexes and application discipline), or accept_case_sensitive_change.`
  );
}
