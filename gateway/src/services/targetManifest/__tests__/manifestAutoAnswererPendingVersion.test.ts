/**
 * Task Group 2 tests — Stop the version-unknown captured-decision write; emit a
 * persisted pending-version-confirmation set instead.
 *
 * Spec: 2026-06-27-target-manifest-version-unknown-pending-questions, task 2.1.
 *
 * Scope (2-8 focused tests) asserting the DIVERSION contract + the re-upload
 * precedence rules (5a/5b/5c):
 *   (1) a `version === VERSION_UNKNOWN` VERSIONED candidate SKIPS the POST and is
 *       collected into the pending set (and the FULL set is persisted once);
 *   (2) a concrete-version candidate is UNCHANGED (still POSTed; not pending);
 *   (3) a single-choice candidate is UNCHANGED (still POSTed; not pending);
 *   (4) 5a — a pending coordinate that re-uploads CONCRETE writes the row and the
 *       recomputed pending set CLEARS it (persisted as []);
 *   (5) 5b — a coordinate ALREADY captured CONCRETE that re-uploads version-unknown
 *       is NEITHER retracted (no POST) NOR added to pending;
 *   (6) a diverted pending entry does NOT count toward rowsWritten / partial-failure;
 *   (7) 5c — a coordinate already captured MANUALLY: manual wins; no pending entry
 *       (exercised end-to-end through `processManifestUpload`).
 *
 * The POST seam + the pending-write seam are both injected — no HTTP, no disk.
 */

import { VERSION_UNKNOWN } from '../../../config/architect-conversation/frameworkVersionShape';
import {
  ManifestAutoAnswererDeps,
  ManifestAnswerCandidate,
  runManifestAutoAnswer,
} from '../manifestAutoAnswerer';
import {
  ManifestUploadOrchestratorDeps,
  processManifestUpload,
} from '../manifestUploadOrchestrator';
import { ManifestPrecedenceDeps } from '../manifestPrecedence';
import { resolveNpmManifest } from '../manifestDependencyResolvers';
import { ParsedManifest } from '../parsedManifestModel';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';
import type { PendingVersionConfirmationEntry } from '../../architectConversation/turnShape';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ARGS = {
  projectId: 'proj-1',
  targetArchitectureId: 'arch-target',
  conversationThreadId: 'thread-1',
};

// ---------------------------------------------------------------------------
// Recording deps: a POST seam + a stubbed pending-write seam (no I/O).
// ---------------------------------------------------------------------------

function makeDeps(opts: { postFailureOnCode?: string } = {}): {
  deps: ManifestAutoAnswererDeps;
  postCalls: CreateCapturedDecisionRequestBody[];
  writePending: jest.Mock;
} {
  const postCalls: CreateCapturedDecisionRequestBody[] = [];
  const writePending = jest.fn(async () => undefined);
  const deps: ManifestAutoAnswererDeps = {
    writePendingVersionConfirmations:
      writePending as ManifestAutoAnswererDeps['writePendingVersionConfirmations'],
    postCapturedDecision: (async (
      projectId: string,
      targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      postCalls.push(body);
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
        createdAt: '2026-06-27T00:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
    }) as ManifestAutoAnswererDeps['postCapturedDecision'],
  };
  return { deps, postCalls, writePending };
}

function versioned(
  decisionCode: string,
  version: string,
  framework = 'Lib',
): ManifestAnswerCandidate {
  return {
    decisionCode,
    answerKind: 'framework-version',
    framework,
    version,
    sourceFile: 'svc/pom.xml',
    sourceQuote: `${framework} ${version}`,
    tag: 'svc',
    provenance: 'deterministic',
  };
}

function singleChoice(decisionCode: string, value: string): ManifestAnswerCandidate {
  return {
    decisionCode,
    answerKind: 'single-choice',
    framework: value,
    version: '',
    sourceFile: 'svc/pom.xml',
    sourceQuote: value,
    tag: 'svc',
    provenance: 'deterministic',
  };
}

// ---------------------------------------------------------------------------
// (1) version-unknown diverts to pending (SKIPS the POST)
// ---------------------------------------------------------------------------

