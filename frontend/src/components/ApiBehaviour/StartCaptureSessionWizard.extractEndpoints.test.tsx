/**
 * StartCaptureSessionWizard -- "Extract endpoints with LLM" trigger tests
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment Phase 2 --
 * Task Group 6, sub-task 6.4.
 *
 * Coverage:
 *   1. Visibility: the empty-state banner + button render only when (a) Step
 *      4 has zero parsed operations AND (b) at least one selected interface
 *      is `interface_type='SOAP_API'`. Hidden for REST + non-empty.
 *   2. Invocation: clicking the button POSTs the right body to the gateway
 *      proxy (`/api/v1/projects/:p/architectures/:a/api-behaviour/
 *      capture-sessions/:s/extract-endpoints`).
 *   3. Success rerender: a 200 + `status: 'ok'` reply triggers `listOperations`
 *      so the new rows appear; the empty-state banner disappears.
 *   4. 60-second timeout: an AbortError surfaces the "Still working --
 *      refresh in a minute" toast (W-15).
 *   5. 410-Gone: the button disables with secondary "Source no longer
 *      cached" text and the same-text toast.
 *   6. Malformed-twice: a 200 + `status: 'malformed'` reply (OR a warning
 *      containing `llm_endpoint_extract_malformed`) surfaces the "LLM
 *      extraction failed -- review manually" toast.
 *
 * Test strategy mirrors `StartCaptureSessionWizard.discoveryContext.test.tsx`:
 *   - vi.mock the apiBehaviourClient + migrationDiscoveryContextApi +
 *     useArchitecture so step transitions never hit a real network and we
 *     can drive the wizard to Step 4 cleanly.
 *   - The extract route is invoked via `fetch` (not via the api client), so
 *     we stub global fetch directly for the trigger flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    createCaptureSession: vi.fn(),
    submitSecrets: vi.fn(),
    parseOas: vi.fn(),
    startCaptureSession: vi.fn(),
    updateCaptureSession: vi.fn(),
    updateOperation: vi.fn(),
    listOperations: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn(),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

import {
  createCaptureSession,
  submitSecrets,
  parseOas,
  listOperations,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-extract-1';
const ARCH_ID = 'arch-extract-1';
const SESSION_ID = 'session-extract-1';
const SOAP_IFACE_ID = 'iface-soap-1';
const REST_IFACE_ID = 'iface-rest-1';

function mockArchModel(opts: { interfaceType: 'SOAP_API' | 'REST_API' }) {
  return {
    model: {
      metaModel: {
        entities: {
          interfaces: [
            {
              id: opts.interfaceType === 'SOAP_API' ? SOAP_IFACE_ID : REST_IFACE_ID,
              name: opts.interfaceType === 'SOAP_API' ? 'LegacySOAP' : 'CustomerAPI',
              description: '',
              service_id: 'svc-1',
              interface_type: opts.interfaceType,
              spec_link: opts.interfaceType === 'SOAP_API' ? null : 'customer-api.json',
              tags: '',
            },
          ],
        },
      },
    },
  } as unknown as ReturnType<typeof useArchitecture>;
}

function buildSession(): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Test session',
    status: 'draft',
    environment_name: 'non-prod',
    api_base_url: 'https://api.example.com',
    auth_type: 'none',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: '2026-05-17T00:00:00Z',
    updated_at: '2026-05-17T00:00:00Z',
  };
}

function buildDiscoveryCtxWithRun() {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: ['run-A'],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-05-17T00:00:00Z',
    discoveryRunsSummary: {
      totalRuns: 1,
      completedRuns: 1,
      runs: [
        {
          runId: 'run-A',
          architectureId: ARCH_ID,
          status: 'completed',
          discoveryKind: 'service',
          createdAt: '2026-05-16T12:00:00Z',
          updatedAt: '2026-05-16T12:30:00Z',
        },
      ],
    },
    findingsSummary: {
      totalFindings: 3,
      countsByStatus: { needs_review: 1 },
      countsBySeverity: { high: 1, medium: 2 },
      countsByCategory: {},
      highSeverityUnreviewedCount: 1,
      sampleDataHintCount: 0,
    },
    highPriorityFindings: [],
    findingsByCategory: {},
    evidenceHighlights: [],
    unresolvedDecisionTasks: [],
    runtimeUsageSummary: null,
    databaseDiscoverySummary: null,
    readinessAssessment: { overallStatus: 'partial' },
    contextWarnings: [],
  };
}

/**
 * Drive the wizard end-to-end to Step 4 with the configured selections.
 * Returns nothing -- the caller asserts on the rendered DOM.
 */
