/**
 * Tests for the Workstream A `propose_endpoints_from_code` AMVS tool.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 *  -- Task Group 5.
 *
 * Test list (per tasks.md 5.1):
 *   1. Prompt construction snapshot                -- pinned prompt contents.
 *   2. Happy path with three confidence tiers      -- 0.3 dropped, 0.55 low, 0.85 default.
 *   3. Malformed first response then valid retry   -- retry path triggers, one candidate lands.
 *   4. Malformed twice                              -- zero candidates + evidence_gap finding.
 *   5. Token-cap truncation                         -- prompt truncated, warning surfaced.
 *
 * All LLM calls are stubbed via the injected gateway client; the
 * source-fetch is stubbed via `inlineSnippets`; the finding-emit is
 * stubbed via a jest.fn callback. No HTTP I/O.
 */

import type { GatewayClient } from '../services/gatewayClient';
import type { AssistantMessage } from '../types/llm';
import type { FindingEmitInputShape } from '../services/tools/propose_endpoints_from_code';

const CAP_ENV_KEYS = [
  'AMVS_LLM_EXTRACT_CALL_TOKEN_CAP',
  'AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP',
  'AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP',
  'AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP',
] as const;

// Common args every test reuses.
const BASE_ARGS = {
  interfaceCandidateId: 'iface-soap-001',
  parentServiceId: 'svc-001',
  parentServiceName: 'CustomerAccountService',
  parentInterfaceName: 'CustomerAccountSoap',
  runId: 'run-aaaa-bbbb',
  projectId: 'proj-001',
  architectureId: 'arch-001',
  sourceFilePaths: ['src/main/java/com/acme/CustomerAccountServlet.java'],
};

const SAMPLE_SNIPPET = `package com.acme;
import javax.servlet.http.HttpServlet;
public class CustomerAccountServlet extends HttpServlet {
  public void doPost() {
    String soapAction = req.getHeader("SOAPAction");
    if (soapAction.endsWith("getAccount")) { handleGetAccount(); }
    if (soapAction.endsWith("createOrder")) { handleCreateOrder(); }
  }
}`;

function buildAssistantMessage(content: string | null): AssistantMessage {
  return { role: 'assistant', content };
}

function buildStubGateway(
  responses: Array<{ content: string | null } | Error>,
): {
  client: Pick<GatewayClient, 'callLlmToolLoop'>;
  calls: Array<Parameters<GatewayClient['callLlmToolLoop']>[0]>;
} {
  const queue = [...responses];
  const calls: Array<Parameters<GatewayClient['callLlmToolLoop']>[0]> = [];
  const callLlmToolLoop = jest.fn(async (req: Parameters<GatewayClient['callLlmToolLoop']>[0]) => {
    calls.push(req);
    const next = queue.shift();
    if (!next) throw new Error('stub gateway: no more queued responses');
    if (next instanceof Error) throw next;
    return { message: buildAssistantMessage(next.content) };
  });
  return { client: { callLlmToolLoop } as Pick<GatewayClient, 'callLlmToolLoop'>, calls };
}

/** Typed finding-emit stub so `mock.calls[0][0]` infers as FindingEmitInputShape. */
function buildEmitFindingStub(): jest.Mock<Promise<void>, [FindingEmitInputShape]> {
  return jest.fn<Promise<void>, [FindingEmitInputShape]>(async () => {});
}

