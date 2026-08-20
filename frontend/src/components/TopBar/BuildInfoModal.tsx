/**
 * BuildInfoModal (2026-08-20): the Product -> Info modal.
 *
 * Small read-only dialog showing the tool's build identity — version
 * (repo-root VERSION file), repo commit id, and when this frontend was
 * built / started — all injected at build time via vite `define`
 * (src/utils/buildInfo.ts). Closes on the button, the overlay, or Escape.
 */

import React, { useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { getBuildInfo } from '../../utils/buildInfo';

export interface BuildInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '16px 20px',
  minWidth: 320,
  maxWidth: 420,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  padding: '4px 0',
};

const keyStyle: React.CSSProperties = { color: '#555' };

export const BuildInfoModal: React.FC<BuildInfoModalProps> = ({ visible, onClose }) => {
  const info = useMemo(() => getBuildInfo(), []);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  const modal = (
    <div
      style={overlayStyle}
      onClick={onClose}
      data-testid="build-info-overlay"
    >
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Build info"
        data-testid="build-info-modal"
      >
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Haikai — build info</h2>
        <div style={rowStyle}>
          <span style={keyStyle}>Build version</span>
          <code data-testid="build-info-version">{info.version}</code>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Repo commit id</span>
          <code data-testid="build-info-commit">{info.commit}</code>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Frontend built / started</span>
          <code data-testid="build-info-built-at">{info.builtAt}</code>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onClose} data-testid="build-info-close">
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
};

export default BuildInfoModal;
