/**
 * Mode 1(b) two-stage per-op bounded subtraction tests
 * (Spec 2026-06-23 Import a Postman Collection into Capture, Task Group 7 --
 * R6 / D3 / A5).
 *
 * Stage 1 (code pre-filter) removes candidates that obviously match a captured
 * Postman request by archetype/method/path/which-param/expectedStatus; Stage 2
 * (LLM judge, injected/mocked) marks remaining candidates redundant-or-not; the
 * delta = defaultScenarioSet MINUS (Stage-1 + Stage-2 redundant), capped at
 * MAX_SCENARIOS_PER_OP INCLUDING the already-captured Postman scenarios -- per
 * operation.
 */

import { stage1PreFilter, type PostmanCapturedRequest } from '../services/postmanDeltaStage1';
import { stage2JudgeRedundant, type JudgeFn } from '../services/postmanDeltaStage2';
import { computePostmanDelta } from '../services/postmanDelta';
import type { GeneratedScenario } from '../services/captureSessionOrchestrator';

const METHOD = 'GET';
const PATH = '/pets/{id}';

function scen(
  name: string,
  type: string,
  expectedStatus: GeneratedScenario['expectedStatus'],
): GeneratedScenario {
  return { name, type, expectedStatus };
}

/** A representative candidate set for GET /pets/{id} (mirrors defaultScenarioSet). */
function candidates(): GeneratedScenario[] {
  return [
    scen('happy_path', 'happy_path', 'success'),
    scen('not_found_id', 'not_found', 'not_found'),
    scen('bad_request_id', 'bad_request', 'client_error'),
    scen('bad_request_id_type', 'bad_request', 'client_error'),
    scen('edge_id', 'not_found', 'not_found'),
  ];
}

test('Stage-1 removes candidates obviously covered by a captured request (archetype/method/path/expectedStatus)', () => {
  // Captured: a 200 happy path + a 404 not-found on the same operation.
  const captured: PostmanCapturedRequest[] = [
    { method: 'GET', path: PATH, expectedStatus: 'success' },
    { method: 'GET', path: PATH, expectedStatus: 'not_found' },
  ];

  const { survivors, prefiltered } = stage1PreFilter(candidates(), captured, METHOD, PATH);

  // happy_path (success) is pre-filtered. The not_found-class candidates that are
  // NOT param-targeted-with-a-recorded-param are pre-filtered too (both
  // not_found_id and edge_id are param-targeted, but the capture records no
  // which-param, so they are LEFT IN for the LLM judge -- conservative).
  const names = (xs: GeneratedScenario[]) => xs.map((x) => x.name).sort();
  expect(names(prefiltered)).toContain('happy_path');
  // not_found_id / edge_id are param-targeted; capture has no which-param -> kept.
  expect(names(survivors)).toEqual(
    expect.arrayContaining(['not_found_id', 'edge_id', 'bad_request_id', 'bad_request_id_type']),
  );
  expect(names(survivors)).not.toContain('happy_path');
});

test('Stage-1 leaves everything when there are no captured requests', () => {
  const { survivors, prefiltered } = stage1PreFilter(candidates(), [], METHOD, PATH);
  expect(survivors).toHaveLength(5);
  expect(prefiltered).toHaveLength(0);
});

test('Stage-1 method mismatch never pre-filters (a POST capture does not cover a GET candidate)', () => {
  const captured: PostmanCapturedRequest[] = [
    { method: 'POST', path: PATH, expectedStatus: 'success' },
  ];
  const { survivors, prefiltered } = stage1PreFilter(candidates(), captured, METHOD, PATH);
  expect(prefiltered).toHaveLength(0);
  expect(survivors).toHaveLength(5);
});

test('Stage-2 LLM judge (mocked) drops the candidates it names redundant; keeps the rest', async () => {
  const surv = candidates();
  const captured: PostmanCapturedRequest[] = [
    { method: 'GET', path: PATH, expectedStatus: 'client_error' },
  ];
  const judge: JudgeFn = jest.fn(async () => ['bad_request_id', 'bad_request_id_type']);

  const { survivors, redundant } = await stage2JudgeRedundant({
    operationId: 'getPetById',
    method: METHOD,
    path: PATH,
    candidates: surv,
    captured,
    judge,
  });

  expect(judge).toHaveBeenCalledTimes(1);
  expect(redundant.map((r) => r.name).sort()).toEqual(['bad_request_id', 'bad_request_id_type']);
  expect(survivors.map((s) => s.name)).toEqual(['happy_path', 'not_found_id', 'edge_id']);
});

