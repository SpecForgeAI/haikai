/**
 * Spec preflight — the ONE readiness function (Phase 0, 2026-07-20).
 *
 * Pins the load-bearing contract: the preflight routes every story EXACTLY as
 * the batch loop would (db-pack carriage / manual-gate / code-facts /
 * description-grounded / resolver), runs the generator's own input checks, and
 * stops before the LLM. Readiness shown on the plan screen and the generator's
 * behaviour can therefore never disagree.
 */
import { runSpecPreflight, SpecPreflightRow } from '../services/migrationSpecPreflight';
import {
  LoadedBookOfWork,
  BookOfWorkLoader,
  SpecContextFetcher,
} from '../services/migrationShapeSpecGenerationHandler';

const PROJECT = 'proj-1';
const BOOK = 'book-1';

function bow(items: LoadedBookOfWork['items']): LoadedBookOfWork {
  return {
    bookOfWorkId: BOOK,
    projectId: PROJECT,
    currentArchitectureId: 'arch-cur',
    targetArchitectureId: 'arch-tgt',
    items,
  };
}

function story(overrides: Partial<LoadedBookOfWork['items'][number]>): LoadedBookOfWork['items'][number] {
  return {
    id: 'S1',
    type: 'story',
    parentId: 'F1',
    title: 'A story',
    sequenceOrder: 1,
    workItemId: 'wi-1',
    ...overrides,
  };
}

function depsWith(
  items: LoadedBookOfWork['items'],
  extra: Parameters<typeof runSpecPreflight>[1] = {}
) {
  const loadBookOfWork: BookOfWorkLoader = jest.fn().mockResolvedValue(bow(items));
  return { loadBookOfWork, ...extra };
}

