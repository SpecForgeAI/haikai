/**
 * Bare char/varchar length handling (2026-08-12).
 *
 * PostgreSQL defines a bare `char` as char(1) — a column whose recorded
 * length was lost would silently truncate to ONE character (the live
 * 3-table `value too long for type character(1)` load-failure class: 8
 * length-stripped char columns each). The generator never guesses: bare
 * char is a needs_decision. Bare varchar is UNLIMITED on the target — safe,
 * so it maps with a note.
 */
import { mapSourceType } from '../services/dbMigrationPack/typeMapping';

const col = (dataType: string, maxLength: number | null = null) => ({
  dataType,
  maxLength,
  precision: null,
  scale: null,
});

describe('mapSourceType — char/varchar with no recorded length (2026-08-12)', () => {
  it('bare char/nchar is a needs_decision, NEVER a silent char(1)', () => {
    for (const t of ['char', 'nchar']) {
      const result = mapSourceType(col(t));
      expect(result.kind).toBe('needs_decision');
      if (result.kind === 'needs_decision') {
        expect(result.question).toContain('char(1)');
        expect(result.options).toEqual(['specify_target_type', 'drop_column']);
      }
    }
  });

  it('char WITH a length still maps deterministically (inline and column length)', () => {
    expect(mapSourceType(col('char(8)'))).toEqual(
      expect.objectContaining({ kind: 'mapped', postgresType: 'char(8)' }),
    );
    expect(mapSourceType(col('char', 8))).toEqual(
      expect.objectContaining({ kind: 'mapped', postgresType: 'char(8)' }),
    );
  });

  it('bare varchar maps UNBOUNDED (safe: no value can truncate) with a cast note', () => {
    const result = mapSourceType(col('varchar'));
    expect(result).toEqual(
      expect.objectContaining({ kind: 'mapped', postgresType: 'varchar' }),
    );
    if (result.kind === 'mapped') {
      expect(result.castNote).toContain('UNBOUNDED');
    }
    expect(mapSourceType(col('varchar', 50))).toEqual(
      expect.objectContaining({ kind: 'mapped', postgresType: 'varchar(50)' }),
    );
  });
});
