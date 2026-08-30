/**
 * RightHandPanelShell
 *
 * A right-hand-side panel shell that mirrors the tool's standard chat panel
 * (`UnifiedChatPanel`) chrome -- a persona + room header, collapse-to-tab, and
 * a left-edge drag-resize handle with per-panel `localStorage` persistence --
 * while hosting arbitrary structured content (here: the Architect Conversation).
 *
 * Approach (per the user's "A" choice): REUSE `UnifiedChatPanel.module.css`
 * for a pixel-identical look and REPLICATE the ~80 lines of chrome behaviour,
 * WITHOUT coupling to the heavy `UnifiedChatPanel` component (which is hardwired
 * to free-form `ChatThread` content driven by `useChatThread`). The structured
 * conversation content stays separate -- it can't be expressed as a free-chat
 * thread -- so only the shell is shared, by styling + behaviour.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { MessageSquare, PanelRightClose, X } from 'lucide-react';

import { getPersonaConfig } from '../../config/personaConfig';
import panelStyles from '../UnifiedChat/UnifiedChatPanel.module.css';

// The hosted content (the Architect Conversation) has a two-column body, so the
// panel opens WIDE -- half the viewport -- and can be dragged anywhere from 320px
// up to 80% of the viewport to tune it.
const MIN_WIDTH = 320;
const DEFAULT_WIDTH_PERCENT = 0.5;
const MAX_WIDTH_PERCENT = 0.8;

function maxWidth(): number {
  return window.innerWidth * MAX_WIDTH_PERCENT;
}

function readWidth(key: string): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_WIDTH) return parsed;
    }
  } catch {
    /* ignore localStorage errors (SSR / private browsing) */
  }
  return Math.round(window.innerWidth * DEFAULT_WIDTH_PERCENT);
}

function readCollapsed(key: string, defaultOpen: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored === 'true';
  } catch {
    /* ignore */
  }
  return !defaultOpen;
}

/**
 * An extra icon-only action rendered in the header BEFORE the collapse/close
 * pair (2026-08-30 Architect Conversation declutter: the Export-transcript
 * icon). Rendered with the same chrome class as the built-in header icons so
 * the trio reads as one group: [extras…][collapse][close].
 */
export interface RightHandPanelHeaderAction {
  key: string;
  icon: ReactNode;
  /** Accessible name; also the hover title. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

export interface RightHandPanelShellProps {
  /** Stable key for per-panel width/collapse persistence (e.g. the project id). */
  storageKey: string;
  /** Persona id for the header indicator (e.g. 'architect'). */
  personaId: string;
  /** Room name shown in the header (e.g. the target architecture name). */
  roomName: string;
  /** Short label for the collapsed vertical tab. */
  collapsedLabel?: string;
  /** Whether the panel starts expanded (default true). */
  defaultOpen?: boolean;
  /** Fired when the user fully closes the panel via the header close (✕). */
  onClose: () => void;
  /** Extra icon-only header actions, rendered before the collapse button. */
  extraHeaderActions?: RightHandPanelHeaderAction[];
  /**
   * Overflow behaviour for the content wrapper hosting `children`. Defaults to
   * 'auto' (the wrapper scrolls, the long-standing behaviour Discovery relies
   * on). The Architect Conversation passes 'hidden' so its inner height chain
   * resolves and ONLY its transcript scrolls (Spec 2026-06-27, Task Group 3).
   */
  contentOverflow?: 'auto' | 'hidden';
  children: ReactNode;
}

