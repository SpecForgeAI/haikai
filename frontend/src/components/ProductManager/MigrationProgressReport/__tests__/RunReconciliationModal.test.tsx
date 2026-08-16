/**
 * RunReconciliationModal tests (2026-08-16).
 *
 * Coverage: rec selection per scope, body assembly (filled blocks sent,
 * blank blocks OMITTED so the gateway falls back to registered creds),
 * client-side whole-or-error DB block validation, started/blocked result
 * rendering, and the onClose(ranAny) contract driving the page refetch.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../MigrationProgressReport.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { RunReconciliationModal } from '../RunReconciliationModal';
import type { StartReconciliationResultDto } from '../../../../api/migrationProgressReportApi';

const SCOPE_BOTH = { db: true, service: true };

function setInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function renderModal(
  result: StartReconciliationResultDto,
  scope = SCOPE_BOTH,
  onClose = vi.fn(),
) {
  const startFn = vi.fn().mockResolvedValue(result);
  render(
    <RunReconciliationModal
      projectId="proj-1"
      architectureId="arch-1"
      bookId="book-1"
      scope={scope}
      onClose={onClose}
      startFn={startFn}
    />,
  );
  return { startFn, onClose };
}

describe('RunReconciliationModal', () => {
  it('assembles the body from filled blocks and renders started results', async () => {
    const { startFn, onClose } = renderModal({
      dataParity: { status: 'started', detail: 'Comparing 65 migrated table(s).' },
      apiReconcile: { status: 'started', detail: 'Replaying the full pinned baseline.' },
    });

    // Both recs pre-checked for a both-plane scope; both field groups visible.
    expect(screen.getByTestId('rrm-db-fields')).toBeTruthy();
    expect(screen.getByTestId('rrm-api-fields')).toBeTruthy();

    setInput('rrm-source-db-host', 'src-host');
    setInput('rrm-source-db-port', '5000');
    setInput('rrm-source-db-database', 'legacy');
    setInput('rrm-source-db-username', 'sa');
    setInput('rrm-source-db-password', 'pw');
    setInput('rrm-target-db-host', 'tgt-host');
    setInput('rrm-target-db-port', '5432');
    setInput('rrm-target-db-database', 'migrated');
    setInput('rrm-target-db-username', 'pg');
    setInput('rrm-target-db-password', 'pw2');
    setInput('rrm-target-base-url', 'http://target:9090');
    setInput('rrm-target-auth-type', 'bearer');
    setInput('rrm-target-bearer-token', 'tok');

    fireEvent.click(screen.getByTestId('rrm-run'));
    await waitFor(() => expect(screen.getByTestId('rrm-results')).toBeTruthy());

    expect(startFn).toHaveBeenCalledWith('proj-1', 'arch-1', 'book-1', {
      run_data_parity: true,
      run_api_reconcile: true,
      source_db: {
        dbType: 'sybase',
        host: 'src-host',
        port: 5000,
        database: 'legacy',
        schema: null,
        username: 'sa',
        password: 'pw',
      },
      target_db: {
        dbType: 'postgres',
        host: 'tgt-host',
        port: 5432,
        database: 'migrated',
        schema: null,
        username: 'pg',
        password: 'pw2',
      },
      api: { type: 'bearer', bearerToken: 'tok' },
      target_base_url: 'http://target:9090',
    });

    expect(screen.getByTestId('rrm-result-db').textContent).toContain('started');
    expect(screen.getByTestId('rrm-result-api').textContent).toContain('started');
    fireEvent.click(screen.getByTestId('rrm-close'));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('omits blank credential blocks so the gateway falls back to registered creds', async () => {
    const { startFn } = renderModal({
      dataParity: { status: 'started', detail: 'ok' },
      apiReconcile: null,
    });
    fireEvent.click(screen.getByTestId('rrm-check-api')); // API off -> DB only
    fireEvent.click(screen.getByTestId('rrm-run'));
    await waitFor(() => expect(startFn).toHaveBeenCalled());
    expect(startFn).toHaveBeenCalledWith('proj-1', 'arch-1', 'book-1', {
      run_data_parity: true,
      run_api_reconcile: false,
    });
  });

  it('rejects a partial DB block client-side before calling the gateway', async () => {
    const { startFn } = renderModal({
      dataParity: { status: 'started', detail: 'ok' },
      apiReconcile: null,
    });
    setInput('rrm-source-db-host', 'only-a-host');
    fireEvent.click(screen.getByTestId('rrm-run'));
    await waitFor(() => expect(screen.getByTestId('rrm-error')).toBeTruthy());
    expect(screen.getByTestId('rrm-error').textContent).toContain('Current state database');
    expect(startFn).not.toHaveBeenCalled();
  });

  it('renders a blocked outcome with its reason and closes without a refetch', async () => {
    const { onClose } = renderModal({
      dataParity: null,
      apiReconcile: {
        status: 'blocked',
        reason: '3 unresolved break(s) from the previous reconcile.',
      },
    });
    fireEvent.click(screen.getByTestId('rrm-check-db')); // DB off -> API only
    fireEvent.click(screen.getByTestId('rrm-run'));
    await waitFor(() => expect(screen.getByTestId('rrm-result-api')).toBeTruthy());
    expect(screen.getByTestId('rrm-result-api').textContent).toContain('blocked');
    expect(screen.getByTestId('rrm-result-api').textContent).toContain('unresolved break');
    fireEvent.click(screen.getByTestId('rrm-close'));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('offers the SHARED auth surface on BOTH service sides, incl. ssoToken as a fixed header', async () => {
    const { startFn } = renderModal({
      dataParity: null,
      apiReconcile: { status: 'started', detail: 'ok' },
    });
    fireEvent.click(screen.getByTestId('rrm-check-db')); // DB off -> API only

    // SYMMETRY: the current-state side carries the auth selector without
    // needing a base URL typed first (the earlier asymmetry made the modal
    // unusable), and both selects offer the canonical option set.
    expect(screen.getByTestId('rrm-current-auth-type')).toBeTruthy();
    const targetSelect = screen.getByTestId('rrm-target-auth-type');
    const options = Array.from(targetSelect.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(['none', 'bearer', 'basic', 'sso_token', 'header']);

    // ssoToken -> the fixed `ssoToken` custom header, value TRIMMED.
    setInput('rrm-target-auth-type', 'sso_token');
    setInput('rrm-target-sso-token', '  tok-123  ');
    fireEvent.click(screen.getByTestId('rrm-run'));
    await waitFor(() => expect(startFn).toHaveBeenCalled());
    expect(startFn).toHaveBeenCalledWith('proj-1', 'arch-1', 'book-1', {
      run_data_parity: false,
      run_api_reconcile: true,
      api: { type: 'custom_header', headerName: 'ssoToken', headerValue: 'tok-123' },
    });
  });

  it('requires a current base URL when current-side auth is set (nothing silently dropped)', async () => {
    const { startFn } = renderModal({ dataParity: null, apiReconcile: null });
    fireEvent.click(screen.getByTestId('rrm-check-db')); // DB off -> API only
    setInput('rrm-current-auth-type', 'sso_token');
    setInput('rrm-current-sso-token', 'tok');
    fireEvent.click(screen.getByTestId('rrm-run'));
    await waitFor(() => expect(screen.getByTestId('rrm-error')).toBeTruthy());
    expect(screen.getByTestId('rrm-error').textContent).toContain('Base URL is required');
    expect(startFn).not.toHaveBeenCalled();
  });

  it('disables an out-of-scope reconciliation', () => {
    renderModal(
      { dataParity: null, apiReconcile: null },
      { db: true, service: false },
    );
    expect((screen.getByTestId('rrm-check-api') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('rrm-check-db') as HTMLInputElement).disabled).toBe(false);
  });
});
