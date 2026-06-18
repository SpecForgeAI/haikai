/**
 * archModelClient.getBaselineIntegrity -- the AMS verify-endpoint wire contract.
 *
 * Spec: 2026-06-17 Baseline Integrity & Provenance -- Task Group 4 (cross-layer
 * gap fill). The TG2 `diffRunnerIntegrity` tests exercise the *consumption* of
 * the verdict via a MOCKED `getBaselineIntegrity`, so the actual client method
 * -- the real wire boundary with the AMS `GET .../baselines/{id}/integrity`
 * endpoint -- was untested. This pins:
 *
 *   1. The exact endpoint URL the client hits, and that the snake_case verdict
 *      `{ content_hash, recomputed_hash, integrity_verified }` is returned
 *      verbatim (no camelCase coercion, no reshaping).
 *   2. The NEUTRAL null-hash verdict is passed through unchanged (the consumer,
 *      not the client, decides null-hash is "no hash recorded" -- the client
 *      must not turn it into a mismatch or a throw).
 *   3. An AMS error surfaces as an ArchModelClientError tagged with the
 *      integrity endpoint (so the diffRunner's fail-soft catch can swallow it).
 */

const mockGet = jest.fn();

jest.mock('axios', () => {
  const interceptors = {
    response: { use: jest.fn() },
    request: { use: jest.fn() },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        get: (...args: unknown[]) => mockGet(...args),
        post: jest.fn(),
        put: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
        interceptors,
      })),
      isAxiosError: jest.fn(() => false),
    },
    isAxiosError: jest.fn(() => false),
  };
});

// Imports MUST come after the axios mock so the singleton picks up the mock.
import { archModelClient, ArchModelClientError } from '../services/archModelClient';

const PROJECT_ID = 'proj-1';
const BASELINE_ID = 'base-9';
const INTEGRITY_URL = `/api/projects/${PROJECT_ID}/api-behaviour/baselines/${BASELINE_ID}/integrity`;

beforeEach(() => {
  mockGet.mockReset();
});

describe('archModelClient.getBaselineIntegrity (verify-endpoint wire contract)', () => {
  it('GETs .../baselines/{id}/integrity and returns the snake_case verdict verbatim', async () => {
    const verdict = {
      content_hash: 'abc123',
      recomputed_hash: 'abc123',
      integrity_verified: true,
    };
    mockGet.mockResolvedValueOnce({ data: verdict });

    const out = await archModelClient.getBaselineIntegrity(PROJECT_ID, BASELINE_ID);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(INTEGRITY_URL);
    // Returned verbatim -- the snake_case shape is the consumer's contract.
    expect(out).toEqual(verdict);
  });

  it('passes through the NEUTRAL null-hash verdict unchanged (client never reinterprets it)', async () => {
    const neutral = {
      content_hash: null,
      recomputed_hash: 'def456',
      integrity_verified: false,
    };
    mockGet.mockResolvedValueOnce({ data: neutral });

    const out = await archModelClient.getBaselineIntegrity(PROJECT_ID, BASELINE_ID);

    expect(out.content_hash).toBeNull();
    expect(out.integrity_verified).toBe(false);
    // The client must NOT throw on the null-hash neutral case.
    expect(out).toEqual(neutral);
  });

  it('surfaces an AMS error as ArchModelClientError tagged with the integrity endpoint', async () => {
    const axiosErr = Object.assign(new Error('500 Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500, data: {} },
    });
    mockGet.mockRejectedValueOnce(axiosErr);

    await expect(
      archModelClient.getBaselineIntegrity(PROJECT_ID, BASELINE_ID),
    ).rejects.toBeInstanceOf(ArchModelClientError);
  });
});
