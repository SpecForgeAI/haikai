/**
 * RuntimeBadge component tests
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 1.1.
 *
 * Pure renderer tests. Confirms:
 *  1. The pill renders with the supplied label text.
 *  2. Each variant token (`success` / `warning` / `caution` / `danger` /
 *     `neutral`) applies the matching TierBadge variant CSS class
 *     (RuntimeBadge reuses TierBadge.module.css per spec).
 *  3. The `data-testid` prop is forwarded to the rendered element (so
 *     wire-up callers can target the runtime badge specifically).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Identity-mapped CSS module so className assertions match property names.
vi.mock('../TierBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { RuntimeBadge } from '../RuntimeBadge';

describe('RuntimeBadge', () => {
  it('renders a pill containing the supplied label text', () => {
    render(<RuntimeBadge label="Observed 1.8k" variant="success" />);
    const el = screen.getByTestId('runtime-badge');
    expect(el.textContent).toBe('Observed 1.8k');
    // Base `tierBadge` class always applied (shared pill shape with TierBadge).
    expect(el.className).toContain('tierBadge');
  });

  it('applies the matching TierBadge variant CSS class for every variant token', () => {
    const cases: Array<{
      variant: 'success' | 'warning' | 'caution' | 'danger' | 'neutral';
      expectedClass: string;
    }> = [
      { variant: 'success', expectedClass: 'tierBadgeSuccess' },
      { variant: 'warning', expectedClass: 'tierBadgeWarning' },
      { variant: 'caution', expectedClass: 'tierBadgeCaution' },
      { variant: 'danger', expectedClass: 'tierBadgeDanger' },
      { variant: 'neutral', expectedClass: 'tierBadgeNeutral' },
    ];

    for (const { variant, expectedClass } of cases) {
      const { unmount } = render(
        <RuntimeBadge label={variant} variant={variant} data-testid={`rb-${variant}`} />
      );
      const el = screen.getByTestId(`rb-${variant}`);
      expect(el.className).toContain(expectedClass);
      expect(el.getAttribute('data-variant')).toBe(variant);
      unmount();
    }
  });

  it('forwards data-testid to the rendered element', () => {
    render(
      <RuntimeBadge label="Elevated errors" variant="warning" data-testid="my-runtime-badge" />
    );
    expect(screen.getByTestId('my-runtime-badge')).not.toBeNull();
  });
});
