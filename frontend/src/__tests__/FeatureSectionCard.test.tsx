/**
 * FeatureSectionCard Component Tests
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 2: Create FeatureSectionCard Component
 *
 * Tests for:
 * - Component renders title and children correctly
 * - Component shows empty state when isEmpty=true
 * - Component displays custom emptyMessage when provided
 * - Component renders with correct styling classes
 * - Component handles missing/undefined children gracefully
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureSectionCard } from '../components/ProductView/FeatureSectionCard';

describe('Task Group 2: FeatureSectionCard Component', () => {
  describe('Test 2.1: Component renders title and children correctly', () => {
    it('should render the title in the header', () => {
      render(
        <FeatureSectionCard title="Test Section">
          <p>Test content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Test Section')).toBeInTheDocument();
    });

    it('should render children content', () => {
      render(
        <FeatureSectionCard title="My Section">
          <p>This is the content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('This is the content')).toBeInTheDocument();
    });

    it('should render multiple children elements', () => {
      render(
        <FeatureSectionCard title="Multi Content">
          <p>First paragraph</p>
          <p>Second paragraph</p>
          <ul>
            <li>List item</li>
          </ul>
        </FeatureSectionCard>
      );

      expect(screen.getByText('First paragraph')).toBeInTheDocument();
      expect(screen.getByText('Second paragraph')).toBeInTheDocument();
      expect(screen.getByText('List item')).toBeInTheDocument();
    });
  });

  describe('Test 2.2: Component shows empty state when isEmpty=true', () => {
    it('should show default empty message when isEmpty is true and no custom message', () => {
      render(
        <FeatureSectionCard title="Empty Section" isEmpty={true}>
          <p>This should not be visible</p>
        </FeatureSectionCard>
      );

      // Default empty message should be shown
      expect(screen.getByText(/No content available/i)).toBeInTheDocument();
      // Children should not be rendered
      expect(screen.queryByText('This should not be visible')).not.toBeInTheDocument();
    });

    it('should render children when isEmpty is false', () => {
      render(
        <FeatureSectionCard title="Non-Empty Section" isEmpty={false}>
          <p>Visible content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Visible content')).toBeInTheDocument();
    });

    it('should render children when isEmpty is undefined', () => {
      render(
        <FeatureSectionCard title="Default Section">
          <p>Default visible</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Default visible')).toBeInTheDocument();
    });
  });

  describe('Test 2.3: Component displays custom emptyMessage when provided', () => {
    it('should display custom empty message when isEmpty=true and emptyMessage provided', () => {
      render(
        <FeatureSectionCard
          title="Custom Empty"
          isEmpty={true}
          emptyMessage="Waiting for data to be loaded..."
        >
          <p>Hidden content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Waiting for data to be loaded...')).toBeInTheDocument();
      expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
    });

    it('should ignore emptyMessage when isEmpty is false', () => {
      render(
        <FeatureSectionCard
          title="With Content"
          isEmpty={false}
          emptyMessage="This should not appear"
        >
          <p>Actual content</p>
        </FeatureSectionCard>
      );

      expect(screen.getByText('Actual content')).toBeInTheDocument();
      expect(screen.queryByText('This should not appear')).not.toBeInTheDocument();
    });
  });

  describe('Test 2.4: Component renders with correct styling classes', () => {
    it('should have card container class', () => {
      const { container } = render(
        <FeatureSectionCard title="Styled Section">
          <p>Content</p>
        </FeatureSectionCard>
      );

      const card = container.firstChild as HTMLElement;
      expect(card.className).toMatch(/card/);
    });

    it('should have section header class on title', () => {
      render(
        <FeatureSectionCard title="Header Test">
          <p>Content</p>
        </FeatureSectionCard>
      );

      const header = screen.getByText('Header Test');
      expect(header.className).toMatch(/sectionHeader/);
    });

    it('should apply empty state styling when isEmpty=true', () => {
      render(
        <FeatureSectionCard title="Empty Styled" isEmpty={true}>
          <p>Hidden</p>
        </FeatureSectionCard>
      );

      const emptyState = screen.getByText(/No content available/i);
      expect(emptyState.className).toMatch(/emptyState/);
    });
  });

  describe('Test 2.5: Component handles missing/undefined children gracefully', () => {
    it('should render without children (null case)', () => {
      render(
        <FeatureSectionCard title="No Children">
          {null}
        </FeatureSectionCard>
      );

      expect(screen.getByText('No Children')).toBeInTheDocument();
    });

    it('should render without children (undefined case)', () => {
      render(
        <FeatureSectionCard title="Undefined Children">
          {undefined}
        </FeatureSectionCard>
      );

      expect(screen.getByText('Undefined Children')).toBeInTheDocument();
    });

    it('should render with empty string children', () => {
      render(
        <FeatureSectionCard title="Empty String">
          {''}
        </FeatureSectionCard>
      );

      expect(screen.getByText('Empty String')).toBeInTheDocument();
    });
  });
});
