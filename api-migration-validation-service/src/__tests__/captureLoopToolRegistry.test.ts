/**
 * Capture-loop LLM tool registry tests -- Group 9.
 *
 * Verifies that the Phase-2 Workstream B tool
 * `get_operation_payload_context` is registered alongside `list_oas_operations`
 * in the capture-loop's LLM tool surface, with a JSON schema that conforms to
 * the OpenAI tool-call protocol, and that invoking it through the registry
 * with a mocked discovery-service client returns the expected envelope for
 * both Phase-1-extracted and LLM-extracted SOAP operations.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 9.
 *
 * Coverage (per 9.1):
 *   - Test 1 (registration): both `list_oas_operations` and
 *     `get_operation_payload_context` appear in the canonical registry
 *     returned by `buildToolRegistry()` and `buildToolDefinitions()`.
 *   - Test 2 (smoke -- populated payload context): a tool-call for a
 *     Phase-1-extracted SOAP operation (WSDL message metadata + DTO FQNs)
 *     gets a populated response with both WSDL fields and inlined DTO
 *     source from the mocked discovery-service client.
 *   - Test 3 (smoke -- empty fallback): a tool-call for an LLM-extracted
 *     operation (no WSDL source -- DTO FQNs only) still returns DTO source
 *     when the FQNs resolve.
 *
 * Cross-cutting:
 *   - The discovery-service client is mocked at the context-injection
 *     boundary (no axios mocking needed).
 *   - The `tokenBudget` ledger is reset between tests so per-session
 *     counter state never leaks.
 */

import {
  ALL_TOOLS,
  buildToolDefinitions,
  buildToolRegistry,
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
} from '../services/discoveryServiceClient';
import type { CaptureSession } from '../types/captureSession';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';
import type { OperationDto } from '../services/archModelClient';
import { _resetAllForTests } from '../services/tokenBudget';

