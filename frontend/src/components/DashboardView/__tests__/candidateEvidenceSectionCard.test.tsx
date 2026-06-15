/**
 * CandidateEvidenceSectionCard Tests
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 2.1.
 *
 * Renderer-level tests over the generic `CandidateEvidenceSectionCard`.
 * Validates that the same component, parameterised by `testIdPrefix`,
 * emits the testid contract previously owned by Spec 2's per-section
 * `CodeDetectionPanel` AND the inline placeholder bodies for Log Scans
 * and LLM Review.
 *
 * No `ArchitectureContext` / API mocks: the card imports nothing from
 * context or the API client.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type {
  CandidateEvidenceSection,
  CandidateEvidenceStatus,
} from '../candidateEvidenceTypes';
import { CandidateEvidenceSectionCard } from '../CandidateEvidenceSectionCard';

// CSS-module identity mock — same pattern used by Spec 2's renderer tests.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    {
      get: (_target: object, prop: string | symbol) => String(prop),
    },
  ),
}));

// ----------------------------------------------------------------------------
// Fixture helpers
// ----------------------------------------------------------------------------

function makeSection(overrides: Partial<CandidateEvidenceSection> = {}): CandidateEvidenceSection {
  return {
    title: 'Code Detection',
    status: 'available',
    fields: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CandidateEvidenceSectionCard', () => {
  it('emits the {prefix}-panel wrapper testid for each of the three prefixes', () => {
    const section = makeSection({ status: 'not_available', summary: 'placeholder body' });

    const prefixes = ['code-detection', 'log-scans', 'llm-review'] as const;
    prefixes.forEach((prefix) => {
      const { unmount } = render(
        <CandidateEvidenceSectionCard section={section} testIdPrefix={prefix} />,
      );
      expect(screen.getByTestId(`${prefix}-panel`)).toBeInTheDocument();
      unmount();
    });
  });

  it('renders detected-by, source-files, reason, and a per-field row when populated (code-detection prefix)', () => {
    const section = makeSection({
      status: 'available',
      detectedBy: 'spring-boot-adapter',
      sourceFiles: ['src/main/java/Foo.java', 'src/main/java/Bar.java'],
      reason: 'Detected as a controller method exposed through framework route annotations.',
      fields: [
        { label: 'HTTP method', value: 'GET' },
        { label: 'Path variables', value: ['orderId', 'lineId'] },
      ],
    });

    render(<CandidateEvidenceSectionCard section={section} testIdPrefix="code-detection" />);

    expect(screen.getByTestId('code-detection-detected-by')).toHaveTextContent(
      'Detected by: spring-boot-adapter',
    );

    const sourceFiles = screen.getByTestId('code-detection-source-files');
    expect(sourceFiles).toHaveTextContent('Source files:');
    expect(sourceFiles).toHaveTextContent('src/main/java/Foo.java');
    expect(sourceFiles).toHaveTextContent('src/main/java/Bar.java');

    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Reason: Detected as a controller method exposed through framework route annotations.',
    );

    // Slug rule: "HTTP method" -> "http-method".
    expect(screen.getByTestId('code-detection-field-http-method')).toHaveTextContent(
      'HTTP method: GET',
    );

    // Array values render as label header + one inner div per item.
    const pathVars = screen.getByTestId('code-detection-field-path-variables');
    expect(pathVars).toHaveTextContent('Path variables:');
    expect(pathVars).toHaveTextContent('orderId');
    expect(pathVars).toHaveTextContent('lineId');

    // No empty-state line when there is content.
    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  it('renders summary-only placeholder sections without emitting any per-line testids', () => {
    const section = makeSection({
      title: 'Log Scans',
      status: 'not_available',
      summary: 'Log scan evidence was not found for this run.',
      fields: [],
    });

    render(<CandidateEvidenceSectionCard section={section} testIdPrefix="log-scans" />);

    const wrapper = screen.getByTestId('log-scans-panel');
    expect(wrapper).toHaveTextContent('Log scan evidence was not found for this run.');

    // None of the conditional testids should fire — summary IS the body.
    expect(screen.queryByTestId('log-scans-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-scans-detected-by')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-scans-source-files')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-scans-reason')).not.toBeInTheDocument();
    // Sanity: no `-field-*` lines either.
    expect(
      within(wrapper).queryAllByTestId(/^log-scans-field-/).length,
    ).toBe(0);
  });

  it('emits {prefix}-empty with the exact text only when there is literally nothing to show', () => {
    const section = makeSection({
      title: 'Code Detection',
      status: 'not_available',
      fields: [],
    });

    render(<CandidateEvidenceSectionCard section={section} testIdPrefix="code-detection" />);

    expect(screen.getByTestId('code-detection-empty')).toHaveTextContent(
      'Type-specific details: not available.',
    );
  });

  it('renders without throwing for all four CandidateEvidenceStatus values; partial/warning DOM matches not_available', () => {
    const baseSection = makeSection({
      title: 'Code Detection',
      summary: undefined,
      reason: undefined,
      fields: [],
    });

    const renderFor = (status: CandidateEvidenceStatus) => {
      const { container, unmount } = render(
        <CandidateEvidenceSectionCard
          section={{ ...baseSection, status }}
          testIdPrefix="code-detection"
        />,
      );
      const html = container.innerHTML;
      unmount();
      return html;
    };

    const availableHtml = renderFor('available');
    const notAvailableHtml = renderFor('not_available');
    const partialHtml = renderFor('partial');
    const warningHtml = renderFor('warning');

    // None throw — implicit by reaching this line.
    expect(availableHtml).toContain('code-detection-panel');
    expect(notAvailableHtml).toContain('code-detection-panel');

    // partial / warning render with the same DOM as not_available
    // (forward-compatible no-op styling).
    expect(partialHtml).toBe(notAvailableHtml);
    expect(warningHtml).toBe(notAvailableHtml);
  });

  it('hides the impact block when confidenceImpactLabel is absent, renders it when present', () => {
    const baseSection = makeSection({
      title: 'Code Detection',
      status: 'available',
      reason: 'Detected as a controller method exposed through framework route annotations.',
      fields: [{ label: 'HTTP method', value: 'GET' }],
    });

    const { rerender } = render(
      <CandidateEvidenceSectionCard section={baseSection} testIdPrefix="code-detection" />,
    );
    expect(screen.queryByTestId('code-detection-confidence-impact')).not.toBeInTheDocument();

    rerender(
      <CandidateEvidenceSectionCard
        section={{
          ...baseSection,
          confidenceImpactLabel: 'High',
          confidenceImpactReason: 'Adapter-sourced server endpoint.',
        }}
        testIdPrefix="code-detection"
      />,
    );

    const impact = screen.getByTestId('code-detection-confidence-impact');
    expect(impact).toHaveTextContent('Impact: High');
    expect(impact).toHaveTextContent('Adapter-sourced server endpoint.');
  });

  it('hides notes when notes is absent/empty, renders one entry per note keyed by index when present', () => {
    const baseSection = makeSection({
      title: 'Code Detection',
      status: 'available',
      reason: 'Detected as a controller method exposed through framework route annotations.',
      fields: [{ label: 'HTTP method', value: 'GET' }],
    });

    // Hidden when absent.
    const { rerender } = render(
      <CandidateEvidenceSectionCard section={baseSection} testIdPrefix="code-detection" />,
    );
    expect(screen.queryByTestId('code-detection-note-0')).not.toBeInTheDocument();

    // Hidden when empty array.
    rerender(
      <CandidateEvidenceSectionCard
        section={{ ...baseSection, notes: [] }}
        testIdPrefix="code-detection"
      />,
    );
    expect(screen.queryByTestId('code-detection-note-0')).not.toBeInTheDocument();

    // Rendered when present.
    rerender(
      <CandidateEvidenceSectionCard
        section={{
          ...baseSection,
          notes: [
            { level: 'info', text: 'First note' },
            { level: 'warning', text: 'Second note' },
          ],
        }}
        testIdPrefix="code-detection"
      />,
    );

    expect(screen.getByTestId('code-detection-note-0')).toHaveTextContent('First note');
    expect(screen.getByTestId('code-detection-note-1')).toHaveTextContent('Second note');
    expect(screen.queryByTestId('code-detection-note-2')).not.toBeInTheDocument();
  });
});
