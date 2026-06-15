/**
 * Startup reconciliation test (Task Group 11.3 gap-fill #2a).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 11.
 *
 * Why: spec section "Secret-loss UX (after process restart)" says any
 * session whose AMS status was `running` at process restart must be marked
 * `failed` with `error_message='secrets_lost_during_run'` so the UI can
 * surface the Clone-configuration / Re-enter-and-restart CTAs. Groups 4-10
 * exercise the consequences of that branch (CaptureSessionDetailView shows
 * the right CTAs; orchestrator short-circuits on missing secrets), but no
 * existing test actually drives the boot-time reconciler. This test fills
 * that gap by mocking `archModelClient` and asserting:
 *
 *   1. `listAllCaptureSessionsByStatus('running')` is called once.
 *   2. For every orphan row returned, `patchCaptureSession` is called with
 *      `status='failed'`, `error_message='secrets_lost_during_run'`, and a
 *      non-null `completed_at` timestamp.
 *   3. The returned counters (`scanned`, `reconciled`) match the number of
 *      orphan rows successfully patched.
 *   4. Per-row failures do NOT abort the pass -- if one PATCH throws the
 *      remaining orphans are still reconciled.
 */

// archModelClient is the singleton instance imported by
// startupReconciliation.ts; mock it at the module level so the reconciler
// can call its methods without standing up axios + the gateway.
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    listAllCaptureSessionsByStatus: jest.fn(),
    patchCaptureSession: jest.fn(),
  },
}));

import { reconcileOrphanRunningSessions } from '../services/startupReconciliation';
import { archModelClient } from '../services/archModelClient';

const PROJECT_A = '00000000-0000-0000-0000-00000000aaaa';
const PROJECT_B = '00000000-0000-0000-0000-00000000bbbb';

beforeEach(() => {
  jest.clearAllMocks();
});

test('reconcileOrphanRunningSessions patches every running session to failed/secrets_lost_during_run', async () => {
  const orphanA = {
    id: 'sess-A',
    project_id: PROJECT_A,
    architecture_id: 'arch-A',
    status: 'running',
  };
  const orphanB = {
    id: 'sess-B',
    project_id: PROJECT_B,
    architecture_id: 'arch-B',
    status: 'running',
  };

  (archModelClient.listAllCaptureSessionsByStatus as jest.Mock).mockResolvedValue([
    orphanA,
    orphanB,
  ]);
  (archModelClient.patchCaptureSession as jest.Mock).mockImplementation(
    async (projectId: string, sessionId: string, body: unknown) => ({
      id: sessionId,
      project_id: projectId,
      ...(body as Record<string, unknown>),
    }),
  );

  const result = await reconcileOrphanRunningSessions();

  expect(result).toEqual({ scanned: 2, reconciled: 2 });
  expect(archModelClient.listAllCaptureSessionsByStatus).toHaveBeenCalledTimes(1);
  expect(archModelClient.listAllCaptureSessionsByStatus).toHaveBeenCalledWith('running');

  // Both orphans received a patch with the spec-mandated terminal shape.
  expect(archModelClient.patchCaptureSession).toHaveBeenCalledTimes(2);
  const calls = (archModelClient.patchCaptureSession as jest.Mock).mock.calls;
  for (const [projectId, sessionId, body] of calls) {
    expect([PROJECT_A, PROJECT_B]).toContain(projectId);
    expect(['sess-A', 'sess-B']).toContain(sessionId);
    expect((body as Record<string, string>).status).toBe('failed');
    expect((body as Record<string, string>).error_message).toBe(
      'secrets_lost_during_run',
    );
    expect((body as Record<string, string>).completed_at).toBeTruthy();
  }
});

test('reconcileOrphanRunningSessions continues past per-row failures', async () => {
  (archModelClient.listAllCaptureSessionsByStatus as jest.Mock).mockResolvedValue([
    { id: 'sess-X', project_id: PROJECT_A, architecture_id: 'arch-A', status: 'running' },
    { id: 'sess-Y', project_id: PROJECT_B, architecture_id: 'arch-B', status: 'running' },
  ]);
  // First PATCH rejects, second succeeds. The reconciler must not abort.
  (archModelClient.patchCaptureSession as jest.Mock)
    .mockRejectedValueOnce(new Error('AMS down'))
    .mockResolvedValueOnce({ id: 'sess-Y', project_id: PROJECT_B, status: 'failed' });

  const result = await reconcileOrphanRunningSessions();

  expect(result.scanned).toBe(2);
  // Only the second orphan was successfully patched.
  expect(result.reconciled).toBe(1);
  expect(archModelClient.patchCaptureSession).toHaveBeenCalledTimes(2);
});