async function driveWizardToStep4(opts: {
  interfaceType: 'SOAP_API' | 'REST_API';
  parsedOperations: unknown[];
}) {
  vi.mocked(useArchitecture).mockReturnValue(
    mockArchModel({ interfaceType: opts.interfaceType }),
  );
  vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValue(
    buildDiscoveryCtxWithRun() as never,
  );
  vi.mocked(createCaptureSession).mockResolvedValue(buildSession());
  vi.mocked(submitSecrets).mockResolvedValue({ ok: true });
  vi.mocked(parseOas).mockResolvedValue({
    sessionId: SESSION_ID,
    operationCount: opts.parsedOperations.length,
    mutatingExcluded: 0,
    title: null,
    version: null,
    skippedInterfaceCount: 0,
    skippedInterfaceIds: [],
  } as never);
  vi.mocked(listOperations).mockResolvedValue(opts.parsedOperations as never);

  render(
    <StartCaptureSessionWizard
      open={true}
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      onClose={vi.fn()}
    />,
  );

  // Wait for the discovery context fetch to settle (it auto-fires on open).
  await waitFor(() => {
    expect(fetchMigrationDiscoveryContext).toHaveBeenCalled();
  });

  // Step 1 -> Step 2: pick the only interface.
  const ifaceId =
    opts.interfaceType === 'SOAP_API' ? SOAP_IFACE_ID : REST_IFACE_ID;
  fireEvent.click(
    screen.getByTestId(`start-capture-session-wizard-interface-${ifaceId}`),
  );
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));

  // Step 2 -> Step 3: minimum required fields.
  fireEvent.change(screen.getByTestId('start-capture-session-wizard-env-name'), {
    target: { value: 'non-prod' },
  });
  fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));

  // Step 3 -> Step 4: dbType 'none' is the default + valid.
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  });

  // Wait for the wizard to land on Step 4.
  await waitFor(() => {
    expect(
      screen.getByTestId('start-capture-session-wizard-operation-list'),
    ).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: Button visible only when SOAP_API + zero parsed operations.
//
// Two sub-cases inside one test:
//   - REST_API + zero ops: NO button (shows the original "No operations
//     parsed." fallback).
//   - SOAP_API + zero ops: button + banner present.
// ---------------------------------------------------------------------------
describe('Step 4 extract-endpoints button -- visibility', () => {
  it('is hidden for REST_API empty-state and visible for SOAP_API empty-state', async () => {
    // REST sub-case
    await driveWizardToStep4({ interfaceType: 'REST_API', parsedOperations: [] });
    expect(
      screen.queryByTestId('start-capture-session-wizard-extract-endpoints-llm'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('start-capture-session-wizard-extract-empty-state'),
    ).not.toBeInTheDocument();
  });

  it('renders the empty-state banner + button for SOAP_API empty-state', async () => {
    await driveWizardToStep4({ interfaceType: 'SOAP_API', parsedOperations: [] });
    expect(
      screen.getByTestId('start-capture-session-wizard-extract-empty-state'),
    ).toBeInTheDocument();
    const button = screen.getByTestId(
      'start-capture-session-wizard-extract-endpoints-llm',
    );
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    // Banner text per spec
    expect(
      screen.getByTestId('start-capture-session-wizard-extract-empty-state'),
    ).toHaveTextContent(/No endpoints detected\. Try LLM extraction\?/i);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Click invokes the gateway proxy with the right body shape.
// Test 3: Success rerenders Step 4 with the new rows.
//
// Folded together -- the success path is hard to verify without first
// confirming the click actually fires.
// ---------------------------------------------------------------------------
describe('Step 4 extract-endpoints button -- invocation + success rerender', () => {
  it('POSTs to the gateway proxy and rerenders Step 4 on success', async () => {
    await driveWizardToStep4({ interfaceType: 'SOAP_API', parsedOperations: [] });

    // Pre-stage the listOperations mock to return one operation row so the
    // success-path rerender has something to flash up.
    vi.mocked(listOperations).mockResolvedValueOnce([
      {
        id: 'op-llm-1',
        session_id: SESSION_ID,
        operation_id: 'getAccount',
        method: 'POST',
        path: '/services/Account',
        summary: 'getAccount',
        description: null,
        included: true,
        safe_to_execute: false,
        request_schema_json: null,
        response_schema_json: null,
        oas_operation_json: {},
        created_at: '2026-05-17T00:00:00Z',
        updated_at: '2026-05-17T00:00:00Z',
      },
    ] as never);

    // Stub global fetch. The extract route is invoked via raw fetch (NOT
    // via the api client) so we mock the global directly.
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: SESSION_ID,
        status: 'ok',
        operations: [
          {
            operationName: 'getAccount',
            soapAction: 'urn:GetAccount',
            confidence: 0.9,
            confidence_tier: 'default',
          },
        ],
        warnings: [],
      }),
      text: async () => '',
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-extract-endpoints-llm'),
      );
    });

    // The button fired exactly one fetch call -- to the gateway proxy URL.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/api-behaviour/capture-sessions/${SESSION_ID}/extract-endpoints`,
    );
    const calledInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(calledInit.method).toBe('POST');
    const parsedBody = JSON.parse(calledInit.body as string);
    expect(parsedBody).toEqual({
      interfaceId: SOAP_IFACE_ID,
      discoveryRunId: 'run-A',
    });

    // Successful return triggers a listOperations refresh; the empty-state
    // banner disappears as a result.
    await waitFor(() => {
      expect(listOperations).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, SESSION_ID);
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('start-capture-session-wizard-extract-empty-state'),
      ).not.toBeInTheDocument();
    });
    // The new row appears in the list.
    expect(
      screen.getByTestId('start-capture-session-wizard-operation-op-llm-1'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Test 4: 60-second client-side timeout fires the AbortController and the
// wizard shows the "Still working - refresh in a minute" toast.
// ---------------------------------------------------------------------------
describe('Step 4 extract-endpoints button -- 60-second timeout', () => {
  it('shows the "Still working" toast when the gateway call is aborted', async () => {
    await driveWizardToStep4({ interfaceType: 'SOAP_API', parsedOperations: [] });

    // Make the fetch mock surface an AbortError synchronously the moment
    // the wizard tells the controller to abort. We do this by listening on
    // the supplied signal -- the wizard sets `signal: controller.signal`.
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          // Mimic the runtime: when the controller aborts, fetch rejects
          // with a DOMException whose `name` is 'AbortError'.
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    // Replace the 60s timer with a fake one we can flush. Spying on the
    // global `setTimeout` lets us trigger the abort without a real wall-
    // clock 60-second wait.
    vi.useFakeTimers();
    try {
      // Fire the click; the wizard schedules a 60_000ms timeout, then
      // awaits fetch which never resolves.
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-extract-endpoints-llm'),
      );
      // Run the timer + flush microtasks for the rejection.
      await act(async () => {
        vi.advanceTimersByTime(60_001);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(
        screen.getByTestId('start-capture-session-wizard-extract-toast'),
      ).toHaveTextContent(/Still working - refresh in a minute/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Test 5: 410-Gone disables the button + shows the right toast.
// Two equivalent shapes the AMVS route may return:
//   - HTTP 410 directly
//   - HTTP 200 + body `{ status: 'clone_evicted' }`
// We exercise the 200-body shape since it's the one our AMVS route emits
// (the gateway proxy is byte-for-byte).
// ---------------------------------------------------------------------------
describe('Step 4 extract-endpoints button -- clone-evicted disabling', () => {
  it('disables the button + shows the "Source no longer cached" toast on status=clone_evicted', async () => {
    await driveWizardToStep4({ interfaceType: 'SOAP_API', parsedOperations: [] });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: SESSION_ID,
        status: 'clone_evicted',
        operations: [],
        warnings: ['Source no longer cached'],
        runId: 'run-A',
      }),
      text: async () => '',
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-extract-endpoints-llm'),
      );
    });

    // Toast surfaces the secondary text.
    await waitFor(() => {
      expect(
        screen.getByTestId('start-capture-session-wizard-extract-toast'),
      ).toHaveTextContent(/Source no longer cached - re-run discovery/i);
    });
    // Button is disabled now.
    const button = screen.getByTestId(
      'start-capture-session-wizard-extract-endpoints-llm',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Secondary text rendered alongside the button per spec.
    expect(
      screen.getByTestId('start-capture-session-wizard-extract-clone-evicted'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Test 6: Malformed-twice response shows the "review manually" toast.
// AMVS route returns 200 + status='malformed' on this path; the gateway
// is byte-for-byte.
// ---------------------------------------------------------------------------
describe('Step 4 extract-endpoints button -- malformed-twice toast', () => {
  it('shows the "review manually" toast on status=malformed', async () => {
    await driveWizardToStep4({ interfaceType: 'SOAP_API', parsedOperations: [] });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: SESSION_ID,
        status: 'malformed',
        operations: [],
        warnings: [
          'LLM returned malformed JSON twice; emitted evidence_gap finding llm_endpoint_extract_malformed.',
        ],
      }),
      text: async () => '',
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('start-capture-session-wizard-extract-endpoints-llm'),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('start-capture-session-wizard-extract-toast'),
      ).toHaveTextContent(/LLM extraction failed - review manually/i);
    });
    // Button should still be enabled (not a permanent disable -- the user
    // can retry).
    const button = screen.getByTestId(
      'start-capture-session-wizard-extract-endpoints-llm',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
