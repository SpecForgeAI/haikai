/**
 * MigrationDeliveryPlanWizard tests
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 9.1 — focused coverage of the 7-stage wizard surface.
 *
 * Coverage:
 *   1. Wizard renders all 7 stages reachable (stepper + content advance).
 *   2. Stage 1 — current and target architecture pickers work.
 *   3. Stage 1 — discovery context + API baseline chips are selectable.
 *   4. Stage 2 — migration intent supports multiple chip selections; no
 *      functional-equivalence option exists (mandatory per spec.md).
 *   5. Stage 4 — migration style radio group is mutually exclusive.
 *   6. Stage 5 — data/cutover answers persist across Back / Next navigation.
 *   7. Stage 3 + 6 — defaults populate from context where the spec says.
 *   8. Stage 7 — confirmed-manifest "Manifest Uploaded" closeout line renders
 *      "filename (tag)" entries comma-joined, and "None" on empty / error
 *      (Spec 5 Phase 2 follow-up, 2026-06-25).
 *
 * Test strategy: pure-component testing with all external dependencies
 * stubbed via Vitest module mocks. We never hit fetch and never depend on
 * any provider higher in the tree.
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

/**
 * Helper: render the wizard with default props and pre-resolved fetch/generate
 * stubs. Tests can override per case.
 */
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
  // Stage-7 confirmed-manifest read seam (fail-soft client). Defaults to an
  // empty list so existing tests that never reach Stage 7 are unaffected.
  const fetchManifests =
    opts.fetchManifests ?? vi.fn().mockResolvedValue(opts.manifests ?? []);
  const utils = render(
    <MigrationDeliveryPlanWizard
      open
      projectId={PROJECT_ID}
      architectures={ARCHITECTURES}
      onClose={onClose as never}
      onGenerationComplete={onGenerationComplete as never}
      // We use the test seams instead of mocking the modules — simpler and
      // doesn't need vi.mock at module load.
      fetchContext={fetchContext as never}
      generate={generate as never}
      fetchManifests={fetchManifests as never}
    />
  );
  return { ...utils, fetchContext, generate, fetchManifests, onGenerationComplete, onClose };
}

// Drive the wizard from Stage 1 to Stage N by clicking Next N-1 times,
// optionally setting up stage-2+ data first.
async function advanceToStage(n: number) {
  // Stage 1: pick both architectures so Next becomes enabled.
  fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
    target: { value: CURRENT_ARCH_ID },
  });
  fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
    target: { value: TARGET_ARCH_ID },
  });
  // Wait for context to load + defaults to populate.
  await waitFor(() => {
    expect(screen.getByTestId('mdp-wizard-readiness-card')).toBeInTheDocument();
  });
  let current = 1;
  while (current < n) {
    if (current === 1) {
      // Already gating-eligible.
    } else if (current === 2) {
      // Need at least one intent.
      if (
        !screen.queryByTestId('mdp-wizard-intent-like_for_like_replacement')
      ) {
        // already advanced
      } else {
        // Pick one intent.
        fireEvent.click(
          screen.getByTestId('mdp-wizard-intent-like_for_like_replacement')
        );
      }
    }
    const next = screen.getByTestId('mdp-wizard-next');
    if ((next as HTMLButtonElement).disabled) {
      throw new Error(
        `Cannot advance from stage ${current}: Next is disabled`
      );
    }
    fireEvent.click(next);
    current += 1;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('MigrationDeliveryPlanWizard — all 7 stages reachable (Task 9.1 #1)', () => {
  it('renders the stepper with all 7 stages and advances stage by stage', async () => {
    renderWizard();

    // All 7 step pills render.
    for (let n = 1; n <= 7; n += 1) {
      expect(screen.getByTestId(`mdp-wizard-step-${n}`)).toBeInTheDocument();
    }

    // Stage 1 content is visible.
    expect(screen.getByTestId('mdp-wizard-current-arch')).toBeInTheDocument();

    // Advance through every stage. We must satisfy each stage gate first.
    fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
      target: { value: CURRENT_ARCH_ID },
    });
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: TARGET_ARCH_ID },
    });

    // Stage 1 -> 2
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    // Stage 2: pick an intent so Next enables.
    await waitFor(() =>
      expect(screen.getByTestId('mdp-wizard-intent-chips')).toBeInTheDocument()
    );
    fireEvent.click(
      screen.getByTestId('mdp-wizard-intent-monolith_to_service_decomposition')
    );
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    // Stage 3
    expect(screen.getByTestId('mdp-wizard-stream-chips')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    // Stage 4
    expect(screen.getByTestId('mdp-wizard-style-radios')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    // Stage 5
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    // Stage 6
    expect(screen.getByTestId('mdp-wizard-test-pack-chips')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    // Stage 7
    expect(screen.getByTestId('mdp-wizard-review-summary')).toBeInTheDocument();
    expect(screen.getByTestId('mdp-wizard-generate')).toBeInTheDocument();
  });
});

