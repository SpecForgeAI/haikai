/**
 * Saved-book scaffold-story mint (2026-08-14). Pins:
 *   - the additive add-item payload: parented under the manifest-homed host
 *     epic's lowest-sequence feature, sequence_order 0 (FIRST in the walk),
 *     the seed_build_files tag set, workstream stamped, the FR3 seed title
 *     with the resolved service name;
 *   - idempotency (already_present short-circuits, nothing written);
 *   - the manifest gate is re-checked (manifest_missing carries the remedy);
 *   - no host epic -> honest refusal.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  mintScaffoldStoryIntoBook,
  resolveScaffoldParent,
  ScaffoldAddItemRequest,
} from '../migrationScaffoldStoryMint';
import { LoadedBookOfWork } from '../migrationShapeSpecGenerationHandler';
import { TargetManifestArtifactWire } from '../targetManifestArtifactsClient';

const MANIFEST = {
  tag: 'hifi-api',
  ecosystem: 'MAVEN',
  kind: 'maven_pom',
  manifest_path: 'pom.xml',
  content: '<project/>',
} as TargetManifestArtifactWire;

function bow(items: LoadedBookOfWork['items']): LoadedBookOfWork {
  return {
    bookOfWorkId: 'book-1',
    projectId: 'p1',
    currentArchitectureId: 'arch-cur',
    targetArchitectureId: 'arch-tgt',
    items,
  };
}

const SERVICE_PLANE_ITEMS: LoadedBookOfWork['items'] = [
  {
    id: 'api_migration-epic-foundations',
    type: 'epic',
    parentId: 'api_migration-init',
    title: 'Foundations & cross-cutting parity',
    sequenceOrder: 2,
    tags: ['provenance:plan-deterministic', 'stream:api_migration'],
  },
  {
    id: 'api_migration-f-foundations',
    type: 'feature',
    parentId: 'api_migration-epic-foundations',
    title: 'Cross-cutting foundations',
    sequenceOrder: 3,
    tags: ['stream:api_migration'],
  },
  {
    id: 'api_migration-epic-interfaces',
    type: 'epic',
    parentId: 'api_migration-init',
    title: 'Interface implementation',
    sequenceOrder: 10,
    tags: ['stream:api_migration'],
  },
  {
    id: 's-foundation-1',
    type: 'story',
    parentId: 'api_migration-f-foundations',
    title: 'Security & auth parity foundations',
    sequenceOrder: 4,
    workItemId: 'wi-1',
    tags: ['provenance:plan-deterministic', 'stream:api_migration'],
  },
] as never;

function okGate() {
  return jest.fn().mockResolvedValue({
    status: 'ok',
    bookTargetArchitectureId: 'arch-tgt',
    artifactCount: 1,
    probeErrors: [],
  });
}

describe('resolveScaffoldParent', () => {
  it('picks the lowest-sequence epic of the manifest workstream and its lowest-sequence feature', () => {
    const resolved = resolveScaffoldParent(bow(SERVICE_PLANE_ITEMS), [MANIFEST]);
    expect(resolved?.workstream).toBe('api_migration');
    expect(resolved?.hostEpic.id).toBe('api_migration-epic-foundations');
    expect(resolved?.parentFeature?.id).toBe('api_migration-f-foundations');
  });

  it('returns null when no epic of the manifest workstream exists', () => {
    const dbOnly = [
      {
        id: 'db-epic',
        type: 'epic',
        parentId: null,
        title: 'Build target schema',
        sequenceOrder: 1,
        tags: ['stream:target_database_schema_implementation'],
      },
    ] as never;
    expect(resolveScaffoldParent(bow(dbOnly), [MANIFEST])).toBeNull();
  });
});

describe('mintScaffoldStoryIntoBook', () => {
  it('mints the tagged, FIRST-sequenced scaffold story under the foundations feature', async () => {
    const addWorkItem = jest.fn().mockResolvedValue({ workItemId: 'wi-scaffold' });
    const outcome = await mintScaffoldStoryIntoBook(
      { projectId: 'p1', bookId: 'book-1' },
      {
        loadBookOfWork: jest.fn().mockResolvedValue(bow(SERVICE_PLANE_ITEMS)),
        fetchManifests: jest.fn().mockResolvedValue([MANIFEST]),
        fetchScaffoldServices: jest
          .fn()
          .mockResolvedValue([{ id: 'svc-1', name: 'Orders Service' }]),
        addWorkItem,
        diagnoseManifestGate: okGate(),
      }
    );

    expect(outcome.status).toBe('minted');
    expect(addWorkItem).toHaveBeenCalledTimes(1);
    const req = addWorkItem.mock.calls[0][2] as ScaffoldAddItemRequest;
    expect(req.parent_book_item_id).toBe('api_migration-f-foundations');
    expect(req.sequence_order).toBe(0);
    expect(req.kind).toBe('operational');
    expect(req.workstream).toBe('api_migration');
    expect(req.tags).toEqual([
      'seed_build_files',
      'stream:api_migration',
      'provenance:scaffold',
    ]);
    // The FR3 seed sentence with the resolved service name + manifest filename.
    expect(req.title).toContain('Scaffold the Orders Service app');
    expect(req.title).toContain('pom.xml exactly as confirmed');
    expect(req.acceptance_criteria).toEqual([req.title]);
  });

  it('is idempotent: an existing seed story short-circuits with nothing written', async () => {
    const items = [
      ...SERVICE_PLANE_ITEMS,
      {
        id: 's-scaffold',
        type: 'story',
        parentId: 'api_migration-f-foundations',
        title: 'Scaffold the app',
        sequenceOrder: 0,
        tags: ['seed_build_files', 'stream:api_migration'],
      },
    ] as never;
    const addWorkItem = jest.fn();
    const outcome = await mintScaffoldStoryIntoBook(
      { projectId: 'p1', bookId: 'book-1' },
      {
        loadBookOfWork: jest.fn().mockResolvedValue(bow(items)),
        addWorkItem,
        diagnoseManifestGate: okGate(),
      }
    );
    expect(outcome).toEqual({ status: 'already_present', bookItemId: 's-scaffold' });
    expect(addWorkItem).not.toHaveBeenCalled();
  });

  it('refuses with the gate remedy when the manifest is missing (nothing written)', async () => {
    const addWorkItem = jest.fn();
    const outcome = await mintScaffoldStoryIntoBook(
      { projectId: 'p1', bookId: 'book-1' },
      {
        loadBookOfWork: jest.fn().mockResolvedValue(bow(SERVICE_PLANE_ITEMS)),
        addWorkItem,
        diagnoseManifestGate: jest.fn().mockResolvedValue({
          status: 'no_manifest',
          bookTargetArchitectureId: 'arch-tgt',
          artifactCount: 0,
          probeErrors: [],
        }),
      }
    );
    expect(outcome.status).toBe('manifest_missing');
    expect((outcome as { remedy: string }).remedy).toContain('Upload it on the Target State screen');
    expect(addWorkItem).not.toHaveBeenCalled();
  });

  it('refuses honestly when no host epic exists for the manifest workstream', async () => {
    const addWorkItem = jest.fn();
    const outcome = await mintScaffoldStoryIntoBook(
      { projectId: 'p1', bookId: 'book-1' },
      {
        loadBookOfWork: jest.fn().mockResolvedValue(bow([])),
        fetchManifests: jest.fn().mockResolvedValue([MANIFEST]),
        addWorkItem,
        diagnoseManifestGate: okGate(),
      }
    );
    expect(outcome.status).toBe('no_host_epic');
    expect(addWorkItem).not.toHaveBeenCalled();
  });

  it('a services-read failure degrades to the generic label (mint still succeeds)', async () => {
    const addWorkItem = jest.fn().mockResolvedValue({ workItemId: 'wi-scaffold' });
    const outcome = await mintScaffoldStoryIntoBook(
      { projectId: 'p1', bookId: 'book-1' },
      {
        loadBookOfWork: jest.fn().mockResolvedValue(bow(SERVICE_PLANE_ITEMS)),
        fetchManifests: jest.fn().mockResolvedValue([MANIFEST]),
        fetchScaffoldServices: jest.fn().mockRejectedValue(new Error('AMS 503')),
        addWorkItem,
        diagnoseManifestGate: okGate(),
      }
    );
    expect(outcome.status).toBe('minted');
    const req = addWorkItem.mock.calls[0][2] as ScaffoldAddItemRequest;
    expect(req.title).toContain('Scaffold the service API app');
  });
});
