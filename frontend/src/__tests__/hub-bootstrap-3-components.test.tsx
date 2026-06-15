/**
 * Hub Bootstrap 3: ArchitecturePreviewBubble, MessageBubble, and useChatThread Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 4, Task 4.1: Write 8 focused tests for the new components, MessageBubble updates,
 * and hook extension
 *
 * Tests verify:
 * 1. ArchitecturePreviewBubble renders entity counts in header
 * 2. ArchitecturePreviewBubble renders expandable sections for 7 entity arrays
 * 3. ArchitecturePreviewBubble toggles between summary and JSON view
 * 4. ArchitecturePreviewBubble Confirm/Reject buttons work (Saving... state, disabled state)
 * 5. ArchitecturePreviewBubble handles malformed JSON gracefully
 * 6. isArchitecturePreview type guard returns correct values
 * 7. MessageBubble renders ArchitecturePreviewBubble for architecture-preview type
 * 8. TASK_ARTIFACT_MAP contains architect--define-architecture entry
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArchitecturePreviewBubble } from '../components/UnifiedChat/ArchitecturePreviewBubble';
import { MessageBubble } from '../components/UnifiedChat/MessageBubble';
import { isArchitecturePreview } from '../components/UnifiedChat/MessageBubble';
import { TASK_ARTIFACT_MAP } from '../hooks/useChatThread';
import type { ThreadMessage } from '../api/chatV2Api';

// ============================================================================
// Mock CSS modules
// ============================================================================

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

const validArchitectureJson = JSON.stringify({
  services: [
    { name: 'Auth Service', description: 'Handles authentication and authorization' },
    { name: 'User Service', description: 'Manages user profiles' },
    { name: 'Notification Service', description: 'Sends notifications' },
  ],
  interfaces: [
    { name: 'REST API Gateway', description: 'External API interface' },
    { name: 'Event Bus', description: 'Internal event-driven interface' },
    { name: 'gRPC Internal', description: 'Internal service-to-service' },
    { name: 'WebSocket Gateway', description: 'Real-time communication' },
    { name: 'Admin API', description: 'Administrative interface' },
  ],
  interfaceEndpoints: [
    { name: 'POST /auth/login', description: 'User login endpoint' },
    { name: 'GET /users/:id', description: 'Get user by ID' },
  ],
  logicalDataEntities: [
    { name: 'User', description: 'Core user entity' },
    { name: 'Session', description: 'Authentication session' },
  ],
  physicalDataEntities: [
    { name: 'users_table', description: 'PostgreSQL users table' },
    { name: 'sessions_table', description: 'Redis session store' },
  ],
  businessLogic: [
    { name: 'Login Flow', description: 'Validates credentials and creates session' },
  ],
  dataMovements: [
    { name: 'User Created Event', description: 'Emitted when a user registers' },
    { name: 'Session Expired Event', description: 'Emitted on session timeout' },
  ],
});

function createAssistantMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-test-1',
    role: 'assistant',
    personaId: 'architect',
    taskId: 'architect--define-architecture',
    content: '',
    structuredResponse: null,
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// ArchitecturePreviewBubble Tests
// ============================================================================

describe('Hub Bootstrap 3: ArchitecturePreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 1: Renders entity counts in header
  // --------------------------------------------------------------------------
  it('renders entity counts in the header (e.g., "3 services, 5 interfaces, 4 data entities")', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Header should show "Generated Architecture Baseline"
    expect(screen.getByText('Generated Architecture Baseline')).toBeInTheDocument();

    // Counts should be displayed: 3 services, 5 interfaces, 4 data entities (2 logical + 2 physical)
    const countsEl = screen.getByTestId('architecture-counts');
    expect(countsEl).toBeInTheDocument();
    expect(countsEl.textContent).toBe('3 services, 5 interfaces, 4 data entities');
  });

  // --------------------------------------------------------------------------
  // Test 2: Renders expandable sections for 7 entity arrays
  // --------------------------------------------------------------------------
  it('renders expandable sections for each of the 7 entity arrays with entity names and descriptions', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // All 7 section headers should be present
    expect(screen.getByTestId('architecture-section-services')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-interfaces')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-interfaceEndpoints')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-logicalDataEntities')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-physicalDataEntities')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-businessLogic')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-dataMovements')).toBeInTheDocument();

    // Sections should start collapsed (no content visible)
    expect(screen.queryByTestId('architecture-section-content-services')).not.toBeInTheDocument();

    // Click to expand services section
    fireEvent.click(screen.getByTestId('architecture-section-header-services'));

    // Now services content should be visible
    expect(screen.getByTestId('architecture-section-content-services')).toBeInTheDocument();

    // Entity names should be visible within the expanded section
    expect(screen.getByText('Auth Service')).toBeInTheDocument();
    expect(screen.getByText('User Service')).toBeInTheDocument();
    expect(screen.getByText('Notification Service')).toBeInTheDocument();

    // Entity descriptions should be visible
    expect(screen.getByText(/Handles authentication and authorization/)).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Toggles between summary and JSON view
  // --------------------------------------------------------------------------
  it('toggles between readable summary view and raw JSON view when "Show JSON" button is clicked', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Initially should show summary view, not raw JSON
    expect(screen.getByTestId('architecture-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('architecture-raw-json')).not.toBeInTheDocument();

    // Toggle button should say "Show JSON"
    const toggleButton = screen.getByTestId('architecture-toggle-json');
    expect(toggleButton.textContent).toBe('Show JSON');

    // Click toggle to switch to raw JSON view
    fireEvent.click(toggleButton);

    // Now should show raw JSON, not summary
    expect(screen.queryByTestId('architecture-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('architecture-raw-json')).toBeInTheDocument();

    // Toggle button should now say "Show Summary"
    expect(toggleButton.textContent).toBe('Show Summary');

    // Click toggle again to go back to summary
    fireEvent.click(toggleButton);
    expect(screen.getByTestId('architecture-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('architecture-raw-json')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Confirm/Reject buttons work (Saving... state, disabled state)
  // --------------------------------------------------------------------------
  it('renders Confirm and Reject buttons; Confirm shows "Saving..." when isConfirming; both disabled when disabled || isConfirming', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    // Render in normal state
    const { rerender } = render(
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });

    expect(confirmButton).toBeInTheDocument();
    expect(rejectButton).toBeInTheDocument();
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
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={true}
        disabled={false}
      />
    );

    // Confirm button should show "Saving..."
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();
    // Both should be disabled
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    // Re-render with disabled=true, isConfirming=false
    rerender(
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={true}
      />
    );

    // Both should be disabled when disabled=true
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Test 5: Handles malformed JSON gracefully
  // --------------------------------------------------------------------------
  it('handles malformed JSON gracefully (shows error message, not crash)', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content="this is not valid JSON {{{{"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Should show error message
    const errorEl = screen.getByTestId('architecture-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toContain('Failed to parse architecture baseline JSON');

    // Should NOT show summary, toggle, or counts
    expect(screen.queryByTestId('architecture-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-toggle-json')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-counts')).not.toBeInTheDocument();

    // Confirm and Reject buttons should still be present
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

// ============================================================================
// isArchitecturePreview Type Guard Tests
// ============================================================================

describe('Hub Bootstrap 3: isArchitecturePreview type guard', () => {
  // --------------------------------------------------------------------------
  // Test 6: Returns correct values for various inputs
  // --------------------------------------------------------------------------
  it('returns true for architecture-preview type and false for other types', () => {
    // Should return true for valid architecture-preview
    expect(isArchitecturePreview({ type: 'architecture-preview', content: '{}' })).toBe(true);

    // Should return false for roadmap-preview
    expect(isArchitecturePreview({ type: 'roadmap-preview', content: '{}' })).toBe(false);

    // Should return false for artifact-preview
    expect(isArchitecturePreview({ type: 'artifact-preview', markdownContent: '# Test' })).toBe(false);

    // Should return false for null
    expect(isArchitecturePreview(null)).toBe(false);

    // Should return false for undefined
    expect(isArchitecturePreview(undefined)).toBe(false);

    // Should return false for non-object
    expect(isArchitecturePreview('string')).toBe(false);

    // Should return false when content is not a string
    expect(isArchitecturePreview({ type: 'architecture-preview', content: 123 })).toBe(false);

    // Should return false for empty object
    expect(isArchitecturePreview({})).toBe(false);
  });
});

// ============================================================================
// MessageBubble Integration Test
// ============================================================================

describe('Hub Bootstrap 3: MessageBubble renders ArchitecturePreviewBubble', () => {
  // --------------------------------------------------------------------------
  // Test 7: MessageBubble renders ArchitecturePreviewBubble for architecture-preview type
  // --------------------------------------------------------------------------
  it('renders ArchitecturePreviewBubble when structuredResponse.type === "architecture-preview" and onConfirmArtifact is provided', () => {
    const message = createAssistantMessage({
      content: '',
      structuredResponse: {
        type: 'architecture-preview',
        content: validArchitectureJson,
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

    // The ArchitecturePreviewBubble should be rendered
    expect(screen.getByTestId('architecture-preview-bubble')).toBeInTheDocument();

    // Should show the header
    expect(screen.getByText('Generated Architecture Baseline')).toBeInTheDocument();

    // Should show entity counts
    expect(screen.getByTestId('architecture-counts')).toBeInTheDocument();

    // Should have confirm and reject buttons
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});

// ============================================================================
// TASK_ARTIFACT_MAP Entry Test
// ============================================================================

describe('Hub Bootstrap 3: TASK_ARTIFACT_MAP', () => {
  // --------------------------------------------------------------------------
  // Test 8: Contains architect--define-architecture entry
  // --------------------------------------------------------------------------
  it('contains architect--define-architecture entry with correct metadata', () => {
    const entry = TASK_ARTIFACT_MAP['architect--define-architecture'];
    expect(entry).toBeDefined();

    expect(entry.artifactId).toBe('architecture-baseline');
    expect(entry.artifactName).toBe('ARCHITECTURE_BASELINE');
    expect(entry.artifactKey).toBe('architecture');
    expect(entry.completionMessage).toBe('Architecture Baseline complete.');
    expect(entry.warningText).toBe('An Architecture Baseline already exists. Completing this conversation will replace it.');
    expect(entry.previewType).toBe('architecture-preview');
  });
});