test('(1) a version-unknown versioned candidate skips the POST and is collected into the persisted pending set', async () => {
  const { deps, postCalls, writePending } = makeDeps();

  const outcome = await runManifestAutoAnswer(
    { ...ARGS, resolvedManifests: [], candidates: [versioned('db.engine', VERSION_UNKNOWN, 'Postgres')] },
    deps,
  );

  // No captured-decision row was POSTed for the version-unknown coordinate.
  expect(postCalls).toHaveLength(0);
  expect(outcome.rowsWritten).toBe(0);
  expect(outcome.writtenCodes).toEqual([]);

  // It rode into the pending set with the framework pre-chosen.
  expect(outcome.pendingVersionConfirmations).toEqual<PendingVersionConfirmationEntry[]>([
    {
      decisionCode: 'db.engine',
      framework: 'Postgres',
      sourceFile: 'svc/pom.xml',
      sourceQuote: 'Postgres version-unknown',
      tag: 'svc',
    },
  ]);

  // The FULL recomputed set is persisted exactly once (replace, latest-wins).
  expect(writePending).toHaveBeenCalledTimes(1);
  expect(writePending).toHaveBeenCalledWith(
    ARGS.projectId,
    ARGS.targetArchitectureId,
    outcome.pendingVersionConfirmations,
  );
});

// ---------------------------------------------------------------------------
// (2) concrete-version candidate is UNCHANGED (still written; not pending)
// ---------------------------------------------------------------------------

test('(2) a concrete-version candidate is unchanged: it is POSTed and is NOT pending', async () => {
  const { deps, postCalls, writePending } = makeDeps();

  const outcome = await runManifestAutoAnswer(
    { ...ARGS, resolvedManifests: [], candidates: [versioned('service.framework', '3.4.1', 'Spring Boot')] },
    deps,
  );

  expect(postCalls.map((b) => b.decisionCode)).toEqual(['service.framework']);
  expect(outcome.rowsWritten).toBe(1);
  expect(outcome.pendingVersionConfirmations).toEqual([]);
  // An empty recomputed pending set is still persisted (clears any prior set).
  expect(writePending).toHaveBeenCalledWith(ARGS.projectId, ARGS.targetArchitectureId, []);
});

// ---------------------------------------------------------------------------
// (3) single-choice candidate is UNCHANGED (still written; not pending)
// ---------------------------------------------------------------------------

test('(3) a single-choice (non-versioned) candidate is unchanged: it is POSTed and is NOT pending', async () => {
  const { deps, postCalls, writePending } = makeDeps();

  const outcome = await runManifestAutoAnswer(
    {
      ...ARGS,
      resolvedManifests: [],
      candidates: [singleChoice('interservice.discoveryMechanism', 'Eureka')],
    },
    deps,
  );

  expect(postCalls.map((b) => b.decisionCode)).toEqual(['interservice.discoveryMechanism']);
  expect(JSON.parse(postCalls[0].answerValue).value).toBe('Eureka');
  expect(outcome.rowsWritten).toBe(1);
  expect(outcome.pendingVersionConfirmations).toEqual([]);
  expect(writePending).toHaveBeenCalledWith(ARGS.projectId, ARGS.targetArchitectureId, []);
});

// ---------------------------------------------------------------------------
// (4) 5a — a pending coordinate that re-uploads CONCRETE writes the row and the
//     recomputed pending set CLEARS it.
// ---------------------------------------------------------------------------

test('(4) 5a: a pending coordinate re-uploaded as CONCRETE is written and clears from the recomputed pending set', async () => {
  // First upload: version-unknown -> pending.
  const first = makeDeps();
  const out1 = await runManifestAutoAnswer(
    { ...ARGS, resolvedManifests: [], candidates: [versioned('db.engine', VERSION_UNKNOWN, 'Postgres')] },
    first.deps,
  );
  expect(out1.pendingVersionConfirmations.map((e) => e.decisionCode)).toEqual(['db.engine']);
  expect(first.postCalls).toHaveLength(0);

  // Second upload: same coordinate now resolves CONCRETE.
  const second = makeDeps();
  const out2 = await runManifestAutoAnswer(
    { ...ARGS, resolvedManifests: [], candidates: [versioned('db.engine', '16.2', 'Postgres')] },
    second.deps,
  );

  // The concrete row is written (as today)...
  expect(second.postCalls.map((b) => b.decisionCode)).toEqual(['db.engine']);
  expect(out2.rowsWritten).toBe(1);
  // ...and the recomputed pending set is now EMPTY (the coordinate dropped out),
  // persisted as [] to clear the prior pending turn (latest-wins).
  expect(out2.pendingVersionConfirmations).toEqual([]);
  expect(second.writePending).toHaveBeenLastCalledWith(
    ARGS.projectId,
    ARGS.targetArchitectureId,
    [],
  );
});

// ---------------------------------------------------------------------------
// (5) 5b — already-captured CONCRETE + a later version-unknown: no retraction,
//     no pending entry.
// ---------------------------------------------------------------------------

