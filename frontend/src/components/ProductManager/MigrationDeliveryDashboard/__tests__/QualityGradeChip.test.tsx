/**
 * QualityGradeChip tests
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 6.1.
 *
 * Coverage:
 *   - Colour class per grade (A/B/C/D/F).
 *   - Null grade renders the muted N/A class with "--" label.
 *   - Tooltip surfaces numeric score and dimension breakdown.
 *   - Disagreement badge: high confidence + grade in {C,D,F} -> badge present.
 *   - Disagreement badge: low confidence + grade in {A,B} -> badge present.
 *   - Disagreement badge: medium confidence + B grade -> badge absent.
 *   - Compact mode applies the compact class.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
import { vi } from 'vitest';
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import QualityGradeChip, {
  qualityGradeBadgeClass,
  deriveDisagreementDirection,
} from '../QualityGradeChip';

describe('QualityGradeChip -- colour class per grade', () => {
  it('renders correct colour class for each of A/B/C/D/F', () => {
    const grades = ['A', 'B', 'C', 'D', 'F'] as const;
    for (const grade of grades) {
      const { unmount } = render(
        <QualityGradeChip qualityGrade={grade} qualityScore={90} />,
      );
      const chip = screen.getByTestId('mdd-quality-grade-chip');
      expect(chip.className).toContain(`badgeQuality${grade}`);
      expect(chip.textContent).toBe(grade);
      unmount();
    }
  });
});

describe('QualityGradeChip -- N/A muted state', () => {
  it('renders muted "--" chip when qualityGrade is null', () => {
    render(<QualityGradeChip qualityGrade={null} qualityScore={null} />);
    const chip = screen.getByTestId('mdd-quality-grade-chip');
    expect(chip.textContent).toBe('--');
    expect(chip.className).toContain('badgeQualityNa');
    expect(chip.getAttribute('data-grade')).toBe('na');
  });
});

describe('QualityGradeChip -- tooltip', () => {
  it('shows numeric score and dimension breakdown in tooltip', () => {
    render(
      <QualityGradeChip
        qualityGrade="B"
        qualityScore={78}
        qualityDimensions={[
          { name: 'completeness', score: 80, reason: 'r1' },
          { name: 'ac_measurability', score: 60, reason: 'r2' },
        ]}
      />,
    );
    const chip = screen.getByTestId('mdd-quality-grade-chip');
    const title = chip.getAttribute('title') ?? '';
    expect(title).toContain('B (78/100)');
    expect(title).toContain('completeness: 80');
    expect(title).toContain('ac_measurability: 60');
  });

  it('renders tooltip with only the grade + score when no dimensions supplied', () => {
    render(<QualityGradeChip qualityGrade="A" qualityScore={95} />);
    const chip = screen.getByTestId('mdd-quality-grade-chip');
    expect(chip.getAttribute('title')).toBe('A (95/100)');
  });
});

describe('QualityGradeChip -- disagreement badge', () => {
  it('renders the "!" disagreement badge when confidence=high AND grade=C', () => {
    render(
      <QualityGradeChip
        qualityGrade="C"
        qualityScore={60}
        llmConfidence="high"
      />,
    );
    const badge = screen.getByTestId('mdd-quality-grade-chip-disagreement');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('!');
    expect(badge.getAttribute('data-direction')).toBe('high-confidence-low-grade');
  });

  it('renders the "!" disagreement badge when confidence=low AND grade=B', () => {
    render(
      <QualityGradeChip
        qualityGrade="B"
        qualityScore={78}
        llmConfidence="low"
      />,
    );
    const badge = screen.getByTestId('mdd-quality-grade-chip-disagreement');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('data-direction')).toBe('low-confidence-high-grade');
  });

  it('does NOT render the disagreement badge when confidence=medium and grade=B (no disagreement)', () => {
    render(
      <QualityGradeChip
        qualityGrade="B"
        qualityScore={78}
        llmConfidence="medium"
      />,
    );
    expect(
      screen.queryByTestId('mdd-quality-grade-chip-disagreement'),
    ).not.toBeInTheDocument();
  });

  it('does NOT render the disagreement badge when grade is null', () => {
    render(
      <QualityGradeChip
        qualityGrade={null}
        qualityScore={null}
        llmConfidence="high"
      />,
    );
    expect(
      screen.queryByTestId('mdd-quality-grade-chip-disagreement'),
    ).not.toBeInTheDocument();
  });
});

describe('QualityGradeChip -- compact mode', () => {
  it('applies the compact class when compact prop is true', () => {
    render(
      <QualityGradeChip qualityGrade="A" qualityScore={92} compact />,
    );
    const chip = screen.getByTestId('mdd-quality-grade-chip');
    expect(chip.className).toContain('badgeQualityCompact');
  });

  it('does NOT apply the compact class by default', () => {
    render(<QualityGradeChip qualityGrade="A" qualityScore={92} />);
    const chip = screen.getByTestId('mdd-quality-grade-chip');
    expect(chip.className).not.toContain('badgeQualityCompact');
  });
});

describe('QualityGradeChip -- pure helpers', () => {
  it('qualityGradeBadgeClass maps grade to the corresponding CSS class', () => {
    expect(qualityGradeBadgeClass('A')).toBe('badgeQualityA');
    expect(qualityGradeBadgeClass('F')).toBe('badgeQualityF');
    expect(qualityGradeBadgeClass(null)).toBe('badgeQualityNa');
  });

  it('deriveDisagreementDirection returns correct direction or null', () => {
    expect(deriveDisagreementDirection('A', 'high')).toBeNull();
    expect(deriveDisagreementDirection('C', 'high')).toBe(
      'high-confidence-low-grade',
    );
    expect(deriveDisagreementDirection('A', 'low')).toBe(
      'low-confidence-high-grade',
    );
    expect(deriveDisagreementDirection('B', 'medium')).toBeNull();
    expect(deriveDisagreementDirection(null, 'high')).toBeNull();
    expect(deriveDisagreementDirection('A', null)).toBeNull();
  });
});
