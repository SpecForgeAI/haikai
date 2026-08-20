/**
 * BuildInfoModal (2026-08-20): renders the three build-identity rows from
 * getBuildInfo() (vite-injected constants; every field falls back to
 * 'unknown' rather than crashing), closes via the button and the overlay,
 * and renders nothing when hidden.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

import { BuildInfoModal } from './BuildInfoModal';
import { getBuildInfo } from '../../utils/buildInfo';

describe('BuildInfoModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not visible', () => {
    render(<BuildInfoModal visible={false} onClose={onClose} />);
    expect(screen.queryByTestId('build-info-modal')).toBeNull();
  });

  it('shows version, commit, and built-at rows (non-empty, never crashing)', () => {
    render(<BuildInfoModal visible={true} onClose={onClose} />);
    const info = getBuildInfo();
    expect(screen.getByTestId('build-info-version').textContent).toBe(info.version);
    expect(screen.getByTestId('build-info-commit').textContent).toBe(info.commit);
    expect(screen.getByTestId('build-info-built-at').textContent).toBe(info.builtAt);
    for (const value of [info.version, info.commit, info.builtAt]) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('closes via the Close button and via the overlay, but not via the dialog body', () => {
    render(<BuildInfoModal visible={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('build-info-modal'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('build-info-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('build-info-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
