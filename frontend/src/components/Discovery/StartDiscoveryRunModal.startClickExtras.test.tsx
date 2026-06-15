/**
 * Cross-stack gap-fill test (Spec 2026-05-16 Database Discovery Packs --
 * Task Group 6): when the user clicks Start in the Database source flow,
 * the modal must invoke `startDiscoveryRun` with the correct extras shape so
 * the gateway's run-create body carries `discovery_kind='database'` and the
 * `database_config` blob the discovery-service then dispatches on.
 *
 * Existing tests covered the UI gating (toggle, engine dropdown, read-only,
 * deep-confirm, test-connection success/error) but did NOT pin the Start
 * click payload that crosses into the gatewayClient. This test closes that
 * gap end-to-end (UI -> gatewayClient extras boundary).
 *
 * Sibling gateway test `discovery-db-run-create-kind-forward.test.ts`
 * verifies the gateway then forwards those fields verbatim to the
 * discovery-service. Together the two tests pin the full cross-stack hop.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('./StartDiscoveryRunModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./LogFileUploadInput.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

const mockStartDiscoveryRun = vi.fn();
vi.mock('../../services/gatewayClient', async () => {
  const actual: any = await vi.importActual('../../services/gatewayClient');
  return {
    ...actual,
    startDiscoveryRun: (...args: any[]) => mockStartDiscoveryRun(...args),
  };
});

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
  return { props: { ...defaults, ...overrides }, ...render(<StartDiscoveryRunModal {...{ ...defaults, ...overrides }} />) };
}

describe('StartDiscoveryRunModal Start click extras (Spec 2026-05-16, Group 6 gap-fill)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('Start in Database source mode invokes startDiscoveryRun with discoveryKind="database" and the connection config (including password ridealong) in extras.databaseConfig', async () => {
    mockTestDatabaseConnection.mockResolvedValueOnce({
      success: true,
      engine: 'postgres',
      serverVersion: 'PostgreSQL 16.0',
    });
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-db-1' });

    renderModal();
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-source-database'));

    // Fill the identifying fields.
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
      target: { value: 'super-secret' },
    });
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-db-readonly-confirmed'));

    // Successful test connection unlocks Start.
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

    // -----------------------------------------------------------------------
    // Cross-stack assertion: the modal must pass the extras object so the
    // gatewayClient builds the body the gateway forwards (see sibling test
    // discovery-db-run-create-kind-forward.test.ts for the gateway side).
    // -----------------------------------------------------------------------
    const args = mockStartDiscoveryRun.mock.calls[0];
    // Positional signature (projectId, architectureId, serviceId, confirmLlmSolo, extras).
    expect(args[0]).toBe('proj-1');
    expect(args[1]).toBe('arch-1');
    expect(args[2]).toBe('svc-1');
    expect(args[3]).toBe(false);

    const extras = args[4];
    expect(extras).toBeDefined();
    expect(extras.discoveryKind).toBe('database');
    expect(extras.databaseConfig).toBeDefined();
    expect(extras.databaseConfig.dbEngine).toBe('postgres');
    expect(extras.databaseConfig.host).toBe('127.0.0.1');
    expect(extras.databaseConfig.databaseName).toBe('demo');
    expect(extras.databaseConfig.username).toBe('ro_user');
    // Password ridealong: in v1 the run-create body intentionally carries the
    // password (the discovery-service holds it in-memory and purges on run
    // completion; only the AMS-persisted snapshot is redacted). This is the
    // contract documented in spec.md "DB config DTO fields" and the
    // gatewayClient comment block. The gateway tests pin the gateway not
    // stripping it on the way through.
    expect(extras.databaseConfig.password).toBe('super-secret');
    expect(extras.databaseConfig.readOnlyConfirmed).toBe(true);
  });

  it('Start in legacy Code source mode invokes startDiscoveryRun WITHOUT extras (regression net: existing code-pipeline runs unchanged)', async () => {
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-code-1' });

    renderModal();
    // Do NOT switch to Database mode -- the default is Code.

    const startBtn = screen.getByTestId(
      'start-discovery-run-modal-start-button',
    ) as HTMLButtonElement;
    // Code path Start enablement: needs no logs / nothing else; the Code panel
    // exposes Start as long as the form has no validation issues.
    await waitFor(() => expect(startBtn.disabled).toBe(false));
    fireEvent.click(startBtn);

    await waitFor(() => expect(mockStartDiscoveryRun).toHaveBeenCalledTimes(1));

    // Existing call signature: positional 4 args, NO extras. The 5th
    // positional arg (extras) must be undefined so the gatewayClient's
    // body shape stays unchanged for legacy callers.
    const args = mockStartDiscoveryRun.mock.calls[0];
    expect(args.length).toBeLessThanOrEqual(5);
    expect(args[4]).toBeUndefined();
  });
});
