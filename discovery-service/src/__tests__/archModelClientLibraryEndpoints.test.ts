/**
 * archModelClient — Library + CodeUnitDependency endpoint client tests.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 4.
 *
 * Mocks axios at the module boundary; verifies URL shape, snake_case body,
 * response parsing, and error propagation. Mirrors the existing
 * `archModelClient.test.ts` setup pattern (jest.mock('axios') + axios.create).
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));
jest.mock('axios');

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';
const RUN_ID = 'run-uuid-1';

describe('archModelClient — Library + CodeUnitDependency endpoints (Spec 2026-05-06)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('getLibrary builds the correct GET URL and parses the snake_case response', async () => {
    const libraryId = 'lib-uuid-1';
    const mockLibrary = {
      id: libraryId,
      name: 'org.springframework:spring-core',
      ecosystem: 'MAVEN',
      repo_location: 'https://github.com/example/repo',
      repo_subfolder: 'libs/spring-core',
      source_origin: 'DISCOVERED',
      source_system: 'discovery-service',
      source_reference: RUN_ID,
      last_verified_at: '2026-05-06T10:00:00Z',
      generation_status: 'completed',
    };

    const axios = require('axios');
    const mockGet = jest.fn().mockResolvedValue({ data: mockLibrary });
    axios.create = jest.fn().mockReturnValue({
      get: mockGet,
      post: jest.fn(),
      interceptors: { response: { use: jest.fn() } },
    });

    const { archModelClient } = require('../services/archModelClient');
    const result = await archModelClient.getLibrary(PROJECT_ID, ARCH_ID, libraryId);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID)}/libraries/${encodeURIComponent(libraryId)}`,
    );
    expect(result).toEqual(mockLibrary);
    expect(result?.id).toBe(libraryId);
    expect(result?.repo_subfolder).toBe('libs/spring-core');
  });

  it('getLibrary returns null on 404 (not found)', async () => {
    const axios = require('axios');
    const err: any = new Error('Not Found');
    err.response = { status: 404, data: { error: 'not found' } };
    const mockGet = jest.fn().mockRejectedValue(err);
    axios.create = jest.fn().mockReturnValue({
      get: mockGet,
      post: jest.fn(),
      interceptors: { response: { use: jest.fn() } },
    });

    const { archModelClient } = require('../services/archModelClient');
    const result = await archModelClient.getLibrary(PROJECT_ID, ARCH_ID, 'missing');
    expect(result).toBeNull();
  });

  it('findOrCreateLibrary POSTs snake_case body and parses {id, derived_application_point_id, is_new, library}', async () => {
    const payload = {
      name: 'com.example:internal-lib',
      ecosystem: 'MAVEN',
      repo_location: null,
      repo_subfolder: 'libs/internal-lib',
      source_origin: 'DISCOVERED',
      source_system: 'discovery-service',
      source_reference: RUN_ID,
      last_verified_at: '2026-05-06T10:00:00Z',
      generation_status: 'completed',
    };
    const mockResp = {
      id: 'lib-uuid-2',
      derived_application_point_id: 'ap-uuid-2',
      is_new: true,
      library: {
        id: 'lib-uuid-2',
        name: 'com.example:internal-lib',
        ecosystem: 'MAVEN',
      },
    };

    const axios = require('axios');
    const mockPost = jest.fn().mockResolvedValue({ data: mockResp });
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      post: mockPost,
      interceptors: { response: { use: jest.fn() } },
    });

    const { archModelClient } = require('../services/archModelClient');
    const result = await archModelClient.findOrCreateLibrary(PROJECT_ID, ARCH_ID, payload);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID)}/libraries`,
      payload,
    );
    expect(result).toEqual(mockResp);
    expect(result.is_new).toBe(true);
    expect(result.derived_application_point_id).toBe('ap-uuid-2');
  });

  it('findOrCreateCodeUnitDependency POSTs snake_case body with null declared_version and parses {id, is_new, code_unit_dependency}', async () => {
    const payload = {
      source_application_point_id: 'ap-source-1',
      target_application_point_id: 'ap-target-1',
      declared_name: 'com.example:internal-lib',
      declared_version: null,
      declared_version_range: null,
      scope: 'compile',
      manifest_path: 'pom.xml',
      manifest_line: 12,
      evidence_source: 'DISCOVERY_RESOLVER',
      confidence: 1.0,
    };
    const mockResp = {
      id: 'edge-uuid-1',
      is_new: false,
      code_unit_dependency: {
        id: 'edge-uuid-1',
        source_application_point_id: 'ap-source-1',
        target_application_point_id: 'ap-target-1',
        declared_name: 'com.example:internal-lib',
        scope: 'compile',
        manifest_path: 'pom.xml',
      },
    };

    const axios = require('axios');
    const mockPost = jest.fn().mockResolvedValue({ data: mockResp });
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      post: mockPost,
      interceptors: { response: { use: jest.fn() } },
    });

    const { archModelClient } = require('../services/archModelClient');
    const result = await archModelClient.findOrCreateCodeUnitDependency(PROJECT_ID, ARCH_ID, payload);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID)}/code-unit-dependencies`,
      payload,
    );
    expect(result).toEqual(mockResp);
    expect(result.is_new).toBe(false);
  });

  it('buildLibraryFindOrCreatePayload sets all 5 source-provenance fields', () => {
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({ get: jest.fn(), post: jest.fn(), interceptors: { response: { use: jest.fn() } } });
    const { buildLibraryFindOrCreatePayload } = require('../services/archModelClient');
    const before = Date.now();
    const payload = buildLibraryFindOrCreatePayload({
      name: 'com.example:foo',
      ecosystem: 'MAVEN',
      runId: RUN_ID,
      repo_subfolder: 'libs/foo',
    });
    const after = Date.now();

    expect(payload.name).toBe('com.example:foo');
    expect(payload.ecosystem).toBe('MAVEN');
    expect(payload.repo_location).toBeNull();
    expect(payload.repo_subfolder).toBe('libs/foo');
    expect(payload.source_origin).toBe('DISCOVERED');
    expect(payload.source_system).toBe('discovery-service');
    expect(payload.source_reference).toBe(RUN_ID);
    expect(payload.generation_status).toBe('completed');
    // last_verified_at is an ISO timestamp around now.
    const ts = Date.parse(payload.last_verified_at as string);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100);
  });

  it('buildCodeUnitDependencyFindOrCreatePayload sets locked evidence-source defaults', () => {
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({ get: jest.fn(), post: jest.fn(), interceptors: { response: { use: jest.fn() } } });
    const { buildCodeUnitDependencyFindOrCreatePayload } = require('../services/archModelClient');
    const payload = buildCodeUnitDependencyFindOrCreatePayload({
      source_application_point_id: 's',
      target_application_point_id: 't',
      declared_name: 'com.example:foo',
      declared_version: '1.0.0',
      scope: 'compile',
      manifest_path: 'pom.xml',
      manifest_line: 5,
    });

    expect(payload.evidence_source).toBe('DISCOVERY_RESOLVER');
    expect(payload.confidence).toBe(1.0);
    expect(payload.declared_version).toBe('1.0.0');
    expect(payload.declared_version_range).toBeNull();
    expect(payload.manifest_line).toBe(5);
  });
});
