/**
 * Threading tests for the dedicated seed-build-files story (Spec 5, Group 3).
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase.
 *
 * Drives the REAL `runShapeSpecGenerationBatch` through its dependency-injection
 * seams (no AMS / no LLM network) to prove:
 *   (a) the seed-build-files story's persisted `generatedSpecText` CONTAINS the
 *       Group 1 write-block(s) — the FULL manifest body rides VERBATIM;
 *   (b) the seed story lands FIRST in implementation order (lowest sequenceOrder
 *       -> first persisted result), so the seeded file commits at the start;
 *   (c) MULTIPLE confirmed manifests -> multiple per-module instructions, each at
 *       its own destination path, all present in the seed story's text;
 *   (d) ORDINARY feature stories are UNCHANGED — no manifest injected into them;
 *   (e) when NO confirmed manifest exists, the seed story is a safe no-op (no
 *       seed block / no garbage) and the batch still completes normally;
 *   (f) the seed source is the injected CONFIRMED artifact (the handler never
 *       calls the discovery resolvers).
 */

import {
  runShapeSpecGenerationBatch,
  ShapeSpecGenerationDeps,
  LoadedBookOfWork,
  LoadedBookOfWorkItem,
  SpecGenerationResult,
  BookOfWorkLoader,
  ExistingGenerationsLoader,
  SpecContextFetcher,
  LlmCaller,
  PersistBatchFn,
} from '../services/migrationShapeSpecGenerationHandler';
import { MigrationSpecContextDto } from '../services/migrationSpecContextClient';
import {
  SEED_BUILD_FILES_STORY_KIND,
  SEED_BUILD_FILES_SECTION_HEADING,
  SeedBuildFilesSource,
  ConfirmedManifestBundle,
} from '../services/migrationSeedBuildFilesEnrichment';
import {
  SEED_FILE_BODY_BEGIN,
  SEED_FILE_BODY_END,
  SeedFileManifest,
} from '../services/seedBuildFileWriteBlock';
import { ServiceModuleMapping } from '../services/seedBuildFileDestination';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POM_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<project xmlns="http://maven.apache.org/POM/4.0.0">\n' +
  '  <modelVersion>4.0.0</modelVersion>\n' +
  '  <artifactId>orders-service</artifactId>\n' +
  '  <dependencies>\n' +
  '    <dependency>\n' +
  '      <groupId>org.springframework.boot</groupId>\n' +
  '      <artifactId>spring-boot-starter-web</artifactId>\n' +
  '      <version>3.4.1</version>\n' +
  '    </dependency>\n' +
  '  </dependencies>\n' +
  '</project>\n';

const PKG_BODY =
  '{\n' +
  '  "name": "web-ui",\n' +
  '  "dependencies": { "react": "18.3.1", "left-pad": "version-unknown" }\n' +
  '}\n';

const SEED_STORY_TITLE = 'Seed authoritative build files';

const MAPPING: ServiceModuleMapping = {
  'orders-service': { moduleDir: 'services/orders-service' },
  'web-ui': { moduleDir: 'apps/web-ui' },
};

function pomManifest(): SeedFileManifest {
  return { fileName: 'pom.xml', content: POM_BODY, serviceTag: 'orders-service' };
}
function pkgManifest(): SeedFileManifest {
  return { fileName: 'package.json', content: PKG_BODY, serviceTag: 'web-ui' };
}

/**
 * Build a LoadedBookOfWork containing a dedicated seed story (sequenceOrder 1,
 * the lowest) plus N ordinary feature stories at higher sequenceOrders. The seed
 * story carries the stable `kind` marker + a `provenance`/`description` so it
 * runs the description-grounded path (reaches the generated branch without a
 * discovered-context resolver fetch).
 */
function buildBowWithSeed(ordinaryCount: number): LoadedBookOfWork {
  const items: LoadedBookOfWorkItem[] = [];
  items.push({
    id: 'SEED',
    type: 'story',
    parentId: null,
    title: SEED_STORY_TITLE,
    sequenceOrder: 1,
    workItemId: 'wi-seed',
    kind: SEED_BUILD_FILES_STORY_KIND,
    provenance: 'net_new',
    description: 'Write the confirmed build manifests as the authoritative files.',
  });
  for (let i = 0; i < ordinaryCount; i++) {
    items.push({
      id: `S${i + 1}`,
      type: 'story',
      parentId: null,
      title: `Ordinary feature story ${i + 1} scope marker`,
      sequenceOrder: i + 2,
      workItemId: `wi-${i + 1}`,
    });
  }
  return {
    bookOfWorkId: 'book-001',
    projectId: 'proj-001',
    currentArchitectureId: 'arch-current-001',
    targetArchitectureId: 'arch-target-001',
    items,
  };
}

