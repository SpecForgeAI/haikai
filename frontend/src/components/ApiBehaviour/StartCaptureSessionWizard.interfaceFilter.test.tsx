/**
 * StartCaptureSessionWizard — selectable-interface filter (Kiro 2026-08-25).
 *
 * The AMS reconciliation excludes OPERATIONAL_HTTP exactly like the internal
 * batch types (both sit in INTERNAL_INTERFACE_TYPES — their endpoints land in
 * the internalExcluded bucket, out of every denominator), but the wizard's
 * interface filter was never updated when the type was added (Oracle Nine
 * item 6): it dropped INTERNAL_PROCESSING / INTERNAL_PROCESS and left the
 * web.xml operational servlets selectable. Firing a cache-rebuild endpoint
 * mid-capture is exactly the side effect capture must avoid.
 *
 * Pins the frontend mirror set + the filter behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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

import { fetchMigrationDiscoveryContext } from '../../api/migrationDiscoveryContextApi';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import {
  StartCaptureSessionWizard,
  NON_CAPTURABLE_INTERFACE_TYPES,
} from './StartCaptureSessionWizard';

function iface(id: string, name: string, interfaceType: string) {
  return {
    id,
    name,
    description: '',
    service_id: 'svc-1',
    interface_type: interfaceType,
    spec_link: '',
    tags: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitecture).mockReturnValue({
    model: {
      metaModel: {
        entities: {
          interfaces: [
            iface('i-rest', 'CustomerAPI', 'REST_API'),
            iface('i-batch', 'Nightly batch', 'INTERNAL_PROCESSING'),
            iface('i-ops', 'Operational endpoints (web.xml)', 'OPERATIONAL_HTTP'),
          ],
        },
      },
    },
  } as unknown as ReturnType<typeof useArchitecture>);
  vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValue(undefined as never);
});

describe('capture wizard interface filter (Kiro 2026-08-25)', () => {
  it('the mirror set matches the AMS INTERNAL_INTERFACE_TYPES vocabulary', () => {
    expect([...NON_CAPTURABLE_INTERFACE_TYPES].sort()).toEqual([
      'INTERNAL_PROCESS',
      'INTERNAL_PROCESSING',
      'OPERATIONAL_HTTP',
    ]);
  });

  it('hides OPERATIONAL_HTTP interfaces exactly like the internal batch types', async () => {
    render(
      <StartCaptureSessionWizard
        open
        projectId="proj-1"
        architectureId="arch-1"
        onClose={vi.fn()}
      />,
    );

    // The REST interface is offered...
    expect(await screen.findByText('CustomerAPI')).toBeInTheDocument();
    // ...the batch interface stays hidden (pre-existing behaviour)...
    expect(screen.queryByText('Nightly batch')).toBeNull();
    // ...and the web.xml operational interface is now hidden too — AMS
    // reconciliation already excludes it server-side, so the wizard
    // matching it means it never appears in the first place.
    expect(screen.queryByText('Operational endpoints (web.xml)')).toBeNull();
  });
});
