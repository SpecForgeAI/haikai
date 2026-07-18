/**
 * MigrationDeliveryPlanWizard tests
 *
 * Spec Z (2026-07-17): the 7-stage wizard collapsed to THREE stages — Context &
 * inputs / Scope / Generate. Intent, migration style and Test Pack stages are
 * gone (intent inferred from the target-state conversation; phased is the only
 * in-tool model — Spec W; tests are peppered into build stories); data/cutover
 * folds into Scope. The scope streams use the plane-grouped Spec V vocabulary
 * (REST + SOAP merged into `api_migration`; reconciles are auto).
 *
 * Coverage:
 *   1. Wizard renders all 3 stages reachable (stepper + content advance).
 *   2. Stage 1 — current and target architecture pickers work.
 *   3. Stage 1 — discovery context + API baseline chips are selectable.
 *   4. Stage 2 (Scope) — plane-grouped stream chips default from context.
 *   5. Stage 3 (Generate) — confirmed-manifest closeout line renders
 *      "filename (tag)" entries comma-joined, and "None" on empty / error.
 *   6. Default helper utilities are sound (V vocabulary).
 *
 * Test strategy: pure-component testing with all external dependencies stubbed
 * via test-seam props. We never hit fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  MigrationDeliveryPlanWizard,
  ArchitectureOption,
  deriveDefaultDeliveryStreams,
  deriveDefaultTestPackExpectations,
  recommendMigrationStyle,
} from '../MigrationDeliveryPlanWizard';
import type { MigrationDiscoveryContext } from '../../../../api/migrationDiscoveryContextApi';
import type { GenerateMigrationDeliveryPlanResponse } from '../../../../api/migrationDeliveryPlanApi';
import type { LatestTargetManifest } from '../../../../api/targetManifestApi';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-aaa';
const CURRENT_ARCH_ID = 'arch-current-1';
const TARGET_ARCH_ID = 'arch-target-1';

const ARCHITECTURES: ArchitectureOption[] = [
  { id: CURRENT_ARCH_ID, name: 'Monolith (current)' },
  { id: TARGET_ARCH_ID, name: 'Microservices (target)' },
];

function buildContext(
  overrides: Partial<MigrationDiscoveryContext> = {}
): MigrationDiscoveryContext {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: CURRENT_ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    generatedAt: '2026-05-17T10:00:00Z',
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
          createdAt: '2026-05-15T10:00:00Z',
          updatedAt: '2026-05-15T11:00:00Z',
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
          createdAt: '2026-05-14T10:00:00Z',
        },
      ],
    },
    architectureMappingsSummary: { totalMappings: 4 },
    readinessAssessment: {
      overallStatus: 'partial',
      apiReadiness: 'ready',
      dataReadiness: 'partial',
      infrastructureReadiness: 'partial',
      gaps: ['mappings sparse'],
    },
    runtimeUsageSummary: { hasRuntimeEvidence: true },
    databaseDiscoverySummary: { databaseFindingCount: 3 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function renderWizard(opts: {
  context?: MigrationDiscoveryContext | null;
  generateResult?: GenerateMigrationDeliveryPlanResponse;
  manifests?: LatestTargetManifest[];
  fetchManifests?: ReturnType<typeof vi.fn>;
  onGenerationComplete?: ReturnType<typeof vi.fn>;
  onClose?: ReturnType<typeof vi.fn>;
} = {}) {
  const onGenerationComplete = opts.onGenerationComplete ?? vi.fn();
  const onClose = opts.onClose ?? vi.fn();
  const ctx = opts.context === null ? null : opts.context ?? buildContext();
  const fetchContext = vi.fn().mockResolvedValue(ctx);
  const generate = vi
    .fn()
    .mockResolvedValue(
      opts.generateResult ?? {
        draftId: 'draft-1',
        summary: 'A short draft summary',
      }
    );
  const fetchManifests =
    opts.fetchManifests ?? vi.fn().mockResolvedValue(opts.manifests ?? []);
  const utils = render(
    <MigrationDeliveryPlanWizard
      open
      projectId={PROJECT_ID}
      architectures={ARCHITECTURES}
      onClose={onClose as never}
      onGenerationComplete={onGenerationComplete as never}
      fetchContext={fetchContext as never}
      generate={generate as never}
      fetchManifests={fetchManifests as never}
    />
  );
  return { ...utils, fetchContext, generate, fetchManifests, onGenerationComplete, onClose };
}

// Drive the wizard from Stage 1 to Stage N by clicking Next. The 3-stage flow
// gates only on Stage 1 (both architectures picked); Scope has no gate.
async function advanceToStage(n: number) {
  fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
    target: { value: CURRENT_ARCH_ID },
  });
  fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
    target: { value: TARGET_ARCH_ID },
  });
  await waitFor(() => {
    expect(screen.getByTestId('mdp-wizard-readiness-card')).toBeInTheDocument();
  });
  let current = 1;
  while (current < n) {
    const next = screen.getByTestId('mdp-wizard-next');
    if ((next as HTMLButtonElement).disabled) {
      throw new Error(`Cannot advance from stage ${current}: Next is disabled`);
    }
    fireEvent.click(next);
    current += 1;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('MigrationDeliveryPlanWizard — all 3 stages reachable (Spec Z)', () => {
  it('renders the stepper with 3 stages and advances Context -> Scope -> Generate', async () => {
    renderWizard();

    // Exactly 3 step pills render; there is no 4th.
    for (let n = 1; n <= 3; n += 1) {
      expect(screen.getByTestId(`mdp-wizard-step-${n}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('mdp-wizard-step-4')).not.toBeInTheDocument();

    // Stage 1 content is visible.
    expect(screen.getByTestId('mdp-wizard-current-arch')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
      target: { value: CURRENT_ARCH_ID },
    });
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: TARGET_ARCH_ID },
    });
    await waitFor(() =>
      expect(screen.getByTestId('mdp-wizard-readiness-card')).toBeInTheDocument()
    );

    // Stage 1 -> 2 (Scope).
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));
    expect(screen.getByTestId('mdp-wizard-stream-chips')).toBeInTheDocument();

    // Stage 2 -> 3 (Generate).
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));
    expect(screen.getByTestId('mdp-wizard-review-summary')).toBeInTheDocument();
    expect(screen.getByTestId('mdp-wizard-generate')).toBeInTheDocument();

    // The removed stages' surfaces do not exist any more.
    expect(screen.queryByTestId('mdp-wizard-intent-chips')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mdp-wizard-style-radios')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mdp-wizard-test-pack-chips')).not.toBeInTheDocument();
  });
});

describe('MigrationDeliveryPlanWizard — Stage 1 architecture pickers', () => {
  it('lets the user select current and target architectures', async () => {
    renderWizard();
    const currentSelect = screen.getByTestId('mdp-wizard-current-arch') as HTMLSelectElement;
    const targetSelect = screen.getByTestId('mdp-wizard-target-arch') as HTMLSelectElement;

    expect(screen.getByTestId('mdp-wizard-next')).toBeDisabled();
    fireEvent.change(currentSelect, { target: { value: CURRENT_ARCH_ID } });
    expect(currentSelect.value).toBe(CURRENT_ARCH_ID);
    expect(screen.getByTestId('mdp-wizard-next')).toBeDisabled();

    fireEvent.change(targetSelect, { target: { value: TARGET_ARCH_ID } });
    expect(targetSelect.value).toBe(TARGET_ARCH_ID);
    await waitFor(() => {
      expect(screen.getByTestId('mdp-wizard-next')).not.toBeDisabled();
    });
  });
});

describe('MigrationDeliveryPlanWizard — Stage 1 discovery + baseline chips', () => {
  it('renders discovery run + API baseline selection chips from context', async () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
      target: { value: CURRENT_ARCH_ID },
    });
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: TARGET_ARCH_ID },
    });

    await waitFor(() => {
      expect(screen.getByTestId('mdp-wizard-discovery-run-run-1')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('mdp-wizard-baseline-baseline-1')).toBeInTheDocument();
    });

    const runChip = screen.getByTestId('mdp-wizard-discovery-run-run-1');
    expect(runChip.className).toMatch(/chipSelected/);
    fireEvent.click(runChip);
    expect(runChip.className).not.toMatch(/chipSelected/);
  });
});

describe('MigrationDeliveryPlanWizard — Stage 2 Scope (Spec V/Z plane vocabulary)', () => {
  it('seeds the plane-grouped stream chips from context defaults', async () => {
    renderWizard();
    await advanceToStage(2);

    // apiReadiness + dataReadiness in the fixture seed api_migration + data.
    const apiStream = screen.getByTestId('mdp-wizard-stream-api_migration');
    const dataStream = screen.getByTestId('mdp-wizard-stream-data_migration');
    expect(apiStream).toHaveAttribute('aria-pressed', 'true');
    expect(dataStream).toHaveAttribute('aria-pressed', 'true');

    // The pre-reframe streams are gone from the vocabulary.
    expect(
      screen.queryByTestId('mdp-wizard-stream-target_service_api_implementation')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mdp-wizard-stream-migration_test_pack')
    ).not.toBeInTheDocument();

    // Streams are toggleable.
    fireEvent.click(apiStream);
    expect(apiStream).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('MigrationDeliveryPlanWizard — Stage 3 Generate: manifest closeout line', () => {
  it('renders "filename (tag)" entries comma-joined when the read returns manifests', async () => {
    const fetchManifests = vi.fn().mockResolvedValue([
      { manifestPath: 'services/orders/pom.xml', tag: 'orders-service', kind: 'maven_pom' },
      { manifestPath: 'apps/web-bff/package.json', tag: 'web-bff', kind: 'npm_package' },
    ] as LatestTargetManifest[]);
    renderWizard({ fetchManifests });

    await advanceToStage(3);

    await waitFor(() => {
      expect(fetchManifests).toHaveBeenCalledWith(PROJECT_ID, TARGET_ARCH_ID);
    });
    const line = await screen.findByTestId('mdp-wizard-review-manifests');
    await waitFor(() => {
      expect(line).toHaveTextContent('pom.xml (orders-service), package.json (web-bff)');
    });
  });

  it('renders "None" when the read returns no manifests', async () => {
    const fetchManifests = vi.fn().mockResolvedValue([] as LatestTargetManifest[]);
    renderWizard({ fetchManifests });

    await advanceToStage(3);

    const line = await screen.findByTestId('mdp-wizard-review-manifests');
    await waitFor(() => {
      expect(line).toHaveTextContent('None');
    });
    expect(line.textContent).not.toContain('(');
  });
});

describe('MigrationDeliveryPlanWizard — default helper utilities (V vocabulary)', () => {
  it('deriveDefaultDeliveryStreams seeds api_migration + data (not the pre-reframe streams)', () => {
    const ctx = buildContext();
    const defaults = deriveDefaultDeliveryStreams(ctx);
    expect(defaults).toEqual(
      expect.arrayContaining(['api_migration', 'data_migration'])
    );
    // Reconciles/tests are no longer user-picked streams.
    expect(defaults).not.toContain('migration_test_pack');
    expect(defaults).not.toContain('reconciliation_reporting');
    expect(defaults).not.toContain('target_service_api_implementation');
  });

  it('deriveDefaultTestPackExpectations always includes use_recommended_coverage', () => {
    const ctx = buildContext();
    const defaults = deriveDefaultTestPackExpectations(ctx);
    expect(defaults).toContain('use_recommended_coverage');
    expect(defaults).toContain('api_contract_compatibility');
  });

  it('recommendMigrationStyle still resolves from context (retained export)', () => {
    expect(recommendMigrationStyle(buildContext())).toBe('strangler');
    expect(recommendMigrationStyle(null)).toBe('unsure_recommend');
  });
});
