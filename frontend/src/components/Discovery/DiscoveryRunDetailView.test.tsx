/**
 * DiscoveryRunDetailView Tests
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 6.1.
 *
 * Verifies the tab control hosts both "Candidates" and "Findings" tab
 * labels, defaults to Candidates, and swaps panel content on tab clicks
 * without unmounting the surrounding view shell. The Candidates tab
 * embeds the existing `DiscoveryCandidateTable` so we mock that table
 * out to a sentinel marker (rendering the real table in this unit test
 * would drag in the full DashboardView context graph -- the existing
 * `DashboardView/__tests__/discoveryRunDetailView.test.tsx` covers that
 * surface end-to-end, this test focuses on the tab orchestration).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  DiscoveryRunDto,
  DiscoveryCandidateDto,
} from '../../api/discoveryApi';

// ----------------------------------------------------------------------------
// Mocks for the embedded surfaces. These keep the test focused on the tab
// control orchestration; the underlying surfaces have their own dedicated
// test files.
// ----------------------------------------------------------------------------

vi.mock('../DashboardView/DiscoveryCandidateTable', () => ({
  DiscoveryCandidateTable: (props: {
    projectId: string;
    architectureId: string;
    runId: string;
    candidates: DiscoveryCandidateDto[];
  }) => (
    <div
      data-testid="mock-discovery-candidate-table"
      data-project-id={props.projectId}
      data-architecture-id={props.architectureId}
      data-run-id={props.runId}
      data-candidates-count={props.candidates.length}
    >
      DiscoveryCandidateTable mock
    </div>
  ),
}));

vi.mock('./FindingsTab', () => ({
  FindingsTab: (props: {
    projectId: string;
    architectureId: string;
    runId: string;
  }) => (
    <div
      data-testid="mock-findings-tab"
      data-project-id={props.projectId}
      data-architecture-id={props.architectureId}
      data-run-id={props.runId}
    >
      FindingsTab mock
    </div>
  ),
}));

// CSS module identity mock so styles.tabButtonActive etc. survive without
// a real CSS module loader.
vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { DiscoveryRunDetailView } from './DiscoveryRunDetailView';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';

const sampleRun: DiscoveryRunDto = {
  id: 'run-uuid-1',
  project_id: PROJECT_ID,
  status: 'COMPLETED',
  current_step: null,
  config_snapshot: null,
  steps_payload: null,
  error_message: null,
  created_at: '2026-05-16T00:00:00Z',
  updated_at: '2026-05-16T00:00:00Z',
  architecture_id: ARCH_ID,
};

const sampleCandidates: DiscoveryCandidateDto[] = [
  {
    id: 'cand-1',
    run_id: 'run-uuid-1',
    candidate_type: 'application',
    name: 'OrderService',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-16T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  },
];

describe('DiscoveryRunDetailView (Group 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both "Candidates" and "Findings" tab labels with Candidates active by default', () => {
    render(
      <DiscoveryRunDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        selectedRun={sampleRun}
        candidates={sampleCandidates}
        onCandidatesChange={vi.fn()}
      />,
    );

    // Both tabs render
    const candidatesTab = screen.getByTestId('discovery-run-detail-tab-candidates');
    const findingsTab = screen.getByTestId('discovery-run-detail-tab-findings');
    expect(candidatesTab).toBeInTheDocument();
    expect(findingsTab).toBeInTheDocument();
    expect(candidatesTab).toHaveTextContent('Candidates');
    expect(findingsTab).toHaveTextContent('Findings');

    // Default active = Candidates (no behaviour regression)
    expect(candidatesTab).toHaveAttribute('aria-selected', 'true');
    expect(findingsTab).toHaveAttribute('aria-selected', 'false');

    // Candidates panel content rendered
    expect(screen.getByTestId('mock-discovery-candidate-table')).toBeInTheDocument();
    // Findings panel content NOT rendered
    expect(screen.queryByTestId('mock-findings-tab')).not.toBeInTheDocument();
  });

  it('clicking "Findings" swaps the panel content to the Findings surface', () => {
    render(
      <DiscoveryRunDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        selectedRun={sampleRun}
        candidates={sampleCandidates}
        onCandidatesChange={vi.fn()}
      />,
    );

    // Pre-click: Candidates content is present
    expect(screen.getByTestId('mock-discovery-candidate-table')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('discovery-run-detail-tab-findings'));

    // Findings now selected, Candidates panel content removed
    expect(screen.getByTestId('discovery-run-detail-tab-findings')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('discovery-run-detail-tab-candidates')).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByTestId('mock-findings-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-discovery-candidate-table')).not.toBeInTheDocument();

    // The surrounding view shell (tab strip + tab buttons) is still mounted,
    // so we can swap back without remounting.
    fireEvent.click(screen.getByTestId('discovery-run-detail-tab-candidates'));
    expect(screen.getByTestId('mock-discovery-candidate-table')).toBeInTheDocument();
  });

  it('forwards projectId / architectureId / runId props into both tab surfaces', () => {
    render(
      <DiscoveryRunDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        selectedRun={sampleRun}
        candidates={sampleCandidates}
        onCandidatesChange={vi.fn()}
      />,
    );

    const candidatesMock = screen.getByTestId('mock-discovery-candidate-table');
    expect(candidatesMock).toHaveAttribute('data-project-id', PROJECT_ID);
    expect(candidatesMock).toHaveAttribute('data-architecture-id', ARCH_ID);
    expect(candidatesMock).toHaveAttribute('data-run-id', 'run-uuid-1');
    expect(candidatesMock).toHaveAttribute('data-candidates-count', '1');

    // Swap to Findings and verify props forwarded
    fireEvent.click(screen.getByTestId('discovery-run-detail-tab-findings'));
    const findingsMock = screen.getByTestId('mock-findings-tab');
    expect(findingsMock).toHaveAttribute('data-project-id', PROJECT_ID);
    expect(findingsMock).toHaveAttribute('data-architecture-id', ARCH_ID);
    expect(findingsMock).toHaveAttribute('data-run-id', 'run-uuid-1');
  });

  it('renders an empty-state when no run is selected (defensive against route loading)', () => {
    render(
      <DiscoveryRunDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        selectedRun={null}
        candidates={null}
        onCandidatesChange={vi.fn()}
      />,
    );

    // Candidates tab content -> empty-state since selectedRun is null
    expect(screen.getByTestId('candidates-tab-no-run')).toBeInTheDocument();

    // Switch to Findings tab -> also an empty-state
    fireEvent.click(screen.getByTestId('discovery-run-detail-tab-findings'));
    expect(screen.getByTestId('findings-tab-no-run')).toBeInTheDocument();
  });
});
