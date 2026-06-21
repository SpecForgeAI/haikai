/**
 * DiscoveryBreakdownChip tests (Spec 2026-06-20 -- Task Group 6).
 *
 * Asserts the honest breakdown chip:
 *   - renders the non-zero reason CLASSES (Created / Intra-scan duplicate /
 *     Pre-existing / Already saved / Suppressed duplicate / Possible duplicate /
 *     Blocked / Quality gap), keeping intra-scan / pre-existing / already-saved
 *     distinguished;
 *   - renders the actionable classes (Blocked / Quality gap) as CLICKABLE tokens
 *     wired to the open-panel handler scoped to that class;
 *   - renders the intra-scan-duplicate advisory note only when that count > 0;
 *   - preserves the legacy summary line (data-testid="save-approved-success")
 *     so the prior outcome-line assertions still hold.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SaveApprovedResult, SaveBackReasonEntry } from '../../../api/discoveryApi';
import {
  DiscoveryBreakdownChip,
  computeBreakdownCounts,
} from '../DiscoveryBreakdownChip';

// The component imports the CSS module; mock it to echo class names as strings.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

function reason(
  partial: Partial<SaveBackReasonEntry> & Pick<SaveBackReasonEntry, 'reason'>,
): SaveBackReasonEntry {
  return {
    candidateId: partial.candidateId ?? `c-${Math.random().toString(36).slice(2, 7)}`,
    candidateType: partial.candidateType ?? 'business_logics',
    name: partial.name ?? 'process',
    class: partial.class ?? 'OrderService',
    reason: partial.reason,
    reusedSubclass: partial.reusedSubclass,
    missingField: partial.missingField,
  };
}

function makeResult(overrides: Partial<SaveApprovedResult> = {}): SaveApprovedResult {
  return {
    entitiesCreated: 0,
    entitiesSkipped: 0,
    candidatesCommitted: 0,
    ...overrides,
  };
}

describe('DiscoveryBreakdownChip (TG6)', () => {
  it('renders every non-zero reason class as its own token, distinguishing the three reuse sub-classes', () => {
    const result = makeResult({
      entitiesCreated: 2,
      entitiesSkipped: 5,
      candidatesCommitted: 2,
      reasons: [
        reason({ reason: 'created' }),
        reason({ reason: 'created' }),
        reason({ reason: 'reused', reusedSubclass: 'intra-scan' }),
        reason({ reason: 'reused', reusedSubclass: 'pre-existing' }),
        reason({ reason: 'reused', reusedSubclass: 'already-saved' }),
        reason({ reason: 'blocked', missingField: 'parent_candidate_id' }),
        reason({ reason: 'quality_gap', missingField: 'interface_type' }),
      ],
      suppressedDuplicates: [
        { candidateId: 's1', candidateName: 'Dup', entityType: 'endpoints', existingEntityId: 'e1' },
      ],
      possibleDuplicates: [
        { candidateId: 'p1', candidateName: 'Maybe', entityType: 'endpoints', existingEntityId: 'e2', confidence: 0.6 },
      ],
    });

    render(<DiscoveryBreakdownChip result={result} onOpenClass={vi.fn()} />);

    // All eight classes are present and DISTINGUISHED (no collapse into "skipped").
    expect(screen.getByTestId('save-back-breakdown-token-created')).toHaveTextContent('Created');
    expect(screen.getByTestId('save-back-breakdown-token-intra-scan')).toHaveTextContent('Intra-scan duplicate');
    expect(screen.getByTestId('save-back-breakdown-token-pre-existing')).toHaveTextContent('Pre-existing');
    expect(screen.getByTestId('save-back-breakdown-token-already-saved')).toHaveTextContent('Already saved');
    expect(screen.getByTestId('save-back-breakdown-token-suppressed')).toHaveTextContent('Suppressed duplicate');
    expect(screen.getByTestId('save-back-breakdown-token-possible')).toHaveTextContent('Possible duplicate');
    expect(screen.getByTestId('save-back-breakdown-token-blocked')).toHaveTextContent('Blocked');
    expect(screen.getByTestId('save-back-breakdown-token-quality_gap')).toHaveTextContent('Quality gap');

    // Created token shows its count of 2.
    expect(screen.getByTestId('save-back-breakdown-token-created')).toHaveTextContent('2');
  });

  it('omits classes whose count is zero', () => {
    const result = makeResult({
      entitiesCreated: 1,
      candidatesCommitted: 1,
      reasons: [reason({ reason: 'created' })],
    });
    render(<DiscoveryBreakdownChip result={result} onOpenClass={vi.fn()} />);

    expect(screen.getByTestId('save-back-breakdown-token-created')).toBeInTheDocument();
    expect(screen.queryByTestId('save-back-breakdown-token-blocked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-back-breakdown-token-quality_gap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-back-breakdown-token-suppressed')).not.toBeInTheDocument();
  });

  it('makes the actionable tokens (Blocked / Quality gap) clickable and scoped to their class', () => {
    const onOpenClass = vi.fn();
    const result = makeResult({
      reasons: [
        reason({ reason: 'blocked', missingField: 'parent_candidate_id' }),
        reason({ reason: 'quality_gap', missingField: 'interface_type' }),
      ],
    });
    render(<DiscoveryBreakdownChip result={result} onOpenClass={onOpenClass} />);

    const blocked = screen.getByTestId('save-back-breakdown-token-blocked');
    expect(blocked.tagName).toBe('BUTTON');
    fireEvent.click(blocked);
    expect(onOpenClass).toHaveBeenCalledWith('blocked');

    fireEvent.click(screen.getByTestId('save-back-breakdown-token-quality_gap'));
    expect(onOpenClass).toHaveBeenCalledWith('quality_gap');
    expect(onOpenClass).toHaveBeenCalledTimes(2);
  });

  it('renders the intra-scan advisory note only when the intra-scan count is non-zero', () => {
    const withIntra = makeResult({
      reasons: [reason({ reason: 'reused', reusedSubclass: 'intra-scan' })],
    });
    const { unmount } = render(
      <DiscoveryBreakdownChip result={withIntra} onOpenClass={vi.fn()} />,
    );
    const advisory = screen.getByTestId('save-back-intra-scan-advisory');
    expect(advisory).toHaveTextContent('intra-scan duplicate');
    expect(advisory).toHaveTextContent('business_logics');
    unmount();

    const withoutIntra = makeResult({
      reasons: [reason({ reason: 'reused', reusedSubclass: 'pre-existing' })],
    });
    render(<DiscoveryBreakdownChip result={withoutIntra} onOpenClass={vi.fn()} />);
    expect(screen.queryByTestId('save-back-intra-scan-advisory')).not.toBeInTheDocument();
  });

  it('keeps the legacy summary line (created / skipped / committed / below-gate) for back-compat', () => {
    const result = makeResult({
      entitiesCreated: 2,
      entitiesSkipped: 3,
      candidatesCommitted: 2,
      belowGateCount: 5,
      reasons: [reason({ reason: 'created' }), reason({ reason: 'created' })],
    });
    render(<DiscoveryBreakdownChip result={result} onOpenClass={vi.fn()} />);

    const line = screen.getByTestId('save-approved-success');
    expect(line).toHaveTextContent('2 created');
    expect(line).toHaveTextContent('3 skipped');
    expect(line).toHaveTextContent('2 committed');
    expect(line).toHaveTextContent('5 below auto-accept (reviewable)');
  });

  it('computeBreakdownCounts takes the max of dup-array length and arm count (no double-add)', () => {
    // Arm carries one suppressed entry AND the array carries two -> max == 2.
    const result = makeResult({
      reasons: [reason({ reason: 'suppressed' })],
      suppressedDuplicates: [
        { candidateId: 's1', candidateName: 'A', entityType: 'endpoints', existingEntityId: 'e1' },
        { candidateId: 's2', candidateName: 'B', entityType: 'endpoints', existingEntityId: 'e2' },
      ],
    });
    const counts = computeBreakdownCounts(result);
    expect(counts.suppressed).toBe(2);
  });
});
