/**
 * MigrationDeliverySummaryCards + WorkstreamProgressStrip tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 8 (Frontend tests 22 + 23).
 *
 * Coverage:
 *   - Test 4 (Frontend test 22): summary cards render counts from all 5
 *     summary DTOs (`summary`, `specGenerationSummary`, `backlogSaveSummary`,
 *     `implementationSummary`, `evidenceSummary`).
 *   - Test 5 (Frontend test 23): workstream progress strip renders one row
 *     per `workstreamSummaries` entry.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import MigrationDeliverySummaryCards from '../MigrationDeliverySummaryCards';
import MigrationDeliveryWorkstreamProgressStrip from '../MigrationDeliveryWorkstreamProgressStrip';
import type {
  MigrationDeliverySummaryDto,
  MigrationDeliverySpecGenerationSummaryDto,
  MigrationDeliveryBacklogSaveSummaryDto,
  MigrationDeliveryImplementationSummaryDto,
  MigrationDeliveryEvidenceSummaryDto,
  MigrationDeliveryWorkstreamSummaryDto,
} from '../../../../api/migrationDeliveryDashboardApi';

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// Fixtures
// ============================================================================

const SUMMARY: MigrationDeliverySummaryDto = {
  totalInitiativeCount: 1,
  totalEpicCount: 2,
  totalFeatureCount: 3,
  totalStoryCount: 10,
  needsAttentionCount: 4,
};

const SPEC_GEN: MigrationDeliverySpecGenerationSummaryDto = {
  notAttemptedCount: 1,
  generatedCount: 5,
  generatedWithWarningsCount: 2,
  insufficientContextCount: 1,
  failedCount: 1,
  skippedBlockedCount: 0,
};

const BACKLOG: MigrationDeliveryBacklogSaveSummaryDto = {
  savedCount: 8,
  notSavedToBacklogCount: 2,
};

const IMPLEMENTATION: MigrationDeliveryImplementationSummaryDto = {
  notStartedCount: 4,
  inProgressCount: 3,
  blockedCount: 1,
  completedCount: 2,
  activeCount: 5,
};

const EVIDENCE: MigrationDeliveryEvidenceSummaryDto = {
  evidenceReferenceCount: 7,
  discoveryFindingReferenceCount: 3,
  apiBaselineReferenceCount: 2,
  mappingReferenceCount: 4,
  architectureReferenceCount: 1,
  anyCoverageCount: 6,
};

// ============================================================================
// Test 4 -- summary cards render counts from all 5 summary DTOs (Frontend 22)
// ============================================================================

describe('MigrationDeliverySummaryCards -- renders counts from all 5 summary DTOs (Frontend test 22)', () => {
  it('renders backlog, spec, needs-attention, implementation, and evidence cards with correct values', () => {
    render(
      <MigrationDeliverySummaryCards
        summary={SUMMARY}
        specGenerationSummary={SPEC_GEN}
        backlogSaveSummary={BACKLOG}
        implementationSummary={IMPLEMENTATION}
        evidenceSummary={EVIDENCE}
      />,
    );

    // Card 1: backlog -- saved 8 / total 10
    const backlog = screen.getByTestId('mdd-summary-card-backlog-value');
    expect(backlog).toHaveTextContent('8');
    expect(backlog).toHaveTextContent('10');
    const backlogCard = screen.getByTestId('mdd-summary-card-backlog');
    expect(backlogCard).toHaveTextContent(/Saved:\s*8/);
    expect(backlogCard).toHaveTextContent(/Not saved:\s*2/);

    // Card 2: specs -- generated + generated_with_warnings = 5 + 2 = 7
    const specs = screen.getByTestId('mdd-summary-card-specs-value');
    expect(specs).toHaveTextContent('7');
    const specsCard = screen.getByTestId('mdd-summary-card-specs');
    expect(specsCard).toHaveTextContent(/Generated:\s*5/);
    expect(specsCard).toHaveTextContent(/With warnings:\s*2/);
    expect(specsCard).toHaveTextContent(/Insufficient:\s*1/);
    expect(specsCard).toHaveTextContent(/Failed:\s*1/);
    expect(specsCard).toHaveTextContent(/Blocked:\s*0/);
    expect(specsCard).toHaveTextContent(/Not attempted:\s*1/);

    // Card 3: needs attention = 4
    expect(
      screen.getByTestId('mdd-summary-card-needs-attention-value'),
    ).toHaveTextContent('4');

    // Card 4: implementation active = 5
    const impl = screen.getByTestId('mdd-summary-card-implementation-value');
    expect(impl).toHaveTextContent('5');
    const implCard = screen.getByTestId('mdd-summary-card-implementation');
    expect(implCard).toHaveTextContent(/In progress:\s*3/);
    expect(implCard).toHaveTextContent(/Completed:\s*2/);
    expect(implCard).toHaveTextContent(/Blocked:\s*1/);

    // Card 5: evidence any_coverage = 6
    const ev = screen.getByTestId('mdd-summary-card-evidence-value');
    expect(ev).toHaveTextContent('6');
    const evCard = screen.getByTestId('mdd-summary-card-evidence');
    expect(evCard).toHaveTextContent(/Evidence refs:\s*7/);
    expect(evCard).toHaveTextContent(/Findings:\s*3/);
    expect(evCard).toHaveTextContent(/Baselines:\s*2/);
    expect(evCard).toHaveTextContent(/Mappings:\s*4/);
    expect(evCard).toHaveTextContent(/Architectures:\s*1/);
  });
});

// ============================================================================
// Test 5 -- workstream strip renders one row per entry (Frontend 23)
// ============================================================================

describe('MigrationDeliveryWorkstreamProgressStrip -- renders one row per entry (Frontend test 23)', () => {
  it('renders one row per workstreamSummaries entry with cells for each column', () => {
    const workstreams: MigrationDeliveryWorkstreamSummaryDto[] = [
      {
        workstream: 'auth',
        totalStoryCount: 6,
        savedToBacklogCount: 5,
        specGeneratedCount: 4,
        implementationActiveCount: 2,
        evidenceCoveredCount: 1,
        needsAttentionCount: 1,
      },
      {
        workstream: 'billing',
        totalStoryCount: 4,
        savedToBacklogCount: 3,
        specGeneratedCount: 3,
        implementationActiveCount: 3,
        evidenceCoveredCount: 2,
        needsAttentionCount: 0,
      },
      {
        workstream: 'core',
        totalStoryCount: 2,
        savedToBacklogCount: 0,
        specGeneratedCount: 0,
        implementationActiveCount: 0,
        evidenceCoveredCount: 0,
        needsAttentionCount: 2,
      },
    ];

    render(
      <MigrationDeliveryWorkstreamProgressStrip
        workstreamSummaries={workstreams}
      />,
    );

    // One row per entry.
    expect(screen.getByTestId('mdd-workstream-row-auth')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-workstream-row-billing')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-workstream-row-core')).toBeInTheDocument();

    // Spot-check column values.
    expect(
      screen.getByTestId('mdd-workstream-row-auth-total'),
    ).toHaveTextContent('6');
    expect(
      screen.getByTestId('mdd-workstream-row-auth-specs'),
    ).toHaveTextContent('4');
    expect(
      screen.getByTestId('mdd-workstream-row-billing-impl'),
    ).toHaveTextContent('3');
    expect(
      screen.getByTestId('mdd-workstream-row-core-attention'),
    ).toHaveTextContent('2');
    expect(
      screen.getByTestId('mdd-workstream-row-core-saved'),
    ).toHaveTextContent('0');

    // Headers visible.
    expect(screen.getByTestId('mdd-workstream-col-name')).toHaveTextContent(
      /Workstream/i,
    );
    expect(screen.getByTestId('mdd-workstream-col-attention')).toHaveTextContent(
      /Needs attention/i,
    );
  });
});
