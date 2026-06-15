/**
 * FeatureDefinitionPanel Component Tests
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 4: Create FeatureDefinitionPanel Component
 *
 * Spec 2026-01-23: Questions System v1 - Updated with new required props
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 2: Combined "Initial Description & Context" Section
 * - Updated tests to use new combined section title "Initial Description & Context"
 * - Description section is no longer a standalone section
 *
 * Tests for:
 * - Component renders FeatureHeader with work item title
 * - Component renders combined section with workItemDescription
 * - Component renders Product Manager Understanding from plannerResponse.featureUnderstanding
 * - Component renders Scope sections (in/out) as bullet lists
 * - Component renders Acceptance Criteria as numbered list
 * - Component handles missing/null plannerResponse gracefully (shows empty states)
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

describe('Task Group 4: FeatureDefinitionPanel Component', () => {
  const mockPlannerResponse: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Here is my understanding of the feature.',
    featureUnderstanding: 'This feature enables users to authenticate via OAuth2.',
    scope: {
      in: ['OAuth2 login flow', 'Token refresh', 'Logout functionality'],
      out: ['Social login providers', 'Two-factor authentication'],
    },
    assumptions: ['Users have valid email addresses', 'OAuth provider is available'],
    acceptanceCriteria: [
      'User can log in with OAuth2',
      'Token refreshes automatically',
      'User can log out successfully',
    ],
    openQuestions: [{ id: 'q1', question: 'Which OAuth provider?' }],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };

  // Default props for questions system (Spec 2026-01-23)
  const defaultQuestionProps = {
    answers: {},
    onAnswerChange: () => {},
    onSubmitAnswers: () => {},
  };

  describe('Test 4.1: Component renders FeatureHeader with work item title', () => {
    it('should render the FeatureHeader with workItemTitle', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="User Authentication"
          workItemDescription="Add OAuth2 authentication"
          plannerResponse={null}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Feature:')).toBeInTheDocument();
      expect(screen.getByText('User Authentication')).toBeInTheDocument();
    });

    it('should render header with special characters in title', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="API Gateway (v2.0) - Rate Limiting"
          workItemDescription="Implement rate limiting"
          plannerResponse={null}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('API Gateway (v2.0) - Rate Limiting')).toBeInTheDocument();
    });
  });

  describe('Test 4.2: Component renders Description in combined section with workItemDescription', () => {
    it('should always render combined section with workItemDescription', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="This is the original work item description that should always be visible."
          plannerResponse={null}
          {...defaultQuestionProps}
        />
      );

      // Spec 2026-01-25: Description is now in combined "Initial Description & Context" section
      expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
      expect(
        screen.getByText('This is the original work item description that should always be visible.')
      ).toBeInTheDocument();
    });

    it('should show Description in combined section regardless of plannerResponse', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Original description"
          plannerResponse={mockPlannerResponse}
          {...defaultQuestionProps}
        />
      );

      // Spec 2026-01-25: Description is now in combined "Initial Description & Context" section
      expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
      expect(screen.getByText('Original description')).toBeInTheDocument();
    });
  });

  describe('Test 4.3: Component renders Product Manager Understanding from plannerResponse', () => {
    it('should render Product Manager Understanding when plannerResponse has featureUnderstanding', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Auth Feature"
          workItemDescription="Description"
          plannerResponse={mockPlannerResponse}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Product Manager Understanding')).toBeInTheDocument();
      expect(
        screen.getByText('This feature enables users to authenticate via OAuth2.')
      ).toBeInTheDocument();
    });

    it('should show empty state when featureUnderstanding is empty', () => {
      const emptyUnderstanding: PlannerResponse = {
        ...mockPlannerResponse,
        featureUnderstanding: '',
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={emptyUnderstanding}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Product Manager Understanding')).toBeInTheDocument();
      expect(screen.getByText(/Waiting for Product Manager understanding/i)).toBeInTheDocument();
    });

    it('should show empty state when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={null}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Product Manager Understanding')).toBeInTheDocument();
      expect(screen.getByText(/Waiting for Product Manager understanding/i)).toBeInTheDocument();
    });
  });

  describe('Test 4.4: Component renders Scope sections as bullet lists', () => {
    it('should render Scope section with in-scope items as bullet list', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={mockPlannerResponse}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Scope')).toBeInTheDocument();
      expect(screen.getByText('OAuth2 login flow')).toBeInTheDocument();
      expect(screen.getByText('Token refresh')).toBeInTheDocument();
      expect(screen.getByText('Logout functionality')).toBeInTheDocument();
    });

    it('should render Out of Scope section with out-of-scope items', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={mockPlannerResponse}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Out of Scope')).toBeInTheDocument();
      expect(screen.getByText('Social login providers')).toBeInTheDocument();
      expect(screen.getByText('Two-factor authentication')).toBeInTheDocument();
    });

    it('shows the combined Scope card with "None defined" when scope.in is empty', () => {
      // The Scope section is now a single two-column card rendered whenever
      // EITHER list has content; the empty column shows "None defined".
      const emptyInScope: PlannerResponse = {
        ...mockPlannerResponse,
        scope: { in: [], out: ['Something'] },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={emptyInScope}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Scope')).toBeInTheDocument();
      expect(screen.getByText('In Scope')).toBeInTheDocument();
      expect(screen.getByText('None defined')).toBeInTheDocument();
      expect(screen.getByText('Something')).toBeInTheDocument();
    });

    it('shows the combined Scope card with "None defined" when scope.out is empty', () => {
      const emptyOutScope: PlannerResponse = {
        ...mockPlannerResponse,
        scope: { in: ['Something'], out: [] },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={emptyOutScope}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Out of Scope')).toBeInTheDocument();
      expect(screen.getByText('None defined')).toBeInTheDocument();
    });

    it('hides the Scope card entirely when both scope lists are empty', () => {
      const emptyScope: PlannerResponse = {
        ...mockPlannerResponse,
        scope: { in: [], out: [] },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={emptyScope}
          {...defaultQuestionProps}
        />
      );

      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    });
  });

  describe('Test 4.5: Component renders Acceptance Criteria as numbered list', () => {
    it('should render Acceptance Criteria with numbered items', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={mockPlannerResponse}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Acceptance Criteria')).toBeInTheDocument();
      expect(screen.getByText('User can log in with OAuth2')).toBeInTheDocument();
      expect(screen.getByText('Token refreshes automatically')).toBeInTheDocument();
      expect(screen.getByText('User can log out successfully')).toBeInTheDocument();
    });

    it('should show empty state when acceptanceCriteria is empty', () => {
      const noAC: PlannerResponse = {
        ...mockPlannerResponse,
        acceptanceCriteria: [],
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={noAC}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Acceptance Criteria')).toBeInTheDocument();
      expect(screen.getByText(/No acceptance criteria defined yet/i)).toBeInTheDocument();
    });

    it('should show empty state for Acceptance Criteria when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={null}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Acceptance Criteria')).toBeInTheDocument();
      expect(screen.getByText(/No acceptance criteria defined yet/i)).toBeInTheDocument();
    });
  });

  describe('Test 4.6: Component handles missing/null plannerResponse gracefully', () => {
    it('should render all visible sections with empty states when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="New Feature"
          workItemDescription="This is the description"
          plannerResponse={null}
          {...defaultQuestionProps}
        />
      );

      // Header should render
      expect(screen.getByText('Feature:')).toBeInTheDocument();
      expect(screen.getByText('New Feature')).toBeInTheDocument();

      // Spec 2026-01-25: Combined section should render with description content
      expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
      expect(screen.getByText('This is the description')).toBeInTheDocument();

      // Product Manager Understanding should show empty state
      expect(screen.getByText('Product Manager Understanding')).toBeInTheDocument();
      expect(screen.getByText(/Waiting for Product Manager understanding/i)).toBeInTheDocument();

      // Scope sections should be hidden (empty arrays)
      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
      expect(screen.queryByText('Out of Scope')).not.toBeInTheDocument();

      // Acceptance Criteria should show empty state
      expect(screen.getByText('Acceptance Criteria')).toBeInTheDocument();
      expect(screen.getByText(/No acceptance criteria defined yet/i)).toBeInTheDocument();

      // Assumptions should be hidden (empty array)
      expect(screen.queryByText('Assumptions')).not.toBeInTheDocument();
    });

    it('should render Assumptions section when assumptions array has items', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={mockPlannerResponse}
          {...defaultQuestionProps}
        />
      );

      expect(screen.getByText('Assumptions')).toBeInTheDocument();
      expect(screen.getByText('Users have valid email addresses')).toBeInTheDocument();
      expect(screen.getByText('OAuth provider is available')).toBeInTheDocument();
    });

    it('should hide Assumptions section when assumptions array is empty', () => {
      const noAssumptions: PlannerResponse = {
        ...mockPlannerResponse,
        assumptions: [],
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test"
          workItemDescription="Desc"
          plannerResponse={noAssumptions}
          {...defaultQuestionProps}
        />
      );

      expect(screen.queryByText('Assumptions')).not.toBeInTheDocument();
    });
  });
});
