/**
 * StartCaptureSessionWizard — PRE-START compensation preflight gate
 * (CSD Spec 3 gap fix, 2026-08-19).
 *
 * Pins the wizard-level behavior over the already-tested message builders:
 *   - unmapped write endpoints -> window.confirm with the refusal list;
 *     declining leaves the session UNSTARTED (no /start, no status PATCH);
 *   - accepting proceeds to /start;
 *   - a clean preflight never prompts;
 *   - a preflight outage prompts with the unavailable wording (loud, the
 *     operator decides — never a silent skip).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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
    dataTypeDefaultsPreview: vi.fn().mockResolvedValue({ sessionId: 'session-pf-1', rows: [] }),
    getCompensationPreflight: vi.fn(),
  };
});

vi.mock('../../api/migrationDiscoveryContextApi', () => ({
  fetchMigrationDiscoveryContext: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

import {
  createCaptureSession,
  submitSecrets,
  parseOas,
  startCaptureSession,
  updateCaptureSession,
  listOperations,
  getCompensationPreflight,
  type ApiBehaviourCaptureSessionDto,
} from '../../api/apiBehaviourClient';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-preflight';
const ARCH_ID = 'arch-preflight';

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
    id: 'session-pf-1',
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Preflight session',
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
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

async function driveWizardToStart() {
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
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-next'));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('start-capture-session-wizard-start'));
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
  const created = buildSession();
  vi.mocked(createCaptureSession).mockResolvedValue(created);
  vi.mocked(submitSecrets).mockResolvedValue({ ok: true } as never);
  vi.mocked(parseOas).mockResolvedValue({
    sessionId: created.id,
    operationCount: 0,
    mutatingExcluded: 0,
    title: 'API',
    version: '1',
  });
  vi.mocked(updateCaptureSession).mockResolvedValue(buildSession({ status: 'configured' }));
  vi.mocked(startCaptureSession).mockResolvedValue(buildSession({ status: 'running' }));
  vi.mocked(listOperations).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pre-start compensation preflight gate', () => {
  it('declining the unmapped-endpoints confirm leaves the session unstarted', async () => {
    vi.mocked(getCompensationPreflight).mockResolvedValue({
      session_id: 'session-pf-1',
      model_resolvable: true,
      write_endpoints_without_effect_map: ['DELETE /orders/{id}', 'POST /orders'],
      note: 'x',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderWizard();
    await driveWizardToStart();

    expect(getCompensationPreflight).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      'session-pf-1',
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(String(confirmSpy.mock.calls[0][0])).toContain('REFUSED at capture time');
    expect(String(confirmSpy.mock.calls[0][0])).toContain('DELETE /orders/{id}');
    expect(startCaptureSession).not.toHaveBeenCalled();
    // The gate sits BEFORE the status='configured' PATCH — earlier wizard
    // steps may PATCH other session fields, but the start-path transition
    // must not have happened.
    const configuredCalls = vi
      .mocked(updateCaptureSession)
      .mock.calls.filter(
        (c) => (c[3] as { status?: string } | undefined)?.status === 'configured',
      );
    expect(configuredCalls).toHaveLength(0);
  });

  it('accepting the confirm proceeds to /start', async () => {
    vi.mocked(getCompensationPreflight).mockResolvedValue({
      session_id: 'session-pf-1',
      model_resolvable: true,
      write_endpoints_without_effect_map: ['POST /orders'],
      note: 'x',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWizard();
    await driveWizardToStart();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(startCaptureSession).toHaveBeenCalledTimes(1);
  });

  it('a clean preflight never prompts and starts normally', async () => {
    vi.mocked(getCompensationPreflight).mockResolvedValue({
      session_id: 'session-pf-1',
      model_resolvable: true,
      write_endpoints_without_effect_map: [],
      note: null,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderWizard();
    await driveWizardToStart();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(startCaptureSession).toHaveBeenCalledTimes(1);
  });

  it('a preflight outage prompts with the unavailable wording (operator decides)', async () => {
    vi.mocked(getCompensationPreflight).mockRejectedValue(new Error('HTTP 503'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWizard();
    await driveWizardToStart();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(String(confirmSpy.mock.calls[0][0])).toContain('could not run');
    expect(startCaptureSession).toHaveBeenCalledTimes(1);
  });
});