describe('propose_endpoints_from_code tool', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of CAP_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of CAP_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: Prompt construction snapshot
  // -----------------------------------------------------------------------
  it('builds a prompt that includes the schema, parent names and source snippets in order', async () => {
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const mod = require('../services/tools/propose_endpoints_from_code');
      const {
        buildExtractionPrompt,
        PROPOSE_ENDPOINTS_OUTPUT_SCHEMA,
      } = mod;

      const prompt = buildExtractionPrompt({
        parentInterfaceName: 'CustomerAccountSoap',
        parentServiceName: 'CustomerAccountService',
        sources: [{ path: 'src/main/java/Foo.java', content: 'public class Foo {}' }],
        truncated: false,
      });

      expect(prompt).toContain('CustomerAccountService');
      expect(prompt).toContain('CustomerAccountSoap');
      expect(prompt).toContain('src/main/java/Foo.java');
      expect(prompt).toContain('public class Foo {}');
      expect(prompt).toContain(PROPOSE_ENDPOINTS_OUTPUT_SCHEMA);

      // Order: parent names appear BEFORE the source snippet which appears
      // BEFORE the schema and confidence guidance.
      const serviceIdx = prompt.indexOf('CustomerAccountService');
      const sourcesIdx = prompt.indexOf('src/main/java/Foo.java');
      const schemaIdx = prompt.indexOf(PROPOSE_ENDPOINTS_OUTPUT_SCHEMA);
      expect(serviceIdx).toBeLessThan(sourcesIdx);
      expect(sourcesIdx).toBeLessThan(schemaIdx);

      // No truncation marker when `truncated=false`.
      expect(prompt).not.toContain('TRUNCATED');
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: Happy path with three confidence tiers
  // -----------------------------------------------------------------------
  it('returns 2 ops with tier markers when LLM returns 3 ops at confidences [0.3, 0.55, 0.85]', async () => {
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { proposeEndpointsFromCode } = require('../services/tools/propose_endpoints_from_code');

      const llmResponse = JSON.stringify([
        { operationName: 'guess', confidence: 0.3 },
        { operationName: 'maybe', confidence: 0.55, soapAction: 'urn:maybe' },
        { operationName: 'getAccount', confidence: 0.85, soapAction: 'urn:getAccount' },
      ]);
      const { client, calls } = buildStubGateway([{ content: llmResponse }]);
      const emitFinding = buildEmitFindingStub();

      const result = await proposeEndpointsFromCode(
        {
          ...BASE_ARGS,
          sessionId: 'session-happy',
          inlineSnippets: { [BASE_ARGS.sourceFilePaths[0]]: SAMPLE_SNIPPET },
        },
        { gatewayClient: client, emitFinding },
      );

      // The 0.3 entry is dropped silently; the 0.55 and 0.85 entries survive.
      expect(result.operations).toHaveLength(2);
      expect(result.operations.find((o: { operationName: string }) => o.operationName === 'guess')).toBeUndefined();
      const low = result.operations.find((o: { operationName: string }) => o.operationName === 'maybe');
      const high = result.operations.find((o: { operationName: string }) => o.operationName === 'getAccount');
      expect(low?.confidence_tier).toBe('low');
      expect(high?.confidence_tier).toBe('default');
      // Single LLM round-trip; no retry path taken.
      expect(calls).toHaveLength(1);
      expect(emitFinding).not.toHaveBeenCalled();
      expect(result.malformed).toBeFalsy();
      expect(result.cloneEvicted).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: Malformed first response triggers retry path; second response valid
  // -----------------------------------------------------------------------
  it('retries once when the first response is malformed and parses the second', async () => {
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { proposeEndpointsFromCode } = require('../services/tools/propose_endpoints_from_code');

      const goodResponse = JSON.stringify([
        { operationName: 'recoverAfterRetry', confidence: 0.8 },
      ]);
      const { client, calls } = buildStubGateway([
        { content: 'not-json-at-all' },
        { content: goodResponse },
      ]);
      const emitFinding = buildEmitFindingStub();

      const result = await proposeEndpointsFromCode(
        {
          ...BASE_ARGS,
          sessionId: 'session-retry',
          inlineSnippets: { [BASE_ARGS.sourceFilePaths[0]]: SAMPLE_SNIPPET },
        },
        { gatewayClient: client, emitFinding },
      );

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].operationName).toBe('recoverAfterRetry');
      expect(result.operations[0].confidence_tier).toBe('default');
      // Two LLM round-trips: original + one retry.
      expect(calls).toHaveLength(2);
      // The retry prompt prelude appears in the second user message.
      const secondUserMsg = calls[1].messages.find((m) => m.role === 'user');
      expect(secondUserMsg?.content).toContain('previous response was malformed');
      expect(emitFinding).not.toHaveBeenCalled();
      expect(result.malformed).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: Both responses malformed -> evidence_gap finding + zero ops
  // -----------------------------------------------------------------------
  it('emits an evidence_gap finding and returns zero ops when both responses are malformed', async () => {
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { proposeEndpointsFromCode } = require('../services/tools/propose_endpoints_from_code');

      const { client, calls } = buildStubGateway([
        { content: 'totally invalid' },
        { content: 'also invalid {{' },
      ]);
      const emitFinding = buildEmitFindingStub();

      const result = await proposeEndpointsFromCode(
        {
          ...BASE_ARGS,
          sessionId: 'session-malformed',
          inlineSnippets: { [BASE_ARGS.sourceFilePaths[0]]: SAMPLE_SNIPPET },
        },
        { gatewayClient: client, emitFinding },
      );

      expect(result.operations).toEqual([]);
      expect(result.malformed).toBe(true);
      expect(calls).toHaveLength(2);
      expect(emitFinding).toHaveBeenCalledTimes(1);

      const emitted = emitFinding.mock.calls[0][0];
      expect(emitted.findingType).toBe('evidence_gap');
      expect(emitted.category).toBe('evidence_gap');
      expect(emitted.severity).toBe('medium');
      expect(emitted.detailJson.gapType).toBe('llm_endpoint_extract_malformed');
      expect(emitted.detailJson.interfaceShortId).toBe(BASE_ARGS.interfaceCandidateId);
      expect(emitted.createdByStage).toBe('amvs.llmEndpointExtract');
      expect(emitted.links).toEqual([
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: BASE_ARGS.interfaceCandidateId,
        },
      ]);
      // Warning surfaced to caller so Group 6 can show the toast.
      expect(result.warnings.join('\n')).toContain('malformed');
    });
  });

  // -----------------------------------------------------------------------
  // Test 5: Token-cap truncation
  // -----------------------------------------------------------------------
  it('truncates the inlined source set and surfaces a warning when input exceeds the per-call token cap', async () => {
    // Set a small per-call cap so the test source easily overshoots it.
    process.env.AMVS_LLM_EXTRACT_CALL_TOKEN_CAP = '50';
    process.env.AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP = '1000';

    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { proposeEndpointsFromCode } = require('../services/tools/propose_endpoints_from_code');

      // Build a source snippet large enough that the rendered prompt blows
      // past 50-token (~200-char) per-call cap by a wide margin.
      const bigSnippet = 'A'.repeat(5000);
      const okResponse = JSON.stringify([
        { operationName: 'truncatedButValid', confidence: 0.9 },
      ]);
      const { client, calls } = buildStubGateway([{ content: okResponse }]);
      const emitFinding = buildEmitFindingStub();

      const result = await proposeEndpointsFromCode(
        {
          ...BASE_ARGS,
          sessionId: 'session-truncate',
          inlineSnippets: { [BASE_ARGS.sourceFilePaths[0]]: bigSnippet },
        },
        { gatewayClient: client, emitFinding },
      );

      // The tool still completes -- truncation never hard-fails.
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].operationName).toBe('truncatedButValid');
      // A warning is surfaced for the caller.
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.join('\n')).toContain('truncate');
      // The LLM-facing prompt MUST contain the truncation marker so the
      // model knows context is incomplete.
      const userMsg = calls[0].messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('TRUNCATED');
      // The actual inlined file was clipped well below its original 5000-char
      // length and the per-file truncation marker is present.
      expect(userMsg?.content).toContain('...truncated,');
      // The original 5000-char block of A's must NOT be in the prompt
      // verbatim -- a clipped + marker version is.
      expect(userMsg?.content).not.toContain('A'.repeat(2000));
    });
  });
});
