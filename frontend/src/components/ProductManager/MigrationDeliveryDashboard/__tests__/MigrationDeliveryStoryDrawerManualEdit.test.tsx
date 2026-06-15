/**
 * MigrationDeliveryStoryDrawer -- Manual edit integration tests
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 7.1.
 *
 * Coverage:
 *   1. View/Edit toggle swaps the read-only spec text for the editor.
 *   2. Save calls the gateway manual-edit API and refreshes drawer state
 *      from the returned DTO (text + Edited indicator + quality fields).
 *   3. Save when the text does not start with `/agent-os:shape-spec` shows a
 *      warning toast but still persists.
 *   4. Discard while dirty prompts the confirm dialog before reverting.
 *   5. The "View previous version" toggle is visible only when
 *      `previousSpecText` is set and renders the line diff when clicked.
 *   6. A save endpoint failure keeps the editor open with the user's text
 *      intact and surfaces an inline error banner.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';

// Mock CSS modules so class-name access does not blow up.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock CodeMirror with a controlled textarea so the editor renders quickly.
vi.mock('@uiw/react-codemirror', async () => {
  const ReactModule = await import('react');
  const Mock = ReactModule.forwardRef<
    unknown,
    {
      value?: string;
      readOnly?: boolean;
      onChange?: (next: string) => void;
    }
  >(function MockCodeMirror(props, ref) {
    ReactModule.useImperativeHandle(
      ref,
      () => ({ editor: null, state: null, view: null }),
      [],
    );
    return ReactModule.createElement('textarea', {
      'data-testid': 'mock-codemirror-textarea',
      value: props.value ?? '',
      readOnly: props.readOnly === true,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (props.onChange) props.onChange(e.target.value);
      },
    });
  });
  return { __esModule: true, default: Mock };
});

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({ __marker: 'markdown-extension' }),
}));

vi.mock('@codemirror/view', () => ({
  keymap: { of: (_b: unknown) => ({ __marker: 'keymap-extension' }) },
}));

// Mock the API client so we can intercept manualEditSpec.
const mockManualEditSpec = vi.fn();
const mockRecomputeSpecQuality = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    manualEditSpec: (...args: unknown[]) => mockManualEditSpec(...args),
    recomputeSpecQuality: (...args: unknown[]) =>
      mockRecomputeSpecQuality(...args),
  };
});

// Mock toast so we can assert prefix-warning surfacing without rendering the
// full provider tree.
const mockShowToast = vi.fn();
vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import {
  MigrationDeliveryStoryDrawer,
  type StoryPassTwoDetail,
} from '../MigrationDeliveryStoryDrawer';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';
import type { SpecGenerationRow } from '../../../../api/specGenerationApi';

function makeStory(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto> = {},
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: 'story-e',
    parentId: 'feature-1',
    type: 'story',
    title: 'Story to edit',
    workstream: 'order-service',
    sequenceOrder: 1,
    workItemId: 'wi-e',
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: 'medium',
    implementationStatus: 'not_started',
    evidenceStatus: 'no_evidence',
    needsAttentionCount: 0,
    missingInputsCount: 0,
    children: [],
    ...overrides,
  };
}

function makeSpec(
  overrides: Partial<StoryPassTwoDetail> = {},
): StoryPassTwoDetail {
  return {
    generationPass: 1,
    pass1SpecText: null,
    generatedSpecText: '/agent-os:shape-spec\noriginal text',
    pass2ChangesSummary: null,
    budgetMetaJson: null,
    noMeaningfulChange: null,
    warnings: [],
    specGenerationId: 'spec-1',
    qualityScore: 80,
    qualityGrade: 'B',
    qualityDimensions: null,
    previousQualityScore: null,
    manuallyEdited: false,
    lastManuallyEditedAt: null,
    lastManuallyEditedBy: null,
    previousSpecText: null,
    ...overrides,
  };
}

function makeReturnedRow(
  overrides: Partial<SpecGenerationRow> = {},
): SpecGenerationRow {
  return {
    id: 'spec-1',
    projectId: 'p-1',
    workItemId: 'wi-e',
    bookOfWorkId: 'b-1',
    bookItemId: 'bi-1',
    status: 'generated',
    confidence: 'medium',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: '/agent-os:shape-spec\nedited text',
    warnings: [],
    missingInputs: [],
    focusedContextRefs: null,
    evidenceRefs: [],
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: null,
    createdAt: null,
    updatedAt: null,
    manuallyEdited: true,
    lastManuallyEditedAt: '2026-05-20T12:30:00Z',
    lastManuallyEditedBy: 'user-alice',
    previousSpecText: '/agent-os:shape-spec\noriginal text',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ----------------------------------------------------------------------------
// Test 1: View/Edit toggle swaps to the editor.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- View/Edit toggle (Group 7)', () => {
  it('Edit button mounts the SpecMarkdownEditor', () => {
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec()}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('mdd-story-drawer-spec-text'),
    ).toHaveTextContent('original text');
    expect(
      screen.queryByTestId('mdd-story-drawer-spec-editor'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));

    expect(
      screen.getByTestId('mdd-story-drawer-spec-editor'),
    ).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Test 2: Save calls manualEditSpec and refreshes drawer state.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- Save flow (Group 7)', () => {
  it('Save calls the gateway manual-edit endpoint and refreshes from the DTO', async () => {
    mockManualEditSpec.mockResolvedValueOnce(makeReturnedRow());
    const onManualEditSaved = vi.fn();

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec()}
        projectId="p-1"
        editedBy="user-alice"
        onManualEditSaved={onManualEditSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '/agent-os:shape-spec\nedited text' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('mdd-story-drawer-save-button'));
    });

    await waitFor(() => {
      expect(mockManualEditSpec).toHaveBeenCalledWith(
        'p-1',
        'spec-1',
        '/agent-os:shape-spec\nedited text',
        'user-alice',
      );
    });

    await waitFor(() => {
      expect(onManualEditSaved).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByTestId('mdd-story-drawer-edited-indicator'),
    ).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Test 3: Prefix warning toast surfaces but the save still persists.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- prefix warning toast (Group 7)', () => {
  it('shows the toast when specText does not start with /agent-os:shape-spec, still persists', async () => {
    mockManualEditSpec.mockResolvedValueOnce(
      makeReturnedRow({
        generatedSpecText: 'not a shape-spec body',
      }),
    );

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec()}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'not a shape-spec body' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('mdd-story-drawer-save-button'));
    });

    await waitFor(() => {
      expect(mockManualEditSpec).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalled();
    });
    const lastCall =
      mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1];
    expect(lastCall[0]).toMatch(/agent-os:shape-spec/);
  });
});

// ----------------------------------------------------------------------------
// Test 4: Discard while dirty prompts the confirm dialog.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- Discard flow (Group 7)', () => {
  it('prompts window.confirm when dirty, reverts when confirmed', async () => {
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);
    try {
      render(
        <MigrationDeliveryStoryDrawer
          story={makeStory()}
          specGeneration={makeSpec()}
          projectId="p-1"
          editedBy="user-alice"
          onClose={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
      const textarea = screen.getByTestId(
        'mock-codemirror-textarea',
      ) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'dirty edit' } });

      fireEvent.click(screen.getByTestId('mdd-story-drawer-discard-button'));

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Discard/i),
      );
      await waitFor(() => {
        expect(
          screen.queryByTestId('mdd-story-drawer-spec-editor'),
        ).not.toBeInTheDocument();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });
});

// ----------------------------------------------------------------------------
// Test 5: Diff toggle visible only when previousSpecText is set.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- diff toggle (Group 7)', () => {
  it('does NOT render the toggle when previousSpecText is null', () => {
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec({ previousSpecText: null })}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId('mdd-story-drawer-previous-version-toggle'),
    ).not.toBeInTheDocument();
  });

  it('renders the toggle when previousSpecText is set and renders the diff on click', () => {
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec({
          previousSpecText: '/agent-os:shape-spec\noriginal text',
          generatedSpecText: '/agent-os:shape-spec\nnew text',
        })}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );
    const toggle = screen.getByTestId(
      'mdd-story-drawer-previous-version-toggle',
    );
    fireEvent.click(toggle);
    expect(
      screen.getByTestId('mdd-story-drawer-previous-version-diff'),
    ).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Test 6: Save failure keeps editor open + error banner shows.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- save failure (Group 7)', () => {
  it('keeps editor open and surfaces an inline error banner on failure', async () => {
    mockManualEditSpec.mockRejectedValueOnce(new Error('AMS 500'));

    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        specGeneration={makeSpec()}
        projectId="p-1"
        editedBy="user-alice"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mdd-story-drawer-mode-toggle'));
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '/agent-os:shape-spec\nedited text' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('mdd-story-drawer-save-button'));
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-story-drawer-save-error'),
      ).toHaveTextContent(/AMS 500/);
    });
    // Editor remains open after failure.
    expect(
      screen.getByTestId('mdd-story-drawer-spec-editor'),
    ).toBeInTheDocument();
  });
});
