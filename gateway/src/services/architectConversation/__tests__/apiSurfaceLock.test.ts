/**
 * Tests — API like-for-like lock (`api.surfaceMode` + the `L` treatment for
 * Group B)
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 7
 * (FR9 / FR1 `L` treatment — gateway behaviour half).
 *
 * Per tasks.md §7.1 (gateway half) — focused tests covering:
 *   - Default resolution: a reconciled baseline => `like_for_like` by default;
 *     no baseline + no requested mode => unset (not forced).
 *   - Under `like_for_like`: all six Group B questions are treated `L` (NOT
 *     asked / suppressed) and auto-answered from the source contract; each
 *     locked row is written via `answerValue = JSON.stringify({ value,
 *     sourceQuote, sourceFile })` with provenance + the lock task marker.
 *   - Under `may_change`: the same six questions are NOT locked / written and
 *     NOT suppressed (they revert to their H/I/G class + are asked).
 *
 * The matrix-metadata assertions (exactly six `lockableFromSource: true`, each
 * retaining its underlying H/I/G class) live in
 * `config/architect-conversation/__tests__/questionLibrary.test.ts` (TG7 block).
 *
 * The injected `SourceContractProvider` is a thin fixture reader — this module
 * performs NO reconciliation compute. The captured-decision writer is mocked.
 */

import {
  applyApiSurfaceLock,
  deriveApiSurfaceLockDecisions,
  resolveApiSurfaceMode,
  suppressedGroupBCodes,
  isApiSurfaceLocked,
  API_SURFACE_LOCK_TASK_NAME,
  type ApiSurfaceLockDeps,
  type SourceContractProvider,
  type SourceContractValue,
} from '../apiSurfaceLock';
import {
  LOCKABLE_GROUP_B_CODES,
} from '../../../config/architect-conversation/apiSurfaceMode';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A thin baseline fixture establishing every Group B value from "source". */
const FULL_BASELINE: Record<string, SourceContractValue> = {
  'api.protocol': {
    value: 'REST/JSON',
    sourceQuote: 'paths:\n  /widgets:',
    sourceFile: 'contracts/widgets-openapi.yaml',
  },
  'api.versioning': {
    value: 'URL path',
    sourceQuote: '/v1/widgets',
    sourceFile: 'contracts/widgets-openapi.yaml',
  },
  'api.contractFormat': {
    value: 'OpenAPI 3.1',
    sourceQuote: 'openapi: 3.1.0',
    sourceFile: 'contracts/widgets-openapi.yaml',
  },
  'api.auth': {
    value: 'OAuth2 + JWT',
    sourceQuote: 'securitySchemes:\n  bearerAuth:',
    sourceFile: 'contracts/widgets-openapi.yaml',
  },
  'api.errorContract': {
    value: 'RFC 7807 Problem Details',
    sourceQuote: 'application/problem+json',
    sourceFile: 'contracts/widgets-openapi.yaml',
  },
  'api.rateLimiting': {
    value: 'gateway-enforced',
    sourceQuote: 'x-ratelimit-policy: gateway',
    sourceFile: 'contracts/widgets-openapi.yaml',
  },
};

function providerFor(
  baseline: Record<string, SourceContractValue> | null,
): SourceContractProvider {
  return {
    hasReconciledBaseline: () => baseline !== null,
    readGroupBValue: (code) => (baseline ? baseline[code] : undefined),
  };
}

function buildDeps(
  baseline: Record<string, SourceContractValue> | null,
): {
  deps: ApiSurfaceLockDeps;
  writes: CreateBody[];
} {
  const writes: CreateBody[] = [];
  const deps: ApiSurfaceLockDeps = {
    sourceContractProvider: providerFor(baseline),
    postCapturedDecision: (async (_p: string, _t: string, body: CreateBody) => {
      writes.push(body);
      return {} as never;
    }) as ApiSurfaceLockDeps['postCapturedDecision'],
  };
  return { deps, writes };
}

type CreateBody = {
  decisionCode: string;
  answerValue: string;
  answerSummary?: string | null;
  createdByTask: string;
  scopeKind: string;
};

// ---------------------------------------------------------------------------
// Mode resolution (FR9 default)
// ---------------------------------------------------------------------------

describe('api.surfaceMode resolution (TG7 / FR9)', () => {
  it('defaults to like_for_like when a reconciled baseline is present', () => {
    expect(
      resolveApiSurfaceMode({ requestedMode: null, hasReconciledBaseline: true }),
    ).toBe('like_for_like');
  });

  it('is NOT forced (unset) when no baseline and no requested mode', () => {
    expect(
      resolveApiSurfaceMode({ requestedMode: null, hasReconciledBaseline: false }),
    ).toBeNull();
  });

  it('a caller-provided mode always wins over the default', () => {
    expect(
      resolveApiSurfaceMode({
        requestedMode: 'may_change',
        hasReconciledBaseline: true,
      }),
    ).toBe('may_change');
    expect(
      resolveApiSurfaceMode({
        requestedMode: 'like_for_like',
        hasReconciledBaseline: false,
      }),
    ).toBe('like_for_like');
  });
});

// ---------------------------------------------------------------------------
// Lock decisions + write + suppression under like_for_like
// ---------------------------------------------------------------------------

