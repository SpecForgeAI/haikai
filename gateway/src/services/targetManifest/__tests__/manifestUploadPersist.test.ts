/**
 * Task Group 3 tests (Spec 5 Phase 2) — fail-soft persist-on-upload.
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring, tasks 3.1 / 3.3.
 *
 * Spec 3 builds the verbatim `ConfirmedManifestArtifact[]` at upload but only
 * surfaced them in the HTTP response. Spec 5 Phase 2 persists those bytes to the
 * AMS `target_manifest_artifacts` store immediately after they are built, keyed
 * by `(projectId, targetArchitectureId, tag)`, via a FAIL-SOFT call that must
 * NEVER break the upload response.
 *
 * These tests inject the AMS write seam as a stubbed dependency
 * (`persistConfirmedManifests`) — the SAME posture as the existing orchestrator
 * `deps` stubs in `manifestUploadRouteHandoff.test.ts` — and assert ONLY:
 *   (a) on a successful upload the persist is ATTEMPTED with the correctly-mapped
 *       snake_case payload (field mapping: `content` -> `content`,
 *       `packageLockContent` -> `package_lock_content`,
 *       `manifestPath` -> `manifest_path`,
 *       `resolvedDependencies` -> `resolved_dependencies`, plus
 *       `tag`/`ecosystem`/`kind`), keyed by `(projectId, targetArchitectureId,
 *       tag)` and carrying VERBATIM content;
 *   (b) FAIL-SOFT — a write hiccup (the stub throws) is swallowed + logged and
 *       the upload response is UNCHANGED (`autoAnswer` exactly as today).
 *
 * No Express server is needed — `buildTargetManifestUploadResponseWithAutoAnswer`
 * operates on in-memory multer file buffers + injected seams.
 */

import {
  buildTargetManifestUploadResponseWithAutoAnswer,
  freeFactsToTier2Wire,
  toTargetManifestArtifactInput,
  type PersistConfirmedManifestsSeam,
} from '../../../routes/targetManifestUpload';
import { ManifestUploadOrchestratorDeps } from '../manifestUploadOrchestrator';
import { ManifestPrecedenceDeps } from '../manifestPrecedence';
import type { ConfirmedManifestArtifact } from '../manifestHandoffs';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';
import { clearManifestLlmGapFillCache } from '../manifestLlmGapFill';
import type {
  ArchitectLlmClient,
  CallSingleShotResponse,
  SingleShotPrompt,
} from '../../architectConversation/architectLlmClient';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../../logger');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPRING_POM = `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.1</version>
  </parent>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.7.4</version></dependency>
  </dependencies>
</project>`;

const PACKAGE_JSON = `{
  "name": "web-app",
  "dependencies": { "left-pad": "1.3.0" }
}
`;

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
      createdAt: '2026-06-25T12:00:00Z',
      createdByTask: body.createdByTask,
      supersededById: null,
    })) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
  };
}

interface PersistCall {
  projectId: string;
  targetArchitectureId: string;
  artifacts: ConfirmedManifestArtifact[];
  tier2Facts: Array<{ friendly_name: string; coordinate: string }>;
}

function capturingPersist(): {
  seam: PersistConfirmedManifestsSeam;
  calls: PersistCall[];
} {
  const calls: PersistCall[] = [];
  const seam: PersistConfirmedManifestsSeam = async (
    projectId,
    targetArchitectureId,
    artifacts,
    tier2Facts,
  ) => {
    calls.push({
      projectId,
      targetArchitectureId,
      artifacts: [...artifacts],
      tier2Facts: tier2Facts ? tier2Facts.map((f) => ({ ...f })) : [],
    });
  };
  return { seam, calls };
}

const BASE = { projectId: 'p1', targetArchitectureId: 't1' };

// ---------------------------------------------------------------------------
// Tier-2 free-facts fixtures (Task Group 7). EM_DASH is the literal U+2014 the
// gap-fill label uses (mirrors the EM_DASH constant in manifestLlmGapFill.test.ts).
// ---------------------------------------------------------------------------

const EM_DASH = '—';

/** A pom whose ONLY dependency is UNMATCHED by the registry (drives the gap-fill). */
const MCP_POM = `<project>
  <dependencies>
    <dependency>
      <groupId>io.modelcontextprotocol</groupId>
      <artifactId>mcp-sdk</artifactId>
      <version>0.5.0</version>
    </dependency>
  </dependencies>
