/**
 * FeatureHeader Component Tests
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 3: Create FeatureHeader Component
 *
 * Tests for:
 * - Component renders feature title correctly
 * - Component displays "Feature:" label
 * - Component handles empty/undefined title gracefully
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureHeader } from '../components/ProductView/FeatureHeader';

describe('Task Group 3: FeatureHeader Component', () => {
  describe('Test 3.1: Component renders feature title correctly', () => {
    it('should render the provided title', () => {
      render(<FeatureHeader title="User Authentication Feature" />);

      expect(screen.getByText('User Authentication Feature')).toBeInTheDocument();
    });

    it('should render titles with special characters', () => {
      render(<FeatureHeader title="API Integration (v2.0) - OAuth Flow" />);

      expect(screen.getByText('API Integration (v2.0) - OAuth Flow')).toBeInTheDocument();
    });

    it('should render long titles', () => {
      const longTitle = 'This is a very long feature title that spans multiple words and describes a complex feature requirement';
      render(<FeatureHeader title={longTitle} />);

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });
  });

  describe('Test 3.2: Component displays "Feature:" label', () => {
    it('should display the "Feature:" label', () => {
      render(<FeatureHeader title="Test Feature" />);

      expect(screen.getByText('Feature:')).toBeInTheDocument();
    });

    it('should render label and title together in the header', () => {
      const { container } = render(<FeatureHeader title="My Feature" />);

      const header = container.querySelector('[class*="featureHeader"]');
      expect(header).toBeInTheDocument();
      expect(header?.textContent).toContain('Feature:');
      expect(header?.textContent).toContain('My Feature');
    });
  });

  describe('Test 3.3: Component handles empty/undefined title gracefully', () => {
    it('should render with empty string title', () => {
      render(<FeatureHeader title="" />);

      // Label should still be present
      expect(screen.getByText('Feature:')).toBeInTheDocument();
    });

    it('should have correct styling classes', () => {
      const { container } = render(<FeatureHeader title="Styled Header" />);

      const header = container.firstChild as HTMLElement;
      expect(header.className).toMatch(/featureHeader/);
    });

    it('should render the label with appropriate styling', () => {
      render(<FeatureHeader title="Label Test" />);

      const label = screen.getByText('Feature:');
      expect(label.className).toMatch(/featureLabel/);
    });

    it('should render the title with appropriate styling', () => {
      render(<FeatureHeader title="Title Styling" />);

      const title = screen.getByText('Title Styling');
      expect(title.className).toMatch(/featureTitle/);
    });
  });
});