test('(5) 5b: a coordinate already captured CONCRETE + a later version-unknown is neither written nor pending', async () => {
  const { deps, postCalls, writePending } = makeDeps();

  const outcome = await runManifestAutoAnswer(
    {
      ...ARGS,
      resolvedManifests: [],
      candidates: [versioned('service.framework', VERSION_UNKNOWN, 'Spring Boot')],
      // The orchestrator feeds the codes already captured with a concrete version.
      existingConcreteVersionCodes: new Set(['service.framework']),
    },
    deps,
  );

  // The concrete capture is NOT retracted (no POST) and NOT re-queued as pending.
  expect(postCalls).toHaveLength(0);
  expect(outcome.rowsWritten).toBe(0);
  expect(outcome.pendingVersionConfirmations).toEqual([]);
  expect(writePending).toHaveBeenCalledWith(ARGS.projectId, ARGS.targetArchitectureId, []);
});

// ---------------------------------------------------------------------------
// (6) a diverted pending entry does NOT count toward rowsWritten / partial-failure
// ---------------------------------------------------------------------------

test('(6) a diverted pending entry never counts toward rowsWritten or partialFailureCodes (even after a write failure)', async () => {
  // The FIRST concrete write fails (aborts the rest); a version-unknown candidate
  // sits among the set and must be diverted to pending regardless of the abort.
  const { deps, postCalls, writePending } = makeDeps({ postFailureOnCode: 'service.framework' });

  const outcome = await runManifestAutoAnswer(
    {
      ...ARGS,
      resolvedManifests: [],
      candidates: [
        versioned('service.framework', '3.4.1', 'Spring Boot'), // concrete -> POST fails
        versioned('db.engine', VERSION_UNKNOWN, 'Postgres'), // version-unknown -> pending
        versioned('db.driver', '42.7.4', 'pgjdbc'), // concrete -> aborted (partial)
      ],
    },
    deps,
  );

  expect(outcome.aborted).toBe(true);
  expect(postCalls.map((b) => b.decisionCode)).toEqual(['service.framework']);
  expect(outcome.rowsWritten).toBe(0);
  // Only the concrete codes are partial-failures; the pending coordinate is excluded.
  expect(outcome.partialFailureCodes).toEqual(['service.framework', 'db.driver']);
  expect(outcome.partialFailureCodes).not.toContain('db.engine');
  // The pending set was still computed + persisted despite the abort.
  expect(outcome.pendingVersionConfirmations.map((e) => e.decisionCode)).toEqual(['db.engine']);
  expect(writePending).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// (7) 5c — already-captured MANUAL: manual wins; no pending entry (end-to-end).
// ---------------------------------------------------------------------------

function manualRow(
  decisionCode: string,
  value: { framework: string; version: string },
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
    createdAt: '2026-06-27T10:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
  };
}

function reactPackageJson(): ParsedManifest {
  // React on an OPEN range with NO lockfile => ui.framework resolves version-unknown.
  const pkg = JSON.stringify({ name: 'web', dependencies: { react: '^18.2.0' } });
  return {
    status: 'parsed',
    ecosystem: 'NPM',
    kind: 'package.json',
    tag: 'web-ui',
    manifestPath: 'apps/web/package.json',
    declaredDependencies: resolveNpmManifest(pkg, 'apps/web/package.json'),
    rawPomContent: null,
    packageLockContent: null,
  };
}

test('(7) 5c: a coordinate already captured MANUALLY is preserved and never becomes pending', async () => {
  const writePending = jest.fn(async () => undefined);
  const postCalls: string[] = [];
  // A manual ui.framework answer already exists (user-walked, concrete).
  const latest = [manualRow('ui.framework', { framework: 'React', version: '18.2.0' })];

  const deps: ManifestUploadOrchestratorDeps = {
    fetchLatestCapturedDecisions: (async () =>
      latest) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
    writePendingVersionConfirmations:
      writePending as ManifestUploadOrchestratorDeps['writePendingVersionConfirmations'],
    postCapturedDecision: (async (
      _projectId: string,
      _targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      postCalls.push(body.decisionCode);
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
        createdAt: '2026-06-27T12:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
    }) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
  };

  const result = await processManifestUpload(
    { ...ARGS, parsedManifests: [reactPackageJson()] },
    deps,
  );

  // Manual wins: ui.framework is preserved (skipped, not POSTed) and is NOT pending.
  expect(result.skippedManualCodes).toContain('ui.framework');
  expect(postCalls).not.toContain('ui.framework');
  const pendingCodes = result.writeOutcome.pendingVersionConfirmations.map(
    (e) => e.decisionCode,
  );
  expect(pendingCodes).not.toContain('ui.framework');
});