</project>`;

/** A fake single-shot client returning ONE Tier-2 free fact and no answers. */
function freeFactLlmClient(body: string): ArchitectLlmClient {
  return {
    callLlmToolLoop: async () => {
      throw new Error('callLlmToolLoop not used in the manifest gap-fill');
    },
    callSingleShot: async (_p: SingleShotPrompt): Promise<CallSingleShotResponse> => ({
      content: body,
    }),
  };
}

const MCP_LLM_BODY = JSON.stringify({
  answers: [],
  freeFacts: [{ friendlyName: 'MCP SDK', coordinate: 'io.modelcontextprotocol:mcp-sdk' }],
});

// ===========================================================================
// (a) Persist attempted with the correctly-mapped snake_case payload
// ===========================================================================

test('on a successful upload the persist is attempted, keyed by (projectId, targetArchitectureId), with verbatim content', async () => {
  const { seam, calls } = capturingPersist();

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: passingOrchestratorDeps(),
    persistConfirmedManifests: seam,
  });

  // Response slice is intact (the persist did not disturb it).
  expect(res.autoAnswer).not.toBeNull();
  expect(res.autoAnswer!.confirmedManifests).toHaveLength(1);

  // Persist attempted exactly once, keyed by the path ids.
  expect(calls).toHaveLength(1);
  expect(calls[0].projectId).toBe('p1');
  expect(calls[0].targetArchitectureId).toBe('t1');

  // The seam received the confirmed artifacts for the uploaded tag, verbatim.
  expect(calls[0].artifacts).toHaveLength(1);
  expect(calls[0].artifacts[0].tag).toBe('orders-service');
  expect(calls[0].artifacts[0].content).toBe(SPRING_POM); // byte-for-byte
});

test('the snake_case payload mapper carries every field verbatim (content/lock/path/deps + tag/ecosystem/kind)', () => {
  const verbatimPkg = PACKAGE_JSON;
  const verbatimLock = '{\n  "name": "web-app",\n  "lockfileVersion": 3\n}\n';
  const artifact: ConfirmedManifestArtifact = {
    tag: 'web-app',
    ecosystem: 'NPM',
    kind: 'package.json',
    manifestPath: 'apps/web/package.json',
    content: verbatimPkg,
    packageLockContent: verbatimLock,
    resolvedDependencies: [
      {
        name: 'left-pad',
        ecosystem: 'NPM',
        tag: 'web-app',
        manifestPath: 'apps/web/package.json',
        resolvedVersion: '1.3.0',
        versionUnknown: false,
        source: 'lockfile',
        declaredVersion: '1.3.0',
        declaredScope: 'dependencies',
        evidence: 'left-pad 1.3.0',
      },
    ],
  };

  const input = toTargetManifestArtifactInput(artifact);

  // snake_case field mapping (exactly the AMS TargetManifestArtifactInput shape).
  expect(input.tag).toBe('web-app');
  expect(input.ecosystem).toBe('NPM');
  expect(input.kind).toBe('package.json');
  expect(input.manifest_path).toBe('apps/web/package.json');
  // Verbatim content + lockfile, byte-for-byte (trailing newline preserved).
  expect(input.content).toBe(verbatimPkg);
  expect(input.package_lock_content).toBe(verbatimLock);
  // resolved_dependencies carried opaquely (one entry, name preserved).
  expect(input.resolved_dependencies).toHaveLength(1);
  expect(input.resolved_dependencies[0].name).toBe('left-pad');
  expect(input.resolved_dependencies[0].resolvedVersion).toBe('1.3.0');

  // No camelCase leakage of the renamed columns.
  const asRecord = input as unknown as Record<string, unknown>;
  expect(asRecord.manifestPath).toBeUndefined();
  expect(asRecord.packageLockContent).toBeUndefined();
  expect(asRecord.resolvedDependencies).toBeUndefined();
});

test('a Maven artifact maps package_lock_content to null', () => {
  const input = toTargetManifestArtifactInput({
    tag: 'orders-service',
    ecosystem: 'MAVEN',
    kind: 'pom.xml',
    manifestPath: 'pom.xml',
    content: SPRING_POM,
    packageLockContent: null,
    resolvedDependencies: [],
  });
  expect(input.package_lock_content).toBeNull();
  expect(input.content).toBe(SPRING_POM);
});

// ===========================================================================
// (b) FAIL-SOFT — a write hiccup is swallowed + logged; response unchanged
// ===========================================================================

test('a persist write hiccup is swallowed + logged and the upload response is unchanged (fail-soft)', async () => {
  const throwingPersist: PersistConfirmedManifestsSeam = async () => {
    throw new Error('simulated AMS manifest-artifacts 500');
  };

  // Baseline response with a NO-OP persist (proves the persist outcome does not
  // change the response shape).
  const okRes = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: passingOrchestratorDeps(),
    persistConfirmedManifests: async () => {
      /* no-op */
    },
  });

  // Same upload, but the persist THROWS — must not reject, must not alter output.
  const failRes = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: passingOrchestratorDeps(),
    persistConfirmedManifests: throwingPersist,
  });

  // The response's OTHER slices are byte-identical to the no-op-persist run.
  expect(failRes.autoAnswer).toEqual(okRes.autoAnswer);
  expect(failRes.autoAnswer).not.toBeNull();
  expect(failRes.autoAnswer!.confirmedManifests[0].content).toBe(SPRING_POM);
  expect(failRes.parsedManifests).toEqual(okRes.parsedManifests);

  // 2026-08-14: the persist outcome is LOUD on the response — the operator
  // must see that the manifest store did not update (the plan's scaffold
  // story depends on this persist), not just a gateway log line.
  expect(okRes.manifestPersist).toMatchObject({ status: 'ok', artifactCount: 1 });
  expect(failRes.manifestPersist).toMatchObject({ status: 'failed', artifactCount: 1 });
  expect(String(failRes.manifestPersist?.error)).toContain(
    'simulated AMS manifest-artifacts 500',
  );

  // The failure was ALSO logged via the [diag-gateway] posture (no silent drop).
  const failedLogs = (logger.warn as jest.Mock).mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === 'string' &&
      c[0].includes('[diag-gateway]') &&
      c[0].includes('persist_confirmed_manifests_failed'),
  );
  expect(failedLogs.length).toBeGreaterThanOrEqual(1);
});

// ===========================================================================
// (c) Tier-2 free facts (Task Group 7): label split + response surfacing +
//     persist onto the EXISTING store + fail-soft.
// ===========================================================================

test('freeFactsToTier2Wire splits the friendly/coordinate labels into { friendly_name, coordinate } (last-separator + separator-less tolerant)', () => {
  expect(
    freeFactsToTier2Wire([
      `MCP SDK ${EM_DASH} io.modelcontextprotocol.sdk`,
      `Spring AI / LLM client ${EM_DASH} spring-ai-openai`,
    ]),
  ).toEqual([
    { friendly_name: 'MCP SDK', coordinate: 'io.modelcontextprotocol.sdk' },
    { friendly_name: 'Spring AI / LLM client', coordinate: 'spring-ai-openai' },
  ]);

  // A separator-less label keeps the whole string as the friendly name (no
  // coordinate); blank / whitespace-only labels are dropped.
  expect(freeFactsToTier2Wire(['LoneWord', '   '])).toEqual([
    { friendly_name: 'LoneWord', coordinate: '' },
  ]);
});

test('toTargetManifestArtifactInput defaults tier2_facts to [] and carries the provided facts (snake_case)', () => {
  const artifact: ConfirmedManifestArtifact = {
    tag: 'web',
    ecosystem: 'NPM',
    kind: 'package.json',
    manifestPath: 'package.json',
    content: '{}',
    packageLockContent: null,
    resolvedDependencies: [],
  };
  expect(toTargetManifestArtifactInput(artifact).tier2_facts).toEqual([]);
  expect(
    toTargetManifestArtifactInput(artifact, [
      { friendly_name: 'MCP SDK', coordinate: 'io.modelcontextprotocol.sdk' },
    ]).tier2_facts,
  ).toEqual([{ friendly_name: 'MCP SDK', coordinate: 'io.modelcontextprotocol.sdk' }]);
});

test('Tier-2 free facts surface on autoAnswer.freeFacts AND persist (split) onto the existing store', async () => {
  clearManifestLlmGapFillCache();
  const { seam, calls } = capturingPersist();

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', MCP_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: { ...passingOrchestratorDeps(), llmClient: freeFactLlmClient(MCP_LLM_BODY) },
    persistConfirmedManifests: seam,
  });

  // The response surfaces the friendly-name / coordinate label.
  expect(res.autoAnswer).not.toBeNull();
  expect(res.autoAnswer!.freeFacts).toEqual([
    `MCP SDK ${EM_DASH} io.modelcontextprotocol:mcp-sdk`,
  ]);

  // The persist rode the EXISTING store seam, carrying the split structured facts.
  expect(calls).toHaveLength(1);
  expect(calls[0].tier2Facts).toEqual([
    { friendly_name: 'MCP SDK', coordinate: 'io.modelcontextprotocol:mcp-sdk' },
  ]);
});

test('a Tier-2 persist hiccup never blocks the response (fail-soft): freeFacts still surface', async () => {
  clearManifestLlmGapFillCache();
  const throwingPersist: PersistConfirmedManifestsSeam = async () => {
    throw new Error('simulated AMS manifest-artifacts 500');
  };

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', MCP_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: { ...passingOrchestratorDeps(), llmClient: freeFactLlmClient(MCP_LLM_BODY) },
    persistConfirmedManifests: throwingPersist,
  });

  expect(res.autoAnswer).not.toBeNull();
  expect(res.autoAnswer!.freeFacts).toEqual([
    `MCP SDK ${EM_DASH} io.modelcontextprotocol:mcp-sdk`,
  ]);
});
