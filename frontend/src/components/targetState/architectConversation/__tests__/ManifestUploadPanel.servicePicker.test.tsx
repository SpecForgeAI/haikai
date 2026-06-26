/**
 * Tests — ManifestUploadPanel Service picker + derived tag + submit gating.
 *
 * Spec 2026-06-26-target-manifest-service-association — Task Group 4 (task 4.1).
 * Focused (2-8 max) Vitest coverage of ONLY the new behaviour:
 *
 *   (1) one required Service <select> is rendered per selected manifest, from the
 *       `services` prop (one option per service, plus the empty "required" option);
 *   (2) choosing a service sets `targetServiceElementId` AND derives the `tag` —
 *       `repoSubfolder` when present, else the slugified service `name` (FR5);
 *   (3) submit is BLOCKED until every selected manifest has a non-empty
 *       `targetServiceElementId`;
 *   (4) `uploadTargetManifests` is given a selection carrying the chosen service
 *       id, and the pure `uploadTargetManifests` puts `serviceIdsByFilename` into
 *       the multipart body alongside `tagsByFilename`.
 *
 * The upload/capture API calls are injected (no network). Run in ISOLATION (the
 * whole-repo tsc/lint baseline is pre-existingly red).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

import {
  ManifestUploadPanel,
  type ManifestUploadPanelDeps,
} from '../ManifestUploadPanel';
import {
  deriveServiceModuleDir,
  uploadTargetManifests,
  type SelectedManifest,
  type TargetManifestUploadResponse,
} from '../../../../api/targetManifestApi';

afterEach(() => cleanup());

const PROJECT = 'proj-1';
const ARCH = 'arch-9';

// One service carries a repoSubfolder (used verbatim); one has no subfolder (its
// tag must be derived by slugifying the name).
const SERVICES = [
  { id: 'svc-orders', name: 'Orders Service', repoSubfolder: 'services/orders' },
  { id: 'svc-pay', name: 'Payments & Billing API', repoSubfolder: null },
];

function pomFile(name = 'pom.xml'): File {
  return new File(['<project/>'], name, { type: 'text/xml' });
}
function pkgFile(name = 'package.json'): File {
  return new File(['{}'], name, { type: 'application/json' });
}

function emptyResponse(): TargetManifestUploadResponse {
  return {
    parsedManifests: [],
    droppedManifests: [],
    summary: { parsedCount: 0, droppedCount: 0, totalDeclaredDependencies: 0 },
    autoAnswer: null,
  };
}

function makeDeps(): {
  deps: ManifestUploadPanelDeps;
  uploadSpy: ReturnType<typeof vi.fn>;
} {
  const uploadSpy = vi.fn().mockResolvedValue(emptyResponse());
  return {
    deps: {
      uploadTargetManifests:
        uploadSpy as unknown as ManifestUploadPanelDeps['uploadTargetManifests'],
      captureAnswer: vi
        .fn()
        .mockResolvedValue({ outcome: 'captured' }) as unknown as ManifestUploadPanelDeps['captureAnswer'],
    },
    uploadSpy,
  };
}

describe('ManifestUploadPanel — Service picker (Spec 2026-06-26, TG4)', () => {
  it('(1) renders one required Service <select> per selected manifest from the services prop', () => {
    const { deps } = makeDeps();
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        deps={deps}
      />,
    );

    // Two manifests selected -> two pickers.
    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile('a/pom.xml'), pkgFile('b/package.json')] },
    });

    const select0 = screen.getByTestId('manifest-service-select-0') as HTMLSelectElement;
    const select1 = screen.getByTestId('manifest-service-select-1') as HTMLSelectElement;
    expect(select0.tagName).toBe('SELECT');
    expect(select1.tagName).toBe('SELECT');

    // Each picker offers the empty "required" option + one option per service.
    const opts = within(select0).getAllByRole('option') as HTMLOptionElement[];
    expect(opts.map((o) => o.value)).toEqual(['', 'svc-orders', 'svc-pay']);
    expect(opts[1].textContent).toBe('Orders Service');
    // Nothing chosen yet -> the empty option is selected (invalid).
    expect(select0.value).toBe('');
    expect(select0.getAttribute('aria-invalid')).toBe('true');
  });

  it('(2) choosing a service sets targetServiceElementId and derives the tag (repoSubfolder, else slugified name)', async () => {
    const { deps, uploadSpy } = makeDeps();
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        deps={deps}
      />,
    );
    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile('a/pom.xml'), pkgFile('b/package.json')] },
    });

    // Manifest 0 -> a service WITH a repoSubfolder: tag == repoSubfolder verbatim.
    fireEvent.change(screen.getByTestId('manifest-service-select-0'), {
      target: { value: 'svc-orders' },
    });
    // Manifest 1 -> a service WITHOUT a repoSubfolder: tag == slugified name.
    fireEvent.change(screen.getByTestId('manifest-service-select-1'), {
      target: { value: 'svc-pay' },
    });

    fireEvent.click(screen.getByTestId('manifest-upload-submit'));
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));

    const selection = uploadSpy.mock.calls[0][2] as SelectedManifest[];
    expect(selection[0].targetServiceElementId).toBe('svc-orders');
    expect(selection[0].tag).toBe('services/orders'); // repoSubfolder verbatim
    expect(selection[1].targetServiceElementId).toBe('svc-pay');
    expect(selection[1].tag).toBe('payments-billing-api'); // slugified name
  });

  it('(3) blocks submit until every selected manifest has a chosen service', () => {
    const { deps } = makeDeps();
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        deps={deps}
      />,
    );
    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile('a/pom.xml'), pkgFile('b/package.json')] },
    });

    const submit = screen.getByTestId('manifest-upload-submit') as HTMLButtonElement;
    // Nothing chosen -> blocked + warning.
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('manifest-tag-warning')).toBeTruthy();

    // Only the first chosen -> still blocked.
    fireEvent.change(screen.getByTestId('manifest-service-select-0'), {
      target: { value: 'svc-orders' },
    });
    expect(submit.disabled).toBe(true);

    // Both chosen -> enabled + warning gone.
    fireEvent.change(screen.getByTestId('manifest-service-select-1'), {
      target: { value: 'svc-pay' },
    });
    expect(submit.disabled).toBe(false);
    expect(screen.queryByTestId('manifest-tag-warning')).toBeNull();
  });

  it('(4) the free-text tag input is fully replaced by the picker (no override)', () => {
    const { deps } = makeDeps();
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        deps={deps}
      />,
    );
    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile('a/pom.xml')] },
    });
    expect(screen.getByTestId('manifest-service-select-0')).toBeTruthy();
    // The legacy free-text tag input is gone.
    expect(screen.queryByTestId('manifest-tag-input-0')).toBeNull();
  });
});

describe('deriveServiceModuleDir (FR5)', () => {
  it('uses repoSubfolder verbatim when present', () => {
    expect(
      deriveServiceModuleDir({ id: 's', name: 'Orders Service', repoSubfolder: 'services/orders' }),
    ).toBe('services/orders');
  });

  it('slugifies the name when repoSubfolder is absent/blank', () => {
    expect(deriveServiceModuleDir({ id: 's', name: 'Payments & Billing API' })).toBe(
      'payments-billing-api',
    );
    expect(
      deriveServiceModuleDir({ id: 's', name: '  Order--Service!!  ', repoSubfolder: '   ' }),
    ).toBe('order-service');
  });
});

describe('uploadTargetManifests — serviceIdsByFilename in the multipart body', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(emptyResponse()),
    });
  });
  afterEach(() => vi.resetAllMocks());

  it('appends a serviceIdsByFilename JSON map alongside tagsByFilename', async () => {
    const selected: SelectedManifest[] = [
      {
        file: pomFile('pom.xml'),
        tag: 'services/orders',
        targetServiceElementId: 'svc-orders',
      },
    ];
    await uploadTargetManifests(PROJECT, ARCH, selected);

    const body = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body as FormData;
    expect(JSON.parse(body.get('serviceIdsByFilename') as string)).toEqual({
      'pom.xml': 'svc-orders',
    });
    expect(JSON.parse(body.get('tagsByFilename') as string)).toEqual({
      'pom.xml': 'services/orders',
    });
  });
});
