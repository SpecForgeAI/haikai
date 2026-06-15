/**
 * MigrationDeliveryPlanWizard — readiness gap-code rendering tests
 *
 * Spec: 2026-05-30 Capture Coverage Gates (Spec 5) — Task Group 4 (frontend
 * render of the three new advisory coverage gap codes).
 *
 * UPDATED by Spec 2026-06-11 Deterministic Findings-Coverage Verification +
 * Gap Wayfinding (Task Group 4.2): the wizard's bare `Gaps: {codes.join()}`
 * row is replaced by one EXPLANATION CARD per gap code, sourced from the
 * gap wayfinding registry (`config/gapWayfindingRegistry.ts`) — registry
 * title, plain-English explanation, and a "Go to ..." link when the
 * registry resolves a destination. These tests now assert the card
 * treatment (per-code `mdp-wizard-gap-card-{code}` test ids + registry
 * titles) instead of raw snake_case codes in a joined row.
 *
 * The three Spec-5 codes under test:
 *   - incomplete_capture_coverage          (A) capture coverage
 *   - under_specified_endpoints            (B) specification coverage
 *   - discovery_harness_inventory_mismatch (C) inventory reconciliation
 *
 * Test strategy mirrors the sibling `MigrationDeliveryPlanWizard.test.tsx`:
 * pure-component testing with the context fetch supplied via the `fetchContext`
 * test seam (never hits the network). Renders wrap in MemoryRouter because
 * the gap cards render react-router `Link`s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MigrationDeliveryPlanWizard,
  ArchitectureOption,
} from '../MigrationDeliveryPlanWizard';
import type { MigrationDiscoveryContext } from '../../../../api/migrationDiscoveryContextApi';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-ccg';
const CURRENT_ARCH_ID = 'arch-current-ccg';
const TARGET_ARCH_ID = 'arch-target-ccg';
const ARCH_BASE = `/projects/${PROJECT_ID}/architectures/${CURRENT_ARCH_ID}`;

const ARCHITECTURES: ArchitectureOption[] = [
  { id: CURRENT_ARCH_ID, name: 'Monolith (current)' },
  { id: TARGET_ARCH_ID, name: 'Microservices (target)' },
];

// The three new advisory coverage gap codes added by AMS Group 1.
const CAPTURE_COVERAGE_GAP = 'incomplete_capture_coverage';
const UNDER_SPECIFIED_GAP = 'under_specified_endpoints';
const INVENTORY_MISMATCH_GAP = 'discovery_harness_inventory_mismatch';

// Registry titles the cards must surface for each code.
const CARD_TITLES: Record<string, string> = {
  [CAPTURE_COVERAGE_GAP]: 'Incomplete capture coverage',
  [UNDER_SPECIFIED_GAP]: 'Under-specified endpoints',
  [INVENTORY_MISMATCH_GAP]: 'Discovery / capture inventory mismatch',
  unresolved_discovery_decisions: 'Unresolved discovery decisions',
};

function buildContext(
  gaps: string[],
  overrides: Partial<MigrationDiscoveryContext> = {}
): MigrationDiscoveryContext {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: CURRENT_ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    generatedAt: '2026-05-30T10:00:00Z',
    findingsSummary: { totalFindings: 7 },
    discoveryRunsSummary: {
      totalRuns: 1,
      completedRuns: 1,
      runs: [
        {
          runId: 'run-1',
          architectureId: CURRENT_ARCH_ID,
          status: 'completed',
          discoveryKind: 'java-spring',
          createdAt: '2026-05-29T10:00:00Z',
          updatedAt: '2026-05-29T11:00:00Z',
        },
      ],
    },
    apiBehaviourBaselineSummary: {
      totalBaselines: 1,
      baselines: [
        {
          baselineId: 'baseline-1',
          architectureId: CURRENT_ARCH_ID,
          name: 'Customer API baseline',
          status: 'active',
          createdAt: '2026-05-28T10:00:00Z',
        },
      ],
    },
    architectureMappingsSummary: { totalMappings: 4 },
    readinessAssessment: {
      overallStatus: 'partial',
      apiReadiness: 'partial',
      dataReadiness: 'partial',
      discoveryReadiness: 'partial',
      baselineReadiness: 'partial',
      gaps,
    },
    runtimeUsageSummary: { hasRuntimeEvidence: true },
    databaseDiscoverySummary: { databaseFindingCount: 3 },
    ...overrides,
  };
}

function renderWizard(context: MigrationDiscoveryContext) {
  const fetchContext = vi.fn().mockResolvedValue(context);
  const generate = vi
    .fn()
    .mockResolvedValue({ draftId: 'draft-1', summary: 'A short draft summary' });
  const utils = render(
    <MemoryRouter>
      <MigrationDeliveryPlanWizard
        open
        projectId={PROJECT_ID}
        architectures={ARCHITECTURES}
        onClose={vi.fn() as never}
        onGenerationComplete={vi.fn() as never}
        fetchContext={fetchContext as never}
        generate={generate as never}
      />
    </MemoryRouter>
  );
  return { ...utils, fetchContext };
}

// Stage 1: select both architectures so the context fetch fires + the
// readiness card resolves with its gap cards.
async function loadReadinessCard() {
  fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
    target: { value: CURRENT_ARCH_ID },
  });
  fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
    target: { value: TARGET_ARCH_ID },
  });
  await waitFor(() => {
    expect(screen.getByTestId('mdp-wizard-readiness-card')).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('MigrationDeliveryPlanWizard — coverage gap codes render as explanation cards', () => {
  it('renders all three new coverage gap codes as cards in the gaps area', async () => {
    renderWizard(
      buildContext([
        CAPTURE_COVERAGE_GAP,
        UNDER_SPECIFIED_GAP,
        INVENTORY_MISMATCH_GAP,
      ])
    );
    await loadReadinessCard();

    const gapsArea = await screen.findByTestId('mdp-wizard-readiness-gaps');
    for (const code of [
      CAPTURE_COVERAGE_GAP,
      UNDER_SPECIFIED_GAP,
      INVENTORY_MISMATCH_GAP,
    ]) {
      const card = within(gapsArea).getByTestId(`mdp-wizard-gap-card-${code}`);
      expect(card).toHaveTextContent(CARD_TITLES[code]);
    }
  });

  it('renders the capture-coverage gap card (A) with its nearest-route link', async () => {
    renderWizard(buildContext([CAPTURE_COVERAGE_GAP]));
    await loadReadinessCard();

    const card = await screen.findByTestId(
      `mdp-wizard-gap-card-${CAPTURE_COVERAGE_GAP}`
    );
    expect(card).toHaveTextContent(CARD_TITLES[CAPTURE_COVERAGE_GAP]);
    expect(
      within(card)
        .getByTestId(`mdp-wizard-gap-link-${CAPTURE_COVERAGE_GAP}`)
        .getAttribute('href')
    ).toBe(`${ARCH_BASE}/api-behaviour`);
  });

  it('renders the under-specified-endpoints gap card (B) with its run-scoped link', async () => {
    renderWizard(buildContext([UNDER_SPECIFIED_GAP]));
    await loadReadinessCard();

    const card = await screen.findByTestId(
      `mdp-wizard-gap-card-${UNDER_SPECIFIED_GAP}`
    );
    expect(card).toHaveTextContent(CARD_TITLES[UNDER_SPECIFIED_GAP]);
    // run-1 is the wizard's pre-selected discovery run.
    expect(
      within(card)
        .getByTestId(`mdp-wizard-gap-link-${UNDER_SPECIFIED_GAP}`)
        .getAttribute('href')
    ).toBe(`${ARCH_BASE}/discovery/runs/run-1`);
  });

  it('renders the discovery↔harness inventory-mismatch gap card (C)', async () => {
    renderWizard(buildContext([INVENTORY_MISMATCH_GAP]));
    await loadReadinessCard();

    const card = await screen.findByTestId(
      `mdp-wizard-gap-card-${INVENTORY_MISMATCH_GAP}`
    );
    expect(card).toHaveTextContent(CARD_TITLES[INVENTORY_MISMATCH_GAP]);
  });

  it('renders the new coverage cards alongside pre-existing gap-code cards without dropping either', async () => {
    renderWizard(
      buildContext([
        'unresolved_discovery_decisions',
        CAPTURE_COVERAGE_GAP,
        UNDER_SPECIFIED_GAP,
      ])
    );
    await loadReadinessCard();

    const gapsArea = await screen.findByTestId('mdp-wizard-readiness-gaps');
    // Pre-existing code still shown (room=open run-scoped link).
    const decisionsCard = within(gapsArea).getByTestId(
      'mdp-wizard-gap-card-unresolved_discovery_decisions'
    );
    expect(decisionsCard).toHaveTextContent(
      CARD_TITLES.unresolved_discovery_decisions
    );
    expect(
      within(decisionsCard)
        .getByTestId('mdp-wizard-gap-link-unresolved_discovery_decisions')
        .getAttribute('href')
    ).toBe(`${ARCH_BASE}/discovery/runs/run-1?room=open`);
    // New codes shown too.
    expect(
      within(gapsArea).getByTestId(`mdp-wizard-gap-card-${CAPTURE_COVERAGE_GAP}`)
    ).toBeInTheDocument();
    expect(
      within(gapsArea).getByTestId(`mdp-wizard-gap-card-${UNDER_SPECIFIED_GAP}`)
    ).toBeInTheDocument();
  });

  it('omits the gaps area entirely when there are no gaps', async () => {
    renderWizard(buildContext([]));
    await loadReadinessCard();

    // Readiness card present, but no gaps area rendered for an empty list.
    const card = screen.getByTestId('mdp-wizard-readiness-card');
    expect(
      within(card).queryByTestId('mdp-wizard-readiness-gaps')
    ).not.toBeInTheDocument();
  });
});
