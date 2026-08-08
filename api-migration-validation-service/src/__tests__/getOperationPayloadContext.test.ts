/**
 * Tests for the Workstream B `get_operation_payload_context` LLM tool.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 8.
 *
 * Coverage (per Group 8 task spec, 8.1):
 *   1. WSDL-only path (no `request_dto_class`)               -- root elements + namespace, no source, no warnings.
 *   2. DTO-source path (depth=1)                              -- both DTOs resolved + inlined.
 *   3. Depth-2                                                -- nested field-type DTOs also inlined.
 *   4. Per-file byte cap                                      -- source over 8 KB ends with the truncation marker.
 *   5. 410-Gone fallback                                      -- WSDL fields still returned + "clone evicted" note.
 *   6. Token-cap truncation                                   -- response over the per-call cap is slimmed + noted.
 *
 * Cross-cutting:
 *   - The `tokenBudget` ledger is reset between tests via the helper's
 *     `_resetAllForTests` export so the session cap state never leaks.
 *   - The discovery-service client is mocked at the context-injection
 *     boundary (no axios mocking needed).
 */

import { getOperationPayloadContextTool } from '../services/tools/get_operation_payload_context';
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
} from '../services/discoveryServiceClient';
import type {
  ArchModelToolWriteSurface,
  ToolExecutionContext,
} from '../services/tools';
import type { CaptureSession } from '../types/captureSession';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';
import type { OperationDto } from '../services/archModelClient';
import { _resetAllForTests } from '../services/tokenBudget';

const PROJECT_ID = 'proj-payload-1';
const ARCH_ID = 'arch-payload-1';
const SESSION_ID = 'session-payload-1';
const RUN_ID = 'run-payload-1';

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'test-soap-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: null,
    authType: null,
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: true,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
    ...overrides,
  };
}

interface SoapMetaFields {
  soap_action?: string;
  request_root_element?: string;
  request_namespace?: string;
  response_root_element?: string;
  request_dto_class?: string;
  response_dto_class?: string;
  wsdl_source?: string;
}

function buildOperation(opts: {
  operationId: string;
  soap?: SoapMetaFields;
  samplePayload?: string;
}): ParsedOasOperation {
  const oasOp: Record<string, unknown> = {
    operationId: opts.operationId,
    responses: {},
  };
  if (opts.soap && Object.keys(opts.soap).length > 0) {
    const block: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.soap)) {
      if (typeof v === 'string' && v.length > 0) block[k] = v;
    }
    oasOp['x-amvs-soap'] = block;
  }
  if (opts.samplePayload) {
    oasOp['x-amvs-sample-payload'] = opts.samplePayload;
  }
  return {
    operationId: opts.operationId,
    method: 'post',
    path: '',
    summary: null,
    description: null,
    requestSchema: null,
    responseSchema: null,
    oasOperation: oasOp as ParsedOasOperation['oasOperation'],
  };
}

