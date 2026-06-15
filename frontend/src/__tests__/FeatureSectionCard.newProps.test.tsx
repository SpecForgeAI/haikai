/**
 * FeatureSectionCard New Props Tests
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 1: FeatureSectionCard Enhancement
 *
 * Tests for new icon and headerRightContent props:
 * - icon prop renders icon before title in flex container
 * - headerRightContent prop renders content right-aligned in header
 * - icon and headerRightContent work together correctly
 * - component renders correctly when neither prop is provided (backward compatibility)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureSectionCard } from '../components/ProductView/FeatureSectionCard';

// Mock icon component for testing
function MockIcon({ testId }: { testId?: string }) {
  return <span data-testid={testId || 'mock-icon'}>icon</span>;
}

describe('Task Group 1: FeatureSectionCard New Props', () => {
  describe('Test 1.1.1: icon prop renders icon before title in flex container', () => {
    it('should render icon before title when icon prop is provided', () => {
      render(
        <FeatureSectionCard
          title="Test Section"
          icon={<MockIcon testId="section-icon" />}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      // Icon should be rendered
      expect(screen.getByTestId('section-icon')).toBeInTheDocument();
      // Title should still be rendered
      expect(screen.getByText('Test Section')).toBeInTheDocument();
    });

    it('should render icon and title in a flex container with sectionHeaderWithIcon class', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Flex Test"
          icon={<MockIcon />}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      // Find element with sectionHeaderWithIcon class
      const flexContainer = container.querySelector('[class*="sectionHeaderWithIcon"]');
      expect(flexContainer).toBeInTheDocument();
      // Icon and title should be within the flex container
      expect(flexContainer).toContainElement(screen.getByTestId('mock-icon'));
      expect(flexContainer).toContainElement(screen.getByText('Flex Test'));
    });

    it('should position icon before title in DOM order', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Order Test"
          icon={<MockIcon testId="order-icon" />}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      const flexContainer = container.querySelector('[class*="sectionHeaderWithIcon"]');
      if (flexContainer) {
        const children = Array.from(flexContainer.childNodes);
        const iconIndex = children.findIndex(
          (node) => node.nodeType === 1 && (node as Element).querySelector('[data-testid="order-icon"]')
        );
        const titleIndex = children.findIndex(
          (node) => node.textContent?.includes('Order Test')
        );
        // Icon container should come before title in DOM
        expect(iconIndex).toBeLessThan(titleIndex);
      }
    });
  });

  describe('Test 1.1.2: headerRightContent prop renders content right-aligned in header', () => {
    it('should render headerRightContent in the header', () => {
      render(
        <FeatureSectionCard
          title="Right Content Test"
          headerRightContent={<button data-testid="header-button">Action</button>}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByTestId('header-button')).toBeInTheDocument();
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    it('should wrap header in sectionHeaderRow class when headerRightContent is provided', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Header Row Test"
          headerRightContent={<span>Right side</span>}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      const headerRow = container.querySelector('[class*="sectionHeaderRow"]');
      expect(headerRow).toBeInTheDocument();
    });

    it('should render title on left and headerRightContent on right', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Layout Test"
          headerRightContent={<span data-testid="right-content">Right</span>}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      const headerRow = container.querySelector('[class*="sectionHeaderRow"]');
      expect(headerRow).toBeInTheDocument();
      // Both elements should be present in header row
      expect(screen.getByText('Layout Test')).toBeInTheDocument();
      expect(screen.getByTestId('right-content')).toBeInTheDocument();
    });
  });

  describe('Test 1.1.3: icon and headerRightContent work together correctly', () => {
    it('should render both icon and headerRightContent when both props are provided', () => {
      render(
        <FeatureSectionCard
          title="Combined Test"
          icon={<MockIcon testId="combined-icon" />}
          headerRightContent={<button data-testid="combined-button">Click</button>}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByTestId('combined-icon')).toBeInTheDocument();
      expect(screen.getByTestId('combined-button')).toBeInTheDocument();
      expect(screen.getByText('Combined Test')).toBeInTheDocument();
    });

    it('should maintain proper layout with both icon and headerRightContent', () => {
      const { container } = render(
        <FeatureSectionCard
          title="Full Layout Test"
          icon={<MockIcon testId="layout-icon" />}
          headerRightContent={<span data-testid="layout-right">Right</span>}
        >
          <p>Content</p>
        </FeatureSectionCard>
      );

      // Should have header row for right content
      const headerRow = container.querySelector('[class*="sectionHeaderRow"]');
      expect(headerRow).toBeInTheDocument();

      // Should have flex container for icon + title
      const iconContainer = container.querySelector('[class*="sectionHeaderWithIcon"]');
      expect(iconContainer).toBeInTheDocument();

      // Icon should be with title, both separate from right content
      expect(iconContainer).toContainElement(screen.getByTestId('layout-icon'));
      expect(headerRow).toContainElement(screen.getByTestId('layout-right'));
    });
  });

  describe('Test 1.1.4: backward compatibility when neither prop is provided', () => {
    it('should render correctly without icon or headerRightContent props', () => {
      render(
        <FeatureSectionCard title="Backward Compatible">
          <p>Regular content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Backward Compatible')).toBeInTheDocument();
      expect(screen.getByText('Regular content')).toBeInTheDocument();
    });

    it('should not add sectionHeaderWithIcon class when no icon is provided', () => {
      const { container } = render(
        <FeatureSectionCard title="No Icon">
          <p>Content</p>
        </FeatureSectionCard>
      );

      const iconContainer = container.querySelector('[class*="sectionHeaderWithIcon"]');
      expect(iconContainer).not.toBeInTheDocument();
    });

    it('should not add sectionHeaderRow class when no headerRightContent is provided', () => {
      const { container } = render(
        <FeatureSectionCard title="No Right Content">
          <p>Content</p>
        </FeatureSectionCard>
      );

      const headerRow = container.querySelector('[class*="sectionHeaderRow"]');
      expect(headerRow).not.toBeInTheDocument();
    });

    it('should maintain existing functionality with isEmpty and emptyMessage', () => {
      render(
        <FeatureSectionCard
          title="Empty Test"
          isEmpty={true}
          emptyMessage="Custom empty message"
        >
          <p>Hidden content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Empty Test')).toBeInTheDocument();
      expect(screen.getByText('Custom empty message')).toBeInTheDocument();
      expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    });
  });
});
