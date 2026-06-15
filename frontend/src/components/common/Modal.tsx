import React from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>
        <div className={styles.content}>{children}</div>
        <div className={styles.footer}>
          <button className={styles.okButton} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  errors: string[];
  title?: string;
}

export function ErrorModal({ isOpen, onClose, errors, title = "Validation Errors" }: ErrorModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className={styles.errorList}>
        {errors.length === 1 ? (
          <p className={styles.singleError}>{errors[0]}</p>
        ) : (
          <>
            <p className={styles.errorSummary}>
              Cannot complete operation: {errors.length} validation errors found:
            </p>
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
