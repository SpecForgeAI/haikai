/**
 * End-to-end fixture test for Workstream A (Task Group 10).
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2),
 *       Task Group 10 (Workstream A End-to-End Fixture Test).
 *
 * --------------------------------------------------------------------------
 * What this proves
 * --------------------------------------------------------------------------
 * The acceptance signal for Workstream A, per the raw idea and tasks.md
 * Group 10:
 *
 *   > "the user's reference SOAP service (the one Phase 1 couldn't extract
 *    anything from) produces non-zero LLM-extracted endpoint candidates
 *    after this spec lands"
 *
 * Concretely, we feed the Group 5 `propose_endpoints_from_code` tool a
 * hand-rolled Java SOAP dispatcher servlet fixture -- the same pattern the
 * user's reference service hit, with NO `@Endpoint`, NO `@WebService`, and
 * NO `.wsdl` artefact -- and pipe its output through the Group 7
 * `llmExtractedCandidateEmitter` to assert that:
 *
 *   - >= 2 endpoint candidates are emitted, each carrying
 *     `data.discovery_method = 'llm_extraction'` (W-10).
 *   - The parent SOAP interface candidate carries
 *     `data.interface_type = 'SOAP_API'` (Phase 1 contract preserved).
 *   - At least one candidate falls into the 0.4 <= confidence < 0.7 tier so
 *     the `data.low_confidence` / `data.confidence_tier='low'` marker path
 *     is exercised end-to-end (W-8).
 *   - No exceptions are thrown anywhere along the path.
 *
 * --------------------------------------------------------------------------
 * What is mocked vs real
 * --------------------------------------------------------------------------
 * Real (in this test):
 *   - `proposeEndpointsFromCode` (Group 5) -- real module, real prompt-build,
 *      real schema-validation, real confidence-tier filter.
 *   - `emitLlmExtractedCandidates` (Group 7) -- real module, real candidate
 *      construction, real dedup keys.
 *
 * Mocked / stubbed:
 *   - LLM gateway client -- a scripted `callLlmToolLoop` returns a plausible
 *      JSON array as if a real LLM read the fixture file. The shape of the
 *      response mirrors what a real LLM would emit for this fixture.
 *   - Source-file fetch -- replaced with the `inlineSnippets` shortcut on
 *      Group 5's `ProposeEndpointsArgs` so no HTTP call is made to
 *      discovery-service. The fixture file is loaded from disk by the test.
 *   - Architecture-model reader and `bulkSaveCandidates` -- in-memory stubs
 *      so the emitter's persistence path can be observed without an HTTP
 *      round-trip to AMS.
 */

import { promises as fs } from 'fs';
import path from 'path';

import {
  proposeEndpointsFromCode,
  type ProposeEndpointsArgs,
  type ProposedOperation,
} from '../services/tools/propose_endpoints_from_code';
import {
  emitLlmExtractedCandidates,
  type ArchModelReader,
  type BulkSaveCandidatesFn,
  type DiscoveryCandidateShape,
} from '../services/llmExtractedCandidateEmitter';
import type { GatewayClient } from '../services/gatewayClient';
import type { AssistantMessage } from '../types/llm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2',
  'planning',
  'visuals',
  'fixture-hand-rolled-soap-dispatcher.java',
);

const REPO_RELATIVE_FIXTURE_PATH =
  'src/main/java/com/example/legacy/soap/CustomerAccountDispatcherServlet.java';

const BASE_ARGS: Omit<ProposeEndpointsArgs, 'inlineSnippets' | 'sessionId'> = {
  interfaceCandidateId: 'iface-e2e-soap-001',
  parentServiceId: 'svc-e2e-001',
  parentServiceName: 'CustomerAccountService',
  parentInterfaceName: 'CustomerAccountSoap',
  runId: 'run-e2e-aaaa',
  projectId: 'proj-e2e-001',
  architectureId: 'arch-e2e-001',
  sourceFilePaths: [REPO_RELATIVE_FIXTURE_PATH],
};

// ---------------------------------------------------------------------------
// Plausible LLM response for the fixture
// ---------------------------------------------------------------------------

/**
 * What a real LLM would plausibly emit for the fixture file. Two clearly-named
 * SOAPAction handlers (`getAccount`, `createOrder`) at high confidence, plus
 * a "deep handler" inferred from the body-root-fallback branch at mid
 * confidence -- the latter exercises the low-confidence tier so the
 * `confidence_tier='low'` marker reaches the persisted candidate.
 */
