/**
 * modelApi.saveModelByFilename Error Parsing Tests
 *
 * Step 1 of the 5-step save-validation improvement series (2026-05-08).
 *
 * The backend `GlobalExceptionHandler` returns a structured envelope on every
 * non-2xx response:
 *
 *   { timestamp, status, error, message, code?, field? }
 *
 * `saveModelByFilename` must parse that envelope and throw a `ModelApiError`
 * carrying the structured fields, with `.message` set to the most informative
 * human-readable string available (`message` -> `error` -> `${status} ${statusText}`).
 *
 * Tests:
 *   1. 400 with structured body `{message, code, field}` -> all four fields populated.
 *   2. 400 with bare `{message}` -> message populated, code/field undefined.
 *   3. 400 with non-JSON body -> fallback message is `400 Bad Request`.
 *   4. 500 with empty body -> fallback message uses status+statusText.
 *   5. 200 OK -> returns parsed JSON, hits the architecture-scoped URL.
 *   6. (Spec 2026-05-11) Hits PUT /api/model/projects/<projectId>/architectures/<architectureId>?filename=<filename>
 *      for known input.
 *   7. (Spec 2026-05-11) Throws synchronously -- without issuing a fetch -- when
 *      `projectId` or `architectureId` is missing/empty (loud-failure contract).
 *
 * Test strategy: Vitest with vi.fn() shimming global.fetch (matches the pattern
 * used by `modelApi.exportInfrastructureTerraform.test.ts` in this directory).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { saveModelByFilename } from '../modelApi';
import { ModelApiError } from '../types/modelApiError';
import type { ArchitectureModel } from '../../types/model';

/**
 * Minimal stand-in ArchitectureModel for these tests. The real model shape is
 * irrelevant -- `saveModelByFilename` only forwards it to
 * `prepareModelForApiSave` -> `JSON.stringify`. We pass an empty-but-typed
 * object via `as unknown as ArchitectureModel` to avoid pulling the whole
 * model fixture machinery into a test that is purely about response parsing.
 */
const FAKE_MODEL = {} as unknown as ArchitectureModel;
const FILENAME = 'test_model.json';
// Spec 2026-05-11: the architecture-scoped endpoint requires both ids on the
// path. Tests use stable fake UUIDs so URL assertions are unambiguous.
const PROJECT_ID = 'proj-uuid-001';
const ARCHITECTURE_ID = 'arch-uuid-001';

