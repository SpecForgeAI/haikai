/**
 * Outbound-integration (`data_movements`) candidate surfacing tests.
 *
 * Spec 2026-05-30 (Outbound Integration Graph for Discovery -- Spec #5) -- Task
 * Group 6, Task 6.1.
 *
 * Focused integration tests for surfacing the NEW `data_movements` reviewable
 * relationship candidate type in the EXISTING Candidates review stream + the
 * EXISTING candidate-details panel -- NO bespoke widget, NO dependency-graph
 * visualization. Mirrors `endpointDataEffectCandidate.test.tsx` (the closest
 * peer, which surfaced `endpoint_data_effects` the same way):
 *   - mounts the REAL `DiscoveryCandidateTable`, expands the row, asserts the
 *     details block renders from the candidate `data`;
 *   - `vi.mock('../../../api/discoveryApi', ...)` with a spread of the actual
 *     module so the table still resolves its named exports;
 *   - CSS-module identity Proxy mocks so className lookups are predictable;
 *   - `ArchitectureContext` mocks so the table mounts without a provider.
 *
 * The candidate `data` shape mirrors EXACTLY what the discovery-service Spring
 * Classic adapter emits in `outboundIntegrationCandidates.ts` (the keys the
 * details reader `readDataMovementDisplay` consumes BY NAME): `sourceServiceName`,
 * `targetName`/`target`, `movementType` (the integration kind), `targetLooksExternal`,
 * `sourceKind`, `sourceEndpointName`, `httpVerb`, `messagingOperation`,
 * `payloadHint`, `callSiteFqn`.
 *
 * Tests (per spec, critical cases only):
 *   1. A `data_movements` candidate renders in the Candidates stream and its
 *      source -> target + movement kind show in the details panel.
 *   2. A `targetLooksExternal` edge shows the "[external]" marker in details.
 *   3. The `data_movements` row appears in the EXISTING stream interleaved with
 *      other candidate types (NO separate section).
 *   4. `FINDING_TYPE_LABELS` has a friendly label for
 *      `external_integration_dependency` (the external-dependency Finding the
 *      existing FindingsTab / FindingDetailDrawer render via `labelForFindingType`).
 *   5. A `data_movements` candidate with NO / PARTIAL `data` renders cleanly
 *      (no crash; the details panel still mounts).
 *   6. The frontend `DataMovementDto` typing mirrors the mixed snake/camelCase
 *      AMS `DataMovementDto.java` wire shape (compile-time + value assertion).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto, DataMovementDto } from '../../../api/discoveryApi';
import {
  FINDING_TYPE_LABELS,
  labelForFindingType,
} from '../../Discovery/findingTypeLabels';

// ============================================================================
// Mock setup -- mirror endpointDataEffectCandidate.test.tsx conventions
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

vi.mock('../TierBadge.module.css', () => ({
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
// Fixture builder -- mirrors discovery-service `outboundIntegrationCandidates.ts`
// ============================================================================

/**
 * Build a `data_movements` candidate whose `data` matches the shape the Spring
 * Classic adapter emits (the keys `readDataMovementDisplay` reads BY NAME).
 */
function makeOutboundCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'dm-001',
    run_id: 'run-001',
    candidate_type: 'data_movements',
    name: 'OrderService → http://payments/charge (HTTP)',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/OrderService.java'],
    data: {
      _addedBy: 'spring-classic-adapter',
      sourceServiceName: 'OrderService',
      ownerClassName: 'OrderService',
      ownerMethodName: 'charge',
      targetName: 'http://payments/charge',
      target: 'http://payments/charge',
      movementType: 'outbound-rest',
      targetLooksExternal: true,
      sourceKind: 'service',
      httpVerb: 'POST',
      payloadHint: 'ChargeRequest',
      confidence: 0.9,
      callSiteFqn: 'com.foo.OrderService#charge',
      callSiteLine: 42,
    },
    synthesized_at: '2026-05-30T12:00:00Z',
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
// Tests -- candidate surfacing in the existing stream + details panel
// ============================================================================

