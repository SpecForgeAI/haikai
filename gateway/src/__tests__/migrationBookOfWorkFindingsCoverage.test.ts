/**
 * Tests for the create-time accepted-findings coverage snapshot.
 *
 * Spec 2026-06-11 Deterministic Findings-Coverage Verification + Gap
 * Wayfinding — Task Group 1.
 *
 * The gateway snapshots the ACCEPTED (status=approved) critical/high
 * discovery findings for the selected discovery runs into
 * `generationSummary.findingsCoverage` BEFORE the Stage-5 createDraft call,
 * in BOTH generation modes (per-stream assembly + legacy combined). The
 * `fetchAcceptedFindings` deps seam is injected in every handler test here —
 * no live AMS. The default fetcher test stubs `global.fetch` and asserts the
 * two-pass (severity=critical, severity=high) paged URL shapes.
 *
 * Test plan:
 *   1. Per-stream mode — assembled generationSummary carries the id-sorted,
 *      timestamp-free snapshot.
 *   2. Legacy combined mode — snapshot merged AND the LLM-emitted
 *      findingsAddressed / findingsNotAddressed keys deleted before create.
 *   3. Default fetcher — two severity passes per run with status=approved,
 *      page-until-short-page walk, union de-duped by finding id.
 *   4. No discovery runs selected — snapshot omitted entirely (fetcher never
 *      invoked).
 *   5. Runs selected, zero approved critical/high findings — snapshot
 *      persisted with an EMPTY findings array.
 *   6. Fail-soft — fetcher throws: warning appended, snapshot absent,
 *      generation still succeeds.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  generateMigrationBookOfWork,
  defaultFetchAcceptedFindings,
  AcceptedFindingSnapshotEntry,
} from '../services/migrationBookOfWorkHandler';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import { GeneratedMigrationBookOfWork } from '../services/generatedMigrationBookOfWorkSchema';

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://ams.test:8080',
  }),
  resetConfig: jest.fn(),
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

const TRUST_CHAIN_FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-06-11-findings-coverage-and-gap-wayfinding',
  'planning',
  'fixture-findings-coverage-trust-chain.json'
);

function loadFixture(): MigrationDiscoveryContext {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw) as MigrationDiscoveryContext;
}

// Minimal-but-valid GeneratedMigrationBookOfWork payload (mirrors the
// sibling migrationBookOfWorkHandler.test.ts fixture).
function makeValidBookOfWorkJson(
  generationSummaryOverrides: Record<string, unknown> = {}
): string {
  const payload: GeneratedMigrationBookOfWork = {
    title: 'Draft Migration Delivery Plan — LegacyOrderService',
    summary: 'Split monolith into CustomerService + PricingService.',
    generationInputs: { productDefinitionRefs: ['p1'] },
    generationSummary: {
      totalItems: 4,
      countsByType: { initiative: 1, epic: 1, feature: 1, story: 1 },
      ...generationSummaryOverrides,
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
        workstream: 'api_migration',
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
        workstream: 'api_migration',
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
        workstream: 'api_migration',
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

const ACCEPTED_FINDINGS: AcceptedFindingSnapshotEntry[] = [
  { id: 'fnd-zz', title: 'Stored procedure not migrated', severity: 'high', runId: 'run-1' },
  { id: 'fnd-aa', title: 'Trigger side effect', severity: 'critical', runId: 'run-1' },
  { id: 'fnd-mm', title: 'Implicit conversion risk', severity: 'high', runId: 'run-2' },
];

describe('Migration book-of-work findings-coverage snapshot (Spec 2026-06-11, Task Group 1)', () => {
  // Test 1: per-stream mode — assembled generationSummary carries the snapshot.
  it('per-stream mode — generationSummary carries an id-sorted, timestamp-free findingsCoverage snapshot', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd1', summary: 's' });
    const fetchAcceptedFindings = jest.fn().mockResolvedValue([...ACCEPTED_FINDINGS]);

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        discoveryRunIds: ['run-1', 'run-2'],
        wizardAnswers: { deliveryStreams: ['target_frontend_implementation'] },
      },
      { fetchContext, callLlm, createDraft, fetchAcceptedFindings, systemPromptOverride: 'SYS' }
    );

    expect(fetchAcceptedFindings).toHaveBeenCalledWith(
      fixture.projectId,
      fixture.currentArchitectureId,
      ['run-1', 'run-2']
    );
    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json.findingsCoverage).toEqual({
      findings: [
        { id: 'fnd-aa', title: 'Trigger side effect', severity: 'critical', runId: 'run-1' },
        { id: 'fnd-mm', title: 'Implicit conversion risk', severity: 'high', runId: 'run-2' },
        { id: 'fnd-zz', title: 'Stored procedure not migrated', severity: 'high', runId: 'run-1' },
      ],
    });
    // Deterministic counts still present alongside the snapshot.
    expect(postedBody.generation_summary_json.totalItems).toBe(4);
  });

  // Test 2: legacy combined mode — snapshot merged + LLM keys deleted.
  it('legacy combined mode — merges the snapshot AND deletes LLM-emitted findingsAddressed / findingsNotAddressed keys before create', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    // LLM emits the legacy keys (the real legacy bug: arrays where the
    // frontend expected numbers) — both must be stripped at create.
    const callLlm = jest.fn().mockResolvedValue({
      content: makeValidBookOfWorkJson({
        findingsAddressed: ['fnd-aa', 'fnd-zz'],
        findingsNotAddressed: 7,
      }),
    });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd2', summary: 's' });
    const fetchAcceptedFindings = jest.fn().mockResolvedValue([...ACCEPTED_FINDINGS]);

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        discoveryRunIds: ['run-1'],
        // No deliveryStreams -> legacy combined single call.
      },
      { fetchContext, callLlm, createDraft, fetchAcceptedFindings, systemPromptOverride: 'SYS' }
    );

    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json).not.toHaveProperty('findingsAddressed');
    expect(postedBody.generation_summary_json).not.toHaveProperty('findingsNotAddressed');
    expect(postedBody.generation_summary_json.findingsCoverage.findings.map((f: { id: string }) => f.id)).toEqual([
      'fnd-aa',
      'fnd-mm',
      'fnd-zz',
    ]);
    // The rest of the LLM generationSummary survives the strip.
    expect(postedBody.generation_summary_json.totalItems).toBe(4);
  });

  // Test 3: default fetcher — two severity passes per run, paged walk, union by id.
  it('default fetcher — unions TWO single-value severity passes (critical, high) per run with status=approved, paging until a short page, de-duped by id', async () => {
    const requestedUrls: string[] = [];
    const page0Critical = Array.from({ length: 200 }, (_unused, i) => ({
      id: `crit-${String(i).padStart(3, '0')}`,
      title: `Critical ${i}`,
      severity: 'critical',
    }));
    const page1Critical = [
      { id: 'crit-tail', title: 'Critical tail', severity: 'critical' },
      // Duplicate of a page-0 finding — must be de-duped by id.
      { id: 'crit-000', title: 'Critical 0', severity: 'critical' },
    ];
    const highPage = [{ id: 'high-1', title: 'High one', severity: 'high' }];

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      requestedUrls.push(url);
      let items: unknown[] = [];
      if (url.includes('severity=critical')) {
        items = url.includes('page=0') ? page0Critical : url.includes('page=1') ? page1Critical : [];
      } else if (url.includes('severity=high')) {
        items = url.includes('page=0') ? highPage : [];
      }
      return {
        ok: true,
        json: async () => ({ items }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;

    const result = await defaultFetchAcceptedFindings('proj 1', 'arch-current', ['run-9']);

    // URL/param shapes: status=approved + single-value severity + page/size,
    // under the current architecture's run-scoped findings endpoint.
    expect(requestedUrls).toEqual([
      'http://ams.test:8080/api/model/projects/proj%201/architectures/arch-current/discovery/runs/run-9/findings?status=approved&severity=critical&page=0&size=200',
      'http://ams.test:8080/api/model/projects/proj%201/architectures/arch-current/discovery/runs/run-9/findings?status=approved&severity=critical&page=1&size=200',
      'http://ams.test:8080/api/model/projects/proj%201/architectures/arch-current/discovery/runs/run-9/findings?status=approved&severity=high&page=0&size=200',
    ]);
    // 200 page-0 criticals + 1 tail (duplicate dropped) + 1 high.
    expect(result).toHaveLength(202);
    const byId = new Map(result.map((f) => [f.id, f]));
    expect(byId.get('crit-tail')).toEqual({
      id: 'crit-tail',
      title: 'Critical tail',
      severity: 'critical',
      runId: 'run-9',
    });
    expect(byId.get('high-1')?.severity).toBe('high');
    expect(result.filter((f) => f.id === 'crit-000')).toHaveLength(1);
  });

  // Test 4: no discovery runs selected — snapshot omitted entirely.
  it('no discovery runs selected — findingsCoverage is omitted entirely and the fetcher is never invoked', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd3', summary: 's' });
    const fetchAcceptedFindings = jest.fn();

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        // discoveryRunIds absent.
      },
      { fetchContext, callLlm, createDraft, fetchAcceptedFindings, systemPromptOverride: 'SYS' }
    );

    expect(fetchAcceptedFindings).not.toHaveBeenCalled();
    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json).not.toHaveProperty('findingsCoverage');
  });

  // Test 5: runs selected but zero approved critical/high findings.
  it('runs selected with ZERO approved critical/high findings — persists findingsCoverage with an empty findings array', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd4', summary: 's' });
    const fetchAcceptedFindings = jest.fn().mockResolvedValue([]);

    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        discoveryRunIds: ['run-1'],
        wizardAnswers: { deliveryStreams: ['target_frontend_implementation'] },
      },
      { fetchContext, callLlm, createDraft, fetchAcceptedFindings, systemPromptOverride: 'SYS' }
    );

    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json.findingsCoverage).toEqual({ findings: [] });
  });

  // Test 6: fail-soft — fetch error warns, omits snapshot, generation succeeds.
  it('fail-soft — a fetcher error appends a generation warning, omits the snapshot, and generation still succeeds', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd5', summary: 's' });
    const fetchAcceptedFindings = jest
      .fn()
      .mockRejectedValue(new Error('AMS accepted discovery findings fetch failed: HTTP 503'));

    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        discoveryRunIds: ['run-1'],
        wizardAnswers: { deliveryStreams: ['target_frontend_implementation'] },
      },
      { fetchContext, callLlm, createDraft, fetchAcceptedFindings, systemPromptOverride: 'SYS' }
    );

    // Generation succeeded; snapshot absent (never a partial/empty-but-present
    // snapshot that would read as "0 accepted findings, full coverage").
    expect(result.draftId).toBe('d5');
    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json).not.toHaveProperty('findingsCoverage');
    expect(result.warnings?.join(' ')).toMatch(/Findings-coverage snapshot unavailable/);
  });
  // ==========================================================================
  // Task Group 5 — strategic end-to-end additions
  // ==========================================================================

  // Test 7 (5.3): END-TO-END through the REAL default fetcher — no injected
  // fetchAcceptedFindings seam. global.fetch serves the paged AMS findings
  // read (both severity passes, per run); the snapshot the handler persists
  // must deep-equal the SHARED trust-chain fixture that the frontend
  // computeFindingsCoverage test consumes (trust-chain agreement, 5.2c).
  it('end-to-end — the REAL default fetcher walks both severity passes per run and the persisted snapshot matches the shared trust-chain fixture', async () => {
    const trustChain = JSON.parse(
      fs.readFileSync(TRUST_CHAIN_FIXTURE_PATH, 'utf-8')
    ) as {
      discoveryRunIds: string[];
      generationSummary: {
        findingsCoverage: { findings: AcceptedFindingSnapshotEntry[] };
      };
    };
    const wireFindings = trustChain.generationSummary.findingsCoverage.findings;

    const requestedUrls: string[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      requestedUrls.push(url);
      const parsed = new URL(url);
      const runId = /\/runs\/([^/]+)\/findings/.exec(parsed.pathname)?.[1] ?? '';
      const severity = parsed.searchParams.get('severity');
      const page = parsed.searchParams.get('page');
      // Serve the fixture findings for the matching run + severity on page 0;
      // every page is short, so the walk stops after page 0 per pass.
      const items =
        page === '0'
          ? wireFindings
              .filter((f) => f.runId === runId && f.severity === severity)
              .map(({ id, title, severity: sev }) => ({ id, title, severity: sev }))
          : [];
      return { ok: true, json: async () => ({ items }), text: async () => '' };
    }) as unknown as typeof fetch;

    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd-e2e', summary: 's' });

    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        discoveryRunIds: trustChain.discoveryRunIds,
        wizardAnswers: { deliveryStreams: ['target_frontend_implementation'] },
      },
      // NO fetchAcceptedFindings injected — the real default fetcher runs.
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    expect(result.draftId).toBe('d-e2e');
    // Two severity passes fired for EACH of the two selected runs.
    for (const runId of trustChain.discoveryRunIds) {
      for (const severity of ['critical', 'high']) {
        expect(
          requestedUrls.some(
            (u) =>
              u.includes(`/runs/${runId}/findings`) &&
              u.includes(`severity=${severity}`) &&
              u.includes('status=approved')
          )
        ).toBe(true);
      }
    }
    // Trust-chain agreement: the persisted wire shape IS the shared fixture
    // the frontend computeFindingsCoverage test parses.
    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json.findingsCoverage).toEqual(
      trustChain.generationSummary.findingsCoverage
    );
  });

  // Test 8 (5.3): fail-soft through the REAL handler + REAL default fetcher —
  // the AMS findings read 503s, the warning surfaces in the result envelope,
  // NO snapshot is persisted, and generation still succeeds.
  it('fail-soft end-to-end — the REAL default fetcher hitting an AMS 503 yields a result-envelope warning, no snapshot, and a successful generation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'Service Unavailable',
    }) as unknown as typeof fetch;

    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd-e2e-fail', summary: 's' });

    const result = await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        discoveryRunIds: ['run-1'],
        wizardAnswers: { deliveryStreams: ['target_frontend_implementation'] },
      },
      // NO fetchAcceptedFindings injected — the real default fetcher fails.
      { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' }
    );

    expect(result.draftId).toBe('d-e2e-fail');
    expect(result.warnings?.join(' ')).toMatch(/Findings-coverage snapshot unavailable/);
    const [, postedBody] = createDraft.mock.calls[0];
    expect(postedBody.generation_summary_json).not.toHaveProperty('findingsCoverage');
  });
});