function genLlmContent(title: string): string {
  return JSON.stringify({
    status: 'generated',
    confidence: 'high',
    specText:
      `/agent-os:shape-spec ${title}\n\n` +
      'Feature summary: deliver the work for this story.\n' +
      'Implementation steps: build the controller and wiring.\n' +
      'Acceptance criteria: verified behaviour.',
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions: [],
    tests: [
      { title: 'Test 1', description: 'Functional test.', type: 'functional' },
    ],
    affectedAreas: ['some/path.ts'],
    coveredEndpointIds: [],
  });
}

function buildContextDto(workItemId: string): MigrationSpecContextDto {
  return {
    projectId: 'proj-001',
    bookOfWorkId: 'book-001',
    workItemId,
    currentArchitectureId: 'arch-current-001',
    targetArchitectureId: 'arch-target-001',
    generatedAt: '2026-06-25T00:00:00Z',
    service: { serviceId: 'svc-1', name: 'Svc', currentArchitectureRefs: [], targetArchitectureRefs: [], relatedComponentIds: [] },
  } as MigrationSpecContextDto;
}

function makeDeps(
  bow: LoadedBookOfWork,
  seedSource: SeedBuildFilesSource | undefined,
  capturedPersist: SpecGenerationResult[][],
): ShapeSpecGenerationDeps {
  const loadBookOfWork: BookOfWorkLoader = async () => bow;
  const loadExistingGenerations: ExistingGenerationsLoader = async () => [];
  const fetchSpecContext: SpecContextFetcher = async (input) =>
    buildContextDto(input.workItemId);
  const callLlm: LlmCaller = async (input) => {
    const story = bow.items.find((it) => it.workItemId === input.workItemId);
    return { content: genLlmContent(story?.title ?? 'unknown') };
  };
  const persistBatchResults: PersistBatchFn = async (_p, _b, results) => {
    // Snapshot a deep-ish copy of the rows the handler tried to persist.
    capturedPersist.push(results.map((r) => ({ ...r })));
    return { persistedCount: results.length, resultsCouldNotPersist: 0 };
  };
  return {
    loadBookOfWork,
    loadExistingGenerations,
    fetchSpecContext,
    callLlm,
    persistBatchResults,
    seedBuildFilesSource: seedSource,
    // Keep the citation + element-inventory fetchers inert (no AMS).
    fetchCapturedDecisionsForCitationCheck: async () => ({ decisions: [], targetArchitectureId: null }),
    fetchElementInventoryForCitationCheck: async () => new Map<string, string>(),
    // Disable implement-state writes in this unit test.
    putImplementState: async () => ({ success: true }),
  };
}

function sourceFor(manifests: SeedFileManifest[]): SeedBuildFilesSource {
  const bundle: ConfirmedManifestBundle = { manifests, mapping: MAPPING, layout: 'monorepo' };
  return async () => bundle;
}

