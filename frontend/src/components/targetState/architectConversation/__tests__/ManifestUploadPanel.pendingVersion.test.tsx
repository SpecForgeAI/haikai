/**
 * Tests -- ManifestUploadPanel pending-version affordance
 * Spec 2026-06-27-target-manifest-version-unknown-pending-questions, Task Group 4
 * (task 4.1). Focused tests covering ONLY the pending-version frontend changes:
 *
 *   (1) a version-unknown coordinate renders the READ-ONLY "Pending version
 *       confirmation -- confirm in the conversation" affordance (no inline edit
 *       entry point, no editable version input, no manual capture write);
 *   (2) the informational "Pending version confirmation (N)" list renders the
 *       pending entries and is SEPARATE from "Decisions Captured";
 *   (4) a concrete auto-answered row STILL renders the inline edit path.
 *
 * The upload + capture API calls are injected (no network).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import {
  ManifestUploadPanel,
  type ManifestUploadPanelDeps,
} from '../ManifestUploadPanel';
import type { TargetManifestUploadResponse } from '../../../../api/targetManifestApi';

afterEach(() => cleanup());

const PROJECT = 'proj-1';
const ARCH = 'arch-9';

const SERVICES = [
  { id: 'svc-orders', name: 'Orders Service', repoSubfolder: 'orders-service' },
];

function pomFile(name = 'pom.xml'): File {
  return new File(['<project/>'], name, { type: 'text/xml' });
}

function pickOrdersService(index = 0): void {
  fireEvent.change(screen.getByTestId(`manifest-service-select-${index}`), {
    target: { value: 'svc-orders' },
  });
}

function makeDeps(response: TargetManifestUploadResponse): {
  deps: ManifestUploadPanelDeps;
  captureSpy: ReturnType<typeof vi.fn>;
} {
  const uploadSpy = vi.fn().mockResolvedValue(response);
  const captureSpy = vi.fn().mockResolvedValue({ outcome: 'captured' });
  return {
    deps: {
      uploadTargetManifests:
        uploadSpy as unknown as ManifestUploadPanelDeps['uploadTargetManifests'],
      captureAnswer: captureSpy as unknown as ManifestUploadPanelDeps['captureAnswer'],
    },
    captureSpy,
  };
}

function baseResponse(
  autoAnswer: Partial<NonNullable<TargetManifestUploadResponse['autoAnswer']>>,
): TargetManifestUploadResponse {
  return {
    parsedManifests: [],
    droppedManifests: [],
    summary: { parsedCount: 1, droppedCount: 0, totalDeclaredDependencies: 1 },
    autoAnswer: {
      writtenCodes: [],
      rowsWritten: 0,
      partialFailureCodes: [],
      aborted: false,
      failureReason: null,
      skippedManualCodes: [],
      resolvedTargetVersions: [],
      confirmedManifests: [],
      ...autoAnswer,
    },
  };
}

function renderAndUpload(deps: ManifestUploadPanelDeps): void {
  render(
    <ManifestUploadPanel
      projectId={PROJECT}
      targetArchitectureId={ARCH}
      services={SERVICES}
      sessionId="sess-1"
      deps={deps}
    />,
  );
  fireEvent.change(screen.getByTestId('manifest-file-input'), {
    target: { files: [pomFile()] },
  });
  pickOrdersService();
  fireEvent.click(screen.getByTestId('manifest-upload-submit'));
}

describe('ManifestUploadPanel pending-version affordance (Spec 2026-06-27, TG4)', () => {
  it('(1) renders a version-unknown coordinate READ-ONLY (no inline edit, no version input)', async () => {
    const { deps, captureSpy } = makeDeps(
      baseResponse({
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
      }),
    );
    renderAndUpload(deps);

    const decision = await screen.findByTestId('manifest-decision-service.framework');
    // READ-ONLY pending affordance, NOT the old editable "supply the version" note.
    expect(
      within(decision).getByTestId('manifest-version-pending-note').textContent,
    ).toMatch(/Pending version confirmation/);
    // No inline edit entry point and no editable version input for unknown rows.
    expect(within(decision).queryByTestId('manifest-decision-edit')).toBeNull();
    expect(within(decision).queryByTestId('manifest-decision-edit-input')).toBeNull();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('(2) surfaces the informational "Pending version confirmation (N)" list, separate from Decisions Captured', async () => {
    const { deps } = makeDeps(
      baseResponse({
        // No captured rows; only a pending set.
        resolvedTargetVersions: [],
        pendingVersionConfirmations: [
          {
            decisionCode: 'service.framework',
            framework: 'Spring Boot',
            sourceFile: 'services/orders/pom.xml',
            sourceQuote: 'spring-boot-starter-web',
            tag: 'orders-service',
          },
          {
            decisionCode: 'db.driver',
            framework: 'pgjdbc',
            sourceFile: 'services/orders/pom.xml',
            sourceQuote: 'org.postgresql:postgresql',
            tag: 'orders-service',
          },
        ],
      }),
    );
    renderAndUpload(deps);

    const section = await screen.findByTestId('manifest-pending-version-section');
    expect(
      within(section).getByTestId('manifest-pending-version-heading').textContent,
    ).toBe('Pending version confirmation (2)');
    expect(within(section).getAllByTestId('manifest-pending-version-item')).toHaveLength(2);
    expect(within(section).getByText('Spring Boot')).toBeTruthy();
    expect(within(section).getByText('pgjdbc')).toBeTruthy();

    // SEPARATE from Decisions Captured: no auto-answered decision rows written.
    expect(screen.queryByTestId('manifest-decisions-heading')).toBeNull();
    expect(screen.queryByTestId('manifest-decision-service.framework')).toBeNull();
  });

  it('(4) a concrete auto-answered row STILL renders the inline edit path', async () => {
    const { deps } = makeDeps(
      baseResponse({
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
      }),
    );
    renderAndUpload(deps);

    const decision = await screen.findByTestId('manifest-decision-service.framework');
    // Concrete rows keep the Edit entry point + reveal the editable version input.
    const editBtn = within(decision).getByTestId('manifest-decision-edit');
    expect(editBtn).toBeTruthy();
    expect(within(decision).queryByTestId('manifest-version-pending-note')).toBeNull();
    fireEvent.click(editBtn);
    expect(within(decision).getByTestId('manifest-decision-edit-input')).toBeTruthy();
  });
});
