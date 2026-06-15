/**
 * Hub Bootstrap 4: Frontend Gap Analysis Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 7: Test Review and Gap Analysis
 *
 * These tests cover critical frontend gaps identified during the TG7 review of TG1-TG6:
 *
 *  1. TechStackPreviewBubble renders with empty categories array (0 categories, 0 technologies)
 *  2. TechStackPreviewBubble renders with category containing empty technologies (No technologies)
 *  3. TechStackPreviewBubble renders with valid JSON object but non-standard structure (no categories key)
 *  4. TestStrategyPreviewBubble renders with empty test levels array (0 test levels, 0 quality gates)
 *  5. TestStrategyPreviewBubble renders with test level missing optional fields
 *  6. MessageBubble showQuestions correctly excludes both new preview types
 *  7. MessageBubble does NOT render TechStackPreviewBubble when onConfirmArtifact is not provided
 *  8. TASK_ARTIFACT_MAP has exactly 5 entries total (all bootstrap tasks)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TechStackPreviewBubble } from '../components/UnifiedChat/TechStackPreviewBubble';
import { TestStrategyPreviewBubble } from '../components/UnifiedChat/TestStrategyPreviewBubble';
import { MessageBubble } from '../components/UnifiedChat/MessageBubble';
import { TASK_ARTIFACT_MAP } from '../hooks/useChatThread';
import type { ThreadMessage } from '../api/chatV2Api';

// ============================================================================
// Mock CSS modules
// ============================================================================

vi.mock('../components/UnifiedChat/TechStackPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/TestStrategyPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/ArchitecturePreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/MessageBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/RoadmapPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/ArtifactPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/CompletionChip.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/StructuredQuestionsRenderer.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/TaskMenu.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// Mock lucide-react Download icon used by CompletionChip
// Catch-all lucide-react mock: components under test pull an evolving set of
// icons (Download, Users, ...). A Proxy serves any icon name so the mock never
// goes stale; Download keeps its original explicit test id.
vi.mock('lucide-react', () => {
  const Download = (props: Record<string, unknown>) => (
    <svg data-testid="download-icon" {...props} />
  );
  const explicit: Record<string, unknown> = { Download };
  return new Proxy(explicit, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop in target) return target[prop];
      const Icon = (props: Record<string, unknown>) => (
        <svg data-testid={`${prop.toLowerCase()}-icon`} {...props} />
      );
      target[prop] = Icon;
      return Icon;
    },
  });
});

// ============================================================================
// Helpers
// ============================================================================

function createAssistantMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-gap-1',
    role: 'assistant',
    personaId: 'architect',
    taskId: 'architect--define-tech-stack',
    content: '',
    structuredResponse: null,
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// TechStackPreviewBubble Edge Case Tests
// ============================================================================

describe('Hub Bootstrap 4: Frontend Gap Tests', () => {

  // --------------------------------------------------------------------------
  // Gap 1: TechStackPreviewBubble renders with empty categories array
  // --------------------------------------------------------------------------
  it('TechStackPreviewBubble renders with empty categories showing "0 categories, 0 technologies"', () => {
    const emptyTechStack = JSON.stringify({
      categories: [],
      designDecisions: [],
      constraints: [],
    });

    render(
      <TechStackPreviewBubble
        content={emptyTechStack}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Generated Tech Stack')).toBeInTheDocument();
    const countsEl = screen.getByTestId('tech-stack-counts');
    expect(countsEl.textContent).toBe('0 categories, 0 technologies');

    // Summary should still be present but with no category sections
    expect(screen.getByTestId('tech-stack-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('tech-stack-section-category-0')).not.toBeInTheDocument();

    // Toggle and action buttons should still be present
    expect(screen.getByTestId('tech-stack-toggle-json')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 2: TechStackPreviewBubble renders with category containing empty technologies
  // --------------------------------------------------------------------------
  it('TechStackPreviewBubble renders "No technologies" when a category has an empty technologies array', () => {
    const emptyTechCategory = JSON.stringify({
      categories: [
        { name: 'Empty Category', technologies: [] },
      ],
      designDecisions: [],
      constraints: [],
    });

    render(
      <TechStackPreviewBubble
        content={emptyTechCategory}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );

    // Expand the category section
    fireEvent.click(screen.getByTestId('tech-stack-section-header-category-0'));

    // Should show "No technologies" for the expanded empty category
    expect(screen.getByText('No technologies')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 3: TechStackPreviewBubble with valid JSON but non-standard structure
  //        (missing categories key -- parseTechStackContent normalizes to empty arrays)
  // --------------------------------------------------------------------------
  it('TechStackPreviewBubble normalizes missing categories key to empty array without error', () => {
    const nonStandardJson = JSON.stringify({
      foo: 'bar',
      designDecisions: [{ title: 'Decision X', description: 'Something', rationale: 'Why' }],
    });

    render(
      <TechStackPreviewBubble
        content={nonStandardJson}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );

    // Should NOT show error because the parse helper normalizes missing arrays
    expect(screen.queryByTestId('tech-stack-error')).not.toBeInTheDocument();

    // Should show "0 categories, 0 technologies" since categories was normalized to []
    const countsEl = screen.getByTestId('tech-stack-counts');
    expect(countsEl.textContent).toBe('0 categories, 0 technologies');
  });

  // --------------------------------------------------------------------------
  // Gap 4: TestStrategyPreviewBubble renders with empty test levels and quality gates
  // --------------------------------------------------------------------------
  it('TestStrategyPreviewBubble renders with empty arrays showing "0 test levels, 0 quality gates"', () => {
    const emptyStrategy = JSON.stringify({
      testLevels: [],
      qualityGates: [],
      testingPrinciples: [],
    });

    render(
      <TestStrategyPreviewBubble
        content={emptyStrategy}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Generated Test Strategy')).toBeInTheDocument();
    const countsEl = screen.getByTestId('test-strategy-counts');
    expect(countsEl.textContent).toBe('0 test levels, 0 quality gates');

    // Section headers should still be present (they render even with empty arrays)
    expect(screen.getByTestId('test-strategy-section-testLevels')).toBeInTheDocument();
    expect(screen.getByTestId('test-strategy-section-qualityGates')).toBeInTheDocument();
    expect(screen.getByTestId('test-strategy-section-testingPrinciples')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 5: TestStrategyPreviewBubble renders test level with missing optional fields
  // --------------------------------------------------------------------------
  it('TestStrategyPreviewBubble renders test levels with missing optional fields (no tools, no scope)', () => {
    const minimalStrategy = JSON.stringify({
      testLevels: [
        { name: 'Smoke Tests' },  // scope, coverageTarget, tools, rationale all missing
      ],
      qualityGates: [],
      testingPrinciples: [],
    });

    render(
      <TestStrategyPreviewBubble
        content={minimalStrategy}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );

    // Expand testLevels section
    fireEvent.click(screen.getByTestId('test-strategy-section-header-testLevels'));

    // Name should be visible
    expect(screen.getByText('Smoke Tests')).toBeInTheDocument();

    // Optional fields should not cause rendering issues
    expect(screen.getByTestId('test-strategy-section-content-testLevels')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 6: MessageBubble showQuestions correctly excludes both new preview types
  // --------------------------------------------------------------------------
  it('MessageBubble does not render StructuredQuestionsRenderer when structuredResponse is a tech-stack-preview', () => {
    const message = createAssistantMessage({
      content: '',
      structuredResponse: {
        type: 'tech-stack-preview',
        content: JSON.stringify({ categories: [], designDecisions: [], constraints: [] }),
        // Add a questions field that would normally trigger the questions renderer
        questions: ['This should not be shown'],
      },
    });

    render(
      <MessageBubble
        message={message}
        onConfirmArtifact={vi.fn()}
        onRejectArtifact={vi.fn()}
        onSubmitAnswers={vi.fn()}
      />
    );

    // Should show TechStackPreviewBubble, NOT StructuredQuestionsRenderer
    expect(screen.getByTestId('tech-stack-preview-bubble')).toBeInTheDocument();
    expect(screen.queryByTestId('structured-questions')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 7: MessageBubble does NOT render TechStackPreviewBubble when
  //        onConfirmArtifact is not provided
  // --------------------------------------------------------------------------
  it('MessageBubble does NOT render TechStackPreviewBubble when onConfirmArtifact is not provided', () => {
    const message = createAssistantMessage({
      content: 'Some fallback content',
      structuredResponse: {
        type: 'tech-stack-preview',
        content: JSON.stringify({ categories: [], designDecisions: [], constraints: [] }),
      },
    });

    render(
      <MessageBubble
        message={message}
        // Intentionally not providing onConfirmArtifact
      />
    );

    // Should NOT show TechStackPreviewBubble because the rendering branch
    // requires onConfirmArtifact (showTechStackPreview && onConfirmArtifact)
    expect(screen.queryByTestId('tech-stack-preview-bubble')).not.toBeInTheDocument();

    // Should fall through to the regular text content rendering
    expect(screen.getByText('Some fallback content')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 8: TASK_ARTIFACT_MAP has exactly 5 entries total
  // --------------------------------------------------------------------------
  it('TASK_ARTIFACT_MAP covers all original bootstrap tasks', () => {
    const keys = Object.keys(TASK_ARTIFACT_MAP);
    // The registry has grown beyond the original 5 bootstrap entries
    // (data model, user journeys, backlog, OAS spec, ...). Assert membership
    // of the bootstrap set rather than pinning a brittle total.
    expect(keys.length).toBeGreaterThanOrEqual(5);

    // Verify all expected task IDs are present
    expect(keys).toContain('product-manager--define-product');
    expect(keys).toContain('product-manager--roadmap');
    expect(keys).toContain('architect--define-architecture');
    expect(keys).toContain('architect--define-tech-stack');
    expect(keys).toContain('test-engineer--test-strategy');

    // Each entry should have all required fields
    for (const key of keys) {
      const entry = TASK_ARTIFACT_MAP[key];
      expect(entry.artifactId).toBeDefined();
      expect(typeof entry.artifactId).toBe('string');
      expect(entry.artifactName).toBeDefined();
      expect(typeof entry.artifactName).toBe('string');
      expect(entry.artifactKey).toBeDefined();
      expect(typeof entry.artifactKey).toBe('string');
      expect(entry.completionMessage).toBeDefined();
      expect(typeof entry.completionMessage).toBe('string');
      expect(entry.previewType).toBeDefined();
      expect(typeof entry.previewType).toBe('string');
    }
  });
});
