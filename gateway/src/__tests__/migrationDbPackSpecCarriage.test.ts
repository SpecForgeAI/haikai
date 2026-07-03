/**
 * Tests — DB-pack verbatim spec carriage (Spec 2026-07-02-c,
 * Persistence-Tier Oracle Program).
 *
 * Pins:
 *   - the carriage is FULLY deterministic: through the REAL batch runner a
 *     carriage story never touches the context resolver or the LLM
 *   - file content is reproduced byte-for-byte inside the spec text with an
 *     unbreakable fence
 *   - missing files -> insufficient_context (never a spec with silent holes)
 */

import {
  buildDbPackSpecText,
  isDbPackCarriageStory,
  runDbPackSpecCarriage,
  selectCarriageFiles,
  DB_PACK_CARRIAGE_SIZE_WARNING_CHARS,
  PackFileRow,
} from '../services/migrationDbPackSpecCarriage';
import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
  runShapeSpecGenerationBatch,
} from '../services/migrationShapeSpecGenerationHandler';

function carriageStory(
  overrides: Partial<LoadedBookOfWorkItem> = {}
): LoadedBookOfWorkItem {
  return {
    id: 'bow-s-cluster-0',
    type: 'story',
    parentId: 'bow-f-cluster-0',
    title: 'Apply schema changesets — cluster 1 (2 tables, layer 1)',
    sequenceOrder: 5,
    workItemId: 'wi-1',
    description: 'Reproduce the pack changesets verbatim.',
    tags: ['seed_db_pack_files', 'provenance:pack', 'stream:target_database_schema_implementation'],
    packId: 'pack-1',
    packFilePaths: [
      'liquibase/changesets/010-tables/dbo.customers.sql',
      'liquibase/changesets/010-tables/dbo.orders.sql',
    ],
    packFilePathPrefixes: null,
    ...overrides,
  };
}

const FILES: PackFileRow[] = [
  {
    file_path: 'liquibase/changesets/010-tables/dbo.customers.sql',
    file_kind: 'liquibase_changeset',
    content: 'CREATE TABLE dbo.customers (\n  id integer PRIMARY KEY\n);\n',
    sort_order: 2,
  },
  {
    file_path: 'liquibase/changesets/010-tables/dbo.orders.sql',
    file_kind: 'liquibase_changeset',
    content: 'CREATE TABLE dbo.orders (\n  id integer PRIMARY KEY\n);\n',
    sort_order: 3,
  },
  {
    file_path: 'data/bulk/001-dbo.customers.sql',
    file_kind: 'bulk_load_script',
    content: '-- bulk customers',
    sort_order: 10,
  },
  {
    file_path: 'data/bulk/002-dbo.orders.sql',
    file_kind: 'bulk_load_script',
    content: '-- bulk orders',
    sort_order: 11,
  },
];

function baseRow(): MigrationStorySpecGenerationDto {
  return {
    projectId: 'proj-1',
    workItemId: 'wi-1',
    bookOfWorkId: 'bow-1',
    bookItemId: 'bow-s-cluster-0',
    status: 'failed',
    generationPass: 1,
  };
}

describe('recognition + selection (pure)', () => {
  it('recognises a carriage story by tag + packId + selectors; refuses partial markers', () => {
    expect(isDbPackCarriageStory(carriageStory())).toBe(true);
    expect(isDbPackCarriageStory(carriageStory({ tags: ['provenance:pack'] }))).toBe(false);
    expect(isDbPackCarriageStory(carriageStory({ packId: null }))).toBe(false);
    expect(
      isDbPackCarriageStory(
        carriageStory({ packFilePaths: null, packFilePathPrefixes: null })
      )
    ).toBe(false);
    expect(
      isDbPackCarriageStory(
        carriageStory({ packFilePaths: null, packFilePathPrefixes: ['data/bulk/'] })
      )
    ).toBe(true);
  });

  it('selects exact paths in story order, records missing, appends prefix matches in pack sort order', () => {
    const selection = selectCarriageFiles(
      FILES,
      [
        'liquibase/changesets/010-tables/dbo.orders.sql',
        'liquibase/changesets/010-tables/dbo.MISSING.sql',
      ],
      ['data/bulk/']
    );
    expect(selection.missing).toEqual(['liquibase/changesets/010-tables/dbo.MISSING.sql']);
    expect(selection.files.map((f) => f.file_path)).toEqual([
      'liquibase/changesets/010-tables/dbo.orders.sql',
      'data/bulk/001-dbo.customers.sql',
      'data/bulk/002-dbo.orders.sql',
    ]);
  });
});

