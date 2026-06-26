/**
 * Task Group 4 tests — Manual-wins precedence + re-upload supersede / preserve /
 * recompute.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), task 4.1.
 *
 * Scope (2-8 focused tests):
 *   (a) a manual answer (createdByTask = 'architect-persona-conversation') for a
 *       code is PRESERVED — a manifest upload does NOT overwrite it;
 *   (b) re-upload SUPERSEDES the PRIOR manifest-derived row for the same
 *       code/module via the append-only convention (POST-only — no PATCH/DELETE);
 *   (c) after supersession the resolved target-version set RECOMPUTES from the
 *       latest manifests + surviving manual edits;
 *   (d) a version-unknown manual override is honoured.
 *
 * The read seam (`fetchLatestCapturedDecisions`) and the POST seam are both
 * injected — no HTTP. Versions are resolved through the real Group 1+2 functions.
 */

import { resolveManifestVersions } from '../manifestVersionResolution';
import { ParsedManifest } from '../parsedManifestModel';
import { resolveMavenManifest } from '../manifestDependencyResolvers';
import {
  deriveManifestAnswerCandidates,
  dedupeCandidatesByPrecedence,
  TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
} from '../manifestAutoAnswerer';
import type { ManifestAnswerCandidate } from '../manifestAutoAnswerer';
import {
  filterCandidatesByPrecedence,
  recomputeResolvedTargetVersions,
  isManualDecisionRow,
  TECH_STACK_PREFILL_TASK_NAME,
  ManifestPrecedenceDeps,
} from '../manifestPrecedence';
import {
  ManifestUploadOrchestratorDeps,
  processManifestUpload,
} from '../manifestUploadOrchestrator';
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

function springResolvedManifest(path = 'services/orders/pom.xml') {
  const parsed: ParsedManifest = {
    status: 'parsed', ecosystem: 'MAVEN', kind: 'pom.xml', tag: 'orders-service',
    manifestPath: path,
    declaredDependencies: resolveMavenManifest(SPRING_POM, path),
    rawPomContent: SPRING_POM, packageLockContent: null,
  };
  return resolveManifestVersions(parsed);
}

function springParsedManifest(path = 'services/orders/pom.xml'): ParsedManifest {
  return {
    status: 'parsed', ecosystem: 'MAVEN', kind: 'pom.xml', tag: 'orders-service',
    manifestPath: path,
    declaredDependencies: resolveMavenManifest(SPRING_POM, path),
    rawPomContent: SPRING_POM, packageLockContent: null,
  };
}

function manualRow(
  decisionCode: string,
  value: { framework: string; version: string },
  createdByTask = 'architect-persona-conversation',
): TargetStateCapturedDecision {
  return {
    decisionId: `man-${decisionCode}`,
    projectId: 'proj-1',
    targetArchitectureId: 'arch-target',
    decisionCode,
    scopeKind: 'architecture',
    answerValue: JSON.stringify({ value, sourceQuote: null, sourceFile: null }),
    answerSummary: `${value.framework} ${value.version}`,
    standardsLookupRef: null,
    conversationThreadId: 'thread-1',
    conversationTurnRef: null,
    createdAt: '2026-06-24T10:00:00Z',
    createdByTask,
    supersededById: null,
  };
}

function manifestRow(decisionCode: string): TargetStateCapturedDecision {
  return {
    decisionId: `mani-${decisionCode}`,
    projectId: 'proj-1',
    targetArchitectureId: 'arch-target',
    decisionCode,
    scopeKind: 'architecture',
    answerValue: JSON.stringify({
      value: { framework: 'Spring Boot', version: '3.3.0' },
      sourceQuote: 'old',
      sourceFile: 'services/orders/pom.xml',
    }),
    answerSummary: 'Spring Boot 3.3.0',
    standardsLookupRef: null,
    conversationThreadId: null,
    conversationTurnRef: null,
    createdAt: '2026-06-24T09:00:00Z',
    createdByTask: TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
    supersededById: null,
  };
}

interface PostCall {
  body: CreateCapturedDecisionRequestBody;
  method: 'POST';
}

