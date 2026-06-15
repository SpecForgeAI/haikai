/**
 * Per-endpoint response-contract block candidate-details tests.
 *
 * Spec 2026-05-30 (Per-endpoint response-contract capture -- Spec 1) -- Task
 * Group 4, Task 4.1.
 *
 * Focused tests for the read-only, EXPANDABLE response-contract block + the
 * confidence badge rendered for an `endpoints` candidate in the EXISTING
 * candidate-details surface. MIRRORS `behaviourBlockCandidate.test.tsx` (the
 * Spec 2 `business_logics` `data.behavior` pattern this feature reuses): no
 * discoveryApi / ArchitectureContext mocks are needed (the orchestrator is
 * pure presentational), and the malformed-tolerant assertions match the
 * behaviour-block contract.
 *
 * Tests (per spec, critical cases only):
 *   (a) An `endpoints` candidate carrying a well-formed `response_contract`
 *       blob renders the expandable read-only block; on expand it surfaces all
 *       contract sections (error_responses / auth / validation / serialization
 *       / status_codes / conditional_variants), collapsed by default
 *       (`aria-expanded` flips false -> true -> false).
 *   (b) The `confidence` badge renders and the EXISTING low-confidence visual
 *       treatment applies below the threshold.
 *   (c) A candidate with an absent / null `response_contract` renders NOTHING
 *       (no block) and does NOT throw (additive).
 *   (d) The block exposes NO accept/reject/edit controls (VIEW-ONLY).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { CandidateDetailsPanel } from '../CandidateDetailsPanel';

// CSS-module identity mock: className lookups return the property name, so the
// confidence-badge classes are predictable and the component mounts without a
// real CSS pipeline. (Same idiom as behaviourBlockCandidate.test.tsx.)
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_target: object, prop: string | symbol) => String(prop) }
  ),
}));

// ----------------------------------------------------------------------------
// Fixture builder -- an `endpoints` candidate carrying the response-contract
// blob under `data.response_contract` exactly as Group 2/3 writes it
// (snake_case keys at every level, loose JSONB with an internal
// `schema_version`, `confidence` boxed as a Double).
// ----------------------------------------------------------------------------

function makeResponseContract(): Record<string, unknown> {
  return {
    schema_version: 1,
    error_responses: [
      {
        exception: 'OwnerNotFoundException',
        status: 404,
        body_shape: '{ "error": "not found" }',
        source: '@ControllerAdvice',
      },
    ],
    auth: {
      required_roles: ['ROLE_VET'],
      expected_unauthenticated_status: 401,
      expected_forbidden_status: 403,
      source: '@PreAuthorize',
    },
    validation: [
      {
        field: 'lastName',
        constraint: '@NotEmpty',
        failure_status: 400,
        message: 'must not be empty',
      },
    ],
    serialization: {
      null_handling: 'NON_NULL',
      date_format: 'yyyy-MM-dd',
      field_naming: 'snake_case',
      envelope: 'none',
      headers: ['Content-Type: application/json'],
    },
    status_codes: {
      success: 200,
      location_header: false,
    },
    conditional_variants: [
      {
        condition: '@Profile("legacy")',
        response_summary: 'returns the legacy XML envelope',
      },
    ],
    provenance: {
      source_files: ['src/main/java/com/foo/OwnerController.java'],
      method_id: 'com.foo.OwnerController#get(Long)',
      advice_ids: ['com.foo.GlobalExceptionHandler'],
    },
    confidence: 0.42,
  };
}

function makeEndpointCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'ep-001',
    run_id: 'run-001',
    candidate_type: 'endpoints',
    name: 'GET /owners/{id}',
    confidence: 0.42,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/OwnerController.java'],
    data: {
      _addedBy: 'spring-classic-adapter',
      httpMethod: 'GET',
      fullPath: '/owners/{id}',
      controllerClassName: 'OwnerController',
      methodName: 'get',
      response_contract: makeResponseContract(),
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

describe('endpoints response-contract block (Task Group 4)', () => {
  // ==========================================================================
  // Task 4.1 (a) -- expandable read-only block renders its sections
  // ==========================================================================
  it('renders the response-contract block COLLAPSED by default and expands to show all sections', () => {
    const candidate = makeEndpointCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    // The contract block element is present (additive block below the three
    // evidence columns).
    const block = screen.getByTestId('response-contract-block-ep-001');
    expect(block).toBeInTheDocument();

    // COLLAPSED by default: the sections container is not rendered yet.
    expect(
      screen.queryByTestId('response-contract-block-sections-ep-001')
    ).not.toBeInTheDocument();

    // The disclosure toggle reports the collapsed state.
    const toggle = within(block).getByTestId('response-contract-block-toggle-ep-001');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Expand the block.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // All contract sections render section-by-section, each with its
    // per-section data-testid keyed by the snake_case field name.
    const sections = screen.getByTestId('response-contract-block-sections-ep-001');
    expect(
      within(sections).getByTestId('response-contract-section-error_responses-ep-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('response-contract-section-auth-ep-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('response-contract-section-validation-ep-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('response-contract-section-serialization-ep-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('response-contract-section-status_codes-ep-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('response-contract-section-conditional_variants-ep-001')
    ).toBeInTheDocument();

    // A representative slice of content is rendered read-only.
    expect(
      within(sections).getByTestId('response-contract-section-error_responses-ep-001')
    ).toHaveTextContent('OwnerNotFoundException');
    expect(
      within(sections).getByTestId('response-contract-section-auth-ep-001')
    ).toHaveTextContent('ROLE_VET');
    expect(
      within(sections).getByTestId('response-contract-section-status_codes-ep-001')
    ).toHaveTextContent('200');

    // Collapsing again hides the sections.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByTestId('response-contract-block-sections-ep-001')
    ).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Task 4.1 (b) -- confidence badge + existing low-confidence treatment
  // ==========================================================================
  it('renders a confidence badge using the EXISTING low-confidence visual treatment below the threshold', () => {
    const candidate = makeEndpointCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    const badge = screen.getByTestId('behaviour-confidence-badge-ep-001');
    // 0.42 < 0.45 -> LOW bucket -> the existing low-confidence palette class.
    expect(badge.className).toContain('behaviourConfidenceLow');
    expect(badge.className).not.toContain('behaviourConfidenceHigh');
    expect(badge.className).not.toContain('behaviourConfidenceMedium');
    expect(badge).toHaveTextContent('Low');
    expect(badge).toHaveTextContent('0.42');
  });

  it('renders the HIGH-confidence palette class for a high-confidence contract', () => {
    const contract = makeResponseContract();
    contract.confidence = 0.92;
    const candidate = makeEndpointCandidate({
      id: 'ep-high',
      data: {
        _addedBy: 'spring-classic-adapter',
        httpMethod: 'GET',
        fullPath: '/owners/{id}',
        response_contract: contract,
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    const badge = screen.getByTestId('behaviour-confidence-badge-ep-high');
    // 0.92 >= 0.85 -> HIGH bucket -> the high-confidence palette class.
    expect(badge.className).toContain('behaviourConfidenceHigh');
    expect(badge.className).not.toContain('behaviourConfidenceLow');
    expect(badge).toHaveTextContent('High');
  });

  // ==========================================================================
  // Task 4.1 (c) -- absent / null contract renders nothing, never throws
  // ==========================================================================
  it('renders NOTHING for an endpoint with an ABSENT response_contract (and does not throw)', () => {
    const candidate = makeEndpointCandidate({
      id: 'ep-absent',
      data: {
        _addedBy: 'spring-classic-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        // no `response_contract` key at all
      },
    });

    // The panel still mounts (the three evidence columns render); only the
    // additive contract block is absent.
    expect(() => render(<CandidateDetailsPanel candidate={candidate} />)).not.toThrow();
    expect(screen.getByTestId('candidate-details-panel-ep-absent')).toBeInTheDocument();
    expect(
      screen.queryByTestId('response-contract-block-ep-absent')
    ).not.toBeInTheDocument();
  });

  it('renders NOTHING for a NULL / malformed response_contract and does not throw', () => {
    // (i) response_contract is null -> reader returns undefined.
    const nullContract = makeEndpointCandidate({
      id: 'ep-null',
      data: {
        _addedBy: 'spring-classic-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        response_contract: null,
      },
    });
    expect(() => render(<CandidateDetailsPanel candidate={nullContract} />)).not.toThrow();
    expect(screen.queryByTestId('response-contract-block-ep-null')).not.toBeInTheDocument();

    // (ii) response_contract is an array -> reader returns undefined.
    const arrayContract = makeEndpointCandidate({
      id: 'ep-array',
      data: {
        _addedBy: 'spring-classic-adapter',
        response_contract: ['nope'],
      },
    });
    expect(() => render(<CandidateDetailsPanel candidate={arrayContract} />)).not.toThrow();
    expect(screen.queryByTestId('response-contract-block-ep-array')).not.toBeInTheDocument();

    // (iii) response_contract is an empty object with no usable sections /
    // confidence -> reader returns undefined -> nothing renders.
    const emptyContract = makeEndpointCandidate({
      id: 'ep-empty',
      data: {
        _addedBy: 'spring-classic-adapter',
        response_contract: {},
      },
    });
    expect(() => render(<CandidateDetailsPanel candidate={emptyContract} />)).not.toThrow();
    expect(screen.queryByTestId('response-contract-block-ep-empty')).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Task 4.1 (d) -- the block exposes NO accept/reject/edit controls
  // ==========================================================================
  it('exposes NO accept/reject/edit controls on the contract block (VIEW-ONLY)', () => {
    const candidate = makeEndpointCandidate({ id: 'ep-readonly' });
    render(<CandidateDetailsPanel candidate={candidate} />);

    const block = screen.getByTestId('response-contract-block-ep-readonly');

    // The ONLY interactive control on the block is the collapse/expand
    // disclosure toggle -- there are no accept/reject/edit buttons or inputs.
    const buttons = within(block).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute(
      'data-testid',
      'response-contract-block-toggle-ep-readonly'
    );

    // No form controls (no edit affordances) anywhere on the block.
    expect(within(block).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(block).queryByRole('checkbox')).not.toBeInTheDocument();

    // After expanding, the sections themselves carry no interactive controls.
    fireEvent.click(buttons[0]);
    const sections = screen.getByTestId('response-contract-block-sections-ep-readonly');
    expect(within(sections).queryByRole('button')).not.toBeInTheDocument();
    expect(within(sections).queryByRole('textbox')).not.toBeInTheDocument();
  });
});
