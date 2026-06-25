/**
 * Task Group 6 tests — route-level end-to-end wiring + Spec 4 / Spec 5 hand-offs.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), tasks 6.3-6.5.
 *
 * The Group 1-4 unit suites cover parse / resolve / auto-answer / precedence in
 * isolation. The CRITICAL gap these strategic tests fill is the END-TO-END seam
 * the route now owns (`buildTargetManifestUploadResponseWithAutoAnswer`) plus the
 * hand-off builders (`manifestHandoffs.ts`):
 *
 *   1. upload(parse) → resolve → auto-answer → recompute → hand-off slice, with
 *      the POST + read seams injected (no HTTP). Asserts the response carries the
 *      written codes, the recomputed `resolvedTargetVersions` (Spec 4 source),
 *      and the confirmed per-tag manifest artifacts (Spec 5 source).
 *   2. the re-upload iterate loop end-to-end: a MANUAL row is PRESERVED (skipped)
 *      while a prior manifest row is SUPERSEDED (re-POSTed), and the recompute
 *      reflects manual-wins.
 *   3. a 100%-dropped upload yields a null auto-answer slice (nothing to resolve)
 *      while still surfacing the drop (no silent drop) — and never throws.
 *   4. first-POST-failure surfaces partial-success on the slice (aborted) without
 *      throwing through the route.
 *   5. the Spec 4 named accessor passes `version-unknown` through unchanged; the
 *      Spec 5 confirmed artifact carries the VERBATIM manifest content + tag.
 *
 * No Express server is needed — `buildTargetManifestUploadResponseWithAutoAnswer`
 * operates on in-memory multer file buffers + injected orchestrator deps.
 */

import {
  buildTargetManifestUploadResponseWithAutoAnswer,
} from '../../../routes/targetManifestUpload';
import {
  ManifestUploadOrchestratorDeps,
} from '../manifestUploadOrchestrator';
import {
  TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
} from '../manifestAutoAnswerer';
import {
  ManifestPrecedenceDeps,
  ResolvedTargetVersion,
} from '../manifestPrecedence';
import {
  selectSpec4TargetVersionSource,
  partitionByVersionKnown,
  buildConfirmedManifestArtifacts,
} from '../manifestHandoffs';
import { resolveManifestVersions } from '../manifestVersionResolution';
import { resolveMavenManifest } from '../manifestDependencyResolvers';
import { ParsedManifest } from '../parsedManifestModel';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

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

interface PostCall {
  body: CreateCapturedDecisionRequestBody;
}

function makeDeps(latest: TargetStateCapturedDecision[]): {
  deps: ManifestUploadOrchestratorDeps;
  postCalls: PostCall[];
} {
  const postCalls: PostCall[] = [];
  const deps: ManifestUploadOrchestratorDeps = {
    fetchLatestCapturedDecisions: (async () =>
      latest) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
    postCapturedDecision: (async (
      _p: string,
      _t: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      postCalls.push({ body });
      return {
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
        createdAt: '2026-06-24T12:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
    }) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
  };
  return { deps, postCalls };
}

function failingPostDeps(): {
  deps: ManifestUploadOrchestratorDeps;
  attempts: string[];
} {
  const attempts: string[] = [];
  const deps: ManifestUploadOrchestratorDeps = {
    fetchLatestCapturedDecisions: (async () =>
      []) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
    postCapturedDecision: (async (
      _p: string,
      _t: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      attempts.push(body.decisionCode);
      // Fail on the VERY FIRST write to exercise the abort-remaining path.
      throw new Error('simulated AMS 500');
    }) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
  };
  return { deps, attempts };
}

function manualRow(
  decisionCode: string,
  value: { framework: string; version: string },
): TargetStateCapturedDecision {
  return {
    decisionId: `man-${decisionCode}`,
    projectId: 'p1',
    targetArchitectureId: 't1',
    decisionCode,
    scopeKind: 'architecture',
    answerValue: JSON.stringify({ value, sourceQuote: null, sourceFile: null }),
    answerSummary: `${value.framework} ${value.version}`,
    standardsLookupRef: null,
    conversationThreadId: 'thread-1',
    conversationTurnRef: null,
    createdAt: '2026-06-24T10:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
  };
}

const BASE = { projectId: 'p1', targetArchitectureId: 't1' };

// ===========================================================================
// 1. End-to-end: parse → resolve → auto-answer → recompute → hand-off slice
// ===========================================================================

test('end-to-end upload wires parse → auto-answer → hand-off slice (Spec 4 + Spec 5 sources)', async () => {
  const { deps, postCalls } = makeDeps([]);

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps,
  });

  // Parse slice intact.
  expect(res.parsedManifests).toHaveLength(1);
  expect(res.parsedManifests[0].tag).toBe('orders-service');

  // Auto-answer slice present.
  expect(res.autoAnswer).not.toBeNull();
  const aa = res.autoAnswer!;
  // service.framework (Spring Boot 3.4.1 from parent), db.driver (pgjdbc 42.7.4)
  // and build.tool were written via the POST seam with the manifest task name.
  expect(postCalls.every((c) => c.body.createdByTask === TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME)).toBe(true);
  expect(aa.writtenCodes).toEqual(expect.arrayContaining(['service.framework', 'db.driver', 'build.tool']));
  expect(aa.aborted).toBe(false);

  // Spec 4 hand-off: the recomputed structured target-version set.
  const fw = aa.resolvedTargetVersions.find((v) => v.decisionCode === 'service.framework');
  expect(fw).toMatchObject({ framework: 'Spring Boot', version: '3.4.1', provenance: 'manifest' });

  // Spec 5 hand-off: the confirmed per-tag manifest carries the VERBATIM content.
  expect(aa.confirmedManifests).toHaveLength(1);
  expect(aa.confirmedManifests[0].tag).toBe('orders-service');
  expect(aa.confirmedManifests[0].content).toBe(SPRING_POM);
  expect(aa.confirmedManifests[0].resolvedDependencies.length).toBeGreaterThan(0);
});