function makeOrchestratorDeps(latest: TargetStateCapturedDecision[]): {
  deps: ManifestUploadOrchestratorDeps;
  postCalls: PostCall[];
} {
  const postCalls: PostCall[] = [];
  const deps: ManifestUploadOrchestratorDeps = {
    fetchLatestCapturedDecisions: (async () => latest) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
    postCapturedDecision: (async (
      _projectId: string,
      _targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      // The ONLY mutation seam is a POST. There is no PATCH/DELETE seam exposed
      // anywhere in this pipeline — AMS sets supersededById inside its txn.
      postCalls.push({ body, method: 'POST' });
      return {
        decisionId: `new-${body.decisionCode}`,
        projectId: 'proj-1',
        targetArchitectureId: 'arch-target',
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

const ARGS = {
  projectId: 'proj-1',
  targetArchitectureId: 'arch-target',
  conversationThreadId: 'thread-1',
};

// ---------------------------------------------------------------------------
// (a) a manual answer is preserved — manifest does NOT overwrite it
// ---------------------------------------------------------------------------

test('(a) a manual answer for a code is preserved; the manifest write is skipped', async () => {
  // A manual service.framework answer already exists (user walked it).
  const latest = [manualRow('service.framework', { framework: 'Quarkus', version: '3.10' })];
  const { deps, postCalls } = makeOrchestratorDeps(latest);

  const result = await processManifestUpload(
    { ...ARGS, parsedManifests: [springParsedManifest()] },
    deps,
  );

  // service.framework is SKIPPED (manual preserved); db.driver + build.tool still written.
  const writtenCodes = postCalls.map((c) => c.body.decisionCode);
  expect(writtenCodes).not.toContain('service.framework');
  expect(result.skippedManualCodes).toContain('service.framework');
  expect(writtenCodes).toContain('db.driver');
  expect(writtenCodes).toContain('build.tool');

  // The recomputed set still shows the MANUAL Quarkus answer (manual wins).
  const fw = result.resolvedTargetVersions.find((v) => v.decisionCode === 'service.framework');
  expect(fw).toBeDefined();
  expect(fw!.framework).toBe('Quarkus');
  expect(fw!.provenance).toBe('manual');
});

// ---------------------------------------------------------------------------
// (b) re-upload supersedes the prior manifest-derived row (POST-only)
// ---------------------------------------------------------------------------

test('(b) re-upload supersedes a prior manifest-derived row for the same code via POST-only append', async () => {
  // A prior MANIFEST-derived service.framework row exists (older Spring Boot 3.3.0).
  const latest = [manifestRow('service.framework')];
  const { deps, postCalls } = makeOrchestratorDeps(latest);

  const result = await processManifestUpload(
    { ...ARGS, parsedManifests: [springParsedManifest()] },
    deps,
  );

  // The manifest row is NOT preserved (it is supersedable) — a NEW row is POSTed
  // for service.framework, driving AMS's append-only supersession of the prior.
  const fwPost = postCalls.find((c) => c.body.decisionCode === 'service.framework');
  expect(fwPost).toBeDefined();
  expect(fwPost!.method).toBe('POST');
  expect(fwPost!.body.createdByTask).toBe(TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME);
  // New resolved version (3.4.1) supersedes the old (3.3.0).
  expect(JSON.parse(fwPost!.body.answerValue).value).toEqual({
    framework: 'Spring Boot', version: '3.4.1',
  });
  expect(result.skippedManualCodes).not.toContain('service.framework');

  // Every mutation in the pipeline is a POST — no PATCH/DELETE seam exists.
  expect(postCalls.every((c) => c.method === 'POST')).toBe(true);
});

// ---------------------------------------------------------------------------
// (c) recompute reflects latest manifests + surviving manual edits
// ---------------------------------------------------------------------------

test('(c) recompute reflects the latest manifests overlaid with surviving manual edits', async () => {
  // db.driver was manually overridden; service.framework has no manual row.
  const latest = [manualRow('db.driver', { framework: 'pgjdbc', version: '42.7.0' })];

  const resolved = springResolvedManifest();
  const candidates = deriveManifestAnswerCandidates([resolved]);

  const recomputed = recomputeResolvedTargetVersions({
    resolvedManifests: [resolved],
    manifestCandidates: candidates,
    latestDecisions: latest,
  });

  const byCode = Object.fromEntries(recomputed.map((v) => [v.decisionCode, v]));
  // Manifest-derived framework (latest manifest, concrete 3.4.1).
  expect(byCode['service.framework'].version).toBe('3.4.1');
  expect(byCode['service.framework'].provenance).toBe('manifest');
  // Surviving manual driver override wins over the manifest's 42.7.4.
  expect(byCode['db.driver'].version).toBe('42.7.0');
  expect(byCode['db.driver'].provenance).toBe('manual');
});

// ---------------------------------------------------------------------------
// (d) a version-unknown manual override is honoured
// ---------------------------------------------------------------------------

test('(d) a version-unknown manual override is preserved and passes through recompute', async () => {
  // The user manually set service.framework to an explicit version-unknown.
  const latest = [
    manualRow('service.framework', { framework: 'Spring Boot', version: 'version-unknown' }),
  ];
  const { deps, postCalls } = makeOrchestratorDeps(latest);

  const result = await processManifestUpload(
    { ...ARGS, parsedManifests: [springParsedManifest()] },
    deps,
  );

  // Manual version-unknown is preserved — manifest does NOT overwrite it.
  expect(postCalls.map((c) => c.body.decisionCode)).not.toContain('service.framework');
  expect(result.skippedManualCodes).toContain('service.framework');

  // Recompute passes the version-unknown through unchanged (not fabricated).
  const fw = result.resolvedTargetVersions.find((v) => v.decisionCode === 'service.framework');
  expect(fw).toBeDefined();
  expect(fw!.version).toBe('version-unknown');
  expect(fw!.versionUnknown).toBe(true);
  expect(fw!.provenance).toBe('manual');
});

// ---------------------------------------------------------------------------
// (e) precedence helper: an LLM tech-stack-prefill row is supersedable (not manual)
// ---------------------------------------------------------------------------

test('(e) a tech-stack-prefill row is supersedable by a manifest; a user-walked row is manual', async () => {
  expect(
    isManualDecisionRow(
      manualRow('service.framework', { framework: 'X', version: '1' }, TECH_STACK_PREFILL_TASK_NAME),
    ),
  ).toBe(false);
  expect(
    isManualDecisionRow(
      manualRow('service.framework', { framework: 'X', version: '1' }, 'architect-persona-conversation'),
    ),
  ).toBe(true);

  // Wired through the filter: a prefill row does NOT block the manifest write.
  const latest = [
    manualRow('service.framework', { framework: 'X', version: '1' }, TECH_STACK_PREFILL_TASK_NAME),
  ];
  const deps: ManifestPrecedenceDeps = {
    fetchLatestCapturedDecisions: (async () => latest) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
  };
  const candidates = deriveManifestAnswerCandidates([springResolvedManifest()]);
  const filtered = await filterCandidatesByPrecedence('proj-1', 'arch-target', candidates, deps);
  expect(filtered.survivingCandidates.map((c) => c.decisionCode)).toContain('service.framework');
  expect(filtered.skippedManualCodes).not.toContain('service.framework');
});

// ---------------------------------------------------------------------------
// (f)-(i) Spec 2 Group 6 — provenance precedence (deterministic > inferred >
//         llm), all strictly BELOW manual; one write-immediately answer / code.
// ---------------------------------------------------------------------------

function candidate(
  decisionCode: string,
  provenance: ManifestAnswerCandidate['provenance'],
  opts: { framework?: string; version?: string; sourceDependency?: string } = {},
): ManifestAnswerCandidate {
  return {
    decisionCode,
    answerKind: 'framework-version',
    framework: opts.framework ?? 'X',
    version: opts.version ?? '1.0',
    sourceFile: 'pom.xml',
    sourceQuote: 'evidence',
    tag: 't',
    provenance,
    sourceDependency: opts.sourceDependency ?? 'com.example:x',
  };
}

test('(f) de-dup precedence: deterministic > inferred > llm for the same code (order-independent)', () => {
  const det = candidate('db.engine', 'deterministic', { framework: 'det' });
  const inf = candidate('db.engine', 'inferred', { framework: 'inf' });
  const llm = candidate('db.engine', 'llm', { framework: 'llm' });

  // deterministic beats both, regardless of input order.
  expect(dedupeCandidatesByPrecedence([llm, inf, det])).toEqual([
    expect.objectContaining({ provenance: 'deterministic', framework: 'det' }),
  ]);
  // inferred beats llm.
  expect(dedupeCandidatesByPrecedence([llm, inf])).toEqual([
    expect.objectContaining({ provenance: 'inferred' }),
  ]);
  // llm alone survives (lowest non-manual rank).
  expect(dedupeCandidatesByPrecedence([llm])).toEqual([
    expect.objectContaining({ provenance: 'llm' }),
  ]);
});

test('(g) manual-wins is STRICTLY above deterministic/inferred/llm: a manual row blocks even a deterministic candidate', async () => {
  const latest = [manualRow('db.engine', { framework: 'MySQL', version: '8.4' })];
  const deps: ManifestPrecedenceDeps = {
    fetchLatestCapturedDecisions: (async () =>
      latest) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
  };
  const candidates = [
    candidate('db.engine', 'deterministic'),
    candidate('db.driver', 'llm'),
  ];

  const filtered = await filterCandidatesByPrecedence('proj-1', 'arch-target', candidates, deps);

  // db.engine has a manual winner => even the DETERMINISTIC candidate is skipped.
  expect(filtered.skippedManualCodes).toContain('db.engine');
  expect(filtered.survivingCandidates.map((c) => c.decisionCode)).not.toContain('db.engine');
  // db.driver (llm) has no manual winner => it survives (write-immediately).
  expect(filtered.survivingCandidates.map((c) => c.decisionCode)).toContain('db.driver');
});

test('(h) de-dup keeps EXACTLY ONE candidate per code across mixed provenance', () => {
  const deduped = dedupeCandidatesByPrecedence([
    candidate('service.framework', 'deterministic'),
    candidate('db.engine', 'inferred'),
    candidate('validation.framework', 'llm'),
    candidate('db.engine', 'llm'), // loses to the inferred db.engine
  ]);
  expect(deduped.map((c) => c.decisionCode).sort()).toEqual([
    'db.engine',
    'service.framework',
    'validation.framework',
  ]);
  // db.engine resolves to the inferred hit (beats the llm one).
  expect(deduped.find((c) => c.decisionCode === 'db.engine')!.provenance).toBe('inferred');
});

test('(i) precedence filter preserves provenance + sourceDependency on surviving candidates (for the UI badge)', async () => {
  const deps: ManifestPrecedenceDeps = {
    fetchLatestCapturedDecisions: (async () =>
      []) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
  };
  const c = candidate('db.engine', 'inferred', {
    sourceDependency: 'org.postgresql:postgresql',
  });
  const filtered = await filterCandidatesByPrecedence('p', 'a', [c], deps);
  const survivor = filtered.survivingCandidates[0];
  expect(survivor.provenance).toBe('inferred');
  expect(survivor.sourceDependency).toBe('org.postgresql:postgresql');
});

// ---------------------------------------------------------------------------
// (j) Spec 2 Group 8 — recompute STAMPS the WIRE provenance from each candidate's
//     internal provenance (deterministic => manifest, inferred => inferred, llm
//     => llm) and carries the source dependency through for the UI badge. The
//     manual overlay still wins and stamps 'manual' (no sourceDependency).
// ---------------------------------------------------------------------------

test('(j) recompute stamps wire provenance (deterministic=>manifest, inferred=>inferred, llm=>llm) + carries sourceDependency', () => {
  const recomputed = recomputeResolvedTargetVersions({
    resolvedManifests: [],
    manifestCandidates: [
      candidate('service.framework', 'deterministic', {
        framework: 'Spring Boot',
        version: '3.4.1',
        sourceDependency: 'org.springframework.boot:spring-boot-starter-web',
      }),
      candidate('db.engine', 'inferred', {
        framework: 'PostgreSQL',
        version: 'version-unknown',
        sourceDependency: 'org.postgresql:postgresql',
      }),
      candidate('validation.framework', 'llm', {
        framework: 'Hibernate Validator',
        version: '8.0.1',
        sourceDependency: 'org.hibernate.validator:hibernate-validator',
      }),
    ],
    latestDecisions: [],
  });
  const byCode = Object.fromEntries(recomputed.map((v) => [v.decisionCode, v]));

  // deterministic-direct => wire 'manifest' (the historic default is preserved).
  expect(byCode['service.framework'].provenance).toBe('manifest');
  expect(byCode['service.framework'].sourceDependency).toBe(
    'org.springframework.boot:spring-boot-starter-web',
  );

  // inferred => wire 'inferred'; family-only db.engine stays version-unknown and
  // the driver coordinate rides through as the source dependency.
  expect(byCode['db.engine'].provenance).toBe('inferred');
  expect(byCode['db.engine'].versionUnknown).toBe(true);
  expect(byCode['db.engine'].sourceDependency).toBe('org.postgresql:postgresql');

  // llm => wire 'llm'; source dependency carried for the badge.
  expect(byCode['validation.framework'].provenance).toBe('llm');
  expect(byCode['validation.framework'].sourceDependency).toBe(
    'org.hibernate.validator:hibernate-validator',
  );
});
