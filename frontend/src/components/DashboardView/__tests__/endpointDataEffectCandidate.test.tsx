/**
 * Endpoint -> Data-Effect candidate surfacing tests.
 *
 * Spec 2026-05-29 (Endpoint->Data-Effect Call Graph for Discovery) -- Task
 * Group 4, Task 4.1.
 *
 * Focused integration tests for surfacing the NEW `endpoint_data_effects`
 * reviewable relationship candidate type in the EXISTING Candidates review
 * stream. Mounts the real `DiscoveryCandidateTable` and reuses the
 * `CandidateDetailsPanel` / `candidateDetailsSupport` plumbing -- no new UI
 * layer. Mirrors the conventions in `candidateDetailsExpansion.test.tsx`:
 *   - `vi.mock('../../../api/discoveryApi', ...)` with a spread of the actual
 *     module so the table still resolves its named exports.
 *   - CSS-module identity Proxy mock so className lookups are predictable.
 *   - `ArchitectureContext` mocks so the table mounts without a provider.
 *
 * Tests (per spec, critical cases only):
 *   1. An `endpoint_data_effects` candidate renders in the Candidates stream
 *      as a relationship candidate with its `access_mode` and endpoint->entity
 *      identity visible (Code Detection summary fields).
 *   2. The controller->service->repository path renders as read-only,
 *      EXPANDABLE metadata (each hop = FQN + method signature) and is
 *      COLLAPSED by default; the operation hint + transactional flag show.
 *   3. A low-confidence-but-resolved edge renders in the NORMAL stream (the
 *      candidate table, not the Findings tab) and shows its low confidence.
 *   4. Approve acts on the edge candidate like any other relationship
 *      candidate (reuses the existing review action).
 *   5. (Task 4.4) The `endpoint_data_effect_unresolved` finding type resolves
 *      to a human-readable label via the shared `labelForFindingType` map the
 *      existing FindingsTab / FindingDetailDrawer already consume.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { labelForFindingType } from '../../Discovery/findingTypeLabels';

// ============================================================================
// Mock setup -- mirror candidateDetailsExpansion.test.tsx conventions
// ============================================================================

const mockReviewCandidate = vi.fn();
const mockBulkReviewCandidates = vi.fn();

vi.mock('../../../api/discoveryApi', async () => {
  const actual = await vi.importActual<typeof import('../../../api/discoveryApi')>(
    '../../../api/discoveryApi'
  );
  return {
    ...actual,
    reviewCandidate: (...args: unknown[]) => mockReviewCandidate(...args),
    bulkReviewCandidates: (...args: unknown[]) => mockBulkReviewCandidates(...args),
  };
});

// CSS-module identity mock: className lookups return the property name.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_target: object, prop: string | symbol) => String(prop) }
  ),
}));

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
  }),
}));

// ============================================================================
// Fixture builder -- mirrors discovery-service `endpointDataEffectCandidates.ts`
// ============================================================================

/**
 * Build an `endpoint_data_effects` candidate whose `data` matches EXACTLY the
 * shape the Spring Classic adapter emits: `endpointName`, `dataEntityName`,
 * `access_mode`, `operation_hint`, `transactional`, `confidence`, and the
 * structured `path_metadata_json` ordered hop list (each hop = FQN +
 * signature via `method_id`).
 */
function makeEdgeCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  const pathMetadata = {
    hops: [
      {
        method_id: 'com.foo.OwnerController#create(Owner)',
        class_name: 'OwnerController',
        method_name: 'create',
        role: 'controller',
      },
      {
        method_id: 'com.foo.OwnerService#save(Owner)',
        class_name: 'OwnerService',
        method_name: 'save',
        role: 'service',
      },
      {
        method_id: 'com.foo.OwnerRepository#save(Owner)',
        class_name: 'OwnerRepository',
        method_name: 'save',
        role: 'repository',
      },
    ],
    operation_hint: 'insert-or-update',
    transactional: true,
  };

  return {
    id: 'ede-001',
    run_id: 'run-001',
    candidate_type: 'endpoint_data_effects',
    name: 'POST /owners → Owner (write)',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/OwnerController.java'],
    data: {
      _addedBy: 'spring-classic-adapter',
      endpointName: 'POST /owners',
      dataEntityName: 'Owner',
      access_mode: 'write',
      operation_hint: 'insert-or-update',
      transactional: true,
      confidence: 0.9,
      path_metadata_json: pathMetadata,
      controllerClassName: 'OwnerController',
      endpointMethodName: 'create',
      relationshipType: 'uses_data',
    },
    synthesized_at: '2026-05-29T12:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

// ============================================================================
// Test harness
// ============================================================================

let DiscoveryCandidateTable: React.FC<{
  projectId: string;
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockReviewCandidate.mockReset();
  mockBulkReviewCandidates.mockReset();

  const tableMod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = tableMod.DiscoveryCandidateTable;
});

function renderTable(candidates: DiscoveryCandidateDto[]) {
  const onCandidatesChange = vi.fn();
  render(
    <DiscoveryCandidateTable
      projectId="proj-1"
      architectureId="arch-uuid-default"
      runId="run-001"
      candidates={candidates}
      onCandidatesChange={onCandidatesChange}
    />
  );
  return { onCandidatesChange };
}

// ============================================================================
// Tests
// ============================================================================

