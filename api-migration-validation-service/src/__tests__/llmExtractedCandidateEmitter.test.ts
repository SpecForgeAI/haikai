/**
 * Tests for the Workstream A LLM-extracted candidate emitter
 * (`services/llmExtractedCandidateEmitter.ts`, Task Group 7).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2),
 *       Task Group 7 (LLM-Extracted Candidate Emit +
 *       `discovery_method='llm_extraction'`).
 *
 * Test coverage (per the Group 7 task description):
 *   1. Three ops with mixed confidence tiers -> three endpoint candidates
 *      emitted, parent interface candidate linked,
 *      `discovery_method='llm_extraction'` on every emitted candidate,
 *      `confidence_tier` tagged correctly.
 *   2. Zero ops -> zero candidates emitted, no parent interface candidate,
 *      `bulkSaveCandidates` NOT called.
 *   3. Round-trip shape: the emitted candidate's `data` carries the seven
 *      SOAP fields contract + `discovery_method` + `confidence_tier` that
 *      `mcp-server/src/services/candidateSaveBackService.ts` case 'endpoints'
 *      reads to build `protocol_metadata_json`.
 *   4. Idempotency: emitting the same operation twice for the same interface
 *      -- the second call produces zero new candidates because the first
 *      call's endpoints are now in the architecture model and the dedup
 *      keys (`name`, `soap_action`) catch them.
 *
 * No HTTP I/O. Both the architecture-model read surface and the
 * `bulkSaveCandidates` write surface are injected as jest stubs.
 */

import {
  emitLlmExtractedCandidates,
  type ArchModelReader,
  type BulkSaveCandidatesFn,
  type DiscoveryCandidateShape,
  type LlmExtractedEmitArgs,
} from '../services/llmExtractedCandidateEmitter';
import type { ProposedOperation } from '../services/tools/propose_endpoints_from_code';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-llm-emit';
const ARCH_ID = 'arch-llm-emit';
const RUN_ID = 'run-llm-emit';
const PARENT_INTERFACE_NAME = 'CustomerAccountSoap';
const PARENT_SERVICE_NAME = 'CustomerAccountService';

