/**
 * StartDiscoveryRunModal + PreflightModal upload + uploadDiscoveryRunLogFiles tests
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start
 * Task Group 4.1: 2-8 focused tests across the new modal + modified
 * PreflightModal + the multipart upload API client.
 *
 * 6 tests covering:
 *   (a) StartDiscoveryRunModal Start with files -> startDiscoveryRun then
 *       uploadDiscoveryRunLogFiles (with the returned runId).
 *   (b) StartDiscoveryRunModal Start with no files -> startDiscoveryRun only,
 *       upload call SKIPPED.
 *   (c) StartDiscoveryRunModal upload-failure path -> run is NOT rolled back,
 *       inline error banner ("toast") surfaces and the modal stays open.
 *   (d) PreflightModal renders the new "Upload Log Files" section above
 *       Run/Cancel and preserves all existing controls (BFS preview +
 *       "Include external libraries" toggle).
 *   (e) PreflightModal Run flow performs create-run-first then upload-after
 *       sequencing (via the parent-supplied onConfirm).
 *   (f) uploadDiscoveryRunLogFiles builds FormData with all files and POSTs
 *       without setting Content-Type manually.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// CSS-module identity mocks -- match the codebase Vitest convention.
vi.mock('./StartDiscoveryRunModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./LogFileUploadInput.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../Grid/PreflightModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

// ============================================================================
// Mocks for the run-creation + upload API surface
// ============================================================================

// startDiscoveryRun lives in services/gatewayClient. We mock just that export
// and let everything else fall through via importActual so co-located helpers
// do not break.
const mockStartDiscoveryRun = vi.fn();
vi.mock('../../services/gatewayClient', async () => {
  const actual: any = await vi.importActual('../../services/gatewayClient');
  return {
    ...actual,
    startDiscoveryRun: (...args: any[]) => mockStartDiscoveryRun(...args),
  };
});

// uploadDiscoveryRunLogFiles lives in api/discoveryApi. Same partial-mock
// pattern -- we replace just the upload function and keep everything else
// pointing at the real exports (per project memory).
const mockUploadDiscoveryRunLogFiles = vi.fn();
vi.mock('../../api/discoveryApi', async () => {
  const actual: any = await vi.importActual('../../api/discoveryApi');
  return {
    ...actual,
    uploadDiscoveryRunLogFiles: (...args: any[]) => mockUploadDiscoveryRunLogFiles(...args),
  };
});

// ============================================================================
// Imports (after mocks)
// ============================================================================
import { StartDiscoveryRunModal } from './StartDiscoveryRunModal';
import { PreflightModal, ScanPlan } from '../Grid/PreflightModal';
import { uploadDiscoveryRunLogFiles } from '../../api/discoveryApi';

// ============================================================================
// Helpers
// ============================================================================

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

const SCAN_PLAN: ScanPlan = {
  root: { kind: 'service', id: 'svc-abc', name: 'Orders UI' },
  internalLibrariesToScan: [],
  externalLibrariesToRecord: [],
  warnings: [],
};

// ============================================================================
// Tests
// ============================================================================

describe('Spec 2026-05-10 Task Group 4 -- run-start orchestration + upload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) StartDiscoveryRunModal Start with files -> create-run-first then
  //     uploadDiscoveryRunLogFiles is called with the returned runId.
  // -------------------------------------------------------------------------
  it('StartDiscoveryRunModal: Start with files calls startDiscoveryRun then uploadDiscoveryRunLogFiles with the new runId', async () => {
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-xyz', status: 'PENDING' });
    mockUploadDiscoveryRunLogFiles.mockResolvedValueOnce({
      logFiles: [],
      attemptedCount: 1,
      successfulCount: 1,
    });

    const onRunStarted = vi.fn();
    const onClose = vi.fn();
    renderStartModal({ onRunStarted, onClose });

    // Render check: the modal contains the LogFileUploadInput + Start/Cancel.
    expect(screen.getByTestId('start-discovery-run-modal')).toBeInTheDocument();
    expect(screen.getByTestId('log-file-upload-input')).toBeInTheDocument();
    expect(screen.getByTestId('start-discovery-run-modal-start-button')).toBeInTheDocument();
    expect(screen.getByTestId('start-discovery-run-modal-cancel-button')).toBeInTheDocument();

    // Pick a single valid log file via the embedded input.
    pickFiles('log-file-upload-input-file-input', [makeFile('access.log', 1024)]);
    expect(screen.getByTestId('log-file-upload-input-row-0')).toHaveTextContent('access.log');

    fireEvent.click(screen.getByTestId('start-discovery-run-modal-start-button'));

    // Order matters: startDiscoveryRun first, then upload with returned runId.
    await waitFor(() => {
      expect(mockStartDiscoveryRun).toHaveBeenCalledWith('proj-1', 'arch-1', 'svc-abc', false);
    });
    await waitFor(() => {
      expect(mockUploadDiscoveryRunLogFiles).toHaveBeenCalledTimes(1);
    });
    const uploadArgs = mockUploadDiscoveryRunLogFiles.mock.calls[0];
    expect(uploadArgs[0]).toBe('proj-1');
    expect(uploadArgs[1]).toBe('arch-1');
    expect(uploadArgs[2]).toBe('run-xyz');
    expect(Array.isArray(uploadArgs[3])).toBe(true);
    expect(uploadArgs[3][0].name).toBe('access.log');

    // On full success, parent is notified and modal closes.
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('run-xyz'));
    expect(onClose).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (b) StartDiscoveryRunModal Start with no files -> upload SKIPPED.
  // -------------------------------------------------------------------------
  it('StartDiscoveryRunModal: Start with no files selected calls startDiscoveryRun and SKIPS the upload call', async () => {
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-empty', status: 'PENDING' });

    const onRunStarted = vi.fn();
    const onClose = vi.fn();
    renderStartModal({ onRunStarted, onClose });

    // No file selection.
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-start-button'));

    await waitFor(() => {
      expect(mockStartDiscoveryRun).toHaveBeenCalledTimes(1);
    });
    // Upload MUST NOT be called when files.length === 0 (preserves the
    // pre-Spec-4 no-log behaviour byte-for-byte).
    expect(mockUploadDiscoveryRunLogFiles).not.toHaveBeenCalled();

    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('run-empty'));
    expect(onClose).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (c) StartDiscoveryRunModal upload-failure -> KEEP run, surface error,
  //     do NOT auto-close.
  // -------------------------------------------------------------------------
  it('StartDiscoveryRunModal: upload-failure path keeps the run, surfaces an error banner, and does NOT auto-close', async () => {
    mockStartDiscoveryRun.mockResolvedValueOnce({ id: 'run-keep', status: 'PENDING' });
    mockUploadDiscoveryRunLogFiles.mockRejectedValueOnce(
      new Error('Failed to upload discovery run log files (500): disk write failed'),
    );

    const onRunStarted = vi.fn();
    const onClose = vi.fn();
    renderStartModal({ onRunStarted, onClose });

    pickFiles('log-file-upload-input-file-input', [makeFile('events.jsonl', 512)]);
    fireEvent.click(screen.getByTestId('start-discovery-run-modal-start-button'));

    // Upload was attempted but failed.
    await waitFor(() => expect(mockUploadDiscoveryRunLogFiles).toHaveBeenCalledTimes(1));

    // The run was NOT rolled back -- the parent IS notified that the run
    // started (so any side-effects can fire), but the modal stays open
    // with an inline error so the user can read the gateway detail.
    await waitFor(() => expect(onRunStarted).toHaveBeenCalledWith('run-keep'));
    expect(onClose).not.toHaveBeenCalled();

    // Error banner contains the gateway error detail.
    const errorBox = await screen.findByTestId('start-discovery-run-modal-upload-error');
    expect(errorBox).toBeInTheDocument();
    expect(errorBox).toHaveTextContent(/disk write failed/);
    // Modal still rendered.
    expect(screen.getByTestId('start-discovery-run-modal')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // (d) PreflightModal renders the new "Upload Log Files" section above
  //     Run/Cancel AND preserves the BFS preview + include-external toggle.
  // -------------------------------------------------------------------------
  it('PreflightModal: renders the Upload Log Files section above Run/Cancel and preserves all existing controls', async () => {
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

    // Wait for the preflight call to resolve so the BFS preview sections
    // render (they would otherwise sit behind the spinner).
    await waitFor(() => expect(previewFn).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId('preflight-modal-computing')).not.toBeInTheDocument(),
    );

    // Existing controls preserved:
    expect(screen.getByTestId('preflight-modal-root-summary')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-internal-libs')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-external-libs')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-toggle-include-external')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-run-button')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-modal-cancel-button')).toBeInTheDocument();

    // New: the Upload Log Files section is embedded with its data-testid.
    const uploadSection = screen.getByTestId('preflight-modal-log-file-upload-input');
    expect(uploadSection).toBeInTheDocument();
    expect(uploadSection).toHaveTextContent('Upload Log Files');
  });

  // -------------------------------------------------------------------------
  // (e) PreflightModal Run flow forwards (includeExternal, selectedFiles)
  //     to the parent so it can perform create-run-first -> upload-after.
  // -------------------------------------------------------------------------
  it('PreflightModal: Run flow forwards selected log files to onConfirm so the parent can create-run-first then upload-after', async () => {
    const previewFn = vi.fn(async () => SCAN_PLAN);
    const onConfirm = vi.fn();
    render(
      <PreflightModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        rootEntity={{ kind: 'service', id: 'svc-abc', name: 'Orders UI' }}
        previewFn={previewFn}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByTestId('preflight-modal-computing')).not.toBeInTheDocument(),
    );

    // Pick a file via the embedded LogFileUploadInput. The modal owns the
    // selectedFiles state and threads it into onConfirm on Run.
    pickFiles('log-file-upload-input-file-input', [makeFile('runtime.log', 4096)]);

    fireEvent.click(screen.getByTestId('preflight-modal-run-button'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [includeExternalArg, selectedFilesArg] = onConfirm.mock.calls[0];
    // Default toggle is ON per existing PreflightModal behaviour.
    expect(includeExternalArg).toBe(true);
    expect(Array.isArray(selectedFilesArg)).toBe(true);
    expect(selectedFilesArg).toHaveLength(1);
    expect(selectedFilesArg[0].name).toBe('runtime.log');
  });

  // -------------------------------------------------------------------------
  // (f) uploadDiscoveryRunLogFiles builds FormData with all files and POSTs
  //     without setting Content-Type manually.
  // -------------------------------------------------------------------------
  it('uploadDiscoveryRunLogFiles: builds FormData with all files and POSTs without setting Content-Type', async () => {
    // Use the REAL implementation here -- the partial mock above replaces it
    // for the modal test path, but we want to assert on the actual fetch call
    // shape. We import the actual module fresh and patch global fetch.
    const actual: any = await vi.importActual('../../api/discoveryApi');
    const realUpload = actual.uploadDiscoveryRunLogFiles as typeof uploadDiscoveryRunLogFiles;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logFiles: [], attemptedCount: 2, successfulCount: 2 }),
      text: async () => '',
    });
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = fetchMock;

    try {
      const f1 = makeFile('a.log', 100);
      const f2 = makeFile('b.jsonl', 200, 'application/jsonl');
      await realUpload('proj-1', 'arch-1', 'run-xyz', [f1, f2]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain(
        '/api/v1/discovery/projects/proj-1/architectures/arch-1/runs/run-xyz/log-files',
      );
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      // Spec lock: do NOT set Content-Type manually -- the browser supplies
      // the multipart boundary parameter automatically.
      expect(init.headers).toBeUndefined();

      // The FormData must contain both files appended under field name 'logFiles'.
      const fd = init.body as FormData;
      const entries = Array.from(fd.getAll('logFiles'));
      expect(entries).toHaveLength(2);
      expect((entries[0] as File).name).toBe('a.log');
      expect((entries[1] as File).name).toBe('b.jsonl');
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});
