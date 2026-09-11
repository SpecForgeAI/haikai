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

import { IrColumn, PackDecisionCategory } from './types';

export const TYPE_MAPPING_VERSION = 'v1';

/** Source engines the deterministic type table knows (pack code, Spec 5.2). */
export type SourceEngineKey = 'sybase' | 'mssql' | string;

/**
 * A no-like-for-like COLUMN feature that maps to a deterministic DEFAULT
 * target type AND raises its own pack decision (Spec 5.5, item 5). The type
 * is emitted so the pack is runnable; the OPEN decision blocks Migrate until
 * the owner confirms the default or picks an alternative — never a silent
 * choice, never a manual-residue halt.
 */
export interface TypeFeatureDecision {
  category: PackDecisionCategory;
  /** Stable decision-key prefix: `<keyPrefix>--<schema.table.column>`. */
  keyPrefix: string;
  options: string[];
  /** The option the default `postgresType` corresponds to. */
  defaultOption: string;
  /** Target type per option; `null` = the column is dropped. */
  typeByOption: Record<string, string | null>;
  question: string;
  /** Target-side extension the runbook must state as a prerequisite. */
  prerequisite: string | null;
  /** Ruleset divergence_class the citation is looked up by (never a rule id literal). */
  divergenceClass: string;
}

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
      /**
       * Sub-microsecond source precision that the target cannot hold
       * (`datetime2(7)` / `time(7)` / `datetimeoffset(7)`): the manifest
       * flags every such column, the loader truncates (never rounds), and
       * the pair rule governs parity. Absent on lossless mappings.
       */
      precisionLoss?: string | null;
      /** A feature decision raised ALONGSIDE the default mapping (item 5). */
      featureDecision?: TypeFeatureDecision | null;
    }
  | {
      kind: 'needs_decision';
      question: string;
      options: string[];
      /** Non-`type_mapping` decision bucket when the feature has its own. */
      category?: PackDecisionCategory;
      keyPrefix?: string;
    };

// ---------------------------------------------------------------------------
// Source-type parsing
// ---------------------------------------------------------------------------

/**
 * Parse `varchar(50)` / `numeric(10,2)` into base + numeric args.
 *
 * `(max)` (SQL Server's unbounded LOB spelling, 2026-09-11) parses as the
 * arg `-1` — the same sentinel `sys.columns.max_length` uses — so a
 * `varchar(max)` column is recognised as a `varchar` with an unbounded
 * length rather than falling through to the unlisted-type branch. ASE has no
 * `(max)` spelling, so the Sybase table is unaffected.
 */
