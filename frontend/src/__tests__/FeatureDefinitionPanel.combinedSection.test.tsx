/**
 * FeatureDefinitionPanel Combined Section Tests
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 2: Combined "Initial Description & Context" Section
 *
 * Tests for:
 * - Section renders with title "Initial Description & Context" and SquareUserRound icon
 * - "+ Add context" button appears in header via headerRightContent
 * - Description content renders before Context content (with line break separation)
 * - Section has distinct styling (background tint + left border accent)
 * - Context chips and empty state render correctly within combined section
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import React from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse } from '../api/chatApi';
import type { ContextState } from '../utils/contextStorage';

describe('Task Group 2: Combined Initial Description & Context Section', () => {
  // Mock planner response for tests
  const mockPlannerResponse: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Test message',
    featureUnderstanding: 'Test understanding',
    scope: { in: [], out: [] },
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };

  // Default props required by FeatureDefinitionPanel
  const defaultProps = {
    workItemTitle: 'Test Feature',
    workItemDescription: 'This is the feature description.',
    plannerResponse: mockPlannerResponse,
    answers: {},
    onAnswerChange: vi.fn(),
    onSubmitAnswers: vi.fn(),
    activeIncrementId: null,
    onIncrementSelect: vi.fn(),
  };

  // Mock context state with entities
  const mockContextState: ContextState = {
    entity_refs: [
      { entity_id: 'e1', entity_type: 'applications', label: 'Test App' },
    ],
    diagram_refs: [
      { diagram_id: 'd1', label: 'Architecture Diagram' },
    ],
    relationship_refs: [],
  };

  describe('Test 2.1.1: Section renders with title "Initial Description & Context" and SquareUserRound icon', () => {
    it('should render section with combined title "Initial Description & Context"', () => {
      render(<FeatureDefinitionPanel {...defaultProps} />);

      expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
    });

    it('should render SquareUserRound icon before the title', () => {
      const { container } = render(<FeatureDefinitionPanel {...defaultProps} />);

      // Find the section header with icon
      const sectionWithIcon = container.querySelector('[class*="sectionHeaderWithIcon"]');
      expect(sectionWithIcon).toBeInTheDocument();

      // Icon should be rendered (lucide-react SVG with SquareUserRound)
      const iconContainer = container.querySelector('[class*="sectionIcon"]');
      expect(iconContainer).toBeInTheDocument();

      // SVG icon should exist within the icon container
      if (iconContainer) {
        const svg = iconContainer.querySelector('svg');
        expect(svg).toBeInTheDocument();
      }
    });

    it('should not render separate "Description" or "Context" section headers', () => {
      render(<FeatureDefinitionPanel {...defaultProps} />);

      // Should not have standalone "Description" header
      const descriptionHeaders = screen.queryAllByText('Description');
      expect(descriptionHeaders.length).toBe(0);

      // Should not have standalone "Context" header
      const contextSection = screen.queryByTestId('context-section');
      expect(contextSection).not.toBeInTheDocument();
    });
  });

  describe('Test 2.1.2: "+ Add context" button appears in header via headerRightContent', () => {
    it('should render "+ Add context" button in the section header', () => {
      const onAddContext = vi.fn();
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          onAddContext={onAddContext}
        />
      );

      const addButton = screen.getByTestId('add-context-button');
      expect(addButton).toBeInTheDocument();
      expect(addButton).toHaveTextContent('+ Add context');
    });

    it('should position button on the right side of the header row', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          onAddContext={vi.fn()}
        />
      );

      // Button should be in the headerRightContent container
      const headerRightContent = container.querySelector('[class*="headerRightContent"]');
      expect(headerRightContent).toBeInTheDocument();

      if (headerRightContent) {
        const button = within(headerRightContent as HTMLElement).getByTestId('add-context-button');
        expect(button).toBeInTheDocument();
      }
    });

    it('should disable button when contextLoading is true', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          onAddContext={vi.fn()}
          contextLoading={true}
        />
      );

      const addButton = screen.getByTestId('add-context-button');
      expect(addButton).toBeDisabled();
    });
  });

  describe('Test 2.1.3: Description content renders before Context content (with line break separation)', () => {
    it('should render description text followed by context chips in order', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextState={mockContextState}
          onAddContext={vi.fn()}
        />
      );

      // Description text should be present
      expect(screen.getByText('This is the feature description.')).toBeInTheDocument();

      // Context chips should be present
      expect(screen.getByTestId('entity-chip-e1')).toBeInTheDocument();
      expect(screen.getByTestId('diagram-chip-d1')).toBeInTheDocument();
    });

    it('should have a separator element between description and context', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextState={mockContextState}
          onAddContext={vi.fn()}
        />
      );

      // Look for the separator class
      const separator = container.querySelector('[class*="descriptionContextSeparator"]');
      expect(separator).toBeInTheDocument();
    });

    it('should render description before context in DOM order', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextState={mockContextState}
          onAddContext={vi.fn()}
        />
      );

      // Find the top section card
      const topSection = container.querySelector('[class*="topSectionCard"]');
      expect(topSection).toBeInTheDocument();

      if (topSection) {
        // Get all child elements of the card content
        const cardContent = topSection.querySelectorAll('p, div[class*="chipContainer"], div[class*="descriptionContextSeparator"]');

        // Find the description paragraph and chip container
        let descriptionFound = false;
        let separatorFound = false;
        let chipsFound = false;

        cardContent.forEach((el) => {
          if (el.tagName === 'P' && el.textContent?.includes('This is the feature description')) {
            descriptionFound = true;
            // Separator and chips should not have been found yet
            expect(separatorFound).toBe(false);
            expect(chipsFound).toBe(false);
          }
          if (el.className?.includes('descriptionContextSeparator')) {
            separatorFound = true;
            // Description should have been found already
            expect(descriptionFound).toBe(true);
            // Chips should not have been found yet
            expect(chipsFound).toBe(false);
          }
          if (el.className?.includes('chipContainer')) {
            chipsFound = true;
            // Description and separator should have been found already
            expect(descriptionFound).toBe(true);
            expect(separatorFound).toBe(true);
          }
        });

        // All elements should have been found
        expect(descriptionFound).toBe(true);
        expect(separatorFound).toBe(true);
        expect(chipsFound).toBe(true);
      }
    });
  });

  describe('Test 2.1.4: Section has distinct styling (background tint + left border accent)', () => {
    it('should apply topSectionCard class to the combined section', () => {
      const { container } = render(<FeatureDefinitionPanel {...defaultProps} />);

      const topSection = container.querySelector('[class*="topSectionCard"]');
      expect(topSection).toBeInTheDocument();
    });

    it('should be the first section in the content area after FeatureHeader', () => {
      const { container } = render(<FeatureDefinitionPanel {...defaultProps} />);

      // Find the panel content area (distinct from card content)
      const panelContent = container.querySelector('[class*="panel"] > [class*="content"]');
      expect(panelContent).toBeInTheDocument();

      if (panelContent) {
        // First card in content should be the topSectionCard
        const firstCard = panelContent.querySelector('[class*="topSectionCard"]');
        expect(firstCard).toBeInTheDocument();

        // Verify it contains the combined title
        const title = firstCard?.querySelector('h3');
        expect(title?.textContent).toContain('Initial Description & Context');
      }
    });

    it('should have topSectionCard class on the card element', () => {
      const { container } = render(<FeatureDefinitionPanel {...defaultProps} />);

      // Check that the combined section has the distinct styling class
      const topSectionCards = container.querySelectorAll('[class*="topSectionCard"]');
      expect(topSectionCards.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Test 2.1.5: Context chips and empty state render correctly within combined section', () => {
    it('should render context chips when contextState has items', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextState={mockContextState}
          onAddContext={vi.fn()}
        />
      );

      // Entity chip should be visible
      expect(screen.getByTestId('entity-chip-e1')).toBeInTheDocument();
      expect(screen.getByText('Test App')).toBeInTheDocument();

      // Diagram chip should be visible
      expect(screen.getByTestId('diagram-chip-d1')).toBeInTheDocument();
      expect(screen.getByText('Architecture Diagram')).toBeInTheDocument();
    });

    it('should render empty context message when no context items', () => {
      const emptyContext: ContextState = {
        entity_refs: [],
        diagram_refs: [],
        relationship_refs: [],
      };

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextState={emptyContext}
          onAddContext={vi.fn()}
        />
      );

      expect(
        screen.getByText(/No context linked yet/i)
      ).toBeInTheDocument();
    });

    it('should show loading state when contextLoading is true', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextLoading={true}
          onAddContext={vi.fn()}
        />
      );

      expect(screen.getByTestId('context-loading')).toBeInTheDocument();
      expect(screen.getByText(/Loading context/i)).toBeInTheDocument();
    });

    it('should call onRemoveEntityChip when chip remove button is clicked', () => {
      const onRemoveEntityChip = vi.fn();

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          contextState={mockContextState}
          onAddContext={vi.fn()}
          onRemoveEntityChip={onRemoveEntityChip}
        />
      );

      const removeButton = screen.getByTestId('remove-entity-e1');
      fireEvent.click(removeButton);

      expect(onRemoveEntityChip).toHaveBeenCalledWith('e1');
    });
  });
});
