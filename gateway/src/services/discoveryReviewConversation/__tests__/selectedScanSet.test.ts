/**
 * Type-shape tests for the new `SelectedScanSet` wire type
 * (`gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts`).
 *
 * Spec: 2026-06-05-per-service-scan-selection (Half A, Task Group 1.1). This is
 * the gateway half of the foundational shape coverage -- it mirrors how the
 * scan selection is exercised as a typed fixture across the conversation suites
 * (e.g. `reviewEngine.test.ts`), now via the N-run `SelectedScanSet`.
 *
 * Because the gateway runs under ts-jest, a structurally-wrong fixture here is a
 * COMPILE error, so these assertions double as a static contract check: the set
 * carries `runs[]` (each `{ runId, scanKind, serviceId }`, `serviceId` nullable)
 * plus the `primaryRunId` thread anchor, and `primaryRunId` is one of the runs.
 *
 * Task Group 1 introduced `SelectedScanSet` additively; the retired 2-run scan
 * pair and its consumers were migrated in Task Group 2. This file asserts the
 * successor shape only.
 */

import type { SelectedScanSet } from '../reviewTurnShape';

const UI_RUN = 'run-ui';
const API_RUN = 'run-api';
const DB_RUN = 'run-db';

describe('SelectedScanSet wire shape', () => {
  it('models a 2 code + 1 database selection keyed by a primaryRunId among the runs', () => {
    const set: SelectedScanSet = {
      runs: [
        { runId: UI_RUN, scanKind: 'code', serviceId: 'svc-ui' },
        { runId: API_RUN, scanKind: 'code', serviceId: 'svc-api' },
        { runId: DB_RUN, scanKind: 'database', serviceId: 'svc-db' },
      ],
      primaryRunId: API_RUN,
    };

    expect(set.runs).toHaveLength(3);
    expect(set.runs.filter((r) => r.scanKind === 'code')).toHaveLength(2);
    expect(set.runs.filter((r) => r.scanKind === 'database')).toHaveLength(1);
    // primaryRunId is the thread anchor and MUST appear among the selected runs.
    expect(set.runs.map((r) => r.runId)).toContain(set.primaryRunId);
  });

  it('allows a single-run selection (one service) with a nullable orphan serviceId', () => {
    const set: SelectedScanSet = {
      runs: [{ runId: UI_RUN, scanKind: 'code', serviceId: null }],
      primaryRunId: UI_RUN,
    };

    expect(set.runs).toHaveLength(1);
    expect(set.runs[0].serviceId).toBeNull();
    expect(set.primaryRunId).toBe(UI_RUN);
  });
});
