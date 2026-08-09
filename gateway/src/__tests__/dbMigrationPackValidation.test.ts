/**
 * Runnable-pack validation gate (WS3 P0, 2026-07-31).
 *
 * The live 2026-07-30 pack shipped three parse-blockers that were only
 * discovered at APPLY time: `--` inside XML comments (illegal XML),
 * `table--x` changeset ids (break the formatted-SQL parser), and a dangling
 * `050-translations.sql` include. This gate catches all of them at
 * generation/emission time.
 */
import {
  assertPackFilesValid,
  extractDeclaredRelations,
  validatePackFiles,
} from '../services/dbMigrationPack/packValidation';

const GOOD_MASTER =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">\n' +
  '  <!-- Structural phase: run with contexts=structural. -->\n' +
  '  <include file="changesets/000-schemas.sql" relativeToChangelogFile="true"/>\n' +
  '</databaseChangeLog>\n';

const GOOD_CHANGESET =
  '--liquibase formatted sql logicalFilePath:liquibase/changesets/000-schemas.sql\n' +
  '--changeset db-migration-pack:schemas context:structural splitStatements:false\n' +
  'CREATE SCHEMA IF NOT EXISTS "dbo";\n';

function goodFiles() {
  return [
    { file_path: 'liquibase/db.changelog-master.xml', content: GOOD_MASTER },
    { file_path: 'liquibase/changesets/000-schemas.sql', content: GOOD_CHANGESET },
    { file_path: 'manifest.json', content: '{"expected_schema": {}}' },
  ];
}

describe('validatePackFiles', () => {
  it('passes a structurally runnable pack', () => {
    expect(validatePackFiles(goodFiles())).toEqual([]);
  });

  it('accepts the generation-side camelCase file shape too', () => {
    const files = goodFiles().map((f) => ({ filePath: f.file_path, content: f.content }));
    expect(validatePackFiles(files)).toEqual([]);
  });

  it('rejects a double-dash inside an XML comment (illegal XML)', () => {
    const files = goodFiles();
    files[0] = {
      file_path: files[0].file_path,
      content: GOOD_MASTER.replace('contexts=structural', '--contexts=structural'),
    };
    const problems = validatePackFiles(files);
    expect(problems.some((p) => p.includes("XML comment contains '--'"))).toBe(true);
  });

  it('rejects a dangling include', () => {
    const files = goodFiles().filter((f) => !f.file_path.endsWith('000-schemas.sql'));
    const problems = validatePackFiles(files);
    expect(problems.some((p) => p.includes('dangling include'))).toBe(true);
  });

  it('rejects a changeset id containing a double-dash', () => {
    const files = goodFiles();
    files[1] = {
      file_path: files[1].file_path,
      content: GOOD_CHANGESET.replace(':schemas ', ':table--dbo.arm_version '),
    };
    const problems = validatePackFiles(files);
    expect(problems.some((p) => p.includes('not parser-safe'))).toBe(true);
  });

  it('rejects a BOM on a JSON file', () => {
    const files = goodFiles();
    files[2] = { file_path: 'manifest.json', content: '﻿{"ok": true}' };
    const problems = validatePackFiles(files);
    expect(problems.some((p) => p.includes('BOM'))).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const files = goodFiles();
    files[2] = { file_path: 'manifest.json', content: '{not json' };
    const problems = validatePackFiles(files);
    expect(problems.some((p) => p.includes('not valid JSON'))).toBe(true);
  });

  it('reports a missing master changelog', () => {
    const problems = validatePackFiles([goodFiles()[1]]);
    expect(problems.some((p) => p.includes('no db.changelog-master.xml'))).toBe(true);
  });
});

describe('assertPackFilesValid', () => {
  it('throws with every problem listed and the stage named', () => {
    const files = goodFiles();
    files[0] = {
      file_path: files[0].file_path,
      content: GOOD_MASTER.replace('contexts=structural', '--contexts=structural'),
    };
    expect(() => assertPackFilesValid(files, 'generation')).toThrow(
      /failed the runnable-pack validation at generation/
    );
  });

  it('does not throw for a good pack', () => {
    expect(() => assertPackFilesValid(goodFiles(), 'generation')).not.toThrow();
  });
});
// ---------------------------------------------------------------------------
// Executable-path scoping (2026-08-09): apply-time invariants cover ONLY the
// master + its includes. Provenance copies (translations/<kind>.<obj>.sql)
// are never applied — the same approved view appearing in 050 AND its
// provenance copy is NOT a collision (the first live approved-view emission
// failed exactly there).
// ---------------------------------------------------------------------------

