/**
 * FeatureDefinitionPanel Section Ordering and Icon Tests
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * (Updated for the three-zone redesign: the panel now renders
 *  Zone 1 = collapsible Implementation Plan,
 *  Zone 2 = collapsible "Clarifying Questions" (PO Open Questions / SA / TE),
 *  Zone 3 = "Work Item Details" with Description+Context, PM Understanding,
 *           Scope, Acceptance Criteria, [Test Plan], Assumptions.)
 *
 * Tests for:
 * - Zones render in the correct order (Plan, Questions, Work Item Details)
 * - Zone 3 cards render in the specified order
 * - Bot icon appears on PM Understanding, Scope, Acceptance Criteria, Assumptions
 * - Open Questions header has dual icons (Bot & SquareUserRound) with muted ampersand
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse } from '../api/chatApi';

// Mock ProductUiStateContext
vi.mock('../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useProductUiState: () => ({
    getImplementChatState: vi.fn(() => null),
    setImplementChatState: vi.fn(),
    getLastImplementWorkItemId: vi.fn(() => null),
    setLastImplementWorkItemId: vi.fn(),
    getExpandedIds: vi.fn(() => new Set()),
    setExpandedIds: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
  deriveProjectKey: (id: string) => id,
}));

describe('Task Group 4: Section Reordering and Icon Application (three-zone layout)', () => {
  // Default props required by FeatureDefinitionPanel
  const defaultProps = {
    workItemTitle: 'Test Feature',
    workItemDescription: 'This is the feature description.',
    answers: {},
    onAnswerChange: vi.fn(),
    onSubmitAnswers: vi.fn(),
    activeIncrementId: null,
    onIncrementSelect: vi.fn(),
  };

  // Full planner response with all sections populated
  const fullPlannerResponse: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Test message',
    featureUnderstanding: 'The system should allow users to authenticate.',
    scope: {
      in: ['OAuth2 login flow', 'Token refresh'],
      out: ['Social login'],
    },
    assumptions: ['User has valid credentials', 'Backend supports OAuth2'],
    acceptanceCriteria: ['User can login successfully', 'Token refreshes automatically'],
    openQuestions: [
      { id: 'q1', question: 'What timeout should we use?', source: 'Product Owner', incrementId: null },
    ],
    plannerReadyForSpec: true,
    implementationPlan: {
      increments: [
        {
          id: 'inc-1',
          title: 'Increment 1',
          description: 'First increment',
          tasks: [{ description: 'Task 1', estimatedHours: 4 }],
        },
      ],
      totalEstimatedHours: 4,
    },
  };

  /** Collect the h3 titles of the Zone 3 (Work Item Details) cards in order. */
  function getZone3CardTitles(container: HTMLElement): string[] {
    const contentArea = container.querySelector('[data-testid="feature-definition-content"]');
    if (!contentArea) return [];
    const titles: string[] = [];
    contentArea.querySelectorAll('[class*="card"]').forEach((card) => {
      const header = card.querySelector('h3');
      if (header) titles.push(header.textContent?.trim() || '');
    });
    return titles;
  }

  describe('Test 4.1.1: Zones and Zone 3 cards render in correct order', () => {
    it('renders the three zones in order: Implementation Plan, Clarifying Questions, Work Item Details', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const panel = container.firstElementChild!;
      const children = Array.from(panel.children);

      const planIndex = children.findIndex(
        (el) => el.getAttribute('data-testid') === 'implementation-plan-section' ||
          el.querySelector('[data-testid="implementation-plan-section"]')
      );
      const questionsIndex = children.findIndex(
        (el) => el.getAttribute('data-testid') === 'questions-zone'
      );
      const detailsHeaderIndex = children.findIndex(
        (el) => el.getAttribute('data-testid') === 'work-item-details-header'
      );

      expect(planIndex).toBeGreaterThanOrEqual(0);
      expect(questionsIndex).toBeGreaterThan(planIndex);
      expect(detailsHeaderIndex).toBeGreaterThan(questionsIndex);
    });

    it('renders Zone 3 cards in order: Description+Context, PM Understanding, Scope, Acceptance Criteria, Assumptions', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const sectionTitles = getZone3CardTitles(container);

      const expectedOrder = [
        'Initial Description & Context',
        'Product Manager Understanding',
        'Scope',
        'Acceptance Criteria',
        'Assumptions',
      ];

      expect(sectionTitles).toEqual(expectedOrder);
    });

    it('should render Description+Context first, followed by Product Manager Understanding second', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const contentArea = container.querySelector('[data-testid="feature-definition-content"]')!;
      const cards = contentArea.querySelectorAll('[class*="card"]');

      // First card should be topSectionCard with Initial Description & Context
      const firstCard = cards[0];
      expect(firstCard.className).toMatch(/topSectionCard/);
      expect(firstCard.textContent).toContain('Initial Description & Context');

      // Second card should be Product Manager Understanding
      const secondCard = cards[1];
      expect(secondCard.textContent).toContain('Product Manager Understanding');
    });

    it('should render Scope after Product Manager Understanding', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const contentArea = container.querySelector('[data-testid="feature-definition-content"]')!;
      const cards = contentArea.querySelectorAll('[class*="card"]');

      // Third card should be Scope
      const thirdCard = cards[2];
      expect(thirdCard.textContent).toContain('Scope');
      expect(thirdCard.textContent).toContain('In Scope');
      expect(thirdCard.textContent).toContain('Out of Scope');
    });
  });

  describe('Test 4.1.2: Bot icon appears on PM Understanding, Scope, Acceptance Criteria, and Assumptions sections', () => {
    function expectCardWithBotIcon(container: HTMLElement, cardIndex: number, title: string) {
      const contentArea = container.querySelector('[data-testid="feature-definition-content"]')!;
      const cards = contentArea.querySelectorAll('[class*="card"]');
      const card = cards[cardIndex];
      expect(card.textContent).toContain(title);

      const iconContainer = card.querySelector('[class*="sectionIcon"]');
      expect(iconContainer).toBeInTheDocument();

      const svg = iconContainer?.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }

    it('should render Bot icon on Product Manager Understanding section', () => {
      const { container } = render(
        <FeatureDefinitionPanel {...defaultProps} plannerResponse={fullPlannerResponse} />
      );
      expectCardWithBotIcon(container, 1, 'Product Manager Understanding');
    });

    it('should render Bot icon on Acceptance Criteria section', () => {
      const { container } = render(
        <FeatureDefinitionPanel {...defaultProps} plannerResponse={fullPlannerResponse} />
      );
      expectCardWithBotIcon(container, 3, 'Acceptance Criteria');
    });

    it('should render Bot icon on Assumptions section', () => {
      const { container } = render(
        <FeatureDefinitionPanel {...defaultProps} plannerResponse={fullPlannerResponse} />
      );
      expectCardWithBotIcon(container, 4, 'Assumptions');
    });

    it('should render Bot icon on Scope section (already implemented)', () => {
      const { container } = render(
        <FeatureDefinitionPanel {...defaultProps} plannerResponse={fullPlannerResponse} />
      );
      expectCardWithBotIcon(container, 2, 'Scope');
    });
  });

  describe('Test 4.1.3: Open Questions header has dual icons (Bot & SquareUserRound) with muted ampersand', () => {
    // The PO Open Questions card now lives inside the collapsible Clarifying
    // Questions zone (Zone 2), which auto-expands when questions exist.
    it('should render Open Questions section with custom dual-icon header inside the questions zone', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const questionsZoneBody = container.querySelector('[data-testid="questions-zone-body"]');
      expect(questionsZoneBody).toBeInTheDocument();

      const dualIconHeader = questionsZoneBody!.querySelector('[class*="openQuestionsHeader"]');
      expect(dualIconHeader).toBeInTheDocument();
    });

    it('should render both Bot and SquareUserRound icons in Open Questions header', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const dualIconHeader = container.querySelector('[class*="openQuestionsHeader"]');
      expect(dualIconHeader).toBeInTheDocument();

      const svgIcons = dualIconHeader?.querySelectorAll('svg');
      expect(svgIcons?.length).toBe(2);
    });

    it('should render ampersand between the two icons with muted styling', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const ampersand = container.querySelector('[class*="ampersand"]');
      expect(ampersand).toBeInTheDocument();
      expect(ampersand?.textContent).toBe('&');
    });

    it('should render "Open Questions" text after the dual icons', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const headerText = container.querySelector('[class*="openQuestionsHeader"]');
      expect(headerText?.textContent).toContain('Open Questions');
    });
  });

  describe('Test 4.1.4: Implementation Plan zone renders first (above questions)', () => {
    it('should render the Implementation Plan section', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const implPlanSection = screen.getByTestId('implementation-plan-section');
      expect(implPlanSection).toBeInTheDocument();
      expect(implPlanSection.textContent).toContain('Implementation Plan');
    });

    it('should render the Clarifying Questions zone after the Implementation Plan zone', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const panel = container.firstElementChild!;
      const children = Array.from(panel.children);
      const planIndex = children.findIndex(
        (el) => el.getAttribute('data-testid') === 'implementation-plan-section' ||
          el.querySelector('[data-testid="implementation-plan-section"]')
      );
      const questionsIndex = children.findIndex(
        (el) => el.getAttribute('data-testid') === 'questions-zone'
      );

      expect(planIndex).toBeGreaterThanOrEqual(0);
      expect(questionsIndex).toBeGreaterThan(planIndex);
    });

    it('should render Assumptions in the Work Item Details zone (after the questions zone)', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      const contentArea = container.querySelector('[data-testid="feature-definition-content"]');
      expect(contentArea).toBeInTheDocument();
      expect(contentArea!.textContent).toContain('Assumptions');
    });

    it('should keep Implementation Plan unchanged when Open Questions is not present', () => {
      const plannerResponseNoQuestions: PlannerResponse = {
        ...fullPlannerResponse,
        openQuestions: [],
      };

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={plannerResponseNoQuestions}
        />
      );

      const implPlanSection = screen.getByTestId('implementation-plan-section');
      expect(implPlanSection).toBeInTheDocument();
      expect(implPlanSection.textContent).toContain('Implementation Plan');
    });
  });
});