describe('MigrationDeliveryPlanWizard — Stage 1 architecture pickers (Task 9.1 #2)', () => {
  it('lets the user select current and target architectures', async () => {
    renderWizard();
    const currentSelect = screen.getByTestId(
      'mdp-wizard-current-arch'
    ) as HTMLSelectElement;
    const targetSelect = screen.getByTestId(
      'mdp-wizard-target-arch'
    ) as HTMLSelectElement;

    // Next is disabled until both selections are made.
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

describe('MigrationDeliveryPlanWizard — Stage 1 discovery + baseline chips (Task 9.1 #3)', () => {
  it('renders discovery run + API baseline selection chips from context', async () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
      target: { value: CURRENT_ARCH_ID },
    });
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: TARGET_ARCH_ID },
    });

    // Context loads asynchronously; chips appear once promise resolves.
    await waitFor(() => {
      expect(screen.getByTestId('mdp-wizard-discovery-run-run-1')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('mdp-wizard-baseline-baseline-1')).toBeInTheDocument();
    });

    // The latest run should be auto-selected; clicking deselects it.
    const runChip = screen.getByTestId('mdp-wizard-discovery-run-run-1');
    expect(runChip.className).toMatch(/chipSelected/);
    fireEvent.click(runChip);
    expect(runChip.className).not.toMatch(/chipSelected/);
  });
});

