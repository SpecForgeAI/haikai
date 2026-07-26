/**
 * MigrationBookOfWork reference + header name resolution tests
 *
 * Spec 2026-06-26 Book-of-Work Scaffold + Reference Names -- Task Group 4.
 *
 * Whole-repo frontend baseline is red; run THIS file in isolation:
 *   npx vitest run src/components/ProductManager/MigrationDeliveryPlan/__tests__/MigrationBookOfWorkReferenceNames.test.tsx
 *
 * Coverage:
 *   1. Drawer renders `name (id)` for architecture refs via resolveRef.
 *   2. Drawer renders `title (id)` for discovery-finding refs via resolveRef.
 *   3. Drawer falls back to the raw id on a resolveRef miss (never blank).
 *   4. Drawer leaves mapping / source-context / evidence / API-baseline refs
 *      VERBATIM even when resolveRef is supplied.
 *   5. Workspace header shows `name (id)` for current/target arch ids from the
 *      listArchitectures fetch.
 *   6. Workspace header falls back to raw arch ids when listArchitectures
 *      rejects.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationBookOfWorkApi';

// --- Mock the CSS module so class-name assertions don't blow up ---------
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- Mock the API clients the workspace touches on mount ----------------
const mockGetMigrationBookOfWork = vi.fn();
vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    getMigrationBookOfWork: (...args: unknown[]) =>
      mockGetMigrationBookOfWork(...args),
  };
});

const mockListArchitectures = vi.fn();
vi.mock('../../../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architecturesApi')
  >('../../../../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: (...args: unknown[]) => mockListArchitectures(...args),
  };
});

const mockListDbMigrationPacks = vi.fn();
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPacks: (...args: unknown[]) =>
      mockListDbMigrationPacks(...args),
  };
});
// Carry-over accounting (2026-07-26): the workspace mounts the coverage read
// on render — pin a benign empty result so no test leaks a real fetch.
vi.mock('../../../../api/carryOverCoverageApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/carryOverCoverageApi')
  >('../../../../api/carryOverCoverageApi');
  return {
    ...actual,
    getCarryOverCoverage: vi.fn().mockResolvedValue({
      items: [],
      mustAccount: [],
      unaccounted: [],
      accountedCount: 0,
      totalMustAccount: 0,
      ok: true,
      architectureId: null,
      itemDetails: {},
    }),
  };
});

import MigrationBookOfWorkItemDrawer from '../MigrationBookOfWorkItemDrawer';
import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const ARCH_CURRENT = 'arch-current-uuid';
const ARCH_TARGET = 'arch-target-uuid';

function makeItem(
  overrides: Partial<MigrationBookOfWorkItem> = {},
): MigrationBookOfWorkItem {
  return {
    id: 'i-default',
    type: 'initiative',
    parentId: null,
    title: 'Default item',
    description: 'desc',
    acceptanceCriteria: [],
    workstream: 'other',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
    evidenceReferences: [],
    architectureReferences: [],
    apiBaselineReferences: [],
    discoveryFindingReferences: [],
    mappingReferences: [],
    sourceContextRefs: [],
    ...overrides,
  };
}

function makeDraft(
  items: MigrationBookOfWorkItem[],
  overrides: Partial<MigrationBookOfWorkDraft> = {},
): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_CURRENT,
    targetArchitectureId: ARCH_TARGET,
    status: 'draft',
    title: 'Test migration plan',
    summary: 'Summary text',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: { items },
    createdAt: '2026-06-26T10:00:00Z',
    updatedAt: '2026-06-26T10:00:00Z',
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    ...overrides,
  };
}

/** A resolveRef that knows one arch id and one finding id; raw on miss. */
function makeResolveRef() {
  return (type: 'architecture' | 'discoveryFinding', id: string): string => {
    if (type === 'architecture' && id === 'arch-known') {
      return `Payments Service (arch-known)`;
    }
    if (type === 'discoveryFinding' && id === 'finding-known') {
      return `Stale dependency (finding-known)`;
    }
    return id;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListDbMigrationPacks.mockResolvedValue([]);
  mockListArchitectures.mockResolvedValue([]);
});

