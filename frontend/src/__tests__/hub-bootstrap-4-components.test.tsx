/**
 * Hub Bootstrap 4: TechStackPreviewBubble, TestStrategyPreviewBubble, MessageBubble, and useChatThread Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 5, Task 5.1: Write 16 focused tests for the new components, MessageBubble updates,
 * and hook extension
 *
 * Tests verify:
 * 1. TechStackPreviewBubble renders header with category and technology counts
 * 2. TechStackPreviewBubble renders collapsible category sections with technology rows
 * 3. TechStackPreviewBubble toggles between summary and JSON view
 * 4. TechStackPreviewBubble Confirm/Reject buttons work (Saving... state, disabled state)
 * 5. TechStackPreviewBubble handles malformed JSON gracefully
 * 6. TestStrategyPreviewBubble renders header with test level and quality gate counts
 * 7. TestStrategyPreviewBubble renders collapsible sections for test levels, quality gates, testing principles
 * 8. TestStrategyPreviewBubble toggles between summary and JSON view
 * 9. TestStrategyPreviewBubble Confirm/Reject buttons work (Saving... state, disabled state)
 * 10. TestStrategyPreviewBubble handles malformed JSON gracefully
 * 11. isTechStackPreview type guard returns correct values
 * 12. isTestStrategyPreview type guard returns correct values
 * 13. MessageBubble renders TechStackPreviewBubble for tech-stack-preview type
 * 14. MessageBubble renders TestStrategyPreviewBubble for test-strategy-preview type
 * 15. TASK_ARTIFACT_MAP contains architect--define-tech-stack entry
 * 16. TASK_ARTIFACT_MAP contains test-engineer--test-strategy entry
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TechStackPreviewBubble } from '../components/UnifiedChat/TechStackPreviewBubble';
import { TestStrategyPreviewBubble } from '../components/UnifiedChat/TestStrategyPreviewBubble';
import { MessageBubble } from '../components/UnifiedChat/MessageBubble';
import { isTechStackPreview, isTestStrategyPreview } from '../components/UnifiedChat/MessageBubble';
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
// Test Data
// ============================================================================

const validTechStackJson = JSON.stringify({
  categories: [
    {
      name: 'Frontend',
      technologies: [
        { name: 'React', version: '18.2', purpose: 'UI framework', rationale: 'Component-based architecture' },
        { name: 'TypeScript', version: '5.2', purpose: 'Type safety', rationale: 'Catch errors at compile time' },
      ],
    },
    {
      name: 'Backend',
      technologies: [
        { name: 'Node.js', version: '20 LTS', purpose: 'Server runtime', rationale: 'Full-stack JavaScript' },
        { name: 'Express', version: '4.18', purpose: 'HTTP framework', rationale: 'Widely adopted, mature' },
        { name: 'PostgreSQL', version: '15', purpose: 'Primary database', rationale: 'Relational data model' },
      ],
    },
    {
      name: 'Infrastructure',
      technologies: [
        { name: 'Docker', version: '24', purpose: 'Containerization', rationale: 'Consistent environments' },
      ],
    },
  ],
  designDecisions: [
    { title: 'Monorepo Structure', description: 'Single repository for all services', rationale: 'Simplified dependency management' },
    { title: 'REST over GraphQL', description: 'Use REST APIs for all service communication', rationale: 'Simpler to implement and debug' },
  ],
  constraints: [
    { name: 'Browser Support', description: 'Must support latest Chrome, Firefox, Safari', type: 'technical' },
    { name: 'Budget Limit', description: 'Cloud costs must stay under $500/month', type: 'business' },
  ],
});

const validTestStrategyJson = JSON.stringify({
  testLevels: [
    { name: 'Unit Tests', scope: 'Individual functions and components', coverageTarget: '80%', tools: ['Vitest', 'React Testing Library'], rationale: 'Fast feedback on code correctness' },
    { name: 'Integration Tests', scope: 'API endpoints and service interactions', coverageTarget: '60%', tools: ['Supertest', 'Vitest'], rationale: 'Verify component interactions' },
    { name: 'E2E Tests', scope: 'Critical user flows', coverageTarget: '40%', tools: ['Playwright'], rationale: 'Validate end-to-end user experience' },
  ],
  qualityGates: [
    { name: 'PR Merge Gate', criteria: ['All unit tests pass', 'No lint errors', 'Coverage >= 80%'], enforcement: 'CI pipeline blocks merge on failure' },
    { name: 'Release Gate', criteria: ['All E2E tests pass', 'Performance benchmarks met'], enforcement: 'Manual approval required' },
  ],
  testingPrinciples: [
    { title: 'Test Behavior Not Implementation', description: 'Focus on what the code does, not how it does it' },
    { title: 'Shift Left', description: 'Find defects as early as possible in the development cycle' },
  ],
});

function createAssistantMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-test-1',
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
// TechStackPreviewBubble Tests
// ============================================================================

describe('Hub Bootstrap 4: TechStackPreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 1: Renders header with category and technology counts
  // --------------------------------------------------------------------------
  it('renders header "Generated Tech Stack" with category and technology counts', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TechStackPreviewBubble
        content={validTechStackJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Header should show "Generated Tech Stack"
    expect(screen.getByText('Generated Tech Stack')).toBeInTheDocument();

    // Counts: 3 categories, 6 technologies total (2 + 3 + 1)
    const countsEl = screen.getByTestId('tech-stack-counts');
    expect(countsEl).toBeInTheDocument();
    expect(countsEl.textContent).toBe('3 categories, 6 technologies');
  });

  // --------------------------------------------------------------------------
  // Test 2: Renders collapsible category sections with technology rows
  // --------------------------------------------------------------------------
  it('renders collapsible category sections; clicking a section header toggles expansion showing technology rows', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TechStackPreviewBubble
        content={validTechStackJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // All 3 category section headers should be present
    expect(screen.getByTestId('tech-stack-section-category-0')).toBeInTheDocument();
    expect(screen.getByTestId('tech-stack-section-category-1')).toBeInTheDocument();
    expect(screen.getByTestId('tech-stack-section-category-2')).toBeInTheDocument();

    // Sections should start collapsed
    expect(screen.queryByTestId('tech-stack-section-content-category-0')).not.toBeInTheDocument();

    // Click to expand Frontend category
    fireEvent.click(screen.getByTestId('tech-stack-section-header-category-0'));

    // Now Frontend content should be visible
    expect(screen.getByTestId('tech-stack-section-content-category-0')).toBeInTheDocument();

    // Technology names should be visible
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();

    // Version and purpose should be visible
    expect(screen.getByText(/18\.2/)).toBeInTheDocument();
    expect(screen.getByText(/UI framework/)).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Toggles between summary and JSON view
  // --------------------------------------------------------------------------
  it('toggles between summary and JSON view via "Show JSON"/"Show Summary" button', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TechStackPreviewBubble
        content={validTechStackJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Initially should show summary view
    expect(screen.getByTestId('tech-stack-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('tech-stack-raw-json')).not.toBeInTheDocument();

    // Toggle button should say "Show JSON"
    const toggleButton = screen.getByTestId('tech-stack-toggle-json');
    expect(toggleButton.textContent).toBe('Show JSON');

    // Click toggle to switch to raw JSON view
    fireEvent.click(toggleButton);

    // Now should show raw JSON, not summary
    expect(screen.queryByTestId('tech-stack-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('tech-stack-raw-json')).toBeInTheDocument();

    // Toggle button should now say "Show Summary"
    expect(toggleButton.textContent).toBe('Show Summary');

    // Click toggle again to go back to summary
    fireEvent.click(toggleButton);
    expect(screen.getByTestId('tech-stack-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('tech-stack-raw-json')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Confirm/Reject buttons work (Saving... state, disabled state)
  // --------------------------------------------------------------------------
  it('renders Confirm/Reject buttons; shows "Saving..." when isConfirming; both disabled when disabled || isConfirming', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    const { rerender } = render(
      <TechStackPreviewBubble
        content={validTechStackJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });

    expect(confirmButton).not.toBeDisabled();
    expect(rejectButton).not.toBeDisabled();

    // Click confirm
    fireEvent.click(confirmButton);
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);

    // Click reject
    fireEvent.click(rejectButton);
    expect(mockOnReject).toHaveBeenCalledTimes(1);

    // Re-render with isConfirming=true
    rerender(
      <TechStackPreviewBubble
        content={validTechStackJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={true}
        disabled={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    // Re-render with disabled=true
    rerender(
      <TechStackPreviewBubble
        content={validTechStackJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={true}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Test 5: Handles malformed JSON gracefully
  // --------------------------------------------------------------------------
  it('handles malformed JSON gracefully (shows error state)', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TechStackPreviewBubble
        content="this is not valid JSON {{{{"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Should show error message
    const errorEl = screen.getByTestId('tech-stack-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain('Failed to parse tech stack JSON');

    // Should NOT show summary, toggle, or counts
    expect(screen.queryByTestId('tech-stack-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tech-stack-toggle-json')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tech-stack-counts')).not.toBeInTheDocument();

    // Confirm and Reject buttons should still be present
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

// ============================================================================
// TestStrategyPreviewBubble Tests
// ============================================================================

describe('Hub Bootstrap 4: TestStrategyPreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 6: Renders header with test level and quality gate counts
  // --------------------------------------------------------------------------
  it('renders header "Generated Test Strategy" with test level and quality gate counts', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TestStrategyPreviewBubble
        content={validTestStrategyJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Header should show "Generated Test Strategy"
    expect(screen.getByText('Generated Test Strategy')).toBeInTheDocument();

    // Counts: 3 test levels, 2 quality gates
    const countsEl = screen.getByTestId('test-strategy-counts');
    expect(countsEl).toBeInTheDocument();
    expect(countsEl.textContent).toBe('3 test levels, 2 quality gates');
  });

  // --------------------------------------------------------------------------
  // Test 7: Renders collapsible sections for test levels, quality gates, testing principles
  // --------------------------------------------------------------------------
  it('renders collapsible sections for test levels, quality gates, and testing principles', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TestStrategyPreviewBubble
        content={validTestStrategyJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Section headers should be present
    expect(screen.getByTestId('test-strategy-section-testLevels')).toBeInTheDocument();
    expect(screen.getByTestId('test-strategy-section-qualityGates')).toBeInTheDocument();
    expect(screen.getByTestId('test-strategy-section-testingPrinciples')).toBeInTheDocument();

    // Sections should start collapsed
    expect(screen.queryByTestId('test-strategy-section-content-testLevels')).not.toBeInTheDocument();

    // Click to expand Test Levels
    fireEvent.click(screen.getByTestId('test-strategy-section-header-testLevels'));

    // Now Test Levels content should be visible
    expect(screen.getByTestId('test-strategy-section-content-testLevels')).toBeInTheDocument();

    // Test level details should be visible
    expect(screen.getByText('Unit Tests')).toBeInTheDocument();
    expect(screen.getByText('Integration Tests')).toBeInTheDocument();
    expect(screen.getByText('E2E Tests')).toBeInTheDocument();

    // Scope and coverage details
    expect(screen.getByText(/Individual functions and components/)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 8: Toggles between summary and JSON view
  // --------------------------------------------------------------------------
  it('toggles between summary and JSON view via "Show JSON"/"Show Summary" button', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TestStrategyPreviewBubble
        content={validTestStrategyJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Initially should show summary view
    expect(screen.getByTestId('test-strategy-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('test-strategy-raw-json')).not.toBeInTheDocument();

    // Toggle button should say "Show JSON"
    const toggleButton = screen.getByTestId('test-strategy-toggle-json');
    expect(toggleButton.textContent).toBe('Show JSON');

    // Click toggle
    fireEvent.click(toggleButton);

    // Now should show raw JSON
    expect(screen.queryByTestId('test-strategy-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('test-strategy-raw-json')).toBeInTheDocument();
    expect(toggleButton.textContent).toBe('Show Summary');

    // Click toggle again
    fireEvent.click(toggleButton);
    expect(screen.getByTestId('test-strategy-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('test-strategy-raw-json')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 9: Confirm/Reject buttons work (Saving... state, disabled state)
  // --------------------------------------------------------------------------
  it('renders Confirm/Reject buttons; shows "Saving..." when isConfirming; both disabled when disabled || isConfirming', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    const { rerender } = render(
      <TestStrategyPreviewBubble
        content={validTestStrategyJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });

    expect(confirmButton).not.toBeDisabled();
    expect(rejectButton).not.toBeDisabled();

    fireEvent.click(confirmButton);
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(rejectButton);
    expect(mockOnReject).toHaveBeenCalledTimes(1);

    // Re-render with isConfirming=true
    rerender(
      <TestStrategyPreviewBubble
        content={validTestStrategyJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={true}
        disabled={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    // Re-render with disabled=true
    rerender(
      <TestStrategyPreviewBubble
        content={validTestStrategyJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={true}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Test 10: Handles malformed JSON gracefully
  // --------------------------------------------------------------------------
  it('handles malformed JSON gracefully (shows error state)', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <TestStrategyPreviewBubble
        content="not valid json!!!"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    const errorEl = screen.getByTestId('test-strategy-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain('Failed to parse test strategy JSON');

    expect(screen.queryByTestId('test-strategy-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('test-strategy-toggle-json')).not.toBeInTheDocument();
    expect(screen.queryByTestId('test-strategy-counts')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Hub Bootstrap 4: isTechStackPreview type guard', () => {
  // --------------------------------------------------------------------------
  // Test 11: Returns correct values
  // --------------------------------------------------------------------------
  it('returns true for tech-stack-preview type and false for other types', () => {
    expect(isTechStackPreview({ type: 'tech-stack-preview', content: '{}' })).toBe(true);

    expect(isTechStackPreview({ type: 'test-strategy-preview', content: '{}' })).toBe(false);
    expect(isTechStackPreview({ type: 'architecture-preview', content: '{}' })).toBe(false);
    expect(isTechStackPreview({ type: 'roadmap-preview', content: '{}' })).toBe(false);
    expect(isTechStackPreview({ type: 'artifact-preview', markdownContent: '# Test' })).toBe(false);
    expect(isTechStackPreview(null)).toBe(false);
    expect(isTechStackPreview(undefined)).toBe(false);
    expect(isTechStackPreview('string')).toBe(false);
    expect(isTechStackPreview({ type: 'tech-stack-preview', content: 123 })).toBe(false);
    expect(isTechStackPreview({})).toBe(false);
  });
});

describe('Hub Bootstrap 4: isTestStrategyPreview type guard', () => {
  // --------------------------------------------------------------------------
  // Test 12: Returns correct values
  // --------------------------------------------------------------------------
  it('returns true for test-strategy-preview type and false for other types', () => {
    expect(isTestStrategyPreview({ type: 'test-strategy-preview', content: '{}' })).toBe(true);

    expect(isTestStrategyPreview({ type: 'tech-stack-preview', content: '{}' })).toBe(false);
    expect(isTestStrategyPreview({ type: 'architecture-preview', content: '{}' })).toBe(false);
    expect(isTestStrategyPreview({ type: 'roadmap-preview', content: '{}' })).toBe(false);
    expect(isTestStrategyPreview({ type: 'artifact-preview', markdownContent: '# Test' })).toBe(false);
    expect(isTestStrategyPreview(null)).toBe(false);
    expect(isTestStrategyPreview(undefined)).toBe(false);
    expect(isTestStrategyPreview('string')).toBe(false);
    expect(isTestStrategyPreview({ type: 'test-strategy-preview', content: 123 })).toBe(false);
    expect(isTestStrategyPreview({})).toBe(false);
  });
});

// ============================================================================
// MessageBubble Integration Tests
// ============================================================================

describe('Hub Bootstrap 4: MessageBubble renders TechStackPreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 13: MessageBubble renders TechStackPreviewBubble for tech-stack-preview type
  // --------------------------------------------------------------------------
  it('renders TechStackPreviewBubble when structuredResponse.type === "tech-stack-preview" and onConfirmArtifact is provided', () => {
    const message = createAssistantMessage({
      content: '',
      structuredResponse: {
        type: 'tech-stack-preview',
        content: validTechStackJson,
      },
    });

    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <MessageBubble
        message={message}
        onConfirmArtifact={mockOnConfirm}
        onRejectArtifact={mockOnReject}
      />
    );

    // The TechStackPreviewBubble should be rendered
    expect(screen.getByTestId('tech-stack-preview-bubble')).toBeInTheDocument();

    // Should show the header
    expect(screen.getByText('Generated Tech Stack')).toBeInTheDocument();

    // Should show counts
    expect(screen.getByTestId('tech-stack-counts')).toBeInTheDocument();

    // Should have confirm and reject buttons
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

describe('Hub Bootstrap 4: MessageBubble renders TestStrategyPreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 14: MessageBubble renders TestStrategyPreviewBubble for test-strategy-preview type
  // --------------------------------------------------------------------------
  it('renders TestStrategyPreviewBubble when structuredResponse.type === "test-strategy-preview" and onConfirmArtifact is provided', () => {
    const message = createAssistantMessage({
      personaId: 'test-engineer',
      taskId: 'test-engineer--test-strategy',
      content: '',
      structuredResponse: {
        type: 'test-strategy-preview',
        content: validTestStrategyJson,
      },
    });

    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <MessageBubble
        message={message}
        onConfirmArtifact={mockOnConfirm}
        onRejectArtifact={mockOnReject}
      />
    );

    // The TestStrategyPreviewBubble should be rendered
    expect(screen.getByTestId('test-strategy-preview-bubble')).toBeInTheDocument();

    // Should show the header
    expect(screen.getByText('Generated Test Strategy')).toBeInTheDocument();

    // Should show counts
    expect(screen.getByTestId('test-strategy-counts')).toBeInTheDocument();

    // Should have confirm and reject buttons
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

// ============================================================================
// TASK_ARTIFACT_MAP Entry Tests
// ============================================================================

describe('Hub Bootstrap 4: TASK_ARTIFACT_MAP', () => {
  // --------------------------------------------------------------------------
  // Test 15: Contains architect--define-tech-stack entry
  // --------------------------------------------------------------------------
  it('contains architect--define-tech-stack entry with correct metadata', () => {
    const entry = TASK_ARTIFACT_MAP['architect--define-tech-stack'];
    expect(entry).toBeDefined();

    expect(entry.artifactId).toBe('tech-stack');
    expect(entry.artifactName).toBe('TECH-STACK.MD');
    expect(entry.artifactKey).toBe('techStack');
    expect(entry.completionMessage).toBe('Tech Stack complete.');
    expect(entry.warningText).toBe('A Tech Stack already exists. Completing this conversation will replace it.');
    expect(entry.previewType).toBe('tech-stack-preview');
  });

  // --------------------------------------------------------------------------
  // Test 16: Contains test-engineer--test-strategy entry
  // --------------------------------------------------------------------------
  it('contains test-engineer--test-strategy entry with correct metadata', () => {
    const entry = TASK_ARTIFACT_MAP['test-engineer--test-strategy'];
    expect(entry).toBeDefined();

    expect(entry.artifactId).toBe('test-strategy');
    expect(entry.artifactName).toBe('TEST-STRATEGY.MD');
    expect(entry.artifactKey).toBe('testStrategy');
    expect(entry.completionMessage).toBe('Test Strategy complete.');
    expect(entry.warningText).toBe('A Test Strategy already exists. Completing this conversation will replace it.');
    expect(entry.previewType).toBe('test-strategy-preview');
  });
});
