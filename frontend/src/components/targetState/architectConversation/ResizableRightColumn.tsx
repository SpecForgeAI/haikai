/**
 * ResizableRightColumn
 *
 * Spec 2026-06-27-target-conversation-right-panel-ux (Spec A, Task Group 2):
 * a focused, RIGHT-anchored splitter for the inner `.layout` grid of the
 * Architect Conversation. The chat/left pane FLEXES (`minmax(0, 1fr)`); the
 * right column holds a FIXED, drag-adjustable px width.
 *
 * This is the INVERSE of `shared/ResizableSplitPane` (which fixes the LEFT
 * pane). Per the spec we deliberately do NOT generalise that component; we
 * instead REUSE the proven pieces:
 *   - drag maths mirrored from `common/RightHandPanelShell` (the overlay this
 *     conversation mounts in), computed here against the layout container's
 *     RIGHT edge via `getBoundingClientRect`;
 *   - keyboard-arrow a11y + window-resize re-clamp from `ResizableSplitPane`;
 *   - handle STYLING from `UnifiedChatPanel.module.css .resizeHandle`
 *     (replicated as `.rightColumnResizeHandle` in this module).
 *
 * Width is persisted in ONE machine-global localStorage key
 * (`architect-conversation.rightColumnWidth`), mirroring the
 * `readAutoSelectVersionPref` / `writeAutoSelectVersionPref` pattern in
 * `ConversationMainPane.tsx`. Desktop-only: the two columns stay side-by-side
 * at all widths (the clamp keeps the chat pane >= ~40%); there is NO responsive
 * stack-below breakpoint.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import styles from './ArchitectConversation.module.css';

/** Machine-global key (NOT per-project; the overlay's own key is separate). */
export const RIGHT_COLUMN_WIDTH_STORAGE_KEY =
  'architect-conversation.rightColumnWidth';

export const DEFAULT_RIGHT_COLUMN_WIDTH = 440;
export const MIN_RIGHT_COLUMN_WIDTH = 320;
/** Absolute px cap; the effective max also honours the 60%-of-layout ratio. */
const MAX_RIGHT_COLUMN_WIDTH_PX = 620;
/** The chat pane can never collapse below ~40% of the layout width. */
const MAX_RIGHT_COLUMN_WIDTH_RATIO = 0.6;

/**
 * Effective max width: `min(620px, 60% of the current layout width)`. When the
 * layout width is unknown (0, e.g. pre-measure / jsdom) we fall back to the
 * absolute px cap.
 */
export function computeMaxRightColumnWidth(layoutWidth: number): number {
  if (!layoutWidth || layoutWidth <= 0) return MAX_RIGHT_COLUMN_WIDTH_PX;
  return Math.min(MAX_RIGHT_COLUMN_WIDTH_PX, layoutWidth * MAX_RIGHT_COLUMN_WIDTH_RATIO);
}

/** Clamp a width to `[320, min(620, 60% layout)]`; min always wins on ties. */
export function clampRightColumnWidth(width: number, layoutWidth: number): number {
  const lo = MIN_RIGHT_COLUMN_WIDTH;
  const hi = Math.max(lo, computeMaxRightColumnWidth(layoutWidth));
  return Math.min(Math.max(width, lo), hi);
}

/**
 * Read the persisted width, try/catch-guarded, defaulting to 440 when absent or
 * blocked (mirrors `readAutoSelectVersionPref` in `ConversationMainPane.tsx`).
 */
export function readRightColumnWidth(): number {
  try {
    const raw = window.localStorage.getItem(RIGHT_COLUMN_WIDTH_STORAGE_KEY);
    if (raw === null) return DEFAULT_RIGHT_COLUMN_WIDTH;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return DEFAULT_RIGHT_COLUMN_WIDTH;
    return parsed;
  } catch {
    return DEFAULT_RIGHT_COLUMN_WIDTH;
  }
}

