/**
 * CaptureReviewPanel -- discovery-supported annotations tests
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 4
 *
 * Coverage:
 *   - Runtime-usage badge renders when AMS reports `runtimeUsageSummary`
 *     finding count > 0 for the session's architecture.
 *   - Missing-contract-detail warning renders when AMS reports
 *     `findingsSummary.countsByCategory.missing_contract_detail > 0`.
 *   - DB sample-hint per-scenario badge renders when the scenario row's
 *     `generation_source === 'db_sample'`.
 *   - No-discovery-evidence sentinel renders on every row when the AMS
 *     context reports zero total findings.
 *
 * Test strategy:
 *   - Mock `apiBehaviourClient` list endpoints to feed a tiny fixture.
 *   - Mock `migrationDiscoveryContextApi.fetchMigrationDiscoveryContext`
 *     per-test to drive the four annotation branches.
 *   - Stub `react-router-dom`'s `useNavigate` + provider hooks the same
 *     way `CaptureReviewPanel.test.tsx` does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    listOperations: vi.fn(),
    listScenarios: vi.fn(),
    listCaptures: vi.fn(),
    updateCapture: vi.fn(),
    updateScenario: vi.fn(),
    createBaseline: vi.fn(),
    createBaselineItem: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn(),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
}));

import {
  listOperations,
  listScenarios,
  listCaptures,
  type ApiBehaviourCaptureDto,
  type ApiBehaviourOperationDto,
  type ApiBehaviourScenarioDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { CaptureReviewPanel } from './CaptureReviewPanel';

const PROJECT_ID = 'proj-disc-ann';
const ARCH_ID = 'arch-disc-ann';
const SESSION_ID = 'session-disc-ann';

function buildOperation(
  overrides: Partial<ApiBehaviourOperationDto> = {},
): ApiBehaviourOperationDto {
  return {
    id: 'op-1',
    session_id: SESSION_ID,
    operation_id: 'getThing',
    method: 'GET',
    path: '/things/{id}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

function buildScenario(
  overrides: Partial<ApiBehaviourScenarioDto> = {},
): ApiBehaviourScenarioDto {
  return {
    id: 'sc-1',
    session_id: SESSION_ID,
    operation_id: 'op-1',
    scenario_name: 'happy path',
    scenario_type: 'happy',
    status: 'captured',
    generation_source: 'llm_generated',
    request_method: 'GET',
    request_path: '/things/123',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    notes: null,
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

function buildCapture(
  overrides: Partial<ApiBehaviourCaptureDto> = {},
): ApiBehaviourCaptureDto {
  return {
    id: 'cap-1',
    session_id: SESSION_ID,
    scenario_id: 'sc-1',
    operation_id: 'op-1',
    attempt_number: 1,
    request_method: 'GET',
    request_url_redacted: 'https://api/things/123',
    request_path: '/things/123',
    request_query_json: null,
    request_headers_redacted_json: null,
    request_body_json: null,
    response_status: 200,
    response_headers_redacted_json: null,
    response_body_json: { id: '123' },
    duration_ms: 42,
    error_type: null,
    error_message: null,
    captured_at: '2026-05-16T00:00:00Z',
    accepted: null,
    accepted_at: null,
    reviewer_notes: null,
    ...overrides,
  };
}

function discoveryCtxBuilder(opts: {
  totalFindings?: number;
  runtimeFindingCount?: number;
  missingContractDetailCount?: number;
  unresolvedDecisionTaskCount?: number;
  sampleDataHintCount?: number;
}) {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: [],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-05-16T00:00:00Z',
    findingsSummary: {
      totalFindings: opts.totalFindings ?? 0,
      countsByStatus: {},
      countsBySeverity: {},
      countsByCategory: {
        missing_contract_detail: opts.missingContractDetailCount ?? 0,
      },
      highSeverityUnreviewedCount: 0,
      sampleDataHintCount: opts.sampleDataHintCount ?? 0,
    },
    highPriorityFindings: [],
    findingsByCategory: {},
    evidenceHighlights: [],
    unresolvedDecisionTasks: Array.from(
      { length: opts.unresolvedDecisionTaskCount ?? 0 },
      (_, i) => ({
        taskId: `task-${i}`,
        runId: 'run-A',
        taskType: 'cluster_review',
        status: 'open',
        createdAt: '2026-05-16T00:00:00Z',
      }),
    ),
    runtimeUsageSummary: {
      runtimeEvidenceCount: 0,
      runtimeFindingCount: opts.runtimeFindingCount ?? 0,
      hasRuntimeEvidence: (opts.runtimeFindingCount ?? 0) > 0,
    },
    databaseDiscoverySummary: {
      databaseFindingCount: 0,
      databaseRunCount: 0,
      sampleDataHintCount: opts.sampleDataHintCount ?? 0,
      hasDatabaseDiscovery: (opts.sampleDataHintCount ?? 0) > 0,
    },
    readinessAssessment: { overallStatus: 'partial' },
    contextWarnings: [],
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <CaptureReviewPanel
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listOperations).mockResolvedValue([buildOperation()]);
  vi.mocked(listScenarios).mockResolvedValue([buildScenario()]);
  vi.mocked(listCaptures).mockResolvedValue([buildCapture()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CaptureReviewPanel -- runtime-usage badge (Task 4.1 #9)', () => {
  it('renders the runtime-usage badge when AMS reports runtime findings exist', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      discoveryCtxBuilder({ totalFindings: 6, runtimeFindingCount: 4 }) as never,
    );

    renderPanel();

    await waitFor(() => {
      expect(
        screen.queryByTestId('capture-review-discovery-runtime-usage-badge'),
      ).toBeInTheDocument();
    });
  });
});

describe('CaptureReviewPanel -- missing-contract-detail warning (Task 4.1 #10)', () => {
  it('renders the missing-contract-detail warning when AMS reports that category', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      discoveryCtxBuilder({
        totalFindings: 4,
        missingContractDetailCount: 2,
      }) as never,
    );

    renderPanel();

    await waitFor(() => {
      expect(
        screen.queryByTestId('capture-review-discovery-missing-contract-detail'),
      ).toBeInTheDocument();
    });
  });
});

describe('CaptureReviewPanel -- DB sample hint per-scenario badge', () => {
  it('renders the DB sample badge on rows whose scenario was generated from a db_sample', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      discoveryCtxBuilder({ totalFindings: 2, sampleDataHintCount: 2 }) as never,
    );
    // Override the default scenario to flip the generation source.
    vi.mocked(listScenarios).mockResolvedValueOnce([
      buildScenario({ generation_source: 'db_sample' }),
    ]);

    renderPanel();

    await waitFor(() => {
      expect(
        screen.queryByTestId('capture-review-scenario-db-sample-badge'),
      ).toBeInTheDocument();
    });
  });
});

describe('CaptureReviewPanel -- no-discovery-evidence sentinel', () => {
  it('renders the no-discovery-evidence sentinel when AMS reports zero findings', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      discoveryCtxBuilder({ totalFindings: 0 }) as never,
    );

    renderPanel();

    await waitFor(() => {
      expect(
        screen.queryByTestId('capture-review-discovery-no-evidence'),
      ).toBeInTheDocument();
    });
    // Per-row sentinel renders too.
    expect(
      screen.queryByTestId('capture-review-row-no-discovery-evidence'),
    ).toBeInTheDocument();
  });
});
