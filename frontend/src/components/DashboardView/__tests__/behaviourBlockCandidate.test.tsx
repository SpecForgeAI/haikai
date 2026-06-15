/**
 * Business-logic behaviour-block candidate-details tests.
 *
 * Spec 2026-05-29 (Business-logic behaviour capture -- Gap C) -- Task
 * Group 3, Task 3.1.
 *
 * Focused tests for the read-only, EXPANDABLE 7-part behaviour block + the
 * confidence badge rendered for a `business_logics` candidate in the EXISTING
 * candidate-details surface. Mirrors the direct-render conventions in
 * `candidateDetailsPanel.test.tsx` (no discoveryApi / ArchitectureContext
 * mocks needed -- the orchestrator is pure presentational) and the
 * malformed-tolerant assertions in `endpointDataEffectCandidate.test.tsx`.
 *
 * Tests (per spec, critical cases only):
 *   1. A `business_logics` candidate carrying a well-formed `behavior` block
 *      renders the seven sections COLLAPSED by default and expands on the
 *      disclosure toggle (`aria-expanded` flips false -> true -> false).
 *   2. The confidence badge reflects the block's confidence using the
 *      existing low-confidence visual treatment (low / medium / high buckets
 *      -> the locked confidence palette classes).
 *   3. A candidate with a missing OR malformed `behavior` renders nothing /
 *      a stub and does NOT throw (the block element is simply absent).
 *   4. `supportsDetails('business_logics')` returns true (the candidate gains
 *      an expandable details surface).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { CandidateDetailsPanel } from '../CandidateDetailsPanel';
import { supportsDetails } from '../candidateDetailsSupport';

// CSS-module identity mock: className lookups return the property name, so the
// behaviour-block badge classes are predictable and the component mounts
// without a real CSS pipeline. (Same idiom as candidateDetailsPanel.test.tsx.)
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_target: object, prop: string | symbol) => String(prop) }
  ),
}));

// ----------------------------------------------------------------------------
// Fixture builder -- a `business_logics` candidate carrying the 7-part block
// under `data.behavior` exactly as Group 2 writes it (snake_case keys, loose
// JSONB with `schema_version` + `source_hash` embedded, confidence boxed).
// ----------------------------------------------------------------------------

function makeBehaviourBlock(): Record<string, unknown> {
  return {
    schema_version: 1,
    source_hash: 'abc123',
    io: {
      inputs: 'owner: Owner (the owner to persist)',
      output: 'Owner (the persisted owner with generated id)',
    },
    validation: [
      'owner.lastName must be non-empty -> 400 Bad Request on failure',
      'owner.id must be null for create -> IllegalStateException',
    ],
    transformation: 'Trims whitespace from name fields; defaults city to "Unknown".',
    data_effects: 'Inserts a row into the owners table (method-level write).',
    side_effects: 'Publishes an OwnerCreatedEvent; no external HTTP call.',
    edge_cases: 'Null owner -> NullPointerException guarded by @NonNull.',
    provenance: {
      method_id: 'com.foo.OwnerService#save(Owner)',
      confidence: 0.42,
    },
    confidence: 0.42,
  };
}

function makeBusinessLogicCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'bl-001',
    run_id: 'run-001',
    candidate_type: 'business_logics',
    name: 'OwnerService.save(Owner)',
    confidence: 0.42,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/OwnerService.java'],
    data: {
      _addedBy: 'spring-classic-adapter',
      methodId: 'com.foo.OwnerService#save(Owner)',
      behavior: makeBehaviourBlock(),
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
// Task 3.1 (d) -- supportsDetails allowlist
// ============================================================================

describe('business_logics behaviour-block support (Task Group 3)', () => {
  it('supportsDetails("business_logics") returns true', () => {
    expect(supportsDetails('business_logics')).toBe(true);
  });

  // ==========================================================================
  // Task 3.1 (a) -- 7 sections collapsed by default, expands on toggle
  // ==========================================================================
  it('renders the 7-part block COLLAPSED by default and expands on the disclosure toggle', () => {
    const candidate = makeBusinessLogicCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    // The behaviour block element is present (additive 4th block below the
    // three evidence columns).
    const block = screen.getByTestId('behaviour-block-bl-001');
    expect(block).toBeInTheDocument();

    // COLLAPSED by default: the sections container is not rendered yet.
    expect(screen.queryByTestId('behaviour-block-sections-bl-001')).not.toBeInTheDocument();

    // The disclosure toggle reports the collapsed state.
    const toggle = within(block).getByTestId('behaviour-block-toggle-bl-001');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Expand the block.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // All seven parts render section-by-section, each with its per-section
    // data-testid keyed by the snake_case field name.
    const sections = screen.getByTestId('behaviour-block-sections-bl-001');
    expect(within(sections).getByTestId('behaviour-section-io-bl-001')).toBeInTheDocument();
    expect(within(sections).getByTestId('behaviour-section-validation-bl-001')).toBeInTheDocument();
    expect(
      within(sections).getByTestId('behaviour-section-transformation-bl-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('behaviour-section-data_effects-bl-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('behaviour-section-side_effects-bl-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('behaviour-section-edge_cases-bl-001')
    ).toBeInTheDocument();
    expect(
      within(sections).getByTestId('behaviour-section-provenance-bl-001')
    ).toBeInTheDocument();

    // A representative slice of content is rendered read-only (no inputs,
    // no edit controls inside the sections).
    expect(within(sections).getByTestId('behaviour-section-validation-bl-001')).toHaveTextContent(
      '400 Bad Request'
    );
    expect(within(sections).getByTestId('behaviour-section-provenance-bl-001')).toHaveTextContent(
      'com.foo.OwnerService#save(Owner)'
    );

    // VIEW-ONLY: the expanded sections contain no action buttons.
    expect(within(sections).queryByRole('button')).not.toBeInTheDocument();

    // Collapsing again hides the sections.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('behaviour-block-sections-bl-001')).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Task 3.1 (b) -- confidence badge reflects the low-confidence treatment
  // ==========================================================================
  it('renders a confidence badge using the existing low-confidence visual treatment for a low-confidence block', () => {
    const candidate = makeBusinessLogicCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    const badge = screen.getByTestId('behaviour-confidence-badge-bl-001');
    // 0.42 < 0.45 -> LOW bucket -> the low-confidence palette class.
    expect(badge.className).toContain('behaviourConfidenceLow');
    expect(badge.className).not.toContain('behaviourConfidenceHigh');
    expect(badge.className).not.toContain('behaviourConfidenceMedium');
    expect(badge).toHaveTextContent('Low');
    expect(badge).toHaveTextContent('0.42');
  });

  it('renders the HIGH-confidence palette class for a high-confidence block', () => {
    const block = makeBehaviourBlock();
    block.confidence = 0.92;
    (block.provenance as Record<string, unknown>).confidence = 0.92;
    const candidate = makeBusinessLogicCandidate({
      id: 'bl-high',
      data: {
        _addedBy: 'spring-classic-adapter',
        methodId: 'com.foo.OwnerService#save(Owner)',
        behavior: block,
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    const badge = screen.getByTestId('behaviour-confidence-badge-bl-high');
    // 0.92 >= 0.85 -> HIGH bucket -> the high-confidence palette class.
    expect(badge.className).toContain('behaviourConfidenceHigh');
    expect(badge.className).not.toContain('behaviourConfidenceLow');
    expect(badge).toHaveTextContent('High');
  });

  // ==========================================================================
  // Task 3.1 (c) -- missing OR malformed block renders nothing / never throws
  // ==========================================================================
  it('renders nothing for a business_logics candidate with a MISSING behavior block (and does not throw)', () => {
    const candidate = makeBusinessLogicCandidate({
      id: 'bl-missing',
      data: {
        _addedBy: 'spring-classic-adapter',
        methodId: 'com.foo.OwnerService#noBlock()',
        // no `behavior` key at all
      },
    });

    // The panel still mounts (the three evidence columns render); only the
    // additive behaviour block is absent.
    expect(() =>
      render(<CandidateDetailsPanel candidate={candidate} />)
    ).not.toThrow();
    expect(screen.getByTestId('candidate-details-panel-bl-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('behaviour-block-bl-missing')).not.toBeInTheDocument();
  });

  it('renders nothing for a MALFORMED behavior block (wrong type / empty) and does not throw', () => {
    // (i) behavior is a non-object (string) -> reader returns undefined.
    const stringBlock = makeBusinessLogicCandidate({
      id: 'bl-string',
      data: {
        _addedBy: 'spring-classic-adapter',
        behavior: 'not-an-object',
      },
    });
    expect(() =>
      render(<CandidateDetailsPanel candidate={stringBlock} />)
    ).not.toThrow();
    expect(screen.queryByTestId('behaviour-block-bl-string')).not.toBeInTheDocument();

    // (ii) behavior is an array -> reader returns undefined.
    const arrayBlock = makeBusinessLogicCandidate({
      id: 'bl-array',
      data: {
        _addedBy: 'spring-classic-adapter',
        behavior: ['nope'],
      },
    });
    expect(() =>
      render(<CandidateDetailsPanel candidate={arrayBlock} />)
    ).not.toThrow();
    expect(screen.queryByTestId('behaviour-block-bl-array')).not.toBeInTheDocument();

    // (iii) behavior is an empty object with no usable parts / confidence /
    // provenance -> reader returns undefined -> nothing renders.
    const emptyBlock = makeBusinessLogicCandidate({
      id: 'bl-empty',
      data: {
        _addedBy: 'spring-classic-adapter',
        behavior: {},
      },
    });
    expect(() =>
      render(<CandidateDetailsPanel candidate={emptyBlock} />)
    ).not.toThrow();
    expect(screen.queryByTestId('behaviour-block-bl-empty')).not.toBeInTheDocument();
  });

  it('does NOT render the behaviour block for a non-business_logics candidate even if data.behavior is present', () => {
    // The conditional guard is keyed on candidate_type === 'business_logics';
    // an endpoint carrying a stray `behavior` blob must not surface the block.
    const candidate = makeBusinessLogicCandidate({
      id: 'ep-stray',
      candidate_type: 'endpoints',
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        controllerClassName: 'OwnerController',
        methodName: 'list',
        behavior: makeBehaviourBlock(),
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);
    expect(screen.queryByTestId('behaviour-block-ep-stray')).not.toBeInTheDocument();
  });
});