/** Write the width, try/catch-guarded (blocked storage is non-fatal). */
export function writeRightColumnWidth(width: number): void {
  try {
    window.localStorage.setItem(RIGHT_COLUMN_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Non-fatal: a blocked/absent localStorage just means the width is not
    // sticky this session; the in-session state still drives the layout.
  }
}

export interface ResizableRightColumnProps {
  /** The chat/left pane content (flexes to fill remaining space). */
  left: ReactNode;
  /** The right-column content (held at the fixed, adjustable width). */
  right: ReactNode;
}

export function ResizableRightColumn({ left, right }: ResizableRightColumnProps) {
  const layoutRef = useRef<HTMLDivElement>(null);
  // Tracks the measured layout width so the keyboard a11y `aria-valuemax`
  // reflects the live 60%-of-layout cap.
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [width, setWidth] = useState<number>(() => readRightColumnWidth());
  const [isDragging, setIsDragging] = useState(false);
  // Never persist the mount default; only widths the user actually chose (so a
  // future default change stays live until the user drags / arrows).
  const hasInteracted = useRef(false);

  // -- On mount: measure the layout + re-clamp the restored value -------------
  useEffect(() => {
    const measured = layoutRef.current?.getBoundingClientRect().width ?? 0;
    setLayoutWidth(measured);
    setWidth((cur) => clampRightColumnWidth(cur, measured));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Drag resize (right column is the fixed pane; compute vs RIGHT edge) -----
  const handleResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    hasInteracted.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Inverse of the overlay's left-edge drag: width grows as the pointer
      // moves toward the container's left edge.
      const next = rect.right - e.clientX;
      setLayoutWidth(rect.width);
      setWidth(clampRightColumnWidth(next, rect.width));
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // -- Persist on drag end (never the mount default) --------------------------
  useEffect(() => {
    if (isDragging) return;
    if (!hasInteracted.current) return;
    writeRightColumnWidth(width);
  }, [isDragging, width]);

  // -- Keyboard a11y: arrow + shift-arrow steps (reused from ResizableSplitPane)
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10;
      const measured = layoutRef.current?.getBoundingClientRect().width ?? layoutWidth;
      let next = width;
      switch (e.key) {
        case 'ArrowLeft':
          // Handle sits on the LEFT edge of the right column: moving it left
          // GROWS the right column.
          e.preventDefault();
          next = clampRightColumnWidth(width + step, measured);
          break;
        case 'ArrowRight':
          e.preventDefault();
          next = clampRightColumnWidth(width - step, measured);
          break;
        default:
          return;
      }
      hasInteracted.current = true;
      setWidth(next);
      writeRightColumnWidth(next);
    },
    [width, layoutWidth],
  );

  // -- Window-resize re-clamp (reused from ResizableSplitPane) -----------------
  useEffect(() => {
    const onResize = () => {
      const measured = layoutRef.current?.getBoundingClientRect().width ?? 0;
      setLayoutWidth(measured);
      setWidth((cur) => {
        const clamped = clampRightColumnWidth(cur, measured);
        if (clamped !== cur) writeRightColumnWidth(clamped);
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const ariaValueMax = Math.round(computeMaxRightColumnWidth(layoutWidth));

  return (
    <div
      ref={layoutRef}
      className={styles.layout}
      // The fixed track is driven by JS; the chat pane keeps `minmax(0, 1fr)`.
      style={{ gridTemplateColumns: `minmax(0, 1fr) ${width}px` }}
      data-testid="architect-conversation-layout"
    >
      {left}
      <div
        className={styles.rightColumn}
        data-testid="architect-conversation-right-column"
      >
        <div
          className={styles.rightColumnResizeHandle}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize right column"
          aria-valuenow={Math.round(width)}
          aria-valuemin={MIN_RIGHT_COLUMN_WIDTH}
          aria-valuemax={ariaValueMax}
          onMouseDown={handleResizeStart}
          onKeyDown={handleKeyDown}
          data-testid="architect-conversation-right-column-resize-handle"
        />
        {right}
      </div>
    </div>
  );
}
