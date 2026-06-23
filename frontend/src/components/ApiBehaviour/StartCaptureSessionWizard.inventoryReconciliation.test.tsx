/**
 * StartCaptureSessionWizard -- inventory reconciliation tests
 *
 * Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 4 (4.1 a-e)
 *
 * Coverage:
 *   - (a) advancing to Step 4 calls `reconcile-inventory` with the selected
 *     interface ids + `persist_scope: true` and renders the
 *     unmatched-committed-endpoints section from the payload.
 *   - (b) "Include all" calls `account-endpoints` (bulk) and refreshes the
 *     operations list from the action response; the per-row EXCLUDE confirm
 *     stays disabled until a non-empty reason is entered.
 *   - (c) the "Discovery gaps" section lists
 *     `operations_without_model_endpoint` with the recorded-finding note, and
 *     the collapsed "Excluded by scope" group renders the bulk reason.
 *   - (d) both coverage figures (selected-scope % + whole-architecture %)
 *     display from the payload.
 *   - (e) a 409 `INVENTORY_UNACCOUNTED_ENDPOINTS` on Start renders the
 *     override dialog (remaining unaccounted list + justification textarea);
 *     "Start anyway (override)" stays disabled while the justification is
 *     empty and the re-submit passes `coverageOverrideJustification`.
 *
 * Test strategy: Vitest + `vi.mock()` with the `vi.importActual` spread
 * pattern (per project conventions) so the REAL `ApiBehaviourApiError` and
 * `parseInventoryUnaccountedError` are used while every network wrapper is
 * a spy. The 409 is detected by `error.body.code` -- never string matching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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
    listOperations: vi.fn().mockResolvedValue([]),
    reconcileInventory: vi.fn(),
    accountEndpoints: vi.fn(),
    // Renumber (Spec 2026-06-20): the Step 4 -> 5 advance now fetches the
    // data-type-format preview. An EMPTY result auto-skips the new step so
    // these flows still land on Start (step 6) after one Next from Step 4.
    dataTypeDefaultsPreview: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  // Fail-soft path: the wizard tolerates an unavailable discovery context.
  fetchMigrationDiscoveryContext: vi.fn().mockRejectedValue(new Error('unavailable')),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

import {
  ApiBehaviourApiError,
  accountEndpoints,
  createCaptureSession,
  listOperations,
  parseOas,
  reconcileInventory,
  startCaptureSession,
  submitSecrets,
  updateCaptureSession,
  dataTypeDefaultsPreview,
  type ApiBehaviourCaptureSessionDto,
  type ApiBehaviourOperationDto,
  type InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-recon-1';
const ARCH_ID = 'arch-recon-1';
const SESSION_ID = 'session-recon-1';

function mockArchModel() {
  return {
    model: {
      metaModel: {
        entities: {
          interfaces: [
            {
              id: 'iface-1',
              name: 'Customer API',
              description: '',
              service_id: 'svc-1',
              interface_type: 'REST_API',
              spec_link: 'customer-api.json',
              tags: '',
            },
          ],
        },
      },
    },
  } as unknown as ReturnType<typeof useArchitecture>;
}

function buildSession(
  overrides: Partial<ApiBehaviourCaptureSessionDto> = {},
): ApiBehaviourCaptureSessionDto {
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Recon session',
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
    created_at: '2026-06-11T00:00:00Z',
    updated_at: '2026-06-11T00:00:00Z',
    ...overrides,
  };
}

function buildOperation(
  id: string,
  overrides: Partial<ApiBehaviourOperationDto> = {},
): ApiBehaviourOperationDto {
  return {
    id,
    session_id: SESSION_ID,
    operation_id: id,
    method: 'GET',
    path: `/auto/${id}`,
    summary: null,
    description: null,
    included: true,
    safe_to_execute: null,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    exclusion_reason: null,
    created_at: '2026-06-11T00:00:00Z',
    updated_at: '2026-06-11T00:00:00Z',
    ...overrides,
  };
}

const EP_1 = {
  endpoint_id: 'ep-1',
  interface_id: 'iface-1',
  key: 'GET /customers',
  name: 'List customers',
  method: 'GET',
  path: '/customers',
  protocol: 'REST',
  soap_action: null,
  request_root_element: null,
};

const EP_2 = {
  endpoint_id: 'ep-2',
  interface_id: 'iface-1',
  key: 'POST /customers',
  name: 'Create customer',
  method: 'POST',
  path: '/customers',
  protocol: 'REST',
  soap_action: null,
  request_root_element: null,
};

function buildReconciliation(
  overrides: Partial<InventoryReconciliationResponse> = {},
): InventoryReconciliationResponse {
  return {
    in_scope_unaccounted_endpoints: [EP_1, EP_2],
    operations_without_model_endpoint: [
      {
        operation_row_id: 'oprow-9',
        operation_id: 'legacyPing',
        method: 'GET',
        path: '/ping',
        key: 'GET /ping',
      },
    ],
    excluded_by_scope_endpoints: [
      {
        endpoint_id: 'ep-9',
        interface_id: 'iface-2',
        key: 'GET /admin/users',
        name: 'Admin list users',
      },
    ],
    in_scope_coverage_pct: 60,
    in_scope_accounted_count: 3,
    in_scope_total_count: 5,
    architecture_coverage_pct: 50,
    architecture_accounted_count: 3,
    architecture_total_count: 6,
    ...overrides,
  };
}

/** Step 1 (pick interface) -> Step 2 (env config) -> Step 3 -> Step 4. */
async function driveWizardToStep4() {
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-interface-iface-1'));
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  fireEvent.change(screen.getByTestId('start-capture-session-wizard-env-name'), {
    target: { value: 'non-prod' },
  });
  fireEvent.change(screen.getByTestId('start-capture-session-wizard-base-url'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  });
}

