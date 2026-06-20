/**
 * AddNewBehaviourModal tests
 *
 * Spec 2026-06-20 Add New Behaviour -- Manual Capture (Task 5.1)
 *
 * Covers the critical modal behaviours:
 *   1. Picker lists ONLY `included === true` operations, labelled `<METHOD> <path>`.
 *   2. An unfilled `{param}` blocks Save with an inline error naming it.
 *   3. Invalid JSON in the body blocks Save with an inline "not valid JSON".
 *   4. A mutating verb disables Save until the confirm checkbox is ticked; a
 *      stronger warning shows when `mutating_calls_confirmed === false`.
 *   5. Headers are prefilled from the redacted-key union; a valid Save calls
 *      `manualCapture` with the resolved path/method/query/headers/body + flag.
 *   6. Secrets not loaded (prop) routes to the parent re-enter prompt and does
 *      NOT render the request form.
 *
 * Strategy: mock `apiBehaviourClient` with the spread-actual override pattern so
 * the real `isSecretsNotLoadedError` / `ApiBehaviourApiError` are still used.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    manualCapture: vi.fn(),
  };
});

import {
  manualCapture,
  ApiBehaviourApiError,
  SECRETS_NOT_LOADED_CODE,
  type ApiBehaviourOperationDto,
} from '../../api/apiBehaviourClient';
import { AddNewBehaviourModal } from './AddNewBehaviourModal';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const SESSION_ID = 'session-1';

function buildOperation(
  overrides: Partial<ApiBehaviourOperationDto> = {},
): ApiBehaviourOperationDto {
  return {
    id: 'op-get',
    session_id: SESSION_ID,
    operation_id: 'getThing',
    method: 'GET',
    path: '/things/{id}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

function renderModal(
  props: Partial<React.ComponentProps<typeof AddNewBehaviourModal>> = {},
) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onRequestReenterSecrets = vi.fn();
  const operations = props.operations ?? [
    buildOperation(),
    buildOperation({ id: 'op-post', operation_id: 'createThing', method: 'POST', path: '/things' }),
    buildOperation({ id: 'op-excluded', operation_id: 'hidden', method: 'GET', path: '/hidden', included: false }),
  ];
  render(
    <AddNewBehaviourModal
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      sessionId={SESSION_ID}
      operations={operations}
      headerKeyUnion={props.headerKeyUnion ?? ['Content-Type', 'X-Tenant']}
      mutatingCallsConfirmed={props.mutatingCallsConfirmed ?? true}
      secretsLoaded={props.secretsLoaded ?? true}
      onRequestReenterSecrets={onRequestReenterSecrets}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onClose, onSaved, onRequestReenterSecrets };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AddNewBehaviourModal (Task 5.1)', () => {
  it('lists ONLY included operations, labelled <METHOD> <path>', () => {
    renderModal();
    const select = screen.getByTestId('add-new-behaviour-operation-select');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toContain('GET /things/{id}');
    expect(optionLabels).toContain('POST /things');
    // Excluded operation must NOT be offered.
    expect(optionLabels).not.toContain('GET /hidden');
  });

  it('blocks Save and names the unfilled path param', async () => {
    renderModal();
    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-get' },
    });
    fireEvent.click(screen.getByTestId('add-new-behaviour-save'));
    await flush();
    const err = screen.getByTestId('add-new-behaviour-validation-error');
    expect(err.textContent).toContain('id');
    expect(manualCapture as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('blocks Save on invalid JSON body with an inline message', async () => {
    renderModal();
    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-get' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-path-param-id'), {
      target: { value: '42' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-body'), {
      target: { value: '{ not json' },
    });
    fireEvent.click(screen.getByTestId('add-new-behaviour-save'));
    await flush();
    expect(screen.getByTestId('add-new-behaviour-validation-error').textContent).toContain(
      'not valid JSON',
    );
    expect(manualCapture as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('gates a mutating verb behind the confirm checkbox and shows the stronger warning when posture is unconfirmed', async () => {
    renderModal({ mutatingCallsConfirmed: false });
    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-post' },
    });
    // Stronger warning rendered because mutating_calls_confirmed === false.
    expect(screen.getByTestId('add-new-behaviour-mutating-strong-warning')).toBeTruthy();
    // Save disabled until the checkbox is ticked.
    const save = screen.getByTestId('add-new-behaviour-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('add-new-behaviour-mutating-confirm'));
    expect((screen.getByTestId('add-new-behaviour-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('prefills headers from the union and on valid Save calls manualCapture with the resolved request', async () => {
    (manualCapture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: SESSION_ID,
      scenarioId: 'scn-1',
      capture: { id: 'cap-1' },
    });
    const { onSaved, onClose } = renderModal();
    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-get' },
    });
    // Header rows are prefilled from the union keys.
    expect((screen.getByTestId('add-new-behaviour-header-key-0') as HTMLInputElement).value).toBe(
      'Content-Type',
    );
    expect((screen.getByTestId('add-new-behaviour-header-key-1') as HTMLInputElement).value).toBe(
      'X-Tenant',
    );
    fireEvent.change(screen.getByTestId('add-new-behaviour-header-value-1'), {
      target: { value: 'acme' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-path-param-id'), {
      target: { value: '42' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-query-key-0'), {
      target: { value: 'q' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-query-value-0'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-body'), {
      target: { value: '{"name":"Rex"}' },
    });
    fireEvent.click(screen.getByTestId('add-new-behaviour-save'));
    await flush();

    const mock = manualCapture as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    const [p, a, s, body] = mock.mock.calls[0];
    expect(p).toBe(PROJECT_ID);
    expect(a).toBe(ARCH_ID);
    expect(s).toBe(SESSION_ID);
    expect(body.operationId).toBe('op-get');
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/things/42');
    expect(body.query).toEqual({ q: '1' });
    expect(body.headers).toEqual({ 'X-Tenant': 'acme' });
    expect(body.body).toEqual({ name: 'Rex' });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('routes to the parent re-enter prompt when secrets are not loaded (prop)', () => {
    const { onRequestReenterSecrets } = renderModal({ secretsLoaded: false });
    expect(screen.getByTestId('add-new-behaviour-secrets-not-loaded')).toBeTruthy();
    // The request form (operation picker) is NOT rendered.
    expect(screen.queryByTestId('add-new-behaviour-operation-select')).toBeNull();
    fireEvent.click(screen.getByTestId('add-new-behaviour-reenter-secrets'));
    expect(onRequestReenterSecrets).toHaveBeenCalledTimes(1);
  });

  it('maps a 409 SECRETS_NOT_LOADED send failure to the re-enter prompt, not a generic error', async () => {
    (manualCapture as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiBehaviourApiError(409, { code: SECRETS_NOT_LOADED_CODE, message: 'no secrets' }),
    );
    renderModal();
    fireEvent.change(screen.getByTestId('add-new-behaviour-operation-select'), {
      target: { value: 'op-get' },
    });
    fireEvent.change(screen.getByTestId('add-new-behaviour-path-param-id'), {
      target: { value: '42' },
    });
    fireEvent.click(screen.getByTestId('add-new-behaviour-save'));
    await flush();
    expect(screen.getByTestId('add-new-behaviour-secrets-not-loaded')).toBeTruthy();
    expect(screen.queryByTestId('add-new-behaviour-submit-error')).toBeNull();
  });
});
