import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { IncrementStatus } from './ImplementationAssistantPanel';
import styles from './IncrementContextMenu.module.css';

export interface IncrementContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  status: IncrementStatus | undefined;
  onClose: () => void;
  onSeeSpec: () => void;
  onMarkComplete: () => void;
}

export function IncrementContextMenu({
  isOpen,
  position,
  status,
  onClose,
  onSeeSpec,
  onMarkComplete,
}: IncrementContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const specNotReady = !status || status === 'NOT_STARTED';

  const adjustedPosition = {
    x: Math.min(position.x, window.innerWidth - 200),
    y: Math.min(position.y, window.innerHeight - 60),
  };

  const handleClick = () => {
    if (!specNotReady) {
      onSeeSpec();
      onClose();
    }
  };

  const isCompleted = status === 'COMPLETED';

  const handleMarkComplete = () => {
    if (!isCompleted) {
      onMarkComplete();
      onClose();
    }
  };

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <button
        className={specNotReady ? styles.menuItemDisabled : styles.menuItem}
        onClick={handleClick}
        disabled={specNotReady}
      >
        {specNotReady ? 'Spec not ready' : 'See Spec'}
      </button>
      <button
        className={isCompleted ? styles.menuItemDisabled : styles.menuItem}
        onClick={handleMarkComplete}
        disabled={isCompleted}
      >
        Mark As Complete
      </button>
    </div>,
    document.body
  );
}
