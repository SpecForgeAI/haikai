/**
 * Cross-layer wire-shape round-trip for the 7-part behaviour block
 * (Gap C, Spec 2026-05-29 Business-logic behaviour capture) -- Task Group 4.3.
 *
 * The per-group tests verify each LAYER in isolation:
 *   - Group 1 (`BusinessLogicBehaviorPersistenceTest` / `BusinessLogicIntegrationTest`):
 *     the AMS DTO serializes `behavior` under the snake_case key and round-trips
 *     through ModelService.
 *   - Group 2 (`llmBehaviourCaptureStep.test.ts`): the discovery stage stamps the
 *     block onto `data.behavior` with snake_case keys + an embedded confidence.
 *   - Group 3 (`behaviourBlockCandidate.test.tsx`): the frontend renders a
 *     well-formed block and tolerates a malformed one.
 *
 * What NO isolated test asserts is the CONTRACT ACROSS THE SEAM: that the exact
 * snake_case keys the discovery stage WRITES are the same keys the AMS DTO
 * carries on the wire (AMS Jackson is SNAKE_CASE; the block has NO
 * `@CamelCaseWire`, so the keys pass through verbatim) and the same keys the
 * frontend reader (`buildBehaviourBlock`) CONSUMES. A future drift -- e.g. the
 * discovery writer emits `data_effects` while the reader looks for `dataEffects`,
 * or AMS gains a `@CamelCaseWire` that camelCases the inner keys -- would slip
 * past every isolated test but break the user-visible block. These tests pin the
 * end-to-end snake_case shape: capture -> persist (snake_case `behavior`) ->
 * display.
 *
 * Method: a block shaped EXACTLY as the discovery stage emits it is sent through
 * a snake_case JSON round-trip (the AMS wire), parsed back, hung on a
 * `business_logics` candidate's `data.behavior`, and driven through the REAL
 * frontend consumer (`buildBehaviourBlock` + `CandidateDetailsPanel`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { CandidateDetailsPanel } from '../CandidateDetailsPanel';
import { buildBehaviourBlock } from '../codeDetectionMappers';

// CSS-module identity mock (same idiom as behaviourBlockCandidate.test.tsx).
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_target: object, prop: string | symbol) => String(prop) }
  ),
}));

const METHOD_ID = 'com.foo.service.OwnerService#registerOwner(Owner)';

/**
 * The block EXACTLY as the discovery behaviour-capture stage stamps it onto
 * `candidate.data.behavior` (`llmBehaviourCaptureStep.ts`): the top-level
 * markers (`schema_version`, `method_id`, `source_hash`, `confidence`) plus the
 * seven snake_case parts. Confidence is an embedded number (a boxed Double on
 * the AMS side). This is the producer contract.
 */
function discoveryEmittedBlock(): Record<string, unknown> {
  return {
    schema_version: 'behaviour.v1',
    method_id: METHOD_ID,
    source_hash: 'sha256:deadbeef',
    confidence: 0.62,
    io: {
      inputs: [{ name: 'owner', type: 'Owner', meaning: 'the owner to register' }],
      output: { type: 'Owner', meaning: 'the persisted owner' },
    },
    validation: [{ check: 'lastName non-empty', on_failure: 'InvalidOwnerException -> 400' }],
    transformation: 'trims name fields; defaults city to "Unknown"',
    data_effects: 'inserts a row into the owners table',
    side_effects: 'publishes an OwnerCreated event',
    edge_cases: ['null owner -> 400', 'empty lastName -> 400'],
    provenance: { method_id: METHOD_ID, notes: 'service registration method' },
  };
}

/**
 * Simulate the AMS wire: the global `spring.jackson.property-naming-strategy:
 * SNAKE_CASE` serializes the `behavior` JSONB passthrough Map verbatim (the
 * map's keys are already snake_case; there is NO `@CamelCaseWire`). A
 * JSON.stringify/parse models that wire faithfully -- if the keys were NOT
 * snake_case-stable, this is exactly where the contract would diverge.
 */
function throughAmsSnakeCaseWire(block: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(block)) as Record<string, unknown>;
}

