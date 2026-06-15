/**
 * FeatureSectionCard Gap Coverage Tests
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests fill coverage gaps identified during the test review:
 * - className prop used independently
 * - React.ReactNode title (custom elements)
 * - Icon prop ignored when title is ReactNode
 * - Combined usage of className with other props
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureSectionCard } from '../components/ProductView/FeatureSectionCard';

// Mock icon component for testing
function MockIcon({ testId }: { testId?: string }) {
  return <span data-testid={testId || 'mock-icon'}>icon</span>;
}

describe('Task Group 5: FeatureSectionCard Gap Coverage', () => {
  describe('className prop used independently', () => {
    it('should apply custom className to the card container', () => {
      const { container } = render(
        <FeatureSectionCard title="Custom Class Test" className="customTestClass">
          <p>Content</p>
        </FeatureSectionCard>
      );

      // Find the card element
      const card = container.querySelector('[class*="card"]');
      expect(card).toBeInTheDocument();
      // Custom class should be applied
      expect(card?.className).toContain('customTestClass');
    });

    it('should combine custom className with base card class', () => {
      const { container } = render(
        <FeatureSectionCard title="Combined Class Test" className="myCustomStyle">
          <p>Content</p>
        </FeatureSectionCard>
      );

      const card = container.firstChild as HTMLElement;
      // Should have both base card class and custom class
      expect(card.className).toMatch(/card/);
      expect(card.className).toContain('myCustomStyle');
    });

    it('should work correctly when className is combined with icon prop', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Class with Icon"
          className="iconCardStyle"
          icon={<MockIcon testId="class-icon" />}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('iconCardStyle');
      expect(screen.getByTestId('class-icon')).toBeInTheDocument();
    });
  });

  describe('React.ReactNode title (custom elements)', () => {
    it('should render custom JSX element as title', () => {
      const customTitle = (
        <span data-testid="custom-title-element">
          <strong>Bold</strong> Title
        </span>
      );

      render(
        <FeatureSectionCard title={customTitle}>
          <p>Content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByTestId('custom-title-element')).toBeInTheDocument();
      expect(screen.getByText('Bold')).toBeInTheDocument();
      expect(screen.getByText(/Title/)).toBeInTheDocument();
    });

    it('should render complex multi-element title', () => {
      const complexTitle = (
        <span data-testid="complex-title">
          <MockIcon testId="title-icon-1" />
          <span>&</span>
          <MockIcon testId="title-icon-2" />
          <span>Complex Header</span>
        </span>
      );

      render(
        <FeatureSectionCard title={complexTitle}>
          <p>Content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByTestId('complex-title')).toBeInTheDocument();
      expect(screen.getByTestId('title-icon-1')).toBeInTheDocument();
      expect(screen.getByTestId('title-icon-2')).toBeInTheDocument();
      expect(screen.getByText('Complex Header')).toBeInTheDocument();
    });

    it('should ignore icon prop when title is ReactNode', () => {
      const customTitle = <span data-testid="node-title">Custom Title</span>;

      const { container } = render(
        <FeatureSectionCard
          title={customTitle}
          icon={<MockIcon testId="ignored-icon" />}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      // Custom title should be rendered directly
      expect(screen.getByTestId('node-title')).toBeInTheDocument();
      // Icon prop should be ignored - no sectionHeaderWithIcon wrapper
      const iconWrapper = container.querySelector('[class*="sectionHeaderWithIcon"]');
      expect(iconWrapper).not.toBeInTheDocument();
      // The icon element itself may or may not be in the DOM depending on implementation
      // but it should NOT be in the icon wrapper position
    });
  });

  describe('Edge case: empty content rendering', () => {
    it('should render empty state when isEmpty is true even with valid children', () => {
      render(
        <FeatureSectionCard
          title="Empty State Test"
          isEmpty={true}
          emptyMessage="This section is empty"
        >
          <p>This content should not be visible</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Empty State Test')).toBeInTheDocument();
      expect(screen.getByText('This section is empty')).toBeInTheDocument();
      expect(screen.queryByText('This content should not be visible')).not.toBeInTheDocument();
    });

    it('should render default empty message when emptyMessage is not provided', () => {
      render(
        <FeatureSectionCard title="Default Empty" isEmpty={true}>
          <p>Hidden content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Default Empty')).toBeInTheDocument();
      expect(screen.getByText('No content available')).toBeInTheDocument();
    });
  });

  describe('Combined usage: className with headerRightContent', () => {
    it('should correctly apply className when headerRightContent is also provided', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Full Props Test"
          className="fullPropsStyle"
          headerRightContent={<button data-testid="right-btn">Action</button>}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('fullPropsStyle');
      expect(screen.getByTestId('right-btn')).toBeInTheDocument();

      // Header row should be present for right content
      const headerRow = container.querySelector('[class*="sectionHeaderRow"]');
      expect(headerRow).toBeInTheDocument();
    });
  });
});
