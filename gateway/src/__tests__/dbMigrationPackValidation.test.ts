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
