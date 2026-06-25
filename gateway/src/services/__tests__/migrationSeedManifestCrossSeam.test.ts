/**
 * Task Group 6 cross-seam gap tests (Spec 5 Phase 2).
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring, task 6.3.
 *
 * The per-group suites (Task Groups 2-5) each prove ONE seam in isolation:
 *   - 2.1  the client posts/maps the snake_case wire (verbatim on the boundary);
 *   - 3.1  the upload route attempts a correctly-mapped persist + is fail-soft;
 *   - 4.1  the seed story is minted FIRST + replace-in-place;
 *   - 5.1  the producer builds a per-tag bundle + is fail-soft.
 *
 * What NONE of them assert is the WHOLE gateway chain joined end to end, which is
 * exactly where a silent regression (a trim, a re-encode, a key rename, a leaked
 * camelCase field) would hide and only surface in the live smoke. This file fills
 * those CRITICAL cross-seam gaps the gap analysis (6.2) identified, and ONLY
 * those (4 tests, well under the budget):
 *
 *   (1) VERBATIM FIDELITY across the full gateway chain — the confirmed artifact's
 *       bytes survive byte-for-byte from the persist-mapper, through the persisted
 *       wire row, through the producer, into the resolved seed write block (the
 *       text that rides to spec-gen). Trailing newline + internal tab + non-ASCII.
 *   (2) PER-TAG INDEPENDENCE at the producer read seam — distinct tags from a
 *       latest-read resolve to distinct `<tag>/` paths, each carrying ONLY its own
 *       bytes (the read-side complement of the AMS per-tag is_latest flip test).
 *   (3) PAYLOAD-SHAPE CONTRACT (gateway -> AMS) — the gateway's persist payload
 *       emits EXACTLY the snake_case key set the AMS `TargetManifestArtifactInput`
 *       record consumes, with no camelCase leakage (drift detection).
 *   (4) DUAL FAIL-SOFT — a persist hiccup at upload AND a read hiccup at spec-gen
 *       BOTH degrade to safe no-ops in ONE test (upload response intact; producer
 *       returns null), proving the two independent fail-soft seams together.
 *
 * Everything here runs offline (no live AMS): the AMS round-trip is represented by
 * mapping a written `TargetManifestArtifactInput` into the `TargetManifestArtifactWire`
 * shape the store would return — the store's own verbatim TEXT round-trip is proven
 * separately by the AMS `TargetManifestArtifactPersistenceTest`.
 */

jest.mock('../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  toTargetManifestArtifactInput,
  type PersistConfirmedManifestsSeam,
  buildTargetManifestUploadResponseWithAutoAnswer,
} from '../../routes/targetManifestUpload';
import type { ConfirmedManifestArtifact } from '../targetManifest/manifestHandoffs';
import type {
  TargetManifestArtifactInput,
  TargetManifestArtifactWire,
} from '../targetManifestArtifactsClient';
import {
  createProductionSeedBuildFilesSource,
  type FetchLatestTargetManifestArtifacts,
} from '../migrationSeedBuildFilesProducer';
import { attachResolvedDestination } from '../seedBuildFileDestination';
import {
  buildSeedFileWriteBlock,
  SEED_FILE_BODY_BEGIN,
  SEED_FILE_BODY_END,
} from '../seedBuildFileWriteBlock';
import { ManifestUploadOrchestratorDeps } from '../targetManifest/manifestUploadOrchestrator';
import { ManifestPrecedenceDeps } from '../targetManifest/manifestPrecedence';
import type { CreateCapturedDecisionRequestBody } from '../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';

const PROJECT_ID = 'proj-1';
const TARGET_ARCH_ID = 'arch-9';
const BOOK_ID = 'book-7';

// ---------------------------------------------------------------------------
// Helpers: model the AMS store round-trip offline.
//
// At runtime the gateway POSTs a `TargetManifestArtifactInput` and the AMS GET
// returns a `TargetManifestArtifactWire` (one latest per tag). The store carries
// `content` / `package_lock_content` / `resolved_dependencies` UNCHANGED (proven
// by the AMS persistence test). We therefore model the round-trip by promoting a
// written input to the wire row it would come back as -- so this test exercises
// the GATEWAY adapters on BOTH sides of the store without re-proving the store.
// ---------------------------------------------------------------------------
function inputToPersistedWire(
  input: TargetManifestArtifactInput,
  index: number,
): TargetManifestArtifactWire {
  return {
    id: `row-${index}`,
    project_id: PROJECT_ID,
    target_architecture_id: TARGET_ARCH_ID,
    tag: input.tag,
    kind: input.kind,
    ecosystem: input.ecosystem,
    manifest_path: input.manifest_path,
    content: input.content, // verbatim — the store stores TEXT unchanged
    package_lock_content: input.package_lock_content,
    resolved_dependencies: input.resolved_dependencies,
    is_latest: true,
    created_at: '2026-06-25T00:00:00Z',
  };
}

/** A latest-read stub backed by the artifacts the gateway "persisted". */
function readBackedByPersist(
  persisted: TargetManifestArtifactWire[],
): FetchLatestTargetManifestArtifacts {
  return async () => persisted;
}

