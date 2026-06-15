/**
 * InfrastructureTerraformImportModal Tests
 *
 * Spec 2026-05-08: Infrastructure Terraform Import (GCP)
 * Task Group 7 / Task 7.1
 *
 * Covers:
 *   - Step 1: file picker, Environment / Cloud Account / Location / Provider
 *     dropdowns, optional IaC source metadata fields render.
 *   - Step 1: Provider dropdown shows GCP enabled and AWS / AZURE / ON_PREM /
 *     MULTI / OTHER as disabled "(Coming soon)" options.
 *   - Step 1: "Parse and review" submit button gated on (file + Environment +
 *     Provider=GCP).
 *   - Step 1: clicking "Parse and review" assembles the FormData and invokes
 *     `importInfrastructureTerraform` with the expected URL + body.
 *   - Step 2: post-parse, modal swaps to review with warnings panel + three
 *     category tables.
 *   - Step 2: evidence row-expander toggles raw HCL visibility.
 *   - Step 2: "Approve all" invokes the supplied approve handler.
 *   - Step 2: "Discard all" closes the modal with no server call.
 *   - Loading + error states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock modelApi BEFORE importing the modal so the modal's import resolves to the mock.
vi.mock('../../../api/modelApi', async () => {
  const actual = await vi.importActual<typeof import('../../../api/modelApi')>('../../../api/modelApi');
  return {
    ...actual,
    importInfrastructureTerraform: vi.fn(),
  };
});

import { InfrastructureTerraformImportModal } from '../InfrastructureTerraformImportModal';
import * as modelApi from '../../../api/modelApi';
import type { MetaModel } from '../../../types/model';
import type { ImportReviewResult } from '../../../api/modelApi';

/** Build a minimal but type-correct MetaModel for the modal tests. */
function buildMetaModel(overrides?: {
  environments?: Array<{ id: string; name: string }>;
  cloud_accounts?: Array<{ id: string; name: string }>;
  locations?: Array<{ id: string; name: string }>;
}): MetaModel {
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

  const relationships = {} as unknown as MetaModel['relationships'];

  return { entities, relationships };
}

/** Build an ImportReviewResult with a candidate in each of the 3 buckets. */
function buildReviewResult(): ImportReviewResult {
  return {
    iac_source: {
      provider: 'GCP',
      repository_url: 'https://github.com/example/repo',
      branch: 'main',
      commit_sha: 'abc123',
      path: 'infra/',
      workspace: 'production',
    },
    will_create: [
      {
        candidate_id: 'cand-create-1',
        target_entity_type: 'Network',
        proposed_entity_fields: { name: 'main-vpc' },
        proposed_binding: { iac_address: 'google_compute_network.main', iac_resource_name: 'main' },
        confidence: 0.9,
        per_candidate_warnings: [],
        evidence: {
          file_path: 'main.tf',
          start_line: 1,
          end_line: 5,
          raw_snippet: 'resource "google_compute_network" "main" {\n  name = "main-vpc"\n}',
        },
        ignored: false,
      },
    ],
    will_update: [
      {
        candidate_id: 'cand-update-1',
        target_entity_type: 'Subnet',
        proposed_entity_fields: { name: 'web-subnet' },
        proposed_binding: { iac_address: 'google_compute_subnetwork.web', iac_resource_name: 'web' },
        confidence: 0.6,
        per_candidate_warnings: ['region inferred from var.region'],
        evidence: {
          file_path: 'modules/network/main.tf',
          start_line: 10,
          end_line: 18,
          raw_snippet: 'resource "google_compute_subnetwork" "web" {\n  name = "web-subnet"\n}',
        },
        ignored: false,
      },
    ],
    unsupported: [
      {
        candidate_id: 'cand-unsupported-1',
        target_entity_type: 'Unsupported',
        proposed_entity_fields: { name: 'mystery-resource' },
        proposed_binding: { iac_address: 'google_unknown_thing.x', iac_resource_name: 'x' },
        confidence: 0.3,
        per_candidate_warnings: ['unsupported google_* resource type'],
        evidence: {
          file_path: 'main.tf',
          start_line: 50,
          end_line: 55,
          raw_snippet: 'resource "google_unknown_thing" "x" {}',
        },
        ignored: false,
      },
    ],
    warnings: ['module not parsed: registry.terraform.io/x/y/z', 'unparseable block at main.tf:99'],
    summary: {
      will_create_count: 1,
      will_update_count: 1,
      unsupported_count: 1,
      warnings_count: 2,
    },
  };
}

