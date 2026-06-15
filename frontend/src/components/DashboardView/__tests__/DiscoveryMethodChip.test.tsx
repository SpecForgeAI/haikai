/**
 * DiscoveryMethodChip Component Tests
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2),
 * Task Group 3 (W-10 -- `discovery_method` trace metadata).
 *
 * Mirrors the pure-renderer test pattern from `RuntimeBadge.test.tsx`.
 *
 * Coverage:
 *  1. `discovery_method='framework_scanner'` -> chip renders the visible
 *     label "Framework scan" with the neutral TierBadge variant class
 *     (mirrors `_addedBy=unknown` rendering -- the default emission path
 *     is not a visual nudge).
 *  2. `discovery_method='llm_extraction'` -> chip renders the visible
 *     label "LLM (Phase 2)" with the caution TierBadge variant class
 *     (mirrors `llm-ir-guided`'s amber accent -- LLM-extracted
 *     candidates warrant a closer look).
 *  3. Absent / undefined / null / unknown value -> renders nothing
 *     (the chip is additive; never asserts a fallback claim).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Identity-mapped CSS module so className assertions match property names
// (mirrors the pattern in `RuntimeBadge.test.tsx`).
vi.mock('../TierBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { DiscoveryMethodChip } from '../DiscoveryMethodChip';

describe('DiscoveryMethodChip', () => {
  it("renders 'Framework scan' (neutral) when discovery_method='framework_scanner'", () => {
    render(<DiscoveryMethodChip discoveryMethod="framework_scanner" />);
    const el = screen.getByTestId('discovery-method-chip');
    expect(el.textContent).toBe('Framework scan');
    expect(el.className).toContain('tierBadge');
    expect(el.className).toContain('tierBadgeNeutral');
    expect(el.getAttribute('data-discovery-method')).toBe('framework_scanner');
  });

  it("renders 'LLM (Phase 2)' (caution/amber) when discovery_method='llm_extraction'", () => {
    render(<DiscoveryMethodChip discoveryMethod="llm_extraction" />);
    const el = screen.getByTestId('discovery-method-chip');
    expect(el.textContent).toBe('LLM (Phase 2)');
    expect(el.className).toContain('tierBadge');
    expect(el.className).toContain('tierBadgeCaution');
    expect(el.getAttribute('data-discovery-method')).toBe('llm_extraction');
  });

  it('renders nothing when discovery_method is undefined / null / unknown', () => {
    // Undefined -- the chip is additive; absent values never collapse to a
    // fallback claim about provenance.
    const { rerender, container, unmount } = render(
      <DiscoveryMethodChip discoveryMethod={undefined} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('discovery-method-chip')).toBeNull();

    // Null -- same render-nothing behaviour.
    rerender(<DiscoveryMethodChip discoveryMethod={null} />);
    expect(container.firstChild).toBeNull();

    // Unknown string value -- still render-nothing (defensive against future
    // emitter values landing on the field before the chip is updated to
    // recognise them).
    rerender(<DiscoveryMethodChip discoveryMethod="some_unknown_future_value" />);
    expect(container.firstChild).toBeNull();

    unmount();
  });

  it('forwards data-testid to the rendered element', () => {
    render(
      <DiscoveryMethodChip
        discoveryMethod="framework_scanner"
        data-testid="discovery-method-chip-cand-42"
      />,
    );
    expect(screen.getByTestId('discovery-method-chip-cand-42')).not.toBeNull();
  });
});
