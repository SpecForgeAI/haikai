/**
 * Tests — ManifestUploadPanel (target dependency-manifest upload UI)
 * Spec 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), Task Group 5
 * (task 5.1). Focused tests (2-8 max) covering ONLY:
 *
 *   (a) selecting a pom.xml / package.json (+ optional package-lock.json) REQUIRES
 *       a target module/service tag before submit (submit disabled until tagged);
 *   (b) the uploaded-manifests list renders each manifest with its tag + parse
 *       status, and a server-reported DROPPED file is surfaced (not hidden);
 *   (c) an auto-answered decision renders its SOURCE PROVENANCE (manifest file +
 *       chip) and is EDITABLE inline — a manual edit writes through the capture
 *       seam and flips provenance to "manually entered";
 *   (d) a version-unknown answer renders a clear affordance and accepts a
 *       manually-supplied exact version.
 *
 * The upload + capture API calls are injected (no network). Mirrors the
 * fetch/dep-injection style of the sibling architectConversation tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

import {
  ManifestUploadPanel,
  type ManifestUploadPanelDeps,
} from '../ManifestUploadPanel';
import type { TargetManifestUploadResponse } from '../../../../api/targetManifestApi';

afterEach(() => cleanup());

const PROJECT = 'proj-1';
const ARCH = 'arch-9';

function pomFile(name = 'pom.xml'): File {
  return new File(['<project/>'], name, { type: 'text/xml' });
}
function pkgFile(name = 'package.json'): File {
  return new File(['{}'], name, { type: 'application/json' });
}

function makeResponse(
  overrides: Partial<TargetManifestUploadResponse> = {},
): TargetManifestUploadResponse {
  return {
    parsedManifests: [
      {
        status: 'parsed',
        ecosystem: 'MAVEN',
        kind: 'pom.xml',
        tag: 'orders-service',
        manifestPath: 'services/orders/pom.xml',
        declaredDependencies: [
          {
            name: 'org.springframework.boot:spring-boot-starter-web',
            version: '3.4.1',
            scope: 'compile',
            manifestPath: 'services/orders/pom.xml',
          },
        ],
        rawPomContent: '<project/>',
        packageLockContent: null,
      },
    ],
    droppedManifests: [],
    summary: { parsedCount: 1, droppedCount: 0, totalDeclaredDependencies: 1 },
    autoAnswer: {
      writtenCodes: ['service.framework'],
      rowsWritten: 1,
      partialFailureCodes: [],
      aborted: false,
      failureReason: null,
      skippedManualCodes: [],
      resolvedTargetVersions: [
        {
          decisionCode: 'service.framework',
          framework: 'Spring Boot',
          version: '3.4.1',
          versionUnknown: false,
          provenance: 'manifest',
          sourceFile: 'services/orders/pom.xml',
        },
      ],
      confirmedManifests: [],
    },
    ...overrides,
  };
}

function makeDeps(
  response: TargetManifestUploadResponse,
): { deps: ManifestUploadPanelDeps; uploadSpy: ReturnType<typeof vi.fn>; captureSpy: ReturnType<typeof vi.fn> } {
  const uploadSpy = vi.fn().mockResolvedValue(response);
  const captureSpy = vi.fn().mockResolvedValue({ outcome: 'captured' });
  return {
    deps: {
      uploadTargetManifests: uploadSpy as unknown as ManifestUploadPanelDeps['uploadTargetManifests'],
      captureAnswer: captureSpy as unknown as ManifestUploadPanelDeps['captureAnswer'],
    },
    uploadSpy,
    captureSpy,
  };
}

describe('ManifestUploadPanel (Spec 3, TG5)', () => {
  it('(a) requires a module/service tag per selected manifest before submit', async () => {
    const { deps, uploadSpy } = makeDeps(makeResponse());
    render(
      <ManifestUploadPanel projectId={PROJECT} targetArchitectureId={ARCH} deps={deps} />,
    );

    const input = screen.getByTestId('manifest-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pomFile()] } });

    // Selected, but no tag yet → submit disabled + a tag warning shown.
    const submit = screen.getByTestId('manifest-upload-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('manifest-tag-warning')).toBeTruthy();

    // Supply a tag → submit enables.
    fireEvent.change(screen.getByTestId('manifest-tag-input-0'), {
      target: { value: 'orders-service' },
    });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    // The upload was given the tagged selection.
    const passedSelection = uploadSpy.mock.calls[0][2];
    expect(passedSelection[0].tag).toBe('orders-service');
  });

  it('(b) lists uploaded manifests with tag + parse status and surfaces dropped files', async () => {
    const response = makeResponse({
      droppedManifests: [
        {
          status: 'unparsed',
          kind: null,
          tag: null,
          manifestPath: 'build.gradle',
          reason: 'Unsupported file — only pom.xml and package.json are accepted.',
        },
      ],
      summary: { parsedCount: 1, droppedCount: 1, totalDeclaredDependencies: 1 },
    });
    const { deps } = makeDeps(response);
    render(
      <ManifestUploadPanel projectId={PROJECT} targetArchitectureId={ARCH} deps={deps} />,
    );

    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile()] },
    });
    fireEvent.change(screen.getByTestId('manifest-tag-input-0'), {
      target: { value: 'orders-service' },
    });
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // Parsed manifest row shows its tag + a "parsed" status.
    const parsed = await screen.findByTestId('manifest-status-parsed');
    expect(within(parsed).getByText('orders-service')).toBeTruthy();
    expect(within(parsed).getByText('parsed')).toBeTruthy();

    // Dropped file is surfaced (NOT hidden) with its reason.
    const dropped = screen.getByTestId('manifest-status-dropped');
    expect(within(dropped).getByText('dropped')).toBeTruthy();
    expect(within(dropped).getByText(/Unsupported file/)).toBeTruthy();
  });

  it('(c) renders an auto-answered decision with provenance and edits it inline (manual wins)', async () => {
    const { deps, captureSpy } = makeDeps(makeResponse());
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        sessionId="sess-1"
        deps={deps}
      />,
    );

    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile()] },
    });
    fireEvent.change(screen.getByTestId('manifest-tag-input-0'), {
      target: { value: 'orders-service' },
    });
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // The auto-answered decision shows its single resolved chip + manifest provenance.
    const decision = await screen.findByTestId('manifest-decision-service.framework');
    expect(within(decision).getByTestId('manifest-decision-chip').textContent).toBe(
      'Spring Boot 3.4.1',
    );
    expect(within(decision).getByTestId('manifest-decision-provenance').textContent).toBe(
      'from manifest',
    );
    expect(within(decision).getByTestId('manifest-decision-source')).toBeTruthy();

    // Edit inline → a NEW exact version is captured as a MANUAL answer.
    fireEvent.click(within(decision).getByTestId('manifest-decision-edit'));
    fireEvent.change(within(decision).getByTestId('manifest-decision-edit-input'), {
      target: { value: '3.4.5' },
    });
    fireEvent.click(within(decision).getByTestId('manifest-decision-edit-save'));

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const captureBody = captureSpy.mock.calls[0][2];
    expect(captureBody.decisionCode).toBe('service.framework');
    // The captured value rides the structured { framework, version } envelope.
    const parsedValue = JSON.parse(captureBody.value);
    expect(parsedValue.value).toEqual({ framework: 'Spring Boot', version: '3.4.5' });

    // Provenance flips to "manually entered" + chip updates optimistically.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('manifest-decision-service.framework')).getByTestId(
          'manifest-decision-provenance',
        ).textContent,
      ).toBe('manually entered'),
    );
    expect(
      within(screen.getByTestId('manifest-decision-service.framework')).getByTestId(
        'manifest-decision-chip',
      ).textContent,
    ).toBe('Spring Boot 3.4.5');
  });

  it('(d) renders a version-unknown decision as a first-class affordance and accepts a manual exact version', async () => {
    const response = makeResponse({
      autoAnswer: {
        writtenCodes: ['service.framework'],
        rowsWritten: 1,
        partialFailureCodes: [],
        aborted: false,
        failureReason: null,
        skippedManualCodes: [],
        resolvedTargetVersions: [
          {
            decisionCode: 'service.framework',
            framework: 'Spring Boot',
            version: 'version-unknown',
            versionUnknown: true,
            provenance: 'manifest',
            sourceFile: 'services/orders/pom.xml',
          },
        ],
        confirmedManifests: [],
      },
    });
    const { deps, captureSpy } = makeDeps(response);
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        sessionId="sess-1"
        deps={deps}
      />,
    );

    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pkgFile()] },
    });
    fireEvent.change(screen.getByTestId('manifest-tag-input-0'), {
      target: { value: 'orders-service' },
    });
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // The unknown answer renders the explicit "(version unknown)" chip + affordance.
    const decision = await screen.findByTestId('manifest-decision-service.framework');
    expect(decision.getAttribute('data-version-unknown')).toBe('true');
    expect(within(decision).getByTestId('manifest-decision-chip').textContent).toBe(
      'Spring Boot (version unknown)',
    );
    expect(within(decision).getByTestId('manifest-version-unknown-note')).toBeTruthy();

    // Supply an exact version manually.
    fireEvent.click(within(decision).getByTestId('manifest-decision-edit'));
    const editInput = within(decision).getByTestId(
      'manifest-decision-edit-input',
    ) as HTMLInputElement;
    expect(editInput.value).toBe(''); // unknown seeds an EMPTY field
    fireEvent.change(editInput, { target: { value: '3.4.1' } });
    fireEvent.click(within(decision).getByTestId('manifest-decision-edit-save'));

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const parsedValue = JSON.parse(captureSpy.mock.calls[0][2].value);
    expect(parsedValue.value).toEqual({ framework: 'Spring Boot', version: '3.4.1' });

    // The chip is now the concrete version + provenance is manual.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('manifest-decision-service.framework')).getByTestId(
          'manifest-decision-chip',
        ).textContent,
      ).toBe('Spring Boot 3.4.1'),
    );
  });
});