describe('modelApi.saveModelByFilename - error envelope parsing', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: 400 with full structured envelope -> all four fields populated
  // ---------------------------------------------------------------------------
  it('parses a 400 response with full structured envelope (message + code + field + error)', async () => {
    const envelope = {
      timestamp: '2026-05-08T12:34:56.000Z',
      status: 400,
      error: 'Bad Request',
      message: 'Architecture name must be unique within project',
      code: 'duplicate_name',
      field: 'name',
    };

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify(envelope),
      json: async () => envelope,
    } as unknown as Response);

    let thrown: unknown;
    try {
      await saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, FILENAME, FAKE_MODEL);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ModelApiError);
    const err = thrown as ModelApiError;

    // The .message MUST be the backend `message` field, not "400" / "Bad Request".
    expect(err.message).toBe('Architecture name must be unique within project');
    expect(err.status).toBe(400);
    expect(err.code).toBe('duplicate_name');
    expect(err.field).toBe('name');
    expect(err.errorCategory).toBe('Bad Request');
    expect(err.timestamp).toBe('2026-05-08T12:34:56.000Z');
    // rawBody preserved for debugging / logging.
    expect(err.rawBody).toBe(JSON.stringify(envelope));
  });

  // ---------------------------------------------------------------------------
  // Test 2: 400 with bare {message} -> only message populated
  // ---------------------------------------------------------------------------
  it('parses a 400 response with only `message` (code and field undefined)', async () => {
    const envelope = {
      message: 'projectId is required',
    };

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify(envelope),
    } as unknown as Response);

    let thrown: unknown;
    try {
      await saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, FILENAME, FAKE_MODEL);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ModelApiError);
    const err = thrown as ModelApiError;

    expect(err.message).toBe('projectId is required');
    expect(err.status).toBe(400);
    expect(err.code).toBeUndefined();
    expect(err.field).toBeUndefined();
    expect(err.errorCategory).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 3: 400 with non-JSON body -> fallback message uses status + statusText
  // ---------------------------------------------------------------------------
  it('falls back to `${status} ${statusText}` when the body is non-JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      // A reverse proxy or framework default sometimes returns a plain HTML
      // error page. We must not crash; we must fall back gracefully.
      text: async () => '<html><body>Bad Request</body></html>',
    } as unknown as Response);

    let thrown: unknown;
    try {
      await saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, FILENAME, FAKE_MODEL);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ModelApiError);
    const err = thrown as ModelApiError;

    expect(err.message).toBe('400 Bad Request');
    expect(err.status).toBe(400);
    expect(err.code).toBeUndefined();
    expect(err.field).toBeUndefined();
    // rawBody is still preserved for debugging.
    expect(err.rawBody).toBe('<html><body>Bad Request</body></html>');
  });

  // ---------------------------------------------------------------------------
  // Test 4: 500 with empty body -> fallback message uses status + statusText
  // ---------------------------------------------------------------------------
  it('falls back to `${status} ${statusText}` when the body is empty (500)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => '',
    } as unknown as Response);

    let thrown: unknown;
    try {
      await saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, FILENAME, FAKE_MODEL);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ModelApiError);
    const err = thrown as ModelApiError;

    expect(err.message).toBe('500 Internal Server Error');
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
    expect(err.field).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 5: 200 OK -> returns parsed JSON, does not throw, uses scoped URL
  // ---------------------------------------------------------------------------
  it('returns the parsed body and does NOT throw on a 200 OK response', async () => {
    const summary = {
      id: 'arch-123',
      filename: FILENAME,
      description: 'A saved architecture',
      created_at: '2026-05-08T12:00:00.000Z',
      updated_at: '2026-05-08T12:34:56.000Z',
      is_default: false,
      tags: '',
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => summary,
    } as unknown as Response);

    const result = await saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, FILENAME, FAKE_MODEL);

    expect(result).toEqual(summary);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Sanity-check the request was a PUT to the architecture-scoped endpoint.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/api/model/projects/${PROJECT_ID}/architectures/${ARCHITECTURE_ID}`);
    expect(url).toContain(`filename=${encodeURIComponent(FILENAME)}`);
    expect(init).toMatchObject({ method: 'PUT' });
  });

  // ---------------------------------------------------------------------------
  // Test 6 (Spec 2026-05-11): URL is the architecture-scoped path, not the
  // legacy filename-only URL. This is the primary regression assertion.
  // ---------------------------------------------------------------------------
  it('builds the architecture-scoped URL: /api/model/projects/<projectId>/architectures/<architectureId>?filename=<filename>', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: 'x', filename: FILENAME }),
    } as unknown as Response);

    await saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, FILENAME, FAKE_MODEL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];

    // Exact URL: the legacy /api/model?filename=... must NOT appear; the
    // path-segment form with both ids encoded must.
    expect(url).toBe(
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(
        ARCHITECTURE_ID
      )}?filename=${encodeURIComponent(FILENAME)}`
    );
    // Legacy URL must not be hit.
    expect(String(url)).not.toMatch(/^\/api\/model\?filename=/);
  });

  // ---------------------------------------------------------------------------
  // Test 7 (Spec 2026-05-11): loud-failure contract. Missing projectId or
  // architectureId throws a descriptive Error BEFORE issuing the fetch.
  // ---------------------------------------------------------------------------
  describe('loud-failure contract: missing projectId / architectureId / filename', () => {
    it('throws when projectId is empty string', async () => {
      await expect(
        saveModelByFilename('', ARCHITECTURE_ID, FILENAME, FAKE_MODEL)
      ).rejects.toThrow(/projectId is required/);
      // No fetch should have been issued.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when architectureId is empty string', async () => {
      await expect(
        saveModelByFilename(PROJECT_ID, '', FILENAME, FAKE_MODEL)
      ).rejects.toThrow(/architectureId is required/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when filename is empty string', async () => {
      await expect(
        saveModelByFilename(PROJECT_ID, ARCHITECTURE_ID, '', FAKE_MODEL)
      ).rejects.toThrow(/filename is required/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when projectId is undefined (cast through any to simulate caller bug)', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        saveModelByFilename(undefined as any, ARCHITECTURE_ID, FILENAME, FAKE_MODEL)
      ).rejects.toThrow(/projectId is required/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when architectureId is undefined (cast through any)', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        saveModelByFilename(PROJECT_ID, undefined as any, FILENAME, FAKE_MODEL)
      ).rejects.toThrow(/architectureId is required/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
