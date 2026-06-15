/**
 * TargetArchitectureCompareView captured-decision integration tests
 *
 * Spec: 2026-05-26 Compare View Decoration with Decision Codes -- Task Group 3 (3.1).
 *
 * Three focused integration tests:
 *   1. No architecture-scope banner is rendered (removed 2026-06-01) even when
 *      architecture-scope decisions exist.
 *   2. No banner when only element-scope decisions are present either.
 *   3. Per-row chips render for matching element-scope decisions; superseded
 *      rows (supersededById !== null) are filtered out as defense-in-depth.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { TargetArchitectureCompareView } from './TargetArchitectureCompareView';
import type { CompareMapping } from './TargetArchitectureCompareView';
import type { ElementInventoryResponse } from '../../api/architecturesApi';
import type { DecommissionedInTargetAnnotation } from '../../api/targetArchitecturesApi';
import type { CapturedDecisionDto } from '../../api/architectConversationApi';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TARGET_ENTITY_ID = 'tgt-entity-uuid-1';
const CURRENT_ENTITY_ID = 'cur-entity-uuid-1';

function buildInventory(
  elementId: string,
  name: string,
): ElementInventoryResponse {
  return {
    domains: [
      {
        name: 'Data',
        types: [
          {
            name: 'Data entities',
            entityType: 'physical_data_entity',
            instances: [{ id: elementId, name }],
          },
        ],
      },
    ],
  } as unknown as ElementInventoryResponse;
}

function buildDecision(overrides: Partial<CapturedDecisionDto>): CapturedDecisionDto {
  return {
    decisionId: 'decision-uuid-default',
    projectId: 'project-uuid-1',
    targetArchitectureId: 'target-arch-uuid-1',
    decisionCode: 'db.engine',
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: 'PostgreSQL 15',
    answerSummary: 'Use PostgreSQL 15',
    standardsLookupRef: null,
    conversationThreadId: 'thread-uuid-1',
    conversationTurnRef: 'turn-ref-1',
    createdAt: '2026-05-26T10:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
    ...overrides,
  };
}

const baseMappings: CompareMapping[] = [
  {
    currentElementId: CURRENT_ENTITY_ID,
    targetElementId: TARGET_ENTITY_ID,
    mappingType: 'equivalent',
  },
];

const emptyAnnotations: DecommissionedInTargetAnnotation[] = [];

describe('TargetArchitectureCompareView captured-decision decoration', () => {
  it('does NOT render an architecture-scope banner (removed 2026-06-01) even when architecture-scope decisions exist', () => {
    const archDecision = buildDecision({
      decisionId: 'arch-decision-1',
      decisionCode: 'org.region',
      scopeKind: 'architecture',
      answerSummary: 'EU-only',
      answerValue: 'eu-west-1',
    });

    render(
      <TargetArchitectureCompareView
        currentInventory={buildInventory(CURRENT_ENTITY_ID, 'Customer')}
        targetInventory={buildInventory(TARGET_ENTITY_ID, 'Customer')}
        mappings={baseMappings}
        decommissionedAnnotations={emptyAnnotations}
        capturedDecisions={[archDecision]}
      />,
    );

    // The architecture-wide chip banner was removed from the compare view; the
    // decisions live in the Architect Conversation instead.
    expect(
      screen.queryByTestId('target-arch-compare-architecture-scope-banner'),
    ).not.toBeInTheDocument();
    // The compare view panel still renders normally.
    expect(screen.getByTestId('target-arch-compare-view')).toBeInTheDocument();
  });

  it('hides the banner when zero architecture-scope decisions exist', () => {
    const elementDecision = buildDecision({
      decisionId: 'elem-decision-1',
      decisionCode: 'db.engine',
      scopeKind: 'element',
      scopeRefType: 'physical_data_entity',
      scopeRefId: TARGET_ENTITY_ID,
    });

    render(
      <TargetArchitectureCompareView
        currentInventory={buildInventory(CURRENT_ENTITY_ID, 'Customer')}
        targetInventory={buildInventory(TARGET_ENTITY_ID, 'Customer')}
        mappings={baseMappings}
        decommissionedAnnotations={emptyAnnotations}
        capturedDecisions={[elementDecision]}
      />,
    );

    expect(
      screen.queryByTestId('target-arch-compare-architecture-scope-banner'),
    ).not.toBeInTheDocument();
    // The compare view panel still renders normally.
    expect(screen.getByTestId('target-arch-compare-view')).toBeInTheDocument();
  });

  it('renders per-row chips for matching element-scope decisions and filters out superseded rows', () => {
    const liveElementDecision = buildDecision({
      decisionId: 'elem-decision-live',
      decisionCode: 'db.engine',
      scopeKind: 'element',
      scopeRefType: 'physical_data_entity',
      scopeRefId: TARGET_ENTITY_ID,
      answerValue: 'PostgreSQL 15',
    });
    const supersededElementDecision = buildDecision({
      decisionId: 'elem-decision-superseded',
      decisionCode: 'db.engine.legacy',
      scopeKind: 'element',
      scopeRefType: 'physical_data_entity',
      scopeRefId: TARGET_ENTITY_ID,
      answerValue: 'MySQL 5.7',
      supersededById: 'elem-decision-live',
    });

    render(
      <TargetArchitectureCompareView
        currentInventory={buildInventory(CURRENT_ENTITY_ID, 'Customer')}
        targetInventory={buildInventory(TARGET_ENTITY_ID, 'Customer')}
        mappings={baseMappings}
        decommissionedAnnotations={emptyAnnotations}
        capturedDecisions={[liveElementDecision, supersededElementDecision]}
      />,
    );

    // Chip group is rendered inside the Target cell of the matching row.
    const chipGroup = screen.getByTestId(
      `target-arch-compare-decision-chips-${TARGET_ENTITY_ID}`,
    );
    expect(chipGroup).toBeInTheDocument();

    // Live decision's chip renders with its decisionCode label.
    expect(
      screen.getByTestId(`captured-decision-chip-${liveElementDecision.decisionId}`),
    ).toHaveTextContent('db.engine');

    // Superseded decision's chip is NOT rendered (defense-in-depth filter).
    expect(
      screen.queryByTestId(
        `captured-decision-chip-${supersededElementDecision.decisionId}`,
      ),
    ).not.toBeInTheDocument();
  });
});
