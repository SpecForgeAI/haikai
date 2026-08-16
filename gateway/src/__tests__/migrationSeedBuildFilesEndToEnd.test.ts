/**
 * Strategic end-to-end gap-filling tests for the confirmed-manifest → target
 * codebase carriage (Spec 5, Task Group 5 — "Test Review & Gap Analysis").
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase.
 *
 * WHY THIS FILE EXISTS (5.2 gap analysis)
 * ---------------------------------------
 * Groups 1-4 each have focused unit/threading tests. Reviewing them
 * (`seedBuildFileWriteBlock.test.ts`, `seedBuildFileDestination.test.ts`,
 * `migrationSeedBuildFilesEnrichment.test.ts`,
 * `migrationSeedBuildFilesThreading.test.ts`,
 * `migrationSeedBuildFilesTrigger.test.ts`) shows the pieces are covered, but the
 * two HIGHEST-VALUE end-to-end invariants for this spec are only asserted
 * piecemeal across separate `it` blocks (and the multi-manifest threading proof
 * uses `.toContain`, not byte-carve equality on EACH body):
 *
 *   1. The full happy path AS ONE FLOW: confirmed manifest(s) → verbatim
 *      write-block(s) → correct per-module destination → injected into the
 *      FIRST-sequenced dedicated seed story → carried in that story's persisted
 *      `generatedSpecText` → ready to flow via the UNCHANGED
 *      `POST /api/v2/jobs/orchestrations`. Driven through the REAL
 *      `runShapeSpecGenerationBatch` (DI seams; no AMS / no LLM network).
 *   2. The VERBATIM / BYTE-FAITHFUL guarantee carved out of the PERSISTED seed
 *      text (the bytes IVS would read) — for BOTH bodies, including a
 *      `version-unknown` marker — and the FIRST-SEQUENCING invariant, together,
 *      in one realistic run with ordinary stories present.
 *
 * These are the spec's two named "highest-value end-to-end assertions" (5.2).
 * This file adds 6 strategic tests (well under the 10-test cap); it does NOT
 * re-cover unit edges already owned by the Group 1-4 suites (fence collision,
 * rejection paths, layout permutations, repeated no-op assertions).
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
} from '../services/migrationSeedBuildFilesEnrichment';
import {
  SEED_FILE_BODY_BEGIN,
  SEED_FILE_BODY_END,
  SEED_FILE_WRITE_BLOCK_HEADING,
  SeedFileManifest,
} from '../services/seedBuildFileWriteBlock';
import { ServiceModuleMapping } from '../services/seedBuildFileDestination';
import type { CreateJobRequest } from '../routes/orchestrations';

// ---------------------------------------------------------------------------
// Fixtures — two confirmed manifests, distinct modules, distinct file kinds.
// The pom carries awkward whitespace + an embedded backtick run; the package.json
// carries a literal `version-unknown` marker (Spec 3's unresolved-version
// sentinel). Both must survive BYTE-FOR-BYTE into the persisted seed-story text.
// ---------------------------------------------------------------------------

const POM_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<project xmlns="http://maven.apache.org/POM/4.0.0">\n' +
  '  <!-- curated for CVE reduction; embedded ` backtick must not break carriage -->\n' +
  '  <modelVersion>4.0.0</modelVersion>\n' +
  '  <groupId>com.example</groupId>\n' +
  '  <artifactId>orders-service</artifactId>\n' +
  '  <version>2.1.0</version>\n' +
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
  '  "version": "0.0.0",\n' +
  '  "dependencies": {\n' +
  '    "react": "18.3.1",\n' +
  '    "react-dom": "18.3.1",\n' +
  '    "legacy-widget": "version-unknown"\n' +
  '  }\n' +
  '}\n';

const MAPPING: ServiceModuleMapping = {
  'orders-service': { moduleDir: 'services/orders-service' },
  'web-ui': { moduleDir: 'apps/web-ui' },
};

const ORDERS_DEST = 'services/orders-service/pom.xml';
const WEB_UI_DEST = 'apps/web-ui/package.json';

function pomManifest(): SeedFileManifest {
  return { fileName: 'pom.xml', content: POM_BODY, serviceTag: 'orders-service' };
}
function pkgManifest(): SeedFileManifest {
  return { fileName: 'package.json', content: PKG_BODY, serviceTag: 'web-ui' };
}

/**
 * BoW with the dedicated seed story at the LOWEST sequenceOrder plus N ordinary
 * feature stories at higher orders. The seed story carries the stable `kind`
 * marker + a `provenance`/`description` so it runs the description-grounded path
 * (reaches the generated branch without a discovered-context resolver fetch),
 * mirroring the Group 3/4 fixtures.
 */