describe('apply like_for_like lock (TG7 / FR9)', () => {
  it('locks + auto-answers ALL six Group B codes from source, writes the envelope with provenance, and suppresses them', async () => {
    const { deps, writes } = buildDeps(FULL_BASELINE);

    const outcome = await applyApiSurfaceLock(
      {
        projectId: 'p1',
        targetArchitectureId: 't1',
        conversationThreadId: 'thread-1',
        // No requestedMode: defaulted to like_for_like by the baseline.
      },
      deps,
    );

    expect(outcome.mode).toBe('like_for_like');

    // EXACTLY the six Group B codes are locked + suppressed.
    expect(new Set(outcome.suppressedCodes)).toEqual(new Set(LOCKABLE_GROUP_B_CODES));
    expect(outcome.suppressedCodes).toHaveLength(6);
    expect(outcome.writeFailureCodes).toEqual([]);

    // Each Group B code was written exactly once via the existing envelope.
    expect(writes).toHaveLength(6);
    for (const code of LOCKABLE_GROUP_B_CODES) {
      const row = writes.find((w) => w.decisionCode === code)!;
      expect(row).toBeDefined();
      // Lock task marker (read-only provenance discriminator).
      expect(row.createdByTask).toBe(API_SURFACE_LOCK_TASK_NAME);
      expect(row.scopeKind).toBe('architecture');
      // answerValue rides the EXISTING { value, sourceQuote, sourceFile } envelope.
      const parsed = JSON.parse(row.answerValue);
      expect(parsed).toEqual({
        value: FULL_BASELINE[code].value,
        sourceQuote: FULL_BASELINE[code].sourceQuote,
        sourceFile: FULL_BASELINE[code].sourceFile,
      });
      // Provenance points at the source contract / baseline.
      expect(parsed.sourceFile).toContain('contracts/');
      // answerSummary = the resolved label.
      expect(row.answerSummary).toBe(FULL_BASELINE[code].value);
    }

    // Every locked decision carries the `L` (locked) treatment marker.
    for (const d of outcome.decisions) {
      expect(d.treatment).toBe('locked');
      expect(d.locked).toBe(true);
    }
  });

  it('a baseline gap leaves that Group B code UNLOCKED (asked, not guessed) and not suppressed', async () => {
    // Baseline omits api.rateLimiting => it must NOT be locked / written / suppressed.
    const partial = { ...FULL_BASELINE };
    delete (partial as Record<string, unknown>)['api.rateLimiting'];

    const { deps, writes } = buildDeps(partial);
    const outcome = await applyApiSurfaceLock(
      { projectId: 'p1', targetArchitectureId: 't1' },
      deps,
    );

    expect(outcome.mode).toBe('like_for_like');
    // Five locked + suppressed; the gap is asked.
    expect(outcome.suppressedCodes).toHaveLength(5);
    expect(outcome.suppressedCodes).not.toContain('api.rateLimiting');
    expect(writes.map((w) => w.decisionCode)).not.toContain('api.rateLimiting');

    const gap = outcome.decisions.find((d) => d.decisionCode === 'api.rateLimiting')!;
    expect(gap.locked).toBe(false);
    expect(gap.treatment).toBe('unlocked');
    expect(gap.unlockedReason).toMatch(/baseline/i);

    // isApiSurfaceLocked agrees with the suppression set.
    expect(
      isApiSurfaceLocked('api.protocol', outcome.mode, outcome.decisions),
    ).toBe(true);
    expect(
      isApiSurfaceLocked('api.rateLimiting', outcome.mode, outcome.decisions),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// may_change reverts to H/I/G — no lock, no write, no suppression
// ---------------------------------------------------------------------------

describe('may_change reverts Group B to H/I/G (TG7 / FR9)', () => {
  it('writes nothing and suppresses nothing even with a baseline present', async () => {
    const { deps, writes } = buildDeps(FULL_BASELINE);
    const outcome = await applyApiSurfaceLock(
      {
        projectId: 'p1',
        targetArchitectureId: 't1',
        requestedMode: 'may_change',
      },
      deps,
    );

    expect(outcome.mode).toBe('may_change');
    expect(outcome.decisions).toEqual([]);
    expect(outcome.suppressedCodes).toEqual([]);
    expect(writes).toHaveLength(0);

    // No Group B code is locked under may_change.
    for (const code of LOCKABLE_GROUP_B_CODES) {
      expect(isApiSurfaceLocked(code, outcome.mode, outcome.decisions)).toBe(false);
    }
  });

  it('with no baseline + no requested mode, the mode is unset and nothing is locked', async () => {
    const { deps, writes } = buildDeps(null);
    const outcome = await applyApiSurfaceLock(
      { projectId: 'p1', targetArchitectureId: 't1' },
      deps,
    );
    expect(outcome.mode).toBeNull();
    expect(writes).toHaveLength(0);
    expect(suppressedGroupBCodes(outcome.mode, outcome.decisions).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pure derivation + suppression helpers (no writes)
// ---------------------------------------------------------------------------

describe('deriveApiSurfaceLockDecisions + suppressedGroupBCodes (TG7)', () => {
  it('derives one decision per Group B code and suppresses only locked ones under like_for_like', () => {
    const decisions = deriveApiSurfaceLockDecisions(providerFor(FULL_BASELINE));
    expect(decisions).toHaveLength(LOCKABLE_GROUP_B_CODES.length);

    const suppressed = suppressedGroupBCodes('like_for_like', decisions);
    expect(suppressed).toEqual(new Set(LOCKABLE_GROUP_B_CODES));

    // Under may_change nothing is suppressed regardless of the decisions.
    expect(suppressedGroupBCodes('may_change', decisions).size).toBe(0);
    expect(suppressedGroupBCodes(null, decisions).size).toBe(0);
  });
});
