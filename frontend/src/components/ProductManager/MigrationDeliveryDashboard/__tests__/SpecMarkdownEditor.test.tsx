/**
 * SpecMarkdownEditor tests
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 6.1.
 *
 * The component under test is a thin wrapper around CodeMirror 6 via
 * `@uiw/react-codemirror`. Real CodeMirror is heavy to spin up in jsdom and
 * does not register keymap-bound shortcuts against synthetic events the way
 * `@testing-library/user-event` dispatches them, so this suite mocks
 * `@uiw/react-codemirror` with a plain `<textarea>` that forwards `onChange`
 * and `readOnly` faithfully. The `@codemirror/lang-markdown` and
 * `@codemirror/view` re-exports we depend on are stubbed equally lightly --
 * the test only cares about the wiring, not CodeMirror internals.
 *
 * Coverage:
 *   - Editor renders with the seeded initial value.
 *   - Typing changes the rendered text and emits `onDirtyChange(true)`.
 *   - Cmd/Ctrl+S triggers `onSave` with the current buffered text and
 *     `preventDefault`s the browser-native save dialog.
 *   - Reverting back to the initial value emits `onDirtyChange(false)`.
 *   - `disabled=true` blocks typing and reports `data-disabled="true"`.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ----------------------------------------------------------------------------
// Mocks (must run before the component import).
// ----------------------------------------------------------------------------

// Replace `@uiw/react-codemirror` with a controlled <textarea>. The forwarded
// props (`value`, `onChange`, `readOnly`) are the only ones the wrapper
// passes that need to behave realistically for the tests below.
//
// We use the async factory shape so we can `await import('react')` -- a
// top-level `require` would fail TypeScript's strict mode (no @types/node).
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
  keymap: {
    of: (_bindings: unknown) => ({ __marker: 'keymap-extension' }),
  },
}));

import SpecMarkdownEditor, {
  isSaveShortcut,
  type SpecMarkdownEditorHandle,
} from '../SpecMarkdownEditor';

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('SpecMarkdownEditor -- initial render', () => {
  it('renders the seeded initial value in the editor', () => {
    const seed = '/agent-os:shape-spec\nhello world';
    render(
      <SpecMarkdownEditor
        initialValue={seed}
        onSave={vi.fn()}
      />,
    );
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(seed);

    // Wrapper exposes the dirty + disabled data attributes for parent CSS.
    const wrapper = screen.getByTestId('spec-markdown-editor');
    expect(wrapper.getAttribute('data-dirty')).toBe('false');
    expect(wrapper.getAttribute('data-disabled')).toBe('false');
  });
});

describe('SpecMarkdownEditor -- dirty tracking', () => {
  it('emits onDirtyChange(true) on the first keystroke that diverges from initialValue', () => {
    const onDirtyChange = vi.fn();
    render(
      <SpecMarkdownEditor
        initialValue="hello"
        onSave={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'hello!' } });

    // Exactly one transition false -> true should fire.
    const trueCalls = onDirtyChange.mock.calls.filter(
      (call: unknown[]) => call[0] === true,
    );
    expect(trueCalls.length).toBe(1);

    const wrapper = screen.getByTestId('spec-markdown-editor');
    expect(wrapper.getAttribute('data-dirty')).toBe('true');
    expect(textarea.value).toBe('hello!');
  });

  it('emits onDirtyChange(false) when the buffer is reverted to the initial value', () => {
    const onDirtyChange = vi.fn();
    render(
      <SpecMarkdownEditor
        initialValue="hello"
        onSave={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;

    // Dirty the buffer, then revert.
    fireEvent.change(textarea, { target: { value: 'hello!' } });
    fireEvent.change(textarea, { target: { value: 'hello' } });

    // Last call should report clean again.
    const lastCall = onDirtyChange.mock.calls[onDirtyChange.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBe(false);

    const wrapper = screen.getByTestId('spec-markdown-editor');
    expect(wrapper.getAttribute('data-dirty')).toBe('false');
  });
});

describe('SpecMarkdownEditor -- save shortcut', () => {
  it('Cmd+S calls onSave with the current buffered text and preventDefault is set', () => {
    const onSave = vi.fn();
    render(
      <SpecMarkdownEditor
        initialValue="hello"
        onSave={onSave}
      />,
    );
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;

    // Type some new text first so we can verify onSave receives it.
    fireEvent.change(textarea, { target: { value: 'edited text' } });

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    });
    // Dispatch on the wrapper so the capture-phase handler fires.
    const wrapper = screen.getByTestId('spec-markdown-editor');
    wrapper.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('edited text');
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+S (Linux/Windows shortcut) also triggers onSave', () => {
    const onSave = vi.fn();
    render(
      <SpecMarkdownEditor
        initialValue="seed"
        onSave={onSave}
      />,
    );

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      metaKey: false,
      bubbles: true,
      cancelable: true,
    });
    const wrapper = screen.getByTestId('spec-markdown-editor');
    wrapper.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('seed');
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('SpecMarkdownEditor -- disabled mode', () => {
  it('prevents typing and renders the disabled data attribute', () => {
    const onDirtyChange = vi.fn();
    render(
      <SpecMarkdownEditor
        initialValue="locked"
        onSave={vi.fn()}
        onDirtyChange={onDirtyChange}
        disabled
      />,
    );
    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;

    expect(textarea.readOnly).toBe(true);

    // Attempt a programmatic change anyway. The wrapper's onChange short-
    // circuits when `disabled` so the buffer stays put and no dirty event
    // fires.
    fireEvent.change(textarea, { target: { value: 'attempted edit' } });

    // The mocked textarea is controlled by the wrapper's `value` prop, so it
    // should snap back to the un-mutated buffer after the no-op onChange.
    expect(textarea.value).toBe('locked');
    expect(onDirtyChange).not.toHaveBeenCalled();

    const wrapper = screen.getByTestId('spec-markdown-editor');
    expect(wrapper.getAttribute('data-disabled')).toBe('true');
  });
});

describe('SpecMarkdownEditor -- imperative handle', () => {
  it('exposes a getValue() that returns the current buffered text', () => {
    const handleRef = React.createRef<SpecMarkdownEditorHandle>();
    render(
      <SpecMarkdownEditor
        ref={handleRef}
        initialValue="alpha"
        onSave={vi.fn()}
      />,
    );

    const textarea = screen.getByTestId(
      'mock-codemirror-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'beta' } });

    expect(handleRef.current?.getValue()).toBe('beta');
  });
});

describe('isSaveShortcut helper', () => {
  it('returns true for Cmd+S and Ctrl+S, false for everything else', () => {
    expect(isSaveShortcut({ key: 's', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSaveShortcut({ key: 's', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSaveShortcut({ key: 'S', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSaveShortcut({ key: 's', metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSaveShortcut({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false);
  });
});
