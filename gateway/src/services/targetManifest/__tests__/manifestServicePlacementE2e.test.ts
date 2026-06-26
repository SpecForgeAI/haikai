/**
 * Task Group 5 (gap-fill) — Spec 2026-06-26 target-manifest-service-association.
 *
 * Cross-tier END-TO-END seam the per-tier tests do NOT join up: the FR5
 * invariant that the picker-DERIVED tag (a `repoSubfolder` like
 * `services/orders` — i.e. a value carrying a path separator, the realistic
 * monorepo shape) survives the full gateway upload -> persist path UNCHANGED and
 * is the EXACT key the seed-build producer homes files under.
 *
 * The TG3 suite proves (a) the FK threads onto the persisted payload and
 * (b) `buildConventionServiceModuleMapping` copies `tag -> moduleDir` — but on a
 * HAND-BUILT artifact with a plain `orders-service` tag. It never drives a
 * subfolder-style derived tag through the real `buildTargetManifestUpload...`
 * flow and then feeds the SAME persisted artifacts into the producer. This test
 * closes that join: picker-derived `services/orders` tag + chosen service id ->
 * persisted `tag` === `services/orders` AND `target_service_element_id` mapped
 * AND seed placement `moduleDir` === `services/orders` (file placement preserved
 * with no producer change, the whole point of FR5).
 *
 * No Express server — operates on in-memory multer buffers + an injected persist
 * seam (mirrors manifestServiceAssociation.test.ts).
 */

import {
  buildTargetManifestUploadResponseWithAutoAnswer,
  toTargetManifestArtifactInput,
  type PersistConfirmedManifestsSeam,
} from '../../../routes/targetManifestUpload';
import type { ConfirmedManifestArtifact } from '../manifestHandoffs';
import { buildConventionServiceModuleMapping } from '../../migrationSeedBuildFilesProducer';
import { ManifestUploadOrchestratorDeps } from '../manifestUploadOrchestrator';
import { ManifestPrecedenceDeps } from '../manifestPrecedence';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SPRING_POM = `<project>
  <dependencies>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.7.4</version></dependency>
  </dependencies>
</project>`;

const BASE = { projectId: 'p1', targetArchitectureId: 't1' };
const SVC_ID = '11111111-2222-3333-4444-555555555555';
// The realistic FR5 derivation: a Service `repoSubfolder` used VERBATIM as the
// tag — note the path separator the slug derivation would never introduce.
const DERIVED_SUBFOLDER_TAG = 'services/orders';

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

function capturingPersist(): {
  seam: PersistConfirmedManifestsSeam;
  calls: { artifacts: ConfirmedManifestArtifact[] }[];
} {
  const calls: { artifacts: ConfirmedManifestArtifact[] }[] = [];
  const seam: PersistConfirmedManifestsSeam = async (_p, _t, artifacts) => {
    calls.push({ artifacts: [...artifacts] });
  };
  return { seam, calls };
}

test('picker-derived subfolder tag survives upload -> persist UNCHANGED and is the seed moduleDir placement key (FR5 end-to-end)', async () => {
  const { seam, calls } = capturingPersist();

  // The frontend derives `tag` from the chosen Service (here a repoSubfolder),
  // sends it as `tagsByFilename` alongside the chosen `serviceIdsByFilename`.
  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: {
      tagsByFilename: JSON.stringify({ 'services/orders/pom.xml': DERIVED_SUBFOLDER_TAG }),
      serviceIdsByFilename: JSON.stringify({ 'services/orders/pom.xml': SVC_ID }),
    },
    ...BASE,
    deps: passingOrchestratorDeps(),
    persistConfirmedManifests: seam,
  });

  // 1) The derived tag rode through onto the confirmed artifact verbatim.
  expect(res.autoAnswer!.confirmedManifests[0].tag).toBe(DERIVED_SUBFOLDER_TAG);
  expect(res.autoAnswer!.confirmedManifests[0].targetServiceElementId).toBe(SVC_ID);

  // 2) The SAME artifacts reached the persist seam; tag + FK map onto the wire.
  expect(calls).toHaveLength(1);
  const persisted = calls[0].artifacts;
  expect(persisted[0].tag).toBe(DERIVED_SUBFOLDER_TAG);
  const wire = toTargetManifestArtifactInput(persisted[0]);
  expect(wire.tag).toBe(DERIVED_SUBFOLDER_TAG);
  expect(wire.target_service_element_id).toBe(SVC_ID);

  // 3) The producer homes the file under that EXACT tag — `moduleDir` equals the
  // picker-derived subfolder, so seed-build placement is preserved with no
  // producer change (the FR5 contract: persisted tag === derived moduleDir).
  expect(buildConventionServiceModuleMapping(persisted)).toEqual({
    [DERIVED_SUBFOLDER_TAG]: { moduleDir: DERIVED_SUBFOLDER_TAG },
  });
});
