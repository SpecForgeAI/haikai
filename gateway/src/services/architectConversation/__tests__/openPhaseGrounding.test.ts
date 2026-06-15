/**
 * Open-phase LLM grounding assembly — gateway tests (Spec
 * 2026-06-06-architect-conversation-open-ended-phase, Task Group 2; 2.1).
 *
 * Scope: PURE context assembly only — NO LLM, NO I/O. The underlying captured-
 * decisions renderer (`buildTargetStateDecisionsPromptText`) is MOCKED so these
 * tests prove the helper REUSES it (rather than re-implementing it) and that the
 * four grounding sources are composed correctly:
 *
 *   1. captured decisions so far (via `buildTargetStateDecisionsPromptText`)
 *   2. the loaded target-model summary (from the discovery context)
 *   3. the migration goal / product summary
 *   4. the discovery-findings summary WHEN AVAILABLE — with a clean three-source
 *      fallback when findings are absent / empty (Q1).
 *
 * 8 focused tests (the 2.1 cap).
 */

// ---------------------------------------------------------------------------
// Mock the underlying captured-decisions resolver so we can assert REUSE.
// `requireActual` spread keeps every other export intact (the helper imports
// only `buildTargetStateDecisionsPromptText` from this module, but the spread
// is belt-and-braces against incidental coupling).
// ---------------------------------------------------------------------------

const mockBuildDecisionsText = jest.fn(
  (_decisions: unknown) => 'RENDERED_DECISIONS_BLOCK',
);

jest.mock('../../contextResolvers', () => ({
  ...jest.requireActual('../../contextResolvers'),
  buildTargetStateDecisionsPromptText: (d: unknown) => mockBuildDecisionsText(d),
}));

// ---------------------------------------------------------------------------
// Imports (after the mock)
// ---------------------------------------------------------------------------

import {
  buildOpenPhaseGrounding,
  type OpenPhaseGroundingInput,
} from '../openPhaseGrounding';
import type { MigrationDiscoveryContext } from '../../migrationDiscoveryContextClient';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function decision(
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return {
    decisionId: '00000000-0000-0000-0000-000000000001',
    projectId: 'proj-test',
    targetArchitectureId: 'target-abc',
    decisionCode: 'db.engine',
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: 'Postgres 18',
    answerSummary: 'Postgres 18',
    standardsLookupRef: null,
    conversationThreadId: null,
    conversationTurnRef: null,
    createdAt: '2026-06-06T00:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
    ...overrides,
  };
}

/** A discovery context carrying BOTH a target-model summary and findings. */
function discoveryContextWithFindings(): MigrationDiscoveryContext {
  return {
    projectId: 'proj-test',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    generatedAt: '2026-06-06T00:00:00Z',
    targetArchitectureSummary: {
      architectureId: 'arch-target',
      name: 'Target Platform',
      serviceCount: 7,
      dataEntityCount: 42,
    },
    findingsSummary: {
      totalFindings: 18,
      highSeverityUnreviewedCount: 3,
      countsBySeverity: { high: 4, medium: 9, low: 5 },
      countsByCategory: { 'data-access': 6, batch: 2 },
    },
  };
}

