/**
 * Spec 2026-06-27-target-conversation-right-panel-ux (Spec A, Task Group 2).
 * Focused tests for the right-anchored splitter + width persistence:
 *  - default 440px when no localStorage value is present;
 *  - clamp to min 320 and to max `min(620, 60% of layout width)`;
 *  - arrow / shift-arrow keyboard steps adjust `aria-valuenow` and clamp;
 *  - the read/write helpers use the machine-global key and are try/catch-guarded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ResizableRightColumn,
  readRightColumnWidth,
  writeRightColumnWidth,
  clampRightColumnWidth,
  RIGHT_COLUMN_WIDTH_STORAGE_KEY,
  DEFAULT_RIGHT_COLUMN_WIDTH,
  MIN_RIGHT_COLUMN_WIDTH,
} from '../ResizableRightColumn';

function renderColumn() {
  return render(
    <ResizableRightColumn
      left={<div data-testid="left-pane">chat</div>}
      right={<div data-testid="right-content">panels</div>}
    />,
  );
}

function handle() {
  return screen.getByTestId('architect-conversation-right-column-resize-handle');
}

function layoutStyle() {
  return (screen.getByTestId('architect-conversation-layout') as HTMLElement).style
    .gridTemplateColumns;
}

/** Force a deterministic layout width for the drag/clamp maths. */
function mockLayoutWidth(width: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 600,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('ResizableRightColumn', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to 440px when no localStorage value is present', () => {
    renderColumn();
    expect(layoutStyle()).toContain(`${DEFAULT_RIGHT_COLUMN_WIDTH}px`);
    expect(handle()).toHaveAttribute('aria-valuenow', String(DEFAULT_RIGHT_COLUMN_WIDTH));
    expect(handle()).toHaveAttribute('aria-valuemin', String(MIN_RIGHT_COLUMN_WIDTH));
  });

  it('clamps to the min (320) via shift+ArrowRight steps', () => {
    // Wide layout so the max never interferes; drive the width down to the floor.
    mockLayoutWidth(2000);
    renderColumn();
    // 440 -> 390 -> 340 -> 290 (clamped to 320)
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(handle()).toHaveAttribute('aria-valuenow', String(MIN_RIGHT_COLUMN_WIDTH));
    expect(layoutStyle()).toContain(`${MIN_RIGHT_COLUMN_WIDTH}px`);
  });

  it('clamps to max = min(620, 60% of layout width) via shift+ArrowLeft steps', () => {
    // 60% of 900 = 540, which is below the 620 px cap -> effective max 540.
    mockLayoutWidth(900);
    renderColumn();
    // 440 -> 490 -> 540 -> 590 (clamped to 540)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    expect(handle()).toHaveAttribute('aria-valuenow', '540');
    expect(layoutStyle()).toContain('540px');
  });

  it('arrow keys step by 10 and persist to the machine-global key', () => {
    mockLayoutWidth(2000);
    renderColumn();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' }); // grow right column by 10
    expect(handle()).toHaveAttribute('aria-valuenow', '450');
    expect(window.localStorage.getItem(RIGHT_COLUMN_WIDTH_STORAGE_KEY)).toBe('450');
  });

  it('restores a persisted width and re-clamps it on mount against the live max', () => {
    // Persist a value above the 540 max for a 900px-wide layout.
    window.localStorage.setItem(RIGHT_COLUMN_WIDTH_STORAGE_KEY, '700');
    mockLayoutWidth(900);
    renderColumn();
    expect(handle()).toHaveAttribute('aria-valuenow', '540');
  });

  describe('width read/write helpers', () => {
    it('uses the machine-global key and round-trips', () => {
      writeRightColumnWidth(512);
      expect(window.localStorage.getItem(RIGHT_COLUMN_WIDTH_STORAGE_KEY)).toBe('512');
      expect(readRightColumnWidth()).toBe(512);
    });

    it('defaults to 440 when absent and is try/catch-guarded on read errors', () => {
      expect(readRightColumnWidth()).toBe(DEFAULT_RIGHT_COLUMN_WIDTH);
      const spy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(readRightColumnWidth()).toBe(DEFAULT_RIGHT_COLUMN_WIDTH);
      spy.mockRestore();
    });

    it('clampRightColumnWidth honours [320, min(620, 60% layout)]', () => {
      expect(clampRightColumnWidth(100, 2000)).toBe(320);
      expect(clampRightColumnWidth(5000, 2000)).toBe(620); // 60% = 1200 -> cap 620
      expect(clampRightColumnWidth(5000, 900)).toBe(540); // 60% = 540 < 620
      expect(clampRightColumnWidth(440, 0)).toBe(440); // unknown layout -> px cap only
    });
  });
});
