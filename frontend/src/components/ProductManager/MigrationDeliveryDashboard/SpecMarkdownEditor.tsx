/**
 * SpecMarkdownEditor
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 6.
 *
 * Reusable wrapper around `@uiw/react-codemirror` for editing a shape-spec
 * Markdown body inside the story drawer. Owns the buffered text so the parent
 * only has to react to dirty-state transitions (`onDirtyChange`) and explicit
 * save events (`onSave`).
 *
 * Behaviour:
 *   - Initial render seeds the buffer from `initialValue`. If `initialValue`
 *     later changes (e.g. drawer reloads after a successful save), the buffer
 *     re-seeds and the editor drops back to "clean".
 *   - User keystrokes update the buffer and flip dirty state on transitions
 *     across the `value !== initialValue` boundary. The parent receives only
 *     the transitions through `onDirtyChange`, not every keystroke.
 *   - Cmd/Ctrl+S calls `onSave(currentValue)` and `preventDefault`s the
 *     browser's Save Page dialog. The shortcut is wired in two places:
 *       1. A CodeMirror keymap extension (the real path while the editor has
 *          focus in a browser).
 *       2. A capture-phase `onKeyDown` handler on the wrapper element. This
 *          covers the case where the test environment cannot dispatch through
 *          CodeMirror's internal key handling and where the shortcut is
 *          pressed while the wrapper has focus but the inner editor does not
 *          (e.g. immediately after a programmatic `getValue()` call).
 *   - `disabled` flips the editor into `readOnly` and stops the local
 *     `onChange` callback from updating the buffer, preventing typing.
 *
 * The parent owns the save lifecycle (Save / Saving... / Saved indicators)
 * and the discard-confirmation dialog. This component intentionally has no
 * idea about the network round-trip or the surrounding drawer state.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import CodeMirror, {
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { keymap } from '@codemirror/view';

// ============================================================================
// Public types
// ============================================================================

/**
 * Imperative handle exposed via `ref`. Parents that need the live buffer
 * outside of an `onSave` callback (for example to inspect the current text
 * before opening a confirmation dialog) can use this.
 */
export interface SpecMarkdownEditorHandle {
  /** Returns the current buffered text. */
  getValue: () => string;
}

export interface SpecMarkdownEditorProps {
  /** Seed text for the buffer. Re-seeds the buffer when this reference changes. */
  initialValue: string;
  /** Called by the Cmd/Ctrl+S shortcut with the current buffered text. */
  onSave: (currentValue: string) => void | Promise<void>;
  /** Fired on transitions of `value !== initialValue` (not every keystroke). */
  onDirtyChange?: (isDirty: boolean) => void;
  /** When true, the editor is read-only and typing is suppressed. */
  disabled?: boolean;
  /** Optional test id override. The wrapper element exposes `data-testid={testId}`. */
  testId?: string;
}

// ============================================================================
// Helper: detect the platform-correct save shortcut
// ============================================================================

/**
 * Returns true when the keyboard event represents the Save shortcut
 * (Cmd+S on macOS, Ctrl+S elsewhere). Exported for direct unit-test use.
 */
export function isSaveShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  if (event.key.toLowerCase() !== 's') return false;
  return event.metaKey || event.ctrlKey;
}

// ============================================================================
// Component
// ============================================================================

const SpecMarkdownEditor = forwardRef<
  SpecMarkdownEditorHandle,
  SpecMarkdownEditorProps
>(function SpecMarkdownEditor(
  { initialValue, onSave, onDirtyChange, disabled, testId },
  ref,
) {
  const [value, setValue] = useState<string>(initialValue);
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  // ---- Re-seed buffer when the parent's `initialValue` reference changes ---
  // We deliberately key off identity, not deep equality, so the parent can
  // force a re-seed (e.g. after a successful save replaces the row) by passing
  // a fresh string.
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  // ---- Dirty-state transition tracking ----
  const previousDirtyRef = useRef<boolean>(false);
  useEffect(() => {
    const nextDirty = value !== initialValue;
    if (nextDirty !== previousDirtyRef.current) {
      previousDirtyRef.current = nextDirty;
      if (onDirtyChange) onDirtyChange(nextDirty);
    }
  }, [value, initialValue, onDirtyChange]);

  // ---- Imperative handle ----
  // Keep a ref to the live value so `getValue()` always returns the latest
  // buffered text rather than a stale closure capture.
  const liveValueRef = useRef<string>(value);
  liveValueRef.current = value;
  useImperativeHandle(
    ref,
    () => ({
      getValue: () => liveValueRef.current,
    }),
    [],
  );

  // ---- Save shortcut (CodeMirror keymap path) ----
  // Bind Mod-s (Cmd-s on macOS, Ctrl-s elsewhere) inside the editor itself so
  // the shortcut fires while focus is in the textarea-equivalent. Returning
  // `true` tells CodeMirror we handled it; the wrapped DOM event's
  // `preventDefault()` is invoked by the keymap machinery.
  const handleSaveCommand = useCallback((): boolean => {
    onSave(liveValueRef.current);
    return true;
  }, [onSave]);

  const extensions = useMemo(
    () => [
      markdown(),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => handleSaveCommand(),
          preventDefault: true,
        },
      ]),
    ],
    [handleSaveCommand],
  );

  // ---- Save shortcut (wrapper fallback path) ----
  // Captures Cmd/Ctrl+S that reaches the wrapper element. This is a belt-and-
  // braces handler for test environments + edge cases where the inner editor
  // is not the active focus target.
  const handleWrapperKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isSaveShortcut(event)) {
        event.preventDefault();
        // Stop propagation so a global hotkey listener does not double-fire.
        event.stopPropagation();
        onSave(liveValueRef.current);
      }
    },
    [onSave],
  );

  // ---- onChange (suppressed when disabled) ----
  const handleEditorChange = useCallback(
    (next: string) => {
      if (disabled) return;
      setValue(next);
    },
    [disabled],
  );

  const resolvedTestId = testId ?? 'spec-markdown-editor';

  return (
    <div
      data-testid={resolvedTestId}
      data-dirty={value !== initialValue ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      onKeyDownCapture={handleWrapperKeyDown}
    >
      <CodeMirror
        ref={cmRef}
        value={value}
        readOnly={disabled === true}
        editable={disabled !== true}
        extensions={extensions}
        onChange={handleEditorChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: true,
        }}
        theme="light"
      />
    </div>
  );
});

export default SpecMarkdownEditor;