export function RightHandPanelShell({
  storageKey,
  personaId,
  roomName,
  collapsedLabel = 'Chat',
  defaultOpen = true,
  onClose,
  extraHeaderActions,
  contentOverflow = 'auto',
  children,
}: RightHandPanelShellProps) {
  // Versioned (-2) so the new 50%-of-viewport default supersedes any width a
  // user persisted under the previous fixed-px (600) default.
  const widthKey = `rhs-panel-width-2:${storageKey}`;
  const collapsedKey = `rhs-panel-collapsed:${storageKey}`;

  const [width, setWidth] = useState<number>(() => readWidth(widthKey));
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() =>
    readCollapsed(collapsedKey, defaultOpen),
  );
  const isResizing = useRef(false);
  // Tracks whether the user has actually dragged the handle, so the DEFAULT
  // width is never persisted on mount (which would lock a stale default in for
  // everyone and stop future default changes from taking effect).
  const hasResized = useRef(false);

  const persona = getPersonaConfig(personaId);

  // -- Collapse/expand toggle (persisted) -----------------------------------
  const handleToggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(collapsedKey, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [collapsedKey]);

  // -- Left-edge drag resize (panel is right-anchored) ----------------------
  const handleResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    hasResized.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(maxWidth(), newWidth)));
    };
    const onUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // -- Persist width, but only one the user actually chose (never the mount
  //    default, so the default stays live until the user drags) ------------
  useEffect(() => {
    if (!hasResized.current) return;
    try {
      localStorage.setItem(widthKey, String(width));
    } catch {
      /* ignore */
    }
  }, [width, widthKey]);

  // -- Collapsed state: the 32px right-edge tab -----------------------------
  if (isCollapsed) {
    return (
      <div
        className={panelStyles.collapsedTab}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleToggle()}
        aria-label="Open panel"
        data-testid="rhs-panel-collapsed"
      >
        <MessageSquare size={20} className={panelStyles.chatIcon} />
        <span className={panelStyles.tabLabel}>{collapsedLabel}</span>
      </div>
    );
  }

  // -- Expanded panel -------------------------------------------------------
  return (
    <div
      className={panelStyles.panel}
      style={{ width: `${width}px` }}
      data-testid="rhs-panel"
    >
      {/* Left-edge resize handle */}
      <div
        className={panelStyles.resizeHandle}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        data-testid="rhs-panel-resize-handle"
      />

      {/* Header: persona + room, styled like the standard chat panel */}
      <div className={panelStyles.header} data-testid="rhs-panel-header">
        <div className={panelStyles.headerLeft}>
          <span className={panelStyles.headerTitle}>Chat</span>
          <span className={panelStyles.headerSeparator}>&ndash;</span>
          <div className={panelStyles.headerSection} data-testid="rhs-panel-room">
            <span className={panelStyles.headerLabel}>Room:</span>
            <span className={panelStyles.headerPersonaName}>{roomName}</span>
          </div>
          <span className={panelStyles.headerSeparator}>&ndash;</span>
          <div className={panelStyles.headerSection} data-testid="rhs-panel-persona">
            <span className={panelStyles.headerLabel}>In:</span>
            <div
              className={panelStyles.personaIndicator}
              style={{ backgroundColor: persona.color }}
              title={persona.displayName}
              data-testid="rhs-panel-persona-indicator"
            >
              {persona.initials}
            </div>
            <span className={panelStyles.headerPersonaName}>{persona.displayName}</span>
          </div>
        </div>
        <div className={panelStyles.headerActions}>
          {(extraHeaderActions ?? []).map((action) => (
            <button
              key={action.key}
              type="button"
              className={panelStyles.collapseButton}
              onClick={action.onClick}
              disabled={action.disabled}
              aria-label={action.label}
              title={action.label}
              style={action.disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
              data-testid={action.testId}
            >
              {action.icon}
            </button>
          ))}
          <button
            type="button"
            className={panelStyles.collapseButton}
            onClick={handleToggle}
            aria-label="Collapse panel"
            data-testid="rhs-panel-collapse-button"
          >
            <PanelRightClose size={20} />
          </button>
          <button
            type="button"
            className={panelStyles.collapseButton}
            onClick={onClose}
            aria-label="Close panel"
            data-testid="rhs-panel-close-button"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content -- the hosted structured conversation manages its own layout.
          The overflow is caller-controlled: Discovery keeps the default 'auto'
          (this wrapper scrolls); the Architect Conversation passes 'hidden' so
          its bounded inner height chain makes ONLY its transcript scroll. */}
      <div
        style={{ flex: 1, minHeight: 0, overflow: contentOverflow }}
        data-testid="rhs-panel-content"
      >
        {children}
      </div>
    </div>
  );
}
