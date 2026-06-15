/**
 * MigrationDeliveryProvenanceFilter -- chip render + pure-helper tests
 *
 * Spec: 2026-06-14 Net-new backlog items + provenance (D5) -- Task Group 4
 * (D6: provenance filter).
 *
 * Focused coverage of the controlled filter component + its normalisation
 * helpers (the logic the dashboard intersects into the tree filter):
 *   - `normaliseProvenance` treats anything that is not `net_new` as
 *     `carry_over` (the column default).
 *   - `isProvenanceAllowedByFilter` honours all | net_new | carry_over.
 *   - selecting a chip fires onChange with the chosen value; the selected chip
 *     is aria-pressed.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import {
  MigrationDeliveryProvenanceFilter,
  normaliseProvenance,
  isProvenanceAllowedByFilter,
  defaultProvenanceFilterValue,
} from '../MigrationDeliveryProvenanceFilter';

describe('normaliseProvenance', () => {
  it('maps net_new to net_new and everything else (incl. null/undefined) to carry_over', () => {
    expect(normaliseProvenance('net_new')).toBe('net_new');
    expect(normaliseProvenance('carry_over')).toBe('carry_over');
    expect(normaliseProvenance(null)).toBe('carry_over');
    expect(normaliseProvenance(undefined)).toBe('carry_over');
    expect(normaliseProvenance('something_else')).toBe('carry_over');
  });
});

describe('isProvenanceAllowedByFilter', () => {
  it('all includes every provenance', () => {
    expect(isProvenanceAllowedByFilter('net_new', 'all')).toBe(true);
    expect(isProvenanceAllowedByFilter('carry_over', 'all')).toBe(true);
    expect(isProvenanceAllowedByFilter(null, 'all')).toBe(true);
  });

  it('net_new includes only net_new', () => {
    expect(isProvenanceAllowedByFilter('net_new', 'net_new')).toBe(true);
    expect(isProvenanceAllowedByFilter('carry_over', 'net_new')).toBe(false);
    expect(isProvenanceAllowedByFilter(null, 'net_new')).toBe(false);
  });

  it('carry_over includes carry_over + null/absent (the default)', () => {
    expect(isProvenanceAllowedByFilter('carry_over', 'carry_over')).toBe(true);
    expect(isProvenanceAllowedByFilter(null, 'carry_over')).toBe(true);
    expect(isProvenanceAllowedByFilter('net_new', 'carry_over')).toBe(false);
  });

  it('defaults to all', () => {
    expect(defaultProvenanceFilterValue()).toBe('all');
  });
});

describe('MigrationDeliveryProvenanceFilter component', () => {
  it('fires onChange with the selected chip value and marks the active chip pressed', () => {
    const onChange = vi.fn();
    render(
      <MigrationDeliveryProvenanceFilter value="all" onChange={onChange} />,
    );

    // The active chip is pressed; the others are not.
    expect(
      screen.getByTestId('mdd-provenance-filter-chip-all'),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByTestId('mdd-provenance-filter-chip-net_new'),
    ).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('mdd-provenance-filter-chip-net_new'));
    expect(onChange).toHaveBeenCalledWith('net_new');

    fireEvent.click(screen.getByTestId('mdd-provenance-filter-chip-carry_over'));
    expect(onChange).toHaveBeenCalledWith('carry_over');
  });
});
