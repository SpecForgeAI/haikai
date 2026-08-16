/**
 * Trigger + commit-timing + v1-boundary tests for the seed-build-files carriage
 * (Spec 5, Task Group 4).
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase.
 *
 * Group 4 covers WHEN the carriage runs and HOW the seeded file commits:
 *   (a) on confirmation (the confirmed manifest exists), the manifest is READ via
 *       the confirmed-source seam and the seed-story write-block(s) are emitted
 *       end-to-end through Groups 1-3 (driven here with injected deps);
 *   (b) when NO confirmed manifest exists, the flow is a safe NO-OP (no
 *       empty/garbage seed block);
 *   (c) the manifest source is the CONFIRMED artifact (consumes Spec 3's output;
 *       the handler does NOT call the discovery resolvers — the ONLY manifest
 *       input is the injected `SeedBuildFilesSource`);
 *   (d) commit-at-implementation-start rides the EXISTING IVS flow: the
 *       `POST /api/v2/jobs/orchestrations` contract is UNCHANGED — no build-file /
 *       seed-file payload field is added (the seed file rides inside the spec
 *       text, carried by the FIRST-sequenced story);
 *   (e) the honest v1 production default source is a no-op (no IVS change).
 */

import * as fs from 'fs';
import * as path from 'path';

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
  defaultProductionSeedBuildFilesSource,
} from '../services/migrationSeedBuildFilesEnrichment';
import { SeedFileManifest, SEED_FILE_BODY_BEGIN } from '../services/seedBuildFileWriteBlock';
import { ServiceModuleMapping } from '../services/seedBuildFileDestination';
// The orchestrations route module — imported ONLY to assert its public job
// contract type is unchanged (no build-file field). The router itself is not
// exercised here.
import type { CreateJobRequest } from '../routes/orchestrations';

const POM_BODY =
  '<?xml version="1.0"?>\n<project><artifactId>orders</artifactId>\n' +
  '  <dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>1.2.3</version></dependency></dependencies>\n' +
  '</project>\n';

const MAPPING: ServiceModuleMapping = { 'orders-service': { moduleDir: 'services/orders-service' } };

function pomManifest(): SeedFileManifest {
  return { fileName: 'pom.xml', content: POM_BODY, serviceTag: 'orders-service' };
}

function buildBowWithSeed(): LoadedBookOfWork {
  const items: LoadedBookOfWorkItem[] = [
    {
      id: 'SEED',
      type: 'story',
      parentId: null,
      title: 'Seed authoritative build files',
      sequenceOrder: 1,
      workItemId: 'wi-seed',
      kind: SEED_BUILD_FILES_STORY_KIND,
      provenance: 'net_new',
      description: 'Write the confirmed manifests verbatim.',
    },
  ];
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
      `/agent-os:shape-spec ${title}\n\nFeature summary: seed the build files.\n` +
      'Implementation steps: write the files.\nAcceptance criteria: files exist.',
    warnings: [],
    evidenceRefs: [{ type: 'mapping', id: 'm1' }],
    assumptions: [],
    tests: [{ title: 'T1', description: 'Functional.', type: 'functional' }],
    affectedAreas: ['x.ts'],
    coveredEndpointIds: [],
  });
}

function makeDeps(
  bow: LoadedBookOfWork,
  seedSource: SeedBuildFilesSource | undefined,
  capturedPersist: SpecGenerationResult[][],
): ShapeSpecGenerationDeps {
  const loadBookOfWork: BookOfWorkLoader = async () => bow;
  const loadExistingGenerations: ExistingGenerationsLoader = async () => [];
  const fetchSpecContext: SpecContextFetcher = async (input) => {
    return {
      projectId: 'proj-001',
      bookOfWorkId: 'book-001',
      workItemId: input.workItemId,
      currentArchitectureId: 'arch-current-001',
      targetArchitectureId: 'arch-target-001',
      generatedAt: '2026-06-25T00:00:00Z',
    } as MigrationSpecContextDto;
  };
  const callLlm: LlmCaller = async (input) => {
    const story = bow.items.find((it) => it.workItemId === input.workItemId);
    return { content: genLlmContent(story?.title ?? 'x') };
  };
  const persistBatchResults: PersistBatchFn = async (_p, _b, results) => {
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
    fetchCapturedDecisionsForCitationCheck: async () => ({ decisions: [], targetArchitectureId: null }),
    fetchElementInventoryForCitationCheck: async () => new Map<string, string>(),
    putImplementState: async () => ({ success: true }),
  };
}

function sourceFor(manifests: SeedFileManifest[]): SeedBuildFilesSource {
  const bundle: ConfirmedManifestBundle = { manifests, mapping: MAPPING, layout: 'monorepo' };
  return async () => bundle;
}

