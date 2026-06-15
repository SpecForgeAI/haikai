/**
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 2: FeatureHeader Badge Tests
 *
 * Tests for isReadyForSpec prop and "Ready for Spec" badge:
 * - Badge not rendered when isReadyForSpec is undefined
 * - Badge not rendered when isReadyForSpec is false
 * - Badge rendered with text "Ready for Spec" when isReadyForSpec is true
 * - Badge has correct styling (green background, white text)
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { FeatureHeader } from '../components/ProductView/FeatureHeader';

describe('Spec 2026-01-23: FeatureHeader Ready for Spec Badge', () => {
  describe('Badge visibility based on isReadyForSpec prop', () => {
    it('should NOT render badge when isReadyForSpec is undefined', () => {
      render(<FeatureHeader title="Test Feature" />);

      const badge = screen.queryByTestId('ready-for-spec-badge');
      expect(badge).not.toBeInTheDocument();
    });

    it('should NOT render badge when isReadyForSpec is false', () => {
      render(<FeatureHeader title="Test Feature" isReadyForSpec={false} />);

      const badge = screen.queryByTestId('ready-for-spec-badge');
      expect(badge).not.toBeInTheDocument();
    });

    it('should render badge with text "Ready for Spec" when isReadyForSpec is true', () => {
      render(<FeatureHeader title="Test Feature" isReadyForSpec={true} />);

      const badge = screen.getByTestId('ready-for-spec-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Ready for Spec');
    });
  });

  describe('Badge styling', () => {
    it('should have the readyBadge class applied when isReadyForSpec is true', () => {
      render(<FeatureHeader title="Test Feature" isReadyForSpec={true} />);

      const badge = screen.getByTestId('ready-for-spec-badge');
      // Check that the badge has a class name that includes 'readyBadge'
      // CSS Modules will mangle the class name, so we check for the presence of any class
      expect(badge.className).toContain('readyBadge');
    });
  });

  describe('Badge position', () => {
    it('should render badge after the feature title', () => {
      render(<FeatureHeader title="Test Feature" isReadyForSpec={true} />);

      const header = screen.getByTestId('ready-for-spec-badge').parentElement;
      const children = header?.children;

      // The badge should come after the title elements
      expect(children).toBeDefined();
      if (children) {
        const childArray = Array.from(children);
        const badgeIndex = childArray.findIndex(
          (child) => child.getAttribute('data-testid') === 'ready-for-spec-badge'
        );
        // Badge should be after the label and title spans (index > 1)
        expect(badgeIndex).toBeGreaterThan(1);
      }
    });
  });

  describe('Feature title still renders correctly with badge', () => {
    it('should still display the feature title when badge is present', () => {
      render(<FeatureHeader title="My Amazing Feature" isReadyForSpec={true} />);

      expect(screen.getByText('My Amazing Feature')).toBeInTheDocument();
      expect(screen.getByText('Feature:')).toBeInTheDocument();
      expect(screen.getByTestId('ready-for-spec-badge')).toBeInTheDocument();
    });
  });
});
