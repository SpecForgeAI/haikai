# V3 Pipeline Hotfixes (2026-04-20)

Bugs discovered in the first real V3 run:

- Project: `fc3abaf2-19a5-466f-b3df-a6430183429e`
- Run: `735129eb-5d2c-4898-8137-f79010caa885`

This document covers Bug 1 and Bug 3 (Bug 2 is owned by a parallel implementer).

## Bug 1: LLM gap-fill candidates lose `_addedBy` tag on persistence

### Symptom

The 206 LLM gap-fill candidates persisted by run `735129eb` showed `_addedBy = (none)` when their `data` keys were inspected on the persisted rows. Pack-adapter candidates from the same run had their `_addedBy` value (e.g. `'spring-classic-adapter'`) intact.

### Root cause

In `discovery-service/src/services/llmGapFillStep.ts::buildDiscoveryCandidate`, `_addedBy` was injected at the TOP LEVEL of the in-process `DiscoveryCandidate` only:

```ts
const candidate = {
  ...
  data: baseData,         // <-- baseData did NOT contain _addedBy
  _addedBy: addedBy,      // <-- top-level only
  ...
};
```

The persistence path (`bulkSaveCandidates` -> `archModelClient` -> architecture-model-service) only round-trips canonical entity fields plus whatever lives inside `data`. Top-level non-canonical fields are silently stripped when the candidate is mapped into its DTO. Pack adapters already follow the convention `data._addedBy = '<tag>'` (see `springClassic/index.ts::makeCandidate`), so their tags survived.

### Fix

`discovery-service/src/services/llmGapFillStep.ts::buildDiscoveryCandidate` now also writes `_addedBy` INSIDE `baseData`:

```ts
baseData._addedBy = addedBy;
```

The top-level mirror is preserved for in-process callers that may have been written against the older shape (defensive). The new authoritative location is `data._addedBy`, matching the pack-adapter convention.

### Test coverage

`discovery-service/src/__tests__/llmGapFillAddedByPersistence.test.ts` (4 tests):

- Tier A surviving candidate carries `data._addedBy === 'llm-gap-fill'`
- Tier B surviving candidate carries `data._addedBy === 'llm-ir-guided'`
- Tier C surviving candidate carries `data._addedBy === 'llm-solo'`
- Pass-through of optional LLM `description` field is preserved alongside `_addedBy`

Each test also asserts the secondary top-level mirror is still present.

## Bug 3: `steps_payload.v3.gapFill` overwritten by step-wrapper

### Symptom

After run `735129eb` completed, the run's `steps_payload` top-level keys were `['service-scoped-llm-analysis']` only. The `v3` key was missing entirely, but `runDiscoveryV3` had definitely written it (pack candidates were persisted, so `persistGapFillStagePayload` had been reached).

### Root cause

In `discovery-service/src/services/runManager.ts::startServiceScopedRun` (and the project-level pipeline in `startRun` / `resumeRun`), the wrapper maintains a local `stepsPayload` object initialised from scratch:

```ts
const stepsPayload: Record<string, Record<string, unknown>> = {
  [stepName]: { status: 'pending' },
};
```

Each transition writes `steps_payload: { ...stepsPayload }` into the run row. This **replaces** the entire jsonb column wholesale, wiping any keys the V3 pipeline wrote mid-step (like `v3.gapFill`).

`persistGapFillStagePayload` does its own correct read-merge-write semantics (it reads `existing.steps_payload`, merges `v3.gapFill`, writes back). But the surrounding step-wrapper's later write happens AFTER the V3 stage write, with stale local state, and clobbers the merge.

### Fix

Added a helper `buildMergedStepsPayload(projectId, runId, localStepsPayload)` near the top of `runManager.ts`. It re-reads the latest persisted `steps_payload` from the DB, then overlays the wrapper's local step keys on top via shallow spread. Top-level keys the wrapper did not touch (notably `v3`) survive.

All 12 `steps_payload: { ...stepsPayload }` write sites in `runManager.ts` (across `startRun`, `resumeRun`, `startServiceScopedRun`) now go through this helper:

```ts
steps_payload: await buildMergedStepsPayload(projectId, runId, stepsPayload),
```

The merge is shallow at the top level, which is safe because:

- The wrapper owns top-level step keys like `'service-scoped-llm-analysis'`, `'1a'`, `'1b'`, `'1c-llm-analysis'`.
- The V3 pipeline owns the entire `v3` sub-tree (single-owner; only `persistGapFillStagePayload` writes it).

If the read fails (transient DB issue), the helper falls back to the wrapper-only payload to keep the run progressing. Better to lose the V3 sub-tree on a single failure than to abort the run mid-update.

### Test coverage

`discovery-service/src/__tests__/runManagerStepsPayloadMerge.test.ts` (2 tests):

- Service-scoped happy path: after the run completes, `steps_payload` contains BOTH `v3.gapFill` (written mid-step by a fake `executeLlmFileAnalysis`) and `service-scoped-llm-analysis` (written by the wrapper).
- Service-scoped failure path: when the wrapper transitions to FAILED after the V3 stage wrote its sub-tree, the FAILED write still preserves the `v3` key.

Both tests use a stateful in-memory mock of `archModelClient.updateDiscoveryRun` that mirrors the production wholesale-replace behaviour of the jsonb column, so the test fails if the helper is removed.

## Files changed

- `discovery-service/src/services/llmGapFillStep.ts` (Bug 1 fix)
- `discovery-service/src/services/runManager.ts` (Bug 3 fix + helper)
- `discovery-service/src/__tests__/llmGapFillAddedByPersistence.test.ts` (new tests)
- `discovery-service/src/__tests__/runManagerStepsPayloadMerge.test.ts` (new tests)

## Test run summary

```
src/__tests__/llmGapFillAddedByPersistence.test.ts ........ 4 passed
src/__tests__/runManagerStepsPayloadMerge.test.ts ......... 2 passed
src/__tests__/llmGapFillStep.test.ts ...................... 7 passed (regression)
src/__tests__/discoveryV3Pipeline.test.ts ................. 3 passed (regression)
src/__tests__/v3PipelineGapFillPersistence.test.ts ........ 4 passed (regression)
src/__tests__/v3PipelineGapFillIntegration.test.ts ........ 5 passed (regression)
```

Pre-existing failures (NOT introduced by this hotfix; verified via git stash):

- `runManagerAndRoutes.test.ts`, `runManagerBackbone.test.ts`, `runManagerPipelineRestructuring.test.ts` reference `'1c'` / `'1d'` step names and a DTO shape without `mode` -- these were already failing before this hotfix.