async function driveWizardToStep5() {
  await driveWizardToStep4();
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  });
}

function renderWizard() {
  render(
    <StartCaptureSessionWizard
      open={true}
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitecture).mockReturnValue(mockArchModel());
  vi.mocked(createCaptureSession).mockResolvedValue(buildSession());
  vi.mocked(submitSecrets).mockResolvedValue({ ok: true } as never);
  vi.mocked(parseOas).mockResolvedValue({
    sessionId: SESSION_ID,
    operationCount: 0,
    mutatingExcluded: 0,
    title: 'API',
    version: '1',
  });
  vi.mocked(listOperations).mockResolvedValue([]);
  vi.mocked(reconcileInventory).mockResolvedValue(buildReconciliation());
  vi.mocked(updateCaptureSession).mockResolvedValue(buildSession({ status: 'configured' }));
  vi.mocked(startCaptureSession).mockResolvedValue(buildSession({ status: 'running' }));
  // Empty preview -> the new Data-type step auto-skips to Start (step 6).
  vi.mocked(dataTypeDefaultsPreview).mockResolvedValue({
    sessionId: SESSION_ID,
    rows: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Step 4 reconciliation (Task 4.1a, 4.1d)', () => {
  it('calls reconcile-inventory with the selected interface ids + persist_scope and renders the unmatched section', async () => {
    renderWizard();
    await driveWizardToStep4();

    expect(reconcileInventory).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SESSION_ID,
      expect.objectContaining({
        scope_interface_ids: ['iface-1'],
        persist_scope: true,
      }),
    );

    const section = screen.getByTestId('start-capture-session-wizard-unmatched-section');
    expect(section).toHaveTextContent('Unmatched committed endpoints (2)');
    expect(
      screen.getByTestId('start-capture-session-wizard-unmatched-ep-1'),
    ).toHaveTextContent('GET /customers');
    expect(
      screen.getByTestId('start-capture-session-wizard-unmatched-ep-2'),
    ).toHaveTextContent('POST /customers');
  });

  it('displays BOTH coverage figures (selected scope + whole architecture) from the payload', async () => {
    renderWizard();
    await driveWizardToStep4();

    expect(
      screen.getByTestId('start-capture-session-wizard-coverage-in-scope'),
    ).toHaveTextContent(/60%\s*\(\s*3 of 5 endpoints accounted\)/);
    expect(
      screen.getByTestId('start-capture-session-wizard-coverage-architecture'),
    ).toHaveTextContent(/50%\s*\(\s*3 of 6\)/);
  });
});