function buildBowWithSeed(ordinaryCount: number): LoadedBookOfWork {
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
      description: 'Write the confirmed build manifests verbatim as authoritative files.',
    },
  ];
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
    tests: [{ title: 'Test 1', description: 'Functional test.', type: 'functional' }],
    affectedAreas: ['some/path.ts'],
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
  const fetchSpecContext: SpecContextFetcher = async (input) =>
    ({
      projectId: 'proj-001',
      bookOfWorkId: 'book-001',
      workItemId: input.workItemId,
      currentArchitectureId: 'arch-current-001',
      targetArchitectureId: 'arch-target-001',
      generatedAt: '2026-06-25T00:00:00Z',
    } as MigrationSpecContextDto);
  const callLlm: LlmCaller = async (input) => {
    const story = bow.items.find((it) => it.workItemId === input.workItemId);
    return { content: genLlmContent(story?.title ?? 'unknown') };
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

async function runBatch(deps: ShapeSpecGenerationDeps): Promise<void> {
  await runShapeSpecGenerationBatch(
    { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
    deps,
  );
}

function seedText(persisted: SpecGenerationResult[][]): string {
  const row = persisted.flat().find((r) => r.workItemId === 'wi-seed');
  if (!row) throw new Error('seed row not persisted');
  return row.generatedSpecText as string;
}

/**
 * Recover the EXACT bytes carried for ONE file by locating the per-file write-
 * block heading for `destinationPath`, then slicing strictly between the very
 * next BEGIN sentinel and the END sentinel that follows it. This mirrors exactly
 * how a downstream reader (the implementer / IVS) recovers the file from the spec
 * text, so byte-equality here proves the guarantee against the PERSISTED bytes
 * even when MULTIPLE blocks share the text.
 */
function carveBodyForDestination(text: string, destinationPath: string): string {
  const destMarker = `EXACTLY this path): ${destinationPath}`;
  const destIdx = text.indexOf(destMarker);
  expect(destIdx).toBeGreaterThanOrEqual(0);
  const begin = text.indexOf(SEED_FILE_BODY_BEGIN, destIdx);
  const end = text.indexOf(SEED_FILE_BODY_END, begin);
  expect(begin).toBeGreaterThan(destIdx);
  expect(end).toBeGreaterThan(begin);
  return text.slice(begin + SEED_FILE_BODY_BEGIN.length + 1, end - 1);
}

// ---------------------------------------------------------------------------
// Tests (6 strategic E2E assertions — under the 10-test cap)
// ---------------------------------------------------------------------------

describe('Spec 5 E2E: confirmed manifest -> verbatim seed file in the FIRST story (Group 5)', () => {
  it('(1) HAPPY PATH: two confirmed manifests ride one FIRST-sequenced seed story, each block byte-faithful at its own path', async () => {
    const bow = buildBowWithSeed(2);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest(), pkgManifest()]), persisted);

    await runBatch(deps);

    const flat = persisted.flat();
    // FIRST-sequencing: the seed story is the first persisted per-story result...
    expect(flat[0].workItemId).toBe('wi-seed');
    // ...and the ONLY row carrying the seed section (ordinary stories untouched).
    expect(
      flat.filter((r) => (r.generatedSpecText ?? '').includes(SEED_BUILD_FILES_SECTION_HEADING))
        .map((r) => r.workItemId),
    ).toEqual(['wi-seed']);

    const text = seedText(persisted);
    // Exactly TWO per-file write blocks were carried (one per module).
    expect(text.split(SEED_FILE_WRITE_BLOCK_HEADING).length - 1).toBe(2);
    // Each file is carved out at its OWN destination and is byte-equal to source.
    expect(carveBodyForDestination(text, ORDERS_DEST)).toBe(POM_BODY);
    expect(carveBodyForDestination(text, WEB_UI_DEST)).toBe(PKG_BODY);
    // Both resolved destination paths are present and distinct.
    expect(text).toContain(`EXACTLY this path): ${ORDERS_DEST}`);
    expect(text).toContain(`EXACTLY this path): ${WEB_UI_DEST}`);
    // 2026-08-14: the seed story is DETERMINISTIC — the blocks ride inside the
    // assembled application-bootstrap spec (no LLM narrative).
    expect(text).toContain('assembled DETERMINISTICALLY');
    expect(text).toContain('Bootstrap the RUNNABLE target application');
    expect(flat[0].status === 'generated' || flat[0].status === 'generated_with_warnings').toBe(true);
  });

  it('(2) VERBATIM guarantee: a version-unknown marker survives byte-for-byte in the persisted seed text (no invented version)', async () => {
    const bow = buildBowWithSeed(0);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pkgManifest()]), persisted);

    await runBatch(deps);

    const text = seedText(persisted);
    const carved = carveBodyForDestination(text, WEB_UI_DEST);
    // Whole body byte-equal (proves no re-serialisation / whitespace normalisation).
    expect(carved).toBe(PKG_BODY);
    // The unresolved marker rode through EXACTLY as written.
    expect(carved).toContain('"legacy-widget": "version-unknown"');
    // The authoritative-lock instruction explicitly forbids inventing a version.
    expect(text).toMatch(/do NOT invent, guess, infer/i);
    // No concrete version was fabricated next to the marker.
    expect(carved).not.toMatch(/"legacy-widget":\s*"\d/);
  });

  it('(3) STARTING-POINT wording is carried in the persisted seed text (exact initial write; additions permitted; existing entries survive)', async () => {
    const bow = buildBowWithSeed(0);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest()]), persisted);

    await runBatch(deps);

    const text = seedText(persisted);
    expect(text).toContain('Create this file with EXACTLY this content');
    // 2026-08-16: the freeze language is GONE — it made the implementer refuse
    // decision-required additions (liquibase-core). Starting-point instead.
    expect(text).toMatch(/AUTHORITATIVE STARTING\s*POINT/);
    expect(text).toMatch(/ADDITIONS ARE PERMITTED/);
    expect(text).not.toMatch(/AUTHORITATIVE, FROZEN/);
    expect(text).toMatch(/NOT a suggestion/);
    expect(text).toMatch(/Build the rest of\s*the codebase to FIT this file/);
    // First-sequencing framing rode along too.
    expect(text).toContain('SEQUENCED FIRST');
    expect(text).toContain('BEFORE any other story');
    // Phase-scoped (2026-07-28): the exact-write imperative is implement-phase
    // only — shaping records the blocks, it must not write files.
    expect(text).toContain('PHASE NOTE');
    expect(text).toContain('do not');
    expect(text).toContain('while shaping');
  });

  it('(4) ORDINARY stories receive NO manifest bytes whatsoever (isolation preserved through the real handler)', async () => {
    const bow = buildBowWithSeed(3);
    const persisted: SpecGenerationResult[][] = [];
    const deps = makeDeps(bow, sourceFor([pomManifest(), pkgManifest()]), persisted);

    await runBatch(deps);

    for (const r of persisted.flat()) {
      if (r.workItemId === 'wi-seed') continue;
      const t = r.generatedSpecText ?? '';
      expect(t).not.toContain(SEED_BUILD_FILES_SECTION_HEADING);
      expect(t).not.toContain(SEED_FILE_WRITE_BLOCK_HEADING);
      expect(t).not.toContain(SEED_FILE_BODY_BEGIN);
      expect(t).not.toContain(POM_BODY);
      expect(t).not.toContain(PKG_BODY);
      // Ordinary stories still generated their own real spec.
      expect(t).toContain('/agent-os:shape-spec');
    }
  });

  it('(5) the carried seed text flows via the UNCHANGED orchestrations contract (no build-file/seed-file field)', async () => {
    // The seed file rides INSIDE the spec text, carried by the FIRST story; the
    // IVS job contract is untouched. Compile-time guard: a CreateJobRequest with
    // only the documented fields is assignable.
    const req: CreateJobRequest = {
      company: 'acme',
      project: 'orders',
      spec_intents: [{ spec_name: 'seed-build-files-spec', session_id: 's1' }],
      context_files: [],
    };
    expect(req.spec_intents[0].spec_name).toBe('seed-build-files-spec');

    // Runtime guard: the orchestrations route source has NO build-file/seed-file
    // field on its job contract, and the documented fields are intact.
    const orchSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'orchestrations.ts'),
      'utf8',
    );
    expect(orchSrc).not.toMatch(/seed[_-]?file/i);
    expect(orchSrc).not.toMatch(/build[_-]?file/i);
    expect(orchSrc).toContain('spec_name');
    expect(orchSrc).toContain('context_files');

    // And the carriage end of that flow really does produce the bytes (so the
    // unchanged contract is genuinely carrying the manifest, not nothing).
    const bow = buildBowWithSeed(0);
    const persisted: SpecGenerationResult[][] = [];
    await runBatch(makeDeps(bow, sourceFor([pomManifest()]), persisted));
    expect(carveBodyForDestination(seedText(persisted), ORDERS_DEST)).toBe(POM_BODY);
  });

  it('(6) NO confirmed manifest -> HONEST insufficient_context naming the upload remedy (2026-08-14)', async () => {
    const bow = buildBowWithSeed(2);
    const persisted: SpecGenerationResult[][] = [];
    // Null source == no confirmed manifest exists yet.
    const result = await runShapeSpecGenerationBatch(
      { projectId: 'proj-001', bookOfWorkId: 'book-001', batchSize: 10 },
      makeDeps(bow, async () => null, persisted),
    );

    // Pre-fix this silently generated LLM prose with no seed block — the live
    // "eleven specs, no runnable application" failure. The scaffold spec now
    // refuses to generate without its authoritative build file and names the
    // exact remedy instead.
    const row = persisted.flat().find((r) => r.workItemId === 'wi-seed');
    expect(row?.status).toBe('insufficient_context');
    expect(row?.generatedSpecText ?? null).toBeNull();
    const missing = (row?.missingInputsJson ?? []) as Array<Record<string, unknown>>;
    expect(missing[0]?.input).toBe('confirmed_target_build_manifest');
    expect(String(missing[0]?.reason)).toContain('Upload the target manifest');
    expect(result.summary.failed).toBe(0);
  });
});
