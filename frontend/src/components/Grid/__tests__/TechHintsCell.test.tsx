/**
 * Tests for TechHintsCell
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 5.1)
 *
 * Focused behaviour coverage:
 *  1. Blur triggers resolve after 250 ms debounce; earlier keystrokes don't fire.
 *  2. Rapid re-edit cancels in-flight resolve via AbortController.abort().
 *  3. Chip removal sets confidence to 'manual-override' and suppresses re-resolve
 *     on a subsequent blur if raw text is unchanged.
 *  4. repoCrossCheck.status === 'conflict' renders red warning strip and marks row
 *     as Save-blocking (store.hasConflict === true).
 *  5. repoCrossCheck.status === 'partial' renders amber warning strip but does NOT
 *     mark row as Save-blocking.
 *  6. Unresolved-row state (resolved NULL OR confidence === 'none') renders the amber
 *     warning indicator (unresolved badge).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the gateway client BEFORE importing the component under test.
// ---------------------------------------------------------------------------
vi.mock('../../../services/gatewayClient', () => ({
  resolveTechHints: vi.fn(),
}));

import { resolveTechHints } from '../../../services/gatewayClient';
import { TechHintsCell } from '../TechHintsCell';
import { pendingResolutionsStore } from '../../../stores/pendingResolutionsStore';
import type { TechHintResolution } from '../../../types/techHints';
import type { Service } from '../../../types/model';

const mockResolveTechHints = resolveTechHints as unknown as ReturnType<typeof vi.fn>;

function buildResolution(overrides: Partial<TechHintResolution> = {}): TechHintResolution {
  return {
    language: { name: 'Java', version: '21' },
    frameworks: [{ name: 'Spring Boot', version: '3' }],
    languagePack: 'java-21',
    frameworkPacks: ['spring-boot-3'],
    confirmationSentence: 'Detected Java 21 with Spring Boot 3.',
    repoCrossCheck: null,
    confidence: 'high',
    ...overrides,
  };
}

function buildService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    name: 'Orders',
    description: '',
    application_id: 'app-1',
    service_type: 'backend',
    core_tech: 'Java 21 (Spring Boot 3)',
    tags: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  pendingResolutionsStore._resetForTests();
  mockResolveTechHints.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TechHintsCell', () => {
  it('fires resolve after 250ms debounce on blur; earlier blur within window does not fire twice', async () => {
    mockResolveTechHints.mockResolvedValue(buildResolution());
    const onChange = vi.fn();

    const { container } = render(
      <TechHintsCell
        service={buildService()}
        onChange={onChange}
        onResolved={vi.fn()}
      />
    );

    // Enter edit mode by double-clicking the display value.
    const display = container.querySelector('[data-testid="tech-hints-cell-display"]') as HTMLElement;
    fireEvent.doubleClick(display);

    const input = container.querySelector('[data-testid="tech-hints-cell-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21 (Spring Boot 3)' } });
    fireEvent.blur(input);

    // Before 250 ms no call should have fired.
    expect(mockResolveTechHints).not.toHaveBeenCalled();

    // Advance 249 ms — still no call.
    await act(async () => {
      vi.advanceTimersByTime(249);
    });
    expect(mockResolveTechHints).not.toHaveBeenCalled();

    // Advance past the debounce boundary.
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(mockResolveTechHints).toHaveBeenCalledTimes(1);
    expect(mockResolveTechHints).toHaveBeenCalledWith(
      expect.objectContaining({ freeText: 'Java 21 (Spring Boot 3)' }),
      expect.any(AbortSignal)
    );
  });

  it('rapid re-edit aborts the in-flight resolve via AbortController', async () => {
    // Keep the first resolve promise hanging forever so we can observe abort.
    const signals: AbortSignal[] = [];
    mockResolveTechHints.mockImplementation(
      (_req: unknown, signal?: AbortSignal) =>
        new Promise<TechHintResolution>((_resolve, reject) => {
          if (signal) {
            signals.push(signal);
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }
        })
    );

    const { container } = render(
      <TechHintsCell service={buildService()} onChange={vi.fn()} onResolved={vi.fn()} />
    );

    fireEvent.doubleClick(container.querySelector('[data-testid="tech-hints-cell-display"]')!);
    const input = container.querySelector('[data-testid="tech-hints-cell-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21' } });
    fireEvent.blur(input);
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(mockResolveTechHints).toHaveBeenCalledTimes(1);
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    // Re-edit: new blur fires a new resolve and should abort the first signal.
    fireEvent.doubleClick(container.querySelector('[data-testid="tech-hints-cell-display"]')!);
    const input2 = container.querySelector('[data-testid="tech-hints-cell-input"]') as HTMLInputElement;
    fireEvent.change(input2, { target: { value: 'Python 3.12' } });
    fireEvent.blur(input2);
    await act(async () => {
      vi.advanceTimersByTime(260);
    });

    expect(mockResolveTechHints).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
  });

  it('chip removal flips confidence to manual-override and suppresses re-resolve on unchanged text', async () => {
    mockResolveTechHints.mockResolvedValue(buildResolution());
    const onChange = vi.fn();
    const onResolved = vi.fn();

    const service = buildService({
      core_tech_resolved: { language: { name: 'Java', version: '21' } } as Record<string, unknown>,
      core_tech_language_pack: 'java-21',
      core_tech_framework_packs: ['spring-boot-3'],
      core_tech_resolution_confidence: 'high',
      core_tech_resolved_at: '2026-04-20T00:00:00.000Z',
    });

    const { container, rerender } = render(
      <TechHintsCell service={service} onChange={onChange} onResolved={onResolved} />
    );

    // Language chip should be present with a remove affordance.
    const languageChipRemove = container.querySelector(
      '[data-testid="tech-hints-chip-remove-language"]'
    ) as HTMLElement;
    expect(languageChipRemove).toBeTruthy();

    fireEvent.click(languageChipRemove);

    // onChange should have been called with the new row patch carrying manual-override
    // and the language pack nulled out.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        core_tech_language_pack: null,
        core_tech_resolution_confidence: 'manual-override',
      })
    );

    // Now re-render with the updated service state where the chip was removed.
    const updatedService: Service = {
      ...service,
      core_tech_language_pack: null,
      core_tech_resolution_confidence: 'manual-override',
    };
    rerender(<TechHintsCell service={updatedService} onChange={onChange} onResolved={onResolved} />);

    // Subsequent blur with UNCHANGED raw text must NOT re-fire resolve.
    fireEvent.doubleClick(container.querySelector('[data-testid="tech-hints-cell-display"]')!);
    const input = container.querySelector('[data-testid="tech-hints-cell-input"]') as HTMLInputElement;
    // Re-type the same value then blur.
    fireEvent.change(input, { target: { value: updatedService.core_tech! } });
    fireEvent.blur(input);
    await act(async () => {
      vi.advanceTimersByTime(260);
    });

    expect(mockResolveTechHints).not.toHaveBeenCalled();
  });

  it('renders red warning strip and registers conflict when repoCrossCheck.status === conflict', async () => {
    mockResolveTechHints.mockResolvedValue(
      buildResolution({
        repoCrossCheck: { status: 'conflict', note: 'pom.xml says Spring Boot 2' },
        confidence: 'low',
      })
    );

    const { container } = render(
      <TechHintsCell service={buildService()} onChange={vi.fn()} onResolved={vi.fn()} />
    );

    fireEvent.doubleClick(container.querySelector('[data-testid="tech-hints-cell-display"]')!);
    const input = container.querySelector('[data-testid="tech-hints-cell-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21 (Spring Boot 3)' } });
    fireEvent.blur(input);

    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    // Let the mock promise resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const warning = container.querySelector('[data-testid="tech-hints-warning-strip"]') as HTMLElement;
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('data-status')).toBe('conflict');

    // Save gating: conflict registers in the store.
    expect(pendingResolutionsStore.hasConflict()).toBe(true);
  });

  it('renders amber warning strip for partial status but does NOT register a conflict', async () => {
    mockResolveTechHints.mockResolvedValue(
      buildResolution({
        repoCrossCheck: { status: 'partial', note: 'Clone failed — auth error' },
        confidence: 'tech-only',
      })
    );

    const { container } = render(
      <TechHintsCell service={buildService()} onChange={vi.fn()} onResolved={vi.fn()} />
    );

    fireEvent.doubleClick(container.querySelector('[data-testid="tech-hints-cell-display"]')!);
    const input = container.querySelector('[data-testid="tech-hints-cell-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21' } });
    fireEvent.blur(input);

    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const warning = container.querySelector('[data-testid="tech-hints-warning-strip"]') as HTMLElement;
    expect(warning).toBeTruthy();
    expect(warning.getAttribute('data-status')).toBe('partial');
    expect(pendingResolutionsStore.hasConflict()).toBe(false);
  });

  it('renders the unresolved-row badge when resolved state is NULL or confidence === none', () => {
    // Case A: unresolved (all NULL)
    const unresolved = buildService({
      core_tech_resolved: null,
      core_tech_language_pack: null,
      core_tech_framework_packs: null,
      core_tech_resolution_confidence: null,
      core_tech_resolved_at: null,
    });

    const { container, rerender } = render(
      <TechHintsCell service={unresolved} onChange={vi.fn()} onResolved={vi.fn()} />
    );

    expect(
      container.querySelector('[data-testid="tech-hints-unresolved-badge"]')
    ).toBeTruthy();

    // Case B: resolved but confidence === 'none'
    const noneResolved = buildService({
      core_tech_resolved: {} as Record<string, unknown>,
      core_tech_language_pack: null,
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'none',
      core_tech_resolved_at: '2026-04-20T00:00:00.000Z',
    });
    rerender(<TechHintsCell service={noneResolved} onChange={vi.fn()} onResolved={vi.fn()} />);
    expect(
      container.querySelector('[data-testid="tech-hints-unresolved-badge"]')
    ).toBeTruthy();

    // Resolved with good confidence: badge should NOT show.
    const resolved = buildService({
      core_tech_resolved: { language: { name: 'Java', version: '21' } } as Record<string, unknown>,
      core_tech_language_pack: 'java-21',
      core_tech_framework_packs: ['spring-boot-3'],
      core_tech_resolution_confidence: 'high',
      core_tech_resolved_at: '2026-04-20T00:00:00.000Z',
    });
    rerender(<TechHintsCell service={resolved} onChange={vi.fn()} onResolved={vi.fn()} />);
    expect(
      container.querySelector('[data-testid="tech-hints-unresolved-badge"]')
    ).toBeNull();
  });

  // Spec 2026-06-07: on a Persistence-Tier service whose Core Tech names a
  // database, the (wrong) code-pack resolution must not contradict the database
  // note — its display is suppressed and the LLM call is skipped.
  it('Persistence-Tier DB Core Tech suppresses the code-pack resolution display (badge + confirmation); the database note stands alone', () => {
    // A persistence service whose Core Tech is a database, carrying a STALE
    // code-pack resolution (unresolved + a "could not map…" sentence) that would
    // otherwise land a few seconds after the synchronous database note.
    const dbService = buildService({
      core_tech: 'Sybase 15',
      core_tech_resolved: {
        confirmationSentence:
          "Could not map 'Sybase 15' to any registered language or framework pack",
      } as Record<string, unknown>,
      core_tech_language_pack: null,
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'none',
      core_tech_resolved_at: '2026-06-07T00:00:00.000Z',
    });

    const { container } = render(
      <TechHintsCell
        service={dbService}
        onChange={vi.fn()}
        onResolved={vi.fn()}
        persistenceTierParent
      />
    );

    // The code-pack resolution outputs are suppressed.
    expect(
      container.querySelector('[data-testid="tech-hints-unresolved-badge"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="tech-hints-confirmation"]')
    ).toBeNull();

    // The database note stands alone.
    const note = container.querySelector(
      '[data-testid="tech-hints-persistence-note"]'
    ) as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.textContent).toMatch(/database scan pack available/i);
    expect(note.getAttribute('data-status')).toBe('ok');
  });

  it('Persistence-Tier DB Core Tech skips the code-pack LLM resolution on blur (no wasted call)', async () => {
    const { container } = render(
      <TechHintsCell
        service={buildService({ core_tech: '' })}
        onChange={vi.fn()}
        onResolved={vi.fn()}
        persistenceTierParent
      />
    );

    fireEvent.doubleClick(
      container.querySelector('[data-testid="tech-hints-cell-display"]')!
    );
    const input = container.querySelector(
      '[data-testid="tech-hints-cell-input"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Sybase 15' } });
    fireEvent.blur(input);

    await act(async () => {
      vi.advanceTimersByTime(260);
    });

    // A database on a persistence service — the code-pack resolution is the wrong
    // check and must NOT fire.
    expect(mockResolveTechHints).not.toHaveBeenCalled();
  });
});
