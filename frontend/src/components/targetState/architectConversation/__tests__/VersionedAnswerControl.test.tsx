/**
 * Tests — VersionedAnswerControl (decoupled framework + version selection)
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 6
 * (FR5 UI / FR6 enrichment / FR8 seams).
 *
 * Per tasks.md §6.1 — focused tests covering:
 *   - Framework axis = constrained single-select chips (filtered set); version
 *     axis is a SEPARATE control with the recommended default PRE-SELECTED.
 *   - Free-text exact entry yields a valid off-list version; the resolved
 *     selection renders as exactly ONE chip (never framework × version chips)
 *     and submits the structured { framework, version } value.
 *   - Enrichment is NON-BLOCKING: a failing enrichment client still lets
 *     free-text + recommended default work, shows the quiet "enrichment
 *     unavailable" affordance, never gates submission, never changes the default.
 *   - A stable Spec 4 nudge slot renders injected content with no compute here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { VersionedAnswerControl } from '../VersionedAnswerControl';
import type { VersionEnrichmentClient } from '../versionControlConfig';

afterEach(() => cleanup());

// Java-21-filtered framework set (the Task Group 4 output excludes FastAPI etc.).
const JVM_FRAMEWORKS = ['Spring Boot 3.4', 'Quarkus 3', 'Micronaut 4'] as const;

describe('VersionedAnswerControl (TG6)', () => {
  it('renders the filtered framework chips and pre-selects the recommended version on pick', () => {
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM_FRAMEWORKS}
        onSubmit={vi.fn()}
      />,
    );

    // Framework axis = constrained single-select chips (the filtered set).
    expect(screen.getByTestId('versioned-framework-Spring Boot 3.4')).toBeTruthy();
    expect(screen.getByTestId('versioned-framework-Quarkus 3')).toBeTruthy();
    // The incompatible FastAPI is NOT offered (filtered upstream).
    expect(screen.queryByTestId('versioned-framework-FastAPI 0.115')).toBeNull();

    // The version axis only appears after a framework is chosen.
    expect(screen.queryByTestId('versioned-version-axis')).toBeNull();

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot 3.4'));

    // Version axis now present, recommended default PRE-SELECTED (Spring Boot 3.4 -> 3.4.1).
    const versionInput = screen.getByTestId('versioned-version-input') as HTMLInputElement;
    expect(versionInput.value).toBe('3.4.1');
  });

  it('accepts a free-text off-list version and submits exactly ONE resolved { framework, version } chip', () => {
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM_FRAMEWORKS}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot 3.4'));
    const versionInput = screen.getByTestId('versioned-version-input') as HTMLInputElement;

    // Off-list exact version (free-text) replaces the recommended default.
    fireEvent.change(versionInput, { target: { value: '3.4.7' } });

    // Exactly ONE resolved chip — never framework × version cartesian chips.
    const chip = screen.getByTestId('versioned-resolved-chip');
    expect(chip.textContent).toBe('Spring Boot 3.4 3.4.7');
    expect(screen.getAllByTestId('versioned-resolved-chip')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('versioned-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      framework: 'Spring Boot 3.4',
      version: '3.4.7',
    });
  });

  it('is NON-BLOCKING when enrichment fails: default still pre-selected, affordance shown, submit not gated', async () => {
    const failingClient: VersionEnrichmentClient = {
      fetchVersions: vi.fn().mockRejectedValue(new Error('proxy unreachable')),
    };
    const onSubmit = vi.fn();
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM_FRAMEWORKS}
        onSubmit={onSubmit}
        enrichmentClient={failingClient}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot 3.4'));

    // The recommended default is pre-selected DESPITE enrichment — enrichment
    // never changes it.
    const versionInput = screen.getByTestId('versioned-version-input') as HTMLInputElement;
    expect(versionInput.value).toBe('3.4.1');

    // The quiet "enrichment unavailable" affordance appears once the rejection
    // settles. Submission is NEVER gated.
    const affordance = await screen.findByTestId('versioned-enrichment-unavailable');
    expect(affordance).toBeTruthy();
    expect(failingClient.fetchVersions).toHaveBeenCalled();

    // Free-text + recommended default still fully work — submit goes through.
    fireEvent.click(screen.getByTestId('versioned-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      framework: 'Spring Boot 3.4',
      version: '3.4.1',
    });
  });

  it('merges enrichment suggestions into the typeahead WITHOUT changing the recommended default', async () => {
    const client: VersionEnrichmentClient = {
      fetchVersions: vi
        .fn()
        .mockResolvedValue({ versions: ['3.4.2', '3.4.3', '3.5.0'] }),
    };
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM_FRAMEWORKS}
        onSubmit={vi.fn()}
        enrichmentClient={client}
      />,
    );

    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot 3.4'));

    // The datalist gains the enrichment suggestions; the recommended default is
    // still the pre-selected input value (unchanged by enrichment).
    const datalist = await screen.findByTestId('versioned-version-datalist');
    const options = within(datalist).getAllByRole('option', { hidden: true });
    const values = options.map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('3.4.1'); // recommended default present + first
    expect(values).toContain('3.5.0'); // enrichment-augmented
    expect((screen.getByTestId('versioned-version-input') as HTMLInputElement).value).toBe('3.4.1');
  });

  it('renders the stable Spec 4 nudge slot content without implementing any compute', async () => {
    render(
      <VersionedAnswerControl
        decisionCode="service.framework"
        frameworkChoices={JVM_FRAMEWORKS}
        onSubmit={vi.fn()}
        nudgeSlot={({ framework }) => (
          <span data-testid="injected-nudge">Nudge for {framework}</span>
        )}
      />,
    );

    // The slot is only rendered once a framework is chosen (it sits in the
    // version axis), and it renders the injected node verbatim.
    fireEvent.click(screen.getByTestId('versioned-framework-Quarkus 3'));
    // Await the (offline no-op) enrichment effect to settle so the test is act-clean.
    const slot = await screen.findByTestId('versioned-nudge-slot');
    expect(within(slot).getByTestId('injected-nudge').textContent).toBe(
      'Nudge for Quarkus 3',
    );
  });
});
