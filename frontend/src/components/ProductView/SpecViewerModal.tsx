import { useState } from 'react';
import styles from './SpecViewerModal.module.css';

export interface SpecViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  workItemName: string;
  specText: string;
}

export function SpecViewerModal({
  isOpen,
  onClose,
  workItemName,
  specText,
}: SpecViewerModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(specText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = specText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Spec for {workItemName}</span>
        </div>
        <div className={styles.body}>
          <pre className={styles.specText}>{specText}</pre>
        </div>
        <div className={styles.footer}>
          <button className={styles.copyButton} onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
