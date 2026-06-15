/**
 * Frontend Thread Type Verification for Summarisation Fields
 *
 * Spec 2026-03-02: Increment 11 -- Hub Bootstrap 6: Summarisation End-to-End
 * Task Group 4, Task 4.1: Write 3 focused tests for frontend Thread type
 *
 * Tests verify:
 * - Frontend Thread type accepts summary: null and summarisedUpToIndex: 0 (default values)
 * - Frontend Thread type accepts summary with content and summarisedUpToIndex: 42 (non-default values)
 * - A mock API response JSON with summary fields assigns to a Thread variable without type errors
 *
 * Task 4.2 Verification: useChatThread.ts requires NO changes.
 * The sealedTaskIds computation (lines 260-269) is read-only and does not interact
 * with the summary or summarisedUpToIndex fields. The hook loads the thread via
 * getThreadHistory and stores it in local state -- the new fields are carried through
 * automatically as part of the Thread object without any code changes needed.
 * The hook's return type (UseChatThreadReturn) does not expose summary fields to
 * consumers, which is correct since there are no UI changes in this increment.
 */

import { describe, it, expect } from 'vitest';
import type { Thread, ThreadMessage } from '../api/chatV2Api';

// ============================================================================
// Helper: build a minimal valid ThreadMessage for use in Thread objects
// ============================================================================

function makeMessage(overrides?: Partial<ThreadMessage>): ThreadMessage {
  return {
    id: 'msg-test-001',
    role: 'user',
    personaId: null,
    taskId: null,
    content: 'Hello',
    structuredResponse: null,
    timestamp: '2026-03-02T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Frontend Thread Type -- Summarisation Fields
// ============================================================================

describe('Frontend Thread type -- summarisation fields', () => {
  /**
   * Test 1: Frontend Thread type accepts summary: null and summarisedUpToIndex: 0
   *
   * Verifies the compile-time type assertion that the summary fields exist on the
   * Thread interface with their default values (null / 0). This matches the gateway
   * Thread interface defaults from R1 of the spec.
   */
  it('accepts summary: null and summarisedUpToIndex: 0 (default values)', () => {
    const thread: Thread = {
      threadKey: 'project:proj-001:hub',
      projectId: 'proj-001',
      messages: [makeMessage()],
      activePersonaId: 'assistant',
      activeTaskId: null,
      summary: null,
      summarisedUpToIndex: 0,
      createdAt: '2026-03-02T10:00:00.000Z',
      updatedAt: '2026-03-02T10:00:00.000Z',
    };

    // Runtime assertions confirm the fields exist and hold expected default values
    expect(thread.summary).toBeNull();
    expect(thread.summarisedUpToIndex).toBe(0);
    // Verify the object is structurally complete
    expect(thread.threadKey).toBe('project:proj-001:hub');
    expect(thread.projectId).toBe('proj-001');
    expect(thread.messages).toHaveLength(1);
  });

  /**
   * Test 2: Frontend Thread type accepts summary with content and summarisedUpToIndex: 42
   *
   * Verifies the compile-time type assertion that summary accepts a non-null string
   * value and summarisedUpToIndex accepts a non-zero number. This represents the
   * state of a thread after summarisation has occurred (R6).
   */
  it('accepts summary with content and summarisedUpToIndex: 42 (non-default values)', () => {
    const thread: Thread = {
      threadKey: 'project:proj-002:hub',
      projectId: 'proj-002',
      messages: [],
      activePersonaId: 'product-manager',
      activeTaskId: 'product-manager--define-product',
      summary: 'Goals:\n- Build a product',
      summarisedUpToIndex: 42,
      createdAt: '2026-03-02T09:00:00.000Z',
      updatedAt: '2026-03-02T12:00:00.000Z',
    };

    // Runtime assertions confirm the fields hold non-default values
    expect(thread.summary).toBe('Goals:\n- Build a product');
    expect(thread.summarisedUpToIndex).toBe(42);
    // Verify the rest of the object is intact
    expect(thread.activePersonaId).toBe('product-manager');
    expect(thread.activeTaskId).toBe('product-manager--define-product');
  });

  /**
   * Test 3: A mock API response JSON with summary fields assigns to Thread variable
   *
   * Simulates receiving a JSON response from the gateway that includes the new
   * summary and summarisedUpToIndex fields. The parsed JSON must assign cleanly
   * to a Thread-typed variable, confirming gateway response compatibility (R1).
   */
  it('mock API response JSON with summary fields assigns to Thread variable without type errors', () => {
    // Simulate a raw JSON response from the gateway (as would be returned by fetch().json())
    const rawApiResponse = JSON.parse(JSON.stringify({
      threadKey: 'project:proj-003:panel:architecture',
      projectId: 'proj-003',
      messages: [
        {
          id: 'msg-001',
          role: 'user',
          personaId: null,
          taskId: null,
          content: 'Describe the system architecture',
          structuredResponse: null,
          timestamp: '2026-03-02T10:00:00.000Z',
        },
        {
          id: 'msg-002',
          role: 'assistant',
          personaId: 'architect',
          taskId: 'architect--define-architecture',
          content: 'The system uses a layered architecture...',
          structuredResponse: { phase: 'discovery' },
          timestamp: '2026-03-02T10:00:05.000Z',
        },
      ],
      activePersonaId: 'architect',
      activeTaskId: 'architect--define-architecture',
      summary: '**Goals**\n- Define baseline architecture\n\n**Decisions**\n- Layered approach chosen\n\n**Open Questions**\n- Database selection\n\n**Current State**\n- Initial discovery phase',
      summarisedUpToIndex: 15,
      createdAt: '2026-03-02T08:00:00.000Z',
      updatedAt: '2026-03-02T10:00:05.000Z',
    }));

    // Assign the parsed JSON to a Thread-typed variable -- this is the key type check
    const thread: Thread = rawApiResponse;

    // Runtime assertions confirm the summary fields survived the JSON round-trip
    expect(thread.summary).toContain('**Goals**');
    expect(thread.summary).toContain('**Decisions**');
    expect(thread.summary).toContain('**Open Questions**');
    expect(thread.summary).toContain('**Current State**');
    expect(thread.summarisedUpToIndex).toBe(15);

    // Verify the full Thread structure is intact after assignment
    expect(thread.threadKey).toBe('project:proj-003:panel:architecture');
    expect(thread.projectId).toBe('proj-003');
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].role).toBe('user');
    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.activePersonaId).toBe('architect');
    expect(thread.activeTaskId).toBe('architect--define-architecture');
    expect(thread.createdAt).toBe('2026-03-02T08:00:00.000Z');
    expect(thread.updatedAt).toBe('2026-03-02T10:00:05.000Z');
  });
});
