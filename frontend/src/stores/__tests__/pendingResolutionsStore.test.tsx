/**
 * Tests for pendingResolutionsStore + Save gating behaviour
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 6.1)
 *
 * Focused behaviour coverage:
 *  1. Slice stores `{ promise, abort, startedAt }` keyed by service row ID.
 *  2. Starting a new resolve for an already-pending row aborts the old controller
 *     and replaces the entry.
 *  3. Save click with non-empty slice awaits Promise.allSettled(pending) before
 *     the whole-model PUT fires.
 *  4. Save button label flips to "Resolving N rows..." while awaiting settlement.
 *  5. Save is DISABLED (not just delayed) while any dirty row has a conflict;
 *     tooltip is "Resolve conflicts before saving".
 *  6. Individual resolve rejection -> row saves with NULL resolved fields + toast;
 *     Save proceeds for the rest.
 *  7. Stale rows (no in-flight promise) trigger an implicit resolve on Save click.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

import { pendingResolutionsStore } from '../pendingResolutionsStore';
import { SaveWithPendingResolves } from '../../components/TopBar/SaveWithPendingResolves';
import type { TechHintResolution } from '../../types/techHints';

function buildResolution(overrides: Partial<TechHintResolution> = {}): TechHintResolution {
  return {
    language: { name: 'Java', version: '21' },
    frameworks: [],
    languagePack: 'java-21',
    frameworkPacks: [],
    confirmationSentence: 'ok',
    repoCrossCheck: null,
    confidence: 'tech-only',
    ...overrides,
  };
}

beforeEach(() => {
  pendingResolutionsStore._resetForTests();
});

afterEach(() => {
  pendingResolutionsStore._resetForTests();
});

// ============================================================================
// Store-level behaviour
// ============================================================================

describe('pendingResolutionsStore', () => {
  it('stores entries keyed by row ID with promise/abort/startedAt fields', () => {
    const promise = new Promise<TechHintResolution>(() => {});
    const abort = new AbortController();
    const before = Date.now();
    pendingResolutionsStore.start('row-1', promise, abort);
    const entry = pendingResolutionsStore.getEntry('row-1');
    expect(entry).toBeDefined();
    expect(entry!.promise).toBe(promise);
    expect(entry!.abort).toBe(abort);
    expect(entry!.startedAt).toBeGreaterThanOrEqual(before);
    expect(pendingResolutionsStore.pendingCount()).toBe(1);
  });

  it('aborts the old controller and replaces the entry when starting a new resolve for the same row', () => {
    const oldAbort = new AbortController();
    const oldPromise = new Promise<TechHintResolution>((_resolve, reject) => {
      oldAbort.signal.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError'))
      );
    });
    // Attach an immediate catch so the expected abort rejection is not unhandled.
    oldPromise.catch(() => {});
    pendingResolutionsStore.start('row-1', oldPromise, oldAbort);
    expect(oldAbort.signal.aborted).toBe(false);

    const newAbort = new AbortController();
    const newPromise = new Promise<TechHintResolution>(() => {});
    pendingResolutionsStore.start('row-1', newPromise, newAbort);

    expect(oldAbort.signal.aborted).toBe(true);
    const entry = pendingResolutionsStore.getEntry('row-1');
    expect(entry!.promise).toBe(newPromise);
    expect(entry!.abort).toBe(newAbort);
    expect(pendingResolutionsStore.pendingCount()).toBe(1);
  });
});

// ============================================================================
// SaveWithPendingResolves — Save button integration
// ============================================================================

describe('SaveWithPendingResolves (Save gating)', () => {
  it('awaits Promise.allSettled(pending) before firing onSave when the slice is non-empty', async () => {
    let resolveFirst: (v: TechHintResolution) => void = () => {};
    const firstPromise = new Promise<TechHintResolution>((r) => {
      resolveFirst = r;
    });
    pendingResolutionsStore.start('row-1', firstPromise, new AbortController());

    const onSave = vi.fn();
    render(<SaveWithPendingResolves onSave={onSave} />);

    const btn = screen.getByTestId('save-button');
    fireEvent.click(btn);

    // Save should NOT have fired yet — the promise is unsettled.
    expect(onSave).not.toHaveBeenCalled();

    // Settle the pending promise and flush microtasks.
    await act(async () => {
      resolveFirst(buildResolution());
      pendingResolutionsStore.settle('row-1');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('shows "Resolving N rows..." label while awaiting settlement', async () => {
    let resolveA: (v: TechHintResolution) => void = () => {};
    let resolveB: (v: TechHintResolution) => void = () => {};
    pendingResolutionsStore.start(
      'row-1',
      new Promise<TechHintResolution>((r) => {
        resolveA = r;
      }),
      new AbortController()
    );
    pendingResolutionsStore.start(
      'row-2',
      new Promise<TechHintResolution>((r) => {
        resolveB = r;
      }),
      new AbortController()
    );

    render(<SaveWithPendingResolves onSave={vi.fn()} />);
    const btn = screen.getByTestId('save-button');
    // Before click the button label reads "Save" (or similar baseline).
    expect(btn.textContent).toBe('Save');

    fireEvent.click(btn);

    // While the promises are unsettled, the label should reflect the count.
    await waitFor(() => {
      expect(btn.textContent).toBe('Resolving 2 rows...');
    });

    await act(async () => {
      resolveA(buildResolution());
      pendingResolutionsStore.settle('row-1');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(btn.textContent).toBe('Resolving 1 rows...');
    });

    await act(async () => {
      resolveB(buildResolution());
      pendingResolutionsStore.settle('row-2');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(btn.textContent).toBe('Save');
    });
  });

  it('is DISABLED with the correct tooltip while any dirty row has a conflict', async () => {
    pendingResolutionsStore.setConflict('row-1', true);

    const onSave = vi.fn();
    render(<SaveWithPendingResolves onSave={onSave} />);

    const btn = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Resolve conflicts before saving');

    // Clicking does nothing.
    fireEvent.click(btn);
    expect(onSave).not.toHaveBeenCalled();

    // Clearing the conflict re-enables Save.
    await act(async () => {
      pendingResolutionsStore.setConflict('row-1', false);
    });
    await waitFor(() => {
      expect((screen.getByTestId('save-button') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('lets a rejected row settle (toast path) and proceeds with Save for the rest', async () => {
    // row-1 rejects; row-2 resolves fine.
    const rejectingPromise = Promise.reject(new Error('llm_timeout'));
    // Attach a catch immediately so the rejection is never unhandled.
    rejectingPromise.catch(() => {});

    let resolveB: (v: TechHintResolution) => void = () => {};
    const okPromise = new Promise<TechHintResolution>((r) => {
      resolveB = r;
    });

    pendingResolutionsStore.start('row-1', rejectingPromise, new AbortController());
    pendingResolutionsStore.start('row-2', okPromise, new AbortController());

    const onSave = vi.fn();
    const onRowRejection = vi.fn();
    render(
      <SaveWithPendingResolves onSave={onSave} onRowResolutionRejection={onRowRejection} />
    );

    fireEvent.click(screen.getByTestId('save-button'));

    // Settle both (row-1 already rejected).
    await act(async () => {
      pendingResolutionsStore.settle('row-1');
      resolveB(buildResolution());
      pendingResolutionsStore.settle('row-2');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onRowRejection).toHaveBeenCalledWith('row-1', expect.any(Error));
  });

  it('fires an implicit resolve for stale rows with no in-flight promise on Save click', async () => {
    const implicitResolveForRow = vi.fn(async (_rowId: string) => buildResolution());

    const onSave = vi.fn();
    render(
      <SaveWithPendingResolves
        onSave={onSave}
        staleRowIds={['stale-row-1', 'stale-row-2']}
        resolveStaleRow={implicitResolveForRow}
      />
    );

    fireEvent.click(screen.getByTestId('save-button'));

    // Implicit resolves should have been fired for every stale row.
    await waitFor(() => {
      expect(implicitResolveForRow).toHaveBeenCalledWith('stale-row-1');
      expect(implicitResolveForRow).toHaveBeenCalledWith('stale-row-2');
    });

    // Save fires after all settle.
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