test('Stage-2 short-circuits (no judge call) when there are no captured requests', async () => {
  const judge: JudgeFn = jest.fn(async () => ['happy_path']);
  const { survivors, redundant } = await stage2JudgeRedundant({
    operationId: 'getPetById',
    method: METHOD,
    path: PATH,
    candidates: candidates(),
    captured: [],
    judge,
  });
  expect(judge).not.toHaveBeenCalled();
  expect(survivors).toHaveLength(5);
  expect(redundant).toHaveLength(0);
});

test('Stage-2 fail-soft: a thrown judge degrades to "nothing redundant" (every survivor tops up)', async () => {
  const judge: JudgeFn = jest.fn(async () => {
    throw new Error('LLM down');
  });
  const captured: PostmanCapturedRequest[] = [
    { method: 'GET', path: PATH, expectedStatus: 'success' },
  ];
  const { survivors, redundant } = await stage2JudgeRedundant({
    operationId: 'getPetById',
    method: METHOD,
    path: PATH,
    candidates: candidates(),
    captured,
    judge,
  });
  expect(survivors).toHaveLength(5);
  expect(redundant).toHaveLength(0);
});

test('computePostmanDelta: two-stage subtraction, capped INCLUDING captured Postman scenarios, per-op', async () => {
  // 5 candidates; 2 captured Postman requests (success + not_found). Stage-1
  // removes happy_path. Stage-2 (mocked) marks bad_request_id redundant. The
  // cap is small (3) so with capturedCount=2 the budget is 3-2=1: only ONE
  // survivor tops up.
  const captured: PostmanCapturedRequest[] = [
    { method: 'GET', path: PATH, expectedStatus: 'success' },
    { method: 'GET', path: PATH, expectedStatus: 'not_found', whichParam: 'id' },
  ];
  const judge: JudgeFn = jest.fn(async () => ['bad_request_id']);

  const { topUp, stats } = await computePostmanDelta({
    operationId: 'getPetById',
    method: METHOD,
    path: PATH,
    candidates: candidates(),
    captured,
    judge,
    maxScenariosPerOp: 3,
  });

  // happy_path pre-filtered (success); not_found_id pre-filtered (capture records
  // whichParam=id, not_found class). Survivors after Stage-1: bad_request_id,
  // bad_request_id_type, edge_id. Stage-2 drops bad_request_id. Remaining: 2.
  // Budget = 3 - 2 captured = 1 -> exactly ONE tops up.
  expect(stats.capturedCount).toBe(2);
  expect(stats.stage1Prefiltered).toBeGreaterThanOrEqual(1);
  expect(stats.stage2Redundant).toBe(1);
  expect(topUp).toHaveLength(1);
  // The cap counts the captured scenarios: capturedCount + topUp.length <= max.
  expect(stats.capturedCount + topUp.length).toBeLessThanOrEqual(3);
});

test('computePostmanDelta: budget floors at 0 when captures already meet/exceed the cap', async () => {
  // 4 captured requests, cap 3 -> budget = max(0, 3-4) = 0; nothing tops up.
  const captured: PostmanCapturedRequest[] = [
    { method: 'GET', path: PATH, expectedStatus: 'client_error' },
    { method: 'GET', path: PATH, expectedStatus: 'client_error' },
    { method: 'GET', path: PATH, expectedStatus: 'client_error' },
    { method: 'GET', path: PATH, expectedStatus: 'client_error' },
  ];
  const judge: JudgeFn = jest.fn(async () => []);
  const { topUp, stats } = await computePostmanDelta({
    operationId: 'getPetById',
    method: METHOD,
    path: PATH,
    candidates: candidates(),
    captured,
    judge,
    maxScenariosPerOp: 3,
  });
  expect(topUp).toHaveLength(0);
  expect(stats.cappedOut).toBeGreaterThanOrEqual(0);
});
