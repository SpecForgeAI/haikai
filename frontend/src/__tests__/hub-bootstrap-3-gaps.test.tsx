/**
 * Hub Bootstrap 3: Frontend Gap Analysis Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 6: Test Review and Gap Analysis
 *
 * These tests cover critical frontend gaps identified during the TG6 review of TG1-TG5:
 *
 *  1. ArchitecturePreviewBubble renders empty entity arrays gracefully (section shows 0, "No items")
 *  2. ArchitecturePreviewBubble services section detail: names and descriptions visible on expand
 *  3. isArchitecturePreview returns false for roadmap-preview type (false positive prevention)
 *  4. isArchitecturePreview returns false for completion-chip type
 *  5. generateArtifact for architecture task produces architecture-preview structuredResponse type
 *  6. confirmArtifact for architecture task uses artifactId 'architecture-baseline' and artifactName 'ARCHITECTURE_BASELINE'
 *  7. confirmArtifact for architecture task calls onArtifactSaved callback
 *  8. Phase detection triggers generation for architecture task when phase === 'ready'
 *  9. Regression: mission generateArtifact still produces artifact-preview type (not architecture-preview)
 * 10. Regression: roadmap generateArtifact still produces roadmap-preview type (not architecture-preview)
 * 11. Regression: mission confirmArtifact still uses 'mission-md' artifactId
 * 12. Regression: roadmap confirmArtifact still uses 'roadmap' artifactId
 * 13. TASK_ARTIFACT_MAP now has 3 entries with distinct previewTypes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ArchitecturePreviewBubble } from '../components/UnifiedChat/ArchitecturePreviewBubble';
import { isArchitecturePreview } from '../components/UnifiedChat/MessageBubble';
import { useChatThread, TASK_ARTIFACT_MAP } from '../hooks/useChatThread';
import type { ThreadKey, Thread, ThreadMessage } from '../api/chatV2Api';
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

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

import {
  postChatV2,
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
  postSaveArtifact,
} from '../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);
const mockPostGenerateArtifact = vi.mocked(postGenerateArtifact);
const mockPostSaveArtifact = vi.mocked(postSaveArtifact);

// ============================================================================
// Test Data
// ============================================================================

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'gap3-test-proj' };

const emptyArchitectureJson = JSON.stringify({
  services: [],
  interfaces: [],
  interfaceEndpoints: [],
  logicalDataEntities: [],
  physicalDataEntities: [],
  businessLogic: [],
  dataMovements: [],
});

const validArchitectureJson = JSON.stringify({
  services: [
    { name: 'Auth Service', description: 'Handles authentication and authorization' },
    { name: 'User Service', description: 'Manages user profiles' },
    { name: 'Notification Service', description: 'Sends notifications' },
  ],
  interfaces: [
    { name: 'REST API Gateway', description: 'External API interface' },
  ],
  interfaceEndpoints: [],
  logicalDataEntities: [
    { name: 'User', description: 'Core user entity' },
  ],
  physicalDataEntities: [],
  businessLogic: [],
  dataMovements: [],
});

const threadWithArchTask: Thread = {
  threadKey: 'project:gap3-test-proj:hub',
  projectId: 'gap3-test-proj',
  messages: [],
  activePersonaId: 'architect',
  activeTaskId: 'architect--define-architecture',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

const threadWithMissionTask: Thread = {
  threadKey: 'project:gap3-test-proj:hub',
  projectId: 'gap3-test-proj',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--define-product',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

const threadWithRoadmapTask: Thread = {
  threadKey: 'project:gap3-test-proj:hub',
  projectId: 'gap3-test-proj',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--roadmap',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

// ============================================================================
// ArchitecturePreviewBubble Edge Case Tests
// ============================================================================

describe('Hub Bootstrap 3 Gaps: ArchitecturePreviewBubble edge cases', () => {

  // --------------------------------------------------------------------------
  // Gap 1: Empty entity arrays display gracefully
  // --------------------------------------------------------------------------
  it('renders empty entity arrays gracefully with count of 0 and "No items" when expanded', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content={emptyArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Header counts should show zeros
    const countsEl = screen.getByTestId('architecture-counts');
    expect(countsEl.textContent).toBe('0 services, 0 interfaces, 0 data entities');

    // All 7 sections should be present
    expect(screen.getByTestId('architecture-section-services')).toBeInTheDocument();

    // Expand services section
    fireEvent.click(screen.getByTestId('architecture-section-header-services'));

    // Should show "No items" for empty section
    const sectionContent = screen.getByTestId('architecture-section-content-services');
    expect(sectionContent).toBeInTheDocument();
    expect(sectionContent.textContent).toContain('No items');
  });

  // --------------------------------------------------------------------------
  // Gap 2: Services section detail shows names and descriptions
  // --------------------------------------------------------------------------
  it('renders services section with 3 services showing entity names and descriptions when expanded', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArchitecturePreviewBubble
        content={validArchitectureJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    // Expand services section
    fireEvent.click(screen.getByTestId('architecture-section-header-services'));

    const sectionContent = screen.getByTestId('architecture-section-content-services');
    expect(sectionContent).toBeInTheDocument();

    // All 3 service names should be visible
    expect(screen.getByText('Auth Service')).toBeInTheDocument();
    expect(screen.getByText('User Service')).toBeInTheDocument();
    expect(screen.getByText('Notification Service')).toBeInTheDocument();

    // Descriptions should be visible
    expect(screen.getByText(/Handles authentication and authorization/)).toBeInTheDocument();
    expect(screen.getByText(/Manages user profiles/)).toBeInTheDocument();
    expect(screen.getByText(/Sends notifications/)).toBeInTheDocument();
  });
});

// ============================================================================
// Type Guard False Positive Prevention
// ============================================================================

describe('Hub Bootstrap 3 Gaps: isArchitecturePreview false positive prevention', () => {

  // --------------------------------------------------------------------------
  // Gap 3: Returns false for roadmap-preview type
  // --------------------------------------------------------------------------
  it('returns false for roadmap-preview type (prevents false positive)', () => {
    expect(isArchitecturePreview({ type: 'roadmap-preview', content: '{}' })).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Gap 4: Returns false for completion-chip type
  // --------------------------------------------------------------------------
  it('returns false for completion-chip type (prevents false positive)', () => {
    expect(isArchitecturePreview({
      type: 'completion-chip',
      taskId: 'architect--define-architecture',
      artifactId: 'architecture-baseline',
      artifactName: 'ARCHITECTURE_BASELINE',
      personaId: 'architect',
      timestamp: '2026-03-01T10:00:00.000Z',
    })).toBe(false);
  });
});

// ============================================================================
// useChatThread Hook: Architecture-specific Gap Tests
// ============================================================================

describe('Hub Bootstrap 3 Gaps: useChatThread architecture flow', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Gap 5: generateArtifact for architecture produces architecture-preview type
  // --------------------------------------------------------------------------
  it('generateArtifact for architecture task produces architecture-preview structuredResponse', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithArchTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: validArchitectureJson,
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--define-architecture');
    });

    await act(async () => {
      await result.current.generateArtifact('architect--define-architecture');
    });

    // Should have a preview message with architecture-preview type
    const previewMsg = result.current.messages.find(
      (m) => m.structuredResponse && (m.structuredResponse as Record<string, unknown>).type === 'architecture-preview'
    );
    expect(previewMsg).toBeDefined();
    expect((previewMsg!.structuredResponse as Record<string, unknown>).content).toBe(validArchitectureJson);
  });

  // --------------------------------------------------------------------------
  // Gap 6: confirmArtifact for architecture uses correct artifactId and artifactName
  // --------------------------------------------------------------------------
  it('confirmArtifact for architecture task uses artifactId "architecture-baseline" and artifactName "ARCHITECTURE_BASELINE"', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithArchTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: validArchitectureJson,
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--define-architecture');
    });

    // Generate to set artifactPreview
    await act(async () => {
      await result.current.generateArtifact('architect--define-architecture');
    });
    expect(result.current.artifactPreview).not.toBeNull();

    // Confirm
    await act(async () => {
      await result.current.confirmArtifact();
    });

    // Verify postSaveArtifact was called with correct architecture artifact metadata
    expect(mockPostSaveArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'architect--define-architecture',
      'architecture-baseline',
      validArchitectureJson,
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );
  });

  // --------------------------------------------------------------------------
  // Gap 7: confirmArtifact for architecture calls onArtifactSaved callback
  // --------------------------------------------------------------------------
  it('confirmArtifact for architecture task calls onArtifactSaved callback after save', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithArchTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: validArchitectureJson,
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const onArtifactSaved = vi.fn();

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'architect',
        onArtifactSaved,
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--define-architecture');
    });

    // Generate then confirm
    await act(async () => {
      await result.current.generateArtifact('architect--define-architecture');
    });

    await act(async () => {
      await result.current.confirmArtifact();
    });

    // onArtifactSaved callback should have been called
    expect(onArtifactSaved).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Gap 8: Phase detection for architecture task when phase === 'ready'
  // --------------------------------------------------------------------------
  it('sendMessage triggers generateArtifact when latest assistant message has phase="ready" for architecture task', async () => {
    const threadWithReadyPhase: Thread = {
      threadKey: 'project:gap3-test-proj:hub',
      projectId: 'gap3-test-proj',
      messages: [
        {
          id: 'msg-arch-ready',
          role: 'assistant',
          personaId: 'architect',
          taskId: 'architect--define-architecture',
          content: JSON.stringify({
            phase: 'ready',
            section: 'architecture_review',
            summary: 'Architecture baseline is ready to be generated.',
            questions: [],
          }),
          structuredResponse: {
            phase: 'ready',
            section: 'architecture_review',
            summary: 'Architecture baseline is ready to be generated.',
            questions: [],
          },
          timestamp: '2026-03-01T10:00:00.000Z',
        },
      ],
      activePersonaId: 'architect',
      activeTaskId: 'architect--define-architecture',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithReadyPhase);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: validArchitectureJson,
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--define-architecture');
    });

    // Send a message -- should trigger generation because last phase is 'ready'
    await act(async () => {
      await result.current.sendMessage('Generate the architecture baseline.');
    });

    // postGenerateArtifact should have been called
    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostGenerateArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'architect',
      'architect--define-architecture',
      undefined // allowedPersonaIds (not set in this test)
    );
  });

  // --------------------------------------------------------------------------
  // Gap 9: Regression - mission still produces artifact-preview type
  // --------------------------------------------------------------------------
  it('Regression: mission generateArtifact still produces artifact-preview type (not architecture-preview)', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '# Mission Statement',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    const previewMsg = result.current.messages.find(
      (m) => m.structuredResponse && (m.structuredResponse as Record<string, unknown>).type === 'artifact-preview'
    );
    expect(previewMsg).toBeDefined();

    // Must NOT be architecture-preview
    const archPreviewMsg = result.current.messages.find(
      (m) => m.structuredResponse && (m.structuredResponse as Record<string, unknown>).type === 'architecture-preview'
    );
    expect(archPreviewMsg).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Gap 10: Regression - roadmap still produces roadmap-preview type
  // --------------------------------------------------------------------------
  it('Regression: roadmap generateArtifact still produces roadmap-preview type (not architecture-preview)', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithRoadmapTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '{"initiatives":[{"title":"Init 1","epics":[]}]}',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--roadmap');
    });

    const previewMsg = result.current.messages.find(
      (m) => m.structuredResponse && (m.structuredResponse as Record<string, unknown>).type === 'roadmap-preview'
    );
    expect(previewMsg).toBeDefined();

    // Must NOT be architecture-preview
    const archPreviewMsg = result.current.messages.find(
      (m) => m.structuredResponse && (m.structuredResponse as Record<string, unknown>).type === 'architecture-preview'
    );
    expect(archPreviewMsg).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Gap 11: Regression - mission confirmArtifact still uses 'mission-md' artifactId
  // --------------------------------------------------------------------------
  it('Regression: mission confirmArtifact still uses artifactId "mission-md"', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '# My Mission',
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    await act(async () => {
      await result.current.confirmArtifact();
    });

    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--define-product',
      'mission-md',
      '# My Mission',
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );
  });

  // --------------------------------------------------------------------------
  // Gap 12: Regression - roadmap confirmArtifact still uses 'roadmap' artifactId
  // --------------------------------------------------------------------------
  it('Regression: roadmap confirmArtifact still uses artifactId "roadmap"', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithRoadmapTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '{"initiatives":[]}',
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--roadmap');
    });

    await act(async () => {
      await result.current.confirmArtifact();
    });

    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--roadmap',
      'roadmap',
      '{"initiatives":[]}',
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );
  });
});

// ============================================================================
// TASK_ARTIFACT_MAP Completeness
// ============================================================================

describe('Hub Bootstrap 3 Gaps: TASK_ARTIFACT_MAP completeness', () => {

  // --------------------------------------------------------------------------
  // Gap 13: All 3 entries have distinct previewTypes
  // --------------------------------------------------------------------------
  it('TASK_ARTIFACT_MAP has at least 3 entries (mission, roadmap, architecture) with distinct previewTypes', () => {
    const keys = Object.keys(TASK_ARTIFACT_MAP);
    expect(keys).toContain('product-manager--define-product');
    expect(keys).toContain('product-manager--roadmap');
    expect(keys).toContain('architect--define-architecture');
    expect(keys.length).toBeGreaterThanOrEqual(3);

    const previewTypes = keys.map(k => TASK_ARTIFACT_MAP[k].previewType);
    expect(new Set(previewTypes).size).toBeGreaterThanOrEqual(3);
    expect(previewTypes).toContain('artifact-preview');
    expect(previewTypes).toContain('roadmap-preview');
    expect(previewTypes).toContain('architecture-preview');
  });
});
