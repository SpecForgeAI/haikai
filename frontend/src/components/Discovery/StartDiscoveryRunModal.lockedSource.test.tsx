/**
 * StartDiscoveryRunModal -- lockedSourceMode (toggle locking).
 *
 * Spec 2026-06-06: the two row-context-menu entry points open this modal with
 * the Source fixed and the Code/Database toggle HIDDEN:
 *   - "Start Discovery Run (No Libraries)" -> locked 'code'
 *   - "Start Discovery Run (Database)"     -> locked 'database'
 * When `lockedSourceMode` is omitted the toggle is shown (legacy behaviour).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('./StartDiscoveryRunModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./LogFileUploadInput.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../../services/gatewayClient', async () => {
  const actual: any = await vi.importActual('../../services/gatewayClient');
  return { ...actual, startDiscoveryRun: vi.fn() };
});
vi.mock('../../api/discoveryApi', async () => {
  const actual: any = await vi.importActual('../../api/discoveryApi');
  return { ...actual, testDatabaseConnection: vi.fn() };
});

import { StartDiscoveryRunModal } from './StartDiscoveryRunModal';

const TOGGLE = 'start-discovery-run-modal-source-toggle';
const CODE_PANEL = 'start-discovery-run-modal-code-panel';

function renderModal(
  overrides: Partial<React.ComponentProps<typeof StartDiscoveryRunModal>> = {},
) {
  const props: React.ComponentProps<typeof StartDiscoveryRunModal> = {
    isOpen: true,
    projectId: 'proj-1',
    architectureId: 'arch-1',
    serviceId: 'svc-1',
    serviceName: 'Orders',
    onClose: vi.fn(),
    onRunStarted: vi.fn(),
    onRunStartError: vi.fn(),
    ...overrides,
  };
  return render(<StartDiscoveryRunModal {...props} />);
}

describe('StartDiscoveryRunModal lockedSourceMode (Spec 2026-06-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('unlocked (default): shows the Code/Database toggle + the Code panel', () => {
    renderModal();
    expect(screen.getByTestId(TOGGLE)).toBeInTheDocument();
    expect(screen.getByTestId(CODE_PANEL)).toBeInTheDocument();
  });

  it("locked to 'code': hides the toggle, still shows the Code panel", () => {
    renderModal({ lockedSourceMode: 'code' });
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();
    expect(screen.getByTestId(CODE_PANEL)).toBeInTheDocument();
  });

  it("locked to 'database': hides the toggle and switches off the Code panel (DB mode)", () => {
    renderModal({ lockedSourceMode: 'database' });
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();
    expect(screen.queryByTestId(CODE_PANEL)).not.toBeInTheDocument();
  });
});