function seedRow(persisted: SpecGenerationResult[][]): SpecGenerationResult {
  const row = persisted.flat().find((r) => r.workItemId === 'wi-seed');
  if (!row) throw new Error('seed row not persisted');
  return row;
}

describe('seed-build-files trigger + commit-timing + v1 boundary (Spec 5, Group 4)', () => {
  it('(a) on confirmation the confirmed manifest is read and the seed write-block is emitted (E2E via Groups 1-3)', async () => {
    const bow = buildBowWithSeed();
    const persisted: SpecGenerationResult[][] = [];
    const source = jest.fn(sourceFor([pomManifest()]));
    const deps = makeDeps(bow, source, persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 5 },
      deps,
    );

    // The confirmed source WAS consulted (the trigger fired).
    expect(source).toHaveBeenCalled();
    // The seed block + verbatim body landed in the seed story's spec text.
    const text = seedRow(persisted).generatedSpecText as string;
    expect(text).toContain(SEED_BUILD_FILES_SECTION_HEADING);
    expect(text).toContain(POM_BODY);
  });

  it('(a2) decision→manifest auto-apply runs BEFORE the seed enrichment reads the manifest (2026-08-16)', async () => {
    // The live gap: db.migrations said Liquibase, the confirmed pom never
    // gained liquibase-core, and the seeded manifest shipped without the
    // migration tool. When the production routes wire the auto-apply seam,
    // the handler must run it before the enrichment read so the scaffold spec
    // seeds a decision-consistent pom.
    const bow = buildBowWithSeed();
    const persisted: SpecGenerationResult[][] = [];
    const source = jest.fn(sourceFor([pomManifest()]));
    const autoApply = jest.fn().mockResolvedValue({ status: 'applied' });
    const deps = {
      ...makeDeps(bow, source, persisted),
      autoApplyDecisionAdditions: autoApply,
    };

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 5 },
      deps,
    );

    expect(autoApply).toHaveBeenCalledWith('proj-001', expect.any(String));
    // Ordering: the manifest was amended BEFORE the enrichment consumed it.
    expect(autoApply.mock.invocationCallOrder[0]).toBeLessThan(
      source.mock.invocationCallOrder[0],
    );
  });

  it('(b) NO confirmed manifest -> safe no-op (no seed block / no garbage)', async () => {
    const bow = buildBowWithSeed();
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, async () => null, persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 5 },
      deps,
    );

    const text = seedRow(persisted).generatedSpecText ?? '';
    expect(text).not.toContain(SEED_BUILD_FILES_SECTION_HEADING);
    expect(text).not.toContain(SEED_FILE_BODY_BEGIN);
  });

  it('(c) the manifest source is the CONFIRMED artifact — the handler never calls the discovery resolvers', async () => {
    const bow = buildBowWithSeed();
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest()]), persisted);

    await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 5 },
      deps,
    );

    // The discovery resolvers (Maven/npm) are NEVER imported by the handler; the
    // ONLY manifest input is the confirmed-source seam. We assert this
    // structurally: the handler module source must not reference the resolver
    // class names.
    const handlerSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'services', 'migrationShapeSpecGenerationHandler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toContain('MavenDependencyResolver');
    expect(handlerSrc).not.toContain('NpmDependencyResolver');
    expect(handlerSrc).not.toContain('mavenPomMetadataParser');
    // The seam was used (the seed story carries the block).
    expect((seedRow(persisted).generatedSpecText ?? '')).toContain(POM_BODY);
  });

  it('(d) the POST /api/v2/jobs/orchestrations contract is UNCHANGED — no build-file/seed-file payload field', () => {
    // Compile-time guard: a CreateJobRequest with ONLY the documented fields is
    // assignable. If a build-file field were ADDED-as-required this would fail to
    // compile; the explicit shape below documents the contract Spec 5 must not
    // touch.
    const req: CreateJobRequest = {
      company: 'acme',
      project: 'orders',
      spec_intents: [{ spec_name: 'my-spec', session_id: 's1' }],
      context_files: [],
    };
    expect(req.spec_intents[0].spec_name).toBe('my-spec');

    // Runtime guard: the orchestrations route source carries no build-file /
    // seed-file field on its job contract.
    const orchSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'orchestrations.ts'),
      'utf8',
    );
    expect(orchSrc).not.toMatch(/seed[_-]?file/i);
    expect(orchSrc).not.toMatch(/build[_-]?file/i);
    // The known contract fields are still present.
    expect(orchSrc).toContain('spec_name');
    expect(orchSrc).toContain('context_files');
  });

  it('(e) the honest v1 production default source is a no-op (no IVS change wired in v1)', async () => {
    const out = await defaultProductionSeedBuildFilesSource({
      projectId: 'proj-001',
      bookOfWorkId: 'book-001',
      targetArchitectureId: 'arch-target-001',
    });
    expect(out).toBeNull();
  });
});