// ----------------------------------------------------------------------------
// Drawer (presentational) tests
// ----------------------------------------------------------------------------

describe('MigrationBookOfWorkItemDrawer reference name resolution', () => {
  it('renders "name (id)" for architecture references via resolveRef', () => {
    const item = makeItem({
      id: 'item-arch',
      architectureReferences: ['arch-known'],
    });
    render(
      <MigrationBookOfWorkItemDrawer item={item} resolveRef={makeResolveRef()} />,
    );
    const list = screen.getByTestId('item-drawer-architecture-references');
    expect(list).toHaveTextContent('Payments Service (arch-known)');
  });

  it('renders "title (id)" for discovery-finding references via resolveRef', () => {
    const item = makeItem({
      id: 'item-finding',
      discoveryFindingReferences: ['finding-known'],
    });
    render(
      <MigrationBookOfWorkItemDrawer item={item} resolveRef={makeResolveRef()} />,
    );
    const list = screen.getByTestId('item-drawer-discovery-finding-references');
    expect(list).toHaveTextContent('Stale dependency (finding-known)');
  });

  it('falls back to the raw id on a resolveRef miss (never blank)', () => {
    const item = makeItem({
      id: 'item-miss',
      architectureReferences: ['arch-unknown-xyz'],
      discoveryFindingReferences: ['finding-unknown-xyz'],
    });
    render(
      <MigrationBookOfWorkItemDrawer item={item} resolveRef={makeResolveRef()} />,
    );
    expect(
      screen.getByTestId('item-drawer-architecture-references'),
    ).toHaveTextContent('arch-unknown-xyz');
    expect(
      screen.getByTestId('item-drawer-discovery-finding-references'),
    ).toHaveTextContent('finding-unknown-xyz');
  });

  it('leaves mapping / source-context / evidence / API-baseline refs verbatim', () => {
    const item = makeItem({
      id: 'item-verbatim',
      architectureReferences: ['arch-known'],
      evidenceReferences: ['arch-known'],
      apiBaselineReferences: ['arch-known'],
      mappingReferences: ['arch-known'],
      sourceContextRefs: ['arch-known'],
    });
    render(
      <MigrationBookOfWorkItemDrawer item={item} resolveRef={makeResolveRef()} />,
    );
    // Architecture list opts in -> resolved.
    expect(
      screen.getByTestId('item-drawer-architecture-references'),
    ).toHaveTextContent('Payments Service (arch-known)');
    // The other four render the raw id verbatim despite resolveRef present.
    for (const testId of [
      'item-drawer-evidence-references',
      'item-drawer-api-baseline-references',
      'item-drawer-mapping-references',
      'item-drawer-source-context-refs',
    ]) {
      const list = screen.getByTestId(testId);
      expect(list).toHaveTextContent('arch-known');
      expect(list).not.toHaveTextContent('Payments Service');
    }
  });
});

// ----------------------------------------------------------------------------
// Workspace header tests
// ----------------------------------------------------------------------------

describe('MigrationBookOfWorkReviewWorkspace header arch-id resolution', () => {
  it('shows "name (id)" for current/target arch ids from listArchitectures', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft([makeItem()]));
    mockListArchitectures.mockResolvedValueOnce([
      { id: ARCH_CURRENT, name: 'Legacy Monolith' },
      { id: ARCH_TARGET, name: 'Target Microservices' },
    ]);

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.getByTestId('review-current-arch')).toHaveTextContent(
        `Legacy Monolith (${ARCH_CURRENT})`,
      ),
    );
    expect(screen.getByTestId('review-target-arch')).toHaveTextContent(
      `Target Microservices (${ARCH_TARGET})`,
    );
  });

  it('falls back to raw arch ids when listArchitectures rejects', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft([makeItem()]));
    mockListArchitectures.mockRejectedValueOnce(new Error('boom'));

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('review-current-arch')).toHaveTextContent(
      ARCH_CURRENT,
    );
    expect(screen.getByTestId('review-current-arch')).not.toHaveTextContent('(');
    expect(screen.getByTestId('review-target-arch')).toHaveTextContent(
      ARCH_TARGET,
    );
  });
});
