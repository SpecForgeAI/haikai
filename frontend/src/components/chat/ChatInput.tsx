import { useState, useCallback, KeyboardEvent } from 'react';
import styles from './ChatInput.module.css';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  height?: number;
}

/**
 * ChatInput component provides a textarea and send button for composing messages.
 * The send button is disabled when the textarea is empty or contains only whitespace.
 * The height of the container can be controlled via the height prop.
 */
export function ChatInput({ onSend, disabled = false, height }: ChatInputProps) {
  const [message, setMessage] = useState('');

  const trimmedMessage = message.trim();
  const canSend = trimmedMessage.length > 0 && !disabled;

  const handleSend = useCallback(() => {
    if (canSend) {
      onSend(trimmedMessage);
      setMessage('');
    }
  }, [canSend, trimmedMessage, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div
      className={styles.container}
      style={{ height: height ? `${height}px` : undefined }}
    >
      <textarea
        className={styles.textarea}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        aria-label="Chat message input"
      />
      <div className={styles.buttonRow}>
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </div>
  );
}