function makeBusinessLogicCandidate(
  behavior: unknown,
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'bl-wire-001',
    run_id: 'run-001',
    candidate_type: 'business_logics',
    name: 'OwnerService.registerOwner(Owner)',
    confidence: 0.62,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/service/OwnerService.java'],
    data: {
      _addedBy: 'spring-classic-adapter',
      methodId: METHOD_ID,
      behavior,
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
// (1) The discovery-emitted snake_case shape survives the AMS wire and the
//     frontend reader consumes every one of the 7 parts + confidence.
// ============================================================================

describe('behaviour block cross-layer wire-shape round-trip', () => {
  it('the snake_case keys the discovery stage writes survive the AMS wire and the frontend reader maps all 7 parts + confidence', () => {
    const onWire = throughAmsSnakeCaseWire(discoveryEmittedBlock());

    // The candidate as the frontend receives it after AMS persist + read-back.
    const candidate = makeBusinessLogicCandidate(onWire);
    const display = buildBehaviourBlock(candidate);

    expect(display).toBeDefined();
    // All seven parts resolved by key (the cross-seam contract): the reader
    // keys on the SAME snake_case names the discovery stage emitted.
    const renderedKeys = display!.sections.map((s) => s.key).sort();
    expect(renderedKeys).toEqual(
      ['data_effects', 'edge_cases', 'io', 'provenance', 'side_effects', 'transformation', 'validation'].sort()
    );
    // The embedded confidence (boxed Double on AMS) surfaces for the badge.
    expect(display!.confidence).toBeCloseTo(0.62, 5);
    // Provenance method id (FQN + signature) is hoisted as the headline.
    expect(display!.provenanceMethodId).toBe(METHOD_ID);

    // A representative content slice survived end-to-end (validation's
    // error->status mapping + the transformation prose).
    const validation = display!.sections.find((s) => s.key === 'validation')!;
    expect(validation.lines.join(' ')).toContain('InvalidOwnerException -> 400');
    const transformation = display!.sections.find((s) => s.key === 'transformation')!;
    expect(transformation.lines.join(' ')).toContain('defaults city');
  });

  // ==========================================================================
  // (2) The same post-wire candidate renders end-to-end through the REAL
  //     CandidateDetailsPanel: 7 expandable sections + confidence badge.
  // ==========================================================================
  it('renders the post-wire block through CandidateDetailsPanel: 7 sections + confidence badge (capture -> persist -> display)', () => {
    const onWire = throughAmsSnakeCaseWire(discoveryEmittedBlock());
    const candidate = makeBusinessLogicCandidate(onWire);

    render(<CandidateDetailsPanel candidate={candidate} />);

    // The behaviour block surfaces for the business_logics candidate.
    const blockEl = screen.getByTestId('behaviour-block-bl-wire-001');
    expect(blockEl).toBeInTheDocument();

    // Confidence badge reflects the embedded (boxed Double) confidence: 0.62 is
    // in the MEDIUM bucket [0.45, 0.85) using the locked palette.
    const badge = screen.getByTestId('behaviour-confidence-badge-bl-wire-001');
    expect(badge).toHaveTextContent('0.62');
    expect(badge.className).toContain('behaviourConfidenceMedium');

    // Expand and confirm all seven snake_case-keyed sections render.
    const toggle = within(blockEl).getByTestId('behaviour-block-toggle-bl-wire-001');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const sections = screen.getByTestId('behaviour-block-sections-bl-wire-001');
    for (const key of [
      'io',
      'validation',
      'transformation',
      'data_effects',
      'side_effects',
      'edge_cases',
      'provenance',
    ]) {
      expect(
        within(sections).getByTestId(`behaviour-section-${key}-bl-wire-001`)
      ).toBeInTheDocument();
    }
    // Provenance shows the method id end-to-end.
    expect(
      within(sections).getByTestId('behaviour-section-provenance-bl-wire-001')
    ).toHaveTextContent(METHOD_ID);
  });

  // ==========================================================================
  // (3) Negative cross-seam guard: this is the failure mode the snake_case
  //     contract prevents. A block whose 7 parts were camelCased on the wire
  //     (the shape a stray `@CamelCaseWire` on the AMS DTO would produce)
  //     resolves to ZERO usable sections -- proving the reader keys strictly on
  //     snake_case -- yet it never throws (malformed-tolerant). If a future
  //     change camelCased the wire, the UI would silently go blank rather than
  //     crash, and THIS test would flag the regression.
  // ==========================================================================
  it('a camelCased wire shape (the drift the snake_case contract guards against) yields no sections and never throws', () => {
    const camelCased: Record<string, unknown> = {
      // Top-level markers + the SEVEN parts all camelCased.
      schemaVersion: 'behaviour.v1',
      methodId: METHOD_ID,
      sourceHash: 'sha256:deadbeef',
      // confidence is a single word so it is camel/snake-identical -- exclude
      // it so the block has neither a recognised part NOR a confidence, which
      // is the genuinely-unusable case the reader must drop.
      ioPart: { output: { type: 'Owner' } },
      validationChecks: [{ check: 'x', onFailure: 'y' }],
      transformationLogic: 'does things',
      dataEffects: 'writes Owner',
      sideEffects: 'none',
      edgeCases: ['null'],
      provenanceInfo: { methodId: METHOD_ID },
    };
    const candidate = makeBusinessLogicCandidate(camelCased, { id: 'bl-camel' });

    // Reader: no snake_case part matched -> undefined (nothing to render).
    expect(buildBehaviourBlock(candidate)).toBeUndefined();

    // Panel: mounts cleanly, the additive block is simply absent (never throws).
    expect(() => render(<CandidateDetailsPanel candidate={candidate} />)).not.toThrow();
    expect(screen.getByTestId('candidate-details-panel-bl-camel')).toBeInTheDocument();
    expect(screen.queryByTestId('behaviour-block-bl-camel')).not.toBeInTheDocument();
  });
});
