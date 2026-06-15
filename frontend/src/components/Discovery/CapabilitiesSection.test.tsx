/**
 * CapabilitiesSection Tests (via FindingsTab host)
 *
 * Spec: 2026-06-14 D2 -- Capability Synthesis + Batch Spines -- Task Group 5.1.
 *
 * The read-only Capabilities section lives INSIDE FindingsTab (no standalone
 * tab -- Option-B deferred). These tests mount FindingsTab, mock BOTH
 * `findingsApi` (so the findings table resolves to empty) and `capabilitiesApi`,
 * and pin the read-only Capabilities behaviour:
 *
 *   1. The section renders one synthesised capability row showing name, kind,
 *      member count, and confidence.
 *   2. Expanding a capability row shows its members + the batch-spine summary
 *      (schedule / invocation edges / JIL topology from detail_json).
 *   3. The empty state renders cleanly when there are no capabilities.
 *   4. There are NO capability review-action controls (read-only -- no
 *      Approve/Reject/Defer for capabilities).
 *
 * renderWithProviders is used; interaction coverage is intentionally minimal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import type {
  DiscoveryFindingSearchResponse,
} from '../../api/findingsApi';
import type { DiscoveryCapabilityDto } from '../../api/capabilitiesApi';

// ----------------------------------------------------------------------------
// Mocks -- findingsApi (table resolves empty) + capabilitiesApi (the section)
// ----------------------------------------------------------------------------

const mockListFindings = vi.fn();
const mockListCapabilitiesByRun = vi.fn();

vi.mock('../../api/findingsApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/findingsApi')>(
    '../../api/findingsApi',
  );
  return {
    ...actual,
    listFindings: (...args: unknown[]) => mockListFindings(...args),
  };
});

vi.mock('../../api/capabilitiesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/capabilitiesApi')
  >('../../api/capabilitiesApi');
  return {
    ...actual,
    listCapabilitiesByRun: (...args: unknown[]) =>
      mockListCapabilitiesByRun(...args),
  };
});

vi.mock('./FindingsTab.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./FindingDetailDrawer.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./CapabilitiesSection.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

// Import AFTER mocks
import { FindingsTab } from './FindingsTab';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';
const RUN_ID = 'run-uuid-1';

function emptyFindings(): DiscoveryFindingSearchResponse {
  return { items: [], total: 0, page: 0, size: 500 };
}

function makeCapability(
  overrides: Partial<DiscoveryCapabilityDto> = {},
): DiscoveryCapabilityDto {
  return {
    id: 'cap-1',
    run_id: RUN_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Daily Risk Hierarchy Load Pipeline',
    kind: 'batch_pipeline',
    summary: 'Loads the risk hierarchy nightly at 06:00.',
    review_status: 'pending_review',
    previous_review_status: null,
    confidence: 0.85,
    detail_json: {
      seedKey: 'jil:jobs/risk.jil#RISK_BOX',
      seedMode: 'jil_dag',
      jilTopology: {
        jobs: [
          { name: 'RISK_BOX', jobType: 'b' },
          { name: 'RISK_EXTRACT', jobType: 'c', command: 'java RiskExtractJob' },
        ],
        boxes: ['RISK_BOX'],
        fileWatchers: [],
        edges: [
          { from: 'RISK_BOX', to: 'RISK_EXTRACT', mechanism: 'jil_box_member' },
        ],
      },
      invocations: [
        {
          from: 'RISK_BOX',
          fromKind: 'jil_box',
          to: 'RISK_EXTRACT',
          toKind: 'jil_job',
          mechanism: 'jil_box_member',
          confidence: 0.95,
        },
        {
          from: 'RISK_EXTRACT',
          fromKind: 'jil_job',
          to: 'com.example.risk.RiskExtractJob',
          toKind: 'java_class',
          mechanism: 'jil_command',
          confidence: 0.5,
        },
      ],
      schedule: { startTimes: '"06:00"', daysOfWeek: 'mo,tu,we,th,fr' },
      externalSystems: ['SybaseRiskDB'],
      behaviourBearing: true,
      artifacts: [],
    },
    source: 'capability_synthesis',
    created_by_stage: 'discoveryV3Pipeline.capabilitySynthesis',
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
    members: [
      {
        id: 'm-1',
        capability_id: 'cap-1',
        member_type: 'discovery_candidate',
        member_id: 'cand-extract',
        created_at: '2026-06-14T00:00:00Z',
      },
      {
        id: 'm-2',
        capability_id: 'cap-1',
        member_type: 'discovery_candidate',
        member_id: 'cand-extract-main',
        created_at: '2026-06-14T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('Capabilities section in FindingsTab (D2, Task Group 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFindings.mockReset();
    mockListCapabilitiesByRun.mockReset();
    mockListFindings.mockResolvedValue(emptyFindings());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a synthesised capability row with name, kind, member count, and confidence', async () => {
    mockListCapabilitiesByRun.mockResolvedValue([makeCapability()]);

    renderWithProviders(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('capabilities-section')).toBeInTheDocument();
    });

    // The section read the run-scoped capabilities for the tab's run.
    expect(mockListCapabilitiesByRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      RUN_ID,
    );

    const rows = screen.getAllByTestId('capability-row');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toHaveTextContent('Daily Risk Hierarchy Load Pipeline');
    // kind badge -- humanised for display ('batch_pipeline' -> 'Batch
    // Pipeline'); the raw kind rides on the badge title attribute.
    const kindBadge = within(row).getByTestId('capability-kind');
    expect(kindBadge).toHaveTextContent('Batch Pipeline');
    expect(kindBadge).toHaveAttribute('title', 'batch_pipeline');
    // member count (2 members) + confidence (85%)
    expect(within(row).getByTestId('capability-member-count')).toHaveTextContent(
      '2',
    );
    expect(within(row).getByTestId('capability-confidence')).toHaveTextContent(
      '85%',
    );
  });

  it('expanding a capability shows its members + the batch-spine summary', async () => {
    mockListCapabilitiesByRun.mockResolvedValue([makeCapability()]);

    renderWithProviders(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('capability-row')).toBeInTheDocument();
    });

    // Not expanded yet -> the detail panel is absent.
    expect(screen.queryByTestId('capability-detail-cap-1')).toBeNull();

    fireEvent.click(screen.getByTestId('capability-row'));

    const detail = await screen.findByTestId('capability-detail-cap-1');

    // Members panel lists both candidate members by id.
    const membersPanel = within(detail).getByTestId('capability-members');
    expect(membersPanel).toHaveTextContent('cand-extract');
    expect(membersPanel).toHaveTextContent('cand-extract-main');

    // Batch-spine summary: schedule + invocation edges + topology presence.
    const spine = within(detail).getByTestId('capability-batch-spine');
    // The invocation chain edges are rendered (the JIL box-member + the
    // inferred java_class edge).
    expect(spine).toHaveTextContent('RISK_BOX');
    expect(spine).toHaveTextContent('com.example.risk.RiskExtractJob');
    // External systems surfaced.
    expect(spine).toHaveTextContent('SybaseRiskDB');
  });

  it('renders the empty state cleanly when there are no capabilities', async () => {
    mockListCapabilitiesByRun.mockResolvedValue([]);

    renderWithProviders(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('capabilities-section')).toBeInTheDocument();
    });

    expect(screen.getByTestId('capabilities-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('capability-row')).toBeNull();
  });

  it('has NO capability review-action controls (read-only)', async () => {
    mockListCapabilitiesByRun.mockResolvedValue([makeCapability()]);

    renderWithProviders(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('capability-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('capability-row'));
    await screen.findByTestId('capability-detail-cap-1');

    // No Approve/Reject/Defer affordance anywhere in the capabilities section.
    expect(screen.queryByTestId('capability-action-approve')).toBeNull();
    expect(screen.queryByTestId('capability-action-reject')).toBeNull();
    expect(screen.queryByTestId('capability-action-defer')).toBeNull();
  });
});
