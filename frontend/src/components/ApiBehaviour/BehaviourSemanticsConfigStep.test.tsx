/**
 * BehaviourSemanticsConfigStep tests
 *
 * Spec: 2026-06-23 Semantics-aware API Behaviour Baseline coverage -- Task
 * Group 5 (5.1a). Mirrors the presentational-step test approach used for
 * `DataTypeFormatsStep` (via StartCaptureSessionWizard.dataTypeFormats.test.tsx):
 * the step owns no I/O, so it is exercised directly with `{ value, onChange }`.
 *
 * Coverage (focused):
 *   - renders the editable DEFAULT markers (seeded from DEFAULT_*_MARKERS) for
 *     an untouched (null) config;
 *   - renders the `fiveXxIsBadInput` control and fires `onChange` when ticked;
 *   - the explicit "(use built-in defaults)" sentinel is distinct from an
 *     untouched config (it records the sentinel on the marker fields) and fires
 *     `onChange`;
 *   - editing a marker list (remove) fires `onChange` with a concrete config.
 *
 * CSS modules: the step takes its `styles` object as a prop (file-scoped CSS
 * modules), so we pass an identity Proxy -- the same idiom existing tests use
 * to mock `*.module.css` imports.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BehaviourSemanticsConfigStep } from './BehaviourSemanticsConfigStep';
import {
  DEFAULT_NOT_FOUND_MARKERS,
  DEFAULT_BAD_REQUEST_MARKERS,
  USE_BUILT_IN_DEFAULTS,
  type ResponseSemanticsConfig,
} from './behaviourSemanticsConfig';

// Identity Proxy stands in for the wizard's CSS-module styles object.
const styles = new Proxy(
  {},
  { get: (_t: object, p: string | symbol) => String(p) },
) as Record<string, string>;

function renderStep(value: ResponseSemanticsConfig | null = null) {
  const onChange = vi.fn();
  render(
    <BehaviourSemanticsConfigStep value={value} onChange={onChange} styles={styles} />,
  );
  return { onChange };
}

describe('BehaviourSemanticsConfigStep -- defaults + sentinel + onChange (Task 5.1a)', () => {
  it('renders the editable default markers seeded from DEFAULT_*_MARKERS for an untouched config', () => {
    renderStep(null);

    // Every built-in not_found marker is shown as a removable item.
    for (const m of DEFAULT_NOT_FOUND_MARKERS) {
      expect(
        screen.getByTestId(`behaviour-semantics-not-found-item-${m}`),
      ).toBeInTheDocument();
    }
    // Every built-in bad_request marker is shown as a removable item.
    for (const m of DEFAULT_BAD_REQUEST_MARKERS) {
      expect(
        screen.getByTestId(`behaviour-semantics-bad-request-item-${m}`),
      ).toBeInTheDocument();
    }

    // The fiveXxIsBadInput control renders, unchecked by default (safe default).
    const fiveXx = screen.getByTestId(
      'behaviour-semantics-five-xx',
    ) as HTMLInputElement;
    expect(fiveXx).toBeInTheDocument();
    expect(fiveXx.checked).toBe(false);

    // The "(use built-in defaults)" sentinel control renders, NOT ticked for an
    // untouched config (untouched != explicitly-default).
    const sentinel = screen.getByTestId(
      'behaviour-semantics-use-defaults',
    ) as HTMLInputElement;
    expect(sentinel).toBeInTheDocument();
    expect(sentinel.checked).toBe(false);
    expect(
      screen.queryByTestId('behaviour-semantics-use-defaults-hint'),
    ).not.toBeInTheDocument();
  });

  it('fires onChange with fiveXxIsBadInput when the 5xx control is ticked', () => {
    const { onChange } = renderStep(null);

    fireEvent.click(screen.getByTestId('behaviour-semantics-five-xx'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ fiveXxIsBadInput: true }),
    );
  });

  it('records the "(use built-in defaults)" sentinel distinct from untouched, and fires onChange', () => {
    const { onChange } = renderStep(null);

    // Ticking the sentinel emits a config carrying the USE_BUILT_IN_DEFAULTS
    // sentinel on BOTH marker fields -- a deliberate "use defaults" choice, NOT
    // the null (untouched) value.
    fireEvent.click(screen.getByTestId('behaviour-semantics-use-defaults'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as ResponseSemanticsConfig | null;
    expect(emitted).not.toBeNull();
    expect(emitted?.notFoundMarkers).toBe(USE_BUILT_IN_DEFAULTS);
    expect(emitted?.badRequestMarkers).toBe(USE_BUILT_IN_DEFAULTS);
  });

  it('shows the sentinel as ticked + a hint when value already holds the sentinel (distinct from untouched)', () => {
    renderStep({
      notFoundMarkers: USE_BUILT_IN_DEFAULTS,
      badRequestMarkers: USE_BUILT_IN_DEFAULTS,
    });

    const sentinel = screen.getByTestId(
      'behaviour-semantics-use-defaults',
    ) as HTMLInputElement;
    expect(sentinel.checked).toBe(true);
    expect(
      screen.getByTestId('behaviour-semantics-use-defaults-hint'),
    ).toBeInTheDocument();
    // The marker add inputs are disabled while explicitly-default.
    expect(
      screen.getByTestId('behaviour-semantics-not-found-add-input'),
    ).toBeDisabled();
  });

  it('fires onChange with a concrete config when a default marker is removed', () => {
    const { onChange } = renderStep(null);

    const removed = DEFAULT_NOT_FOUND_MARKERS[0];
    fireEvent.click(
      screen.getByTestId(`behaviour-semantics-not-found-remove-${removed}`),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as ResponseSemanticsConfig | null;
    expect(emitted).not.toBeNull();
    // A removal makes the list differ from the defaults => a `replace` override
    // carrying the remaining markers (and NOT the removed one).
    expect(emitted?.notFoundMarkers).toEqual({
      mode: 'replace',
      markers: DEFAULT_NOT_FOUND_MARKERS.filter((m) => m !== removed),
    });
  });
});
