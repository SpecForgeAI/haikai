/**
 * Forward (load-time) value transform, driven by the migration-pair ruleset as
 * DATA. Applies ONLY the safe, non-lossy load actions and CITES each rule it
 * applies; every other rule is a RECONCILE-time tolerance that must never
 * mutate stored data (Spec Y §5).
 *
 * Load-time actions (faithful, non-lossy):
 *   - charset-normalize (NFC) on string values — the pair's STR/LOB rules;
 *   - bit -> boolean coercion — the pair's BIT rule (a type_nullability rule);
 *   - uuid-canonical lower-casing — the pair's UUID rule (text form is
 *     case-insensitive on the source, so this loses nothing);
 *   - the ONE cited lossy action: a `granularity_us` timestamp-truncate rule
 *     (100 ns source precision → microseconds) TRUNCATES the fraction on load
 *     so both sides share the canonical form (the loader never rounds).
 *
 * Deferred to the data-parity comparator (Spec P), NEVER applied on load:
 *   - timestamp-truncate (would destroy datetime precision),
 *   - numeric-rescale / numeric-epsilon (tolerances, not stored transforms),
 *   - string-rtrim (trailing spaces preserved; reconcile compares right-trimmed),
 *   - collation-case.
 */
import {
  MigrationPairRule,
  MigrationPairRuleset,
  activeRules,
  canonicalize,
} from '../../migrationPairRules';

export interface ForwardColumn {
  name: string;
  /** Source engine type (e.g. `datetime`, `varchar(50)`, `bit`). */
  sourceType: string;
}

export interface ForwardTransformResult {
  /** Values aligned positionally to the input `columns`. */
  values: unknown[];
  appliedRuleIds: string[];
}

/** Base type token: lowercased, sans length/precision and modifiers. */
function typeBase(t: string): string {
  return (t || '').trim().toLowerCase().split('(')[0].split(/\s+/)[0];
}

/**
 * Active rules applying to a source column type — INCLUDING guidance-only rules
 * (comparison: null), because bit->boolean coercion rides SYBPG.BIT.001 which
 * carries no comparison strategy. (Contrast rulesForColumnType, which the
 * comparator uses and which filters to comparison-bearing rules only.)
 */
function loadRulesForColumnType(
  ruleset: MigrationPairRuleset,
  sourceType: string,
): MigrationPairRule[] {
  const base = typeBase(sourceType);
  if (!base) return [];
  return activeRules(ruleset).filter((r) =>
    (r.applies_to?.column_types ?? []).some((t) => typeBase(t) === base),
  );
}

/** Cut a timestamp/time string's fraction to `digits` (truncation, never rounding). */
export function truncateFractionDigits(value: string, digits: number): string {
  const m = /^(.*?\d{2}:\d{2}:\d{2})\.(\d+)(.*)$/.exec(value);
  if (!m || m[2].length <= digits) return value;
  return `${m[1]}.${m[2].slice(0, digits)}${m[3]}`;
}

/** Case-insensitive row-value lookup (engines case-fold result keys differently). */
export function cellValue(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  const wanted = column.trim().toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.trim().toLowerCase() === wanted) return row[key];
  }
  return undefined;
}

/** Coerce a Sybase bit (0/1) to a Postgres boolean; ok:false when not coercible. */
function coerceBoolean(value: unknown): { ok: boolean; value: boolean | null } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'boolean') return { ok: true, value };
  if (value === 1 || value === '1' || value === 'true') return { ok: true, value: true };
  if (value === 0 || value === '0' || value === 'false') return { ok: true, value: false };
  return { ok: false, value: null };
}

/**
 * Transform one source row into the ordered target tuple for `columns`.
 * Missing source columns become null. With no ruleset (or no applicable rule),
 * values pass through unchanged — no transform is ever silent.
 */
export function forwardTransformRow(
  row: Record<string, unknown>,
  columns: ForwardColumn[],
  ruleset: MigrationPairRuleset | null,
): ForwardTransformResult {
  const values: unknown[] = [];
  const applied = new Set<string>();
  for (const col of columns) {
    let value = cellValue(row, col.name);
    if (value === undefined) value = null;
    if (ruleset) {
      for (const rule of loadRulesForColumnType(ruleset, col.sourceType)) {
        if (rule.comparison?.strategy === 'charset-normalize' && typeof value === 'string') {
          value = canonicalize(value, rule.comparison);
          applied.add(rule.id);
        } else if (rule.comparison?.strategy === 'uuid-canonical' && typeof value === 'string') {
          value = canonicalize(value, rule.comparison);
          applied.add(rule.id);
        } else if (
          (rule.comparison?.strategy === 'timestamp-truncate' || rule.comparison?.strategy === 'instant') &&
          typeof rule.comparison.params?.granularity_us === 'number' &&
          typeof value === 'string'
        ) {
          const cut = truncateFractionDigits(value, 6);
          if (cut !== value) {
            value = cut;
            applied.add(rule.id);
          }
        } else if (
          rule.divergence_class === 'type_nullability' &&
          typeBase(col.sourceType) === 'bit'
        ) {
          const c = coerceBoolean(value);
          if (c.ok) {
            value = c.value;
            applied.add(rule.id);
          }
        }
        // Every other rule is reconcile-time tolerance — never mutated on load.
      }
    }
    values.push(value);
  }
  return { values, appliedRuleIds: [...applied].sort() };
}
