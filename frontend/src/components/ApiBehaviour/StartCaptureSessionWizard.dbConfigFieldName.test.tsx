/**
 * StartCaptureSessionWizard -- DB config field-name regression (2026-06-05)
 *
 * Bug: `buildDbConfigRedacted` persisted the DB engine under the key `type`,
 * but every backend reader of `db_config_redacted_json` reads `dbType` (the
 * orchestrator's `createDbAdapter({ dbType: cfg.dbType, ... })`, the three DB
 * tools, and the `/test-db-connection` handler). The mismatch left
 * `cfg.dbType` undefined -> the orchestrator threw `Unsupported dbType:
 * undefined` and the capture run crashed (then sat as a RUNNING zombie).
 *
 * This test pins the fix: selecting a real DB engine in Step 3 must surface
 * `db_config_redacted_json.dbType` (NOT `type`) on the create-session payload.
 *
 * Test strategy mirrors `StartCaptureSessionWizard.extractEndpoints.test.tsx`:
 *   - vi.mock the apiBehaviourClient + migrationDiscoveryContextApi +
 *     useArchitecture so step transitions never hit a real network and we can
 *     drive the wizard to the Step 3 -> Step 4 transition (where
 *     `createCaptureSession` is invoked) cleanly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

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

const PROJECT_ID = 'proj-dbcfg-1';
const ARCH_ID = 'arch-dbcfg-1';
const SESSION_ID = 'session-dbcfg-1';
const REST_IFACE_ID = 'iface-rest-dbcfg-1';

function mockArchModel() {
  return {
    model: {
      metaModel: {
        entities: {
          interfaces: [
            {
              id: REST_IFACE_ID,
              name: 'CustomerAPI',
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
    created_at: '2026-06-05T00:00:00Z',
    updated_at: '2026-06-05T00:00:00Z',
  };
}

/**
 * Find the <input> that follows a given <label> text inside Step 3. The DB
 * detail fields use plain <label> + <input> without `htmlFor`, so we walk the
 * shared `.fieldGroup` wrapper instead of relying on label association.
 */
function setDbFieldByLabel(labelText: string, value: string) {
  const label = screen.getByText(labelText);
  const group = label.closest('div');
  if (!group) throw new Error(`no wrapping div for DB field "${labelText}"`);
  const input = within(group).getByRole('textbox');
  fireEvent.change(input, { target: { value } });
}

/**
 * Drive the wizard to Step 3 with a REST interface selected and the minimum
 * Step-2 fields populated. Stops on Step 3 so the caller can configure DB.
 */
async function driveToStep3() {
  vi.mocked(useArchitecture).mockReturnValue(mockArchModel());
  vi.mocked(fetchMigrationDiscoveryContext).mockResolvedValue(undefined as never);
  vi.mocked(createCaptureSession).mockResolvedValue(buildSession());
  vi.mocked(submitSecrets).mockResolvedValue({ ok: true } as never);
  vi.mocked(parseOas).mockResolvedValue({
    sessionId: SESSION_ID,
    operationCount: 0,
    mutatingExcluded: 0,
    title: null,
    version: null,
    skippedInterfaceCount: 0,
    skippedInterfaceIds: [],
  } as never);
  vi.mocked(listOperations).mockResolvedValue([] as never);

  render(
    <StartCaptureSessionWizard
      open={true}
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      onClose={vi.fn()}
    />,
  );

  await waitFor(() => {
    expect(fetchMigrationDiscoveryContext).toHaveBeenCalled();
  });

  // Step 1 -> Step 2: pick the REST interface.
  fireEvent.click(
    screen.getByTestId(`start-capture-session-wizard-interface-${REST_IFACE_ID}`),
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

  // Now on Step 3 -- the DB type selector is present.
  await waitFor(() => {
    expect(
      screen.getByTestId('start-capture-session-wizard-db-type'),
    ).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartCaptureSessionWizard -- db_config_redacted_json field name', () => {
  it('persists the engine under `dbType` (not `type`) when Sybase is selected', async () => {
    await driveToStep3();

    // Select Sybase -> detail fields appear.
    fireEvent.change(screen.getByTestId('start-capture-session-wizard-db-type'), {
      target: { value: 'sybase' },
    });
    setDbFieldByLabel('Host', 'sybase.example.internal');
    setDbFieldByLabel('Port', '5000');
    setDbFieldByLabel('Database', 'legacy_db');
    setDbFieldByLabel('Username', 'capture_ro');

    // Step 3 -> Step 4 transition invokes createCaptureSession with the
    // redacted DB config built from Step-3 state.
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });

    await waitFor(() => {
      expect(createCaptureSession).toHaveBeenCalled();
    });

    const [, , payload] = vi.mocked(createCaptureSession).mock.calls[0];
    const dbConfig = (payload as { db_config_redacted_json: Record<string, unknown> | null })
      .db_config_redacted_json;

    expect(dbConfig).not.toBeNull();
    // The crux of the fix: the engine is under `dbType`, never `type`.
    expect(dbConfig).toMatchObject({
      dbType: 'sybase',
      host: 'sybase.example.internal',
      database: 'legacy_db',
      username: 'capture_ro',
    });
    expect(dbConfig).not.toHaveProperty('type');
    // Password is always redacted on this blob.
    expect(dbConfig).toMatchObject({ password: '[REDACTED]' });
  });

  it('persists `dbType: "postgres"` (not `type`) when PostgreSQL is selected', async () => {
    await driveToStep3();

    fireEvent.change(screen.getByTestId('start-capture-session-wizard-db-type'), {
      target: { value: 'postgres' },
    });
    setDbFieldByLabel('Host', 'pg.example.internal');
    setDbFieldByLabel('Database', 'app_db');
    setDbFieldByLabel('Username', 'pg_ro');

    await act(async () => {
      fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
    });

    await waitFor(() => {
      expect(createCaptureSession).toHaveBeenCalled();
    });

    const [, , payload] = vi.mocked(createCaptureSession).mock.calls[0];
    const dbConfig = (payload as { db_config_redacted_json: Record<string, unknown> | null })
      .db_config_redacted_json;

    expect(dbConfig).toMatchObject({ dbType: 'postgres' });
    expect(dbConfig).not.toHaveProperty('type');
  });
});