// ===========================================================================
// 2. Re-upload iterate loop: preserve manual, supersede manifest, recompute
// ===========================================================================

test('re-upload preserves a manual answer (skipped) and supersedes a manifest row (re-POST)', async () => {
  // A manual service.framework (Quarkus) exists; a manifest upload must NOT
  // overwrite it. db.driver + build.tool still write (supersede path).
  const latest = [manualRow('service.framework', { framework: 'Quarkus', version: '3.10' })];
  const { deps, postCalls } = makeDeps(latest);

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps,
  });

  const aa = res.autoAnswer!;
  const written = postCalls.map((c) => c.body.decisionCode);
  expect(written).not.toContain('service.framework'); // manual preserved
  expect(aa.skippedManualCodes).toContain('service.framework');
  expect(written).toContain('db.driver');

  // Recompute reflects the MANUAL Quarkus answer (manual wins).
  const fw = aa.resolvedTargetVersions.find((v) => v.decisionCode === 'service.framework');
  expect(fw).toMatchObject({ framework: 'Quarkus', provenance: 'manual' });
});

// ===========================================================================
// 3. 100%-dropped upload → null auto-answer slice, drop surfaced, no throw
// ===========================================================================

test('a 100%-dropped upload returns a null auto-answer slice and surfaces the drop (no silent drop, no throw)', async () => {
  const { deps, postCalls } = makeDeps([]);

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('build.gradle', 'plugins { id "java" }')],
    body: { tags: 'svc' },
    ...BASE,
    deps,
  });

  expect(res.parsedManifests).toHaveLength(0);
  expect(res.droppedManifests).toHaveLength(1);
  expect(res.droppedManifests[0].reason).toMatch(/Unsupported file/);
  // Nothing to resolve/answer → no orchestration ran.
  expect(res.autoAnswer).toBeNull();
  expect(postCalls).toHaveLength(0);
});

// ===========================================================================
// 4. First-POST-failure → partial-success on the slice (no throw)
// ===========================================================================

test('a first-POST failure surfaces partial-success (aborted) on the slice without throwing', async () => {
  const { deps, attempts } = failingPostDeps();

  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', SPRING_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps,
  });

  const aa = res.autoAnswer!;
  expect(aa.aborted).toBe(true);
  expect(aa.rowsWritten).toBe(0);
  expect(aa.failureReason).toMatch(/simulated AMS 500/);
  // Exactly ONE write was attempted before the abort (the rest were skipped).
  expect(attempts).toHaveLength(1);
  expect(aa.partialFailureCodes.length).toBeGreaterThanOrEqual(1);
});

// ===========================================================================
// 5. Hand-off builders: Spec 4 passthrough + Spec 5 verbatim artifact
// ===========================================================================

test('Spec 4 accessor passes version-unknown through unchanged; partition splits concrete vs unknown', () => {
  const set: ResolvedTargetVersion[] = [
    { decisionCode: 'service.framework', framework: 'Spring Boot', version: '3.4.1', versionUnknown: false, provenance: 'manifest', sourceFile: 'pom.xml' },
    { decisionCode: 'db.driver', framework: 'pgjdbc', version: 'version-unknown', versionUnknown: true, provenance: 'manifest', sourceFile: 'pom.xml' },
  ];
  const selected = selectSpec4TargetVersionSource(set);
  // Defensive copy (mutating the copy does not mutate the source).
  selected[0].framework = 'MUTATED';
  expect(set[0].framework).toBe('Spring Boot');
  // version-unknown passes through unchanged.
  const unknown = selected.find((v) => v.decisionCode === 'db.driver');
  expect(unknown!.version).toBe('version-unknown');
  expect(unknown!.versionUnknown).toBe(true);

  const { concrete, versionUnknown } = partitionByVersionKnown(set);
  expect(concrete.map((v) => v.decisionCode)).toEqual(['service.framework']);
  expect(versionUnknown.map((v) => v.decisionCode)).toEqual(['db.driver']);
});

test('Spec 5 confirmed artifact carries the verbatim manifest content + tag + resolved deps', () => {
  const parsed: ParsedManifest = {
    status: 'parsed', ecosystem: 'MAVEN', kind: 'pom.xml', tag: 'orders-service',
    manifestPath: 'services/orders/pom.xml',
    declaredDependencies: resolveMavenManifest(SPRING_POM, 'services/orders/pom.xml'),
    rawPomContent: SPRING_POM,
    rawManifestContent: SPRING_POM,
    packageLockContent: null,
  };
  const resolved = resolveManifestVersions(parsed);
  const artifacts = buildConfirmedManifestArtifacts([parsed], [resolved]);

  expect(artifacts).toHaveLength(1);
  expect(artifacts[0].tag).toBe('orders-service');
  expect(artifacts[0].content).toBe(SPRING_POM); // VERBATIM
  expect(artifacts[0].ecosystem).toBe('MAVEN');
  expect(artifacts[0].resolvedDependencies.length).toBe(parsed.declaredDependencies.length);
});
