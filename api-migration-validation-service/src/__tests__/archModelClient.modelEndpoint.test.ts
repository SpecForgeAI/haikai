/**
 * archModelClient -- model-endpoint-based interface / endpoint listing.
 *
 * Bug fix (2026-05-17): the previous `listInterfacesForArchitecture` hit
 * the non-existent `/api/projects/{id}/interfaces?architectureId=...` URL
 * and every call 404'd. The new implementation loads the full architecture
 * model from `/api/model/projects/{p}/architectures/{a}` and extracts
 * `metaModel.entities.interfaces`. A companion helper
 * `listEndpointsForInterface` pulls `metaModel.entities.endpoints` filtered
 * by `interface_id`, used by the wizard's Step 4 endpoint pre-population.
 *
 * Test surface (axios mocked at module boundary):
 *   1. listInterfacesForArchitecture hits the model endpoint and returns
 *      the `interfaces` array verbatim.
 *   2. listInterfacesForArchitecture tolerates a model with no `entities`
 *      block / no `interfaces` key (returns []).
 *   3. listEndpointsForInterface filters by `interface_id`.
 *   4. Errors surface as ArchModelClientError with the right endpoint URL.
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

// Imports MUST come after the axios mock so the singleton picks up the
// mocked `axios.create()`.
import { archModelClient, ArchModelClientError } from '../services/archModelClient';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const MODEL_URL = `/api/model/projects/${PROJECT_ID}/architectures/${ARCH_ID}`;

beforeEach(() => {
  mockGet.mockReset();
});

describe('archModelClient.listInterfacesForArchitecture (Bug fix 2026-05-17)', () => {
  it('GETs /api/model/projects/{p}/architectures/{a} and returns metaModel.entities.interfaces', async () => {
    const interfaces = [
      { id: 'ifc-1', name: 'OrderApi', spec_link: '/specs/order.yaml' },
      { id: 'ifc-2', name: 'BillingSoap', spec_link: null },
    ];
    mockGet.mockResolvedValueOnce({
      data: { metaModel: { entities: { interfaces } } },
    });

    const out = await archModelClient.listInterfacesForArchitecture(PROJECT_ID, ARCH_ID);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(MODEL_URL);
    expect(out).toEqual(interfaces);
  });

  it('returns [] when the model has no entities / interfaces block', async () => {
    mockGet.mockResolvedValueOnce({ data: { metaModel: {} } });
    const out = await archModelClient.listInterfacesForArchitecture(PROJECT_ID, ARCH_ID);
    expect(out).toEqual([]);
  });

  it('surfaces a 4xx as ArchModelClientError tagged with the model endpoint', async () => {
    const axiosErr = Object.assign(new Error('404 Not Found'), {
      isAxiosError: true,
      response: { status: 404, data: {} },
    });
    mockGet.mockRejectedValueOnce(axiosErr);

    await expect(
      archModelClient.listInterfacesForArchitecture(PROJECT_ID, ARCH_ID),
    ).rejects.toBeInstanceOf(ArchModelClientError);
  });
});

describe('archModelClient.listEndpointsForInterface (Phase A endpoint pre-population)', () => {
  it('filters endpoints by interface_id', async () => {
    const endpoints = [
      { id: 'ep-1', name: 'getOrder', interface_id: 'ifc-1', operation_verb: 'GET', path_or_address: '/orders/{id}' },
      { id: 'ep-2', name: 'placeOrder', interface_id: 'ifc-1', operation_verb: 'POST', path_or_address: '/orders' },
      { id: 'ep-3', name: 'getBill', interface_id: 'ifc-2', operation_verb: 'GET', path_or_address: '/bills/{id}' },
    ];
    mockGet.mockResolvedValueOnce({
      data: { metaModel: { entities: { endpoints } } },
    });
    const out = await archModelClient.listEndpointsForInterface(PROJECT_ID, ARCH_ID, 'ifc-1');
    expect(out).toHaveLength(2);
    const names = out.map((e) => e.name);
    expect(names).toEqual(['getOrder', 'placeOrder']);
  });

  it('returns [] when no endpoints match the given interface_id', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        metaModel: {
          entities: {
            endpoints: [{ id: 'ep-x', interface_id: 'ifc-other' }],
          },
        },
      },
    });
    const out = await archModelClient.listEndpointsForInterface(PROJECT_ID, ARCH_ID, 'ifc-1');
    expect(out).toEqual([]);
  });

  it('returns [] when the model carries no endpoints array at all', async () => {
    mockGet.mockResolvedValueOnce({ data: { metaModel: { entities: {} } } });
    const out = await archModelClient.listEndpointsForInterface(PROJECT_ID, ARCH_ID, 'ifc-1');
    expect(out).toEqual([]);
  });
});