// ===========================================================================
// (1) VERBATIM FIDELITY across the full gateway chain
// ===========================================================================

test('verbatim bytes survive the FULL gateway chain: persist-mapper -> wire row -> producer -> seed write block', async () => {
  // Bytes engineered to catch a trim / re-encode / newline-drift anywhere in the
  // chain: leading blank line, internal tab, non-ASCII, and a trailing newline.
  const verbatimPom =
    '\n<project>\n\t<groupId>org.acme</groupId>\n' +
    '\t<artifactId>café-orders</artifactId>\n</project>\n';

  const artifact: ConfirmedManifestArtifact = {
    tag: 'orders-service',
    ecosystem: 'MAVEN',
    kind: 'pom.xml',
    manifestPath: 'services/orders/pom.xml',
    content: verbatimPom,
    packageLockContent: null,
    resolvedDependencies: [],
  };

  // Seam 1: the upload persist-mapper (Task Group 3) -> snake_case write payload.
  const input = toTargetManifestArtifactInput(artifact);
  expect(input.content).toBe(verbatimPom); // unchanged at the persist boundary

  // The AMS store round-trip (modelled): the row comes back with content verbatim.
  const persisted = [inputToPersistedWire(input, 0)];
  expect(persisted[0].content).toBe(verbatimPom);

  // Seam 2: the producer (Task Group 5) reads the latest + builds the bundle.
  const source = createProductionSeedBuildFilesSource(readBackedByPersist(persisted));
  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });
  expect(bundle).not.toBeNull();
  expect(bundle!.manifests).toHaveLength(1);
  const manifest = bundle!.manifests[0];
  expect(manifest.content).toBe(verbatimPom); // unchanged through the producer

  // Seam 3: the carriage resolves the destination + builds the verbatim block —
  // the actual text that rides to spec-gen.
  const { manifest: withDest, destination } = attachResolvedDestination(
    manifest,
    bundle!.mapping,
    bundle!.layout,
  );
  expect(destination.resolved).toBe(true);
  const block = buildSeedFileWriteBlock(withDest);
  expect(typeof block).toBe('string');
  const blockText = block as string;

  // The EXACT bytes ride between the BEGIN/END sentinels — byte-for-byte, no
  // normalisation. Recover them the way a reader does and compare to the original.
  const begin = blockText.indexOf(SEED_FILE_BODY_BEGIN);
  const end = blockText.indexOf(SEED_FILE_BODY_END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const carriedBody = blockText.slice(begin + SEED_FILE_BODY_BEGIN.length + 1, end - 1);
  expect(carriedBody).toBe(verbatimPom);

  // The resolved per-module path is the convention `<tag>/pom.xml`.
  expect(blockText).toContain('orders-service/pom.xml');
});

// ===========================================================================
// (2) PER-TAG INDEPENDENCE at the producer read seam
// ===========================================================================

test('distinct tags from a latest-read resolve independently, each carrying ONLY its own verbatim bytes', async () => {
  const pom = '<project>\n  <artifactId>orders</artifactId>\n</project>\n';
  const pkg = '{\n  "name": "web-app",\n  "version": "1.0.0"\n}\n';

  const persisted: TargetManifestArtifactWire[] = [
    inputToPersistedWire(
      toTargetManifestArtifactInput({
        tag: 'orders-service',
        ecosystem: 'MAVEN',
        kind: 'pom.xml',
        manifestPath: 'pom.xml',
        content: pom,
        packageLockContent: null,
        resolvedDependencies: [],
      }),
      0,
    ),
    inputToPersistedWire(
      toTargetManifestArtifactInput({
        tag: 'web-app',
        ecosystem: 'NPM',
        kind: 'package.json',
        manifestPath: 'package.json',
        content: pkg,
        packageLockContent: '{\n  "lockfileVersion": 3\n}\n',
        resolvedDependencies: [],
      }),
      1,
    ),
  ];

  const source = createProductionSeedBuildFilesSource(readBackedByPersist(persisted));
  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });
  expect(bundle).not.toBeNull();
  expect(bundle!.manifests).toHaveLength(2);

  const resolvedByTag = Object.fromEntries(
    bundle!.manifests.map((m) => {
      const { destination } = attachResolvedDestination(m, bundle!.mapping, bundle!.layout);
      return [m.serviceTag, { path: destination.resolved ? destination.destinationPath : null, content: m.content }];
    }),
  );

  // Independent placement: each tag -> its own `<tag>/<file>` path.
  expect(resolvedByTag['orders-service'].path).toBe('orders-service/pom.xml');
  expect(resolvedByTag['web-app'].path).toBe('web-app/package.json');

  // No cross-contamination: each manifest carries ONLY its own verbatim bytes.
  expect(resolvedByTag['orders-service'].content).toBe(pom);
  expect(resolvedByTag['web-app'].content).toBe(pkg);
  expect(resolvedByTag['orders-service'].content).not.toContain('web-app');
  expect(resolvedByTag['web-app'].content).not.toContain('orders');
});

