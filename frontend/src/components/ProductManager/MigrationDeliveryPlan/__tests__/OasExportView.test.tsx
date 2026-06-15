/**
 * OasExportView tests (direct build 2026-06-11, oracle weaknesses #5).
 *
 * Covers: interface listing for the selected architecture, the architecture
 * switch re-fetch, per-interface generation (coverage chips + gap details +
 * client-side download button), generation-failure rendering (a readable
 * message, never "[object Object]"), the download-all zip link, and the
 * empty state.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OasExportView } from '../OasExportView';
import type { OasExportResult } from '../../../../api/oasExportApi';

const mockList = vi.fn();
const mockGenerate = vi.fn();

vi.mock('../../../../api/oasExportApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/oasExportApi')
  >('../../../../api/oasExportApi');
  return {
    ...actual,
    listOasExportInterfaces: (...args: unknown[]) => mockList(...args),
    generateOasForInterface: (...args: unknown[]) => mockGenerate(...args),
  };
});

const ARCHITECTURES = [
  { id: 'arch-current', name: 'Current state' },
  { id: 'arch-target', name: 'Target state' },
];

function makeResult(): OasExportResult {
  return {
    interfaceId: 'if-1',
    interfaceName: 'Customer API',
    suggestedFilename: 'customer-api.openapi.json',
    document: { openapi: '3.0.3' },
    gapReport: {
      interfaceId: 'if-1',
      generatedAt: '2026-06-11T00:00:00.000Z',
      gaps: [
        { code: 'SERVER_URL_MISSING', severity: 'BLOCKING', message: 'No server URL.' },
        {
          code: 'PATH_PARAMS_NEED_SCHEMA',
          severity: 'RECOMMENDED',
          message: 'Path parameter types unspecified.',
          location: { method: 'GET', path: '/customers/{id}' },
        },
      ],
      defaults: [],
      typeMappings: [],
      operationIds: [],
    },
    summary: {
      endpointCount: 6,
      mappedEndpointCount: 4,
      unmappedEndpoints: [
        { endpointId: 'e5', name: 'Legacy SOAP op', reason: 'SOAP endpoint.' },
      ],
      schemaCount: 1,
      gapCounts: { blocking: 1, recommended: 1, info: 0 },
    },
  };
}

function renderView() {
  return render(
    <OasExportView
      projectId="p1"
      architectureId="arch-current"
      architectures={ARCHITECTURES}
    />,
  );
}

beforeEach(() => {
  mockList.mockReset();
  mockGenerate.mockReset();
});

describe('OasExportView', () => {
  test('lists interfaces for the initially-selected architecture', async () => {
    mockList.mockResolvedValue([
      { id: 'if-1', name: 'Customer API' },
      { id: 'if-2', name: 'Order API' },
    ]);
    renderView();

    expect(await screen.findByTestId('oas-export-row-if-1')).toBeInTheDocument();
    expect(screen.getByTestId('oas-export-row-if-2')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith('p1', 'arch-current');
  });

  test('shows the empty state when the architecture has no interfaces', async () => {
    mockList.mockResolvedValue([]);
    renderView();
    expect(await screen.findByTestId('oas-export-empty')).toBeInTheDocument();
  });

  test('switching architecture re-fetches the interface list', async () => {
    mockList.mockResolvedValue([{ id: 'if-1', name: 'Customer API' }]);
    renderView();
    await screen.findByTestId('oas-export-row-if-1');

    mockList.mockResolvedValue([{ id: 'if-9', name: 'Target API' }]);
    await userEvent.selectOptions(
      screen.getByTestId('oas-export-arch-select'),
      'arch-target',
    );

    expect(await screen.findByTestId('oas-export-row-if-9')).toBeInTheDocument();
    expect(mockList).toHaveBeenLastCalledWith('p1', 'arch-target');
  });

  test('generate renders coverage chips, gap details, and the download button', async () => {
    mockList.mockResolvedValue([{ id: 'if-1', name: 'Customer API' }]);
    mockGenerate.mockResolvedValue(makeResult());
    renderView();

    await userEvent.click(await screen.findByTestId('oas-export-generate-if-1'));

    const chips = await screen.findByTestId('oas-export-result-if-1');
    expect(chips.textContent).toContain('4/6 endpoints');
    expect(chips.textContent).toContain('1 blocking gaps');
    expect(mockGenerate).toHaveBeenCalledWith('p1', 'arch-current', 'if-1');

    const detail = screen.getByTestId('oas-export-detail-if-1');
    expect(detail.textContent).toContain('Legacy SOAP op');
    expect(detail.textContent).toContain('No server URL.');

    expect(screen.getByTestId('oas-export-download-if-1')).toBeInTheDocument();
    // Button flips to Regenerate once a contract exists.
    expect(screen.getByTestId('oas-export-generate-if-1').textContent).toBe(
      'Regenerate',
    );
  });

  test('generation failure renders the server message, never "[object Object]"', async () => {
    mockList.mockResolvedValue([{ id: 'if-1', name: 'Customer API' }]);
    mockGenerate.mockRejectedValue(new Error('compute_oas_gaps failed: boom'));
    renderView();

    await userEvent.click(await screen.findByTestId('oas-export-generate-if-1'));

    const rowError = await screen.findByTestId('oas-export-row-error-if-1');
    expect(rowError.textContent).toContain('compute_oas_gaps failed: boom');
    expect(rowError.textContent).not.toContain('[object Object]');
  });

  test('download-all link targets the zip route for the selected architecture', async () => {
    mockList.mockResolvedValue([]);
    renderView();
    await screen.findByTestId('oas-export-empty');

    const link = screen.getByTestId('oas-export-download-all');
    expect(link.getAttribute('href')).toBe(
      '/api/v1/projects/p1/architectures/arch-current/oas-export/download',
    );
  });

  test('list failure surfaces a readable error banner', async () => {
    mockList.mockRejectedValue(new Error('Upstream service unavailable'));
    renderView();
    const banner = await screen.findByTestId('oas-export-error');
    expect(banner.textContent).toContain('Upstream service unavailable');
  });
});
