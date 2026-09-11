/**
 * StartDiscoveryRunModal -- Database source toggle tests
 *
 * Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Group 5
 *
 * Test surface (5 tests):
 *   1. Source toggle renders both `Code` and `Database` options; the Code
 *      panel renders by default (no regression for existing flow).
 *   2. Selecting Database swaps in the DB connection form; engine dropdown
 *      shows BOTH `PostgreSQL` and `Sybase ASE` (both enabled in v1 per
 *      shaping notes -- Group 4 wired Sybase via the sidecar).
 *   3. Read-only confirmation checkbox is required to enable Test Connection
 *      AND Start Run (Start Run also requires a successful test).
 *   4. Workload-log upload field is rendered as DISABLED with a "Coming in
 *      v1.5" tooltip (D4 deferral marker).
 *   5. Test Connection success path -- the mocked fetch returns success and
 *      the success hint renders inline.
 *   6. Test Connection error path -- the mocked fetch returns a 400
 *      failure body and the error banner renders.
 *   7. Deep profiling requires the second confirmation checkbox before
 *      Start is enabled.
 *
 * Note: kept intentionally focused per the spec's "8-12 tests across
 * frontend + gateway" guidance.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

// CSS-module identity mocks -- match the codebase Vitest convention.
vi.mock('./StartDiscoveryRunModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./LogFileUploadInput.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

// Mock the gatewayClient.startDiscoveryRun export (only the one we use here).
const mockStartDiscoveryRun = vi.fn();
vi.mock('../../services/gatewayClient', async () => {
  const actual: any = await vi.importActual('../../services/gatewayClient');
  return {
    ...actual,
    startDiscoveryRun: (...args: any[]) => mockStartDiscoveryRun(...args),
  };
});

// Mock testDatabaseConnection but keep the rest of discoveryApi real so
// type re-exports flow through.
const mockTestDatabaseConnection = vi.fn();
vi.mock('../../api/discoveryApi', async () => {
  const actual: any = await vi.importActual('../../api/discoveryApi');
  return {
    ...actual,
    testDatabaseConnection: (...args: any[]) => mockTestDatabaseConnection(...args),
  };
});

import { StartDiscoveryRunModal } from './StartDiscoveryRunModal';

function renderModal(
  overrides: Partial<React.ComponentProps<typeof StartDiscoveryRunModal>> = {},
) {
  const defaults: React.ComponentProps<typeof StartDiscoveryRunModal> = {
    isOpen: true,
    projectId: 'proj-1',
    architectureId: 'arch-1',
    serviceId: 'svc-1',
    serviceName: 'Orders',
    onClose: vi.fn(),
    onRunStarted: vi.fn(),
    onRunStartError: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return { props, ...render(<StartDiscoveryRunModal {...props} />) };
}

describe('StartDiscoveryRunModal Source toggle (Spec 2026-05-16, Group 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // 1. Source toggle renders both options; Code is selected by default
  // -------------------------------------------------------------------------
  it('renders the Source toggle with both Code and Database options; Code is selected by default', () => {
    renderModal();

    expect(screen.getByTestId('start-discovery-run-modal-source-toggle')).toBeInTheDocument();

    const codeRadio = screen.getByTestId(
      'start-discovery-run-modal-source-code',
    ) as HTMLInputElement;
    const dbRadio = screen.getByTestId(
      'start-discovery-run-modal-source-database',
    ) as HTMLInputElement;

    expect(codeRadio).toBeInTheDocument();
    expect(dbRadio).toBeInTheDocument();
    expect(codeRadio.checked).toBe(true);
    expect(dbRadio.checked).toBe(false);

    // Existing code panel renders unchanged (regression guard).
    expect(screen.getByTestId('start-discovery-run-modal-code-panel')).toBeInTheDocument();
    expect(
      screen.queryByTestId('start-discovery-run-modal-database-panel'),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Selecting Database swaps in the DB form; engine dropdown shows BOTH
  // -------------------------------------------------------------------------
  it('selecting Database swaps in the connection form; engine dropdown shows Postgres, Sybase and SQL Server enabled', () => {
    renderModal();

    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    // The code panel is gone; the DB panel is rendered.
    expect(
      screen.queryByTestId('start-discovery-run-modal-code-panel'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('start-discovery-run-modal-database-panel')).toBeInTheDocument();

    const engineSelect = screen.getByTestId(
      'start-discovery-run-modal-db-engine',
    ) as HTMLSelectElement;
    expect(engineSelect).toBeInTheDocument();

    // Every engine option is enabled (Sybase via the sidecar in Group 4; SQL
    // Server via the same sidecar in the pair programme's Spec 2).
    const options = Array.from(engineSelect.querySelectorAll('option')) as HTMLOptionElement[];
    const values = options.map((o) => o.value);
    expect(values).toEqual(['postgres', 'sybase', 'mssql']);
    expect(options.map((o) => o.textContent)).toEqual([
      'PostgreSQL',
      'Sybase ASE',
      'SQL Server',
    ]);
    options.forEach((opt) => expect(opt.disabled).toBe(false));
  });

  // -------------------------------------------------------------------------
  // 2b. SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11):
  //     the SQL Server scan entry -- port default + the connection extras that
  //     appear ONLY for this engine.
  // -------------------------------------------------------------------------
  it('selecting SQL Server defaults the port to 1433 and reveals the MSSQL connection extras', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    const portInput = screen.getByTestId(
      'start-discovery-run-modal-db-port',
    ) as HTMLInputElement;
    expect(portInput.value).toBe('5432');
    // The extras block belongs to mssql alone.
    expect(
      screen.queryByTestId('start-discovery-run-modal-db-mssql-extras'),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-engine'), {
      target: { value: 'mssql' },
    });

    expect(portInput.value).toBe('1433');
    expect(
      screen.getByTestId('start-discovery-run-modal-db-mssql-extras'),
    ).toBeInTheDocument();
    // Encryption ON, certificate NOT trusted -- the safe default posture.
    expect(
      (screen.getByTestId('start-discovery-run-modal-db-mssql-encrypt') as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('start-discovery-run-modal-db-mssql-trust') as HTMLInputElement)
        .checked,
    ).toBe(false);
    // The Sybase driver picker is NOT shown for SQL Server.
    expect(
      screen.queryByTestId('start-discovery-run-modal-db-sybase-driver'),
    ).not.toBeInTheDocument();

    // The Windows-domain field only appears once NTLM is chosen.
    expect(
      screen.queryByTestId('start-discovery-run-modal-db-mssql-domain'),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByTestId('start-discovery-run-modal-db-mssql-auth-scheme'),
      { target: { value: 'ntlm' } },
    );
    expect(
      screen.getByTestId('start-discovery-run-modal-db-mssql-domain'),
    ).toBeInTheDocument();

    // Switching away hides the whole block again (and restores the Sybase one).
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-engine'), {
      target: { value: 'sybase' },
    });
    expect(
      screen.queryByTestId('start-discovery-run-modal-db-mssql-extras'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('start-discovery-run-modal-db-sybase-driver'),
    ).toBeInTheDocument();
    expect(portInput.value).toBe('5000');
  });

  it('sends the MSSQL connection extras on the test-connection probe, and NOT the Sybase driver', async () => {
    mockTestDatabaseConnection.mockResolvedValue({
      success: true,
      engine: 'mssql',
      serverVersion: 'Microsoft SQL Server 2022 (RTM) - 16.0.1000.6',
      serverEdition: 'Developer Edition (64-bit)',
    });
    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-engine'), {
      target: { value: 'mssql' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: 'sqlsrv.internal' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'WideWorldImporters' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'ro_user' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'pw-secret' },
    });
    fireEvent.change(
      screen.getByTestId('start-discovery-run-modal-db-mssql-auth-scheme'),
      { target: { value: 'ntlm' } },
    );
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-mssql-domain'), {
      target: { value: 'CORPDOMAIN' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-mssql-instance'), {
      target: { value: 'REPORTING' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-mssql-trust'));
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));

    fireEvent.click(
      screen.getByTestId('start-discovery-run-modal-db-test-connection-button'),
    );
    await waitFor(() => expect(mockTestDatabaseConnection).toHaveBeenCalledTimes(1));

    const sent = mockTestDatabaseConnection.mock.calls[0][0];
    expect(sent.dbEngine).toBe('mssql');
    expect(sent.port).toBe(1433);
    expect(sent.mssqlAuth).toEqual({
      scheme: 'ntlm',
      domain: 'CORPDOMAIN',
      encrypt: true,
      trustServerCertificate: true,
      instanceName: 'REPORTING',
    });
    // The Sybase-only field is not on an mssql payload.
    expect(sent.sybaseDriver).toBeUndefined();
  });

  it('omits the mssqlAuth block entirely on a non-mssql payload', async () => {
    mockTestDatabaseConnection.mockResolvedValue({
      success: true,
      engine: 'sybase',
      serverVersion: 'Adaptive Server Enterprise/16.0',
    });
    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-engine'), {
      target: { value: 'sybase' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: 'ase.internal' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'legacy_db' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'ro_user' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'pw-secret' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));
    fireEvent.click(
      screen.getByTestId('start-discovery-run-modal-db-test-connection-button'),
    );
    await waitFor(() => expect(mockTestDatabaseConnection).toHaveBeenCalledTimes(1));

    const sent = mockTestDatabaseConnection.mock.calls[0][0];
    expect(sent.dbEngine).toBe('sybase');
    expect(sent.mssqlAuth).toBeUndefined();
    expect(sent.sybaseDriver).toBe('auto');
  });

  // -------------------------------------------------------------------------
  // 3. Read-only confirmation checkbox required to enable Start
  // -------------------------------------------------------------------------
  it('Start button stays disabled until BOTH the test connection succeeds AND the read-only checkbox is ticked', async () => {
    mockTestDatabaseConnection.mockResolvedValueOnce({
      success: true,
      engine: 'postgres',
      serverVersion: 'PostgreSQL 16.0',
    });

    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    const startBtn = screen.getByTestId(
      'start-discovery-run-modal-start-button',
    ) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);

    // Fill the minimum identifying fields.
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: '127.0.0.1' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'ro_user' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'pw' },
    });

    const testBtn = screen.getByTestId(
      'start-discovery-run-modal-db-test-connection-button',
    ) as HTMLButtonElement;

    // Test button is also gated on read-only confirmation -- still disabled.
    expect(testBtn.disabled).toBe(true);

    // Tick the read-only confirmation checkbox.
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));
    expect(testBtn.disabled).toBe(false);

    // Start is still disabled because no test has succeeded yet.
    expect(startBtn.disabled).toBe(true);

    // Run the test; on success Start becomes enabled.
    fireEvent.click(testBtn);
    await waitFor(() => expect(mockTestDatabaseConnection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startBtn.disabled).toBe(false));
  });

  // -------------------------------------------------------------------------
  // 4. Workload-log upload control was REMOVED (Spec 2026-06-06 -- no
  //    half-built "Coming in v1.5" placeholder UI for unbuilt features).
  // -------------------------------------------------------------------------
  it('does NOT render a workload-log upload control (placeholder removed)', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    expect(
      screen.queryByTestId('start-discovery-run-modal-db-workload-log-input'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Coming in v1\.5/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 5. Test Connection success path -- success hint renders inline
  // -------------------------------------------------------------------------
  it('Test Connection success surfaces an inline success hint with the server version', async () => {
    mockTestDatabaseConnection.mockResolvedValueOnce({
      success: true,
      engine: 'postgres',
      serverVersion: 'PostgreSQL 16.0',
    });

    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: '127.0.0.1' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'u' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'p' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));

    fireEvent.click(
      screen.getByTestId('start-discovery-run-modal-db-test-connection-button'),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('start-discovery-run-modal-db-test-success'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('start-discovery-run-modal-db-test-success'),
    ).toHaveTextContent('PostgreSQL 16.0');
  });

  // -------------------------------------------------------------------------
  // 6. Test Connection error path -- error banner renders inline
  // -------------------------------------------------------------------------
  it('Test Connection failure renders the inline error banner with the engine message', async () => {
    mockTestDatabaseConnection.mockResolvedValueOnce({
      success: false,
      engine: 'postgres',
      error: { code: 400, message: 'connect ENOTFOUND demo.invalid' },
    });

    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: 'demo.invalid' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'u' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'p' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));

    fireEvent.click(
      screen.getByTestId('start-discovery-run-modal-db-test-connection-button'),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('start-discovery-run-modal-db-test-error'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('start-discovery-run-modal-db-test-error'),
    ).toHaveTextContent('connect ENOTFOUND demo.invalid');

    // Start remains disabled because the test failed.
    const startBtn = screen.getByTestId(
      'start-discovery-run-modal-start-button',
    ) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Deep profiling requires the second-click confirmation
  // -------------------------------------------------------------------------
  it('deep profiling mode requires a second confirmation checkbox before Start is enabled', async () => {
    mockTestDatabaseConnection.mockResolvedValueOnce({
      success: true,
      engine: 'postgres',
      serverVersion: 'PostgreSQL 16.0',
    });

    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    // Fill identifying fields + tick read-only + run the successful test.
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: '127.0.0.1' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'u' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'p' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));
    fireEvent.click(
      screen.getByTestId('start-discovery-run-modal-db-test-connection-button'),
    );
    const startBtn = screen.getByTestId(
      'start-discovery-run-modal-start-button',
    ) as HTMLButtonElement;
    await waitFor(() => expect(startBtn.disabled).toBe(false));

    // Switching to deep profiling re-disables Start until the second
    // confirmation checkbox is ticked.
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-profiling-mode-deep'));
    expect(startBtn.disabled).toBe(true);

    // The second confirmation checkbox appears; tick it.
    const deepConfirm = screen.getByTestId(
      'start-discovery-run-modal-db-deep-confirmation',
    );
    expect(deepConfirm).toBeInTheDocument();
    // The label wraps the checkbox; click the inner checkbox.
    const checkbox = deepConfirm.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => expect(startBtn.disabled).toBe(false));
  });

  // -------------------------------------------------------------------------
  // 8. Start (database) sends databaseCredentials separately from databaseConfig
  //
  // Regression: the discovery-service expects `database_credentials` as a
  // top-level field on the run-create body, not nested inside
  // `database_config`. The frontend MUST surface username/password through
  // the dedicated `databaseCredentials` extras field so the run-create
  // doesn't 400 with "missing_credentials".
  // -------------------------------------------------------------------------
  it('Start (database) passes credentials as a separate databaseCredentials field on the run-create extras', async () => {
    mockTestDatabaseConnection.mockResolvedValueOnce({
      success: true,
      engine: 'postgres',
      serverVersion: 'PostgreSQL 16.0',
    });
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-1' });

    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-host'), {
      target: { value: '127.0.0.1' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-name'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-username'), {
      target: { value: 'ro_user' },
    });
    fireEvent.change(screen.getByTestId('start-discovery-run-modal-db-password'), {
      target: { value: 'pw-secret' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));
    fireEvent.click(
      screen.getByTestId('start-discovery-run-modal-db-test-connection-button'),
    );
    await waitFor(() => expect(mockTestDatabaseConnection).toHaveBeenCalledTimes(1));

    const startBtn = screen.getByTestId(
      'start-discovery-run-modal-start-button',
    ) as HTMLButtonElement;
    await waitFor(() => expect(startBtn.disabled).toBe(false));
    fireEvent.click(startBtn);

    await waitFor(() => expect(mockStartDiscoveryRun).toHaveBeenCalledTimes(1));

    // Positional signature: (projectId, architectureId, serviceId, confirmLlmSolo, extras)
    const callArgs = mockStartDiscoveryRun.mock.calls[0];
    const extras = callArgs[4];
    expect(extras).toBeDefined();
    expect(extras.discoveryKind).toBe('database');
    expect(extras.databaseCredentials).toEqual({
      username: 'ro_user',
      password: 'pw-secret',
    });
    // databaseConfig is still sent (carries connection metadata + filters),
    // but the discovery-service reads credentials from the dedicated field.
    expect(extras.databaseConfig).toBeDefined();
  });
});
