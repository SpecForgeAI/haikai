/**
 * DB-tier acceptance criteria + decisions carried (2026-08-30).
 *
 * These specs previously emitted `## Context` + `## Requirements` + the file
 * list and stopped: the book-of-work stories DID carry acceptance criteria
 * that never reached the spec text, and the DB tier cited ZERO decisions
 * while every other carriage archetype cites its governing decisions. Pins:
 *
 *   - `## Acceptance criteria`: story criteria verbatim + the mechanical
 *     byte-for-byte / diff-GREEN / no-outside-file criteria + the run-assembly
 *     absence criterion when overlaid files exist;
 *   - the honest NOTE when a story recorded no criteria of its own;
 *   - `## Decisions carried (cite, never re-decide)`: the engine cite in
 *     house `[decision:db.engine]` notation + the pack-provenance line;
 *   - the runner parses `manifest.target_db` UNCONDITIONALLY, so EVERY
 *     DB-tier spec cites the engine — not just the master-changelog story
 *     (whose binding section is unchanged).
 */

import {
  buildDbPackSpecText,
  runDbPackSpecCarriage,
  PackFileRow,
} from '../services/migrationDbPackSpecCarriage';
import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from '../services/migrationShapeSpecGenerationHandler';

function story(overrides: Partial<LoadedBookOfWorkItem> = {}): LoadedBookOfWorkItem {
  return {
    id: 'bow-s-cluster-0',
    type: 'story',
    parentId: 'bow-f-cluster-0',
    title: 'Apply schema changesets — cluster 1',
    sequenceOrder: 5,
    workItemId: 'wi-1',
    description: 'Reproduce the pack changesets verbatim.',
    tags: ['seed_db_pack_files', 'provenance:pack'],
    packId: 'pack-1',
    packFilePaths: ['liquibase/changesets/010-tables/dbo.screen_filter.sql'],
    packFilePathPrefixes: null,
    ...overrides,
  } as LoadedBookOfWorkItem;
}

const CHANGESET: PackFileRow = {
  file_path: 'liquibase/changesets/010-tables/dbo.screen_filter.sql',
  file_kind: 'liquibase_changeset',
  content: 'CREATE TABLE dbo.screen_filter (\n  id integer PRIMARY KEY\n);\n',
  sort_order: 2,
};

const MASTER: PackFileRow = {
  file_path: 'liquibase/db.changelog-master.xml',
  file_kind: 'liquibase_master',
  content: '<databaseChangeLog/>',
  sort_order: 1,
};

const MANIFEST: PackFileRow = {
  file_path: 'manifest.json',
  file_kind: 'manifest',
  content: JSON.stringify({
    target_db: {
      engine: 'postgresql',
      host: 'db.internal',
      port: 5432,
      database: 'target_db',
      schema: 'dbo',
      username: 'migrator',
    },
  }),
  sort_order: 0,
};

function baseRow(): MigrationStorySpecGenerationDto {
  return {
    projectId: 'p-1',
    workItemId: 'wi-1',
    status: 'failed',
    generationAttemptNumber: 1,
  } as MigrationStorySpecGenerationDto;
}