describe('InfrastructureTerraformImportModal', () => {
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
  // 7.1.a Step 1 renders the file picker, all dropdowns, and the optional
  //       IaC source metadata fields (revealed via the Advanced toggle).
  // -------------------------------------------------------------------------
  it('step 1 renders file picker, dropdowns, and optional IaC source metadata fields', () => {
    render(<InfrastructureTerraformImportModal {...defaultProps} />);

    // File picker accepting .tf and .zip
    const fileInput = screen.getByTestId('files-input') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.type).toBe('file');
    expect(fileInput.multiple).toBe(true);
    expect(fileInput.accept).toBe('.tf,.zip');

    // 4 dropdowns
    expect(screen.getByTestId('environment-select')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-account-select')).toBeInTheDocument();
    expect(screen.getByTestId('location-select')).toBeInTheDocument();
    expect(screen.getByTestId('provider-select')).toBeInTheDocument();

    // Submit + Cancel
    expect(screen.getByTestId('parse-review-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument();

    // Reveal Advanced -- 5 optional inputs become visible
    fireEvent.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-section')).toBeInTheDocument();
    expect(screen.getByTestId('repository-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('branch-input')).toBeInTheDocument();
    expect(screen.getByTestId('commit-sha-input')).toBeInTheDocument();
    expect(screen.getByTestId('path-input')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-input')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7.1.b "Parse and review" disabled until file + Environment + Provider=GCP
  //       all set. Provider defaults to GCP, so the only missing pieces are
  //       a file selection and the Environment.
  // -------------------------------------------------------------------------
  it('disables "Parse and review" until at least one file is selected AND Environment is set (Provider defaults to GCP)', () => {
    render(<InfrastructureTerraformImportModal {...defaultProps} />);

    const submitBtn = screen.getByTestId('parse-review-button') as HTMLButtonElement;
    const fileInput = screen.getByTestId('files-input') as HTMLInputElement;
    const envSelect = screen.getByTestId('environment-select') as HTMLSelectElement;
    const providerSelect = screen.getByTestId('provider-select') as HTMLSelectElement;

    expect(providerSelect.value).toBe('GCP');

    // No file, no env -> disabled
    expect(submitBtn).toBeDisabled();

    // Environment set but no file -> still disabled
    fireEvent.change(envSelect, { target: { value: 'env-1' } });
    expect(submitBtn).toBeDisabled();

    // File set + Environment set + Provider=GCP -> enabled
    const file = new File(['resource "google_compute_network" "main" {}'], 'main.tf', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(submitBtn).not.toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 7.1.c V1 only GCP enabled in the Provider dropdown; the other 5 entries
  //       render disabled with the "(Coming soon)" suffix.
  // -------------------------------------------------------------------------
  it('renders the Provider dropdown with only GCP enabled and other entries marked "(Coming soon)"', () => {
    render(<InfrastructureTerraformImportModal {...defaultProps} />);

    const providerSelect = screen.getByTestId('provider-select') as HTMLSelectElement;
    const options = Array.from(providerSelect.options);

    // 6 entries from iacSourceProviderOptions
    expect(options.map((o) => o.value)).toEqual(['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']);

    const gcp = options.find((o) => o.value === 'GCP')!;
    expect(gcp.disabled).toBe(false);
    expect(gcp.textContent).toBe('GCP');

    for (const value of ['AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER']) {
      const opt = options.find((o) => o.value === value)!;
      expect(opt.disabled).toBe(true);
      expect(opt.textContent).toContain('Coming soon');
    }
  });

  // -------------------------------------------------------------------------
  // 7.1.d Clicking "Parse and review" assembles the FormData with one entry
  //       per file part + each form field, and calls
  //       `importInfrastructureTerraform(projectId, archId, formData)`.
  // -------------------------------------------------------------------------
  it('on submit, assembles FormData and invokes importInfrastructureTerraform with the correct args', async () => {
    (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildReviewResult());

    render(<InfrastructureTerraformImportModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
    fireEvent.change(screen.getByTestId('cloud-account-select'), { target: { value: 'acc-1' } });
    fireEvent.change(screen.getByTestId('location-select'), { target: { value: 'loc-1' } });

    // Reveal Advanced and fill in two metadata fields
    fireEvent.click(screen.getByTestId('advanced-toggle'));
    fireEvent.change(screen.getByTestId('repository-url-input'), {
      target: { value: 'https://github.com/example/repo' },
    });
    fireEvent.change(screen.getByTestId('branch-input'), { target: { value: 'main' } });

    // Files
    const f1 = new File(['x'], 'a.tf', { type: 'text/plain' });
    const f2 = new File(['y'], 'b.tf', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [f1, f2] } });

    fireEvent.click(screen.getByTestId('parse-review-button'));

    await waitFor(() => {
      expect(modelApi.importInfrastructureTerraform).toHaveBeenCalledTimes(1);
    });

    const [pid, aid, formData] = (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(pid).toBe('proj-1');
    expect(aid).toBe('arch-1');

    // Verify FormData entries
    expect(formData).toBeInstanceOf(FormData);
    const fd = formData as FormData;
    const fileEntries = fd.getAll('files') as File[];
    expect(fileEntries).toHaveLength(2);
    expect(fileEntries[0].name).toBe('a.tf');
    expect(fileEntries[1].name).toBe('b.tf');

    expect(fd.get('environmentId')).toBe('env-1');
    expect(fd.get('cloudAccountId')).toBe('acc-1');
    expect(fd.get('locationId')).toBe('loc-1');
    expect(fd.get('provider')).toBe('GCP');
    expect(fd.get('repositoryUrl')).toBe('https://github.com/example/repo');
    expect(fd.get('branch')).toBe('main');
    // Untouched optional fields should be absent from the FormData.
    expect(fd.get('commitSha')).toBeNull();
    expect(fd.get('path')).toBeNull();
    expect(fd.get('workspace')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7.1.e Post-parse step 2: warnings panel + three category sections render
  //       with the expected counts. Evidence-row expander toggles snippet
  //       visibility.
  // -------------------------------------------------------------------------
  it('post-parse, step 2 renders warnings panel + three category tables and the evidence expander toggles', async () => {
    (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildReviewResult());

    render(<InfrastructureTerraformImportModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
    const file = new File(['x'], 'main.tf', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('parse-review-button'));

    // Wait for review step
    await waitFor(() => {
      expect(screen.getByTestId('review-step')).toBeInTheDocument();
    });

    // Warnings panel
    expect(screen.getByTestId('warnings-panel')).toBeInTheDocument();
    expect(screen.getByTestId('warnings-count').textContent).toBe('2');
    expect(screen.getByTestId('warnings-list')).toBeInTheDocument();

    // Three category sections + counts
    expect(screen.getByTestId('section-will-create')).toBeInTheDocument();
    expect(screen.getByTestId('section-will-create-count').textContent).toBe('1');
    expect(screen.getByTestId('section-will-update')).toBeInTheDocument();
    expect(screen.getByTestId('section-will-update-count').textContent).toBe('1');
    expect(screen.getByTestId('section-unsupported')).toBeInTheDocument();
    expect(screen.getByTestId('section-unsupported-count').textContent).toBe('1');

    // Evidence row not yet visible
    expect(screen.queryByTestId('evidence-row-section-will-create-0')).not.toBeInTheDocument();

    // Toggle evidence
    fireEvent.click(screen.getByTestId('evidence-toggle-section-will-create-0'));
    expect(screen.getByTestId('evidence-row-section-will-create-0')).toBeInTheDocument();

    // Toggle off again
    fireEvent.click(screen.getByTestId('evidence-toggle-section-will-create-0'));
    expect(screen.queryByTestId('evidence-row-section-will-create-0')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7.1.f "Approve all" invokes the supplied approve handler with the result
  //       and closes the modal. (V1 wiring is deferred to a follow-up spec --
  //       the component supports an optional `onApproveAll` prop so consumers
  //       can wire it through the existing model-save flow.)
  // -------------------------------------------------------------------------
  it('"Approve all" invokes the onApproveAll handler with the review result', async () => {
    const fakeResult = buildReviewResult();
    (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fakeResult);

    const onApproveAll = vi.fn();
    const onClose = vi.fn();

    render(
      <InfrastructureTerraformImportModal
        {...defaultProps}
        onClose={onClose}
        onApproveAll={onApproveAll}
      />
    );

    fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
    const file = new File(['x'], 'main.tf', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('parse-review-button'));

    await waitFor(() => {
      expect(screen.getByTestId('approve-all-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('approve-all-button'));

    expect(onApproveAll).toHaveBeenCalledTimes(1);
    expect(onApproveAll).toHaveBeenCalledWith(fakeResult);
    expect(onClose).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7.1.g "Discard all" closes the modal with no server call.
  // -------------------------------------------------------------------------
  it('"Discard all" closes the modal and does not call any API', async () => {
    (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildReviewResult());

    const onClose = vi.fn();

    render(
      <InfrastructureTerraformImportModal
        {...defaultProps}
        onClose={onClose}
      />
    );

    // Get to step 2
    fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
    const file = new File(['x'], 'main.tf', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('parse-review-button'));

    await waitFor(() => {
      expect(screen.getByTestId('discard-all-button')).toBeInTheDocument();
    });

    // The mock was called for the parse step. Reset the call count so we can
    // assert no NEW call happens on Discard.
    (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByTestId('discard-all-button'));

    expect(onClose).toHaveBeenCalled();
    expect(modelApi.importInfrastructureTerraform).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7.1.h Error from the API renders an inline error banner and keeps the
  //       modal on step 1.
  // -------------------------------------------------------------------------
  it('renders an inline error message when the API helper rejects and stays on step 1', async () => {
    (modelApi.importInfrastructureTerraform as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Failed to import: 400: environmentId is required'));

    render(<InfrastructureTerraformImportModal {...defaultProps} />);

    fireEvent.change(screen.getByTestId('environment-select'), { target: { value: 'env-1' } });
    const file = new File(['x'], 'main.tf', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('parse-review-button'));

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });
    expect(screen.getByTestId('error-message').textContent).toContain('400');

    // Still on step 1 -- review step did not render
    expect(screen.queryByTestId('review-step')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7.1.i Empty-state when no environments exist.
  // -------------------------------------------------------------------------
  it('shows the empty-state message and keeps "Parse and review" disabled when no environments exist', () => {
    const props = {
      ...defaultProps,
      metaModel: buildMetaModel({ environments: [] }),
    };

    render(<InfrastructureTerraformImportModal {...props} />);

    expect(screen.getByTestId('empty-environments-message')).toBeInTheDocument();
    expect(screen.getByTestId('parse-review-button')).toBeDisabled();
  });
});
