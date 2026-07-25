/**
 * Oracle Coverage Scoring -- frontend surfacing tests
 *
 * Spec: 2026-06-17 Oracle Coverage Scoring -- Task Group 3 (3.1)
 *
 * Display-only surfacing of the session's `coverage_summary_json`. These 2-8
 * focused tests cover exactly what the task lists:
 *   - overall + per-endpoint score and missed-dimension reasons render on the
 *     session-detail / readiness view (CaptureSessionDetailView);
 *   - the same render at Save-as-Baseline (SaveAsBaselineModal);
 *   - thin coverage (only happy_path achieved / all negatives missing) is
 *     visually flagged;
 *   - a null / absent summary (legacy or pre-fix session) renders gracefully
 *     as "coverage not recorded", NOT an error.
 *
 * The pure parser + thin-detection helpers are also asserted directly so the
 * defensive (legacy/malformed -> "not recorded") and thin-flag logic is
 * pinned independently of the React tree.
 *
 * Mocking mirrors `CaptureSessionDetailView.coverageOverride.test.tsx`:
 * api client mocked with `vi.importActual` spread, MemoryRouter wrap,
 * ArchitectureContext / ProjectContext / modelApi stubbed as no-ops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    getCaptureSession: vi.fn(),
    cancelCaptureSession: vi.fn(),
    cloneCaptureSession: vi.fn(),
    startCaptureSession: vi.fn(),
    submitSecrets: vi.fn(),
    testApiConnection: vi.fn(),
    testDbConnection: vi.fn(),
    // The review panel mounts inside the detail view; stub its loads so it
    // renders empty without network.
    listOperations: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCaptures: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
}));

// The review panel also fetches migration discovery context on mount; stub it
// so the detail-view render does not hit the network.
vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  // Stable inline implementation (NOT vi.fn().mockResolvedValue) so a
  // beforeEach clearAllMocks() can never strip the implementation and leave
  // the panel effect calling `.then` on undefined.
  fetchMigrationDiscoveryContext: () => Promise.resolve(null),
}));

import {
  getCaptureSession,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';
import { SaveAsBaselineModal } from './SaveAsBaselineModal';
import {
  CoverageSummaryPanel,
  parseCoverageSummary,
  isThinEndpoint,
  type EndpointCoverage,
} from './CoverageSummaryPanel';

const PROJECT_ID = 'proj-cov-1';
const ARCH_ID = 'arch-cov-1';
const SESSION_ID = 'session-cov-1';

/** A full coverage summary: one well-covered endpoint, one thin endpoint, a
 *  missed auth dimension -- exercises overall + per-endpoint + missed reasons
 *  + thin flag + auth-negative coverage in one fixture. */
function buildCoverageSummary(): Record<string, unknown> {
  return {
    overall_score: 0.5,
    dimensions_total: 6,
    dimensions_achieved: 3,
    per_endpoint: [
      {
        operation_id: 'getPet',
        method: 'get',
        path: '/pets/{id}',
        score: 0.6666666,
        dimensions: [
          {
            name: 'happy_path',
            type: 'happy_path',
            expected_status: 'success',
            achieved: true,
            canonical_capture_id: 'cap-1',
            reason: null,
          },
          {
            name: 'not_found_id',
            type: 'not_found',
            expected_status: 'not_found',
            achieved: true,
            canonical_capture_id: 'cap-2',
            reason: null,
          },
          {
            name: 'bad_request_id',
            type: 'bad_request',
            expected_status: 'client_error',
            achieved: false,
            canonical_capture_id: null,
            reason: 'no capture matched the intended client_error class',
          },
        ],
      },
      {
        // THIN: only happy_path achieved; the lone negative is missing.
        operation_id: 'listPets',
        method: 'get',
        path: '/pets',
        score: 0.5,
        dimensions: [
          {
            name: 'happy_path',
            type: 'happy_path',
            expected_status: 'success',
            achieved: true,
            canonical_capture_id: 'cap-3',
            reason: null,
          },
          {
            name: 'enum_status_CLOSED',
            type: 'enum',
            expected_status: 'success',
            achieved: false,
            canonical_capture_id: null,
            reason: 'enum=CLOSED: no canonical capture — value not reachable',
          },
        ],
      },
    ],
    auth_coverage: {
      achieved: false,
      representative_operation_id: 'getPet',
      probes: [
        {
          name: 'no_token',
          expected: '401',
          achieved: true,
          observed_status: 401,
          reason: null,
        },
        {
          name: 'bad_token',
          expected: '401/403',
          achieved: false,
          observed_status: 200,
          reason: 'bad_token: expected 401/403 but observed 200',
        },
      ],
    },
  };
}

function buildSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'A session',
    status: 'completed',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'none',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: '2026-06-17T00:00:00Z',
    error_message: null,
    scenarios_attempted: 6,
    scenarios_completed: 3,
    scenarios_errored: 3,
    created_at: '2026-06-17T00:00:00Z',
    updated_at: '2026-06-17T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('coverage summary helpers (pure)', () => {
  it('parseCoverageSummary returns null for null / absent / malformed (legacy renders "not recorded")', () => {
    expect(parseCoverageSummary(null)).toBeNull();
    expect(parseCoverageSummary(undefined)).toBeNull();
    // Object missing all three sentinels -> treated as not-recorded, not an error.
    expect(parseCoverageSummary({ unrelated: 'x' })).toBeNull();
  });

  it('parseCoverageSummary narrows a full blob and isThinEndpoint flags thin endpoints', () => {
    const summary = parseCoverageSummary(buildCoverageSummary());
    expect(summary).not.toBeNull();
    expect(summary!.overall_score).toBe(0.5);
    expect(summary!.per_endpoint).toHaveLength(2);

    const [wellCovered, thin] = summary!.per_endpoint;
    expect(isThinEndpoint(wellCovered)).toBe(false);
    expect(isThinEndpoint(thin)).toBe(true);

    // All-negatives-missing endpoint is also thin.
    const allNegMissing: EndpointCoverage = {
      operation_id: 'x',
      method: 'get',
      path: '/x',
      score: 0.5,
      dimensions: [
        { name: 'happy_path', type: 'happy_path', expected_status: 'success', reported_only: false, achieved: true, canonical_capture_id: 'c', reason: null, observation: null },
        { name: 'not_found_id', type: 'not_found', expected_status: 'not_found', reported_only: false, achieved: false, canonical_capture_id: null, reason: 'r', observation: null },
      ],
    };
    expect(isThinEndpoint(allNegMissing)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Readiness / session-detail view
// ---------------------------------------------------------------------------

describe('CaptureSessionDetailView -- coverage surfacing (Task 3.3 / 3.5)', () => {
  it('renders overall + per-endpoint score, missed reasons, and a thin-coverage flag beside the tally', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ coverage_summary_json: buildCoverageSummary() }),
    );

    render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
        />
      </MemoryRouter>,
    );

    const panel = await screen.findByTestId('capture-session-coverage-summary');
    // Collapsible on the session screen (2026-07-25): DEFAULT COLLAPSED — the
    // one-line summary is visible, the per-endpoint detail is not, so the
    // review table below is reachable without scrolling past the panel.
    expect(panel).toHaveAttribute('data-collapsed', 'true');
    expect(
      within(panel).getByTestId('capture-session-coverage-summary-overall'),
    ).toHaveTextContent('Behaviour observed/captured: 50% (3 of 6 dimensions captured)');
    expect(
      within(panel).getByTestId('capture-session-coverage-summary-overall'),
    ).toHaveTextContent('expand for per-endpoint detail');
    expect(
      within(panel).queryByTestId('capture-session-coverage-summary-endpoint'),
    ).not.toBeInTheDocument();

    // Expand → the full detail renders.
    fireEvent.click(
      within(panel).getByTestId('capture-session-coverage-summary-toggle'),
    );
    expect(panel).toHaveAttribute('data-collapsed', 'false');

    // Per-endpoint badges (both endpoints rendered).
    const endpoints = within(panel).getAllByTestId(
      'capture-session-coverage-summary-endpoint',
    );
    expect(endpoints).toHaveLength(2);

    // Missed-dimension reasons surfaced.
    expect(panel).toHaveTextContent(
      'no capture matched the intended client_error class',
    );
    expect(panel).toHaveTextContent('value not reachable');

    // Thin coverage visibly flagged on the thin endpoint only.
    const flags = within(panel).getAllByTestId(
      'capture-session-coverage-summary-thin-flag',
    );
    expect(flags).toHaveLength(1);

    // Auth-negative coverage dimension surfaced as missing with its reason.
    const auth = within(panel).getByTestId('capture-session-coverage-summary-auth');
    expect(auth).toHaveAttribute('data-achieved', 'false');
    expect(auth).toHaveTextContent('bad_token');
  });

  it('renders "coverage not recorded" (never an error) for a legacy session with a null summary', async () => {
    vi.mocked(getCaptureSession).mockResolvedValue(
      buildSession({ coverage_summary_json: null }),
    );

    render(
      <MemoryRouter>
        <CaptureSessionDetailView
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
        />
      </MemoryRouter>,
    );

    const notRecorded = await screen.findByTestId(
      'capture-session-coverage-summary-not-recorded',
    );
    expect(notRecorded).toHaveTextContent('Coverage not recorded.');
    // Not the populated panel, and no error banner.
    expect(
      screen.queryByTestId('capture-session-coverage-summary'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Collapsible panel props (2026-07-25)
// ---------------------------------------------------------------------------

describe('CoverageSummaryPanel -- collapsible props', () => {
  const classes = { banner: 'banner', badge: 'badge' };

  it('non-collapsible hosts are unchanged: no toggle, detail always rendered', () => {
    render(<CoverageSummaryPanel raw={buildCoverageSummary()} classes={classes} />);
    const panel = screen.getByTestId('coverage-summary');
    expect(panel).not.toHaveAttribute('data-collapsed');
    expect(within(panel).queryByTestId('coverage-summary-toggle')).not.toBeInTheDocument();
    expect(within(panel).getAllByTestId('coverage-summary-endpoint')).toHaveLength(2);
  });

  it('collapsible + defaultCollapsed=false starts expanded and collapses on toggle', () => {
    render(
      <CoverageSummaryPanel
        raw={buildCoverageSummary()}
        classes={classes}
        collapsible
        defaultCollapsed={false}
      />,
    );
    const panel = screen.getByTestId('coverage-summary');
    expect(panel).toHaveAttribute('data-collapsed', 'false');
    expect(within(panel).getAllByTestId('coverage-summary-endpoint')).toHaveLength(2);
    fireEvent.click(within(panel).getByTestId('coverage-summary-toggle'));
    expect(panel).toHaveAttribute('data-collapsed', 'true');
    expect(within(panel).queryByTestId('coverage-summary-endpoint')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Save-as-Baseline surface
// ---------------------------------------------------------------------------

describe('SaveAsBaselineModal -- coverage surfacing (Task 3.4)', () => {
  it('renders overall + per-endpoint coverage with missed reasons beside the coverage warning', () => {
    render(
      <MemoryRouter>
        <SaveAsBaselineModal
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
          captures={[]}
          operations={[]}
          scenarios={[]}
          operationsWithoutAccepted={[]}
          coverageSummaryJson={buildCoverageSummary()}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    const panel = screen.getByTestId('save-as-baseline-coverage-summary');
    expect(
      within(panel).getByTestId('save-as-baseline-coverage-summary-overall'),
    ).toHaveTextContent('Behaviour observed/captured: 50%');
    expect(panel).toHaveTextContent(
      'no capture matched the intended client_error class',
    );
    // Thin endpoint flagged here too.
    expect(
      within(panel).getAllByTestId('save-as-baseline-coverage-summary-thin-flag'),
    ).toHaveLength(1);
  });

  it('renders "coverage not recorded" at Save-as-Baseline for an absent summary', () => {
    render(
      <MemoryRouter>
        <SaveAsBaselineModal
          projectId={PROJECT_ID}
          architectureId={ARCH_ID}
          sessionId={SESSION_ID}
          captures={[]}
          operations={[]}
          scenarios={[]}
          operationsWithoutAccepted={[]}
          coverageSummaryJson={null}
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('save-as-baseline-coverage-summary-not-recorded'),
    ).toHaveTextContent('Coverage not recorded.');
  });
});