const PLAUSIBLE_LLM_RESPONSE = JSON.stringify([
  {
    operationName: 'getAccount',
    soapAction: 'urn:CustomerAccount/getAccount',
    requestRootElement: 'GetAccountRequest',
    responseRootElement: 'GetAccountResponse',
    requestDtoClass: 'com.example.legacy.soap.dto.GetAccountRequest',
    responseDtoClass: 'com.example.legacy.soap.dto.GetAccountResponse',
    confidence: 0.92,
  },
  {
    operationName: 'createOrder',
    soapAction: 'urn:CustomerAccount/createOrder',
    requestRootElement: 'CreateOrderRequest',
    responseRootElement: 'CreateOrderResponse',
    requestDtoClass: 'com.example.legacy.soap.dto.CreateOrderRequest',
    responseDtoClass: 'com.example.legacy.soap.dto.CreateOrderResponse',
    confidence: 0.86,
  },
  // The fallback-by-root-element branch is a weaker signal -- the LLM
  // expresses lower confidence here so the candidate flows into the
  // 0.4 <= conf < 0.7 "low" tier and exercises the `low_confidence=true`
  // marker path end-to-end.
  {
    operationName: 'dispatchByBodyRoot',
    requestRootElement: 'GetAccountRequest',
    confidence: 0.55,
  },
]);

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

function buildStubGateway(content: string): {
  client: Pick<GatewayClient, 'callLlmToolLoop'>;
  calls: Array<Parameters<GatewayClient['callLlmToolLoop']>[0]>;
} {
  const calls: Array<Parameters<GatewayClient['callLlmToolLoop']>[0]> = [];
  const callLlmToolLoop = jest.fn(
    async (req: Parameters<GatewayClient['callLlmToolLoop']>[0]) => {
      calls.push(req);
      const message: AssistantMessage = { role: 'assistant', content };
      return { message };
    },
  );
  return {
    client: { callLlmToolLoop } as Pick<GatewayClient, 'callLlmToolLoop'>,
    calls,
  };
}

function buildReader(): ArchModelReader {
  // No existing interfaces / endpoints in the model -- the emitter should
  // produce a fresh parent SOAP interface candidate plus all endpoints.
  return {
    listInterfacesForArchitecture: jest.fn(async () => []),
    listEndpointsForInterface: jest.fn(async () => []),
  };
}

function buildBulkSave(): {
  fn: BulkSaveCandidatesFn;
  mock: jest.Mock<
    Promise<void>,
    [string, string, string, DiscoveryCandidateShape[]]
  >;
} {
  const mock = jest.fn<
    Promise<void>,
    [string, string, string, DiscoveryCandidateShape[]]
  >(async () => {});
  const fn: BulkSaveCandidatesFn = (projectId, archId, runId, candidates) =>
    mock(projectId, archId, runId, candidates);
  return { fn, mock };
}

