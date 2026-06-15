/**
 * MigrationDeliverySectionRetryPlaceholder tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 12 (refined partial roll-up placeholder per Q-11, AC 16).
 *
 * Coverage:
 *   1. Renders "Could not load {sectionName} -- retry" with the section
 *      name verbatim.
 *   2. Clicking the retry button invokes the `onRetry` callback exactly
 *      once.
 *
 * Test conventions mirror other MigrationDeliveryDashboard component tests:
 *   - vi.mock the CSS module before importing the component.
 *   - vi.resetAllMocks() in beforeEach per Standing Constraint 6.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import MigrationDeliverySectionRetryPlaceholder from '../MigrationDeliverySectionRetryPlaceholder';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliverySectionRetryPlaceholder', () => {
  it('renders the "Could not load {sectionName} -- retry" copy and fires onRetry when the button is clicked', () => {
    const onRetry = vi.fn();

    render(
      <MigrationDeliverySectionRetryPlaceholder
        sectionName="workstream progress"
        onRetry={onRetry}
        testId="mdd-workstream-strip-placeholder"
      />,
    );

    const placeholder = screen.getByTestId('mdd-workstream-strip-placeholder');
    expect(placeholder).toBeInTheDocument();
    // The full copy is composed across two elements (span + button), so
    // match on the parent's textContent rather than via toHaveTextContent
    // (which collapses whitespace differently for split text nodes).
    expect(placeholder.textContent).toMatch(
      /Could not load workstream progress -- ?retry/i,
    );

    // Click the retry button -> onRetry fires exactly once.
    const button = screen.getByTestId(
      'mdd-workstream-strip-placeholder-button',
    );
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
