/**
 * Data-Layer Fidelity 2 (Spec 2026-05-30, Spec #6) -- Task Group H, Task H.1.
 *
 * Focused tests for surfacing the NEW data-layer signals in the EXISTING
 * candidate-details + Findings surfaces -- NO bespoke widget, NO new panel
 * type. Reuses the Spec-1 data-effect rendering layout (the `endpoint_data_
 * effects` block) for the verbatim SQL text, the EXISTING free-form `data`
 * dispatch for the `physical_data_attributes` structural metadata, and the
 * shared `findingTypeLabels` map the FindingsTab / FindingDetailDrawer already
 * consume for the four new finding types.
 *
 * Mirrors `soapMessageShapeCandidate.test.tsx` / `endpointDataEffectCandidate.
 * test.tsx` (direct `CandidateDetailsPanel` render with the CSS-module identity
 * Proxy mock; the panel is pure presentational so no discoveryApi /
 * ArchitectureContext mocks are needed for the render cases) AND
 * `findingTypeLabels.dbLabels.test.tsx` (parameterised label coverage).
 *
 * Tests (per spec, critical cases only):
 *   1. An `endpoint_data_effects` candidate carrying `query_text` / `query_kind`
 *      (Task Group A) renders the verbatim SQL in the EXISTING expandable
 *      read-only viewer, labelled by its kind.
 *   2. A `physical_data_attributes` candidate carrying `collation` (Group B) +
 *      `is_generated` / `generation_expression` (Group E) renders them ALONGSIDE
 *      the Spec-3 structural metadata in the EXISTING candidate-details surface.
 *   3. `FINDING_TYPE_LABELS` resolves a friendly label for all FOUR new finding
 *      types (collation CI->CS, non-portable default, DB-resident job, sequence
 *      cutover) via the shared map / helper.
 *   4. A candidate WITHOUT any of the new keys renders cleanly -- the additive
 *      block / SQL viewer is simply absent; the panel still mounts; no crash.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import { CandidateDetailsPanel } from '../DashboardView/CandidateDetailsPanel';
import {
  FINDING_TYPE_LABELS,
  labelForFindingType,
} from './findingTypeLabels';

// CSS-module identity mock: className lookups return the property name, so the
// component mounts without a real CSS pipeline (same idiom as the sibling
// candidate-details render tests).
vi.mock('../DashboardView/DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_target: object, prop: string | symbol) => String(prop) }
  ),
}));

// ============================================================================
// Fixture builders -- mirror the discovery-service `data` shapes EXACTLY.
// ============================================================================

/**
 * An `endpoint_data_effects` candidate whose `path_metadata_json` carries the
 * Task-Group-A SQL-text keys (`query_text` + `query_kind`) ALONGSIDE the
 * existing `hops` / `operation_hint` / `transactional` keys -- exactly as
 * `endpointDataEffectCandidates.ts#toPathMetadata` emits them.
 */