function buildIdFactory(prefix = 'e2e'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n.toString().padStart(4, '0')}`;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workstream A end-to-end fixture (Group 10)', () => {
  let fixtureSource: string;

  beforeAll(async () => {
    fixtureSource = await fs.readFile(FIXTURE_PATH, 'utf8');
  });

  it('produces >=2 LLM-extracted endpoint candidates from the hand-rolled SOAP dispatcher fixture', async () => {
    // ---------------------------------------------------------------------
    // Step A: Run the Group 5 tool against the fixture with a scripted LLM.
    // ---------------------------------------------------------------------
    const { client: gatewayClient, calls } = buildStubGateway(PLAUSIBLE_LLM_RESPONSE);

    const proposeResult = await proposeEndpointsFromCode(
      {
        ...BASE_ARGS,
        sessionId: 'e2e-session-happy',
        inlineSnippets: { [REPO_RELATIVE_FIXTURE_PATH]: fixtureSource },
      },
      { gatewayClient },
    );

    // No malformed / clone-evicted short-circuit.
    expect(proposeResult.malformed).toBeFalsy();
    expect(proposeResult.cloneEvicted).toBeFalsy();
    // The 0.92 + 0.86 + 0.55 ops all survive the >=0.4 filter.
    expect(proposeResult.operations).toHaveLength(3);

    // Sanity: the LLM saw the real fixture's parent names + content.
    expect(calls).toHaveLength(1);
    const userMsg = calls[0].messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('CustomerAccountSoap');
    expect(userMsg?.content).toContain('CustomerAccountService');
    expect(userMsg?.content).toContain('CustomerAccountDispatcherServlet');

    // At least one low-confidence tier survived for the persistence step
    // below to exercise the marker path.
    const lowTier = proposeResult.operations.filter(
      (op: ProposedOperation) => op.confidence_tier === 'low',
    );
    const defaultTier = proposeResult.operations.filter(
      (op: ProposedOperation) => op.confidence_tier === 'default',
    );
    expect(lowTier.length).toBeGreaterThanOrEqual(1);
    expect(defaultTier.length).toBeGreaterThanOrEqual(1);

    // ---------------------------------------------------------------------
    // Step B: Pipe through the Group 7 emitter -> in-memory bulk save.
    // ---------------------------------------------------------------------
    const reader = buildReader();
    const { fn: bulkSave, mock: bulkSaveMock } = buildBulkSave();

    const emitResult = await emitLlmExtractedCandidates(
      {
        projectId: BASE_ARGS.projectId,
        architectureId: BASE_ARGS.architectureId,
        runId: BASE_ARGS.runId,
        parentServiceName: BASE_ARGS.parentServiceName,
        parentInterfaceName: BASE_ARGS.parentInterfaceName,
        operations: proposeResult.operations,
      },
      {
        archModelReader: reader,
        bulkSaveCandidates: bulkSave,
        idFactory: buildIdFactory('e2e'),
        nowIso: () => '2026-05-17T00:00:00.000Z',
      },
    );

    // ---------------------------------------------------------------------
    // Step C: Assert the Group 10 acceptance signals.
    // ---------------------------------------------------------------------

    // C1. >= 2 endpoint candidates emitted (Group 10 acceptance core).
    expect(emitResult.endpointCandidates.length).toBeGreaterThanOrEqual(2);

    // C2. Every emitted endpoint candidate carries
    //     `data.discovery_method = 'llm_extraction'`.
    for (const ep of emitResult.endpointCandidates) {
      expect(ep.candidateType).toBe('endpoints');
      expect(ep.data.discovery_method).toBe('llm_extraction');
      // D-3: SOAP-over-HTTP is POST on the wire.
      expect(ep.data.operation_verb).toBe('POST');
    }

    // C3. Parent interface candidate carries the SOAP_API marker plus the
    //     trace metadata so a downstream reviewer sees "LLM extracted".
    expect(emitResult.parentInterfaceCandidate).not.toBeNull();
    expect(emitResult.parentInterfaceCandidate?.candidateType).toBe('interfaces');
    expect(emitResult.parentInterfaceCandidate?.data.interface_type).toBe(
      'SOAP_API',
    );
    expect(emitResult.parentInterfaceCandidate?.data.discovery_method).toBe(
      'llm_extraction',
    );

    // C4. At least one persisted endpoint candidate carries the low-confidence
    //     marker (`data.confidence_tier='low'`). This is the
    //     `data.low_confidence=true` marker path referenced by Group 10.
    const lowConfidencePersisted = emitResult.endpointCandidates.filter(
      (ep) => ep.data.confidence_tier === 'low',
    );
    expect(lowConfidencePersisted.length).toBeGreaterThanOrEqual(1);
    expect(emitResult.lowConfidenceCount).toBeGreaterThanOrEqual(1);

    // C5. The bulk-save batch carried both the parent and the endpoints (one
    //     batch, Phase 1 contract preserved).
    expect(bulkSaveMock).toHaveBeenCalledTimes(1);
    const persistedBatch = bulkSaveMock.mock.calls[0][3];
    expect(
      persistedBatch.filter((c) => c.candidateType === 'interfaces'),
    ).toHaveLength(1);
    expect(
      persistedBatch.filter((c) => c.candidateType === 'endpoints').length,
    ).toBeGreaterThanOrEqual(2);

    // C6. Sanity: the bulk-save was invoked with the same (project, arch, run)
    //     triple the test handed in.
    expect(bulkSaveMock.mock.calls[0][0]).toBe(BASE_ARGS.projectId);
    expect(bulkSaveMock.mock.calls[0][1]).toBe(BASE_ARGS.architectureId);
    expect(bulkSaveMock.mock.calls[0][2]).toBe(BASE_ARGS.runId);
  });

  it('does not throw and emits zero candidates when the LLM returns an empty array (back-compat sanity)', async () => {
    // Empty array is VALID per the schema (no operations found) -- the tool
    // should return zero ops and the emitter should short-circuit without
    // calling bulkSaveCandidates. This guards the "empty != malformed"
    // distinction the spec calls out.
    const { client: gatewayClient } = buildStubGateway('[]');

    const proposeResult = await proposeEndpointsFromCode(
      {
        ...BASE_ARGS,
        sessionId: 'e2e-session-empty',
        inlineSnippets: { [REPO_RELATIVE_FIXTURE_PATH]: fixtureSource },
      },
      { gatewayClient },
    );

    expect(proposeResult.malformed).toBeFalsy();
    expect(proposeResult.operations).toEqual([]);

    const reader = buildReader();
    const { fn: bulkSave, mock: bulkSaveMock } = buildBulkSave();

    const emitResult = await emitLlmExtractedCandidates(
      {
        projectId: BASE_ARGS.projectId,
        architectureId: BASE_ARGS.architectureId,
        runId: BASE_ARGS.runId,
        parentServiceName: BASE_ARGS.parentServiceName,
        parentInterfaceName: BASE_ARGS.parentInterfaceName,
        operations: proposeResult.operations,
      },
      {
        archModelReader: reader,
        bulkSaveCandidates: bulkSave,
        idFactory: buildIdFactory('e2e-empty'),
      },
    );

    expect(emitResult.endpointCandidates).toHaveLength(0);
    expect(emitResult.parentInterfaceCandidate).toBeNull();
    expect(bulkSaveMock).not.toHaveBeenCalled();
  });
});
