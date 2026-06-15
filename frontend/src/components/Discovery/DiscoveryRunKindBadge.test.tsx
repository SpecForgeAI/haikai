/**
 * DiscoveryRunKindBadge tests
 *
 * Spec 2026-05-16: Database Discovery Packs -- Group 5
 *
 * Verifies:
 *   1. `database` kind renders the DB badge with the expected label.
 *   2. `code` kind renders a CODE badge (subtle styling -- not asserted
 *      here, just presence + label).
 *   3. Unknown / undefined kinds render nothing (defensive no-op).
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('./DiscoveryRunKindBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

import { DiscoveryRunKindBadge } from './DiscoveryRunKindBadge';

describe('DiscoveryRunKindBadge (Spec 2026-05-16, Group 5)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a DB badge for kind="database"', () => {
    render(<DiscoveryRunKindBadge kind="database" />);
    const badge = screen.getByTestId('run-list-kind-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('DB');
    expect(badge.getAttribute('data-kind')).toBe('database');
  });

  it('renders a CODE badge for kind="code"', () => {
    render(<DiscoveryRunKindBadge kind="code" />);
    const badge = screen.getByTestId('run-list-kind-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('CODE');
  });

  it('renders nothing when kind is undefined / null / empty', () => {
    const { rerender } = render(<DiscoveryRunKindBadge kind={undefined} />);
    expect(screen.queryByTestId('run-list-kind-badge')).not.toBeInTheDocument();
    rerender(<DiscoveryRunKindBadge kind={null} />);
    expect(screen.queryByTestId('run-list-kind-badge')).not.toBeInTheDocument();
    rerender(<DiscoveryRunKindBadge kind="" />);
    expect(screen.queryByTestId('run-list-kind-badge')).not.toBeInTheDocument();
  });
});
