/**
 * renderMultiLineLabel.yOffset.test.tsx
 * Task Group 4: Tests for 3-line label y-offset fix
 *
 * Verifies that renderMultiLineLabel shifts startY up by an additional 10px
 * for 3-line labels, while 1-line and 2-line labels remain unaffected.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import {
  renderMultiLineLabel,
  MESSAGE_LABEL_LINE_SPACING,
} from '../components/DiagramsView/SequenceDiagramRenderer';

/**
 * Helper to render the label inside an SVG and extract the y attribute of the <text> element.
 */
function getTextY(labelLines: string[], labelX: number, baseY: number): number {
  const element = renderMultiLineLabel(labelLines, labelX, baseY);
  if (!element) throw new Error('renderMultiLineLabel returned null');

  const { container } = render(<svg>{element}</svg>);
  const textEl = container.querySelector('text');
  if (!textEl) throw new Error('No <text> element found');

  return parseFloat(textEl.getAttribute('y')!);
}

describe('renderMultiLineLabel 3-line y-offset fix', () => {
  const labelX = 100;
  const baseY = 200;

  it('shifts startY up by additional 10px when labelLines.length === 3', () => {
    const lines = ['Line A', 'Line B', 'Line C'];
    const actualY = getTextY(lines, labelX, baseY);

    // Without the fix: startY = baseY - (2 * 14) / 2 = 200 - 14 = 186
    // With the fix:    startY = 186 - 10 = 176
    const totalHeight = (lines.length - 1) * MESSAGE_LABEL_LINE_SPACING;
    const expectedY = baseY - totalHeight / 2 - 10;

    expect(actualY).toBe(expectedY);
  });

  it('does NOT shift startY for 2-line labels', () => {
    const lines = ['Line A', 'Line B'];
    const actualY = getTextY(lines, labelX, baseY);

    // startY = baseY - (1 * 14) / 2 = 200 - 7 = 193
    const totalHeight = (lines.length - 1) * MESSAGE_LABEL_LINE_SPACING;
    const expectedY = baseY - totalHeight / 2;

    expect(actualY).toBe(expectedY);
  });

  it('does NOT shift startY for 1-line labels', () => {
    const lines = ['Single Line'];
    const actualY = getTextY(lines, labelX, baseY);

    // startY = baseY - (0 * 14) / 2 = 200
    const expectedY = baseY;

    expect(actualY).toBe(expectedY);
  });
});
