/**
 * Detailed Data Model Task: Frontend Preview, Type Guard, and Hook Wiring Tests
 *
 * Spec 2026-03-14: Detailed Data Model Task -- End-to-End Fix
 * Task Group 4, Task 4.1: Write 4 focused tests for data model preview rendering and routing
 *
 * Tests verify:
 * 1. isDataModelPreview type guard returns true for { type: 'data-model-preview', content: '...' } and false for other types
 * 2. ArchitecturePreviewBubble renders logicalDataAttributes and physicalDataAttributes expandable sections when present in JSON content
 * 3. TASK_ARTIFACT_MAP['architect--detailed-data-model'] entry has correct artifactId, previewType, completionMessage values
 * 4. generateArtifact creates a data-model-preview structuredResponse message when previewType is 'data-model-preview'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ArchitecturePreviewBubble } from '../components/UnifiedChat/ArchitecturePreviewBubble';
import { isDataModelPreview } from '../components/UnifiedChat/MessageBubble';
import { useChatThread, TASK_ARTIFACT_MAP } from '../hooks/useChatThread';
import type { ThreadKey, Thread } from '../api/chatV2Api';
import { createProvidersWrapper } from '../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

// ============================================================================
// Mock CSS modules
// ============================================================================

vi.mock('../components/UnifiedChat/ArchitecturePreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ============================================================================
// Mock the API module for useChatThread hook tests
// ============================================================================

vi.mock('../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../api/chatV2Api')>(
    '../api/chatV2Api'
  );
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
    postGenerateArtifact: vi.fn(),
    postSaveArtifact: vi.fn(),
  };
});

import {
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
} from '../api/chatV2Api';

const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);
const mockPostGenerateArtifact = vi.mocked(postGenerateArtifact);

// ============================================================================
// Test Data
// ============================================================================

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'dm-test-proj' };

const validDataModelJson = JSON.stringify({
  logicalDataEntities: [
    { name: 'User', description: 'Core user entity' },
    { name: 'Order', description: 'Customer order' },
  ],
  physicalDataEntities: [
    { name: 'users_table', description: 'PostgreSQL users table' },
  ],
  logicalDataAttributes: [
    { name: 'userId', description: 'Unique user identifier', logicalEntityRef: 'User', dataType: 'UUID', isPrimaryKey: true },
    { name: 'email', description: 'User email address', logicalEntityRef: 'User', dataType: 'string' },
    { name: 'orderId', description: 'Unique order identifier', logicalEntityRef: 'Order', dataType: 'UUID', isPrimaryKey: true },
  ],
  physicalDataAttributes: [
    { name: 'user_id', description: 'Primary key', physicalEntityRef: 'users_table', dataType: 'UUID', isPrimaryKey: true },
    { name: 'email_address', description: 'Email column', physicalEntityRef: 'users_table', dataType: 'VARCHAR(255)' },
  ],
  logicalPhysicalEntityMappings: [
    { logicalEntityName: 'User', physicalEntityName: 'users_table' },
  ],
});

const threadWithDataModelTask: Thread = {
  threadKey: 'project:dm-test-proj:hub',
  projectId: 'dm-test-proj',
  messages: [],
  activePersonaId: 'architect',
  activeTaskId: 'architect--detailed-data-model',
  createdAt: '2026-03-14T10:00:00.000Z',
  updatedAt: '2026-03-14T10:00:00.000Z',
};

// ============================================================================
// Test 1: isDataModelPreview type guard
// ============================================================================

describe('Detailed Data Model: isDataModelPreview type guard', () => {
  it('returns true for data-model-preview type and false for other types', () => {
    // Should return true for valid data-model-preview
    expect(isDataModelPreview({ type: 'data-model-preview', content: '{}' })).toBe(true);

    // Should return false for architecture-preview
    expect(isDataModelPreview({ type: 'architecture-preview', content: '{}' })).toBe(false);

    // Should return false for roadmap-preview
    expect(isDataModelPreview({ type: 'roadmap-preview', content: '{}' })).toBe(false);

    // Should return false for artifact-preview
    expect(isDataModelPreview({ type: 'artifact-preview', markdownContent: '# Test' })).toBe(false);

    // Should return false for null
    expect(isDataModelPreview(null)).toBe(false);

    // Should return false for undefined
    expect(isDataModelPreview(undefined)).toBe(false);

    // Should return false for non-object
    expect(isDataModelPreview('string')).toBe(false);

    // Should return false when content is not a string
    expect(isDataModelPreview({ type: 'data-model-preview', content: 123 })).toBe(false);

    // Should return false for empty object
    expect(isDataModelPreview({})).toBe(false);
  });
});

// ============================================================================
// Test 2: ArchitecturePreviewBubble renders attribute sections
// ============================================================================

describe('Detailed Data Model: ArchitecturePreviewBubble renders attribute sections', () => {
  it('renders logicalDataAttributes and physicalDataAttributes expandable sections when present in JSON content', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content={validDataModelJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Both attribute section headers should be present
    expect(screen.getByTestId('architecture-section-logicalDataAttributes')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-section-physicalDataAttributes')).toBeInTheDocument();

    // Sections should start collapsed
    expect(screen.queryByTestId('architecture-section-content-logicalDataAttributes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-section-content-physicalDataAttributes')).not.toBeInTheDocument();

    // Click to expand logical data attributes section
    fireEvent.click(screen.getByTestId('architecture-section-header-logicalDataAttributes'));

    // Now logical data attributes content should be visible
    expect(screen.getByTestId('architecture-section-content-logicalDataAttributes')).toBeInTheDocument();

    // Attribute names should be visible within the expanded section
    expect(screen.getByText('userId')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('orderId')).toBeInTheDocument();

    // Click to expand physical data attributes section
    fireEvent.click(screen.getByTestId('architecture-section-header-physicalDataAttributes'));

    // Now physical data attributes content should be visible
    expect(screen.getByTestId('architecture-section-content-physicalDataAttributes')).toBeInTheDocument();

    // Physical attribute names should be visible
    expect(screen.getByText('user_id')).toBeInTheDocument();
    expect(screen.getByText('email_address')).toBeInTheDocument();

    // Verify the section labels are correct
    expect(screen.getByText(/Logical Data Attributes/)).toBeInTheDocument();
    expect(screen.getByText(/Physical Data Attributes/)).toBeInTheDocument();
  });
});

// ============================================================================
// Test 3: TASK_ARTIFACT_MAP entry
// ============================================================================

describe('Detailed Data Model: TASK_ARTIFACT_MAP entry', () => {
  it('contains architect--detailed-data-model entry with correct metadata', () => {
    const entry = TASK_ARTIFACT_MAP['architect--detailed-data-model'];
    expect(entry).toBeDefined();

    expect(entry.artifactId).toBe('data-model');
    expect(entry.artifactName).toBe('DATA_MODEL');
    expect(entry.artifactKey).toBe('dataModel');
    expect(entry.completionMessage).toBe('Data Model complete.');
    expect(entry.warningText).toBe('Data model entities already exist in the architecture. Completing this conversation will add to them.');
    expect(entry.previewType).toBe('data-model-preview');
  });
});

// ============================================================================
// Test 4: generateArtifact creates data-model-preview structuredResponse
// ============================================================================

describe('Detailed Data Model: generateArtifact routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateArtifact creates a data-model-preview structuredResponse message when previewType is data-model-preview', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithDataModelTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: validDataModelJson,
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--detailed-data-model');
    });

    await act(async () => {
      await result.current.generateArtifact('architect--detailed-data-model');
    });

    // Should have a preview message with data-model-preview type
    const previewMsg = result.current.messages.find(
      (m) => m.structuredResponse && (m.structuredResponse as Record<string, unknown>).type === 'data-model-preview'
    );
    expect(previewMsg).toBeDefined();
    expect((previewMsg!.structuredResponse as Record<string, unknown>).type).toBe('data-model-preview');
    expect((previewMsg!.structuredResponse as Record<string, unknown>).content).toBe(validDataModelJson);

    // artifactPreview should be set
    expect(result.current.artifactPreview).not.toBeNull();
    expect(result.current.artifactPreview!.taskId).toBe('architect--detailed-data-model');
    expect(result.current.artifactPreview!.content).toBe(validDataModelJson);
  });
});
