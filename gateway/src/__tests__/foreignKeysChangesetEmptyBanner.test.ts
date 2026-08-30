/**
 * C2 (2026-08-30): the empty foreign-keys changeset must incriminate itself.
 *
 * A live pack shipped an FK changeset containing just the header + cheerful
 * comment while the source catalogue declared FIVE foreign keys — and because
 * DB-tier acceptance is "the files match the pack content exactly", the empty
 * file passed GREEN and every FK was silently dropped. Zero emitted
 * constraints now emit a LOUD banner naming both catalogue verification
 * queries and explicitly refusing the "files match the pack" shortcut.
 */

import { emitForeignKeysChangeset } from '../services/dbMigrationPack/liquibase';
import { IrForeignKey } from '../services/dbMigrationPack/types';

function fk(overrides: Partial<IrForeignKey> = {}): IrForeignKey {
  return {
    relationshipId: 'rel-1',
    fromSchema: 'dbo',
    fromTable: 'filter_tag',
    toSchema: 'dbo',
    toTable: 'screen_filter',
    joinColumns: ['FilterId'],
    referencedColumns: ['FilterId'],
    onDelete: null,
    onUpdate: null,
    ...overrides,
  };
}

describe('emitForeignKeysChangeset — empty-file banner', () => {
  it('zero FKs with a known no-join-metadata count -> loud banner naming the count + both catalogue queries', () => {
    const content = emitForeignKeysChangeset({
      foreignKeys: [],
      emittedTables: new Set(),
      relationshipsWithoutJoinMetadata: 5,
    });

    expect(content).toContain('NO FOREIGN KEYS WERE EMITTED.');
    expect(content).toContain('This is NOT evidence that the source database declares none.');
    expect(content).toContain('5 relationship(s) in the model carry no fk_columns join metadata');
    expect(content).toContain("See the 'relationships_without_fk_columns' pack finding.");
    expect(content).toContain("DO NOT accept this changeset as complete");
    expect(content).toContain("'files match the pack' check");
    expect(content).toContain('SELECT count(*) FROM sysreferences');
    expect(content).toContain("SELECT count(*) FROM pg_constraint WHERE contype = 'f'");
    expect(content).toContain('referential integrity is being lost');
  });

  it('zero FKs with an UNKNOWN count -> banner with the generic no-metadata line', () => {
    const content = emitForeignKeysChangeset({
      foreignKeys: [],
      emittedTables: new Set(),
    });
    expect(content).toContain('NO FOREIGN KEYS WERE EMITTED.');
    expect(content).toContain(
      'The model supplied no relationship carrying fk_columns join metadata',
    );
    expect(content).not.toContain('relationship(s) in the model carry');
  });

  it('a zero count reads as the generic line too (never "0 relationship(s)")', () => {
    const content = emitForeignKeysChangeset({
      foreignKeys: [],
      emittedTables: new Set(),
      relationshipsWithoutJoinMetadata: 0,
    });
    expect(content).toContain('NO FOREIGN KEYS WERE EMITTED.');
    expect(content).not.toContain('0 relationship(s)');
  });

  it('fires even when every FK was SKIPPED for an unemitted side (the case mistaken for done)', () => {
    const content = emitForeignKeysChangeset({
      foreignKeys: [fk()],
      // Neither side emitted -> the FK is skipped with a note, zero ALTERs.
      emittedTables: new Set(['dbo.other_table']),
      relationshipsWithoutJoinMetadata: 2,
    });
    expect(content).toContain('-- SKIPPED FK');
    expect(content).toContain('NO FOREIGN KEYS WERE EMITTED.');
  });

  it('stays silent when at least one FK emits', () => {
    const content = emitForeignKeysChangeset({
      foreignKeys: [fk()],
      emittedTables: new Set(['dbo.filter_tag', 'dbo.screen_filter']),
      relationshipsWithoutJoinMetadata: 2,
    });
    expect(content).toContain('ALTER TABLE "dbo"."filter_tag"');
    expect(content).not.toContain('NO FOREIGN KEYS WERE EMITTED.');
  });
});
