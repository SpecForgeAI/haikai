/**
 * Tests for the Target Manifest Artifacts gateway -> AMS client.
 *
 * Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 2 (task 2.1).
 *
 * Covers ONLY the contract this spec owns (per the 2-8 focused-tests budget):
 *   (a) the WRITE seam POSTs the correct snake_case body to the write URL;
 *   (b) the READ seam GETs the read URL and maps the snake_case wire response to
 *       the typed interface (verbatim content / package_lock_content preserved);
 *   (c) path params are encodeURIComponent-escaped;
 *   (d) a non-2xx surfaces to the caller (the client does NOT swallow).
 *
 * `fetch` is stubbed; no live AMS required. Mirrors the
 * `implementationLlmProxyClient.test.ts` posture (mock logger, stub
 * global.fetch, set env, fresh require per test).
 */

// Mock logger to prevent console output during tests.
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('targetManifestArtifactsClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  const PROJECT_ID = 'proj-1';
  const TARGET_ARCH_ID = 'arch-9';
  const BASE_URL = 'http://ams.test:8080';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // config.loadConfig requires OPENAI_API_KEY; point AMS at our test base url.
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.ARCHITECTURE_MODEL_SERVICE_URL = BASE_URL;

    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe('persistTargetManifestArtifacts (WRITE seam)', () => {
    it('POSTs the snake_case artifacts body to the manifest-artifacts URL', async () => {
      const { persistTargetManifestArtifacts } = require('../targetManifestArtifactsClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const verbatimPom = '<project>\n  <artifactId>svc</artifactId>\n</project>\n';
      const artifacts = [
        {
          tag: 'orders-service',
          kind: 'pom',
          ecosystem: 'MAVEN',
          manifest_path: 'pom.xml',
          content: verbatimPom,
          package_lock_content: null,
          resolved_dependencies: [{ name: 'a:b', resolvedVersion: '1.2.3' }],
        },
      ];

      await persistTargetManifestArtifacts(PROJECT_ID, TARGET_ARCH_ID, artifacts);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toBe(
        `${BASE_URL}/api/model/projects/${PROJECT_ID}` +
          `/target-architectures/${TARGET_ARCH_ID}/manifest-artifacts`,
      );
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      const parsed = JSON.parse(options.body);
      // Body is the { artifacts: [...] } wrapper the AMS request DTO expects.
      expect(parsed).toEqual({ artifacts });
      // Verbatim content survives serialization byte-for-byte (trailing newline kept).
      expect(parsed.artifacts[0].content).toBe(verbatimPom);
      expect(parsed.artifacts[0].manifest_path).toBe('pom.xml');
      expect(parsed.artifacts[0].package_lock_content).toBeNull();
    });

    it('returns the persisted latest list mapped to the typed wire shape', async () => {
      const { persistTargetManifestArtifacts } = require('../targetManifestArtifactsClient');

      const wireRow = {
        id: 'row-1',
        project_id: PROJECT_ID,
        target_architecture_id: TARGET_ARCH_ID,
        tag: 'orders-service',
        kind: 'pom',
        ecosystem: 'MAVEN',
        manifest_path: 'pom.xml',
        content: '<project/>\n',
        package_lock_content: null,
        resolved_dependencies: [],
        is_latest: true,
        created_at: '2026-06-25T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([wireRow]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await persistTargetManifestArtifacts(PROJECT_ID, TARGET_ARCH_ID, []);
      expect(result).toEqual([wireRow]);
      expect(result[0].content).toBe('<project/>\n');
    });

    it('throws (does not swallow) on a non-2xx response so the caller can degrade', async () => {
      const { persistTargetManifestArtifacts } = require('../targetManifestArtifactsClient');

      mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));

      await expect(
        persistTargetManifestArtifacts(PROJECT_ID, TARGET_ARCH_ID, []),
      ).rejects.toThrow(/HTTP 500/);
    });
  });

  describe('fetchLatestTargetManifestArtifacts (READ seam)', () => {
    it('GETs the manifest-artifacts URL and maps the snake_case response verbatim', async () => {
      const { fetchLatestTargetManifestArtifacts } = require('../targetManifestArtifactsClient');

      const verbatimLock = '{\n  "name": "svc",\n  "lockfileVersion": 3\n}\n';
      const wireRow = {
        id: 'row-2',
        project_id: PROJECT_ID,
        target_architecture_id: TARGET_ARCH_ID,
        tag: 'web-app',
        kind: 'package_json',
        ecosystem: 'NPM',
        manifest_path: 'package.json',
        content: '{\n  "name": "svc"\n}\n',
        package_lock_content: verbatimLock,
        resolved_dependencies: [{ name: 'left-pad', resolvedVersion: '1.3.0' }],
        is_latest: true,
        created_at: '2026-06-25T01:00:00Z',
      };

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([wireRow]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await fetchLatestTargetManifestArtifacts(PROJECT_ID, TARGET_ARCH_ID);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `${BASE_URL}/api/model/projects/${PROJECT_ID}` +
          `/target-architectures/${TARGET_ARCH_ID}/manifest-artifacts`,
      );
      expect(options.method).toBe('GET');

      expect(result).toEqual([wireRow]);
      // Verbatim content + lockfile preserved byte-for-byte through the read.
      expect(result[0].content).toBe('{\n  "name": "svc"\n}\n');
      expect(result[0].package_lock_content).toBe(verbatimLock);
    });

    it('encodeURIComponent-escapes both path params', async () => {
      const { fetchLatestTargetManifestArtifacts } = require('../targetManifestArtifactsClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await fetchLatestTargetManifestArtifacts('p/1 a', 'arch#2');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        `${BASE_URL}/api/model/projects/p%2F1%20a` +
          `/target-architectures/arch%232/manifest-artifacts`,
      );
    });

    it('throws (does not swallow) on a non-2xx response so the caller can degrade', async () => {
      const { fetchLatestTargetManifestArtifacts } = require('../targetManifestArtifactsClient');

      mockFetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));

      await expect(
        fetchLatestTargetManifestArtifacts(PROJECT_ID, TARGET_ARCH_ID),
      ).rejects.toThrow(/HTTP 404/);
    });
  });
});