function makeEdgeWithSql(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  const pathMetadata = {
    hops: [
      {
        method_id: 'com.foo.OwnerRepository#findByLastName(String)',
        class_name: 'OwnerRepository',
        method_name: 'findByLastName',
        role: 'repository',
      },
    ],
    operation_hint: 'select',
    transactional: false,
    // Data-Layer Fidelity 2 -- Task Group A (verbatim, no normalization).
    query_text: 'SELECT o FROM Owner o WHERE o.lastName = :lastName',
    query_kind: 'jpql',
  };

  return {
    id: 'ede-sql-001',
    run_id: 'run-001',
    candidate_type: 'endpoint_data_effects',
    name: 'GET /owners → Owner (read)',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/OwnerRepository.java'],
    data: {
      _addedBy: 'spring-classic-adapter',
      endpointName: 'GET /owners',
      dataEntityName: 'Owner',
      access_mode: 'read',
      operation_hint: 'select',
      transactional: false,
      confidence: 0.9,
      path_metadata_json: pathMetadata,
      relationshipType: 'uses_data',
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

/**
 * A `physical_data_attributes` column candidate whose `data` carries the
 * Spec-3 structural-fidelity keys spread top-level (`source_type` /
 * `column_default` / `is_identity` / ...) PLUS the new Data-Layer Fidelity 2
 * collation (Group B) + computed-column (`is_generated` /
 * `generation_expression`, Group E) keys -- exactly as
 * `attributeStructuralFidelityFields` emits them.
 */
function makePhysicalAttributeCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'pda-001',
    run_id: 'run-001',
    candidate_type: 'physical_data_attributes',
    name: 'owners.last_name',
    confidence: 1.0,
    status: 'proposed',
    source_cluster_ids: [],
    data: {
      dbEngine: 'postgres',
      databaseName: 'petclinic',
      schemaName: 'public',
      tableName: 'owners',
      columnName: 'last_name',
      // Spec-3 structural-fidelity keys (snake_case, verbatim).
      source_type: 'varchar(64)',
      scale: null,
      precision: null,
      column_default: "'unknown'::character varying",
      ordinal: 3,
      is_identity: false,
      sequence_name: null,
      // Data-Layer Fidelity 2 -- Group B (collation) + Group E (computed col).
      collation: 'en_US.utf8',
      is_generated: true,
      generation_expression: "upper((last_name)::text)",
      confidence: 1.0,
      sourceEvidenceIds: [],
    },
    synthesized_at: '2026-05-30T12:00:00Z',
    parent_candidate_id: 'pde-001',
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

// ============================================================================
// (1) SQL text renders in the EXISTING expandable read-only viewer
// ============================================================================

describe('endpoint_data_effects SQL text (Task Group A, surfaced by H)', () => {
  it('renders the verbatim query_text in the existing expandable viewer, labelled by query_kind', () => {
    render(<CandidateDetailsPanel candidate={makeEdgeWithSql()} />);

    const panel = screen.getByTestId('candidate-details-panel-ede-sql-001');

    // The kind label renders (friendly form of `jpql`).
    expect(
      within(panel).getByTestId('endpoint-data-effect-sql-kind-ede-sql-001')
    ).toHaveTextContent('SQL kind: JPQL');

    // The SQL is behind an expandable read-only viewer, COLLAPSED by default.
    expect(
      screen.queryByTestId('endpoint-data-effect-sql-text-ede-sql-001')
    ).not.toBeInTheDocument();

    const sqlToggle = within(panel).getByTestId('endpoint-data-effect-sql-toggle-ede-sql-001');
    expect(sqlToggle).toHaveAttribute('aria-expanded', 'false');

    // Expand it: the VERBATIM SQL text renders (no normalization).
    fireEvent.click(sqlToggle);
    const sqlText = screen.getByTestId('endpoint-data-effect-sql-text-ede-sql-001');
    expect(sqlText).toHaveTextContent(
      'SELECT o FROM Owner o WHERE o.lastName = :lastName'
    );

    // It is read-only: no input/textarea controls inside the SQL viewer.
    expect(within(sqlText).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('labels each query_kind with its friendly form (native / jdbc_template / mybatis)', () => {
    for (const [kind, expected] of [
      ['native', 'SQL kind: Native SQL'],
      ['jdbc_template', 'SQL kind: JdbcTemplate SQL'],
      ['mybatis', 'SQL kind: MyBatis SQL'],
    ] as const) {
      const candidate = makeEdgeWithSql({
        id: `ede-${kind}`,
        data: {
          ...makeEdgeWithSql().data,
          path_metadata_json: {
            hops: [],
            operation_hint: 'select',
            transactional: false,
            query_text: 'SELECT 1',
            query_kind: kind,
          },
        },
      });
      const { unmount } = render(<CandidateDetailsPanel candidate={candidate} />);
      expect(
        screen.getByTestId(`endpoint-data-effect-sql-kind-ede-${kind}`)
      ).toHaveTextContent(expected);
      // Even with NO resolvable hop list, the SQL viewer still surfaces.
      expect(
        screen.getByTestId(`endpoint-data-effect-sql-toggle-ede-${kind}`)
      ).toBeInTheDocument();
      unmount();
    }
  });
});

// ============================================================================
// (2) physical_data_attributes collation + computed column render
// ============================================================================

describe('physical_data_attributes structural metadata (Groups B/E, surfaced by H)', () => {
  it('renders the collation and computed-column flag + generation expression alongside the Spec-3 metadata', () => {
    render(<CandidateDetailsPanel candidate={makePhysicalAttributeCandidate()} />);

    const panel = screen.getByTestId('candidate-details-panel-pda-001');
    const block = within(panel).getByTestId('physical-data-attribute-block-pda-001');

    // Spec-3 structural metadata (already-rendered baseline this group extends).
    expect(
      within(block).getByTestId('physical-attribute-source-type-pda-001')
    ).toHaveTextContent('Source type: varchar(64)');
    expect(
      within(block).getByTestId('physical-attribute-default-pda-001')
    ).toHaveTextContent("Default: 'unknown'::character varying");
    expect(
      within(block).getByTestId('physical-attribute-identity-pda-001')
    ).toHaveTextContent('Identity: false');

    // Group B: the verbatim collation.
    expect(
      within(block).getByTestId('physical-attribute-collation-pda-001')
    ).toHaveTextContent('Collation: en_US.utf8');

    // Group E: the computed flag + verbatim generation expression.
    expect(
      within(block).getByTestId('physical-attribute-generated-pda-001')
    ).toHaveTextContent('Computed/generated: true');
    expect(
      within(block).getByTestId('physical-attribute-generation-expression-pda-001')
    ).toHaveTextContent('Generation expression: upper((last_name)::text)');
  });

  it('omits the collation / computed lines for a plain writable column (collation null, is_generated false)', () => {
    const plain = makePhysicalAttributeCandidate({
      id: 'pda-plain',
      data: {
        ...makePhysicalAttributeCandidate().data,
        collation: null,
        is_generated: false,
        generation_expression: null,
      },
    });
    render(<CandidateDetailsPanel candidate={plain} />);

    const block = screen.getByTestId('physical-data-attribute-block-pda-plain');
    // The Spec-3 source_type still renders, but the new optional lines are gone.
    expect(
      within(block).getByTestId('physical-attribute-source-type-pda-plain')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('physical-attribute-collation-pda-plain')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('physical-attribute-generated-pda-plain')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('physical-attribute-generation-expression-pda-plain')
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// (3) The four new finding-type labels resolve via the shared map / helper
// ============================================================================

const NEW_FINDING_LABELS: Record<string, string> = {
  collation_case_sensitivity_hazard: 'Collation case-sensitivity hazard',
  non_portable_default: 'Non-portable column default',
  db_resident_scheduled_job: 'Database-resident scheduled job',
  sequence_cutover_hazard: 'Sequence cutover hazard',
};

describe('Data-Layer Fidelity 2 finding-type labels (Groups B/C/D/F, surfaced by H)', () => {
  it.each(Object.entries(NEW_FINDING_LABELS))(
    'labelForFindingType("%s") -> "%s" (and the constant map exposes it)',
    (rawType, expected) => {
      // The helper the FindingsTab / FindingDetailDrawer call.
      expect(labelForFindingType(rawType)).toBe(expected);
      // The constant map a direct consumer (e.g. a filter dropdown) reads.
      expect(FINDING_TYPE_LABELS[rawType]).toBe(expected);
      // It is a FRIENDLY label, not the raw snake_case string.
      expect(labelForFindingType(rawType)).not.toContain('_');
    }
  );

  it('does not disturb the pre-existing labels (additive only)', () => {
    expect(labelForFindingType('raw_sql_detected')).toBe('Raw SQL detected');
    expect(labelForFindingType('stored_procedure_logic')).toBe('Stored procedure logic');
    expect(labelForFindingType('external_integration_dependency')).toBe(
      'External integration dependency'
    );
  });
});

// ============================================================================
// (4) Absence-tolerant: a candidate WITHOUT the new keys renders cleanly
// ============================================================================

describe('absence tolerance (Task Group H)', () => {
  it('renders an endpoint_data_effects edge with NO SQL text cleanly (no SQL viewer, no crash)', () => {
    const noSql = makeEdgeWithSql({
      id: 'ede-no-sql',
      data: {
        ...makeEdgeWithSql().data,
        path_metadata_json: {
          hops: [
            {
              method_id: 'com.foo.OwnerRepository#save(Owner)',
              class_name: 'OwnerRepository',
              method_name: 'save',
              role: 'repository',
            },
          ],
          operation_hint: 'insert-or-update',
          transactional: true,
          // NO query_text / query_kind (a Spring-Data derived-query edge).
        },
      },
    });
    render(<CandidateDetailsPanel candidate={noSql} />);

    // The panel + the data-effect block still mount.
    expect(
      screen.getByTestId('candidate-details-panel-ede-no-sql')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('endpoint-data-effect-path-ede-no-sql')
    ).toBeInTheDocument();
    // ...but the SQL viewer is simply absent.
    expect(
      screen.queryByTestId('endpoint-data-effect-sql-ede-no-sql')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('endpoint-data-effect-sql-kind-ede-no-sql')
    ).not.toBeInTheDocument();
  });

  it('renders a physical_data_attributes candidate with a shapeless data cleanly (no block, no crash)', () => {
    const empty = makePhysicalAttributeCandidate({
      id: 'pda-empty',
      data: {},
    });
    render(<CandidateDetailsPanel candidate={empty} />);

    // The panel still mounts; the additive structural block is simply absent.
    expect(
      screen.getByTestId('candidate-details-panel-pda-empty')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('physical-data-attribute-block-pda-empty')
    ).not.toBeInTheDocument();
  });
});