describe('Include / Exclude accounting (Task 4.1b)', () => {
  it('"Include all" sends ONE bulk account-endpoints call and refreshes operations + reconciliation from the response', async () => {
    const createdRows = [
      buildOperation('op-new-1', { method: 'GET', path: '/customers' }),
      buildOperation('op-new-2', { method: 'POST', path: '/customers' }),
    ];
    vi.mocked(accountEndpoints).mockResolvedValue({
      sessionId: SESSION_ID,
      operations: createdRows,
    });

    renderWizard();
    await driveWizardToStep4();

    // The post-accounting refresh returns a fully-accounted payload.
    vi.mocked(reconcileInventory).mockResolvedValue(
      buildReconciliation({
        in_scope_unaccounted_endpoints: [],
        in_scope_coverage_pct: 100,
        in_scope_accounted_count: 5,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-include-all'));
    });

    expect(accountEndpoints).toHaveBeenCalledTimes(1);
    expect(accountEndpoints).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, SESSION_ID, [
      { endpoint_id: 'ep-1', action: 'include' },
      { endpoint_id: 'ep-2', action: 'include' },
    ]);

    // Operations table refreshed straight from the action response -- the
    // two auto-created rows appear without any extra listOperations call.
    expect(
      screen.getByTestId('start-capture-session-wizard-operation-op-new-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('start-capture-session-wizard-operation-op-new-2'),
    ).toBeInTheDocument();

    // Reconciliation state refreshed: nothing unmatched remains.
    await waitFor(() => {
      expect(
        screen.getByTestId('start-capture-session-wizard-unmatched-empty'),
      ).toBeInTheDocument();
    });
  });

  it('EXCLUDE keeps its confirm disabled until a non-empty reason is entered, then sends the reason', async () => {
    vi.mocked(accountEndpoints).mockResolvedValue({
      sessionId: SESSION_ID,
      operations: [
        buildOperation('op-excl-1', {
          included: false,
          exclusion_reason: 'deprecated endpoint',
        }),
      ],
    });

    renderWizard();
    await driveWizardToStep4();

    fireEvent.click(screen.getByTestId('start-capture-session-wizard-exclude-ep-1'));

    const confirm = screen.getByTestId(
      'start-capture-session-wizard-exclude-confirm-ep-1',
    ) as HTMLButtonElement;
    expect(confirm).toBeDisabled();

    fireEvent.change(
      screen.getByTestId('start-capture-session-wizard-exclude-reason-ep-1'),
      { target: { value: 'deprecated endpoint' } },
    );
    expect(confirm).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(accountEndpoints).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, SESSION_ID, [
      { endpoint_id: 'ep-1', action: 'exclude', reason: 'deprecated endpoint' },
    ]);
  });
});

describe('Discovery gaps + excluded-by-scope (Task 4.1c)', () => {
  it('lists operations_without_model_endpoint with the recorded-finding note and renders the bulk excluded-by-scope group', async () => {
    renderWizard();
    await driveWizardToStep4();

    // Discovery gaps: rendered straight from the reconciliation response,
    // with the note that a reconciliation finding has been recorded.
    const gaps = screen.getByTestId('start-capture-session-wizard-discovery-gaps');
    expect(gaps).toHaveTextContent(/A reconciliation finding\s+has been recorded/);
    expect(
      screen.getByTestId('start-capture-session-wizard-discovery-gap-oprow-9'),
    ).toHaveTextContent('GET /ping');

    // Excluded-by-scope group: collapsed by default, bulk single reason.
    const toggle = screen.getByTestId(
      'start-capture-session-wizard-excluded-by-scope-toggle',
    );
    expect(toggle).toHaveTextContent('Excluded by scope (1)');
    expect(toggle).toHaveTextContent('excluded by scope (interface not selected)');
    expect(
      screen.queryByTestId('start-capture-session-wizard-excluded-by-scope-body'),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(
      screen.getByTestId('start-capture-session-wizard-excluded-by-scope-ep-9'),
    ).toHaveTextContent('Admin list users');
  });
});

describe('409 override flow on Start (Task 4.1e)', () => {
  it('renders the unaccounted list + justification textarea, keeps Start-anyway disabled while empty, and re-submits with coverageOverrideJustification', async () => {
    vi.mocked(startCaptureSession)
      .mockRejectedValueOnce(
        new ApiBehaviourApiError(409, {
          // Detection is by code, NOT message matching.
          code: 'INVENTORY_UNACCOUNTED_ENDPOINTS',
          message: 'Cannot start: 1 in-scope committed endpoint(s) unaccounted.',
          unaccountedCount: 1,
          unaccounted: [EP_2],
          unaccountedTotalCount: 1,
        }),
      )
      .mockResolvedValueOnce(buildSession({ status: 'running' }));

    renderWizard();
    await driveWizardToStep5();
    // driveWizardToStep5 auto-skips the empty Data-type preview to the Response-
    // semantics step (step 6); advance once more (6 -> 7) to reach Start.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-start'));
    });

    // The override dialog renders the remaining unaccounted endpoint(s).
    const dialog = screen.getByTestId('start-capture-session-wizard-override-dialog');
    expect(dialog).toHaveTextContent('Start blocked: 1 in-scope committed');
    expect(
      screen.getByTestId('start-capture-session-wizard-override-endpoint-ep-2'),
    ).toHaveTextContent('POST /customers');

    // "Start anyway (override)" stays disabled while the justification is empty.
    const overrideStart = screen.getByTestId(
      'start-capture-session-wizard-override-start',
    ) as HTMLButtonElement;
    expect(overrideStart).toBeDisabled();

    fireEvent.change(
      screen.getByTestId('start-capture-session-wizard-override-justification'),
      { target: { value: 'Endpoint is decommissioned next sprint; capture proceeds.' } },
    );
    expect(overrideStart).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(overrideStart);
    });

    expect(startCaptureSession).toHaveBeenCalledTimes(2);
    const retryBody = vi.mocked(startCaptureSession).mock.calls[1][3];
    expect(retryBody).toBeDefined();
    expect(retryBody!.coverageOverrideJustification).toBe(
      'Endpoint is decommissioned next sprint; capture proceeds.',
    );
  });
});
