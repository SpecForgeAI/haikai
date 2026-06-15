/**
 * SOAP message-shape candidate-details tests.
 *
 * Spec 2026-05-30 (SOAP/WSDL Message-Field Depth -- Spec 4) -- Task Group 7,
 * Task 7.1.
 *
 * Focused tests for surfacing the SOAP message-field STRUCTURE + value-domain
 * RESTRICTIONS + entity PROVENANCE in the EXISTING candidate-details surface +
 * the EXISTING Candidates stream -- NO new panel type, NO new UI surface.
 * Reuses the Spec 1 data-effect rendering layout and the Spec 3
 * `constraints_metadata` compact-summary idiom.
 *
 * Mirrors `behaviourBlockCandidate.test.tsx` (direct `CandidateDetailsPanel`
 * render with the CSS-module identity Proxy mock; the orchestrator is pure
 * presentational so no discoveryApi / ArchitectureContext mocks are needed for
 * the render cases) AND `endpointDataEffectCandidate.test.tsx` (mounting the
 * real `DiscoveryCandidateTable` for the "flows through the existing Candidates
 * stream" case, with discoveryApi + ArchitectureContext mocks).
 *
 * Tests (per spec, critical cases only):
 *   1. A SOAP message FIELD (`logical_data_attributes`) candidate renders its
 *      field type + cardinality (optional / collection) + nullability in the
 *      EXISTING `CandidateDetailsPanel`.
 *   2. The value-domain restrictions (enum / pattern / length / range) render,
 *      reusing the Spec 3 compact-summary pattern.
 *   3. A SOAP message TYPE (`logical_data_entities`) candidate shows its entity
 *      provenance (source namespace / originating DTO class).
 *   4. The candidate flows through the EXISTING Candidates stream (the real
 *      `DiscoveryCandidateTable`) and reuses the same `CandidateDetailsPanel`
 *      -- no new panel type.
 *   5. A SOAP candidate with NO restrictions / NO metadata renders cleanly
 *      (the panel still mounts; the additive block is simply absent; no crash).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { CandidateDetailsPanel } from '../CandidateDetailsPanel';
import { supportsDetails } from '../candidateDetailsSupport';

// ============================================================================
// Mock setup -- mirror endpointDataEffectCandidate.test.tsx conventions for
// the stream-flow test; the direct-render tests need only the CSS-module mock.
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

// CSS-module identity mock: className lookups return the property name, so the
// component mounts without a real CSS pipeline (same idiom as the sibling tests).
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
// Fixture builders -- mirror discovery-service
// `springClassicSoap/messageEntityEmitter.ts` candidate `data` shapes EXACTLY.
// ============================================================================

/**
 * A SOAP message FIELD candidate (`logical_data_attributes`). `data` carries
 * the camelCase top-level fields the legacy save-back arm reads (`dataType` /
 * `isNullable`) PLUS the snake_case `field_metadata` JSONB blob (cardinality +
 * restrictions + XSD source-type) exactly as `buildAttributeCandidate` emits.
 */
function makeSoapFieldCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'soap-attr-001',
    run_id: 'run-001',
    candidate_type: 'logical_data_attributes',
    name: 'emailAddresses',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {
      _addedBy: 'spring-classic-soap-message',
      // The legacy save-back `logical_data_attributes` arm reads these two.
      dataType: 'xsd:string',
      isNullable: true,
      logicalEntityName: 'CreateOwnerRequest',
      // Group-1 on-attribute JSONB metadata blob (snake_case keys).
      field_metadata: {
        cardinality: { min_occurs: 0, max_occurs: 'unbounded', is_collection: true },
        xsd_source_type: 'xsd:string',
        source: 'xsd',
        restrictions: {
          enumeration: ['HOME', 'WORK', 'OTHER'],
          pattern: '[^@]+@[^@]+',
          min_length: 3,
          max_length: 254,
        },
      },
    },
    synthesized_at: '2026-05-30T12:00:00Z',
    parent_candidate_id: 'soap-entity-001',
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

/**
 * A SOAP message TYPE candidate (`logical_data_entities`). `data` carries the
 * Group-1 entity `source_provenance` string exactly as `buildEntityCandidate`
 * emits (`"namespace=...; class=..."`).
 */
function makeSoapEntityCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'soap-entity-001',
    run_id: 'run-001',
    candidate_type: 'logical_data_entities',
    name: 'CreateOwnerRequest',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['com.foo.ws.CreateOwnerRequest'],
    data: {
      _addedBy: 'spring-classic-soap-message',
      source_provenance:
        'namespace=http://foo.com/ws; class=com.foo.ws.CreateOwnerRequest',
      provenance_namespace: 'http://foo.com/ws',
      provenance_class: 'com.foo.ws.CreateOwnerRequest',
      field_count: 3,
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
// (1) + (2) SOAP message FIELD: type + cardinality + nullability + restrictions
// ============================================================================

describe('SOAP message-field candidate-details (Task Group 7)', () => {
  it('allowlists the SOAP message-shape candidate types so they gain a details surface', () => {
    // `logical_data_entities` was already allowlisted (message TYPE); the new
    // entry is `logical_data_attributes` (message FIELD rows).
    expect(supportsDetails('logical_data_attributes')).toBe(true);
    expect(supportsDetails('logical_data_entities')).toBe(true);
  });

  it('renders a SOAP message FIELD with its type + cardinality (optional / collection) + nullability', () => {
    const candidate = makeSoapFieldCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    // The additive SOAP-field block renders (below the three evidence columns).
    const block = screen.getByTestId('soap-message-field-soap-attr-001');
    expect(block).toBeInTheDocument();

    // Field type is the AS-IS source type string.
    expect(within(block).getByTestId('soap-field-type-soap-attr-001')).toHaveTextContent(
      'Type: xsd:string'
    );

    // Cardinality: min..max label + the optional (minOccurs=0) and collection
    // (maxOccurs=unbounded) facts -- optionality is DISTINCT from nullability.
    const cardinality = within(block).getByTestId('soap-field-cardinality-soap-attr-001');
    expect(cardinality).toHaveTextContent('Cardinality: 0..unbounded');
    expect(cardinality).toHaveTextContent('optional');
    expect(cardinality).toHaveTextContent('collection');

    // Nullability is the REAL is_nullable fact (from XSD nillable), kept
    // separate from optionality.
    expect(within(block).getByTestId('soap-field-nullable-soap-attr-001')).toHaveTextContent(
      'Nullable: true'
    );

    // VIEW-ONLY: no accept/reject/edit controls inside the additive block.
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the value-domain restrictions (enum / pattern / length) reusing the Spec 3 compact-summary pattern', () => {
    const candidate = makeSoapFieldCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    const restrictions = screen.getByTestId('soap-field-restrictions-soap-attr-001');
    expect(restrictions).toBeInTheDocument();

    // Enum values, pattern, and length facets render as compact lines.
    expect(restrictions).toHaveTextContent('Enum: HOME, WORK, OTHER');
    expect(restrictions).toHaveTextContent('Pattern: [^@]+@[^@]+');
    expect(restrictions).toHaveTextContent('Min length: 3');
    expect(restrictions).toHaveTextContent('Max length: 254');
  });

  it('renders the numeric range / digits restrictions for a numeric field', () => {
    const candidate = makeSoapFieldCandidate({
      id: 'soap-attr-num',
      name: 'balance',
      data: {
        _addedBy: 'spring-classic-soap-message',
        dataType: 'xsd:decimal',
        isNullable: false,
        field_metadata: {
          cardinality: { min_occurs: 1, max_occurs: 1, is_collection: false },
          xsd_source_type: 'xsd:decimal',
          source: 'xsd',
          restrictions: {
            min_inclusive: '0.00',
            max_inclusive: '9999.99',
            total_digits: 6,
            fraction_digits: 2,
          },
        },
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    const restrictions = screen.getByTestId('soap-field-restrictions-soap-attr-num');
    expect(restrictions).toHaveTextContent('Min: 0.00');
    expect(restrictions).toHaveTextContent('Max: 9999.99');
    expect(restrictions).toHaveTextContent('Total digits: 6');
    expect(restrictions).toHaveTextContent('Fraction digits: 2');

    // A required, single-occurrence, non-nullable field reads as NOT optional /
    // NOT a collection (cardinality 1..1).
    const cardinality = screen.getByTestId('soap-field-cardinality-soap-attr-num');
    expect(cardinality).toHaveTextContent('Cardinality: 1..1');
    expect(cardinality).not.toHaveTextContent('optional');
    expect(cardinality).not.toHaveTextContent('collection');
    expect(screen.getByTestId('soap-field-nullable-soap-attr-num')).toHaveTextContent(
      'Nullable: false'
    );
  });

  // ==========================================================================
  // (3) SOAP message TYPE: entity provenance
  // ==========================================================================
  it('renders the entity provenance for a SOAP message TYPE candidate', () => {
    const candidate = makeSoapEntityCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    const block = screen.getByTestId('soap-message-entity-soap-entity-001');
    expect(block).toBeInTheDocument();
    expect(
      within(block).getByTestId('soap-entity-provenance-soap-entity-001')
    ).toHaveTextContent(
      'Provenance: namespace=http://foo.com/ws; class=com.foo.ws.CreateOwnerRequest'
    );
  });

  // ==========================================================================
  // (5) No restrictions / no metadata renders cleanly (no crash)
  // ==========================================================================
  it('renders cleanly for a SOAP field with NO field_metadata and a non-SOAP entity with NO provenance (no crash)', () => {
    // (i) A logical_data_attributes candidate with NO SOAP signal at all
    // (no field_metadata, no dataType / isNullable) -> additive block absent.
    const bareAttr = makeSoapFieldCandidate({
      id: 'attr-bare',
      data: { _addedBy: 'some-other-adapter' },
    });
    expect(() => render(<CandidateDetailsPanel candidate={bareAttr} />)).not.toThrow();
    expect(screen.getByTestId('candidate-details-panel-attr-bare')).toBeInTheDocument();
    expect(screen.queryByTestId('soap-message-field-attr-bare')).not.toBeInTheDocument();

    // (ii) A logical_data_entities candidate with NO provenance signal -> the
    // SOAP provenance block is absent (older / non-SOAP entity), no crash.
    const bareEntity = makeSoapEntityCandidate({
      id: 'entity-bare',
      data: { _addedBy: 'spring-boot-adapter', className: 'PlainModel' },
    });
    expect(() => render(<CandidateDetailsPanel candidate={bareEntity} />)).not.toThrow();
    expect(screen.getByTestId('candidate-details-panel-entity-bare')).toBeInTheDocument();
    expect(screen.queryByTestId('soap-message-entity-entity-bare')).not.toBeInTheDocument();
  });

  it('renders a SOAP field with a field_metadata blob but NO restrictions cleanly (no restriction sub-block)', () => {
    const candidate = makeSoapFieldCandidate({
      id: 'attr-no-restrictions',
      name: 'firstName',
      data: {
        _addedBy: 'spring-classic-soap-message',
        dataType: 'xsd:string',
        isNullable: false,
        field_metadata: {
          cardinality: { min_occurs: 1, max_occurs: 1, is_collection: false },
          xsd_source_type: 'xsd:string',
          source: 'xsd',
          // no `restrictions` key
        },
      },
    });
    expect(() => render(<CandidateDetailsPanel candidate={candidate} />)).not.toThrow();

    // The field block still renders (type + cardinality + nullability), but the
    // restriction sub-block is absent (no facets to summarise).
    expect(screen.getByTestId('soap-message-field-attr-no-restrictions')).toBeInTheDocument();
    expect(
      screen.getByTestId('soap-field-type-attr-no-restrictions')
    ).toHaveTextContent('Type: xsd:string');
    expect(
      screen.queryByTestId('soap-field-restrictions-attr-no-restrictions')
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// (4) Flows through the EXISTING Candidates stream -- no new panel type
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

describe('SOAP message-field candidate flows through the existing Candidates stream (Task Group 7)', () => {
  it('renders the SOAP field candidate as a NORMAL row and reuses the existing CandidateDetailsPanel (no new panel type)', () => {
    const onCandidatesChange = vi.fn();
    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-001"
        candidates={[makeSoapFieldCandidate()]}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // It is a normal candidate-table row (NOT the Findings tab), of the
    // existing logical_data_attributes type.
    const row = screen.getByTestId('candidate-row');
    expect(within(row).getByText('logical_data_attributes')).toBeInTheDocument();

    // Show Details is enabled (allowlisted) and reveals the EXISTING panel.
    const toggle = screen.getByTestId('show-details-soap-attr-001');
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);

    const panel = screen.getByTestId('candidate-details-panel-soap-attr-001');
    // The SOAP message-field block renders inside the existing panel surface.
    expect(within(panel).getByTestId('soap-message-field-soap-attr-001')).toBeInTheDocument();
    expect(within(panel).getByTestId('soap-field-type-soap-attr-001')).toHaveTextContent(
      'Type: xsd:string'
    );
  });
});