const PROJECT_ID = 'proj-tr-1';
const ARCH_ID = 'arch-tr-1';
const SESSION_ID = 'session-tr-1';
const RUN_ID = 'run-tr-1';

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'test-soap-registry-session',
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
}): ToolExecutionContext {
  const inventory: ParsedOasInventory = {
    operations: opts.operations,
    title: null,
    version: null,
  };
  const discoveryClient: DiscoveryServiceClient = {
    fetchSourceFile: opts.fetchSourceFile,
  };
  const arch: ArchModelToolWriteSurface = {
    createScenario: jest.fn(),
    createDiagnostic: jest.fn(),
    createCapture: jest.fn(),
  };
  return {
    session: buildSession(),
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

describe('capture-loop tool registry -- Group 9', () => {
  // ------------------------------------------------------------------------
  // Test 1: registration -- both tools appear in the canonical surface.
  // ------------------------------------------------------------------------
  it('Test 1 (registration): registry includes both list_oas_operations AND get_operation_payload_context', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toContain('list_oas_operations');
    expect(names).toContain('get_operation_payload_context');

    const registry = buildToolRegistry();
    expect(registry.has('list_oas_operations')).toBe(true);
    expect(registry.has('get_operation_payload_context')).toBe(true);

    // The wire-shape projection used by gatewayClient.callLlmToolLoop must
    // also list the new tool so the LLM sees it in its tool surface.
    const defs = buildToolDefinitions();
    const defNames = defs.map((d) => d.function.name);
    expect(defNames).toContain('list_oas_operations');
    expect(defNames).toContain('get_operation_payload_context');

    // JSON schema for get_operation_payload_context conforms to the OpenAI
    // tool-call protocol: type=object, has operationId required, and depth
    // is constrained to the {1, 2} domain.
    const entry = registry.get('get_operation_payload_context');
    expect(entry).toBeDefined();
    const params = entry!.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['operationId']);
    const props = params.properties as Record<string, unknown>;
    expect(props.operationId).toBeDefined();
    const opIdSchema = props.operationId as { type?: string };
    expect(opIdSchema.type).toBe('string');
    expect(props.depth).toBeDefined();
    const depthSchema = props.depth as { type?: string; enum?: unknown[] };
    // The tool accepts depth = 1 or 2.
    expect(depthSchema.enum).toEqual(expect.arrayContaining([1, 2]));
    // Description is non-empty and mentions what the tool returns.
    expect(typeof entry!.description).toBe('string');
    expect(entry!.description.length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------------
  // Test 2: smoke -- populated payload context for a Phase-1-extracted op.
  // ------------------------------------------------------------------------
  it('Test 2 (smoke -- populated): a Phase-1-extracted operation gets a populated payload context', async () => {
    const requestDtoFqn = 'com.example.soap.GetAccountRequestDto';
    const responseDtoFqn = 'com.example.soap.GetAccountResponseDto';

    const op = buildOperation({
      operationId: 'getAccount',
      soap: {
        // Phase 1 emits all three WSDL message fields + DTO FQNs.
        request_root_element: 'GetAccountRequest',
        request_namespace: 'http://example.com/account/soap',
        response_root_element: 'GetAccountResponse',
        request_dto_class: requestDtoFqn,
        response_dto_class: responseDtoFqn,
        wsdl_source: 'src/main/resources/wsdl/account.wsdl',
      },
    });

    const fetchSourceFile = jest.fn(async (args: { repoPath: string }) => {
      if (args.repoPath === 'src/main/java/com/example/soap/GetAccountRequestDto.java') {
        return {
          kind: 'ok',
          content:
            'package com.example.soap;\n\npublic class GetAccountRequestDto {\n  private String accountId;\n}\n',
        } as FetchSourceResult;
      }
      if (args.repoPath === 'src/main/java/com/example/soap/GetAccountResponseDto.java') {
        return {
          kind: 'ok',
          content:
            'package com.example.soap;\n\npublic class GetAccountResponseDto {\n  private String accountName;\n  private double balance;\n}\n',
        } as FetchSourceResult;
      }
      return { kind: 'not_found' } as FetchSourceResult;
    });

    const ctx = buildContext({
      operations: [op],
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    // Invoke through the registry, not by direct import -- this is the
    // smoke that exercises the wiring at the same surface the capture
    // loop runner uses (registry.get(name).handler(args, ctx)).
    const registry = buildToolRegistry();
    const entry = registry.get('get_operation_payload_context');
    expect(entry).toBeDefined();

    const out = (await entry!.handler(
      { operationId: 'getAccount' },
      ctx,
    )) as Record<string, unknown>;

    // WSDL message metadata round-trips through the tool envelope.
    expect(out.operationId).toBe('getAccount');
    expect(out.request_root_element).toBe('GetAccountRequest');
    expect(out.request_namespace).toBe('http://example.com/account/soap');
    expect(out.response_root_element).toBe('GetAccountResponse');
    expect(out.request_dto_class).toBe(requestDtoFqn);
    expect(out.response_dto_class).toBe(responseDtoFqn);

    // DTO source inlined from the mocked discovery-service client.
    expect(out.request_dto_source).toContain('class GetAccountRequestDto');
    expect(out.response_dto_source).toContain('class GetAccountResponseDto');
    // No warning notes on the happy path.
    expect(out.notes).toBeUndefined();

    // Both DTO fetches were issued through the injected client.
    expect(fetchSourceFile).toHaveBeenCalledTimes(2);
    const calls = fetchSourceFile.mock.calls.map(
      (c) => (c as unknown as [{ repoPath: string; runId: string }])[0],
    );
    expect(calls.every((c) => c.runId === RUN_ID)).toBe(true);
  });

  // ------------------------------------------------------------------------
  // Test 3: smoke -- empty WSDL fallback for an LLM-extracted op.
  // ------------------------------------------------------------------------
  it('Test 3 (smoke -- empty fallback): an LLM-extracted operation (no WSDL source) still gets DTO sources when FQNs resolve', async () => {
    const requestDtoFqn = 'com.example.llm.CreateOrderRequestDto';
    const responseDtoFqn = 'com.example.llm.CreateOrderResponseDto';

    // LLM-extracted ops have DTO FQNs but no `wsdl_source`. The Phase 1
    // WSDL message fields (`request_root_element`, etc.) may also be
    // absent. The tool still returns DTO source for the FQNs.
    const op = buildOperation({
      operationId: 'createOrder',
      soap: {
        request_dto_class: requestDtoFqn,
        response_dto_class: responseDtoFqn,
      },
    });

    const fetchSourceFile = jest.fn(async (args: { repoPath: string }) => {
      if (args.repoPath === 'src/main/java/com/example/llm/CreateOrderRequestDto.java') {
        return {
          kind: 'ok',
          content:
            'package com.example.llm;\n\npublic class CreateOrderRequestDto {\n  private String orderId;\n}\n',
        } as FetchSourceResult;
      }
      if (args.repoPath === 'src/main/java/com/example/llm/CreateOrderResponseDto.java') {
        return {
          kind: 'ok',
          content:
            'package com.example.llm;\n\npublic class CreateOrderResponseDto {\n  private String confirmationCode;\n}\n',
        } as FetchSourceResult;
      }
      return { kind: 'not_found' } as FetchSourceResult;
    });

    const ctx = buildContext({
      operations: [op],
      discoveryRunId: RUN_ID,
      fetchSourceFile: fetchSourceFile as unknown as DiscoveryServiceClient['fetchSourceFile'],
    });

    const registry = buildToolRegistry();
    const entry = registry.get('get_operation_payload_context');
    expect(entry).toBeDefined();

    const out = (await entry!.handler(
      { operationId: 'createOrder' },
      ctx,
    )) as Record<string, unknown>;

    // WSDL message fields absent on the LLM-extracted side.
    expect(out.request_root_element).toBeUndefined();
    expect(out.request_namespace).toBeUndefined();
    expect(out.response_root_element).toBeUndefined();
    // DTO FQNs and source populated from the discovery-service fetch.
    expect(out.request_dto_class).toBe(requestDtoFqn);
    expect(out.response_dto_class).toBe(responseDtoFqn);
    expect(out.request_dto_source).toContain('class CreateOrderRequestDto');
    expect(out.response_dto_source).toContain('class CreateOrderResponseDto');
    // No degradation notes -- both fetches succeeded.
    expect(out.notes).toBeUndefined();
  });
});
