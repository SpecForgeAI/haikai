/**
 * LogFileUploadInput Tests
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start
 * Task Group 3.1: Reusable LogFileUploadInput component tests
 *
 * 6 focused tests covering:
 *   (a) renders the multi-file input with the locked accept attribute
 *   (b) selecting valid files calls onChange with the File[] (controlled)
 *   (c) clicking Remove removes that row from the selection and calls onChange
 *   (d) unsupported extension is rejected with an inline error
 *   (e) per-file size cap rejects an oversize file with an inline error
 *   (f) cumulative size cap rejects a file that would push the total over
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogFileUploadInput } from './LogFileUploadInput';

// CSS-module identity mock -- same Proxy pattern used by the rest of the
// codebase's Vitest tests (see DashboardView/__tests__/*).
vi.mock('./LogFileUploadInput.module.css', () => ({
  default: new Proxy(
    {},
    {
      get: (_target: object, prop: string | symbol) => String(prop),
    },
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a `File`-like object with a controllable size.
 *
 * jsdom's File constructor honours the body length, but for size-cap tests we
 * need to fabricate "oversize" files without actually allocating that much
 * memory. We therefore build the File from a tiny content blob and then
 * override the `size` getter via Object.defineProperty.
 */
function makeFile(name: string, sizeBytes: number, type = 'text/plain'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes, configurable: true });
  return file;
}

function getFileInput(): HTMLInputElement {
  return screen.getByTestId('log-file-upload-input-file-input') as HTMLInputElement;
}

/**
 * Build a minimal FileList-shaped object backed by the supplied File[].
 *
 * jsdom does not expose a constructor for FileList and `DataTransfer` is not
 * defined in the default jsdom environment, so we shape an array-like with
 * `length`, indexed access, and `item()` -- which is everything the component
 * (and `Array.from(...)`) consume from it.
 */
function buildFileList(files: File[]): FileList {
  const list: Record<string | number, unknown> = {
    length: files.length,
    item(index: number) {
      return files[index] ?? null;
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

/**
 * Fire a synthetic change event on the file input with the supplied `files`.
 *
 * `userEvent.upload` exists but is awkward when we need to inject files with
 * fabricated `size` values, so we use `fireEvent.change` directly with a
 * `target.files` payload.
 */
function pickFiles(files: File[]) {
  const input = getFileInput();
  fireEvent.change(input, { target: { files: buildFileList(files) } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogFileUploadInput (Task 3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (a) renders the multi-file input with the locked accept attribute
  it('renders a multi-file input with the locked accept attribute', () => {
    render(<LogFileUploadInput selectedFiles={[]} onChange={vi.fn()} />);

    const input = getFileInput();
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.getAttribute('accept')).toBe('.log,.txt,.jsonl,.ndjson');

    // Helper text + section title are present.
    expect(screen.getByText('Upload Log Files')).toBeInTheDocument();
    expect(screen.getByTestId('log-file-upload-input-helper')).toHaveTextContent(/Optional\./);
  });

  // (b) selecting valid files calls onChange with the File array (appended)
  it('calls onChange with the File array when valid files are selected', () => {
    const onChange = vi.fn();
    render(<LogFileUploadInput selectedFiles={[]} onChange={onChange} />);

    const a = makeFile('access.log', 1024);
    const b = makeFile('events.jsonl', 2048, 'application/jsonl');
    pickFiles([a, b]);

    expect(onChange).toHaveBeenCalledTimes(1);
    const passed = onChange.mock.calls[0][0] as File[];
    expect(passed).toHaveLength(2);
    expect(passed[0].name).toBe('access.log');
    expect(passed[1].name).toBe('events.jsonl');

    // No validation errors surfaced for valid files.
    expect(screen.queryByTestId('log-file-upload-input-validation-errors')).not.toBeInTheDocument();
  });

  // (c) clicking Remove drops that row from the displayed list and calls onChange
  it('removes a row from the displayed list and calls onChange when Remove is clicked', () => {
    const onChange = vi.fn();
    const a = makeFile('access.log', 1024);
    const b = makeFile('events.jsonl', 2048);

    // Parent owns state -- start with both files already selected.
    render(<LogFileUploadInput selectedFiles={[a, b]} onChange={onChange} />);

    // Both rows should render with their human-readable sizes.
    expect(screen.getByTestId('log-file-upload-input-row-0')).toHaveTextContent('access.log');
    expect(screen.getByTestId('log-file-upload-input-row-1')).toHaveTextContent('events.jsonl');

    // Click Remove on the first row.
    fireEvent.click(screen.getByTestId('log-file-upload-input-remove-0'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const passed = onChange.mock.calls[0][0] as File[];
    expect(passed).toHaveLength(1);
    expect(passed[0].name).toBe('events.jsonl');
  });

  // (d) unsupported extension produces an inline validation error
  it('rejects a file with an unsupported extension and surfaces an inline error', () => {
    const onChange = vi.fn();
    render(<LogFileUploadInput selectedFiles={[]} onChange={onChange} />);

    const png = makeFile('screenshot.png', 1024, 'image/png');
    pickFiles([png]);

    // No accepted file -> onChange should NOT have been called.
    expect(onChange).not.toHaveBeenCalled();

    const errorBox = screen.getByTestId('log-file-upload-input-validation-errors');
    expect(errorBox).toBeInTheDocument();
    expect(errorBox).toHaveTextContent(/screenshot\.png/);
    expect(errorBox).toHaveTextContent(/unsupported file extension/);
  });

  // (e) per-file size cap rejects oversize files
  it('rejects a file that exceeds maxFileBytes and surfaces an inline error', () => {
    const onChange = vi.fn();
    // Tight per-file cap to make the assertion deterministic.
    render(
      <LogFileUploadInput
        selectedFiles={[]}
        onChange={onChange}
        maxFileBytes={1000}
        maxTotalBytes={10_000_000}
      />,
    );

    const huge = makeFile('huge.log', 5000);
    pickFiles([huge]);

    expect(onChange).not.toHaveBeenCalled();
    const errorBox = screen.getByTestId('log-file-upload-input-validation-errors');
    expect(errorBox).toHaveTextContent(/huge\.log/);
    expect(errorBox).toHaveTextContent(/per-file limit/);
  });

  // (f) cumulative size cap rejects a file that would push the total over
  it('rejects a file when the cumulative selected size would exceed maxTotalBytes', () => {
    const onChange = vi.fn();
    // Pre-load one already-selected file at 600 bytes; total cap is 1000.
    // A new 500-byte pick would push the running total to 1100 -> reject.
    const existing = makeFile('existing.log', 600);
    render(
      <LogFileUploadInput
        selectedFiles={[existing]}
        onChange={onChange}
        maxFileBytes={10_000}
        maxTotalBytes={1000}
      />,
    );

    const incoming = makeFile('incoming.log', 500);
    pickFiles([incoming]);

    expect(onChange).not.toHaveBeenCalled();
    const errorBox = screen.getByTestId('log-file-upload-input-validation-errors');
    expect(errorBox).toHaveTextContent(/incoming\.log/);
    expect(errorBox).toHaveTextContent(/total upload limit/);
  });
});
