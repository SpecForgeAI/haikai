/**
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 1: State Management Tests
 *
 * Tests for implementationMode field in ImplementChatUiState:
 * - Interface includes implementationMode boolean field
 * - Factory initializes implementationMode to false
 * - Equality guard includes implementationMode check
 * - State persists correctly via setImplementChatState
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  ImplementChatUiState,
} from '../contexts/ProductUiStateContext';

// Test wrapper that provides the ProductUiStateProvider
function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(ProductUiStateProvider, null, children);
}

describe('Spec 2026-01-23: implementationMode State Management', () => {
  describe('ImplementChatUiState interface', () => {
    it('should include implementationMode as an optional boolean field', () => {
      // TypeScript compile-time test - if this compiles, the interface is correct
      const state: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        implementationMode: false, // This should compile
      };

      expect(state.implementationMode).toBe(false);
    });

    it('should allow implementationMode to be undefined for backward compatibility', () => {
      // TypeScript compile-time test - undefined should be valid
      const state: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        // implementationMode not set - should be valid
      };

      expect(state.implementationMode).toBeUndefined();
    });
  });

  describe('setImplementChatState with implementationMode', () => {
    it('should persist implementationMode: false correctly', () => {
      const { result } = renderHook(() => useProductUiState(), { wrapper });

      const projectKey = 'test-project';
      const workItemId = 'work-item-1';
      const chatState: ImplementChatUiState = {
        sessionId: 'session-1',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        implementationMode: false,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, chatState);
      });

      const retrieved = result.current.getImplementChatState(projectKey, workItemId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.implementationMode).toBe(false);
    });

    it('should persist implementationMode: true correctly', () => {
      const { result } = renderHook(() => useProductUiState(), { wrapper });

      const projectKey = 'test-project';
      const workItemId = 'work-item-2';
      const chatState: ImplementChatUiState = {
        sessionId: 'session-2',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        implementationMode: true,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, chatState);
      });

      const retrieved = result.current.getImplementChatState(projectKey, workItemId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.implementationMode).toBe(true);
    });

    it('should update implementationMode from false to true', () => {
      const { result } = renderHook(() => useProductUiState(), { wrapper });

      const projectKey = 'test-project';
      const workItemId = 'work-item-3';

      // Initial state with implementationMode: false
      const initialState: ImplementChatUiState = {
        sessionId: 'session-3',
        messages: [{ id: 'msg-1', role: 'user', content: 'test', timestamp: new Date() }],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        implementationMode: false,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, initialState);
      });

      // Update to implementationMode: true
      const updatedState: ImplementChatUiState = {
        ...initialState,
        implementationMode: true,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, updatedState);
      });

      const retrieved = result.current.getImplementChatState(projectKey, workItemId);
      expect(retrieved?.implementationMode).toBe(true);
    });
  });

  describe('equality guard with implementationMode', () => {
    it('should detect implementationMode change and update state', () => {
      const { result } = renderHook(() => useProductUiState(), { wrapper });

      const projectKey = 'test-project';
      const workItemId = 'work-item-4';

      // Initial state
      const initialState: ImplementChatUiState = {
        sessionId: 'session-4',
        messages: [{ id: 'msg-1', role: 'user', content: 'test', timestamp: new Date() }],
        generatedSpecs: null,
        error: null,
        inputDraft: 'draft',
        implementationMode: false,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, initialState);
      });

      // Update only implementationMode (sessionId, messages.length, inputDraft unchanged)
      const updatedState: ImplementChatUiState = {
        ...initialState,
        implementationMode: true,
      };

      act(() => {
        result.current.setImplementChatState(projectKey, workItemId, updatedState);
      });

      // Should have updated because implementationMode changed
      const retrieved = result.current.getImplementChatState(projectKey, workItemId);
      expect(retrieved?.implementationMode).toBe(true);
    });
  });
});
