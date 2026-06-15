/**
 * InfrastructureTerraformExportModal Tests
 *
 * Spec 2026-05-08: Infrastructure Terraform Export (GCP)
 * Task Group 7 / Task 7.1
 *
 * Covers:
 *   - Renders Environment / Cloud Account / Location / Provider fields when open.
 *   - Submit button disabled until both Environment and Provider are set.
 *   - Provider dropdown shows only GCP enabled; AWS / AZURE / ON_PREM / MULTI / OTHER
 *     render as disabled options labelled "(Coming soon)".
 *   - Empty-state guard: no environments defined renders the inline message and
 *     keeps the submit button disabled.
 *   - Post-submit: the modal calls `exportInfrastructureTerraform` with the
 *     selected values, parses Content-Disposition for the download filename via
 *     `parseContentDispositionFilename`, and triggers a browser download via
 *     `URL.createObjectURL`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock modelApi BEFORE importing the modal so the modal's import resolves to the mock.
vi.mock('../../api/modelApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/modelApi')>('../../api/modelApi');
  return {
    ...actual,
    exportInfrastructureTerraform: vi.fn(),
    // Keep parseContentDispositionFilename real so the download filename branch is exercised.
  };
});

import { InfrastructureTerraformExportModal } from './InfrastructureTerraformExportModal';
import * as modelApi from '../../api/modelApi';
import type { MetaModel } from '../../types/model';

/** Build a minimal but type-correct MetaModel for the modal tests. */
function buildMetaModel(overrides?: {
  environments?: Array<{ id: string; name: string }>;
  cloud_accounts?: Array<{ id: string; name: string }>;
  locations?: Array<{ id: string; name: string }>;
}): MetaModel {
  // We deliberately cast through `unknown` -- the modal only reads a handful of
  // fields off of these entities (`id`, `name`), so the rest of the type surface
  // is irrelevant to the test and is filled in by the entity defaults at runtime.
  const envs = (overrides?.environments ?? [
    { id: 'env-1', name: 'prod' },
    { id: 'env-2', name: 'dev' },
  ]) as MetaModel['entities']['environments'];

  const accounts = (overrides?.cloud_accounts ?? [
    { id: 'acc-1', name: 'gcp-main' },
  ]) as MetaModel['entities']['cloud_accounts'];

  const locs = (overrides?.locations ?? [
    { id: 'loc-1', name: 'europe-west1' },
  ]) as MetaModel['entities']['locations'];

  // Minimal entities scaffold -- only the 3 lists the modal reads are populated.
  // Other arrays are empty; their concrete shape does not affect this test.
  const entities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [],
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
    business_logics: [],
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
    ui_characteristics: [],
    package_sets: [],
    packages: [],
    user_journeys: [],
    activity_steps: [],
    environments: envs,
    cloud_accounts: accounts,
    locations: locs,
    networks: [],
    subnets: [],
    compute_clusters: [],
    compute_resources: [],
    deployment_units: [],
    load_balancers: [],
    listeners: [],
    data_store_instances: [],
    infrastructure_resources: [],
    infrastructure_points: [],
    iac_sources: [],
    libraries: [],
  } as unknown as MetaModel['entities'];

  // Minimal relationships -- modal does not read these.
  const relationships = {} as unknown as MetaModel['relationships'];

  return { entities, relationships };
}

describe('InfrastructureTerraformExportModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    projectId: 'proj-1',
    architectureId: 'arch-1',
    metaModel: buildMetaModel(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 7.1.a Modal renders Env (required) / Cloud Account (optional) / Location
  //       (optional) / Provider (required) fields when open.
  // -------------------------------------------------------------------------
  it('renders Environment, Cloud Account, Location, and Provider fields when open', () => {
    render(<InfrastructureTerraformExportModal {...defaultProps} />);

    expect(screen.getByTestId('environment-select')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-account-select')).toBeInTheDocument();
    expect(screen.getByTestId('location-select')).toBeInTheDocument();
    expect(screen.getByTestId('provider-select')).toBeInTheDocument();
    expect(screen.getByTestId('modal-export-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
  });

  it('does not render anything when isOpen is false', () => {
    render(<InfrastructureTerraformExportModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('environment-select')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7.1.b Submit button is disabled until both Environment AND Provider are set.
  //
  // Provider defaults to GCP at mount, so the only missing value initially is
  // the Environment selection.
  // -------------------------------------------------------------------------
  it('disables the Export button until Environment is selected (Provider defaults to GCP)', () => {
    render(<InfrastructureTerraformExportModal {...defaultProps} />);

    const exportButton = screen.getByTestId('modal-export-button') as HTMLButtonElement;
    const envSelect = screen.getByTestId('environment-select') as HTMLSelectElement;
    const providerSelect = screen.getByTestId('provider-select') as HTMLSelectElement;

    // Provider defaults to GCP per modal contract
    expect(providerSelect.value).toBe('GCP');

    // No environment selected -> disabled
    expect(exportButton).toBeDisabled();

    // Select environment -> enabled
    fireEvent.change(envSelect, { target: { value: 'env-1' } });
    expect(exportButton).not.toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 7.1.c Provider dropdown shows only GCP enabled; other 5 options render as
  //       disabled with "(Coming soon)" suffix.
  // -------------------------------------------------------------------------
  it('renders the Provider dropdown with only GCP enabled and other options marked "(Coming soon)"', () => {
    render(<InfrastructureTerraformExportModal {...defaultProps} />);

    const providerSelect = screen.getByTestId('provider-select') as HTMLSelectElement;
    const options = Array.from(providerSelect.options);

    // The 6 entries from iacSourceProviderOptions = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']
    expect(options.map((o) => o.value)).toEqual(['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']);

    const gcpOption = options.find((o) => o.value === 'GCP')!;
    expect(gcpOption.disabled).toBe(false);
    expect(gcpOption.textContent).toBe('GCP');

    const disabledValues = ['AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER'];
    for (const value of disabledValues) {
      const option = options.find((o) => o.value === value)!;
      expect(option.disabled).toBe(true);
      expect(option.textContent).toContain('Coming soon');
    }
  });

  // -------------------------------------------------------------------------
  // 7.1.d Empty-state when no environments exist.
  // -------------------------------------------------------------------------
  it('shows the empty-state message and keeps Export disabled when no environments exist', () => {
    const props = {
      ...defaultProps,
      metaModel: buildMetaModel({ environments: [] }),
    };

    render(<InfrastructureTerraformExportModal {...props} />);

    expect(screen.getByTestId('empty-environments-message')).toBeInTheDocument();
    expect(screen.getByTestId('modal-export-button')).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 7.1.e Post-submit download flow.
  //
  // Mocks `exportInfrastructureTerraform` to return a fake ZIP Response with a
  // Content-Disposition header. Asserts the download flow uses URL.createObjectURL
  // and reads the filename from the header.
  // -------------------------------------------------------------------------
  it('on submit, calls the API helper with the selected values and triggers a browser download', async () => {
    const fakeBlob = new Blob(['fake-zip']);
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="default_prod_20260508-120000_terraform.zip"',
      }),
      blob: async () => fakeBlob,
    } as unknown as Response;

    (modelApi.exportInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fakeResponse);

    // Stub URL.createObjectURL / revokeObjectURL on jsdom
    const createObjectUrlMock = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectUrlMock = vi.fn();
    const originalCreate = window.URL.createObjectURL;
    const originalRevoke = window.URL.revokeObjectURL;
    window.URL.createObjectURL = createObjectUrlMock as unknown as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = revokeObjectUrlMock as unknown as typeof window.URL.revokeObjectURL;

    try {
      render(<InfrastructureTerraformExportModal {...defaultProps} />);

      // Select environment + cloud account + location
      fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
      fireEvent.change(screen.getByTestId('cloud-account-select'), { target: { value: 'acc-1' } });
      fireEvent.change(screen.getByTestId('location-select'), { target: { value: 'loc-1' } });

      // Click export
      fireEvent.click(screen.getByTestId('modal-export-button'));

      // Wait for the API helper to be called and the download to be triggered
      await waitFor(() => {
        expect(modelApi.exportInfrastructureTerraform).toHaveBeenCalledTimes(1);
      });

      const [pid, aid, options] = (modelApi.exportInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(pid).toBe('proj-1');
      expect(aid).toBe('arch-1');
      expect(options).toEqual({
        environmentId: 'env-1',
        cloudAccountId: 'acc-1',
        locationId: 'loc-1',
        provider: 'GCP',
      });

      // Download triggered
      await waitFor(() => {
        expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
      });
      expect(createObjectUrlMock).toHaveBeenCalledWith(fakeBlob);
      expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:mock-url');

      // Success message rendered after download
      await waitFor(() => {
        expect(screen.getByTestId('success-message')).toBeInTheDocument();
      });
    } finally {
      window.URL.createObjectURL = originalCreate;
      window.URL.revokeObjectURL = originalRevoke;
    }
  });

  // -------------------------------------------------------------------------
  // 7.1.f When the API helper rejects, an inline error message is displayed.
  // -------------------------------------------------------------------------
  it('displays an inline error message when the API helper rejects', async () => {
    (modelApi.exportInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Failed to export Infrastructure as Terraform: 400'));

    render(<InfrastructureTerraformExportModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
    fireEvent.click(screen.getByTestId('modal-export-button'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
    expect(screen.getByTestId('error-message').textContent).toContain('400');
  });

  // -------------------------------------------------------------------------
  // 7.1.g Cancel button calls onClose.
  // -------------------------------------------------------------------------
  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<InfrastructureTerraformExportModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cancel-button'));
    expect(onClose).toHaveBeenCalled();
  });
});