/** Build a deterministic id factory so tests can pin candidate ids verbatim. */
function buildIdFactory(prefix = 'id'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n.toString().padStart(4, '0')}`;
  };
}

function buildBaseArgs(
  overrides: Partial<LlmExtractedEmitArgs> = {},
): LlmExtractedEmitArgs {
  return {
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    runId: RUN_ID,
    parentServiceName: PARENT_SERVICE_NAME,
    parentInterfaceName: PARENT_INTERFACE_NAME,
    operations: [],
    ...overrides,
  };
}

function buildReader(
  opts: {
    interfaces?: Array<Record<string, unknown>>;
    endpointsByInterface?: Record<string, Array<Record<string, unknown>>>;
  } = {},
): {
  reader: ArchModelReader;
  listInterfaces: jest.Mock;
  listEndpoints: jest.Mock;
} {
  const listInterfaces = jest.fn(async () => opts.interfaces ?? []);
  const listEndpoints = jest.fn(
    async (
      _projectId: string,
      _archId: string,
      interfaceId: string,
    ) => opts.endpointsByInterface?.[interfaceId] ?? [],
  );
  return {
    reader: {
      listInterfacesForArchitecture: listInterfaces,
      listEndpointsForInterface: listEndpoints,
    },
    listInterfaces,
    listEndpoints,
  };
}

function buildBulkSave(): {
  fn: BulkSaveCandidatesFn;
  mock: jest.Mock;
  /**
   * Convenience -- the merged candidate batch flattened across all
   * invocations (the emitter currently issues a single batch, but the
   * helper does not assume that).
   */
  capturedAll: () => DiscoveryCandidateShape[];
} {
  const mock = jest.fn<Promise<void>, [string, string, string, DiscoveryCandidateShape[]]>(
    async () => {},
  );
  const fn: BulkSaveCandidatesFn = (projectId, archId, runId, candidates) =>
    mock(projectId, archId, runId, candidates);
  return {
    fn,
    mock,
    capturedAll: () =>
      mock.mock.calls.flatMap(
        (call) => call[3] as DiscoveryCandidateShape[],
      ),
  };
}

/**
 * The seven Phase-1 SOAP field names the save-back service reads from the
 * candidate's `data` to build the `protocol_metadata_json` JSONB blob
 * (mirrors `mcp-server/.../candidateSaveBackService.ts ->
 * SOAP_PROTOCOL_METADATA_FIELDS`, minus the Phase 2 additions which are
 * asserted separately below).
 */
const SOAP_DATA_FIELDS = [
  'soap_action',
  'request_root_element',
  'request_namespace',
  'response_root_element',
  'request_dto_class',
  'response_dto_class',
  'wsdl_source',
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitLlmExtractedCandidates', () => {
  // -------------------------------------------------------------------------
  // Test 1: Three operations, mixed confidence tiers
  // -------------------------------------------------------------------------
  it('emits three endpoint candidates + a parent interface candidate when no existing interface is present', async () => {
    const { reader } = buildReader(); // No existing interfaces.
    const { fn, capturedAll } = buildBulkSave();
    const idFactory = buildIdFactory('cand');

    const operations: ProposedOperation[] = [
      {
        operationName: 'getAccount',
        confidence: 0.85,
        confidence_tier: 'default',
        soapAction: 'urn:getAccount',
        requestRootElement: 'GetAccountRequest',
        responseRootElement: 'GetAccountResponse',
        requestDtoClass: 'com.acme.GetAccountRequest',
        responseDtoClass: 'com.acme.GetAccountResponse',
      },
      {
        operationName: 'createOrder',
        confidence: 0.55,
        confidence_tier: 'low',
        soapAction: 'urn:createOrder',
        requestDtoClass: 'com.acme.CreateOrderRequest',
      },
      {
        operationName: 'queryInventory',
        confidence: 0.65,
        confidence_tier: 'low',
        path: '/services/Inventory',
      },
    ];

    const result = await emitLlmExtractedCandidates(
      buildBaseArgs({ operations }),
      {
        archModelReader: reader,
        bulkSaveCandidates: fn,
        idFactory,
        nowIso: () => '2026-05-17T00:00:00.000Z',
      },
    );

    // 1a. Three endpoint candidates emitted.
    expect(result.endpointCandidates).toHaveLength(3);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.lowConfidenceCount).toBe(2);

    // 1b. Parent interface candidate emitted (no existing match).
    expect(result.parentInterfaceCandidate).not.toBeNull();
    expect(result.parentInterfaceCandidate?.candidateType).toBe('interfaces');
    expect(result.parentInterfaceCandidate?.name).toBe(PARENT_INTERFACE_NAME);
    expect(result.parentInterfaceCandidate?.data.interface_type).toBe('SOAP_API');
    expect(result.parentInterfaceCandidate?.data.discovery_method).toBe(
      'llm_extraction',
    );

    // 1c. Every endpoint candidate links back to the parent interface.
    for (const ep of result.endpointCandidates) {
      expect(ep.parentCandidateId).toBe(result.parentInterfaceCandidate?.id);
      expect(ep.data.interface_id).toBe(result.parentInterfaceCandidate?.id);
      expect(ep.data.operation_verb).toBe('POST');
      expect(ep.data.discovery_method).toBe('llm_extraction');
    }

    // 1d. Confidence tiers tagged correctly on the data blob.
    const byName = new Map(result.endpointCandidates.map((c) => [c.name, c]));
    expect(byName.get('getAccount')?.data.confidence_tier).toBe('default');
    expect(byName.get('createOrder')?.data.confidence_tier).toBe('low');
    expect(byName.get('queryInventory')?.data.confidence_tier).toBe('low');

    // 1e. The bulk-save batch carried the parent + every endpoint.
    const all = capturedAll();
    expect(all).toHaveLength(4); // 1 parent + 3 endpoints
    expect(all.filter((c) => c.candidateType === 'interfaces')).toHaveLength(1);
    expect(all.filter((c) => c.candidateType === 'endpoints')).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Test 2: Zero ops -> zero candidates, no parent, no save-back
  // -------------------------------------------------------------------------
  it('emits zero candidates and does NOT call bulkSaveCandidates when the operations list is empty', async () => {
    const { reader, listInterfaces } = buildReader();
    const { fn, mock } = buildBulkSave();

    const result = await emitLlmExtractedCandidates(
      buildBaseArgs({ operations: [] }),
      {
        archModelReader: reader,
        bulkSaveCandidates: fn,
        idFactory: buildIdFactory('cand'),
      },
    );

    expect(result.endpointCandidates).toHaveLength(0);
    expect(result.parentInterfaceCandidate).toBeNull();
    expect(result.skippedDuplicates).toBe(0);
    expect(result.lowConfidenceCount).toBe(0);
    // Short-circuit: no save-back POST, no model read.
    expect(mock).not.toHaveBeenCalled();
    expect(listInterfaces).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: Round-trip shape match against candidateSaveBackService contract
  // -------------------------------------------------------------------------
  it('produces a candidate whose `data` carries the seven Phase 1 SOAP fields + discovery_method + confidence_tier', async () => {
    const { reader } = buildReader();
    const { fn, capturedAll } = buildBulkSave();

    const operations: ProposedOperation[] = [
      {
        operationName: 'computeFee',
        confidence: 0.9,
        confidence_tier: 'default',
        soapAction: 'urn:computeFee',
        requestRootElement: 'ComputeFeeRequest',
        responseRootElement: 'ComputeFeeResponse',
        requestDtoClass: 'com.acme.FeeRequest',
        responseDtoClass: 'com.acme.FeeResponse',
        path: '/services/Fee',
      },
    ];

    await emitLlmExtractedCandidates(
      buildBaseArgs({ operations }),
      {
        archModelReader: reader,
        bulkSaveCandidates: fn,
        idFactory: buildIdFactory('cand'),
      },
    );

    const all = capturedAll();
    const endpoint = all.find((c) => c.candidateType === 'endpoints');
    expect(endpoint).toBeDefined();
    const data = endpoint!.data;

    // Every SOAP field name from the save-back contract is present as a
    // key on the candidate's `data` (mirrors what `case 'endpoints'` in
    // `candidateSaveBackService.ts` reads via `buildSoapProtocolMetadata`).
    for (const key of SOAP_DATA_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(data, key)).toBe(true);
    }
    // Populated fields carry their LLM-supplied values.
    expect(data.soap_action).toBe('urn:computeFee');
    expect(data.request_root_element).toBe('ComputeFeeRequest');
    expect(data.response_root_element).toBe('ComputeFeeResponse');
    expect(data.request_dto_class).toBe('com.acme.FeeRequest');
    expect(data.response_dto_class).toBe('com.acme.FeeResponse');
    // LLM extraction never produces WSDL-derived fields by construction --
    // they are present as keys but explicitly `undefined`.
    expect(data.request_namespace).toBeUndefined();
    expect(data.wsdl_source).toBeUndefined();

    // Phase 2 trace metadata + low-confidence chip signal.
    expect(data.discovery_method).toBe('llm_extraction');
    expect(data.confidence_tier).toBe('default');

    // Standard endpoint shape fields the save-back service consumes.
    expect(data.operation_verb).toBe('POST');
    expect(data.path_or_address).toBe('/services/Fee');
    expect(typeof data.interface_id).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Test 4: Idempotency -- re-running the same emit produces zero net-new
  // -------------------------------------------------------------------------
  it('emits zero new endpoint candidates on a second run when the operations already exist under the parent interface', async () => {
    const existingInterfaceId = 'arch-iface-existing-001';
    const operations: ProposedOperation[] = [
      {
        operationName: 'getAccount',
        confidence: 0.85,
        confidence_tier: 'default',
        soapAction: 'urn:getAccount',
      },
      {
        operationName: 'createOrder',
        confidence: 0.85,
        confidence_tier: 'default',
        soapAction: 'urn:createOrder',
      },
    ];

    // First call: interface exists in the model but it has NO endpoints
    // yet. The emitter should produce both endpoint candidates and call
    // `bulkSaveCandidates` once.
    const firstReader = buildReader({
      interfaces: [
        {
          id: existingInterfaceId,
          name: PARENT_INTERFACE_NAME,
          interface_type: 'SOAP_API',
        },
      ],
      endpointsByInterface: { [existingInterfaceId]: [] },
    });
    const firstSave = buildBulkSave();

    const first = await emitLlmExtractedCandidates(
      buildBaseArgs({ operations }),
      {
        archModelReader: firstReader.reader,
        bulkSaveCandidates: firstSave.fn,
        idFactory: buildIdFactory('cand'),
      },
    );

    expect(first.parentInterfaceCandidate).toBeNull(); // reused existing
    expect(first.endpointCandidates).toHaveLength(2);
    expect(first.resolvedParentInterfaceId).toBe(existingInterfaceId);
    expect(firstSave.mock).toHaveBeenCalledTimes(1);
    // Only endpoint candidates landed -- no fresh parent interface
    // candidate in the persisted batch (the interface was reused).
    expect(firstSave.capturedAll().every((c) => c.candidateType === 'endpoints')).toBe(true);

    // Second call: simulate the first call's persistence by surfacing the
    // saved endpoints back through the reader. Both operations now match
    // dedup keys, so the second call must emit zero net-new candidates.
    const persistedEndpoints = first.endpointCandidates.map((c) => ({
      id: c.id,
      name: c.name,
      protocol_metadata_json: { soap_action: c.data.soap_action },
    }));

    const secondReader = buildReader({
      interfaces: [
        {
          id: existingInterfaceId,
          name: PARENT_INTERFACE_NAME,
          interface_type: 'SOAP_API',
        },
      ],
      endpointsByInterface: { [existingInterfaceId]: persistedEndpoints },
    });
    const secondSave = buildBulkSave();

    const second = await emitLlmExtractedCandidates(
      buildBaseArgs({ operations }),
      {
        archModelReader: secondReader.reader,
        bulkSaveCandidates: secondSave.fn,
        idFactory: buildIdFactory('cand2'),
      },
    );

    expect(second.endpointCandidates).toHaveLength(0);
    expect(second.parentInterfaceCandidate).toBeNull();
    expect(second.skippedDuplicates).toBe(2);
    // No save-back POST when nothing new lands.
    expect(secondSave.mock).not.toHaveBeenCalled();
  });
});