describe('endpoint_data_effects candidate surfacing (Task Group 4)', () => {
  // (1) Renders in the normal Candidates stream as a relationship candidate
  // with access_mode + endpoint->entity identity visible in its details.
  it('renders the edge in the Candidates stream with its access_mode and endpoint->entity identity', () => {
    renderTable([makeEdgeCandidate()]);

    // It is a normal row in the candidate table (NOT the Findings tab).
    const row = screen.getByTestId('candidate-row');
    expect(within(row).getByText('endpoint_data_effects')).toBeInTheDocument();

    // Show Details is enabled for the new allowlisted type.
    const toggle = screen.getByTestId('show-details-ede-001');
    expect(toggle).not.toBeDisabled();

    // Expand the row to reveal the read-only details surface.
    fireEvent.click(toggle);
    const panel = screen.getByTestId('candidate-details-panel-ede-001');

    // access_mode + endpoint->entity identity are visible.
    expect(panel).toHaveTextContent('Access mode: write');
    expect(panel).toHaveTextContent('Endpoint: POST /owners');
    expect(panel).toHaveTextContent('Data entity: Owner');
  });

  // (2) The controller->service->repository path is read-only, EXPANDABLE,
  // collapsed by default, and each hop shows its FQN + method signature.
  it('renders the path as read-only EXPANDABLE metadata, collapsed by default, with FQN + signature per hop', () => {
    renderTable([makeEdgeCandidate()]);

    fireEvent.click(screen.getByTestId('show-details-ede-001'));
    const panel = screen.getByTestId('candidate-details-panel-ede-001');

    // Operation hint + transactional flag render as summary lines.
    expect(
      within(panel).getByTestId('endpoint-data-effect-operation-hint-ede-001')
    ).toHaveTextContent('Operation hint: insert-or-update');
    expect(
      within(panel).getByTestId('endpoint-data-effect-transactional-ede-001')
    ).toHaveTextContent('Transactional: true');

    // Path is COLLAPSED by default: the hop list is not rendered yet.
    expect(
      screen.queryByTestId('endpoint-data-effect-path-list-ede-001')
    ).not.toBeInTheDocument();

    // Disclosure button is present and reports collapsed state.
    const pathToggle = within(panel).getByTestId('endpoint-data-effect-path-toggle-ede-001');
    expect(pathToggle).toHaveAttribute('aria-expanded', 'false');

    // Expand the path.
    fireEvent.click(pathToggle);
    const list = screen.getByTestId('endpoint-data-effect-path-list-ede-001');

    // Each hop renders its stable method id (FQN + signature), in order.
    const hop0 = within(list).getByTestId('endpoint-data-effect-path-hop-0');
    const hop1 = within(list).getByTestId('endpoint-data-effect-path-hop-1');
    const hop2 = within(list).getByTestId('endpoint-data-effect-path-hop-2');
    expect(hop0).toHaveTextContent('com.foo.OwnerController#create(Owner)');
    expect(hop1).toHaveTextContent('com.foo.OwnerService#save(Owner)');
    expect(hop2).toHaveTextContent('com.foo.OwnerRepository#save(Owner)');
    // Roles are shown as a leading tag (controller / service / repository).
    expect(hop0).toHaveTextContent('controller');
    expect(hop1).toHaveTextContent('service');
    expect(hop2).toHaveTextContent('repository');

    // It is read-only: no per-hop approve/reject controls inside the list.
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();

    // Collapsing again hides the list.
    fireEvent.click(within(panel).getByTestId('endpoint-data-effect-path-toggle-ede-001'));
    expect(
      screen.queryByTestId('endpoint-data-effect-path-list-ede-001')
    ).not.toBeInTheDocument();
  });

  // (3) A low-confidence-but-resolved edge renders in the NORMAL stream (the
  // candidate table) and shows its low confidence -- it is NOT a finding.
  it('renders a low-confidence-but-resolved edge in the normal stream showing its low confidence', () => {
    const lowConfidence = makeEdgeCandidate({
      id: 'ede-low',
      name: 'GET /owners/{id} → Owner (read)',
      confidence: 0.42,
      data: {
        ...makeEdgeCandidate().data,
        access_mode: 'read',
        operation_hint: 'select',
        confidence: 0.42,
      },
    });
    renderTable([lowConfidence]);

    // Lower the confidence slider so the low-confidence candidate is visible
    // (default threshold 0.7 would otherwise hide a 0.42 edge -- the point of
    // the test is that it is a NORMAL candidate, not a finding).
    fireEvent.change(screen.getByTestId('confidence-slider'), { target: { value: '0' } });

    const row = screen.getByTestId('candidate-row');
    // It is in the candidate table as a relationship candidate row.
    expect(within(row).getByText('endpoint_data_effects')).toBeInTheDocument();
    // Its low confidence is shown (0.42 -> 42%), with no uplift indicator
    // (endpoint_data_effects has no runtime-uplift rule).
    expect(within(row).getByTestId('candidate-confidence-cell')).toHaveTextContent('42%');
    expect(screen.queryByTestId('candidate-confidence-uplift')).not.toBeInTheDocument();
  });

  // (4) Approve acts on the edge candidate like any other relationship
  // candidate -- it reuses the existing reviewCandidate action.
  it('approves the edge candidate via the existing review action', async () => {
    mockReviewCandidate.mockResolvedValueOnce(
      makeEdgeCandidate({ review_status: 'approved' })
    );
    const { onCandidatesChange } = renderTable([makeEdgeCandidate()]);

    fireEvent.click(within(screen.getByTestId('candidate-row')).getByTestId('action-approve'));

    await waitFor(() => {
      expect(mockReviewCandidate).toHaveBeenCalledWith(
        'proj-1',
        'arch-uuid-default',
        'run-001',
        'ede-001',
        'approved'
      );
    });
    // Parent is notified with the optimistic + server-confirmed update.
    expect(onCandidatesChange).toHaveBeenCalled();
  });
});

// ============================================================================
// Task 4.4 -- unresolved-chain finding label (pure helper coverage)
// ============================================================================

describe('endpoint_data_effect_unresolved finding label (Task 4.4)', () => {
  it('resolves to a human-readable label via the shared finding-type label map', () => {
    // The existing FindingsTab / FindingDetailDrawer render finding_type via
    // labelForFindingType; the new type must produce a friendly label (NOT the
    // raw snake_case string).
    const label = labelForFindingType('endpoint_data_effect_unresolved');
    expect(label).toBe('Unresolved endpoint data effect');
    expect(label).not.toContain('_');
  });
});
