/**
 * Task Group 3 tests — Manifest auto-answerer (deterministic sibling of the
 * tech-stack pre-fill).
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), task 3.1.
 *
 * Scope (2-8 focused tests), asserting the CONTRACT + the SELECTION BOUNDARY:
 *   (a) a resolved framework/driver/build-tool coordinate writes a captured-
 *       decision row with answerValue = JSON.stringify({ value, sourceQuote,
 *       sourceFile }), scopeKind:'architecture', standardsLookupRef:null, and
 *       createdByTask = the NEW distinct constant;
 *   (b) sourceFile = the tagged manifest path and sourceQuote = the resolved
 *       coordinate/version evidence;
 *   (c) a version-unknown resolved entry still writes an editable answer
 *       (not skipped, not fabricated);
 *   (d) on first POST failure remaining writes abort and partial is surfaced;
 *   (e) a non-dependency code (cutover/auth/etc.) is NOT attempted.
 *
 * The POST seam is injected (no HTTP). Version-resolution is exercised through
 * the real Group 1+2 functions so the contract is end-to-end honest.
 */

import { resolveManifestVersions } from '../manifestVersionResolution';
import { ParsedManifest } from '../parsedManifestModel';
import {
  ManifestAutoAnswererDeps,
  TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME,
  deriveManifestAnswerCandidates,
  runManifestAutoAnswer,
} from '../manifestAutoAnswerer';
import { DEPENDENCY_ANSWERABLE_CODES } from '../manifestCodeMapping';
import { resolveMavenManifest, resolveNpmManifest } from '../manifestDependencyResolvers';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Recording POST seam (mirrors the prefill test's recording deps)
// ---------------------------------------------------------------------------

interface PostCall {
  projectId: string;
  targetArchitectureId: string;
  body: CreateCapturedDecisionRequestBody;
}

function makeRecordingDeps(opts: { postFailureOnCode?: string } = {}): {
  deps: ManifestAutoAnswererDeps;
  postCalls: PostCall[];
} {
  const postCalls: PostCall[] = [];
  const deps: ManifestAutoAnswererDeps = {
    postCapturedDecision: (async (
      projectId: string,
      targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      postCalls.push({ projectId, targetArchitectureId, body });
      if (opts.postFailureOnCode && body.decisionCode === opts.postFailureOnCode) {
        throw new Error(`Synthetic POST failure for ${body.decisionCode}`);
      }
      return {
        decisionId: `decision-${body.decisionCode}`,
        projectId,
        targetArchitectureId,
        decisionCode: body.decisionCode,
        scopeKind: body.scopeKind,
        answerValue: body.answerValue,
        answerSummary: body.answerSummary ?? null,
        standardsLookupRef: body.standardsLookupRef ?? null,
        conversationThreadId: body.conversationThreadId ?? null,
        conversationTurnRef: body.conversationTurnRef ?? null,
        createdAt: '2026-06-24T00:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
    }) as ManifestAutoAnswererDeps['postCapturedDecision'],
  };
  return { deps, postCalls };
}

// ---------------------------------------------------------------------------
// Fixtures — built through the real Group 1+2 resolution functions.
// ---------------------------------------------------------------------------

/** A Spring Boot (parent-pinned) pom with a Postgres driver. */
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

function springResolvedManifest() {
  const declared = resolveMavenManifest(SPRING_POM, 'services/orders/pom.xml');
  const parsed: ParsedManifest = {
    status: 'parsed',
    ecosystem: 'MAVEN',
    kind: 'pom.xml',
    tag: 'orders-service',
    manifestPath: 'services/orders/pom.xml',
    declaredDependencies: declared,
    rawPomContent: SPRING_POM,
    packageLockContent: null,
  };
  return resolveManifestVersions(parsed);
}

const ARGS = {
  projectId: 'proj-1',
  targetArchitectureId: 'arch-target',
  conversationThreadId: 'thread-1',
};

// ---------------------------------------------------------------------------
// (a)+(b) framework/driver/build-tool coordinates write rows with the contract
// ---------------------------------------------------------------------------

test('(a)+(b) writes captured-decision rows with the prefill envelope, new task name, and manifest provenance', async () => {
  const { deps, postCalls } = makeRecordingDeps();
  const resolved = springResolvedManifest();

  const outcome = await runManifestAutoAnswer(
    { ...ARGS, resolvedManifests: [resolved] },
    deps,
  );

  const byCode = Object.fromEntries(postCalls.map((c) => [c.body.decisionCode, c.body]));

  // service.framework (Spring Boot, parent-resolved 3.4.1), db.driver (pgjdbc
  // 42.7.4), and build.tool (Maven from the ecosystem) are all written.
  expect(Object.keys(byCode).sort()).toEqual(
    ['build.tool', 'db.driver', 'service.framework'].sort(),
  );

  // Contract on the framework row.
  const fw = byCode['service.framework'];
  expect(fw.createdByTask).toBe(TARGET_MANIFEST_AUTO_ANSWER_TASK_NAME);
  expect(fw.createdByTask).not.toBe('tech-stack-md-prefill');
  expect(fw.scopeKind).toBe('architecture');
  expect(fw.standardsLookupRef).toBeNull();
  expect(fw.scopeRefType).toBeNull();
  expect(fw.scopeRefId).toBeNull();

  // answerValue = JSON.stringify({ value: { framework, version }, sourceQuote, sourceFile }).
  const parsed = JSON.parse(fw.answerValue);
  expect(parsed.value).toEqual({ framework: 'Spring Boot', version: '3.4.1' });
  // (b) provenance: sourceFile = tagged manifest path; sourceQuote = evidence.
  expect(parsed.sourceFile).toBe('services/orders/pom.xml');
  expect(parsed.sourceQuote).toBe(
    'org.springframework.boot:spring-boot-starter-web 3.4.1',
  );
  // One resolved chip downstream.
  expect(fw.answerSummary).toBe('Spring Boot 3.4.1');

  // Driver row provenance.
  const drv = byCode['db.driver'];
  const drvParsed = JSON.parse(drv.answerValue);
  expect(drvParsed.value).toEqual({ framework: 'pgjdbc', version: '42.7.4' });
  expect(drvParsed.sourceFile).toBe('services/orders/pom.xml');
  expect(drvParsed.sourceQuote).toBe('org.postgresql:postgresql 42.7.4');

  expect(outcome.aborted).toBe(false);
  expect(outcome.rowsWritten).toBe(3);
});

// ---------------------------------------------------------------------------
// (c) a version-unknown resolved entry STILL writes an editable answer
// ---------------------------------------------------------------------------

test('(c) a version-unknown resolved entry writes an editable answer (not skipped, not fabricated)', async () => {
  const { deps, postCalls } = makeRecordingDeps();

  // package.json with React on an OPEN range and NO lockfile => version-unknown.
  const pkg = JSON.stringify({ name: 'web', dependencies: { react: '^18.2.0' } });
  const declared = resolveNpmManifest(pkg, 'apps/web/package.json');
  const parsed: ParsedManifest = {
    status: 'parsed',
    ecosystem: 'NPM',
    kind: 'package.json',
    tag: 'web-ui',
    manifestPath: 'apps/web/package.json',
    declaredDependencies: declared,
    rawPomContent: null,
    packageLockContent: null,
  };
  const resolved = resolveManifestVersions(parsed);

  await runManifestAutoAnswer({ ...ARGS, resolvedManifests: [resolved] }, deps);

  const ui = postCalls.find((c) => c.body.decisionCode === 'ui.framework');
  expect(ui).toBeDefined();
  const uiParsed = JSON.parse(ui!.body.answerValue);
  // Captured WITH an explicit unknown version — NOT fabricated.
  expect(uiParsed.value).toEqual({ framework: 'React', version: 'version-unknown' });
  // Chip is honest about the unresolved version, and is editable downstream.
  expect(ui!.body.answerSummary).toBe('React (version unknown)');
});

// ---------------------------------------------------------------------------
// (d) first POST failure aborts remaining writes and surfaces partial
// ---------------------------------------------------------------------------

test('(d) first POST failure aborts remaining writes and surfaces a partial outcome', async () => {
  // Force the FIRST candidate (service.framework, derived before db.driver and
  // build.tool in manifest order) to fail.
  const resolved = springResolvedManifest();
  const candidates = deriveManifestAnswerCandidates([resolved]);
  const firstCode = candidates[0].decisionCode;

  const { deps, postCalls } = makeRecordingDeps({ postFailureOnCode: firstCode });

  const outcome = await runManifestAutoAnswer(
    { ...ARGS, resolvedManifests: [resolved] },
    deps,
  );

  // Exactly one POST attempted (the failing first one); the rest are aborted.
  expect(postCalls).toHaveLength(1);
  expect(postCalls[0].body.decisionCode).toBe(firstCode);
  expect(outcome.aborted).toBe(true);
  expect(outcome.rowsWritten).toBe(0);
  // The failed code + every remaining candidate code are surfaced as partial.
  expect(outcome.partialFailureCodes).toContain(firstCode);
  expect(outcome.partialFailureCodes.length).toBe(candidates.length);
  expect(outcome.failureReason).toContain(firstCode);
});

// ---------------------------------------------------------------------------
// (e) non-dependency codes are NOT attempted (selection boundary)
// ---------------------------------------------------------------------------

test('(e) non-dependency codes are never attempted', async () => {
  const { deps, postCalls } = makeRecordingDeps();
  const resolved = springResolvedManifest();

  await runManifestAutoAnswer({ ...ARGS, resolvedManifests: [resolved] }, deps);

  const attemptedCodes = postCalls.map((c) => c.body.decisionCode);
  // Every attempted code is within the dependency-answerable subset.
  for (const code of attemptedCodes) {
    expect(DEPENDENCY_ANSWERABLE_CODES.has(code)).toBe(true);
  }
  // Explicit non-dependency codes are absent.
  for (const nonDep of [
    'cutover.strategy',
    'api.auth',
    'api.rateLimiting',
    'secrets.management',
  ]) {
    expect(attemptedCodes).not.toContain(nonDep);
    expect(DEPENDENCY_ANSWERABLE_CODES.has(nonDep)).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// (f) one resolved chip per code — a concrete version beats version-unknown
// ---------------------------------------------------------------------------

test('(f) de-dupes to one candidate per code, preferring a concrete version over version-unknown', () => {
  // Two manifests both witnessing service.framework=Spring Boot: one unknown,
  // one concrete. The concrete must win (one resolved chip downstream).
  const unknownPom = `<project>
    <dependencies>
      <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    </dependencies>
  </project>`;
  const unknownParsed: ParsedManifest = {
    status: 'parsed', ecosystem: 'MAVEN', kind: 'pom.xml', tag: 'svc-a',
    manifestPath: 'a/pom.xml',
    declaredDependencies: resolveMavenManifest(unknownPom, 'a/pom.xml'),
    rawPomContent: unknownPom, packageLockContent: null,
  };
  const concreteParsed: ParsedManifest = {
    status: 'parsed', ecosystem: 'MAVEN', kind: 'pom.xml', tag: 'svc-b',
    manifestPath: 'b/pom.xml',
    declaredDependencies: resolveMavenManifest(SPRING_POM, 'b/pom.xml'),
    rawPomContent: SPRING_POM, packageLockContent: null,
  };

  const candidates = deriveManifestAnswerCandidates([
    resolveManifestVersions(unknownParsed),
    resolveManifestVersions(concreteParsed),
  ]);
  const fw = candidates.find((c) => c.decisionCode === 'service.framework');
  expect(fw).toBeDefined();
  expect(fw!.version).toBe('3.4.1'); // concrete beat version-unknown
});
