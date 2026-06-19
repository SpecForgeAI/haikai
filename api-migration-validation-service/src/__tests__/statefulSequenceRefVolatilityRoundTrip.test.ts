/**
 * Cross-layer round-trip: capture-derived ref volatility -> reconcile diff
 * tolerance (Stateful Sequence Scenarios, Spec D -- Task Group 5, gap fill).
 *
 * Task Groups 2 + 3 each test ONE HALF of the ref-derived id-tolerance
 * invariant in isolation:
 *   - TG2 (`statefulSequenceCapture.test.ts`) proves `deriveSequenceVolatilePaths`
 *     records the referenced `$N.<path>` + generated-id fields and NOT genuine
 *     non-volatile fields.
 *   - TG3 (`sequenceReplayRunner.test.ts`) proves `compareJsonShapes` tolerates
 *     a changed id but breaks on a changed non-volatile field -- but it
 *     hand-constructs its OWN volatile envelope.
 *
 * The load-bearing CROSS-LAYER invariant (spec sub-task 5.3, explicitly named)
 * is that the two halves CONNECT: the volatile envelope the CAPTURE side
 * actually derives, when fed into the RECONCILE diff verbatim, must
 *   (a) tolerate a generated-id change capture->replay (NOT a false break), AND
 *   (b) STILL break on a genuinely-changed NON-volatile field.
 *
 * If `deriveSequenceVolatilePaths` ever recorded too FEW paths the diff would
 * false-break a new id; if it recorded too MANY a real change would be masked.
 * This test wires the real capture-side output into the real reconcile-side
 * comparator so neither drift goes unnoticed. NO new diff engine / NO new
 * pairing -- it is the SAME `volatile_paths_json` envelope + the SAME
 * `compareJsonShapes` the single-shot diff uses.
 */

import { deriveSequenceVolatilePaths } from '../services/sequenceAssembly';
import { runManager } from '../services/runManager';
import type { ScenarioCaptureData } from '../services/runManager';
import {
  compareJsonShapes,
  type VolatilityContext,
  type VolatilityEnvelope,
} from '../services/jsonShapeComparator';

const SESSION_ID = 'session-seq-roundtrip-1';
const PROJECT_ID = 'proj-seq-roundtrip-1';
const ARCH_ID = 'arch-seq-roundtrip-1';

function seedCaptures(data: ScenarioCaptureData[]): void {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  data.forEach((d, i) =>
    runManager.recordScenarioCapture(SESSION_ID, `capture-${i}`, d.responseStatus, d),
  );
}

afterEach(() => {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

/**
 * Rebuild the reconcile-side {@link VolatilityContext} from the wire envelope
 * the capture side persisted, mirroring `diffRunner.buildVolatilityContext`:
 * `declared` is NOT a probed source, so heuristics stay off and the path set
 * drives value tolerance.
 */
function contextFromWire(wire: Record<string, unknown> | null): VolatilityContext {
  return {
    envelope: (wire as unknown as VolatilityEnvelope) ?? null,
    endpointSignal: false,
    applyHeuristics: false,
  };
}

test('the capture-derived ref-volatility envelope tolerates a new id at reconcile AND still breaks a real non-volatile change', () => {
  // A setup POST mints a filter id; the act references $0.id and its own 201
  // returns a generated `filterId`. `status` is a genuine non-volatile field.
  const setup: ScenarioCaptureData = {
    method: 'POST',
    path: '/filters',
    query: null,
    headers: { 'Content-Type': 'application/json' },
    body: { name: 'draft' },
    responseStatus: 201,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { id: 'flt-CAPTURE', name: 'draft' },
  };
  const act: ScenarioCaptureData = {
    method: 'POST',
    path: '/filters/submitForReview',
    query: null,
    headers: { 'Content-Type': 'application/json' },
    body: { filterId: 'flt-CAPTURE' },
    responseStatus: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: { filterId: 'flt-CAPTURE', status: 'IN_REVIEW' },
  };
  seedCaptures([setup, act]);
  const captures = runManager.getScenarioCaptures(SESSION_ID);

  // --- CAPTURE SIDE: derive the ref-volatility envelope (the REAL output). ---
  const wire = deriveSequenceVolatilePaths(
    {
      steps: [
        { captureIndex: 0, role: 'setup', kind: 'http', expectedStatus: 201, responseRefs: [] },
        {
          captureIndex: 1,
          role: 'act',
          kind: 'http',
          expectedStatus: 200,
          responseRefs: [{ ref: '$0.id', fromStep: 0, jsonPath: 'id' }],
        },
      ],
      actStepIndex: 1,
      cleanupBestEffort: true,
    },
    captures,
  );
  expect(wire).not.toBeNull();
  // Sanity: the derived envelope marks the generated id + ref but NOT `status`.
  const env = wire as { paths: string[]; volatility_source: string };
  expect(env.volatility_source).toBe('declared');
  expect(env.paths).toContain('/filterId');
  expect(env.paths).not.toContain('/status');

  // The pinned act item's oracle response (Spec B `{headers,body}` wrapper),
  // as it would be promoted at capture time.
  const sourceActResponse = {
    headers: { 'content-type': 'application/json' },
    body: { filterId: 'flt-CAPTURE', status: 'IN_REVIEW' },
  };

  // --- RECONCILE SIDE: feed the CAPTURE-DERIVED envelope into the diff. ---
  const ctx = contextFromWire(wire);

  // (a) A NEW generated id at replay is tolerated -> body_match, NOT a break.
  const newIdResponse = {
    headers: { 'content-type': 'application/json' },
    body: { filterId: 'flt-REPLAY-DIFFERENT', status: 'IN_REVIEW' },
  };
  const tolerated = compareJsonShapes(sourceActResponse, newIdResponse, ctx);
  expect(tolerated.bodyClassification).toBe('body_match');

  // (b) A genuinely-changed NON-volatile field (status) STILL breaks (the
  //     oracle invariant). The envelope did not over-mark it volatile.
  const realChangeResponse = {
    headers: { 'content-type': 'application/json' },
    body: { filterId: 'flt-REPLAY-DIFFERENT', status: 'REJECTED' },
  };
  const realChange = compareJsonShapes(sourceActResponse, realChangeResponse, ctx);
  expect(realChange.bodyClassification).toBe('body_value_drift');
});
