/**
 * StartDiscoveryRunModal + PreflightModal -- per-run M control + multipart wire
 *
 * Spec 2026-05-11: Discovery Run Robustness -- Section 1
 * Task Group 4.1: 4-8 focused tests across both modals + the multipart upload.
 *
 * Coverage:
 *   1. StartDiscoveryRunModal renders the M numeric input with default `1` and
 *      hint text when `selectedFiles.length > 0`; hidden when no files selected.
 *   2. PreflightModal mirrors the same UX (visibility-gated input + hint).
 *   3. uploadDiscoveryRunLogFiles called with `M = 3` appends a multipart
 *      `runtimeEvidenceConfig` field whose JSON value is
 *      `{"maxLogPathPrefixSegments":3}`.
 *   4. uploadDiscoveryRunLogFiles called WITHOUT the 5th argument does NOT
 *      append the `runtimeEvidenceConfig` field (backwards-compat).
 *   5. StartDiscoveryRunModal: when `selectedFiles.length === 0`, the upload
 *      call is skipped entirely.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---- CSS module identity mocks ----
vi.mock('./StartDiscoveryRunModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./LogFileUploadInput.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../Grid/PreflightModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

// ---- Mocks for run-creation + upload API surface ----
const mockStartDiscoveryRun = vi.fn();
vi.mock('../../services/gatewayClient', async () => {
  const actual: any = await vi.importActual('../../services/gatewayClient');
  return {
    ...actual,
    startDiscoveryRun: (...args: any[]) => mockStartDiscoveryRun(...args),
  };
});

const mockUploadDiscoveryRunLogFiles = vi.fn();
vi.mock('../../api/discoveryApi', async () => {
  const actual: any = await vi.importActual('../../api/discoveryApi');
  return {
    ...actual,
    uploadDiscoveryRunLogFiles: (...args: any[]) => mockUploadDiscoveryRunLogFiles(...args),
  };
});

// ---- Imports (after mocks) ----
import { StartDiscoveryRunModal } from './StartDiscoveryRunModal';
import { PreflightModal, ScanPlan } from '../Grid/PreflightModal';
import { uploadDiscoveryRunLogFiles } from '../../api/discoveryApi';

// ---- Helpers ----
function makeFile(name: string, sizeBytes = 256, type = 'text/plain'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes, configurable: true });
  return f;
}

function buildFileList(files: File[]): FileList {
  const list: Record<string | number, unknown> = {
    length: files.length,
    item(i: number) {
      return files[i] ?? null;
    },
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list as unknown as FileList;
}

function pickFiles(testId: string, files: File[]) {
  const input = screen.getByTestId(testId) as HTMLInputElement;
  fireEvent.change(input, { target: { files: buildFileList(files) } });
}

const SCAN_PLAN: ScanPlan = {
  root: { kind: 'service', id: 'svc-abc', name: 'Orders UI' },
  internalLibrariesToScan: [],
  externalLibrariesToRecord: [],
  warnings: [],
};

function renderStartModal(
  overrides: Partial<React.ComponentProps<typeof StartDiscoveryRunModal>> = {},
) {
  const defaults: React.ComponentProps<typeof StartDiscoveryRunModal> = {
    isOpen: true,
    projectId: 'proj-1',
    architectureId: 'arch-1',
    serviceId: 'svc-abc',
    serviceName: 'Orders UI',
    onClose: vi.fn(),
    onRunStarted: vi.fn(),
    onRunStartError: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return { props, ...render(<StartDiscoveryRunModal {...props} />) };
}

// ============================================================================
// Tests
// ============================================================================

describe('Spec 2026-05-11 Section 1 -- per-run M control + multipart rider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. StartDiscoveryRunModal: M numeric input visibility-gated on file
  //    selection. Hidden when no files; default value 1 + hint when present.
  // -------------------------------------------------------------------------
  it('StartDiscoveryRunModal: hides the M input when no files selected and shows it (default 1 + hint) once a file is added', () => {
    renderStartModal();

    // Initially hidden.
    expect(
      screen.queryByTestId('start-discovery-run-modal-max-segments-input'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('start-discovery-run-modal-max-segments-hint'),
    ).not.toBeInTheDocument();

    // After picking a file the control appears with default value 1.
    pickFiles('log-file-upload-input-file-input', [makeFile('access.log', 1024)]);

    const input = screen.getByTestId(
      'start-discovery-run-modal-max-segments-input',
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
    expect(input.min).toBe('0');
    expect(input.max).toBe('5');
    expect(input.step).toBe('1');
    expect(input.value).toBe('1');

    const hint = screen.getByTestId('start-discovery-run-modal-max-segments-hint');
    expect(hint).toHaveTextContent(
      /Tolerate up to N proxy prefix segments when matching log paths to endpoints \(0-5, default 1\)/,
    );
  });

  // -------------------------------------------------------------------------
  // 2. PreflightModal mirrors the same UX.
  // -------------------------------------------------------------------------
  it('PreflightModal: hides the M input when no files selected and shows it (default 1 + hint) once a file is added', async () => {
    const previewFn = vi.fn(async () => SCAN_PLAN);
    render(
      <PreflightModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        rootEntity={{ kind: 'service', id: 'svc-abc', name: 'Orders UI' }}
        previewFn={previewFn}
      />,
    );

    // Wait for preflight to settle.
    await waitFor(() =>
      expect(screen.queryByTestId('preflight-modal-computing')).not.toBeInTheDocument(),
    );

    // Initially hidden.
    expect(
      screen.queryByTestId('preflight-modal-max-segments-input'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('preflight-modal-max-segments-hint'),
    ).not.toBeInTheDocument();

    // After picking a file the control appears with default value 1.
    pickFiles('log-file-upload-input-file-input', [makeFile('access.log', 1024)]);

    const input = screen.getByTestId(
      'preflight-modal-max-segments-input',
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
    expect(input.min).toBe('0');
    expect(input.max).toBe('5');
    expect(input.step).toBe('1');
    expect(input.value).toBe('1');

    const hint = screen.getByTestId('preflight-modal-max-segments-hint');
    expect(hint).toHaveTextContent(
      /Tolerate up to N proxy prefix segments when matching log paths to endpoints \(0-5, default 1\)/,
    );
  });

  // -------------------------------------------------------------------------
  // 3. uploadDiscoveryRunLogFiles with M=3 appends multipart
  //    `runtimeEvidenceConfig` field with the expected JSON value.
  // -------------------------------------------------------------------------
  it('uploadDiscoveryRunLogFiles: M=3 appends a `runtimeEvidenceConfig` multipart field with JSON value `{"maxLogPathPrefixSegments":3}`', async () => {
    const actual: any = await vi.importActual('../../api/discoveryApi');
    const realUpload = actual.uploadDiscoveryRunLogFiles as typeof uploadDiscoveryRunLogFiles;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logFiles: [], attemptedCount: 1, successfulCount: 1 }),
      text: async () => '',
    });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    try {
      const f1 = makeFile('a.log', 100);
      await realUpload('proj-1', 'arch-1', 'run-xyz', [f1], 3);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);

      const fd = init.body as FormData;
      const fileEntries = Array.from(fd.getAll('logFiles'));
      expect(fileEntries).toHaveLength(1);
      expect((fileEntries[0] as File).name).toBe('a.log');

      // The new rider field carrying M.
      const riderEntries = Array.from(fd.getAll('runtimeEvidenceConfig'));
      expect(riderEntries).toHaveLength(1);
      const riderJson = riderEntries[0];
      expect(typeof riderJson).toBe('string');
      expect(JSON.parse(riderJson as string)).toEqual({ maxLogPathPrefixSegments: 3 });
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 4. uploadDiscoveryRunLogFiles WITHOUT the 5th arg does NOT append the
  //    rider field (backwards-compat).
  // -------------------------------------------------------------------------
  it('uploadDiscoveryRunLogFiles: omitting the 5th argument does NOT append a `runtimeEvidenceConfig` field (backwards-compat)', async () => {
    const actual: any = await vi.importActual('../../api/discoveryApi');
    const realUpload = actual.uploadDiscoveryRunLogFiles as typeof uploadDiscoveryRunLogFiles;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logFiles: [], attemptedCount: 1, successfulCount: 1 }),
      text: async () => '',
    });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    try {
      const f1 = makeFile('a.log', 100);
      await realUpload('proj-1', 'arch-1', 'run-xyz', [f1]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const fd = init.body as FormData;
      // Exactly one logFiles entry, ZERO runtimeEvidenceConfig entries.
      expect(Array.from(fd.getAll('logFiles'))).toHaveLength(1);
      expect(Array.from(fd.getAll('runtimeEvidenceConfig'))).toHaveLength(0);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 5. StartDiscoveryRunModal: when no files are selected, upload is skipped
  //    entirely (no upload call at all -- preserves the no-log behaviour).
  // -------------------------------------------------------------------------
  it('StartDiscoveryRunModal: when no files are selected, the upload call is skipped entirely', async () => {
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-empty', status: 'PENDING' });

    const onRunStarted = vi.fn();
    const onClose = vi.fn();
    renderStartModal({ onRunStarted, onClose });

    fireEvent.click(screen.getByTestId('start-discovery-run-modal-start-button'));

    await waitFor(() => expect(mockStartDiscoveryRun).toHaveBeenCalledTimes(1));
    expect(mockUploadDiscoveryRunLogFiles).not.toHaveBeenCalled();

    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('run-empty'));
    expect(onClose).toHaveBeenCalled();
  });
});
