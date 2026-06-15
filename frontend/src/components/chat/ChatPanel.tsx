import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../api/chatApi';
import { postChatMessage } from '../../api/chatApi';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import styles from './ChatPanel.module.css';

/**
 * ChatPanel component provides a collapsible, resizable chat assistant panel.
 * Features:
 * - Collapsed state: slim vertical tab with chat icon
 * - Expanded state: full panel with message list and input
 * - Resizable via drag handle on right edge (horizontal)
 * - Resizable input area via drag handle above input (vertical)
 * - Session management for chat continuity
 */
export function ChatPanel() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [width, setWidth] = useState(320);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputHeight, setInputHeight] = useState(100);

  const isResizing = useRef(false);
  const isResizingInput = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Generate a unique ID for messages
  const generateMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Handle collapse/expand toggle
  const handleToggle = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  // Handle sending a message
  const handleSend = useCallback(async (content: string) => {
    // Add user message immediately
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await postChatMessage({
        sessionId: sessionId ?? undefined,
        message: content,
      });

      // Store session ID if this is the first response
      if (!sessionId) {
        setSessionId(response.sessionId);
      }

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: response.assistant.message,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);

      // Add error message as assistant message for visibility
      const errorChatMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorChatMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Handle horizontal resize start (panel width)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Handle vertical resize start (input height)
  const handleInputResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingInput.current = true;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Handle resize move and end for both horizontal and vertical resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Handle horizontal (width) resize
      if (isResizing.current && panelRef.current) {
        const panelRect = panelRef.current.getBoundingClientRect();
        const newWidth = e.clientX - panelRect.left;

        // Enforce min (240px) and max (50% viewport) constraints
        const minWidth = 240;
        const maxWidth = window.innerWidth * 0.5;
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        setWidth(clampedWidth);
      }

      // Handle vertical (input height) resize
      if (isResizingInput.current && panelRef.current) {
        const panelRect = panelRef.current.getBoundingClientRect();
        // Calculate new height based on distance from bottom of panel to mouse Y
        const newHeight = panelRect.bottom - e.clientY;

        // Enforce min (60px) and max (half panel height) constraints
        const minHeight = 60;
        const maxHeight = panelRect.height * 0.5;
        const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

        setInputHeight(clampedHeight);
      }
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (isResizingInput.current) {
        isResizingInput.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Render collapsed tab
  if (isCollapsed) {
    return (
      <div
        className={styles.collapsedTab}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleToggle()}
        aria-label="Open chat panel"
      >
        <svg
          className={styles.chatIcon}
          viewBox="0 0 24 24"
          fill="currentColor"
          width="20"
          height="20"
        >
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
        </svg>
        <span className={styles.tabLabel}>Chat</span>
      </div>
    );
  }

  // Render expanded panel
  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ width: `${width}px` }}
    >
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Chat Assistant</span>
        <button
          className={styles.collapseButton}
          onClick={handleToggle}
          aria-label="Collapse chat panel"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
        </button>
      </div>

      {/* Message List */}
      <ChatMessageList messages={messages} />

      {/* Error Display */}
      {error && (
        <div className={styles.errorBanner}>
          {error}
        </div>
      )}

      {/* Input Area Drag Handle */}
      <div
        className={styles.inputDragHandle}
        onMouseDown={handleInputResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize input area"
      />

      {/* Input Area */}
      <ChatInput onSend={handleSend} disabled={isLoading} height={inputHeight} />

      {/* Resize Handle (horizontal - panel width) */}
      <div
        className={styles.resizeHandle}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
      />
    </div>
  );
}