describe('buildDbPackSpecText — acceptance criteria', () => {
  it('carries the STORY criteria verbatim plus the mechanical criteria', () => {
    const text = buildDbPackSpecText({
      story: story({
        acceptanceCriteria: [
          'Per-table loaded row counts match the expected source counts.',
        ],
      }),
      packId: 'pack-1',
      files: [CHANGESET],
      targetEngine: 'postgresql',
    });
    expect(text).toContain('## Acceptance criteria');
    expect(text).toContain('- Per-table loaded row counts match the expected source counts.');
    expect(text).toContain(
      '- All 1 file(s) in "Files to reproduce byte-for-byte" exist at their exact repo-relative paths',
    );
    expect(text).toContain("- The pack's expected-schema diff returns GREEN");
    expect(text).toContain("- No migration file outside this story's file list is modified.");
    // With criteria of its own, the pure-carriage NOTE is absent.
    expect(text).not.toContain('recorded no acceptance criteria of its own');
    // Section ordering: AC then Decisions then the file list.
    expect(text.indexOf('## Acceptance criteria')).toBeLessThan(
      text.indexOf('## Decisions carried'),
    );
    expect(text.indexOf('## Decisions carried')).toBeLessThan(
      text.indexOf('## Files to reproduce byte-for-byte'),
    );
  });

  it('a story with NO criteria of its own says so plainly (bytes landed ≠ behaviour checked)', () => {
    const text = buildDbPackSpecText({
      story: story({ acceptanceCriteria: [] }),
      packId: 'pack-1',
      files: [CHANGESET],
    });
    expect(text).toContain('recorded no acceptance criteria of its own');
    expect(text).toContain('nothing above checks migration BEHAVIOUR, only that the bytes landed');
  });

  it('overlaid files add the ABSENT-from-branch criterion', () => {
    const huge: PackFileRow = {
      file_path: 'reference/manifest-huge.json',
      file_kind: 'manifest',
      content: 'x'.repeat(70_000),
      sort_order: 9,
    };
    const text = buildDbPackSpecText({
      story: story(),
      packId: 'pack-1',
      files: [CHANGESET, huge],
    });
    expect(text).toContain('- The 1 run-assembly file(s) are ABSENT from the branch');
    expect(text).toContain('authoring one here is a defect');
  });
});

describe('buildDbPackSpecText — decisions carried', () => {
  it('cites the target engine in house notation plus the pack provenance', () => {
    const text = buildDbPackSpecText({
      story: story(),
      packId: 'pack-1',
      files: [CHANGESET],
      targetEngine: 'postgresql',
    });
    expect(text).toContain('## Decisions carried (cite, never re-decide)');
    expect(text).toContain('- Target engine: `postgresql` [decision:db.engine]');
    expect(text).toContain("- Pack provenance: pack pack-1 — the pack's decision queue");
    expect(text).toContain('do not re-derive, re-open, or "improve" them');
  });

  it('no declared engine -> no engine line; the provenance line always renders', () => {
    const text = buildDbPackSpecText({
      story: story(),
      packId: 'pack-1',
      files: [CHANGESET],
      targetEngine: null,
    });
    expect(text).not.toContain('[decision:db.engine]');
    expect(text).toContain('- Pack provenance: pack pack-1');
  });
});

describe('runDbPackSpecCarriage — unconditional target_db parse', () => {
  it('a NON-master-changelog story still cites [decision:db.engine] and gets NO binding section', async () => {
    const row = await runDbPackSpecCarriage({
      projectId: 'p-1',
      story: story(),
      baseRow: baseRow(),
      fetchPackFiles: jest.fn().mockResolvedValue([MANIFEST, CHANGESET, MASTER]),
    });
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;
    expect(text).toContain('- Target engine: `postgresql` [decision:db.engine]');
    expect(text).not.toContain('## Target database (declared binding)');
  });

  it('the master-changelog story keeps its binding section AND cites the engine', async () => {
    const row = await runDbPackSpecCarriage({
      projectId: 'p-1',
      story: story({
        packFilePaths: [
          'liquibase/db.changelog-master.xml',
          'liquibase/changesets/010-tables/dbo.screen_filter.sql',
        ],
      }),
      baseRow: baseRow(),
      fetchPackFiles: jest.fn().mockResolvedValue([MANIFEST, CHANGESET, MASTER]),
    });
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Target database (declared binding)');
    expect(text).toContain('- JDBC URL: jdbc:postgresql://db.internal:5432/target_db');
    expect(text).toContain('- Target engine: `postgresql` [decision:db.engine]');
  });

  it('a malformed manifest stays best-effort: no engine cite, no binding, spec still generates', async () => {
    const badManifest: PackFileRow = { ...MANIFEST, content: '{not json' };
    const row = await runDbPackSpecCarriage({
      projectId: 'p-1',
      story: story({
        packFilePaths: [
          'liquibase/db.changelog-master.xml',
          'liquibase/changesets/010-tables/dbo.screen_filter.sql',
        ],
      }),
      baseRow: baseRow(),
      fetchPackFiles: jest.fn().mockResolvedValue([badManifest, CHANGESET, MASTER]),
    });
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;
    expect(text).not.toContain('[decision:db.engine]');
    expect(text).not.toContain('## Target database (declared binding)');
    expect(text).toContain('- Pack provenance: pack pack-1');
  });
});
