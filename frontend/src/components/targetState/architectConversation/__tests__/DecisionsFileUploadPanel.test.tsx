/**
 * Spec 2026-06-26-target-state-decisions-file-import (Spec 3) — FR6 + FR7.
 * DecisionsFileUploadPanel: staging/active-reporting, import summary (full vs
 * subset, overrides/tier-skips/skipped-sections/bad-lines, the from-imported-file
 * badge), and the mutual-exclusivity disabled state.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  DecisionsFileUploadPanel,
  type DecisionsFileUploadPanelDeps,
} from '../DecisionsFileUploadPanel';
import type { DecisionsFileImportResult } from '../../../../api/decisionsFileImportApi';

function makeResult(over: Partial<DecisionsFileImportResult> = {}): DecisionsFileImportResult {
  return {
    written: [],
    overrides: [],
    skippedTierCodes: [],
    skippedSections: [],
    badLines: [],
    failedCodes: [],
    allAnswered: false,
    parsedCount: 0,
    ...over,
  };
}

function depsFor(result: DecisionsFileImportResult): {
  deps: DecisionsFileUploadPanelDeps;
  upload: ReturnType<typeof vi.fn>;
} {
  const upload = vi.fn().mockResolvedValue(result);
  return { deps: { uploadDecisionsFile: upload as DecisionsFileUploadPanelDeps['uploadDecisionsFile'] }, upload };
}

const BASE = { projectId: 'p1', targetArchitectureId: 't1' };

function chooseFile() {
  const input = screen.getByTestId('decisions-file-input') as HTMLInputElement;
  const file = new File(['service.framework = Spring Boot 4.0'], 'decisions.txt', {
    type: 'text/plain',
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('DecisionsFileUploadPanel (FR6 + FR7)', () => {
  it('reports active when a file is staged and inactive when cleared', () => {
    const onActiveChange = vi.fn();
    const { deps } = depsFor(makeResult());
    render(<DecisionsFileUploadPanel {...BASE} onActiveChange={onActiveChange} deps={deps} />);

    chooseFile();
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('decisions-file-submit')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('decisions-file-clear'));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('imports and renders the subset summary, each written code badged "from imported file"', async () => {
    const result = makeResult({ written: ['service.framework', 'db.driver'], parsedCount: 2 });
    const { deps, upload } = depsFor(result);
    const onImported = vi.fn();
    render(<DecisionsFileUploadPanel {...BASE} onImported={onImported} deps={deps} />);

    chooseFile();
    fireEvent.click(screen.getByTestId('decisions-file-submit'));

    await waitFor(() => expect(screen.getByTestId('decisions-import-summary')).toBeInTheDocument());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith(result);
    expect(screen.getByTestId('decisions-import-subset')).toBeInTheDocument();
    expect(screen.getAllByTestId('decisions-import-written')).toHaveLength(2);
    const badges = screen.getAllByTestId('decisions-provenance-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('from imported file');
  });

  it('prompts Save Conversation when the import answers everything (allAnswered)', async () => {
    const { deps } = depsFor(makeResult({ written: ['x'], allAnswered: true }));
    render(<DecisionsFileUploadPanel {...BASE} deps={deps} />);
    chooseFile();
    fireEvent.click(screen.getByTestId('decisions-file-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('decisions-import-allanswered')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('decisions-import-allanswered')).toHaveTextContent('Save');
    expect(screen.queryByTestId('decisions-import-subset')).toBeNull();
  });

  it('surfaces overrides, tier-skips, skipped sections and bad lines (no silent drop)', async () => {
    const result = makeResult({
      written: ['service.framework'],
      overrides: [{ decisionCode: 'service.framework', prior: 'Quarkus 3', next: 'Spring Boot 4.0' }],
      skippedTierCodes: ['ui.framework'],
      skippedSections: ['Per-service overrides'],
      badLines: [{ lineNumber: 5, raw: 'junk', reason: 'unknown_code', detail: "'junk' is not a known code." }],
    });
    const { deps } = depsFor(result);
    render(<DecisionsFileUploadPanel {...BASE} deps={deps} />);
    chooseFile();
    fireEvent.click(screen.getByTestId('decisions-file-submit'));

    await waitFor(() => expect(screen.getByTestId('decisions-import-override')).toBeInTheDocument());
    expect(screen.getByTestId('decisions-import-override')).toHaveTextContent('Quarkus 3');
    expect(screen.getByTestId('decisions-import-tierskip')).toHaveTextContent('ui.framework');
    expect(screen.getByTestId('decisions-import-skipped-sections')).toHaveTextContent('Per-service overrides');
    expect(screen.getByTestId('decisions-import-badline')).toHaveTextContent('Line 5');
  });

  it('mutual exclusivity: disabledReason disables the input and shows the note', () => {
    const { deps } = depsFor(makeResult());
    render(
      <DecisionsFileUploadPanel
        {...BASE}
        disabledReason="Clear the selected manifest(s) to import a decisions file instead."
        deps={deps}
      />,
    );
    expect(screen.getByTestId('decisions-file-disabled-note')).toBeInTheDocument();
    expect((screen.getByTestId('decisions-file-input') as HTMLInputElement).disabled).toBe(true);
    // No file can be staged, so no submit button is shown.
    expect(screen.queryByTestId('decisions-file-submit')).toBeNull();
  });
});