describe('runSpecPreflight — routing + readiness', () => {
  it('db-pack story with ALL files present → ready via the db_pack route', async () => {
    const items = [
      story({
        id: 'S-db',
        title: 'Seed the schema foundations',
        tags: ['seed_db_pack_files'],
        packId: 'pack-1',
        packFilePaths: ['liquibase/db.changelog-master.xml'],
      } as never),
    ];
    const fetchPackFiles = jest.fn().mockResolvedValue([
      { file_path: 'liquibase/db.changelog-master.xml', content: '<xml/>' },
    ]);
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchPackFiles })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: 'db_pack', ready: true, missing_inputs: [] });
  });

  it('db-pack story with a MISSING pack file → not ready, missing path reported', async () => {
    const items = [
      story({
        id: 'S-db',
        tags: ['seed_db_pack_files'],
        packId: 'pack-1',
        packFilePaths: ['liquibase/gone.xml'],
      } as never),
    ];
    const fetchPackFiles = jest.fn().mockResolvedValue([
      { file_path: 'liquibase/other.xml', content: 'x' },
    ]);
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchPackFiles })
    );
    expect(rows[0].route).toBe('db_pack');
    expect(rows[0].ready).toBe(false);
    expect(rows[0].missing_inputs.length).toBeGreaterThan(0);
  });

  it('pack-files read is MEMOISED per pack — two stories, one fetch', async () => {
    const items = [
      story({ id: 'S-a', tags: ['seed_db_pack_files'], packId: 'pack-1', packFilePaths: ['a.sql'] } as never),
      story({ id: 'S-b', workItemId: 'wi-2', tags: ['seed_db_pack_files'], packId: 'pack-1', packFilePaths: ['b.sql'] } as never),
    ];
    const fetchPackFiles = jest.fn().mockResolvedValue([
      { file_path: 'a.sql', content: 'x' },
      { file_path: 'b.sql', content: 'y' },
    ]);
    await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchPackFiles })
    );
    expect(fetchPackFiles).toHaveBeenCalledTimes(1);
  });

  it('manual-gate story → always ready via the manual_gate route (no facts fetch)', async () => {
    const items = [
      story({
        id: 'S-gate',
        title: 'Full-surface parity verification sweep',
        tags: ['provenance:plan-deterministic', 'execution:manual-gate'],
      } as never),
    ];
    const fetchCodeSpecFacts = jest.fn();
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchCodeSpecFacts })
    );
    expect(rows[0]).toMatchObject({ route: 'manual_gate', ready: true });
    expect(fetchCodeSpecFacts).not.toHaveBeenCalled();
  });

  it('db-pack REVIEW story (Spec 2026-07-23) → db_pack_review route from the translation queue; resolver NEVER called', async () => {
    const items = [
      story({
        id: 'epic-1-s-stored_procedure-review',
        title: 'Review & approve stored procedures translation drafts (0 of 29 outstanding)',
        tags: ['provenance:pack', 'pack:p-1', 'stream:target_database_schema_implementation'],
      } as never),
      story({
        id: 'epic-1-s-view-review',
        title: 'Review & approve views translation drafts (2 of 4 outstanding)',
        tags: ['provenance:pack', 'pack:p-1', 'stream:target_database_schema_implementation'],
      } as never),
    ];
    const fetchSpecContext = jest.fn();
    const fetchPackTranslations = jest.fn().mockResolvedValue([
      // procs all approved; views carry 2 outstanding.
      { translation_key: 'k1', object_ref: 'dbo.p1', kind: 'stored_procedure', disposition: 'translate', review_status: 'approved' },
      { translation_key: 'k2', object_ref: 'dbo.v1', kind: 'view', disposition: 'translate', review_status: 'unreviewed' },
      { translation_key: 'k3', object_ref: 'dbo.v2', kind: 'view', disposition: 'translate', review_status: 'needs_rework' },
    ]);
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchSpecContext, fetchPackTranslations } as never)
    );
    // The bug case: fully-approved queue is READY — no SOAP/IaC/capability demands.
    expect(rows[0]).toMatchObject({ route: 'db_pack_review', ready: true });
    // Sibling with outstanding drafts blocks for the RIGHT reason.
    expect(rows[1]).toMatchObject({ route: 'db_pack_review', ready: false });
    expect(JSON.stringify(rows[1].missing_inputs)).toContain('2 unapproved translation draft(s)');
    // The generic focused-context resolver is never consulted...
    expect(fetchSpecContext).not.toHaveBeenCalled();
    // ...and the queue read is memoised: two stories, ONE fetch.
    expect(fetchPackTranslations).toHaveBeenCalledTimes(1);
  });

  it('resolver story with clean focused context → ready; with missing inputs → not ready (same detector as generation)', async () => {
    const items = [
      story({ id: 'S-ok', workItemId: 'wi-ok' }),
      story({ id: 'S-miss', workItemId: 'wi-miss' }),
    ];
    const fetchSpecContext: SpecContextFetcher = jest.fn().mockImplementation(async (input) =>
      input.workItemId === 'wi-ok'
        ? { missingInputs: [] }
        : {
            missingInputs: [
              { kind: 'mapping', reason: 'No current->target data mapping' },
            ],
          }
    ) as never;
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchSpecContext })
    );
    const ok = rows.find((r) => r.book_item_id === 'S-ok')!;
    const miss = rows.find((r) => r.book_item_id === 'S-miss')!;
    expect(ok).toMatchObject({ route: 'resolver', ready: true });
    expect(miss.ready).toBe(false);
    expect(miss.missing_inputs[0]).toMatchObject({ kind: 'mapping' });
  });

  it('UNSAVED resolver story → save_required (no resolver call)', async () => {
    const items = [story({ id: 'S-unsaved', workItemId: undefined })];
    const fetchSpecContext = jest.fn();
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchSpecContext: fetchSpecContext as never })
    );
    expect(rows[0]).toMatchObject({ route: 'resolver', ready: false, note: 'save_required' });
    expect(fetchSpecContext).not.toHaveBeenCalled();
  });

  it('FAIL-SOFT: one story whose check throws reports preflight_error; the rest of the book still preflights', async () => {
    const items = [
      story({ id: 'S-boom', workItemId: 'wi-boom' }),
      story({ id: 'S-fine', workItemId: 'wi-fine' }),
    ];
    const fetchSpecContext: SpecContextFetcher = jest.fn().mockImplementation(async (input) => {
      if (input.workItemId === 'wi-boom') throw new Error('AMS down');
      return { missingInputs: [] };
    }) as never;
    const rows = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchSpecContext })
    );
    const boom = rows.find((r) => r.book_item_id === 'S-boom')!;
    const fine = rows.find((r) => r.book_item_id === 'S-fine')!;
    expect(boom).toMatchObject({ ready: false, note: 'preflight_error' });
    expect(fine.ready).toBe(true);
  });

  it('non-story items are ignored; response covers stories only', async () => {
    const items = [
      { id: 'E1', type: 'epic' as const, parentId: null, title: 'Epic', sequenceOrder: 0 },
      story({ id: 'S1', workItemId: 'wi-1' }),
    ];
    const fetchSpecContext: SpecContextFetcher = jest
      .fn()
      .mockResolvedValue({ missingInputs: [] }) as never;
    const rows: SpecPreflightRow[] = await runSpecPreflight(
      { projectId: PROJECT, bookOfWorkId: BOOK },
      depsWith(items, { fetchSpecContext })
    );
    expect(rows.map((r) => r.book_item_id)).toEqual(['S1']);
  });
});