function buildContext(opts: {
  operations: ParsedOasOperation[];
  discoveryRunId?: string | null;
  fetchSourceFile: (args: {
    projectId: string;
    architectureId: string;
    runId: string;
    repoPath: string;
  }) => Promise<FetchSourceResult>;
  session?: CaptureSession;
}): ToolExecutionContext {
  const inventory: ParsedOasInventory = {
    operations: opts.operations,
    title: null,
    version: null,
  };
  const discoveryClient: DiscoveryServiceClient = {
    searchSourceFiles: async () => ({ kind: 'ok' as const, files: [], truncated: false }),
    fetchSourceFile: opts.fetchSourceFile,
  };
  const arch: ArchModelToolWriteSurface = {
    createScenario: jest.fn(),
    createDiagnostic: jest.fn(),
    createCapture: jest.fn(),
  };
  return {
    session: opts.session ?? buildSession(),
    oasInventory: inventory,
    operationsByOasId: new Map<string, OperationDto>(),
    secrets: { sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor: null,
    dbAdapter: null,
    archModelClient: arch,
    currentScenarioId: null,
    discoveryServiceClient: discoveryClient,
    discoveryRunId: opts.discoveryRunId ?? null,
  };
}

beforeEach(() => {
  _resetAllForTests();
});

describe('get_operation_payload_context tool', () => {
  it('Test 1 (WSDL-only path): returns root elements + namespace; no DTO source; no warnings', async () => {
    const op = buildOperation({
      operationId: 'NumberToWords',
      soap: {
        request_root_element: 'NumberToWords',
        request_namespace: 'http://www.dataaccess.com/webservicesserver/',
        response_root_element: 'NumberToWordsResponse',
      },
    });
    const fetchSourceFile = jest.fn<Promise<FetchSourceResult>, unknown[]>();
    const ctx = buildContext({
      operations: [op],
      // Even when a runId is bound, the absence of DTO FQNs short-circuits
      // any source-endpoint round trip.
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    const out = await getOperationPayloadContextTool.handler(
      { operationId: 'NumberToWords' },
      ctx,
    );

    expect(fetchSourceFile).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      operationId: 'NumberToWords',
      request_root_element: 'NumberToWords',
      request_namespace: 'http://www.dataaccess.com/webservicesserver/',
      response_root_element: 'NumberToWordsResponse',
    });
    // No DTO source slots.
    expect((out as Record<string, unknown>).request_dto_source).toBeUndefined();
    expect((out as Record<string, unknown>).response_dto_source).toBeUndefined();
    // No warning notes.
    expect((out as Record<string, unknown>).notes).toBeUndefined();
  });

  it('Test 2 (DTO-source path, depth=1): resolves both DTOs from the source endpoint', async () => {
    const requestDtoFqn = 'com.example.soap.GetAccountRequestDto';
    const responseDtoFqn = 'com.example.soap.GetAccountResponseDto';

    const op = buildOperation({
      operationId: 'getAccount',
      soap: {
        request_root_element: 'GetAccountRequest',
        request_namespace: 'http://example.com/soap',
        response_root_element: 'GetAccountResponse',
        request_dto_class: requestDtoFqn,
        response_dto_class: responseDtoFqn,
      },
    });

    const fetchSourceFile = jest.fn(async (args: { repoPath: string }) => {
      if (args.repoPath === 'src/main/java/com/example/soap/GetAccountRequestDto.java') {
        return {
          kind: 'ok',
          content: 'package com.example.soap;\n\npublic class GetAccountRequestDto {\n  private String accountId;\n}\n',
        } as FetchSourceResult;
      }
      if (args.repoPath === 'src/main/java/com/example/soap/GetAccountResponseDto.java') {
        return {
          kind: 'ok',
          content: 'package com.example.soap;\n\npublic class GetAccountResponseDto {\n  private String accountName;\n}\n',
        } as FetchSourceResult;
      }
      return { kind: 'not_found' } as FetchSourceResult;
    });

    const ctx = buildContext({
      operations: [op],
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    const out = (await getOperationPayloadContextTool.handler(
      { operationId: 'getAccount' },
      ctx,
    )) as Record<string, unknown>;

    expect(fetchSourceFile).toHaveBeenCalledTimes(2);
    expect(out.operationId).toBe('getAccount');
    expect(out.request_root_element).toBe('GetAccountRequest');
    expect(out.request_dto_class).toBe(requestDtoFqn);
    expect(out.response_dto_class).toBe(responseDtoFqn);
    expect(out.request_dto_source).toContain('class GetAccountRequestDto');
    expect(out.response_dto_source).toContain('class GetAccountResponseDto');
    expect(out.notes).toBeUndefined();
    // No truncations expected for sub-cap sources.
    expect(out.truncations).toBeUndefined();
  });

  it('Test 3 (depth=2): also resolves direct field-type DTOs', async () => {
    const requestDtoFqn = 'com.example.soap.CreateOrderRequestDto';
    const responseDtoFqn = 'com.example.soap.CreateOrderResponseDto';
    const customerDtoFqn = 'com.example.soap.CustomerDto';

    const op = buildOperation({
      operationId: 'createOrder',
      soap: {
        request_dto_class: requestDtoFqn,
        response_dto_class: responseDtoFqn,
      },
    });

    const requestDtoSource =
      'package com.example.soap;\n\n' +
      'public class CreateOrderRequestDto {\n' +
      '  private String orderId;\n' +
      '  private CustomerDto customer;\n' +
      '}\n';
    const responseDtoSource =
      'package com.example.soap;\n\n' +
      'public class CreateOrderResponseDto {\n' +
      '  private String confirmationCode;\n' +
      '}\n';
    const customerDtoSource =
      'package com.example.soap;\n\n' +
      'public class CustomerDto {\n' +
      '  private String name;\n' +
      '}\n';

    const fetchSourceFile = jest.fn(async (args: { repoPath: string }) => {
      switch (args.repoPath) {
        case 'src/main/java/com/example/soap/CreateOrderRequestDto.java':
          return { kind: 'ok', content: requestDtoSource } as FetchSourceResult;
        case 'src/main/java/com/example/soap/CreateOrderResponseDto.java':
          return { kind: 'ok', content: responseDtoSource } as FetchSourceResult;
        case 'src/main/java/com/example/soap/CustomerDto.java':
          return { kind: 'ok', content: customerDtoSource } as FetchSourceResult;
        default:
          return { kind: 'not_found' } as FetchSourceResult;
      }
    });

    const ctx = buildContext({
      operations: [op],
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    const out = (await getOperationPayloadContextTool.handler(
      { operationId: 'createOrder', depth: 2 },
      ctx,
    )) as Record<string, unknown>;

    expect(out.request_dto_source).toContain('class CreateOrderRequestDto');
    expect(out.response_dto_source).toContain('class CreateOrderResponseDto');
    const nested = out.nested_dto_sources as Record<string, string> | undefined;
    expect(nested).toBeDefined();
    expect(nested && nested[customerDtoFqn]).toContain('class CustomerDto');
  });

  it('Test 4 (per-file byte cap): source over 8 KB is truncated with the marker', async () => {
    const requestDtoFqn = 'com.example.big.BigDto';

    const op = buildOperation({
      operationId: 'doBig',
      soap: {
        request_dto_class: requestDtoFqn,
      },
    });

    // 9 KB of source -- comfortably over the 8 KB cap.
    const bigSource = 'package com.example.big;\n' + 'x'.repeat(9 * 1024);
    const fetchSourceFile = jest.fn(async () => ({
      kind: 'ok',
      content: bigSource,
    } as FetchSourceResult));

    const ctx = buildContext({
      operations: [op],
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    const out = (await getOperationPayloadContextTool.handler(
      { operationId: 'doBig' },
      ctx,
    )) as Record<string, unknown>;

    const src = out.request_dto_source as string;
    expect(src).toBeDefined();
    // Marker present.
    expect(src).toMatch(/\/\/ \.\.\.truncated, \d+ more bytes$/);
    // Truncations recorded.
    const trunc = out.truncations as Array<{ dto_class: string; dropped_bytes: number }>;
    expect(Array.isArray(trunc)).toBe(true);
    expect(trunc.length).toBe(1);
    expect(trunc[0].dto_class).toBe(requestDtoFqn);
    expect(trunc[0].dropped_bytes).toBeGreaterThan(0);
  });

  it('Test 5 (410-Gone fallback): WSDL fields still returned + clone-evicted note; no throw', async () => {
    const requestDtoFqn = 'com.example.soap.RequestDto';
    const responseDtoFqn = 'com.example.soap.ResponseDto';

    const op = buildOperation({
      operationId: 'getThing',
      soap: {
        request_root_element: 'GetThing',
        request_namespace: 'http://example.com/soap',
        response_root_element: 'GetThingResponse',
        request_dto_class: requestDtoFqn,
        response_dto_class: responseDtoFqn,
      },
    });

    const fetchSourceFile = jest.fn(async () => ({ kind: 'evicted' } as FetchSourceResult));
    const ctx = buildContext({
      operations: [op],
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    const out = (await getOperationPayloadContextTool.handler(
      { operationId: 'getThing' },
      ctx,
    )) as Record<string, unknown>;

    // WSDL fields still present.
    expect(out.request_root_element).toBe('GetThing');
    expect(out.request_namespace).toBe('http://example.com/soap');
    expect(out.response_root_element).toBe('GetThingResponse');
    // DTO source slots fall back to "DTO source unavailable".
    expect(out.request_dto_source).toBe('DTO source unavailable');
    expect(out.response_dto_source).toBe('DTO source unavailable');
    // Notes carry the clone-evicted entry.
    const notes = out.notes as string[];
    expect(Array.isArray(notes)).toBe(true);
    expect(notes).toContain('clone evicted; DTO sources unavailable');
  });

  it('Test 6 (token-cap truncation): response over the per-call cap is truncated + noted', async () => {
    // Force the per-call cap to a tiny value so a normal-sized response
    // overflows it; reset modules so the helper re-reads the env at import.
    const ORIG = process.env.AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP;
    process.env.AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP = '10'; // 10 tokens ~= 40 chars
    jest.resetModules();

    // Re-import the tool + helper with the new env.
    const {
      getOperationPayloadContextTool: tool,
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    } = require('../services/tools/get_operation_payload_context');
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { _resetAllForTests: resetLedger } = require('../services/tokenBudget');
    resetLedger();

    try {
      const requestDtoFqn = 'com.example.soap.BigRequestDto';
      const op = buildOperation({
        operationId: 'overflowOp',
        soap: {
          request_root_element: 'OverflowReq',
          request_namespace: 'http://example.com/overflow',
          response_root_element: 'OverflowResp',
          request_dto_class: requestDtoFqn,
        },
      });

      // Source is short enough to sit under the 8 KB per-file cap but
      // big enough that the encoded response blows past the 10-token
      // per-call cap when added to the WSDL metadata.
      const source =
        'package com.example.soap;\npublic class BigRequestDto { private String field1; private String field2; }\n';
      const fetchSourceFile = jest.fn(async () => ({
        kind: 'ok',
        content: source,
      } as FetchSourceResult));

      const ctx = buildContext({
        operations: [op],
        discoveryRunId: RUN_ID,
        fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
      });

      const out = (await tool.handler(
        { operationId: 'overflowOp' },
        ctx,
      )) as Record<string, unknown>;

      // Token-cap truncation drops heavy fields and adds a structured note.
      expect(out.operationId).toBe('overflowOp');
      const notes = out.notes as string[];
      expect(Array.isArray(notes)).toBe(true);
      expect(notes.some((n) => /token_cap/.test(n))).toBe(true);
      // WSDL metadata survives even on the truncated path so the LLM can
      // still build a WSDL-types-only envelope.
      expect(out.request_root_element).toBe('OverflowReq');
    } finally {
      if (ORIG === undefined) {
        delete process.env.AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP;
      } else {
        process.env.AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP = ORIG;
      }
      jest.resetModules();
    }
  });
});