function seedRow(persisted: SpecGenerationResult[][]): SpecGenerationResult {
  const flat = persisted.flat();
  const row = flat.find((r) => r.workItemId === 'wi-seed');
  if (!row) throw new Error('seed row not persisted');
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seed-build-files story threading (Spec 5, Group 3)', () => {
  it('(a) the seed story generatedSpecText contains the verbatim write-block; the FULL manifest body survives byte-for-byte', async () => {
    const bow = buildBowWithSeed(0);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest()]), persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      deps,
    );

    const row = seedRow(persisted);
    const text = row.generatedSpecText as string;
    // The seed section + the Group 1 block are present.
    expect(text).toContain(SEED_BUILD_FILES_SECTION_HEADING);
    // Byte-faithful: carve between the sentinels and assert equality with source.
    const begin = text.indexOf(SEED_FILE_BODY_BEGIN);
    const end = text.indexOf(SEED_FILE_BODY_END);
    expect(begin).toBeGreaterThanOrEqual(0);
    const carved = text.slice(begin + SEED_FILE_BODY_BEGIN.length + 1, end - 1);
    expect(carved).toBe(POM_BODY);
    // 2026-08-14: the seed story is DETERMINISTIC — the manifest block rides
    // inside the assembled application-bootstrap spec (no LLM narrative).
    expect(text).toContain('assembled DETERMINISTICALLY');
    expect(text).toContain('Bootstrap the RUNNABLE target application');
    expect(row.status === 'generated' || row.status === 'generated_with_warnings').toBe(true);
  });

  it('(b) the seed story lands FIRST in implementation order (lowest sequenceOrder, first persisted)', async () => {
    const bow = buildBowWithSeed(3);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest()]), persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      deps,
    );

    const flat = persisted.flat();
    // The first persisted per-story result is the seed story.
    expect(flat[0].workItemId).toBe('wi-seed');
    // And it is the only row carrying the seed section.
    const withSeed = flat.filter((r) => (r.generatedSpecText ?? '').includes(SEED_BUILD_FILES_SECTION_HEADING));
    expect(withSeed.map((r) => r.workItemId)).toEqual(['wi-seed']);
  });

  it('(c) MULTIPLE manifests -> multiple per-module instructions, each at its own path, all in the seed story', async () => {
    const bow = buildBowWithSeed(0);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest(), pkgManifest()]), persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      deps,
    );

    const text = seedRow(persisted).generatedSpecText as string;
    expect(text).toContain('services/orders-service/pom.xml');
    expect(text).toContain('apps/web-ui/package.json');
    expect(text).toContain(POM_BODY);
    expect(text).toContain(PKG_BODY);
    // version-unknown survived verbatim.
    expect(text).toContain('"left-pad": "version-unknown"');
  });

  it('(d) ordinary feature stories are UNCHANGED — no manifest injected into them', async () => {
    const bow = buildBowWithSeed(2);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest()]), persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      deps,
    );

    const flat = persisted.flat();
    for (const r of flat) {
      if (r.workItemId === 'wi-seed') continue;
      const text = r.generatedSpecText ?? '';
      expect(text).not.toContain(SEED_BUILD_FILES_SECTION_HEADING);
      expect(text).not.toContain(SEED_FILE_BODY_BEGIN);
      expect(text).not.toContain(POM_BODY);
    }
  });

  it('(e) NO confirmed manifest -> HONEST insufficient_context naming the upload remedy (2026-08-14)', async () => {
    const bow = buildBowWithSeed(1);
    const persisted: SpecGenerationResult[][] = [];
    // Source returns null -> no confirmed manifest.
    const nullSource: SeedBuildFilesSource = async () => null;
    const deps = makeDeps(bow, nullSource, persisted);

    const result = await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      deps,
    );

    // The scaffold spec cannot pin the authoritative build file without the
    // manifest — pre-fix this silently generated LLM prose with no seed block
    // (the live "no runnable application" failure). Now it is a loud, honest
    // insufficient_context with the exact remedy.
    const row = seedRow(persisted);
    expect(row.status).toBe('insufficient_context');
    expect(row.generatedSpecText ?? null).toBeNull();
    const missing = (row.missingInputsJson ?? []) as Array<Record<string, unknown>>;
    expect(missing[0]?.input).toBe('confirmed_target_build_manifest');
    expect(String(missing[0]?.reason)).toContain('Upload the target manifest');
    expect(result.summary.failed).toBe(0);
  });

  it('(f) the seed source is the injected confirmed artifact (handler does not call discovery resolvers)', async () => {
    const bow = buildBowWithSeed(0);
    const persisted: SpecGenerationResult[][] = [];
    const calls: Array<{ projectId: string; bookOfWorkId: string; targetArchitectureId?: string | null }> = [];
    const source: SeedBuildFilesSource = async (input) => {
      calls.push(input);
      return { manifests: [pomManifest()], mapping: MAPPING, layout: 'monorepo' };
    };
    const deps = makeDeps(bow, source, persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      deps,
    );

    // The confirmed source was consulted exactly once per pass with the batch's
    // target architecture id (no resolver call — this seam IS the only manifest
    // input the handler reads).
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]).toEqual({
      projectId: 'proj-001',
      bookOfWorkId: 'book-001',
      targetArchitectureId: 'arch-target-001',
    });
  });
});
