/**
 * Group D tests -- engine-specific default-expression cross-engine hazard
 * Findings (Spec 2026-05-30 Data-Layer Fidelity 2).
 *
 * EXTENDS the Spec-3 / Group-B db-pack-finding test patterns (mirrors
 * dbStructuralFidelityGroup2.test.ts / dbCollationGroupB.test.ts). Offline only
 * -- the finding builders + detector are fed synthetic IR with `column_default`
 * values. Synthetic-rows-only -> isolation-safe (no live DB, no `pg` needed).
 *
 * Focused set (within the 2-8 bound):
 *  1. `getdate()` flagged -> non_portable_default Finding emitted (Postgres path
 *     reuse + Sybase source path).
 *  2. `newid()` flagged; `newsequentialid()` / `suser_name()` / `host_name()`
 *     recognised by the detector.
 *  3. A non-engine-specific default (`0` / a string literal / Postgres `now()`)
 *     is NOT flagged.
 *  4. The VERBATIM `column_default` is carried unchanged in the Finding payload
 *     AND is unchanged on the physical-attribute metadata after emit (flag-only,
 *     no rewrite).
 */

import { __testOnly as postgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { __testOnly as sybaseFindings } from '../services/databasePacks/sybase/sybaseFindings';
import { detectNonPortableDefault } from '../services/findings/databasePackFindingScanners/databasePackFindingBuilders';
import { attributeStructuralFidelityFields } from '../services/databasePacks/candidateStructuralFidelity';
import type {
  ColumnMetadata,
  IntrospectionResult,
} from '../services/databasePacks/types';

const emptyIntrospection = (): IntrospectionResult => ({
  schemas: [],
  tables: [],
  columns: [],
  keysAndIndexes: [],
  views: [],
  procedures: [],
  triggers: [],
  sequences: [],
});

const col = (
  columnName: string,
  defaultExpression: string | null,
): ColumnMetadata => ({
  schemaName: 'dbo',
  tableName: 'customer',
  columnName,
  dataType: 'datetime',
  isNullable: true,
  ordinalPosition: 1,
  defaultExpression,
});

// -----------------------------------------------------------------------------
// 1) getdate() flagged; portable defaults not flagged (Postgres emit path).
// -----------------------------------------------------------------------------

describe('Non-portable default Finding (Group D)', () => {
  it('flags getdate() / newid() and does NOT flag a literal or Postgres now()', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      columns: [
        col('created_at', '(getdate())'), // T-SQL -> flagged
        col('row_id', '(newid())'), // T-SQL -> flagged
        col('status', "'active'"), // string literal -> NOT flagged
        col('qty', '0'), // numeric literal -> NOT flagged
        col('updated_at', 'now()'), // portable Postgres -> NOT flagged
      ],
    };
    const out = postgresFindings.emitNonPortableDefaultFindings(ir);
    // Two flagged (getdate, newid); three portable.
    expect(out).toHaveLength(2);
    const cols = out.map((f) => (f.detailJson as Record<string, unknown>).columnName).sort();
    expect(cols).toEqual(['created_at', 'row_id']);
    for (const f of out) {
      expect(f.findingType).toBe('non_portable_default');
      expect(f.category).toBe('migration_risk');
    }
  });

  it('keeps the VERBATIM column_default in the Finding payload (no rewrite)', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      columns: [col('created_at', '(getdate())')],
    };
    const out = postgresFindings.emitNonPortableDefaultFindings(ir);
    expect(out).toHaveLength(1);
    const detail = out[0].detailJson as Record<string, unknown>;
    expect(detail.columnDefault).toBe('(getdate())'); // verbatim, unchanged
    expect(detail.detectedToken).toBe('getdate');
    expect(typeof detail.portabilityNote).toBe('string');
    expect(detail.migrationConcern).toBe('engine_specific_default_expression');
  });
});

// -----------------------------------------------------------------------------
// 2) The Sybase SOURCE path flags the same engine-specific defaults.
// -----------------------------------------------------------------------------

describe('Non-portable default Finding -- Sybase source (Group D)', () => {
  it('flags getdate()/suser_name()/host_name() on the Sybase path', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      columns: [
        col('created_at', 'getdate()'),
        col('created_by', 'suser_name()'),
        col('created_host', 'host_name()'),
        col('label', "'n/a'"), // literal -> NOT flagged
      ],
    };
    const out = sybaseFindings.emitNonPortableDefaultFindings(ir);
    expect(out).toHaveLength(3);
    const tokens = out
      .map((f) => (f.detailJson as Record<string, unknown>).detectedToken)
      .sort();
    expect(tokens).toEqual(['getdate', 'host_name', 'suser_name']);
    for (const f of out) {
      expect((f.detailJson as Record<string, unknown>).engineKey).toBe('sybase');
    }
  });
});

// -----------------------------------------------------------------------------
// 3) detectNonPortableDefault unit coverage (engine builtins vs portable).
// -----------------------------------------------------------------------------

describe('detectNonPortableDefault detector (Group D)', () => {
  it('recognises the engine-specific builtins and ignores portable / literal defaults', () => {
    expect(detectNonPortableDefault('(getdate())')?.token).toBe('getdate');
    expect(detectNonPortableDefault('GETDATE()')?.token).toBe('getdate'); // case-insensitive
    expect(detectNonPortableDefault('newid()')?.token).toBe('newid');
    expect(detectNonPortableDefault('newsequentialid()')?.token).toBe('newsequentialid');
    expect(detectNonPortableDefault('suser_name()')?.token).toBe('suser_name');
    expect(detectNonPortableDefault('host_name()')?.token).toBe('host_name');
    expect(detectNonPortableDefault('db_name()')?.token).toBe('db_name');
    expect(detectNonPortableDefault('@@spid')?.token).toBe('@@spid');
    // Portable / literal -> null.
    expect(detectNonPortableDefault('now()')).toBeNull();
    expect(detectNonPortableDefault('CURRENT_TIMESTAMP')).toBeNull();
    expect(detectNonPortableDefault('gen_random_uuid()')).toBeNull();
    expect(detectNonPortableDefault("'active'")).toBeNull();
    expect(detectNonPortableDefault('0')).toBeNull();
    expect(detectNonPortableDefault(null)).toBeNull();
    expect(detectNonPortableDefault(undefined)).toBeNull();
    // A column whose value merely embeds the token as part of a longer
    // identifier must NOT match (word-boundary discipline).
    expect(detectNonPortableDefault('mygetdatewrapper()')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 4) The stored column_default on the attribute is unchanged after emit.
// -----------------------------------------------------------------------------

describe('Stored column_default is unchanged after the Finding is emitted (Group D)', () => {
  it('flag-only: the physical-attribute column_default stays verbatim', () => {
    const c = col('created_at', '(getdate())');
    // Snapshot the attribute payload BEFORE emit.
    const before = attributeStructuralFidelityFields(c);
    expect(before.column_default).toBe('(getdate())');

    const ir: IntrospectionResult = { ...emptyIntrospection(), columns: [c] };
    postgresFindings.emitNonPortableDefaultFindings(ir);

    // The Finding emit must NOT mutate the IR column or the attribute payload.
    expect(c.defaultExpression).toBe('(getdate())');
    const after = attributeStructuralFidelityFields(c);
    expect(after.column_default).toBe('(getdate())'); // unchanged
  });
});