// ===========================================================================
// (3) PAYLOAD-SHAPE CONTRACT (gateway -> AMS): drift detection
// ===========================================================================

/**
 * The snake_case key set the AMS `TargetManifestArtifactInput` record consumes
 * (mirrors
 * `architecture-model-service/.../model/dto/targetmanifest/TargetManifestArtifactInput.java`,
 * which the global SNAKE_CASE Jackson strategy renders to these wire keys).
 *
 * If this set drifts from what the gateway emits, the live persist would silently
 * lose a column. The AMS-side half of this contract (the gateway's literal JSON
 * deserialising into the Java record) is asserted in the AMS
 * `TargetManifestArtifactControllerTest#gatewayWirePayloadDeserializesIntoInput`.
 * Update BOTH together if a column is added/renamed.
 */
const AMS_INPUT_WIRE_KEYS = [
  'tag',
  'kind',
  'ecosystem',
  'manifest_path',
  'content',
  'package_lock_content',
  'resolved_dependencies',
].sort();

test('the gateway persist payload emits EXACTLY the AMS TargetManifestArtifactInput snake_case key set (no camelCase leak)', () => {
  const input = toTargetManifestArtifactInput({
    tag: 'web-app',
    ecosystem: 'NPM',
    kind: 'package.json',
    manifestPath: 'apps/web/package.json',
    content: '{}\n',
    packageLockContent: '{}\n',
    resolvedDependencies: [{ name: 'left-pad', resolvedVersion: '1.3.0' } as never],
  });

  // Exactly the AMS DTO key set — nothing extra, nothing missing.
  expect(Object.keys(input).sort()).toEqual(AMS_INPUT_WIRE_KEYS);

  // The serialized wire body the gateway POSTs carries the same key set (the
  // round-trip through JSON cannot introduce a camelCase alias).
  const onWire = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  expect(Object.keys(onWire).sort()).toEqual(AMS_INPUT_WIRE_KEYS);

  // Belt-and-braces: the renamed columns have NO camelCase twin on the wire.
  expect(onWire.manifestPath).toBeUndefined();
  expect(onWire.packageLockContent).toBeUndefined();
  expect(onWire.resolvedDependencies).toBeUndefined();
});

// ===========================================================================
// (4) DUAL FAIL-SOFT: upload persist throw AND spec-gen read throw -> safe no-ops
// ===========================================================================

function multerFile(originalname: string, content: string): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: Buffer.byteLength(content),
    buffer: Buffer.from(content, 'utf-8'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}

function passingOrchestratorDeps(): ManifestUploadOrchestratorDeps {
  return {
    fetchLatestCapturedDecisions: (async () =>
      []) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
    postCapturedDecision: (async (
      _p: string,
      _t: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => ({
      decisionId: `new-${body.decisionCode}`,
      projectId: PROJECT_ID,
      targetArchitectureId: TARGET_ARCH_ID,
      decisionCode: body.decisionCode,
      scopeKind: body.scopeKind,
      answerValue: body.answerValue,
      answerSummary: body.answerSummary ?? null,
      standardsLookupRef: body.standardsLookupRef ?? null,
      conversationThreadId: body.conversationThreadId ?? null,
      conversationTurnRef: body.conversationTurnRef ?? null,
      createdAt: '2026-06-25T12:00:00Z',
      createdByTask: body.createdByTask,
      supersededById: null,
    })) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
  };
}

const POM = '<project>\n  <artifactId>orders</artifactId>\n</project>\n';

test('dual fail-soft: a persist throw at upload AND a read throw at spec-gen BOTH degrade to safe no-ops', async () => {
  // --- Seam A: the upload persist throws -> response is unchanged (no reject). ---
  const throwingPersist: PersistConfirmedManifestsSeam = async () => {
    throw new Error('simulated AMS persist 500');
  };
  const okPersist: PersistConfirmedManifestsSeam = async () => {
    /* no-op */
  };

  const baseArgs = {
    files: [multerFile('services/orders/pom.xml', POM)],
    body: { tags: 'orders-service' },
    projectId: PROJECT_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    deps: passingOrchestratorDeps(),
  };

  const okRes = await buildTargetManifestUploadResponseWithAutoAnswer({
    ...baseArgs,
    persistConfirmedManifests: okPersist,
  });
  const failRes = await buildTargetManifestUploadResponseWithAutoAnswer({
    ...baseArgs,
    persistConfirmedManifests: throwingPersist,
  });

  // The upload response is byte-identical whether the persist succeeded or threw.
  expect(failRes.autoAnswer).toEqual(okRes.autoAnswer);
  expect(failRes.autoAnswer).not.toBeNull();
  expect(failRes.autoAnswer!.confirmedManifests[0].content).toBe(POM);

  // --- Seam B: the spec-gen read throws -> producer returns null (no throw). ---
  const throwingRead: FetchLatestTargetManifestArtifacts = async () => {
    throw new Error('simulated AMS read 503');
  };
  const source = createProductionSeedBuildFilesSource(throwingRead);
  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });
  expect(bundle).toBeNull();
});
