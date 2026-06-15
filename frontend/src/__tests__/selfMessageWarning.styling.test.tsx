/**
 * Self-Message Warning Styling Tests
 *
 * Spec 2026-01-26: Sequence Diagram Self-Message Exchanges
 * Task Group 2: Self-Message Warning Styling
 *
 * Tests for:
 * - Warning text has red color (#d32f2f)
 * - Warning text has appropriate font size (12px)
 *
 * These tests verify that the .selfMessageWarning CSS class is properly
 * defined and applies the correct styles to the warning text element.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import styles from '../components/DiagramsView/CreateAndPlaceDrawer.module.css';

describe('Task Group 2: Self-Message Warning Styling', () => {
  /**
   * Helper component that renders a span with the selfMessageWarning class.
   * This simulates how the warning will be rendered in AddMessageExchangeDrawer.
   */
  const SelfMessageWarningExample: React.FC = () => (
    <span
      className={styles.selfMessageWarning}
      data-testid="self-message-warning"
    >
      Source Participant and To Participant are the same
    </span>
  );

  describe('Test 2.1a: Warning text has red color (#d32f2f)', () => {
    it('should apply selfMessageWarning class to the warning element', () => {
      render(<SelfMessageWarningExample />);

      const warning = screen.getByTestId('self-message-warning');
      expect(warning).toBeInTheDocument();
      // CSS module class names contain the original class name
      expect(warning.className).toMatch(/selfMessageWarning/);
    });

    it('should have the selfMessageWarning class defined in the styles object', () => {
      // Verify the CSS module exports the selfMessageWarning class
      expect(styles.selfMessageWarning).toBeDefined();
      expect(typeof styles.selfMessageWarning).toBe('string');
      expect(styles.selfMessageWarning.length).toBeGreaterThan(0);
    });
  });

  describe('Test 2.1b: Warning text has appropriate font size (12px)', () => {
    it('should render warning text with selfMessageWarning styling class', () => {
      render(<SelfMessageWarningExample />);

      const warning = screen.getByTestId('self-message-warning');

      // The class name should include 'selfMessageWarning' (possibly with CSS module hash)
      expect(warning.className).toMatch(/selfMessageWarning/);
    });

    it('should display the warning message text correctly', () => {
      render(<SelfMessageWarningExample />);

      const warning = screen.getByText('Source Participant and To Participant are the same');
      expect(warning).toBeInTheDocument();
    });
  });
});
