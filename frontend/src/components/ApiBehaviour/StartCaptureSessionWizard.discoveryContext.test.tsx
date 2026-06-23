/**
 * StartCaptureSessionWizard -- Discovery Context section tests
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 4
 *
 * Coverage:
 *   - Section auto-expands when findings exist for the active architecture.
 *   - Section stays collapsed (with "no findings" subtitle) when AMS reports
 *     zero findings.
 *   - Discovery run selector lists runs from `discoveryRunsSummary.runs`.
 *   - Per-selection finding summary panel renders severity / category /
 *     decision task / sample hint / runtime / DB counts.
 *   - Start request payload includes `discoveryRunIds[]` +
 *     `includeDiscoveryContext: true` when the user opts in.
 *   - Start request payload sends `includeDiscoveryContext: false` and omits
 *     `discoveryRunIds[]` when the user explicitly opts out.
 *
 * Test strategy:
 *   - Mock `apiBehaviourClient` (create/parse/submit/list/update + start) so
 *     the wizard's step transitions never hit the network.
 *   - Mock `migrationDiscoveryContextApi.fetchMigrationDiscoveryContext` to
 *     return a fixed context fixture per test variant.
 *   - Mock `useArchitecture` to return an in-memory model with one Interface.
 *   - Drive the wizard end-to-end and assert on the body passed to
 *     `startCaptureSession`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    createCaptureSession: vi.fn(),
    submitSecrets: vi.fn(),
    parseOas: vi.fn(),
    startCaptureSession: vi.fn(),
    updateCaptureSession: vi.fn(),
    updateOperation: vi.fn(),
    listOperations: vi.fn().mockResolvedValue([]),
    // Renumber (Spec 2026-06-20): the Step 4 -> 5 advance now fetches the
    // data-type-format preview. An EMPTY result auto-skips the new step so
    // these flows still land on Start (step 6) after one Next from Step 4.
    dataTypeDefaultsPreview: vi.fn().mockResolvedValue({ sessionId: 'session-discovery-1', rows: [] }),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn(),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

import {
  createCaptureSession,
  submitSecrets,
  parseOas,
  startCaptureSession,
  updateCaptureSession,
  listOperations,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-discovery-ctx';
const ARCH_ID = 'arch-discovery-ctx';

function mockArchModel() {
  return {
    model: {
      metaModel: {
        entities: {
          interfaces: [
            {
              id: 'iface-1',
              name: 'Customer API',
              description: '',
              service_id: 'svc-1',
              interface_type: 'REST_API',
              spec_link: 'customer-api.json',
              tags: '',
            },
          ],
        },
      },
    },
  } as unknown as ReturnType<typeof useArchitecture>;
}

function buildSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: 'session-discovery-1',
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Test session',
    status: 'draft',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'none',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

function buildDiscoveryCtxWithFindings() {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: ['run-A', 'run-B'],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-05-16T00:00:00Z',
    discoveryRunsSummary: {
      totalRuns: 2,
      completedRuns: 2,
      runs: [
        {
          runId: 'run-A',
          architectureId: ARCH_ID,
          status: 'completed',
          discoveryKind: 'service',
          createdAt: '2026-05-15T12:00:00Z',
          updatedAt: '2026-05-15T12:30:00Z',
        },
        {
          runId: 'run-B',
          architectureId: ARCH_ID,
          status: 'completed',
          discoveryKind: 'database',
          createdAt: '2026-05-14T12:00:00Z',
          updatedAt: '2026-05-14T12:30:00Z',
        },
      ],
    },
    findingsSummary: {
      totalFindings: 12,
      countsByStatus: { needs_review: 3, accepted: 2 },
      countsBySeverity: { critical: 1, high: 4, medium: 5, low: 2 },
      countsByCategory: { runtime_usage: 4, missing_contract_detail: 2 },
      highSeverityUnreviewedCount: 3,
      sampleDataHintCount: 2,
    },
    highPriorityFindings: [],
    findingsByCategory: { runtime_usage: 4 },
    evidenceHighlights: [],
    unresolvedDecisionTasks: [
      {
        taskId: 'task-1',
        runId: 'run-A',
        taskType: 'cluster_review',
        status: 'open',
        createdAt: '2026-05-15T12:30:00Z',
      },
    ],
    runtimeUsageSummary: {
      runtimeEvidenceCount: 5,
      runtimeFindingCount: 4,
      hasRuntimeEvidence: true,
    },
    databaseDiscoverySummary: {
      databaseFindingCount: 3,
      databaseRunCount: 1,
      sampleDataHintCount: 2,
      hasDatabaseDiscovery: true,
    },
    readinessAssessment: { overallStatus: 'partial' },
    contextWarnings: [],
  };
}

function buildDiscoveryCtxNoFindings() {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: [],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-05-16T00:00:00Z',
    discoveryRunsSummary: { totalRuns: 0, completedRuns: 0, runs: [] },
    findingsSummary: {
      totalFindings: 0,
      countsByStatus: {},
      countsBySeverity: {},
      countsByCategory: {},
      highSeverityUnreviewedCount: 0,
      sampleDataHintCount: 0,
    },
    highPriorityFindings: [],
    findingsByCategory: {},
    evidenceHighlights: [],
    unresolvedDecisionTasks: [],
    runtimeUsageSummary: null,
    databaseDiscoverySummary: null,
    readinessAssessment: { overallStatus: 'insufficient' },
    contextWarnings: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitecture).mockReturnValue(mockArchModel());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Discovery Context section -- visibility (Task 4.1 #2, #3)', () => {
  it('auto-expands and renders the run list when AMS reports findings exist', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      buildDiscoveryCtxWithFindings() as never,
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Section header is always rendered on step 1.
    expect(
      screen.getByTestId('start-capture-session-wizard-discovery-section'),
    ).toBeInTheDocument();

    // Body auto-expands once the fetch resolves.
    await waitFor(() => {
      expect(
        screen.getByTestId('start-capture-session-wizard-discovery-body'),
      ).toBeInTheDocument();
    });

    // Run selector lists both runs from the fixture.
    expect(
      screen.getByTestId('start-capture-session-wizard-discovery-run-run-A'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('start-capture-session-wizard-discovery-run-run-B'),
    ).toBeInTheDocument();
  });

  it('stays collapsed with a no-findings subtitle when AMS reports zero findings', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      buildDiscoveryCtxNoFindings() as never,
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Wait for the async fetch to settle.
    await waitFor(() => {
      expect(fetchMigrationDiscoveryContext).toHaveBeenCalledTimes(1);
    });

    // Body is NOT in the DOM because the section is still collapsed.
    expect(
      screen.queryByTestId('start-capture-session-wizard-discovery-body'),
    ).not.toBeInTheDocument();

    // Subtitle informs the user there are no findings.
    expect(
      screen.getByTestId('start-capture-session-wizard-discovery-section'),
    ).toHaveTextContent(/No discovery findings available/i);
  });
});

describe('Discovery Context section -- finding summary (Task 4.1 #4)', () => {
  it('renders severity / runtime / DB / decision task counts in the summary panel', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      buildDiscoveryCtxWithFindings() as never,
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    const summary = await screen.findByTestId(
      'start-capture-session-wizard-discovery-summary',
    );

    // critical (1) + high (4) = 5
    expect(summary).toHaveTextContent(/Critical \/ high severity:\s*5/);
    expect(summary).toHaveTextContent(/Needs review:\s*3/);
    expect(summary).toHaveTextContent(/Sample data hints:\s*2/);
    expect(summary).toHaveTextContent(/Runtime usage findings:\s*4/);
    expect(summary).toHaveTextContent(/Database discovery findings:\s*3/);
    expect(summary).toHaveTextContent(/Unresolved decision tasks:\s*1/);
  });
});

describe('Discovery Context section -- start payload (Task 4.1 #5, #6)', () => {
  /**
   * Drive the wizard end-to-end: step 1 (pick interface), step 2 (env
   * + base URL), step 3 (skip DB), step 4 (no operations), step 5 (Start).
   * Then assert on the body that was passed to `startCaptureSession`.
   */
  async function driveWizardToStart() {
    // Step 1 -> 2: select the interface, then click Next.
    fireEvent.click(
      screen.getByTestId('start-capture-session-wizard-interface-iface-1'),
    );
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    // Step 2: fill required env + base URL.
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-env-name'), {
      target: { value: 'non-prod' },
    });
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    // Step 3 -> 4 (creates draft, submits secrets, parses OAS).
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });
    // Step 4 -> (Data-type auto-skipped: empty preview) -> Response semantics
    // (step 6), which always shows.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });
    // Step 6 -> 7 (Response semantics -> Start).
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });
    // Step 7: Start.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-start'));
    });
  }

  beforeEach(() => {
    const created = buildSession();
    vi.mocked(createCaptureSession).mockResolvedValue(created);
    vi.mocked(submitSecrets).mockResolvedValue({ ok: true } as never);
    vi.mocked(parseOas).mockResolvedValue({
      sessionId: created.id,
      operationCount: 0,
      mutatingExcluded: 0,
      title: 'API',
      version: '1',
    });
    vi.mocked(updateCaptureSession).mockResolvedValue(
      buildSession({ status: 'configured' }),
    );
    vi.mocked(startCaptureSession).mockResolvedValue(
      buildSession({ status: 'running' }),
    );
    // Re-arm the operations list mock. The file-level afterEach runs
    // vi.restoreAllMocks(), which strips the factory default
    // (mockResolvedValue([])) off listOperations after the first test in
    // the file. The wizard step 3 -> 4 advance iterates the returned list,
    // so a bare (undefined-returning) mock would throw {ops is not iterable}
    // and strand the wizard before the Start step. No operations are needed
    // for these start-payload assertions.
    vi.mocked(listOperations).mockResolvedValue([]);
  });

  it('submits discoveryRunIds + includeDiscoveryContext=true when the user opts in', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      buildDiscoveryCtxWithFindings() as never,
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Wait for the discovery context to land so the auto-selected run
    // (latest completed = run-A) is in state.
    await screen.findByTestId('start-capture-session-wizard-discovery-run-run-A');

    await driveWizardToStart();

    expect(startCaptureSession).toHaveBeenCalledTimes(1);
    const startArgs = vi.mocked(startCaptureSession).mock.calls[0];
    const body = startArgs[3];
    expect(body).toBeDefined();
    expect(body!.includeDiscoveryContext).toBe(true);
    expect(body!.discoveryRunIds).toContain('run-A');
    expect(body!.maxFindings).toBe(100);
    expect(body!.maxEvidenceItems).toBe(100);
  });

  it('submits includeDiscoveryContext=false and omits discoveryRunIds[] when the user opts out', async () => {
    vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValueOnce(
      buildDiscoveryCtxWithFindings() as never,
    );

    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    // Wait for the auto-expanded body to mount.
    await screen.findByTestId('start-capture-session-wizard-discovery-body');

    // Uncheck the include toggle.
    fireEvent.click(
      screen.getByTestId('start-capture-session-wizard-include-discovery'),
    );

    await driveWizardToStart();

    expect(startCaptureSession).toHaveBeenCalledTimes(1);
    const startArgs = vi.mocked(startCaptureSession).mock.calls[0];
    const body = startArgs[3];
    expect(body).toBeDefined();
    expect(body!.includeDiscoveryContext).toBe(false);
    // When opted out we must not forward the run IDs nor the limits.
    expect(body!.discoveryRunIds).toBeUndefined();
    expect(body!.maxFindings).toBeUndefined();
    expect(body!.maxEvidenceItems).toBeUndefined();
  });
});