describe('validatePackFiles — executable-path scoping', () => {
  const VIEW_SQL = 'CREATE OR REPLACE VIEW "dbo"."ext_hierarchy_org_vw" AS SELECT 1 AS x;';
  const MASTER_WITH_050 =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">\n' +
    '  <include file="changesets/000-schemas.sql" relativeToChangelogFile="true"/>\n' +
    '  <include file="changesets/050-translations.sql" relativeToChangelogFile="true"/>\n' +
    '</databaseChangeLog>\n';
  const CHANGESET_050 =
    '--liquibase formatted sql logicalFilePath:liquibase/changesets/050-translations.sql\n' +
    '--changeset db-migration-pack:translation-view-dbo.ext_hierarchy_org_vw context:post-load splitStatements:false\n' +
    VIEW_SQL + '\n';

  it('a provenance translations/ copy of an executable view is NOT a relation collision', () => {
    const problems = validatePackFiles([
      { file_path: 'liquibase/db.changelog-master.xml', content: MASTER_WITH_050 },
      { file_path: 'liquibase/changesets/000-schemas.sql', content: GOOD_CHANGESET },
      { file_path: 'liquibase/changesets/050-translations.sql', content: CHANGESET_050 },
      // Provenance copy — same CREATE VIEW text, NEVER applied.
      { file_path: 'translations/view.dbo.ext_hierarchy_org_vw.sql', content: VIEW_SQL },
      { file_path: 'manifest.json', content: '{}' },
    ]);
    expect(problems).toEqual([]);
  });

  it('the SAME duplicate on the executable path still fails (two includes declaring one view)', () => {
    const master =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">\n' +
      '  <include file="changesets/000-schemas.sql" relativeToChangelogFile="true"/>\n' +
      '  <include file="changesets/050-translations.sql" relativeToChangelogFile="true"/>\n' +
      '  <include file="changesets/051-dup.sql" relativeToChangelogFile="true"/>\n' +
      '</databaseChangeLog>\n';
    const problems = validatePackFiles([
      { file_path: 'liquibase/db.changelog-master.xml', content: master },
      { file_path: 'liquibase/changesets/000-schemas.sql', content: GOOD_CHANGESET },
      { file_path: 'liquibase/changesets/050-translations.sql', content: CHANGESET_050 },
      {
        file_path: 'liquibase/changesets/051-dup.sql',
        content:
          '--liquibase formatted sql logicalFilePath:liquibase/changesets/051-dup.sql\n' +
          '--changeset db-migration-pack:dup context:post-load splitStatements:false\n' +
          VIEW_SQL + '\n',
      },
      { file_path: 'manifest.json', content: '{}' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('declared by both');
  });

  it('a sysobjects reference in a provenance copy is ignored; on the executable path it still fails', () => {
    const badSql = 'SELECT name FROM sysobjects;';
    const cleanExecutable = validatePackFiles([
      { file_path: 'liquibase/db.changelog-master.xml', content: GOOD_MASTER },
      { file_path: 'liquibase/changesets/000-schemas.sql', content: GOOD_CHANGESET },
      { file_path: 'translations/stored_procedure.dbo.CreateGrants.sql', content: badSql },
      { file_path: 'manifest.json', content: '{}' },
    ]);
    expect(cleanExecutable).toEqual([]);

    const onExecutablePath = validatePackFiles([
      { file_path: 'liquibase/db.changelog-master.xml', content: MASTER_WITH_050 },
      { file_path: 'liquibase/changesets/000-schemas.sql', content: GOOD_CHANGESET },
      {
        file_path: 'liquibase/changesets/050-translations.sql',
        content:
          '--liquibase formatted sql logicalFilePath:liquibase/changesets/050-translations.sql\n' +
          '--changeset db-migration-pack:translation-stored_procedure-dbo.CreateGrants context:post-load splitStatements:false\n' +
          badSql + '\n',
      },
      { file_path: 'manifest.json', content: '{}' },
    ]);
    expect(onExecutablePath).toHaveLength(1);
    expect(onExecutablePath[0]).toContain('Sybase system catalog');
  });

  it('without a master, every .sql file is still checked (fail-loud fallback)', () => {
    const problems = validatePackFiles([
      { file_path: 'anywhere/loose.sql', content: 'SELECT name FROM sysobjects;' },
    ]);
    expect(problems.some((p) => p.includes('no db.changelog-master.xml'))).toBe(true);
    expect(problems.some((p) => p.includes('Sybase system catalog'))).toBe(true);
  });
});

describe('extractDeclaredRelations', () => {
  it('extracts tables, views and indexes from quoted DDL', () => {
    const sql =
      'CREATE TABLE "dbo"."orders" (\n  "id" bigint\n);\n' +
      'CREATE OR REPLACE VIEW "dbo"."v_orders" AS SELECT 1;\n' +
      'CREATE UNIQUE INDEX "ix_orders" ON "dbo"."orders" ("id");\n';
    expect(extractDeclaredRelations(sql)).toEqual([
      { schema: 'dbo', name: 'orders', kind: 'table' },
      { schema: 'dbo', name: 'v_orders', kind: 'view' },
      { schema: 'dbo', name: 'ix_orders', kind: 'index' },
    ]);
  });
});

