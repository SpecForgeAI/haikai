/**
 * Tests -- VersionedAnswerControl (bare-stem chips + compact layout + auto-select)
 * Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux, Task Group 4
 * (FR1 bare-stem dedup / FR3 compact layout + auto-select; reuses the FR6
 * enrichment + FR8 nudge seams from the prior spec).
 *
 * Covers:
 *   - The framework axis renders BARE-STEM chips deduped from version-laden
 *     `choices` (Java 21 + Java 17 -> one [Java]); version-laden chips never leak.
 *   - Auto-select ON (default): a chip click IMMEDIATELY commits { stem, curated
 *     default } in ONE action; "Edit version" reveals the field + "Save version".
 *   - Auto-select OFF: the editable field + "Save version" is shown from the start
 *     (the original two-step flow), default pre-selected.
 *   - A version-less stem commits with NO version regardless of toggle; its chip
 *     is the stem only.
 *   - Enrichment stays NON-BLOCKING (failure -> affordance, never gated); nudge
 *     slot renders inside the revealed version editor.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { VersionedAnswerControl } from '../VersionedAnswerControl';
import type { VersionEnrichmentClient } from '../versionControlConfig';

afterEach(() => cleanup());

// Version-laden JVM framework choices (service.framework). The control deduplicates
// these to bare stems: ['Spring Boot', 'Quarkus', 'Micronaut'].
const JVM = ['Spring Boot 3.4', 'Quarkus 3', 'Micronaut 4'] as const;

describe('VersionedAnswerControl (bare-stem + auto-select)', () => {
  it('renders BARE-STEM deduped chips (Java 21 + Java 17 -> one [Java]); laden chips never leak', () => {
    render(
      <VersionedAnswerControl
        decisionCode="service.language"
        frameworkChoices={['Java 21', 'Java 17', 'Kotlin 2']}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('versioned-framework-Java')).toBeTruthy();
    expect(screen.getByTestId('versioned-framework-Kotlin')).toBeTruthy();
    // Exactly ONE Java chip — the two laden Java choices collapsed.
    expect(screen.getAllByTestId('versioned-framework-Java')).toHaveLength(1);
    // Version-laden chips never reach the chip set.
    expect(screen.queryByTestId('versioned-framework-Java 21')).toBeNull();
    expect(screen.queryByTestId('versioned-framework-Java 17')).toBeNull();
  });

  it('auto-select ON: a chip click commits stem + curated default in ONE action (Spring Boot -> 4.0)', () => {
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM}
        autoSelect
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot'));

    // ONE action: committed immediately with the curated default (Spring Boot -> 4.0).
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ framework: 'Spring Boot', version: '4.0' });
    // The confirmed chip shows the resolved label; no separate Save step here.
    expect(screen.getByTestId('versioned-resolved-chip').textContent).toBe('Spring Boot 4.0');
    expect(screen.queryByTestId('versioned-version-input')).toBeNull();
    // The "Edit version" escape hatch is offered.
    expect(screen.getByTestId('versioned-edit-version')).toBeTruthy();
  });

  it('auto-select ON: "Edit version" reveals the field + "Save version" to re-commit a changed version', () => {
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM}
        autoSelect
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot')); // commit #1 (4.0)
    fireEvent.click(screen.getByTestId('versioned-edit-version'));

    const input = screen.getByTestId('versioned-version-input') as HTMLInputElement;
    expect(input.value).toBe('4.0'); // the committed default pre-fills the field
    fireEvent.change(input, { target: { value: '4.0.1' } });
    fireEvent.click(screen.getByTestId('versioned-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith({ framework: 'Spring Boot', version: '4.0.1' });
  });

  it('auto-select OFF: editable field + "Save version" from the start (two-step, no commit-on-chip)', () => {
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM}
        autoSelect={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot'));
    // NO immediate commit in OFF mode.
    expect(onSubmit).not.toHaveBeenCalled();

    const input = screen.getByTestId('versioned-version-input') as HTMLInputElement;
    expect(input.value).toBe('4.0'); // recommended default pre-selected
    fireEvent.change(input, { target: { value: '3.4.7' } });
    fireEvent.click(screen.getByTestId('versioned-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ framework: 'Spring Boot', version: '3.4.7' });
  });

  it('a version-less stem commits with NO version regardless of toggle (chip is the stem only)', () => {
    const onSubmit = vi.fn();
    const choices = ['Flyway 10', 'Liquibase 4', 'none-managed-by-app'];

    const { rerender } = render(
      <VersionedAnswerControl
        decisionCode="db.migrations"
        frameworkChoices={choices}
        autoSelect
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-none-managed-by-app'));
    expect(onSubmit).toHaveBeenLastCalledWith({
      framework: 'none-managed-by-app',
      version: '',
    });
    // Stem-only chip; no version field and no "Edit version" for a version-less stem.
    expect(screen.getByTestId('versioned-resolved-chip').textContent).toBe('none-managed-by-app');
    expect(screen.queryByTestId('versioned-version-input')).toBeNull();
    expect(screen.queryByTestId('versioned-edit-version')).toBeNull();

    // Toggle OFF: still commits with NO version.
    onSubmit.mockClear();
    rerender(
      <VersionedAnswerControl
        decisionCode="db.migrations"
        frameworkChoices={choices}
        autoSelect={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId('versioned-framework-none-managed-by-app'));
    expect(onSubmit).toHaveBeenLastCalledWith({
      framework: 'none-managed-by-app',
      version: '',
    });
  });

  it('build.tool de-doubled: Maven -> { Maven, 3.9 } chip "Maven 3.9", Gradle -> { Gradle, 8 } chip "Gradle 8" (Spec 2026-06-26 FR5)', () => {
    // build.tool choices are version-LADEN ('Gradle 8' / 'Maven 3.9'); the bare-stem
    // dedup seam splits each into { stem, curated default }, making the OLD doubled
    // envelope { framework:'Maven 3.9', version:'Maven 3.9' } -> 'Maven 3.9 Maven 3.9'
    // impossible. Auto-select ON commits stem + curated default in one click.
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="build.tool"
        frameworkChoices={['Gradle 8', 'Maven 3.9']}
        autoSelect
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Maven'));
    expect(onSubmit).toHaveBeenLastCalledWith({ framework: 'Maven', version: '3.9' });
    const mavenChip = screen.getByTestId('versioned-resolved-chip').textContent;
    expect(mavenChip).toBe('Maven 3.9');
    expect(mavenChip).not.toBe('Maven 3.9 Maven 3.9'); // the doubled label is gone

    fireEvent.click(screen.getByTestId('versioned-framework-Gradle'));
    expect(onSubmit).toHaveBeenLastCalledWith({ framework: 'Gradle', version: '8' });
    expect(screen.getByTestId('versioned-resolved-chip').textContent).toBe('Gradle 8');
  });

  it('is NON-BLOCKING when enrichment fails: default still pre-selected, affordance shown, submit not gated', async () => {
    const failingClient: VersionEnrichmentClient = {
      fetchVersions: vi.fn().mockRejectedValue(new Error('proxy unreachable')),
    };
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM}
        autoSelect={false}
        onSubmit={onSubmit}
        enrichmentClient={failingClient}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot'));
    const input = screen.getByTestId('versioned-version-input') as HTMLInputElement;
    expect(input.value).toBe('4.0'); // default pre-selected DESPITE enrichment

    const affordance = await screen.findByTestId('versioned-enrichment-unavailable');
    expect(affordance).toBeTruthy();
    expect(failingClient.fetchVersions).toHaveBeenCalled();

    // Free-text + recommended default still fully work — submit goes through.
    fireEvent.click(screen.getByTestId('versioned-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ framework: 'Spring Boot', version: '4.0' });
  });

  it('merges enrichment suggestions into the typeahead WITHOUT changing the recommended default', async () => {
    const client: VersionEnrichmentClient = {
      fetchVersions: vi.fn().mockResolvedValue({ versions: ['4.0.1', '4.1.0'] }),
    };
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM}
        autoSelect={false}
        onSubmit={vi.fn()}
        enrichmentClient={client}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot'));
    const datalist = await screen.findByTestId('versioned-version-datalist');
    const values = within(datalist)
      .getAllByRole('option', { hidden: true })
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('4.0'); // recommended default present
    expect(values).toContain('4.1.0'); // enrichment-augmented
    expect((screen.getByTestId('versioned-version-input') as HTMLInputElement).value).toBe('4.0');
  });

  it('renders the stable Spec 4 nudge slot inside the revealed version editor', async () => {
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM}
        autoSelect={false}
        onSubmit={vi.fn()}
        nudgeSlot={({ framework }) => (
          <span data-testid="injected-nudge">Nudge for {framework}</span>
        )}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Quarkus'));
    const slot = await screen.findByTestId('versioned-nudge-slot');
    expect(within(slot).getByTestId('injected-nudge').textContent).toBe('Nudge for Quarkus');
  });
});
