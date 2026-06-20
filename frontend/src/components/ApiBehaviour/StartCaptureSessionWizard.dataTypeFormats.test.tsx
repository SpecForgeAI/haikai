/**
 * StartCaptureSessionWizard -- Data-type formats step tests
 *
 * Spec: 2026-06-20 Capture data-type format defaults -- Task Group 6 (6.1).
 *
 * Coverage:
 *   - (a) Step 5 renders the 4-column table (Data Type | Code Format(s) |
 *     Contract Format(s) | Default Format) from a mocked preview, with the
 *     stepper showing "Data-type formats" at step 5 and "Start" at step 6.
 *   - (b) AUTO-SKIP: an empty preview makes Endpoints (4) advance straight to
 *     Start (6) -- the Data-type step is never shown (Q8).
 *   - (c) Col-4 edit works AND the explicit "(no default)" choice records a
 *     `null` for that category; the PATCH on advance carries the map INCLUDING
 *     the `null`.
 *   - (d) Per-row transparency lists the contributing fields on expand (Q9).
 *   - (e) The renumber is intact: Start is reachable at step 6 and the
 *     `/start` call fires from there.
 *
 * Test strategy: Vitest + `vi.mock()` with the `vi.importActual` spread
 * pattern (per project conventions) so the REAL types/helpers are used while
 * every network wrapper -- including the NEW `dataTypeDefaultsPreview` action
 * client -- is a spy. The wizard's preview fetch happens on the Step 4 -> 5
 * advance, so the mock's resolved `rows` drives the render-vs-auto-skip branch.
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
    dataTypeDefaultsPreview: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn().mockRejectedValue(new Error('unavailable')),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

import {
  createCaptureSession,
  dataTypeDefaultsPreview,
  listOperations,
  parseOas,
  reconcileInventory,
  startCaptureSession,
  submitSecrets,
  updateCaptureSession,
  type ApiBehaviourCaptureSessionDto,
  type DataTypeDefaultsPreviewResponse,
  type InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-dtf-1';
const ARCH_ID = 'arch-dtf-1';
const SESSION_ID = 'session-dtf-1';

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
    name: 'DTF session',
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
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

function buildReconciliation(): InventoryReconciliationResponse {
  return {
    in_scope_unaccounted_endpoints: [],
    operations_without_model_endpoint: [],
    excluded_by_scope_endpoints: [],
    in_scope_coverage_pct: 100,
    in_scope_accounted_count: 0,
    in_scope_total_count: 0,
    architecture_coverage_pct: 100,
    architecture_accounted_count: 0,
    architecture_total_count: 0,
  };
}

const PREVIEW_WITH_ROWS: DataTypeDefaultsPreviewResponse = {
  sessionId: SESSION_ID,
  rows: [
    {
      category: 'date',
      code_formats: ['dd-MMM-yyyy'],
      contract_formats: ['date'],
      default_format: 'dd-MMM-yyyy',
      contributing_fields: [
        {
          name: 'orderDate',
          location: 'query',
          code_format: 'dd-MMM-yyyy',
          contract_format: null,
        },
      ],
    },
    {
      category: 'enum',
      code_formats: [],
      contract_formats: [],
      default_format: null,
      contributing_fields: [
        {
          name: 'status',
          location: 'body',
          code_format: null,
          contract_format: null,
        },
      ],
    },
  ],
};

const EMPTY_PREVIEW: DataTypeDefaultsPreviewResponse = {
  sessionId: SESSION_ID,
  rows: [],
};

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

/** Step 1 (pick interface) -> 2 (env) -> 3 -> 4. */
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

