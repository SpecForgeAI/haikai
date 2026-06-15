/**
 * V3 Tier UX -- Frontend Task Group 6 Tests
 *
 * Spec 2026-04-20: V3 Tier UX -- Task Group 6 (frontend)
 *
 * Focused tests for:
 *  1. TierBadge variant selection from `_addedBy` and from `tier` prop.
 *  2. Run-detail warnings banner renders when tier is B or C; hidden for A.
 *  3. Candidate-table confidence slider filters correctly (default 0.7) and
 *     preserves null-confidence rows regardless of threshold.
 *  4. Candidate-table confidence slider: lowering threshold reveals more rows.
 *  5. 409 LLM_SOLO_CONFIRMATION_REQUIRED flow via createDiscoveryRun: error
 *     is surfaced typed, retry with confirmLlmSolo=true succeeds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { DiscoveryRunDto, DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mocks
// ============================================================================

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();

vi.mock('../../../api/discoveryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/discoveryApi')>();
  return {
    ...actual,
    getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
    getDiscoveryRun: (...args: unknown[]) => mockGetDiscoveryRun(...args),
    getDiscoveryCandidateCount: (...args: unknown[]) => mockGetDiscoveryCandidateCount(...args),
    getDiscoveryCandidates: (...args: unknown[]) => mockGetDiscoveryCandidates(...args),
  };
});

// Identity-mapped CSS modules so className assertions match property names
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
// DiscoveryRunDetailView now reads useActiveArchitectureId() and architectures
// from ArchitectureContext. Mock the hooks here so the component can mount
// without a real provider/router.
vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-uuid-default',
  useArchitectureContext: () => ({
    architectures: [
      {
        id: 'arch-uuid-default',
        projectId: 'proj-1',
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    invalidateArchitectureModelCache: vi.fn(),
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));

vi.mock('../TierBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeRun(overrides: Partial<DiscoveryRunDto> = {}): DiscoveryRunDto {
  return {
    id: 'run-1',
    project_id: 'proj-1',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-04-20T12:00:00Z',
    updated_at: '2026-04-20T12:30:00Z',
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-x',
    run_id: 'run-1',
    candidate_type: 'service',
    name: 'Unnamed',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-04-20T12:10:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

// ============================================================================
// Dynamic imports (refreshed between tests)
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
let TierBadge: any;
let DiscoveryRunDetailPage: any;
let DiscoveryCandidateTable: any;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
  mockGetDiscoveryRun.mockReset();
  mockGetDiscoveryCandidateCount.mockReset();
  mockGetDiscoveryCandidates.mockReset();

  TierBadge = (await import('../TierBadge')).TierBadge;
  DiscoveryRunDetailPage = (await import('../DiscoveryRunDetailPage')).DiscoveryRunDetailPage;
  DiscoveryCandidateTable = (await import('../DiscoveryCandidateTable')).DiscoveryCandidateTable;
});

// ============================================================================
// Tests
// ============================================================================

describe('V3 Tier UX -- TierBadge', () => {
  it('Test 1: maps _addedBy tag to the correct variant', () => {
    const { rerender } = render(<TierBadge addedBy="spring-boot-adapter" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('success');

    rerender(<TierBadge addedBy="llm-gap-fill" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('warning');

    rerender(<TierBadge addedBy="llm-ir-guided" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('caution');

    rerender(<TierBadge addedBy="llm-solo" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('danger');

    rerender(<TierBadge addedBy={null} />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('neutral');
  });

  it('Test 2: maps tier prop A/B/C to success/warning/danger', () => {
    const { rerender } = render(<TierBadge tier="A" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('success');
    expect(screen.getByTestId('tier-badge').textContent).toBe('Tier A');

    rerender(<TierBadge tier="B" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('warning');

    rerender(<TierBadge tier="C" />);
    expect(screen.getByTestId('tier-badge').getAttribute('data-variant')).toBe('danger');
  });
});

describe('V3 Tier UX -- Run detail warnings banner', () => {
  it('Test 3: renders warnings banner for Tier B and C, hides for Tier A', async () => {
    const tierARun = makeRun({ id: 'run-a', tier: 'A', warnings: [], mode: 'pack-supervised' });
    const tierBRun = makeRun({
      id: 'run-b',
      tier: 'B',
      mode: 'language-only',
      warnings: [
        "Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill.",
      ],
    });
    const tierCRun = makeRun({
      id: 'run-c',
      tier: 'C',
      mode: 'llm-solo',
      warnings: [
        'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.',
      ],
    });

    mockGetDiscoveryRuns.mockResolvedValue([tierARun, tierBRun, tierCRun]);
    mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValue([]);

    // Tier A: banner NOT shown
    mockGetDiscoveryRun.mockResolvedValueOnce(tierARun);
    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-a' });
    await waitFor(() => expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('run-warnings-banner')).not.toBeInTheDocument();
    cleanup();

    // Tier B: banner IS shown with warnings text
    mockGetDiscoveryRun.mockResolvedValueOnce(tierBRun);
    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-b' });
    await waitFor(() => {
      const banner = screen.queryByTestId('run-warnings-banner');
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('data-tier')).toBe('B');
      expect(banner!.textContent).toContain('language-only mode');
    });
    cleanup();

    // Tier C: banner IS shown with C-specific class data attribute
    mockGetDiscoveryRun.mockResolvedValueOnce(tierCRun);
    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-c' });
    await waitFor(() => {
      const banner = screen.queryByTestId('run-warnings-banner');
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('data-tier')).toBe('C');
      expect(banner!.textContent).toContain('LLM-only mode');
    });
  });
});

describe('V3 Tier UX -- Candidate confidence slider', () => {
  it('Test 4: default threshold 0.7 hides sub-threshold rows but keeps null-confidence rows', () => {
    const candidates = [
      makeCandidate({ id: 'c-high', name: 'HighCandidate', confidence: 0.95 }),
      makeCandidate({ id: 'c-mid', name: 'MidCandidate', confidence: 0.5 }), // sub-threshold
      makeCandidate({ id: 'c-null', name: 'UnmarkedCandidate', confidence: null as unknown as number }),
    ];

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={candidates}
        onCandidatesChange={() => {}}
      />
    );

    // Slider default value
    const slider = screen.getByTestId('confidence-slider') as HTMLInputElement;
    expect(slider.value).toBe('0.7');
    expect(screen.getByTestId('confidence-slider-value').textContent).toBe('0.70');

    // Rows: high (0.95) + null visible; mid (0.5) hidden
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.textContent ?? '');
    expect(names.some((n) => n.includes('HighCandidate'))).toBe(true);
    expect(names.some((n) => n.includes('UnmarkedCandidate'))).toBe(true);
    expect(names.some((n) => n.includes('MidCandidate'))).toBe(false);
  });

  it('Test 5: lowering the slider reveals sub-0.7 candidates', () => {
    const candidates = [
      makeCandidate({ id: 'c-high', name: 'HighCandidate', confidence: 0.9 }),
      makeCandidate({ id: 'c-low', name: 'LowCandidate', confidence: 0.4 }),
    ];

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={candidates}
        onCandidatesChange={() => {}}
      />
    );

    // Default hides 0.4
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(1);

    // Drop threshold to 0.3 -> both visible
    const slider = screen.getByTestId('confidence-slider');
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(2);
  });
});

describe('V3 Tier UX -- createDiscoveryRun 409 flow', () => {
  it('Test 6: 409 LLM_SOLO_CONFIRMATION_REQUIRED -> throws typed error; retry with confirmLlmSolo succeeds', async () => {
    // Import the un-mocked API client (this file's mock only touches GETs).
    const api = await import('../../../api/discoveryApi');
    const { createDiscoveryRun, LlmSoloConfirmationRequiredError } = api;

    // First call: server responds 409 with the gate envelope.
    const gatePayload = {
      error: {
        code: 'LLM_SOLO_CONFIRMATION_REQUIRED',
        tier: 'C',
        mode: 'llm-solo',
        warnings: [
          'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.',
        ],
      },
    };
    // Second call: server accepts and returns a run DTO.
    const successDto = makeRun({ id: 'run-confirmed', tier: 'C', mode: 'llm-solo', confirmed_llm_solo: true });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify(gatePayload), { status: 409, headers: { 'Content-Type': 'application/json' } })
      )
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify(successDto), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

    // Spec #4 Task Group 6: createDiscoveryRun now requires architectureId
    // (the run's bound architecture for life). projectId + architectureId
    // travel via the URL path; only confirmLlmSolo / serviceId go in the body.
    const ARCH_ID = 'arch-1';

    // Initial call should throw the typed error.
    let caught: unknown = null;
    try {
      await createDiscoveryRun('proj-1', ARCH_ID);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LlmSoloConfirmationRequiredError);
    const err = caught as InstanceType<typeof LlmSoloConfirmationRequiredError>;
    expect(err.code).toBe('LLM_SOLO_CONFIRMATION_REQUIRED');
    expect(err.tier).toBe('C');
    expect(err.warnings[0]).toContain('LLM-only mode');

    // Retry with confirmLlmSolo: true should succeed and the body should reflect it.
    const result = await createDiscoveryRun('proj-1', ARCH_ID, { confirmLlmSolo: true });
    expect(result.id).toBe('run-confirmed');
    expect(result.confirmed_llm_solo).toBe(true);

    // Validate the second request URL embedded the architecture-scoped path.
    const secondCallArgs = fetchMock.mock.calls[1];
    const secondUrl = secondCallArgs[0] as string;
    expect(secondUrl).toContain('/api/v1/discovery/projects/proj-1/architectures/arch-1/runs');
    // Validate the second request body included confirmLlmSolo: true and
    // does NOT carry projectId (URL is the source of truth post Group 6).
    const requestInit = secondCallArgs[1] as RequestInit;
    const bodyString = requestInit.body as string;
    const parsed = JSON.parse(bodyString);
    expect(parsed.confirmLlmSolo).toBe(true);
    expect(parsed.projectId).toBeUndefined();

    fetchMock.mockRestore();
  });
});
