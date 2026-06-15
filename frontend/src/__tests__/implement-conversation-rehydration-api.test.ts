/**
 * Tests for Frontend API Client Updates - Conversation Rehydration
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * Task Group 2: Frontend API Client Updates
 *
 * Tests that getImplementConversation correctly constructs URLs with
 * projectParentFolder and featureTitle query parameters.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getImplementConversation, GetConversationResponse } from '../api/chatApi';

describe('getImplementConversation API Client', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /**
   * Test 1: getImplementConversation includes projectParentFolder in URL
   */
  it('should include projectParentFolder in the URL query string', async () => {
    let capturedUrl: string | null = null;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            exists: false,
            messages: [],
          } as GetConversationResponse),
      } as Response);
    });

    await getImplementConversation(
      'project-123',
      'feature-456',
      '/path/to/project',
      'My Feature Title'
    );

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl).toContain('projectParentFolder=');
    expect(capturedUrl).toContain(encodeURIComponent('/path/to/project'));
  });

  /**
   * Test 2: getImplementConversation includes featureTitle in URL
   */
  it('should include featureTitle in the URL query string', async () => {
    let capturedUrl: string | null = null;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            exists: false,
            messages: [],
          } as GetConversationResponse),
      } as Response);
    });

    await getImplementConversation(
      'project-123',
      'feature-456',
      '/path/to/project',
      'My Feature Title'
    );

    expect(capturedUrl).not.toBeNull();
    expect(capturedUrl).toContain('featureTitle=');
    expect(capturedUrl).toContain(encodeURIComponent('My Feature Title'));
  });

  /**
   * Test 3: getImplementConversation properly URL-encodes all parameters
   */
  it('should properly URL-encode all parameters including special characters', async () => {
    let capturedUrl: string | null = null;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            exists: false,
            messages: [],
          } as GetConversationResponse),
      } as Response);
    });

    // Use values with special characters that need URL encoding
    const projectId = 'project&id=test';
    const featureId = 'feature/id?test';
    const projectParentFolder = 'C:\\Users\\Test User\\My Projects';
    const featureTitle = 'Feature with "quotes" & special <chars>';

    await getImplementConversation(projectId, featureId, projectParentFolder, featureTitle);

    expect(capturedUrl).not.toBeNull();

    // Verify all parameters are present and properly encoded
    expect(capturedUrl).toContain(`projectId=${encodeURIComponent(projectId)}`);
    expect(capturedUrl).toContain(`featureId=${encodeURIComponent(featureId)}`);
    expect(capturedUrl).toContain(`projectParentFolder=${encodeURIComponent(projectParentFolder)}`);
    expect(capturedUrl).toContain(`featureTitle=${encodeURIComponent(featureTitle)}`);

    // Verify the URL is well-formed (has proper query string structure)
    const url = new URL(capturedUrl!, 'http://localhost');
    expect(url.searchParams.get('projectId')).toBe(projectId);
    expect(url.searchParams.get('featureId')).toBe(featureId);
    expect(url.searchParams.get('projectParentFolder')).toBe(projectParentFolder);
    expect(url.searchParams.get('featureTitle')).toBe(featureTitle);
  });

  /**
   * Test 4: getImplementConversation constructs correct full URL format
   */
  it('should construct URL with all four parameters in correct format', async () => {
    let capturedUrl: string | null = null;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            exists: true,
            messages: [
              {
                role: 'assistant',
                phase: 'bootstrap',
                content: 'Hello',
                timestamp: '2026-01-16T10:00:00Z',
              },
            ],
          } as GetConversationResponse),
      } as Response);
    });

    const result = await getImplementConversation(
      'proj-001',
      'feat-002',
      '/home/user/projects/my-app',
      'Add User Login'
    );

    expect(capturedUrl).not.toBeNull();

    // Verify URL structure: /api/implement-conversations?projectId=...&featureId=...&projectParentFolder=...&featureTitle=...
    expect(capturedUrl).toMatch(/^.*\/api\/implement-conversations\?/);
    expect(capturedUrl).toContain('projectId=proj-001');
    expect(capturedUrl).toContain('featureId=feat-002');
    expect(capturedUrl).toContain('projectParentFolder=' + encodeURIComponent('/home/user/projects/my-app'));
    expect(capturedUrl).toContain('featureTitle=' + encodeURIComponent('Add User Login'));

    // Verify response is returned correctly
    expect(result.exists).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello');
  });
});
