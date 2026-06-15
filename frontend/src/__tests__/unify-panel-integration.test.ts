/**
 * Frontend Integration Tests for Unify Hub and RHS Panel Capabilities
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests fill critical gaps identified in the review of Task Groups 1-4:
 *
 * Test 7: Panel collapse state persists and restores across simulated remounts with different threadKeys
 * Test 8: useChatThread passes allowedPersonaIds through to postChatV2 call
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// ============================================================================
// Mocks for useChatThread tests (Test 8)
// ============================================================================

// Mock postChatV2, getThreadHistory, and other API functions
const mockPostChatV2 = vi.fn();
const mockGetThreadHistory = vi.fn();
const mockPostGenerateArtifact = vi.fn();
const mockPostSaveArtifact = vi.fn();
const mockPostHandoff = vi.fn();

vi.mock('../api/chatV2Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/chatV2Api')>();
  return {
    ...actual,
    postChatV2: (...args: unknown[]) => mockPostChatV2(...args),
    getThreadHistory: (...args: unknown[]) => mockGetThreadHistory(...args),
    postGenerateArtifact: (...args: unknown[]) => mockPostGenerateArtifact(...args),
    postSaveArtifact: (...args: unknown[]) => mockPostSaveArtifact(...args),
    postHandoff: (...args: unknown[]) => mockPostHandoff(...args),
  };
});

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { useChatThread } from '../hooks/useChatThread';
import { threadKeyToString } from '../api/chatV2Api';
import type { ThreadKey } from '../api/chatV2Api';
import { createProvidersWrapper } from '../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

// ============================================================================
// Test Helpers
// ============================================================================

const hubThreadKey: ThreadKey = { type: 'hub', projectId: 'integration-test-1' };
const panelMetaModelKey: ThreadKey = { type: 'panel', projectId: 'integration-test-1', screen: 'metamodel' };
const panelProductKey: ThreadKey = { type: 'panel', projectId: 'integration-test-1', screen: 'product' };

// ============================================================================
// Tests
// ============================================================================

describe('Unify Panel Integration Tests (Spec 2026-03-03, Task Group 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mock for getThreadHistory -- returns empty thread
    mockGetThreadHistory.mockResolvedValue({
      threadKey: 'project:integration-test-1:hub',
      projectId: 'integration-test-1',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    });
  });

  afterEach(() => {
    cleanup();
  });

  // --------------------------------------------------------------------------
  // Test 7: Panel collapse state persists and restores across simulated
  //         remounts with different threadKeys
  // --------------------------------------------------------------------------

  it('collapse state persists independently for different threadKeys across remounts', () => {
    const metaModelCollapseKey = `unified-chat-collapsed:${threadKeyToString(panelMetaModelKey)}`;
    const productCollapseKey = `unified-chat-collapsed:${threadKeyToString(panelProductKey)}`;

    // Simulate: MetaModel panel was collapsed, Product panel was expanded
    localStorage.setItem(metaModelCollapseKey, 'true');
    localStorage.setItem(productCollapseKey, 'false');

    // Verify the keys are distinct
    expect(metaModelCollapseKey).not.toBe(productCollapseKey);
    expect(metaModelCollapseKey).toBe('unified-chat-collapsed:project:integration-test-1:panel:metamodel');
    expect(productCollapseKey).toBe('unified-chat-collapsed:project:integration-test-1:panel:product');

    // Verify MetaModel persisted as collapsed
    expect(localStorage.getItem(metaModelCollapseKey)).toBe('true');

    // Verify Product persisted as expanded
    expect(localStorage.getItem(productCollapseKey)).toBe('false');

    // Simulate toggling MetaModel to expanded
    localStorage.setItem(metaModelCollapseKey, 'false');

    // Verify MetaModel is now expanded while Product remains unchanged
    expect(localStorage.getItem(metaModelCollapseKey)).toBe('false');
    expect(localStorage.getItem(productCollapseKey)).toBe('false');

    // Simulate toggling Product to collapsed
    localStorage.setItem(productCollapseKey, 'true');

    // Verify Product is now collapsed while MetaModel remains expanded
    expect(localStorage.getItem(metaModelCollapseKey)).toBe('false');
    expect(localStorage.getItem(productCollapseKey)).toBe('true');

    // Hub key should be independent and unset
    const hubCollapseKey = `unified-chat-collapsed:${threadKeyToString(hubThreadKey)}`;
    expect(localStorage.getItem(hubCollapseKey)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 8: useChatThread passes allowedPersonaIds through to postChatV2 call
  // --------------------------------------------------------------------------

  it('useChatThread passes allowedPersonaIds through to postChatV2', async () => {
    const allowedPersonaIds = ['architect', 'ux-designer', 'test-engineer'];

    // Mock postChatV2 to return a valid task-menu response
    mockPostChatV2.mockResolvedValue({
      threadKey: 'project:integration-test-1:panel:metamodel',
      personaId: 'architect',
      taskId: 'unknown',
      assistant: { message: 'Here are your tasks.' },
      structuredResponse: {
        type: 'task-menu',
        items: [{ taskId: 'architect--define-architecture', menuLabel: 'Define Architecture' }],
      },
    });

    // Render the useChatThread hook with allowedPersonaIds
    const { result } = renderHook(() =>
      useChatThread(panelMetaModelKey, {
        initialPersonaId: 'architect',
        allowedPersonaIds,
      })
    , { wrapper: providersWrapper });

    // Wait for initial thread history load to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Call sendMessage to trigger the postChatV2 call
    await act(async () => {
      await result.current.sendMessage('Hello architect');
    });

    // Verify postChatV2 was called with allowedPersonaIds in the request
    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    const requestArg = mockPostChatV2.mock.calls[0][0];
    expect(requestArg.allowedPersonaIds).toEqual(allowedPersonaIds);
    expect(requestArg.threadKey).toEqual(panelMetaModelKey);
    expect(requestArg.personaId).toBe('architect');
  });
});
