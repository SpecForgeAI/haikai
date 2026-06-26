/**
 * Task Group 3 tests (Spec 2026-06-26 target-manifest-service-association).
 *
 * Covers the gateway wire-type + upload-route threading of the new per-manifest
 * target Service FK (`target_service_element_id`), PARALLEL to the existing
 * `tags` / `tagsByFilename` / `pickTag` seam:
 *
 *   - `resolveServiceIdsFromBody` parses the `serviceIdsByFilename` JSON map the
 *     frontend sends (and tolerates a malformed map);
 *   - `buildConfirmedManifestArtifacts` carries the resolved service id onto each
 *     `ConfirmedManifestArtifact` (defaulting to null when unbound);
 *   - the full upload flow threads the id from the body onto each confirmed
 *     artifact AND into the persisted payload;
 *   - `toTargetManifestArtifactInput` maps `targetServiceElementId` ->
 *     `target_service_element_id` (including the null case);
 *   - (3.4 confirming) the seed `tag -> { moduleDir: tag }` mapping is unchanged
 *     and indifferent to the FK — placement stays keyed on the (now derived) tag.
 *
 * No Express server — `buildTargetManifestUploadResponseWithAutoAnswer` operates
 * on in-memory multer buffers + injected seams (mirrors manifestUploadPersist.test.ts).
 */

import {
  buildTargetManifestUploadResponseWithAutoAnswer,
  resolveServiceIdsFromBody,
  toTargetManifestArtifactInput,
  type PersistConfirmedManifestsSeam,
} from '../../../routes/targetManifestUpload';
import {
  buildConfirmedManifestArtifacts,
  type ConfirmedManifestArtifact,
} from '../manifestHandoffs';
import { buildConventionServiceModuleMapping } from '../../migrationSeedBuildFilesProducer';
import { ManifestUploadOrchestratorDeps } from '../manifestUploadOrchestrator';
import { ManifestPrecedenceDeps } from '../manifestPrecedence';
import type { ParsedManifest } from '../parsedManifestModel';
import type { ResolvedManifest } from '../manifestVersionResolution';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPRING_POM = `<project>
  <dependencies>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.7.4</version></dependency>
  </dependencies>
</project>`;

const BASE = { projectId: 'p1', targetArchitectureId: 't1' };
const SVC_ID = '11111111-2222-3333-4444-555555555555';

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

/** Orchestrator deps that succeed (write everything, no manual rows). */
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
      projectId: 'p1',
      targetArchitectureId: 't1',
      decisionCode: body.decisionCode,
      scopeKind: body.scopeKind,
      answerValue: body.answerValue,
      answerSummary: body.answerSummary ?? null,
      standardsLookupRef: body.standardsLookupRef ?? null,
      conversationThreadId: body.conversationThreadId ?? null,
      conversationTurnRef: body.conversationTurnRef ?? null,
      createdAt: '2026-06-26T12:00:00Z',
      createdByTask: body.createdByTask,
      supersededById: null,
    })) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
  };
}

interface PersistCall {
  artifacts: ConfirmedManifestArtifact[];
}

function capturingPersist(): { seam: PersistConfirmedManifestsSeam; calls: PersistCall[] } {
  const calls: PersistCall[] = [];
  const seam: PersistConfirmedManifestsSeam = async (_p, _t, artifacts) => {
    calls.push({ artifacts: [...artifacts] });
  };
  return { seam, calls };
}

// ===========================================================================
// resolveServiceIdsFromBody — parses the serviceIdsByFilename JSON map
// ===========================================================================

test('resolveServiceIdsFromBody parses the serviceIdsByFilename JSON map (the frontend contract)', () => {
  const resolved = resolveServiceIdsFromBody({
    serviceIdsByFilename: JSON.stringify({
      'services/orders/pom.xml': SVC_ID,
      'apps/web/package.json': 'svc-web',
    }),
  });
  expect(resolved.byFilename).toEqual({
    'services/orders/pom.xml': SVC_ID,
    'apps/web/package.json': 'svc-web',
  });
});

test('resolveServiceIdsFromBody tolerates a malformed map and still reads the positional list', () => {
  const resolved = resolveServiceIdsFromBody({
    serviceIdsByFilename: '{ not json',
    serviceIds: ['a', 'b'],
  });
  expect(resolved.byFilename).toEqual({});
  expect(resolved.positional).toEqual(['a', 'b']);
});

// ===========================================================================
// buildConfirmedManifestArtifacts — carries the resolved id (default null)
// ===========================================================================