/** Step 4 -> 5 (fetches the preview; lands on Data-type formats unless empty). */
async function advanceFromStep4() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  });
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
  vi.mocked(updateCaptureSession).mockResolvedValue(
    buildSession({ status: 'configured' }),
  );
  vi.mocked(startCaptureSession).mockResolvedValue(
    buildSession({ status: 'running' }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Data-type formats step -- render + renumber (Task 6.1a)', () => {
  it('renders the 4-column table from the preview, with the stepper carrying step 5 + step 6', async () => {
    vi.mocked(dataTypeDefaultsPreview).mockResolvedValue(PREVIEW_WITH_ROWS);
    renderWizard();
    await driveWizardToStep4();
    await advanceFromStep4();

    // The preview was fetched on the Step 4 -> 5 advance.
    expect(dataTypeDefaultsPreview).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SESSION_ID,
    );

    // Stepper renumber: step 5 = "Data-type formats", step 6 = "Start".
    expect(
      screen.getByTestId('start-capture-session-wizard-step-5'),
    ).toHaveTextContent('Data-type formats');
    expect(
      screen.getByTestId('start-capture-session-wizard-step-6'),
    ).toHaveTextContent('Start');

    // 4-column header + the discovered rows render.
    const table = screen.getByTestId('start-capture-session-wizard-data-type-table');
    expect(table).toHaveTextContent('Data Type');
    expect(table).toHaveTextContent('Code Format(s)');
    expect(table).toHaveTextContent('Contract Format(s)');
    expect(table).toHaveTextContent('Default Format');
    expect(
      screen.getByTestId('start-capture-session-wizard-data-type-row-date'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('start-capture-session-wizard-data-type-row-enum'),
    ).toBeInTheDocument();

    // Read-only evidence columns render the discovered formats.
    expect(
      screen.getByTestId('start-capture-session-wizard-data-type-code-date'),
    ).toHaveTextContent('dd-MMM-yyyy');
    expect(
      screen.getByTestId('start-capture-session-wizard-data-type-contract-date'),
    ).toHaveTextContent('date');

    // Col-4 is seeded from default_format (chain (a)).
    const dateDefault = screen.getByTestId(
      'start-capture-session-wizard-data-type-default-date',
    ) as HTMLInputElement;
    expect(dateDefault.value).toBe('dd-MMM-yyyy');

    // Start is NOT yet reachable -- the footer shows Next, not Start.
    expect(
      screen.queryByTestId('start-capture-session-wizard-start'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('start-capture-session-wizard-next'),
    ).toBeInTheDocument();
  });

  it('lists the contributing fields for a row on expand (Q9 transparency)', async () => {
    vi.mocked(dataTypeDefaultsPreview).mockResolvedValue(PREVIEW_WITH_ROWS);
    renderWizard();
    await driveWizardToStep4();
    await advanceFromStep4();

    // Collapsed by default.
    expect(
      screen.queryByTestId('start-capture-session-wizard-data-type-evidence-date'),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(
        'start-capture-session-wizard-data-type-evidence-toggle-date',
      ),
    );

    const evidence = screen.getByTestId(
      'start-capture-session-wizard-data-type-evidence-date',
    );
    expect(evidence).toHaveTextContent('orderDate');
    expect(evidence).toHaveTextContent('query');
    expect(evidence).toHaveTextContent('dd-MMM-yyyy');
  });
});

describe('Data-type formats step -- auto-skip (Task 6.1a)', () => {
  it('skips the step and lands directly on Start (step 6) when the preview is empty', async () => {
    vi.mocked(dataTypeDefaultsPreview).mockResolvedValue(EMPTY_PREVIEW);
    renderWizard();
    await driveWizardToStep4();
    await advanceFromStep4();

    // The preview was consulted...
    expect(dataTypeDefaultsPreview).toHaveBeenCalledTimes(1);
    // ...but the Data-type table is never shown.
    expect(
      screen.queryByTestId('start-capture-session-wizard-data-type-table'),
    ).not.toBeInTheDocument();
    // The wizard is on Start (step 6): the Start button is present and no PATCH
    // of data_type_defaults_json happened on the skip.
    expect(
      screen.getByTestId('start-capture-session-wizard-start'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('start-capture-session-wizard-step-6'),
    ).toHaveClass(/stepActive/);
    expect(updateCaptureSession).not.toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SESSION_ID,
      expect.objectContaining({
        data_type_defaults_json: expect.anything(),
      }),
    );
  });
});

describe('Data-type formats step -- edit, no-default + persist (Task 6.1b, 6.1c)', () => {
  it('persists an edited default AND an explicit "(no default)" null on advance, then reaches Start', async () => {
    vi.mocked(dataTypeDefaultsPreview).mockResolvedValue(PREVIEW_WITH_ROWS);
    renderWizard();
    await driveWizardToStep4();
    await advanceFromStep4();

    // Edit the date default (free text accepted, no validation).
    fireEvent.change(
      screen.getByTestId('start-capture-session-wizard-data-type-default-date'),
      { target: { value: 'yyyy/MM/dd' } },
    );

    // Tick the explicit "(no default)" choice for enum -> records null.
    fireEvent.click(
      screen.getByTestId('start-capture-session-wizard-data-type-no-default-enum'),
    );
    // The hint surfaces it as a deliberate recorded decision.
    expect(
      screen.getByTestId(
        'start-capture-session-wizard-data-type-no-default-hint-enum',
      ),
    ).toBeInTheDocument();
    // The enum input is disabled while "(no default)" is selected.
    expect(
      screen.getByTestId('start-capture-session-wizard-data-type-default-enum'),
    ).toBeDisabled();

    // Advance (step 5 -> 6) PATCHes the map.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });

    expect(updateCaptureSession).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SESSION_ID,
      expect.objectContaining({
        data_type_defaults_json: expect.objectContaining({
          date: 'yyyy/MM/dd',
          enum: null,
        }),
      }),
    );
    // The persisted enum value is EXACTLY null (not coerced to a string).
    const patchCall = vi
      .mocked(updateCaptureSession)
      .mock.calls.find(
        (c) =>
          c[3] &&
          Object.prototype.hasOwnProperty.call(c[3], 'data_type_defaults_json'),
      );
    expect(patchCall).toBeDefined();
    const map = (patchCall![3] as { data_type_defaults_json: Record<string, string | null> })
      .data_type_defaults_json;
    expect(map.enum).toBeNull();
    expect(map.date).toBe('yyyy/MM/dd');

    // Renumber intact: Start is now reachable at step 6.
    expect(
      screen.getByTestId('start-capture-session-wizard-start'),
    ).toBeInTheDocument();
  });

  it('fires /start from the step-6 Start button (renumber leaves Start reachable)', async () => {
    vi.mocked(dataTypeDefaultsPreview).mockResolvedValue(PREVIEW_WITH_ROWS);
    renderWizard();
    await driveWizardToStep4();
    await advanceFromStep4();

    // Step 5 -> 6.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });

    // Step 6: Start.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-start'));
    });

    await waitFor(() => {
      expect(startCaptureSession).toHaveBeenCalledTimes(1);
    });
    expect(startCaptureSession).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SESSION_ID,
      expect.anything(),
    );
  });
});