describe('data_movements candidate surfacing (Task Group 6)', () => {
  // (1) Renders in the normal Candidates stream as a relationship candidate;
  // its source -> target + movement kind show in the EXISTING details panel.
  it('renders the outbound edge in the stream with source -> target + movement kind in details', () => {
    renderTable([makeOutboundCandidate()]);

    // It is a normal row in the candidate table (NOT the Findings tab).
    const row = screen.getByTestId('candidate-row');
    expect(within(row).getByText('data_movements')).toBeInTheDocument();
    // The source -> target arrow name shows in the row.
    expect(row).toHaveTextContent('OrderService → http://payments/charge');

    // Show Details is enabled for the new allowlisted type.
    const toggle = screen.getByTestId('show-details-dm-001');
    expect(toggle).not.toBeDisabled();

    // Expand the row to reveal the EXISTING read-only details surface.
    fireEvent.click(toggle);
    const block = screen.getByTestId('data-movement-block-dm-001');

    // source -> target identity + the movement/integration kind are visible.
    expect(within(block).getByTestId('data-movement-source-dm-001')).toHaveTextContent(
      'Source: OrderService'
    );
    expect(within(block).getByTestId('data-movement-target-dm-001')).toHaveTextContent(
      'Target: http://payments/charge'
    );
    expect(within(block).getByTestId('data-movement-kind-dm-001')).toHaveTextContent(
      'Integration kind: outbound-rest'
    );
    // The optional payload-type hint also surfaces (deferred-finding parity).
    expect(within(block).getByTestId('data-movement-payload-hint-dm-001')).toHaveTextContent(
      'Payload type hint: ChargeRequest'
    );
  });

  // (2) A purely-external target shows the "[external]" marker in details, and a
  // modellable (in-model) target does NOT.
  it('shows the [external] marker only when targetLooksExternal is true', () => {
    const external = makeOutboundCandidate({ id: 'dm-ext' }); // targetLooksExternal: true
    const modellable = makeOutboundCandidate({
      id: 'dm-internal',
      name: 'OrderService → InventoryService (HTTP)',
      data: {
        ...makeOutboundCandidate().data,
        sourceServiceName: 'OrderService',
        target: 'InventoryService',
        targetName: 'InventoryService',
        targetLooksExternal: false,
      },
    });
    renderTable([external, modellable]);

    // External edge: marker present.
    fireEvent.click(screen.getByTestId('show-details-dm-ext'));
    expect(screen.getByTestId('data-movement-external-marker-dm-ext')).toBeInTheDocument();

    // Modellable edge: NO marker (single-row expansion replaces the external one).
    fireEvent.click(screen.getByTestId('show-details-dm-internal'));
    expect(
      screen.queryByTestId('data-movement-external-marker-dm-internal')
    ).not.toBeInTheDocument();
    // ...but the target still renders.
    expect(screen.getByTestId('data-movement-target-dm-internal')).toHaveTextContent(
      'Target: InventoryService'
    );
  });

  // (3) The data_movements row appears in the EXISTING stream interleaved with
  // other candidate types -- NO separate section. One table, multiple rows.
  it('appears in the existing Candidates stream interleaved with other types (no separate section)', () => {
    const candidates = [
      // A plain entity candidate...
      makeOutboundCandidate({
        id: 'svc-1',
        candidate_type: 'service',
        name: 'OrderService',
        data: {},
      }),
      // ...and the outbound edge, both in the SAME table body.
      makeOutboundCandidate({ id: 'dm-001' }),
    ];
    renderTable(candidates);

    // Exactly one candidate table; both rows live in it.
    expect(screen.getAllByTestId('candidate-table')).toHaveLength(1);
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(2);
    // The data_movements row is present (no bespoke outbound section / widget).
    const dmRow = rows.find((r) => within(r).queryByText('data_movements'));
    expect(dmRow).toBeDefined();
  });

  // (5) A data_movements candidate with NO / PARTIAL `data` renders cleanly --
  // no crash; the row + details panel still mount.
  it('renders cleanly for a candidate with empty data (no crash)', () => {
    const empty = makeOutboundCandidate({ id: 'dm-empty', name: 'unknown edge', data: {} });
    renderTable([empty]);

    // The row renders.
    const row = screen.getByTestId('candidate-row');
    expect(within(row).getByText('data_movements')).toBeInTheDocument();

    // Expanding does NOT crash; the panel mounts even though the outbound block
    // (which needs at least one field) is absent for an empty `data`.
    fireEvent.click(screen.getByTestId('show-details-dm-empty'));
    expect(screen.getByTestId('candidate-details-panel-dm-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('data-movement-block-dm-empty')).not.toBeInTheDocument();
  });

  // (5b) A PARTIAL `data` (target only, no movement kind / payload) still
  // renders the block with the present fields -- defensive read, no crash.
  it('renders the block with present fields when data is partial (target only)', () => {
    const partial = makeOutboundCandidate({
      id: 'dm-partial',
      name: 'partial edge',
      data: { target: 'kafka://orders' },
    });
    renderTable([partial]);

    fireEvent.click(screen.getByTestId('show-details-dm-partial'));
    const block = screen.getByTestId('data-movement-block-dm-partial');
    expect(within(block).getByTestId('data-movement-target-dm-partial')).toHaveTextContent(
      'Target: kafka://orders'
    );
    // Absent fields do not render (and do not crash).
    expect(screen.queryByTestId('data-movement-kind-dm-partial')).not.toBeInTheDocument();
    expect(screen.queryByTestId('data-movement-payload-hint-dm-partial')).not.toBeInTheDocument();
  });
});

// ============================================================================
// (4) external_integration_dependency finding label (pure helper coverage)
// ============================================================================

describe('external_integration_dependency finding label (Task Group 6)', () => {
  it('resolves to a human-readable label via the shared finding-type label map', () => {
    // The existing FindingsTab / FindingDetailDrawer render finding_type via
    // labelForFindingType; the new external-dependency type must produce a
    // friendly label (NOT the raw snake_case string).
    expect(FINDING_TYPE_LABELS['external_integration_dependency']).toBe(
      'External integration dependency'
    );
    const label = labelForFindingType('external_integration_dependency');
    expect(label).toBe('External integration dependency');
    expect(label).not.toContain('_');
  });
});

// ============================================================================
// (6) DataMovementDto typing mirrors the mixed snake/camelCase wire shape
// ============================================================================

describe('DataMovementDto frontend typing (Task Group 6.2)', () => {
  it('accepts the mixed snake_case + camelCase AMS wire shape', () => {
    // Compile-time check (mixed-case keys) + value assertion. Mirrors
    // architecture-model-service DataMovementDto.java EXACTLY: snake_case ids /
    // movement_type / validity, camelCase dataEntityPointId / interfaceWithSchemaId
    // / biDirectional. For an outbound dependency the XOR pair is absent and
    // movement_type carries the integration kind.
    const row: DataMovementDto = {
      id: 'mov-1',
      source_application_point_id: 'ap_svc-order',
      target_application_point_id: null, // external-only edge -> NULL target
      movement_type: 'outbound-rest', // carries the integration_kind
      description: null,
      tags: null,
      valid_from: '2026-05-30T00:00:00Z',
      valid_to: null,
      // camelCase XOR pair -- both absent for an outbound dependency.
      dataEntityPointId: null,
      interfaceWithSchemaId: null,
      biDirectional: false,
    };

    expect(row.source_application_point_id).toBe('ap_svc-order');
    expect(row.target_application_point_id).toBeNull();
    expect(row.movement_type).toBe('outbound-rest');
    // camelCase fields are reachable under their exact wire names.
    expect(row.dataEntityPointId).toBeNull();
    expect(row.interfaceWithSchemaId).toBeNull();
    expect(row.biDirectional).toBe(false);
  });
});
