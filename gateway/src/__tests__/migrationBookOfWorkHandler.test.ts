/**
 * Tests for the Migration Delivery Plan gateway orchestration handler.
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 6: Gateway Orchestration Handler.
 *
 * Verifies the five-stage flow (Q-1, Q-15):
 *   1. Resolve context via the migration-discovery-context resolver (Q-12).
 *   2. Apply token-budget cascade (Q-4).
 *   3. Single synchronous LLM call.
 *   4. Schema validation.
 *   5. POST to AMS at /api/projects/{projectId}/migration-books-of-work.
 *
 * Test plan:
 *   1. Happy path: fixture in -> mocked LLM returns valid hierarchy ->
 *      handler returns { draftId, summary }.
 *   2. Sparse context: missing API baselines -> LLM emits prerequisite stories
 *      with readiness='needs_focused_context'; handler returns those without
 *      mutation.
 *   3. Schema-validation rejection: LLM returns malformed JSON ->
 *      handler throws MigrationBookOfWorkSchemaError; AMS createDraft is
 *      NEVER invoked.
 *   4. Token-cap cascade — drop oldest evidence: oversize evidence list
 *      triggers step 1; final token count is under the soft cap.
 *   5. Token-cap cascade — compress baseline detail: bloating the baseline
 *      block past the cap triggers step 2.
 *   6. Token-cap cascade — fail loudly: an input that overflows even after
 *      the full cascade throws TokenBudgetOverflowError; ALWAYS-RETAINED
 *      items are not silently dropped.
 *   7. Single synchronous LLM call: the handler invokes the LLM exactly once.
 *   8. AMS POST shape: the JSON sent to AMS includes the four sibling JSONB
 *      blobs (generationInputs, generationSummary, qualityAssessment,
 *      bookOfWork) in the field-naming the AMS controller expects.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  applyTokenBudgetCascade,
  approxTokens,
  assembleBookOfWork,
  buildUserPrompt,
  generateMigrationBookOfWork,
  MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP,
  MigrationBookOfWorkSchemaError,
  TokenBudgetOverflowError,
} from '../services/migrationBookOfWorkHandler';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';
import { GeneratedMigrationBookOfWork } from '../services/generatedMigrationBookOfWorkSchema';

// Book-creation seed minting reads the confirmed-manifest store via the real AMS
// client by default; stub it module-wide so these handler tests never make a live
// fetch. Returning [] = "no confirmed manifest", so no seed story is prepended and
// the existing item-count assertions stay unchanged. Tests that need a seed can
// still inject `deps.fetchTargetManifestArtifacts` explicitly.
jest.mock('../services/targetManifestArtifactsClient', () => ({
  ...jest.requireActual('../services/targetManifestArtifactsClient'),
  fetchLatestTargetManifestArtifacts: jest.fn().mockResolvedValue([]),
}));

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-05-17-pm-migration-delivery-plan-book-of-work-draft',
  'planning',
  'visuals',
  'fixture-migration-delivery-plan-scenario.json'
);

function loadFixture(): MigrationDiscoveryContext {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw) as MigrationDiscoveryContext;
}

// Minimal-but-valid GeneratedMigrationBookOfWork payload for happy-path tests.
function makeValidBookOfWorkJson(): string {
  const payload: GeneratedMigrationBookOfWork = {
    title: 'Draft Migration Delivery Plan — LegacyOrderService',
    summary: 'Split monolith into CustomerService + PricingService.',
    generationInputs: {
      productDefinitionRefs: ['p1'],
      currentArchitectureRefs: ['curr-1'],
      targetArchitectureRefs: ['tgt-1'],
    },
    generationSummary: {
      totalItems: 4,
      countsByType: { initiative: 1, epic: 1, feature: 1, story: 1 },
    },
    qualityAssessment: { overallScore: 'high', overallRationale: 'ok' },
    items: [
      {
        id: 'I1',
        type: 'initiative',
        parentId: null,
        title: 'Split monolith',
        description: 'Top-level initiative',
        acceptanceCriteria: [],
        workstream: 'architecture_refinement',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Begin epic decomposition',
        traceabilitySummary: 'Derived from currentArchitectureSummary.',
      },
      {
        id: 'E1',
        type: 'epic',
        parentId: 'I1',
        title: 'CustomerService extraction',
        description: 'Extract CustomerService.',
        acceptanceCriteria: ['Customer endpoints live in CustomerService.'],
        workstream: 'target_service_api_implementation',
        sequenceOrder: 1,
        tags: ['customer'],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Author feature breakdown.',
        traceabilitySummary: 'Maps GET/POST /customers to new service.',
      },
      {
        id: 'F1',
        type: 'feature',
        parentId: 'E1',
        title: 'GET /customers/{id}',
        description: 'Single-customer GET on the new service.',
        acceptanceCriteria: ['Behavioural parity with monolith endpoint.'],
        workstream: 'target_service_api_implementation',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Write story.',
        traceabilitySummary: 'Traces to baseline 44444444-...-401.',
      },
      {
        id: 'S1',
        type: 'story',
        parentId: 'F1',
        title: 'Implement GET /customers/{id} in new service',
        description: 'Implement single-customer GET.',
        acceptanceCriteria: ['Returns identical body to monolith endpoint.'],
        workstream: 'target_service_api_implementation',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Begin implementation.',
        traceabilitySummary: 'Traces to evidence highlight e1.',
      },
    ],
  };
  return JSON.stringify(payload);
}

// Same shape but flips the story into a prerequisite/needs_focused_context one.
function makeSparseContextBookOfWorkJson(): string {
  const payload = JSON.parse(makeValidBookOfWorkJson()) as GeneratedMigrationBookOfWork;
  payload.items[3].title =
    'Capture API Behaviour Baseline for GET /customers/{id}';
  payload.items[3].description =
    'No API baseline is recorded; capture one before specifying the implementation story.';
  payload.items[3].readiness = 'needs_focused_context';
  payload.items[3].readinessReasons = ['Missing API Behaviour Baseline.'];
  payload.items[3].missingInputs = ['apiBehaviourBaselineId for GET /customers/{id}'];
  payload.items[3].workstream = 'discovery_gap_resolution';
  payload.items[3].recommendedNextAction =
    'Capture API Behaviour Baseline for GET /customers/{id} on the monolith.';
  return JSON.stringify(payload);
}

describe('Migration Delivery Plan gateway orchestration handler (Spec 2026-05-17, Task Group 6)', () => {
  // Test 1: happy path
  it('happy path — invokes resolver with current+target, calls LLM, validates, POSTs to AMS, returns {draftId, summary}', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-123', summary: 'AMS-confirmed summary' });

    const counter = { count: 0 };
    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
      },
      { fetchContext, callLlm, createDraft, llmInvocationCounter: counter, systemPromptOverride: 'SYS' }
    );

    expect(fetchContext).toHaveBeenCalledTimes(1);
    expect(fetchContext).toHaveBeenCalledWith(
      fixture.projectId,
      expect.objectContaining({
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId,
      })
    );
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(result.draftId).toBe('draft-123');
    expect(result.summary).toBe('AMS-confirmed summary');
  });

  // Test 2: sparse-context — LLM emits prerequisite stories; handler returns them
  it('sparse-context — emits prerequisite story with readiness=needs_focused_context (no fabrication)', async () => {
    const fixture = loadFixture();
    const sparseCtx: MigrationDiscoveryContext = {
      ...fixture,
      apiBehaviourBaselineSummary: undefined,
      apiBehaviourBaselineIds: [],
    };
    const fetchContext = jest.fn().mockResolvedValue(sparseCtx);
    const callLlm = jest.fn().mockResolvedValue({ content: makeSparseContextBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-sparse', summary: 'sparse' });

    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
      },
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    // Inspect the body POSTed to AMS to confirm the prerequisite story is
    // carried through unchanged.
    const postedBody = createDraft.mock.calls[0][1];
    const story = postedBody.book_of_work_json.items.find((i: { id: string }) => i.id === 'S1');
    expect(story).toBeDefined();
    expect(story.readiness).toBe('needs_focused_context');
    expect(story.workstream).toBe('discovery_gap_resolution');
    expect(story.missingInputs.length).toBeGreaterThan(0);
    expect(result.draftId).toBe('draft-sparse');
  });

  // Test 3: schema-validation rejection — malformed JSON; no AMS write
  it('rejects a malformed LLM response with MigrationBookOfWorkSchemaError; AMS createDraft is NEVER invoked', async () => {
    const fixture = loadFixture();
    // Malformed payload: orphan parentId
    const malformed = JSON.parse(makeValidBookOfWorkJson()) as GeneratedMigrationBookOfWork;
    malformed.items[3].parentId = 'does-not-exist';

    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: JSON.stringify(malformed) });
    const createDraft = jest.fn();

    await expect(
      generateMigrationBookOfWork(
        {
          projectId: fixture.projectId,
          currentArchitectureId: fixture.currentArchitectureId,
          targetArchitectureId: fixture.targetArchitectureId ?? '',
        },
        { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
      )
    ).rejects.toBeInstanceOf(MigrationBookOfWorkSchemaError);

    expect(createDraft).not.toHaveBeenCalled();
  });

  // Test 4: token-cap cascade — drop oldest evidence
  it('token-cap cascade — drops oldest evidence highlights when over the soft cap', () => {
    const fixture = loadFixture();
    // Build a synthetic evidence list large enough to push us past the soft cap.
    // Each entry padded to ~600 chars × 1500 entries ≈ 900k chars = 225k tokens.
    const padding = '-padding-'.repeat(60); // ~540 chars
    const evidence: NonNullable<MigrationDiscoveryContext['evidenceHighlights']> = [];
    for (let i = 0; i < 1500; i++) {
      evidence.push({
        evidenceId: `e${i}`,
        runId: 'r1',
        type: 'log_extract',
        source: 'fixture-bulk-evidence' + padding,
        filePath: 'C:\\fixtures' + padding + '\\file-' + i + '.txt',
        linkedFindingIds: ['F1', 'F2'],
      });
    }
    const oversized: MigrationDiscoveryContext = {
      ...fixture,
      evidenceHighlights: evidence,
    };
    expect(approxTokens(oversized)).toBeGreaterThan(MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP);

    const outcome = applyTokenBudgetCascade(oversized);
    expect(outcome.truncated).toBe(true);
    expect(outcome.finalTokenCount).toBeLessThanOrEqual(MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP);
    expect(outcome.warnings.join(' ')).toMatch(/step 1/);
    // Always-retained sections must remain intact.
    expect(outcome.context.currentArchitectureSummary).toEqual(
      fixture.currentArchitectureSummary
    );
    expect(outcome.context.targetArchitectureSummary).toEqual(
      fixture.targetArchitectureSummary
    );
    expect(outcome.context.architectureMappingsSummary).toEqual(
      fixture.architectureMappingsSummary
    );
  });

  // Test 5: token-cap cascade — compress baseline detail
  it('token-cap cascade — compresses API baseline detail when evidence-drop is insufficient', () => {
    const fixture = loadFixture();
    // Drop evidence to nothing so step 1 has nothing to remove; then bloat each
    // baseline's sessionId + name with very long padding such that:
    //   - pre-compression total exceeds the 120k-token cap (forces step 2);
    //   - post-compression (which drops name, sessionId, counts, createdAt
    //     while retaining baselineId + status) brings us back under the cap.
    const padding = 'pad-'.repeat(150); // ~600 chars
    const baselines: NonNullable<
      NonNullable<MigrationDiscoveryContext['apiBehaviourBaselineSummary']>['baselines']
    > = [];
    for (let i = 0; i < 400; i++) {
      baselines.push({
        baselineId: `b${i}`,
        architectureId: 'curr-1',
        sessionId: 'sess-' + padding + i,
        name: 'baseline-name-' + padding + i,
        status: 'active',
        operationCount: 25,
        acceptedCaptureCount: 200,
        createdAt: '2026-05-17T10:15:00Z',
      });
    }
    const oversized: MigrationDiscoveryContext = {
      ...fixture,
      evidenceHighlights: [],
      apiBehaviourBaselineSummary: {
        totalBaselines: baselines.length,
        baselines,
      },
    };
    expect(approxTokens(oversized)).toBeGreaterThan(MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP);

    const outcome = applyTokenBudgetCascade(oversized);
    expect(outcome.warnings.join(' ')).toMatch(/step 2/);
    expect(outcome.finalTokenCount).toBeLessThanOrEqual(MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP);
    // Baseline IDs are retained even after compression.
    expect(outcome.context.apiBehaviourBaselineSummary?.baselines?.length).toBe(
      baselines.length
    );
    const compressed = outcome.context.apiBehaviourBaselineSummary?.baselines?.[0];
    expect(compressed?.baselineId).toBe('b0');
    // ... but per-baseline operationCount + acceptedCaptureCount are dropped.
    expect(compressed?.operationCount).toBeUndefined();
    expect(compressed?.acceptedCaptureCount).toBeUndefined();
  });

  // Test 6: token-cap cascade — fail loudly when always-retained sections overflow alone
  it('token-cap cascade — fails loudly with TokenBudgetOverflowError when always-retained sections alone overflow the cap', () => {
    const fixture = loadFixture();
    // Replace currentArchitectureSummary with a massively bloated inline detail
    // that we cannot legally truncate (it's in the always-retained set).
    const bloat: Record<string, string> = {};
    for (let i = 0; i < 80_000; i++) {
      bloat['k' + i] =
        'value padded to inflate tokens beyond the 120k soft cap; '.repeat(2);
    }
    const oversized: MigrationDiscoveryContext = {
      ...fixture,
      evidenceHighlights: [],
      highPriorityFindings: [],
      apiBehaviourBaselineSummary: undefined,
      currentArchitectureSummary: {
        ...fixture.currentArchitectureSummary!,
        ...(bloat as unknown as Record<string, never>),
      },
    };
    expect(approxTokens(oversized)).toBeGreaterThan(MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP);

    expect(() => applyTokenBudgetCascade(oversized)).toThrow(TokenBudgetOverflowError);
  });

  // Test 7: single synchronous LLM call
  it('single synchronous LLM call — the handler invokes the LLM exactly once', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-1call', summary: 'ok' });

    const counter = { count: 0 };
    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
      },
      { fetchContext, callLlm, createDraft, llmInvocationCounter: counter, systemPromptOverride: 'SYS' }
    );

    expect(counter.count).toBe(1);
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  // Test 8: AMS POST shape — the JSON sent to AMS includes the four sibling JSONB blobs
  it('AMS POST shape — body uses AMS snake_case keys + book_of_work_json:{items} (NOT camelCase / bare array)', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'd', summary: 's' });

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
      },
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    const [postedProjectId, postedBody] = createDraft.mock.calls[0];
    expect(postedProjectId).toBe(fixture.projectId);
    expect(postedBody).toMatchObject({
      title: expect.any(String),
      summary: expect.any(String),
      current_architecture_id: fixture.currentArchitectureId,
      target_architecture_id: fixture.targetArchitectureId,
      generation_inputs_json: expect.any(Object),
      generation_summary_json: expect.any(Object),
      quality_assessment_json: expect.any(Object),
      book_of_work_json: { items: expect.any(Array) },
    });
    // Regression guard: the OLD camelCase / bare-array spellings must be ABSENT
    // (sending them made AMS silently persist a null book_of_work_json).
    expect(postedBody.bookOfWork).toBeUndefined();
    expect(postedBody.currentArchitectureId).toBeUndefined();
    expect(postedBody.book_of_work_json.items.length).toBeGreaterThan(0);
  });

  // Smoke test: buildUserPrompt includes both the context and the wizard answers
  it('buildUserPrompt embeds the context and wizard answers in the user-side prompt', () => {
    const fixture = loadFixture();
    const prompt = buildUserPrompt(fixture, {
      deliveryStreams: ['CustomerService', 'PricingService'],
      migrationStyle: 'strangler-fig',
    });
    expect(prompt).toContain('MIGRATION DISCOVERY CONTEXT');
    expect(prompt).toContain(fixture.currentArchitectureId);
    expect(prompt).toContain('WIZARD ANSWERS');
    expect(prompt).toContain('strangler-fig');
  });
});

// ---------------------------------------------------------------------------
// Per-stream split + deterministic assembly (2026-06-11) — the whole-plan
// single shot 504'd at the Azure relay's ~300s cap; generation now runs one
// parallel call per selected delivery stream and assembles deterministically.
// ---------------------------------------------------------------------------

describe('Migration Delivery Plan — per-stream split generation', () => {
  const STREAMS = [
    'target_service_api_implementation',
    'target_infrastructure_environment_implementation',
    'cutover_rollback_decommission',
  ];

  function wizardAnswersWithStreams() {
    return {
      migrationIntent: ['like_for_like_replacement'],
      deliveryStreams: [...STREAMS],
      migrationStyle: 'big_bang',
    };
  }

  it('runs ONE LLM call per selected stream (parallel), each scoped in the prompt, and POSTs ONE assembled draft', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    // Every stream returns the SAME 4-item book (I1>E1>F1>S1) — the colliding
    // raw ids PROVE the assembler's per-stream namespacing (un-namespaced, the
    // assembled validation would fail on duplicate ids).
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-split', summary: 'ok' });
    const counter = { count: 0 };

    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        wizardAnswers: wizardAnswersWithStreams(),
      },
      { fetchContext, callLlm, createDraft, llmInvocationCounter: counter, systemPromptOverride: 'SYS' }
    );

    // One call per stream — no combined whole-plan call.
    expect(counter.count).toBe(3);
    expect(callLlm).toHaveBeenCalledTimes(3);
    // Each prompt is scoped to exactly one stream.
    const prompts = callLlm.mock.calls.map((c) => c[0].userPrompt as string);
    for (const stream of STREAMS) {
      expect(prompts.some((p) => p.includes(`Scope: ${stream}`))).toBe(true);
    }

    // EXACTLY ONE AMS write carrying the assembled set (3 streams x 4 items).
    expect(createDraft).toHaveBeenCalledTimes(1);
    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.book_of_work_json.items).toHaveLength(12);
    // Namespaced ids: the per-stream hierarchies stay intact and never collide.
    const ids = postedBody.book_of_work_json.items.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(12);
    expect(ids).toContain('target_service_api_implementation:I1');
    expect(ids).toContain('cutover_rollback_decommission:S1');
    expect(result.draftId).toBe('draft-split');
  });

  it('assembleBookOfWork orders streams by delivery dependency (schema before API, cutover last), renumbers sequenceOrder globally, and recomputes counts', () => {
    const book = JSON.parse(makeValidBookOfWorkJson()) as GeneratedMigrationBookOfWork;
    // PURE assembly test — assembleBookOfWork never touches the LLM or the
    // deterministic DB path, so the DB stream stays exercisable here even
    // though generateMigrationBookOfWork now builds it deterministically
    // (Spec 2026-07-02-b). Elsewhere in this file the per-stream LLM tests
    // swapped the DB stream for infrastructure for the same reason.
    const assembled = assembleBookOfWork([
      // Deliberately out of dependency order.
      { stream: 'cutover_rollback_decommission', book },
      { stream: 'target_service_api_implementation', book },
      { stream: 'target_database_schema_implementation', book },
    ]);

    // Stream order: db(2) -> api(3) -> cutover(10).
    const order = assembled.items.map((i) => i.id.split(':')[0]);
    expect(order.slice(0, 4).every((s) => s === 'target_database_schema_implementation')).toBe(true);
    expect(order.slice(4, 8).every((s) => s === 'target_service_api_implementation')).toBe(true);
    expect(order.slice(8).every((s) => s === 'cutover_rollback_decommission')).toBe(true);

    // Global sequenceOrder is 1..N.
    expect(assembled.items.map((i) => i.sequenceOrder)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    );

    // parentIds are namespaced into the SAME stream as their children.
    const story = assembled.items.find(
      (i) => i.id === 'target_database_schema_implementation:S1'
    )!;
    expect(story.parentId).toBe('target_database_schema_implementation:F1');

    // Counts are recomputed from the assembled items (3 of each type).
    expect(assembled.generationSummary).toMatchObject({
      totalItems: 12,
      countsByType: { initiative: 3, epic: 3, feature: 3, story: 3 },
    });

    // Provenance markers + per-item stream tag.
    expect(assembled.generationInputs).toMatchObject({ generationMode: 'per-stream-split' });
    expect(story.tags).toContain('stream:target_database_schema_implementation');
  });

  it('retries a failed stream ONCE; a stream failing twice fails the WHOLE generation (AMS never written) naming the stream', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const createDraft = jest.fn();

    // The db stream fails on BOTH attempts; the others succeed.
    const callLlm = jest.fn().mockImplementation(({ userPrompt }: { userPrompt: string }) => {
      if (userPrompt.includes('Scope: target_infrastructure_environment_implementation')) {
        return Promise.reject(new Error('HTTP 504 - Endpoint request timed out'));
      }
      return Promise.resolve({ content: makeValidBookOfWorkJson() });
    });

    await expect(
      generateMigrationBookOfWork(
        {
          projectId: fixture.projectId,
          currentArchitectureId: fixture.currentArchitectureId,
          targetArchitectureId: fixture.targetArchitectureId ?? '',
          wizardAnswers: wizardAnswersWithStreams(),
        },
        { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
      )
    ).rejects.toThrow(
      'Delivery stream "target_infrastructure_environment_implementation" generation failed after retry'
    );

    // The failing stream was attempted exactly twice (one retry).
    const dbCalls = callLlm.mock.calls.filter((c) =>
      (c[0].userPrompt as string).includes('Scope: target_infrastructure_environment_implementation')
    );
    expect(dbCalls).toHaveLength(2);
    // ATOMIC: no partial draft reaches AMS.
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('a transient failure recovered by the single retry still succeeds end-to-end', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-retry', summary: 'ok' });

    let dbAttempts = 0;
    const callLlm = jest.fn().mockImplementation(({ userPrompt }: { userPrompt: string }) => {
      if (userPrompt.includes('Scope: target_infrastructure_environment_implementation')) {
        dbAttempts += 1;
        if (dbAttempts === 1) {
          return Promise.reject(new Error('transient relay blip'));
        }
      }
      return Promise.resolve({ content: makeValidBookOfWorkJson() });
    });

    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        wizardAnswers: wizardAnswersWithStreams(),
      },
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    expect(result.draftId).toBe('draft-retry');
    expect(dbAttempts).toBe(2);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
});


// ---------------------------------------------------------------------------
// Phase-1 skeleton generation (Spec 2026-06-11 Two-Phase Migration Delivery
// Plan Generation, Task Group 3) — with streams selected, Generate produces
// ONLY the initiative → epic → feature skeleton (no stories, no acceptance
// criteria), every epic seeded expansionState='not_expanded' in the persisted
// draft, all per-stream calls routed through the shared bounded pool. The
// legacy no-streams combined path is byte-for-byte behaviourally unchanged.
// ---------------------------------------------------------------------------

describe('Migration Delivery Plan — phase-1 skeleton generation (Spec 2026-06-11, Task Group 3)', () => {
  const STREAMS = [
    'target_service_api_implementation',
    'target_infrastructure_environment_implementation',
    'cutover_rollback_decommission',
  ];

  // Skeleton fixture: initiative → epic → feature ONLY, empty acceptance
  // criteria — what a compliant skeleton-mode LLM returns.
  function makeSkeletonBookOfWorkJson(): string {
    const full = JSON.parse(makeValidBookOfWorkJson()) as GeneratedMigrationBookOfWork;
    full.items = full.items
      .filter((i) => i.type !== 'story')
      .map((i) => ({ ...i, acceptanceCriteria: [] }));
    return JSON.stringify(full);
  }

  it('skeleton mode — per-stream prompts carry the skeleton instruction; assembled plan has NO stories and NO acceptance criteria', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeSkeletonBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-skeleton', summary: 'ok' });

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        wizardAnswers: { deliveryStreams: [...STREAMS] },
      },
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    // Every per-stream user prompt carries the skeleton-mode instruction.
    expect(callLlm).toHaveBeenCalledTimes(3);
    for (const call of callLlm.mock.calls) {
      const prompt = call[0].userPrompt as string;
      expect(prompt).toContain('PHASE 1 — SKELETON MODE (TWO-PHASE GENERATION)');
      expect(prompt).toContain('Do NOT emit any `story` items');
    }

    // The assembled draft contains NO story items and NO acceptance criteria.
    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<{
      type: string;
      acceptanceCriteria: string[];
    }>;
    expect(items.length).toBe(9); // 3 streams x (initiative + epic + feature)
    expect(items.some((i) => i.type === 'story')).toBe(false);
    expect(items.every((i) => i.acceptanceCriteria.length === 0)).toBe(true);
  });

  it('skeleton mode — every epic in the persisted draft carries expansionState=not_expanded; non-epics carry none', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeSkeletonBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-seeded', summary: 'ok' });

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        wizardAnswers: { deliveryStreams: [...STREAMS] },
      },
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<{
      type: string;
      expansionState?: string;
    }>;
    const epics = items.filter((i) => i.type === 'epic');
    expect(epics.length).toBe(3);
    expect(epics.every((e) => e.expansionState === 'not_expanded')).toBe(true);
    expect(
      items.filter((i) => i.type !== 'epic').every((i) => i.expansionState === undefined)
    ).toBe(true);
  });

  it('legacy no-streams path — still ONE full combined call with NO skeleton instruction and stories intact (regression guard)', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-legacy', summary: 'ok' });
    const counter = { count: 0 };

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        // No deliveryStreams selected → legacy combined single call.
      },
      { fetchContext, callLlm, createDraft, llmInvocationCounter: counter, systemPromptOverride: 'SYS' }
    );

    expect(counter.count).toBe(1);
    const prompt = callLlm.mock.calls[0][0].userPrompt as string;
    expect(prompt).not.toContain('SKELETON MODE');
    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<{ type: string; expansionState?: string }>;
    // Full plan including the story; legacy path does NOT seed expansion state.
    expect(items.some((i) => i.type === 'story')).toBe(true);
    expect(items.every((i) => i.expansionState === undefined)).toBe(true);
  });

  it('skeleton calls run through the shared bounded pool — with a limit-1 pool the per-stream calls execute fully serially', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const createDraft = jest
      .fn()
      .mockResolvedValue({ draftId: 'draft-pool', summary: 'ok' });

    let inFlight = 0;
    let maxInFlight = 0;
    const callLlm = jest.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { content: makeSkeletonBookOfWorkJson() };
    });

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        wizardAnswers: { deliveryStreams: [...STREAMS] },
      },
      {
        fetchContext,
        callLlm,
        createDraft,
        systemPromptOverride: 'SYS',
        llmPool: new LlmConcurrencyPool(1),
      }
    );

    expect(callLlm).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1); // fully serial under MIGRATION_PLAN_LLM_CONCURRENCY=1
  });
});
