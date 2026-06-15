/**
 * FeatureDefinitionPanel Combined Scope Section Tests
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 3: Combined "Scope" Section with 2-Column Layout
 *
 * Tests for:
 * - Section renders with title "Scope" and Bot icon
 * - 2-column grid layout with "In Scope" and "Out of Scope" column titles
 * - Section only renders when scopeIn.length > 0 OR scopeOut.length > 0
 * - Empty column shows "None defined" message when one array is empty but other has content
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse } from '../api/chatApi';

describe('Task Group 3: Combined Scope Section with 2-Column Layout', () => {
  // Default props for questions system and increment selection
  const defaultProps = {
    answers: {},
    onAnswerChange: () => {},
    onSubmitAnswers: () => {},
    activeIncrementId: null,
    onIncrementSelect: () => {},
  };

  const basePlannerResponse: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Test message',
    featureUnderstanding: 'Test understanding',
    scope: {
      in: [],
      out: [],
    },
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };

  describe('Test 3.1.1: Section renders with title "Scope" and Bot icon', () => {
    it('should render combined Scope section with Bot icon when scope has content', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['Feature A', 'Feature B'],
          out: ['Feature C'],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Should render single "Scope" section title
      const scopeSection = screen.getByText('Scope');
      expect(scopeSection).toBeInTheDocument();

      // Should NOT render separate "Out of Scope" section title
      // (out of scope content should be within the combined section)
      const outOfScopeHeaders = screen.queryAllByRole('heading', { name: 'Out of Scope' });
      expect(outOfScopeHeaders.length).toBe(0);

      // Bot icon should be rendered (lucide-react renders as svg)
      // The icon is within the section header, so we check for svg element
      const scopeCard = scopeSection.closest('[class*="card"]');
      expect(scopeCard).toBeInTheDocument();
      const svgIcon = scopeCard?.querySelector('svg');
      expect(svgIcon).toBeInTheDocument();
    });
  });

  describe('Test 3.1.2: 2-column grid layout with "In Scope" and "Out of Scope" column titles', () => {
    it('should render 2-column layout with both column titles', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['OAuth2 login flow', 'Token refresh'],
          out: ['Social login', 'Two-factor auth'],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Should have "In Scope" column title
      expect(screen.getByText('In Scope')).toBeInTheDocument();

      // Should have "Out of Scope" column title
      expect(screen.getByText('Out of Scope')).toBeInTheDocument();

      // Should render in-scope items
      expect(screen.getByText('OAuth2 login flow')).toBeInTheDocument();
      expect(screen.getByText('Token refresh')).toBeInTheDocument();

      // Should render out-of-scope items
      expect(screen.getByText('Social login')).toBeInTheDocument();
      expect(screen.getByText('Two-factor auth')).toBeInTheDocument();
    });

    it('should render column titles with underline styling (border-bottom class)', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['Feature A'],
          out: ['Feature B'],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      const inScopeTitle = screen.getByText('In Scope');
      const outOfScopeTitle = screen.getByText('Out of Scope');

      // Column titles should have scopeColumnTitle class for border-bottom styling
      expect(inScopeTitle.className).toMatch(/scopeColumnTitle/);
      expect(outOfScopeTitle.className).toMatch(/scopeColumnTitle/);
    });
  });

  describe('Test 3.1.3: Section only renders when scopeIn.length > 0 OR scopeOut.length > 0', () => {
    it('should NOT render Scope section when both scopeIn and scopeOut are empty', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: [],
          out: [],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Section should not be rendered
      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
      expect(screen.queryByText('In Scope')).not.toBeInTheDocument();
      expect(screen.queryByText('Out of Scope')).not.toBeInTheDocument();
    });

    it('should render Scope section when only scopeIn has content', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['Feature A', 'Feature B'],
          out: [],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Section should be rendered
      expect(screen.getByText('Scope')).toBeInTheDocument();
      expect(screen.getByText('In Scope')).toBeInTheDocument();
      expect(screen.getByText('Feature A')).toBeInTheDocument();
      expect(screen.getByText('Feature B')).toBeInTheDocument();
    });

    it('should render Scope section when only scopeOut has content', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: [],
          out: ['Excluded Feature'],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Section should be rendered
      expect(screen.getByText('Scope')).toBeInTheDocument();
      expect(screen.getByText('Out of Scope')).toBeInTheDocument();
      expect(screen.getByText('Excluded Feature')).toBeInTheDocument();
    });

    it('should NOT render Scope section when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={null}
          {...defaultProps}
        />
      );

      // Section should not be rendered
      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    });
  });

  describe('Test 3.1.4: Empty column shows "None defined" message when one array is empty but other has content', () => {
    it('should show "None defined" for Out of Scope when scopeOut is empty but scopeIn has content', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['Feature A', 'Feature B'],
          out: [],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // In Scope should have content
      expect(screen.getByText('Feature A')).toBeInTheDocument();
      expect(screen.getByText('Feature B')).toBeInTheDocument();

      // Out of Scope should show "None defined"
      expect(screen.getByText('None defined')).toBeInTheDocument();
    });

    it('should show "None defined" for In Scope when scopeIn is empty but scopeOut has content', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: [],
          out: ['Excluded Feature A', 'Excluded Feature B'],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Out of Scope should have content
      expect(screen.getByText('Excluded Feature A')).toBeInTheDocument();
      expect(screen.getByText('Excluded Feature B')).toBeInTheDocument();

      // In Scope should show "None defined"
      expect(screen.getByText('None defined')).toBeInTheDocument();
    });

    it('should apply muted/italic styling to "None defined" message', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['Feature A'],
          out: [],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      const noneDefinedElement = screen.getByText('None defined');
      // Should have scopeNoneDefined class for italic, muted styling
      expect(noneDefinedElement.className).toMatch(/scopeNoneDefined/);
    });

    it('should NOT show "None defined" when both columns have content', () => {
      const plannerResponse: PlannerResponse = {
        ...basePlannerResponse,
        scope: {
          in: ['Feature A'],
          out: ['Excluded Feature'],
        },
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          {...defaultProps}
        />
      );

      // Neither column should show "None defined"
      expect(screen.queryByText('None defined')).not.toBeInTheDocument();
    });
  });
});