function baseInput(
  overrides: Partial<OpenPhaseGroundingInput> = {},
): OpenPhaseGroundingInput {
  return {
    capturedDecisions: [decision()],
    discoveryContext: discoveryContextWithFindings(),
    productSummary: 'Product Summary:\nMigrate the billing engine like-for-like.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildOpenPhaseGrounding (Spec 2026-06-06, Task Group 2)', () => {
  beforeEach(() => {
    mockBuildDecisionsText.mockClear();
    mockBuildDecisionsText.mockReturnValue('RENDERED_DECISIONS_BLOCK');
  });

  // 1 — all four sources present → all four sections + REUSE of the resolver.
  it('includes all four grounding sources when present and reuses buildTargetStateDecisionsPromptText', () => {
    const decisions = [decision()];
    const out = buildOpenPhaseGrounding(baseInput({ capturedDecisions: decisions }));

    // Reuse: the captured-decisions renderer was called with the decisions list
    // verbatim, and its output is embedded (NOT re-derived here).
    expect(mockBuildDecisionsText).toHaveBeenCalledTimes(1);
    expect(mockBuildDecisionsText).toHaveBeenCalledWith(decisions);
    expect(out).toContain('RENDERED_DECISIONS_BLOCK');

    // All four section headers present.
    expect(out).toContain('## Captured decisions so far');
    expect(out).toContain('## Target model summary');
    expect(out).toContain('## Migration goal / product summary');
    expect(out).toContain('## Discovery findings (current-state reality)');
  });

  // 2 — captured-decisions section renders the resolver output.
  it('renders the captured-decisions section from the (mocked) resolver output', () => {
    const out = buildOpenPhaseGrounding(baseInput());
    expect(out).toMatch(/## Captured decisions so far\nRENDERED_DECISIONS_BLOCK/);
  });

  // 3 — target-model summary is sourced from the discovery context (no new call).
  it('renders the target-model summary from the discovery context targetArchitectureSummary', () => {
    const out = buildOpenPhaseGrounding(baseInput());
    expect(out).toContain('Name: Target Platform (id arch-target)');
    expect(out).toContain('services=7');
    expect(out).toContain('dataEntities=42');
  });

  // 4 — migration goal / product summary is included verbatim.
  it('includes the migration goal / product summary text', () => {
    const out = buildOpenPhaseGrounding(
      baseInput({ productSummary: 'Product Summary:\nLike-for-like billing migration.' }),
    );
    expect(out).toContain('## Migration goal / product summary');
    expect(out).toContain('Like-for-like billing migration.');
  });

  // 5 — WITH-findings path: the findings summary block is included.
  it('includes the discovery-findings summary when findings are available', () => {
    const out = buildOpenPhaseGrounding(baseInput());
    expect(out).toContain('## Discovery findings (current-state reality)');
    expect(out).toContain('Total findings: 18');
    expect(out).toContain('High-severity unreviewed: 3');
    expect(out).toContain('By severity: high:4, low:5, medium:9');
  });

  // 6 — NO-findings fallback (findingsSummary absent): three-source grounding.
  it('falls back to the three remaining sources when findingsSummary is absent', () => {
    const ctx = discoveryContextWithFindings();
    delete (ctx as { findingsSummary?: unknown }).findingsSummary;
    const out = buildOpenPhaseGrounding(baseInput({ discoveryContext: ctx }));

    // Findings section omitted...
    expect(out).not.toContain('## Discovery findings (current-state reality)');
    // ...but the three remaining sources stand alone.
    expect(out).toContain('## Captured decisions so far');
    expect(out).toContain('## Target model summary');
    expect(out).toContain('## Migration goal / product summary');
  });

  // 7 — NO-findings fallback (empty findings object): treated as absent.
  it('treats an empty findings object (totalFindings 0, no counts) as no findings', () => {
    const ctx = discoveryContextWithFindings();
    ctx.findingsSummary = { totalFindings: 0 };
    const out = buildOpenPhaseGrounding(baseInput({ discoveryContext: ctx }));
    expect(out).not.toContain('## Discovery findings (current-state reality)');
    // Three-source fallback still well-formed.
    expect(out).toContain('## Captured decisions so far');
    expect(out).toContain('## Target model summary');
    expect(out).toContain('## Migration goal / product summary');
  });

  // 8 — no discovery context AND no findings AND no product summary: the
  //     captured-decisions source alone still grounds the loop; and when even
  //     that is empty the helper emits an explicit placeholder (never empty).
  it('grounds on captured decisions alone, and emits a placeholder when nothing is available', () => {
    // Decisions only (no discovery context, no product summary).
    const decisionsOnly = buildOpenPhaseGrounding({
      capturedDecisions: [decision()],
      discoveryContext: null,
      productSummary: null,
    });
    expect(decisionsOnly).toContain('## Captured decisions so far');
    expect(decisionsOnly).toContain('RENDERED_DECISIONS_BLOCK');
    expect(decisionsOnly).not.toContain('## Target model summary');
    expect(decisionsOnly).not.toContain('## Discovery findings (current-state reality)');

    // Nothing at all → explicit placeholder, never an empty string.
    mockBuildDecisionsText.mockClear();
    const nothing = buildOpenPhaseGrounding({
      capturedDecisions: [],
      discoveryContext: null,
      productSummary: null,
    });
    expect(nothing.trim().length).toBeGreaterThan(0);
    expect(nothing).toBe('No additional grounding context is available for the open phase.');
    // Empty decisions list short-circuits before the renderer is even called.
    expect(mockBuildDecisionsText).not.toHaveBeenCalled();
  });
});