describe('buildDbPackSpecText (pure)', () => {
  it('starts with the required prefix + story title and reproduces file content verbatim', () => {
    const text = buildDbPackSpecText({
      story: carriageStory(),
      packId: 'pack-1',
      files: FILES.slice(0, 2),
    });
    expect(text.startsWith('/agent-os:shape-spec Apply schema changesets')).toBe(true);
    expect(text).toContain('### `liquibase/changesets/010-tables/dbo.customers.sql`');
    expect(text).toContain('CREATE TABLE dbo.customers (\n  id integer PRIMARY KEY\n);');
    expect(text).toContain('byte-for-byte');
  });

  it('uses a fence longer than any backtick run inside the content (unbreakable)', () => {
    const nasty = 'SELECT 1;\n```\n-- a stray fence inside\n````\nSELECT 2;';
    const text = buildDbPackSpecText({
      story: carriageStory(),
      packId: 'pack-1',
      files: [{ file_path: 'x.sql', content: nasty, sort_order: 0 }],
    });
    // Longest run inside is 4 -> fence must be 5.
    expect(text).toContain('`````sql');
    expect(text).toContain(nasty.replace(/\n$/, ''));
  });
});

describe('runDbPackSpecCarriage', () => {
  it('happy path: generated, high confidence, refs carry the pack + paths', async () => {
    const row = await runDbPackSpecCarriage({
      projectId: 'proj-1',
      story: carriageStory(),
      baseRow: baseRow(),
      fetchPackFiles: async () => FILES,
    });
    expect(row.status).toBe('generated');
    expect(row.confidence).toBe('high');
    expect(row.generatedSpecText).toContain('/agent-os:shape-spec');
    expect(row.focusedContextRefsJson).toMatchObject({
      source: 'db_migration_pack',
      packId: 'pack-1',
    });
    expect(
      (row.focusedContextRefsJson as { filePaths: string[] }).filePaths
    ).toHaveLength(2);
  });

  it('missing pack file -> insufficient_context naming the path (never a spec with holes)', async () => {
    const row = await runDbPackSpecCarriage({
      projectId: 'proj-1',
      story: carriageStory({
        packFilePaths: ['liquibase/changesets/010-tables/dbo.GONE.sql'],
      }),
      baseRow: baseRow(),
      fetchPackFiles: async () => FILES,
    });
    expect(row.status).toBe('insufficient_context');
    expect(row.generatedSpecText ?? null).toBeNull();
    expect(JSON.stringify(row.missingInputsJson)).toContain('dbo.GONE.sql');
  });

  it('pack read failure -> failed with the error message (per-story isolation)', async () => {
    const row = await runDbPackSpecCarriage({
      projectId: 'proj-1',
      story: carriageStory(),
      baseRow: baseRow(),
      fetchPackFiles: async () => {
        throw new Error('HTTP 503');
      },
    });
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toContain('HTTP 503');
  });

  it('oversized carriage -> generated_with_warnings, content still complete', async () => {
    const big = 'X'.repeat(DB_PACK_CARRIAGE_SIZE_WARNING_CHARS + 10);
    const row = await runDbPackSpecCarriage({
      projectId: 'proj-1',
      story: carriageStory({ packFilePaths: ['big.sql'] }),
      baseRow: baseRow(),
      fetchPackFiles: async () => [{ file_path: 'big.sql', content: big, sort_order: 0 }],
    });
    expect(row.status).toBe('generated_with_warnings');
    expect(JSON.stringify(row.warningsJson)).toContain('db_pack_carriage_large');
    expect(row.generatedSpecText).toContain(big);
  });
});

describe('batch integration — the carriage bypasses resolver + LLM entirely', () => {
  it('a carriage story generates through runShapeSpecGenerationBatch with throwing resolver + LLM mocks', async () => {
    const persisted: MigrationStorySpecGenerationDto[][] = [];
    const result = await runShapeSpecGenerationBatch(
      { projectId: 'proj-1', bookOfWorkId: 'bow-1' },
      {
        loadBookOfWork: async () => ({
          bookOfWorkId: 'bow-1',
          projectId: 'proj-1',
          currentArchitectureId: 'arch-current',
          targetArchitectureId: 'arch-target',
          items: [carriageStory()],
        }),
        loadExistingGenerations: async () => [],
        fetchSpecContext: (async () => {
          throw new Error('context resolver must NEVER be called for a carriage story');
        }) as never,
        callLlm: (async () => {
          throw new Error('LLM must NEVER be called for a carriage story');
        }) as never,
        persistBatchResults: (async (
          _projectId: string,
          _bookId: string,
          rows: MigrationStorySpecGenerationDto[]
        ) => {
          persisted.push(rows);
          return { persisted: rows.length };
        }) as never,
        fetchPackFiles: async () => FILES,
        fetchManuallyEditedInScope: (async () => []) as never,
        fetchProjectConfig: (async () => ({
          crossStoryContextInjectionEnabled: false,
        })) as never,
        systemPromptOverride: 'SYS',
      } as never
    );

    expect(result.perStoryResults).toHaveLength(1);
    expect(result.perStoryResults[0].status).toBe('generated');
    expect(result.perStoryResults[0].generatedSpecText).toContain(
      '/agent-os:shape-spec Apply schema changesets'
    );
    expect(result.perStoryResults[0].generatedSpecText).toContain(
      'CREATE TABLE dbo.customers'
    );
    expect(persisted).toHaveLength(1);
  });
});
