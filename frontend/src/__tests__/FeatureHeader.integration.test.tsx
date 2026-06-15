/**
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 5: FeatureHeader Integration Tests
 *
 * Tests for plannerReadyForSpec wiring:
 * - FeatureDefinitionPanel receives isReadyForSpec from plannerResponse.plannerReadyForSpec
 * - Badge appears when plannerResponse.plannerReadyForSpec is true
 * - Badge hidden when plannerResponse is null
 * - Badge hidden when plannerResponse.plannerReadyForSpec is false
 *
 * Updated: PlannerResponse schema changed (v1.1):
 * - readyForSpec -> plannerReadyForSpec
 * - featureTitle removed (always uses workItemTitle prop)
 * - summary -> featureUnderstanding
 * - inScope/outOfScope -> scope.in/scope.out
 * - FeatureDefinitionPanel now requires activeIncrementId and onIncrementSelect
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse } from '../api/chatApi';

describe('Spec 2026-01-23: FeatureHeader Integration with plannerReadyForSpec', () => {
  const defaultProps = {
    workItemTitle: 'Test Feature',
    workItemDescription: 'A test description',
    answers: {},
    onAnswerChange: vi.fn(),
    onSubmitAnswers: vi.fn(),
    activeIncrementId: null as string | null,
    onIncrementSelect: vi.fn(),
  };

  function createPlannerResponse(
    overrides: Partial<PlannerResponse> = {}
  ): PlannerResponse {
    return {
      schemaVersion: '1.1',
      message: 'Test message',
      featureUnderstanding: 'Test understanding',
      scope: { in: [], out: [] },
      assumptions: [],
      acceptanceCriteria: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
      ...overrides,
    };
  }

  describe('FeatureDefinitionPanel passes isReadyForSpec to FeatureHeader', () => {
    it('should NOT show "Ready for Spec" badge when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      const badge = screen.queryByTestId('ready-for-spec-badge');
      expect(badge).not.toBeInTheDocument();
    });

    it('should NOT show "Ready for Spec" badge when plannerReadyForSpec is false', () => {
      const plannerResponse = createPlannerResponse({
        plannerReadyForSpec: false,
      });

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={plannerResponse}
        />
      );

      const badge = screen.queryByTestId('ready-for-spec-badge');
      expect(badge).not.toBeInTheDocument();
    });

    it('should show "Ready for Spec" badge when plannerReadyForSpec is true', () => {
      const plannerResponse = createPlannerResponse({
        plannerReadyForSpec: true,
      });

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={plannerResponse}
        />
      );

      const badge = screen.getByTestId('ready-for-spec-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Ready for Spec');
    });
  });

  describe('Feature title display', () => {
    it('should display workItemTitle as feature title', () => {
      const plannerResponse = createPlannerResponse({
        plannerReadyForSpec: true,
      });

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          workItemTitle="My Feature Title"
          plannerResponse={plannerResponse}
        />
      );

      // Should show the workItemTitle
      expect(screen.getByText('My Feature Title')).toBeInTheDocument();
      // Badge should also be present
      expect(screen.getByTestId('ready-for-spec-badge')).toBeInTheDocument();
    });

    it('should display workItemTitle when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          workItemTitle="Fallback Work Item Title"
          plannerResponse={null}
        />
      );

      // Should show workItemTitle
      expect(screen.getByText('Fallback Work Item Title')).toBeInTheDocument();
    });
  });
});
