/**
 * Strategic gap-fill: postSaveArtifact `architectureId` request body wire.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 11
 * (test review + cross-tier gap fill).
 *
 * Why this test exists:
 *   Group 8 covers the picker modal in isolation (props + onConfirm wiring).
 *   Group 10 covers the chat-panel wrapper that opens the picker, threads the
 *   chosen architecture id through `confirmArtifact`, and asserts on the
 *   `confirmArtifact(architectureId)` call. Neither group asserts on the
 *   final HTTP request body that goes to the backend `save-artifact`
 *   endpoint, which is the load-bearing wire for the clarify-at-save mode.
 *
 *   The Group 10 caveat explicitly notes that the backend save-artifact
 *   handler does NOT yet consume the new `architectureId` field on the
 *   request body, but the wire is in place. This file verifies the wire
 *   so when the backend lands the consumer the path is already proven.
 *
 * Test inventory (2 tests):
 *   1. `postSaveArtifact` includes `architectureId` in the request body when
 *      the optional argument is supplied (the picker confirm path).
 *   2. `postSaveArtifact` OMITS `architectureId` from the request body when
 *      the argument is not supplied (the bound / derived / project-level
 *      callers that don't go through the picker).
 *
 * The test directly invokes the API helper with a mocked `fetch` so we can
 * inspect the JSON-stringified request body the function builds. This is
 * the same boundary that mockable test patterns use across the codebase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postSaveArtifact, type ThreadKey } from '../api/chatV2Api';

// ---- Mock global fetch so we can inspect the request body ----
const mockFetch = vi.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Default: respond 200 with success: true so postSaveArtifact returns
  // cleanly. Individual tests can override.
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  });
  (global as unknown as { fetch: typeof fetch }).fetch =
    mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
  (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

const hubKey: ThreadKey = { type: 'hub', projectId: 'proj-arch-id-wire' };

describe('postSaveArtifact architectureId wire (Spec #5 TG11 gap-fill)', () => {
  // --------------------------------------------------------------------------
  // Test 1: architectureId IS included in the request body when supplied.
  //
  // This is the load-bearing assertion for the clarify-at-save flow:
  // picker.confirm -> useChatThread.confirmArtifact(archId) -> postSaveArtifact
  // -> POST /api/chat/v2/save-artifact with `architectureId` in the body.
  // --------------------------------------------------------------------------
  it('includes architectureId in the request body when the optional argument is supplied', async () => {
    await postSaveArtifact(
      hubKey,
      'ux-designer--ui-domain', // clarify-at-save task
      'ui-domain-md',
      '## UI Domain content',
      ['ux-designer'],
      'arch-uuid-picker-chosen' // <-- the picker-supplied architecture id
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/chat/v2/save-artifact');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string);
    expect(body.architectureId).toBe('arch-uuid-picker-chosen');
    // Sanity: the rest of the payload is intact.
    expect(body.taskId).toBe('ux-designer--ui-domain');
    expect(body.artifactId).toBe('ui-domain-md');
    expect(body.content).toBe('## UI Domain content');
    expect(body.allowedPersonaIds).toEqual(['ux-designer']);
  });

  // --------------------------------------------------------------------------
  // Test 2: architectureId is OMITTED from the request body when not supplied.
  //
  // bound-by-system-prompt, derived-from-context, and project-level callers
  // (PM/TE/Assistant) all save without going through the picker, so they
  // never pass an architectureId. The field must be absent from the body
  // (not present-as-undefined) so the backend save handler can detect the
  // clarify-at-save path purely by field presence.
  // --------------------------------------------------------------------------
  it('OMITS architectureId from the request body when the argument is not supplied', async () => {
    await postSaveArtifact(
      hubKey,
      'architect--define-architecture', // bound-mode task -- no picker
      'architecture-md',
      '## Architecture content',
      ['architect']
      // architectureId argument intentionally not supplied
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);

    // Field is absent from the JSON object (not present-as-undefined) so the
    // backend can use `'architectureId' in body` as a presence check.
    expect(Object.prototype.hasOwnProperty.call(body, 'architectureId')).toBe(false);
    // Sanity: the rest of the payload is intact.
    expect(body.taskId).toBe('architect--define-architecture');
    expect(body.artifactId).toBe('architecture-md');
  });
});