describe('MigrationDeliveryPlanWizard — Stage 2 multi-select intent (Task 9.1 #4)', () => {
  it('supports multiple intent chip selections and never exposes functional-equivalence', async () => {
    renderWizard();
    await advanceToStage(2);

    // Functional equivalence MUST NOT appear as a chip (it's mandatory per
    // spec.md; never asked).
    expect(
      screen.queryByText(/functional equivalence/i)
    ).not.toBeInTheDocument();

    const c1 = screen.getByTestId('mdp-wizard-intent-like_for_like_replacement');
    const c2 = screen.getByTestId(
      'mdp-wizard-intent-monolith_to_service_decomposition'
    );
    const c3 = screen.getByTestId('mdp-wizard-intent-data_migration');

    fireEvent.click(c1);
    fireEvent.click(c2);
    fireEvent.click(c3);

    expect(c1).toHaveAttribute('aria-pressed', 'true');
    expect(c2).toHaveAttribute('aria-pressed', 'true');
    expect(c3).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('MigrationDeliveryPlanWizard — Stage 4 single-select migration style (Task 9.1 #5)', () => {
  it('makes the migration style radio group mutually exclusive', async () => {
    renderWizard();
    await advanceToStage(2);
    fireEvent.click(
      screen.getByTestId('mdp-wizard-intent-like_for_like_replacement')
    );
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));
    // Stage 3 -> 4
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    const strangler = screen.getByTestId('mdp-wizard-style-strangler') as HTMLInputElement;
    const phased = screen.getByTestId('mdp-wizard-style-phased') as HTMLInputElement;
    const bigBang = screen.getByTestId('mdp-wizard-style-big_bang') as HTMLInputElement;

    fireEvent.click(strangler);
    expect(strangler.checked).toBe(true);
    expect(phased.checked).toBe(false);
    expect(bigBang.checked).toBe(false);

    fireEvent.click(bigBang);
    expect(strangler.checked).toBe(false);
    expect(phased.checked).toBe(false);
    expect(bigBang.checked).toBe(true);
  });
});

describe('MigrationDeliveryPlanWizard — Stage 5 answers persist across navigation (Task 9.1 #6)', () => {
  it('keeps data and cutover selections after Back + Next round trip', async () => {
    renderWizard();
    await advanceToStage(2);
    fireEvent.click(
      screen.getByTestId('mdp-wizard-intent-like_for_like_replacement')
    );
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 3
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 4
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 5

    const dataIncremental = screen.getByTestId(
      'mdp-wizard-data-approach-incremental'
    ) as HTMLInputElement;
    const cutoverBlueGreen = screen.getByTestId(
      'mdp-wizard-cutover-approach-blue_green'
    ) as HTMLInputElement;
    const rollbackYes = screen.getByTestId(
      'mdp-wizard-rollback-yes'
    ) as HTMLInputElement;

    fireEvent.click(dataIncremental);
    fireEvent.click(cutoverBlueGreen);
    fireEvent.click(rollbackYes);
    expect(dataIncremental.checked).toBe(true);
    expect(cutoverBlueGreen.checked).toBe(true);
    expect(rollbackYes.checked).toBe(true);

    // Back to Stage 4 then forward to Stage 5 again.
    fireEvent.click(screen.getByTestId('mdp-wizard-back'));
    expect(screen.getByTestId('mdp-wizard-style-radios')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));

    const dataIncremental2 = screen.getByTestId(
      'mdp-wizard-data-approach-incremental'
    ) as HTMLInputElement;
    const cutoverBlueGreen2 = screen.getByTestId(
      'mdp-wizard-cutover-approach-blue_green'
    ) as HTMLInputElement;
    const rollbackYes2 = screen.getByTestId(
      'mdp-wizard-rollback-yes'
    ) as HTMLInputElement;
    expect(dataIncremental2.checked).toBe(true);
    expect(cutoverBlueGreen2.checked).toBe(true);
    expect(rollbackYes2.checked).toBe(true);
  });
});

describe('MigrationDeliveryPlanWizard — context-derived defaults (Task 9.1 #7)', () => {
  it('seeds Stage 3 delivery streams and Stage 6 Test Pack chips from context defaults', async () => {
    renderWizard();
    // Stage 1 -> picks fire the context fetch.
    fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
      target: { value: CURRENT_ARCH_ID },
    });
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: TARGET_ARCH_ID },
    });
    // Wait for defaults to apply.
    await waitFor(() => {
      expect(screen.getByTestId('mdp-wizard-readiness-card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 2

    // Pick one intent to satisfy the gate, then advance.
    fireEvent.click(
      screen.getByTestId('mdp-wizard-intent-like_for_like_replacement')
    );
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 3

    // The context fixture provides apiReadiness + dataReadiness which seed
    // `target_service_api_implementation` + `data_migration` etc.
    const apiStream = screen.getByTestId(
      'mdp-wizard-stream-target_service_api_implementation'
    );
    const dataStream = screen.getByTestId('mdp-wizard-stream-data_migration');
    const testPackStream = screen.getByTestId(
      'mdp-wizard-stream-migration_test_pack'
    );
    expect(apiStream).toHaveAttribute('aria-pressed', 'true');
    expect(dataStream).toHaveAttribute('aria-pressed', 'true');
    // Findings > 0 in fixture seeds migration_test_pack.
    expect(testPackStream).toHaveAttribute('aria-pressed', 'true');

    // Advance to Stage 6 and verify Test Pack defaults.
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 4
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 5
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // -> 6

    expect(
      screen.getByTestId('mdp-wizard-test-pack-use_recommended_coverage')
    ).toHaveAttribute('aria-pressed', 'true');
    // Baseline summary in fixture seeds api_contract_compatibility.
    expect(
      screen.getByTestId('mdp-wizard-test-pack-api_contract_compatibility')
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('MigrationDeliveryPlanWizard — Stage 7 confirmed-manifest closeout line (Task 9.1 #8)', () => {
  it('renders "filename (tag)" entries comma-joined when the read returns manifests', async () => {
    const fetchManifests = vi.fn().mockResolvedValue([
      { manifestPath: 'services/orders/pom.xml', tag: 'orders-service', kind: 'maven_pom' },
      { manifestPath: 'apps/web-bff/package.json', tag: 'web-bff', kind: 'npm_package' },
    ] as LatestTargetManifest[]);
    renderWizard({ fetchManifests });

    await advanceToStage(7);

    // The read fires once Stage 7 is shown, scoped to the chosen target arch.
    await waitFor(() => {
      expect(fetchManifests).toHaveBeenCalledWith(PROJECT_ID, TARGET_ARCH_ID);
    });

    const line = await screen.findByTestId('mdp-wizard-review-manifests');
    await waitFor(() => {
      expect(line).toHaveTextContent(
        'pom.xml (orders-service), package.json (web-bff)'
      );
    });
  });

  it('derives the filename from kind when a row has an empty manifest path', async () => {
    const fetchManifests = vi.fn().mockResolvedValue([
      { manifestPath: '', tag: 'orders-service', kind: 'maven_pom' },
    ] as LatestTargetManifest[]);
    renderWizard({ fetchManifests });

    await advanceToStage(7);

    const line = await screen.findByTestId('mdp-wizard-review-manifests');
    await waitFor(() => {
      expect(line).toHaveTextContent('pom.xml (orders-service)');
    });
  });

  it('renders "None" when the read returns no manifests', async () => {
    const fetchManifests = vi.fn().mockResolvedValue([] as LatestTargetManifest[]);
    renderWizard({ fetchManifests });

    await advanceToStage(7);

    const line = await screen.findByTestId('mdp-wizard-review-manifests');
    await waitFor(() => {
      expect(line).toHaveTextContent('None');
    });
  });

  it('renders "None" when the read fails soft (client resolves to [])', async () => {
    // The fail-soft client resolves to [] rather than throwing; the wizard
    // treats that exactly like an empty list.
    const fetchManifests = vi.fn().mockResolvedValue([] as LatestTargetManifest[]);
    renderWizard({ fetchManifests });

    await advanceToStage(7);

    const line = await screen.findByTestId('mdp-wizard-review-manifests');
    await waitFor(() => {
      expect(line).toHaveTextContent('None');
    });
    expect(line.textContent).not.toContain('(');
  });
});

describe('MigrationDeliveryPlanWizard — default helper utilities are sound', () => {
  it('deriveDefaultDeliveryStreams seeds API+data+test streams from a populated context', () => {
    const ctx = buildContext();
    const defaults = deriveDefaultDeliveryStreams(ctx);
    expect(defaults).toEqual(
      expect.arrayContaining([
        'target_service_api_implementation',
        'data_migration',
        'migration_test_pack',
      ])
    );
  });

  it('deriveDefaultTestPackExpectations always includes use_recommended_coverage', () => {
    const ctx = buildContext();
    const defaults = deriveDefaultTestPackExpectations(ctx);
    expect(defaults).toContain('use_recommended_coverage');
    expect(defaults).toContain('api_contract_compatibility');
  });

  it('recommendMigrationStyle returns strangler when apiReadiness is ready', () => {
    const ctx = buildContext();
    expect(recommendMigrationStyle(ctx)).toBe('strangler');
  });

  it('recommendMigrationStyle defaults to unsure_recommend when context is null', () => {
    expect(recommendMigrationStyle(null)).toBe('unsure_recommend');
  });
});