export function parseSourceType(raw: string): {
  base: string;
  args: number[];
} {
  const trimmed = (raw ?? '').trim().toLowerCase();
  const m = trimmed.match(/^([a-z_][a-z0-9_ ]*?)\s*\(\s*(max|[0-9]+(?:\s*,\s*[0-9]+)?)\s*\)$/);
  if (!m) {
    return { base: trimmed, args: [] };
  }
  if (m[2] === 'max') {
    return { base: m[1].trim(), args: [-1] };
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

/** `sql_variant` — one column holding values of several types (Spec 5.5). */
export const SQL_VARIANT_OPTIONS = ['jsonb', 'text', 'drop_column'];
/** `hierarchyid` — the ltree extension, or the raw string path. */
export const HIERARCHYID_OPTIONS = ['ltree', 'text'];
/** `geography` / `geometry` — PostGIS, WKT text, or dropped. */
export const SPATIAL_OPTIONS = ['postgis', 'wkt_text', 'drop_column'];

/** The sub-microsecond loss note every p=7 temporal column carries. */
export const PRECISION_LOSS_100NS = 'precision_loss: 100ns -> 1us';

/**
 * SQL Server's declared default fractional-seconds precision for the
 * `datetime2` / `time` / `datetimeoffset` family when the DDL omits `(p)`.
 * The engine default is 7 — so an omitted `(p)` is LOSSY, not lossless, and
 * must be flagged exactly like an explicit `(7)`.
 */
const MSSQL_DEFAULT_FRACTIONAL_PRECISION = 7;

/**
 * Map one source column type to its deterministic PostgreSQL type, or a
 * `needs_decision` when the table cannot answer. Length/precision/scale are
 * taken from the parsed inline `(n[,m])` first, then the attribute's
 * `maxLength`/`precision`/`scale` columns (verbatim from discovery).
 *
 * ENGINE-KEYED (Spec 5.2, 2026-09-11): `sybase` is the original v1 table,
 * byte-for-byte unchanged (the ASE corpus is the regression gate); `mssql`
 * is the SQL Server 2022 table. An unknown engine falls back to the ASE
 * table — the caller has already been gated by
 * `GENERATOR_SUPPORTED_SOURCE_ENGINES`.
 */
export function mapSourceType(
  engine: SourceEngineKey,
  column: {
    dataType: string;
    maxLength: number | null;
    precision: number | null;
    scale: number | null;
  },
): TypeMappingResult {
  const { base, args } = parseSourceType(column.dataType);
  const length = args.length >= 1 ? args[0] : column.maxLength;
  const precision = args.length >= 1 ? args[0] : column.precision;
  const scale = args.length >= 2 ? args[1] : column.scale;

  const withLength = (pgBase: string): string =>
    length !== null && length !== undefined && Number.isFinite(length)
      ? `${pgBase}(${length})`
      : pgBase;

  if (String(engine ?? '').toLowerCase() === 'mssql') {
    return mapMssqlType(column, base, args, length, precision, scale, withLength);
  }

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
      // NEVER emit bare `char` (2026-08-12): PostgreSQL defines it as
      // char(1), so a column whose recorded length was lost silently
      // truncates to one character — the live 3-table
      // `value too long for type character(1)` load-failure class (8
      // length-stripped char columns each). An unknown width is a
      // DECISION, not a guess.
      if (length === null || length === undefined || !Number.isFinite(length)) {
        return {
          kind: 'needs_decision',
          question:
            `Column type '${column.dataType}' carries no length, and PostgreSQL treats a ` +
            `bare 'char' as char(1) — a silently-truncating guess the generator refuses to ` +
            `make. Recover the real width from the live source (re-run the DB schema ` +
            `harvest for this table, or probe max(datalength(<col>))) and specify the ` +
            `target type (specify_target_type with resolution_json.target_type, e.g. ` +
            `'char(8)' — or 'text' to accept unpadded semantics), or drop the column ` +
            `(drop_column).`,
          options: UNLISTED_TYPE_OPTIONS,
        };
      }
      return mapped(withLength('char'));
    case 'varchar':
    case 'nvarchar':
    case 'univarchar':
    case 'sysname':
      // Bare `varchar` is SAFE on PostgreSQL (unlimited length) — note the
      // lost source width instead of failing.
      if (length === null || length === undefined || !Number.isFinite(length)) {
        return mapped(
          'varchar',
          `${base} -> varchar (UNBOUNDED): the source length was not recorded; ` +
            `unlimited on the target, so no value can truncate`,
        );
      }
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
// SQL Server 2022 (16.x) -> PostgreSQL 18 type table (Spec 5.2)
// ---------------------------------------------------------------------------

/** `varchar(max)` / `nvarchar(max)` / `varbinary(max)` parse as a bare base. */
function isMaxLength(rawDataType: string): boolean {
  return /\(\s*max\s*\)\s*$/i.test(String(rawDataType ?? '').trim());
}

/** min(p, 6) with the engine default (7) standing in for an omitted `(p)`. */
function fractionalPrecision(explicit: number | null): { p: number; lossy: boolean } {
  const declared =
    explicit !== null && explicit !== undefined && Number.isFinite(explicit)
      ? explicit
      : MSSQL_DEFAULT_FRACTIONAL_PRECISION;
  return { p: Math.min(declared, 6), lossy: declared > 6 };
}

function mapMssqlType(
  column: { dataType: string; maxLength: number | null; precision: number | null; scale: number | null },
  base: string,
  args: number[],
  length: number | null,
  precision: number | null,
  scale: number | null,
  withLength: (pgBase: string) => string,
): TypeMappingResult {
  const colRefHint = column.dataType;
  const mapped = (
    postgresType: string,
    castNote: string | null = null,
    extra?: { precisionLoss?: string | null; featureDecision?: TypeFeatureDecision | null },
  ): TypeMappingResult => ({
    kind: 'mapped',
    postgresType,
    castNote,
    ...(extra?.precisionLoss ? { precisionLoss: extra.precisionLoss } : {}),
    ...(extra?.featureDecision ? { featureDecision: extra.featureDecision } : {}),
  });
  const explicitArg = args.length >= 1 ? args[0] : null;
  const max = isMaxLength(column.dataType) || length === -1;

  switch (base) {
    case 'int':
    case 'integer':
      return mapped('integer');
    case 'smallint':
      return mapped('smallint');
    case 'tinyint':
      // SQL Server tinyint is UNSIGNED 0..255; Postgres has no 1-byte integer.
      return mapped(
        'smallint',
        'tinyint -> smallint (Postgres has no unsigned 1-byte integer; the 0..255 domain still fits)',
      );
    case 'bigint':
      return mapped('bigint');
    case 'bit':
      return mapped('boolean', 'bit -> boolean: extract with CAST(<col> AS int); 0/1 are valid Postgres boolean literals');
    case 'numeric':
    case 'decimal': {
      if (precision !== null && precision !== undefined && Number.isFinite(precision)) {
        const s = scale !== null && scale !== undefined && Number.isFinite(scale) ? scale : 0;
        return mapped(`numeric(${precision},${s})`);
      }
      return mapped('numeric');
    }
    case 'money':
      return mapped(
        'numeric(19,4)',
        'money -> numeric(19,4): extract with CONVERT(numeric(19,4), <col>)',
      );
    case 'smallmoney':
      return mapped(
        'numeric(10,4)',
        'smallmoney -> numeric(10,4): extract with CONVERT(numeric(10,4), <col>)',
      );
    case 'float':
      // SQL Server float(n): n <= 24 is single precision, 25..53 is double.
      if (explicitArg !== null && explicitArg <= 24) {
        return mapped('real', `float(${explicitArg}) -> real (n <= 24 is 4-byte single precision on SQL Server)`);
      }
      return mapped('double precision');
    case 'real':
      return mapped('real');
    case 'char':
    case 'nchar':
      // NEVER emit bare `char`: PostgreSQL defines it as char(1), so a lost
      // width silently truncates to one character.
      if (length === null || length === undefined || !Number.isFinite(length)) {
        return {
          kind: 'needs_decision',
          question:
            `Column type '${colRefHint}' carries no length, and PostgreSQL treats a bare 'char' ` +
            `as char(1) — a silently-truncating guess the generator refuses to make. Recover the ` +
            `real width from the live source (re-run the DB schema harvest for this table, or ` +
            `probe MAX(DATALENGTH(<col>))) and specify the target type (specify_target_type with ` +
            `resolution_json.target_type, e.g. 'char(8)' — or 'text' to accept unpadded ` +
            `semantics), or drop the column (drop_column).`,
          options: UNLISTED_TYPE_OPTIONS,
        };
      }
      return mapped(
        withLength('char'),
        base === 'nchar'
          ? 'nchar(n) -> char(n): UTF-16 source characters load as UTF-8 (the declared width is in CHARACTERS on both sides)'
          : null,
      );
    case 'varchar':
    case 'nvarchar':
    case 'sysname':
      if (base === 'sysname') {
        // sysname is the catalog's alias for nvarchar(128) NOT NULL.
        return mapped('varchar(128)', 'sysname -> varchar(128) (the SQL Server catalog alias for nvarchar(128))');
      }
      if (max) {
        return mapped('text', `${base}(max) -> text (unbounded on the target)`);
      }
      if (length === null || length === undefined || !Number.isFinite(length)) {
        return mapped(
          'varchar',
          `${base} -> varchar (UNBOUNDED): the source length was not recorded; ` +
            `unlimited on the target, so no value can truncate`,
        );
      }
      return mapped(
        withLength('varchar'),
        base === 'nvarchar'
          ? 'nvarchar(n) -> varchar(n): UTF-16 source characters load as UTF-8 (declared width is in CHARACTERS on both sides)'
          : null,
      );
    case 'text':
    case 'ntext':
      return mapped('text', `${base} -> text (the SQL Server type is deprecated; text is unbounded on the target)`);
    case 'image':
    case 'binary':
    case 'varbinary':
      return mapped(
        'bytea',
        `${base} -> bytea: extract as '\\x' + LOWER(CONVERT(varchar(max), <col>, 2)) ` +
          `(the Postgres bytea hex text form)`,
      );
    case 'date':
      return mapped('date');
    case 'time': {
      const { p, lossy } = fractionalPrecision(explicitArg);
      return mapped(
        `time(${p})`,
        `time(${lossy ? 7 : p}) -> time(${p}): extract with CONVERT(varchar(27), <col>, 121)`,
        { precisionLoss: lossy ? PRECISION_LOSS_100NS : null },
      );
    }
    case 'datetime':
      // SQL Server datetime is 1/300s (.000/.003/.007) — millisecond-shaped.
      return mapped(
        'timestamp(3)',
        'datetime -> timestamp(3) without time zone: zoneless wall-clock, like-for-like; ' +
          'extract with CONVERT(varchar(27), <col>, 121) (ISO 8601)',
      );
    case 'smalldatetime':
      return mapped(
        'timestamp(0)',
        'smalldatetime -> timestamp(0) without time zone (minute precision on the source); ' +
          'extract with CONVERT(varchar(27), <col>, 121)',
      );
    case 'datetime2': {
      const { p, lossy } = fractionalPrecision(explicitArg);
      return mapped(
        `timestamp(${p})`,
        `datetime2(${lossy ? 7 : p}) -> timestamp(${p}) without time zone; ` +
          `extract with CONVERT(varchar(27), <col>, 121)`,
        { precisionLoss: lossy ? PRECISION_LOSS_100NS : null },
      );
    }
    case 'datetimeoffset': {
      const { p, lossy } = fractionalPrecision(explicitArg);
      return mapped(
        `timestamptz(${p})`,
        `datetimeoffset(${lossy ? 7 : p}) -> timestamptz(${p}): the value is an INSTANT ` +
          `(offset-normalised); extract with CONVERT(varchar(34), <col>, 127)`,
        { precisionLoss: lossy ? PRECISION_LOSS_100NS : null },
      );
    }
    case 'uniqueidentifier':
      return mapped(
        'uuid',
        'uniqueidentifier -> uuid: extract with LOWER(CONVERT(char(36), <col>)) (Postgres renders uuid lowercase)',
      );
    case 'rowversion':
    case 'timestamp':
      // SQL Server `timestamp` / `rowversion` is an automatic row-change
      // marker, NOT a point in time — and Postgres has no auto-maintained
      // equivalent (xmin is not stable). NEVER guessed.
      return {
        kind: 'needs_decision',
        question:
          `SQL Server '${base}' has rowversion semantics (an automatic row-change marker), not a ` +
          `point in time. PostgreSQL has no auto-maintained equivalent (xmin is not stable across ` +
          `VACUUM FULL) — choose: map_to_bytea (preserve the raw 8 bytes), drop_column (the marker ` +
          `is engine-internal), or application_managed (the application supplies its own ` +
          `concurrency token).`,
        options: SYBASE_TIMESTAMP_OPTIONS,
      };
    case 'xml':
      return mapped(
        'xml',
        'xml -> xml: extract with CONVERT(nvarchar(max), <col>). The SQL Server XML METHODS ' +
          '(.value/.query/.nodes/.exist/.modify) and XML SCHEMA COLLECTIONs have no target ' +
          'equivalent — routines using them are queued as xml_method rewrite sites.',
      );
    case 'sql_variant':
      return mapped('jsonb', 'sql_variant -> jsonb: load form {"type": <base type>, "value": <text>}', {
        featureDecision: {
          category: 'sql_variant_column',
          keyPrefix: 'sql_variant_column',
          options: SQL_VARIANT_OPTIONS,
          defaultOption: 'jsonb',
          typeByOption: { jsonb: 'jsonb', text: 'text', drop_column: null },
          prerequisite: null,
          divergenceClass: 'sql_variant',
          question:
            `Column type 'sql_variant' holds values of DIFFERENT types in one column and has no ` +
            `PostgreSQL equivalent. The generator's default is jsonb, which preserves both the ` +
            `value and its source type ({"type": <base type>, "value": <text>}) so ` +
            `SQL_VARIANT_PROPERTY() reads become jsonb accessors. Alternatives: text (the value ` +
            `only — the source TYPE is lost) or drop_column. Confirm the default or choose.`,
        },
      });
    case 'hierarchyid':
      return mapped('ltree', "hierarchyid -> ltree: extract with <col>.ToString() ('/1/2/'); '/'-paths convert to '.'-labels", {
        featureDecision: {
          category: 'hierarchyid_column',
          keyPrefix: 'hierarchyid_column',
          options: HIERARCHYID_OPTIONS,
          defaultOption: 'ltree',
          typeByOption: { ltree: 'ltree', text: 'text' },
          prerequisite: 'ltree',
          divergenceClass: 'hierarchyid',
          question:
            `Column type 'hierarchyid' is a SQL-Server-only materialised tree path. The ` +
            `generator's default maps it to ltree (the 'ltree' extension MUST be installed on ` +
            `the target) so GetAncestor / GetDescendant / IsDescendantOf / GetLevel become ltree ` +
            `operators (subpath, @>, <@, nlevel). The alternative is text — the path survives as ` +
            `a string, but every hierarchy query moves into the application. Confirm the default ` +
            `or choose text.`,
        },
      });
    case 'geography':
    case 'geometry':
      return mapped(base, `${base} -> PostGIS ${base}: extract as WKT (<col>.STAsText()) with the SRID (<col>.STSrid); load with ST_GeomFromText(wkt, srid)`, {
        featureDecision: {
          category: 'spatial_column',
          keyPrefix: 'spatial_column',
          options: SPATIAL_OPTIONS,
          defaultOption: 'postgis',
          typeByOption: { postgis: base, wkt_text: 'text', drop_column: null },
          prerequisite: 'postgis',
          divergenceClass: 'spatial',
          question:
            `Column type '${base}' is a SQL Server spatial type. The generator's default keeps ` +
            `spatial semantics by mapping it to the PostGIS ${base} type — POSTGIS MUST BE ` +
            `INSTALLED on the target PostgreSQL 18 instance before this table can be created ` +
            `(a loud runbook prerequisite, not an optional extra), and STDistance / STIntersects ` +
            `/ STArea become ST_Distance / ST_Intersects / ST_Area. Alternatives: wkt_text (the ` +
            `geometry survives as WKT text — every spatial predicate moves into the application) ` +
            `or drop_column. Confirm the default or choose.`,
        },
      });
    default:
      return {
        kind: 'needs_decision',
        question:
          `Source type '${colRefHint}' is not in the deterministic SQL Server -> PostgreSQL ` +
          `mapping table. A user-defined ALIAS type resolves to its base type during the scan, ` +
          `so an unlisted name here is either a CLR user-defined type or a scan gap. The ` +
          `generator never guesses — specify the target type (specify_target_type with ` +
          `resolution_json.target_type) or drop the column (drop_column).`,
        options: UNLISTED_TYPE_OPTIONS,
      };
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
const SAFE_DEFAULT_REWRITES: ReadonlyArray<{ token: string; replacement: string; note?: string }> = [
  { token: 'getdate', replacement: 'now()' },
  { token: 'getutcdate', replacement: "(now() AT TIME ZONE 'UTC')" },
  { token: 'sysdatetime', replacement: 'now()' },
  { token: 'db_name', replacement: 'current_database()' },
  { token: 'suser_name', replacement: 'current_user' },
  { token: 'suser_sname', replacement: 'current_user' },
  { token: 'user_name', replacement: 'current_user' },
  // SQL Server built-ins (Spec 5.2, 2026-09-11). Each has an EXACT
  // deterministic PostgreSQL equivalent; anything without one stays a
  // flagged decision, never a guess.
  { token: 'sysutcdatetime', replacement: "(now() AT TIME ZONE 'UTC')" },
  { token: 'sysdatetimeoffset', replacement: 'now()' },
  { token: 'current_timestamp', replacement: 'now()' },
  { token: 'newid', replacement: 'gen_random_uuid()' },
  {
    token: 'newsequentialid',
    replacement: 'gen_random_uuid()',
    // Stated, never silent: the target value is random, not sequential, so
    // index-locality (the only reason to choose NEWSEQUENTIALID) is lost.
    note:
      'newsequentialid() -> gen_random_uuid(): the target value is RANDOM, not sequential — ' +
      'the b-tree insert locality NEWSEQUENTIALID buys is NOT reproduced',
  },
  { token: 'host_name', replacement: 'inet_client_addr()::text' },
  { token: 'original_login', replacement: 'session_user' },
  { token: 'suser_id', replacement: 'current_user' },
  { token: 'schema_name', replacement: 'current_schema()' },
  { token: 'app_name', replacement: "current_setting('application_name', true)" },
];

/**
 * Global (non-call) source tokens with a SAFE deterministic equivalent —
 * `@@spid` has no parentheses, so the call-shaped rewriter above cannot see
 * it. Matched case-insensitively on a word boundary.
 */
const SAFE_DEFAULT_GLOBAL_REWRITES: ReadonlyArray<{ token: string; replacement: string }> = [
  { token: '@@spid', replacement: 'pg_backend_pid()' },
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
  const global = SAFE_DEFAULT_GLOBAL_REWRITES.find((s) => s.token === token);
  if (global) {
    const rewritten = stripWrappingParens(expr.trim()).replace(
      new RegExp(escapeRegExp(global.token), 'gi'),
      global.replacement,
    );
    return {
      kind: 'rewritten',
      expression: rewritten,
      note: `${global.token} -> ${global.replacement}`,
    };
  }
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
      note: safe.note ?? `${safe.token}() -> ${safe.replacement}`,
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
  // SQL Server additions (Spec 5.2). Each spelling below is EXACT in
  // PostgreSQL with the same argument order and semantics; anything whose
  // arguments would have to be re-ordered (CHARINDEX/STRPOS) or whose output
  // is locale-dependent (FORMAT) is deliberately absent, so it stays a
  // flagged decision rather than a silent behaviour change.
  concat: 'concat',
  concat_ws: 'concat_ws',
  nullif: 'nullif',
  substring: 'substring',
  replace: 'replace',
  left: 'left',
  right: 'right',
  ltrim: 'ltrim',
  rtrim: 'rtrim',
  floor: 'floor',
  ceiling: 'ceil',
  power: 'power',
  sqrt: 'sqrt',
  sign: 'sign',
  len: 'length',
  sysdatetime: 'now',
  // DELIBERATELY ABSENT: `datalength` (SQL Server counts BYTES - 2 per
  // character for nvarchar/UTF-16 - while octet_length counts UTF-8 bytes,
  // so the two disagree on every non-ASCII value) and `getutcdate` (now()
  // is LOCAL; the UTC form needs the AT TIME ZONE rewrite, which a 1:1
  // token rename cannot express). Both stay non-portable so the expression
  // reaches a human instead of changing meaning silently.
};

/**
 * `IIF(cond, a, b)` is SQL Server's inline conditional. It has no
 * PostgreSQL function spelling, but it has an EXACT structural equivalent —
 * `CASE WHEN cond THEN a ELSE b END` — so the deterministic translator
 * REWRITES it rather than punting the whole expression to a decision (the
 * gold standard: no manual residue where a deterministic answer exists).
 * Nested IIFs rewrite from the inside out; a call with anything other than
 * three top-level arguments is left alone and the caller's whitelist walker
 * then refuses it.
 */
export function rewriteIifCalls(expression: string): { expression: string; changed: boolean } {
  let text = String(expression ?? '');
  let changed = false;
  for (let guard = 0; guard < 64; guard += 1) {
    const m = /(^|[^A-Za-z0-9_])iif\s*\(/i.exec(text);
    if (!m) break;
    const callStart = m.index + m[1].length;
    const openParen = m.index + m[0].length - 1;
    // Walk to the matching ')' tracking string literals ('' is an escaped
    // quote), splitting the TOP level on commas.
    let depth = 0;
    let inString = false;
    const argStarts: number[] = [];
    const argEnds: number[] = [];
    let close = -1;
    for (let i = openParen; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (ch !== "'") continue;
        if (text[i + 1] === "'") {
          i += 1;
          continue;
        }
        inString = false;
        continue;
      }
      if (ch === "'") {
        inString = true;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        if (depth === 1) argStarts.push(i + 1);
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          argEnds.push(i);
          close = i;
          break;
        }
        continue;
      }
      if (ch === ',' && depth === 1) {
        argEnds.push(i);
        argStarts.push(i + 1);
      }
    }
    if (close < 0 || argStarts.length !== 3 || argEnds.length !== 3) break;
    const parts = argStarts.map((s, i) => text.slice(s, argEnds[i]).trim());
    const replacement = `CASE WHEN ${parts[0]} THEN ${parts[1]} ELSE ${parts[2]} END`;
    text = text.slice(0, callStart) + replacement + text.slice(close + 1);
    changed = true;
  }
  return { expression: text, changed };
}

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
  const expr = rewriteIifCalls(verbatimExpression.trim()).expression.trim();
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
  // SQL Server additions (Spec 5.2) — exact spellings only (see
  // COMPUTED_FN_TRANSLATIONS for why CHARINDEX / FORMAT are absent).
  concat: 'concat',
  concat_ws: 'concat_ws',
  nullif: 'nullif',
  substring: 'substring',
  replace: 'replace',
  left: 'left',
  right: 'right',
  power: 'power',
  sqrt: 'sqrt',
  sign: 'sign',
  sysdatetime: 'now',
  // See COMPUTED_FN_TRANSLATIONS for why `datalength` and `getutcdate` are
  // deliberately absent.
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
  // CASE arms: the IIF rewrite above produces them, and SQL Server CHECK /
  // filtered-index predicates carry them verbatim. Identical spelling and
  // semantics in PostgreSQL.
  'case',
  'when',
  'then',
  'else',
  'end',
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
  const iif = rewriteIifCalls(verbatimExpression.trim());
  const expr = iif.expression.trim();
  const tokens =
    expr.match(
      /[a-zA-Z_][a-zA-Z0-9_]*|[0-9]+(?:\.[0-9]+)?|'(?:[^']|'')*'|>=|<=|<>|!=|[-+*/(),.%=<>]|\S/g
    ) ?? [];
  if (tokens.length === 0) {
    return { kind: 'non_portable', reason: 'empty expression' };
  }

  const hasStringLiteral = tokens.some((t) => t.startsWith("'"));
  const parts: string[] = [];
  let changed = iif.changed;

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

// ---------------------------------------------------------------------------
// Pack-wide collation posture (Spec 5.4 / shaping item 2, owner ruling 5)
// ---------------------------------------------------------------------------

/**
 * The ONE pack-wide collation decision for an estate whose default collation
 * is case-INSENSITIVE (`_CI_`). Per-column decisions do not scale on an
 * estate where EVERY string column is CI: a single posture is chosen once
 * and applied to every affected column.
 */
export const PACK_COLLATION_DECISION_KEY = 'collation--database';

/** Options in owner-ruling order: citext default, ICU alternative, accept CS. */
export const PACK_COLLATION_OPTIONS = [
  'citext',
  'icu_nondeterministic',
  'accept_case_sensitive_change',
];

/** The recommended resolution when the source estate is case-insensitive. */
export const PACK_COLLATION_DEFAULT_OPTION = 'citext';

/** The ICU collation the `icu_nondeterministic` option creates and applies. */
export const ICU_COLLATION_NAME = 'haikai_ci';
export const ICU_COLLATION_DDL =
  `CREATE COLLATION IF NOT EXISTS ${ICU_COLLATION_NAME} ` +
  `(provider = icu, locale = 'und-u-ks-level2', deterministic = false);`;
export const ICU_COLLATION_RESTRICTION_NOTE =
  `Nondeterministic ICU collation '${ICU_COLLATION_NAME}' (locale und-u-ks-level2): LIKE, ` +
  `SIMILAR TO, regular-expression operators and pattern-matching indexes are NOT supported on ` +
  `columns declared with it (PostgreSQL refuses them on a nondeterministic collation). Every ` +
  `LIKE / regex predicate over an affected column must move to an explicit lower() comparison ` +
  `or a separate deterministic-collation expression index.`;

/** PostgreSQL types the citext option replaces (all character families). */
const CITEXT_REPLACEABLE = /^(?:var)?char(?:\(|$)|^text$/i;

/** TRUE when a mapped target type is a character type citext can replace. */
export function isCitextReplaceable(postgresType: string): boolean {
  return CITEXT_REPLACEABLE.test(String(postgresType ?? '').trim());
}

/**
 * The blank-padded width a `char(n)` column loses when it becomes `citext`
 * (citext is variable-length). Returns null for non-`char(n)` types — the
 * caller then emits no length CHECK.
 */
export function charWidthOf(postgresType: string): number | null {
  const m = /^char\s*\(\s*(\d+)\s*\)$/i.exec(String(postgresType ?? '').trim());
  return m ? Number(m[1]) : null;
}

export function packCollationDecisionQuestion(args: {
  databaseCollation: string | null;
  affectedColumnCount: number;
}): string {
  return (
    `The source database default collation (${args.databaseCollation ?? 'unknown'}) is ` +
    `case-INSENSITIVE, and ${args.affectedColumnCount} string column(s) rely on it for equality, ` +
    `GROUP BY, DISTINCT, JOIN and UNIQUE semantics. PostgreSQL collates case-SENSITIVELY by ` +
    `default, so a like-for-like migration would silently change all of them. Choose ONE posture ` +
    `for the whole pack: citext (RECOMMENDED — each affected column becomes the citext ` +
    `case-insensitive text type; LIKE, uniqueness and index behaviour are all preserved; the ` +
    `citext extension must be installed on the target, and a char(n) column also gains a length ` +
    `CHECK because citext is variable-length); icu_nondeterministic (a nondeterministic ICU ` +
    `collation '${ICU_COLLATION_NAME}' is created and applied — note that LIKE / regex / pattern ` +
    `operators are NOT supported on such columns); or accept_case_sensitive_change (the target ` +
    `becomes case-sensitive — comparison semantics change, on record).`
  );
}

export function collationDecisionQuestion(column: IrColumn): string {
  return (
    `Column ${column.schemaName}.${column.tableName}.${column.columnName} uses the ` +
    `case-INSENSITIVE source collation '${column.collation ?? 'unknown'}'. PostgreSQL ` +
    `collates case-SENSITIVELY by default — choose: citext (case-insensitive column type), ` +
    `expression_indexes_app_discipline (keep the mapped type; add lower() expression ` +
    `indexes and application discipline), or accept_case_sensitive_change.`
  );
}