test('buildConfirmedManifestArtifacts carries the resolved service id per manifestPath (default null)', () => {
  const parsed = [
    {
      status: 'parsed',
      tag: 'orders-service',
      ecosystem: 'MAVEN',
      kind: 'pom.xml',
      manifestPath: 'services/orders/pom.xml',
      rawManifestContent: SPRING_POM,
      packageLockContent: null,
      declaredDependencies: [],
    },
    {
      status: 'parsed',
      tag: 'web-app',
      ecosystem: 'NPM',
      kind: 'package.json',
      manifestPath: 'apps/web/package.json',
      rawManifestContent: '{}',
      packageLockContent: null,
      declaredDependencies: [],
    },
  ] as unknown as ParsedManifest[];
  const resolvedManifests = [
    { manifestPath: 'services/orders/pom.xml', resolvedDependencies: [] },
    { manifestPath: 'apps/web/package.json', resolvedDependencies: [] },
  ] as unknown as ResolvedManifest[];

  // Resolver binds ONLY the first manifest; the second is left unbound (null).
  const byPath: Record<string, string> = { 'services/orders/pom.xml': SVC_ID };
  const artifacts = buildConfirmedManifestArtifacts(
    parsed,
    resolvedManifests,
    (manifestPath) => byPath[manifestPath] ?? null,
  );

  expect(artifacts[0].targetServiceElementId).toBe(SVC_ID);
  expect(artifacts[1].targetServiceElementId).toBeNull();

  // Default resolver (omitted) leaves every artifact unbound.
  const noResolver = buildConfirmedManifestArtifacts(parsed, resolvedManifests);
  expect(noResolver[0].targetServiceElementId).toBeNull();
});

// ===========================================================================
// Full upload flow — id threads onto the artifact AND into the persisted payload
// ===========================================================================

test('the upload flow threads serviceIdsByFilename onto each ConfirmedManifestArtifact and into the persisted payload', async () => {
  const { seam, calls } = capturingPersist();

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: {
      tags: 'orders-service',
      serviceIdsByFilename: JSON.stringify({ 'services/orders/pom.xml': SVC_ID }),
    },
    ...BASE,
    deps: passingOrchestratorDeps(),
    persistConfirmedManifests: seam,
  });

  // Surfaced on the response artifact.
  expect(res.autoAnswer).not.toBeNull();
  expect(res.autoAnswer!.confirmedManifests).toHaveLength(1);
  expect(res.autoAnswer!.confirmedManifests[0].targetServiceElementId).toBe(SVC_ID);

  // Carried into the persist seam, and maps onto the snake_case persisted payload.
  expect(calls).toHaveLength(1);
  expect(calls[0].artifacts[0].targetServiceElementId).toBe(SVC_ID);
  expect(toTargetManifestArtifactInput(calls[0].artifacts[0]).target_service_element_id).toBe(
    SVC_ID,
  );
});

test('an upload with no serviceIdsByFilename leaves the FK null end-to-end', async () => {
  const { seam, calls } = capturingPersist();

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: passingOrchestratorDeps(),
    persistConfirmedManifests: seam,
  });

  expect(res.autoAnswer!.confirmedManifests[0].targetServiceElementId).toBeNull();
  expect(toTargetManifestArtifactInput(calls[0].artifacts[0]).target_service_element_id).toBeNull();
});

// ===========================================================================
// toTargetManifestArtifactInput — maps the FK (including null)
// ===========================================================================

test('toTargetManifestArtifactInput maps targetServiceElementId -> target_service_element_id (and null when absent)', () => {
  const base: ConfirmedManifestArtifact = {
    tag: 'orders-service',
    ecosystem: 'MAVEN',
    kind: 'pom.xml',
    manifestPath: 'services/orders/pom.xml',
    content: SPRING_POM,
    packageLockContent: null,
    resolvedDependencies: [],
  };

  // Bound id maps through to the snake_case wire field.
  expect(
    toTargetManifestArtifactInput({ ...base, targetServiceElementId: SVC_ID })
      .target_service_element_id,
  ).toBe(SVC_ID);

  // Absent (undefined) -> null; explicit null -> null.
  expect(toTargetManifestArtifactInput(base).target_service_element_id).toBeNull();
  expect(
    toTargetManifestArtifactInput({ ...base, targetServiceElementId: null })
      .target_service_element_id,
  ).toBeNull();

  // No camelCase leakage of the FK column.
  const asRecord = toTargetManifestArtifactInput(base) as unknown as Record<string, unknown>;
  expect(asRecord.targetServiceElementId).toBeUndefined();
});

// ===========================================================================
// Task 3.4 (confirming) — seed tag -> moduleDir mapping is unchanged by the FK
// ===========================================================================

test('seed buildConventionServiceModuleMapping still keys placement on the tag, indifferent to the FK (3.4 confirming)', () => {
  // A full ConfirmedManifestArtifact carrying a bound FK — structurally a
  // ConfirmedManifestArtifactLike the producer consumes (it reads only `tag`).
  const artifact: ConfirmedManifestArtifact = {
    tag: 'orders-service',
    ecosystem: 'MAVEN',
    kind: 'pom.xml',
    manifestPath: 'services/orders/pom.xml',
    content: SPRING_POM,
    packageLockContent: null,
    resolvedDependencies: [],
    targetServiceElementId: SVC_ID,
  };

  // Placement is derived from the tag alone; the service FK does not alter it
  // (the persisted tag now EQUALS the Service-derived moduleDir, so no change).
  expect(buildConventionServiceModuleMapping([artifact])).toEqual({
    'orders-service': { moduleDir: 'orders-service' },
  });
});
