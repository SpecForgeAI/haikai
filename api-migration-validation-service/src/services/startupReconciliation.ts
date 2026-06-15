import { archModelClient } from './archModelClient';

/**
 * Startup reconciliation -- mark every AMS capture session whose status was
 * `running` at process restart as `failed` with
 * `error_message='secrets_lost_during_run'`.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Why: secrets live in process memory only (see `secretsStore.ts`). A
 * crash / restart loses them, so a session that AMS still thinks is
 * `running` is in fact orphaned. Marking it `failed` lets the frontend
 * surface the secret-loss CTAs ("Clone configuration" /
 * "Re-enter secrets and start a new run") rather than leaving the row in
 * an indefinite running state.
 *
 * The reconciliation pass is fire-and-forget on boot (see `index.ts`).
 * Errors are logged to stderr; if AMS is unreachable at boot, the orphan
 * row stays `running` until the next boot finds it. That's acceptable per
 * spec (no automatic resumability in v1 -- the user clones + re-enters).
 */
export async function reconcileOrphanRunningSessions(): Promise<{
  scanned: number;
  reconciled: number;
}> {
  let sessions: Awaited<ReturnType<typeof archModelClient.listAllCaptureSessionsByStatus>>;
  try {
    sessions = await archModelClient.listAllCaptureSessionsByStatus('running');
  } catch (err) {
    // AMS is unreachable / endpoint not yet present -- swallow and report.
    // Group 6 wires the AMS endpoint properly; until then this returns 0/0.
    console.warn(
      '[startupReconciliation] Skipping reconciliation -- could not list running sessions:',
      err instanceof Error ? err.message : String(err),
    );
    return { scanned: 0, reconciled: 0 };
  }
  if (sessions.length === 0) {
    console.log('[startupReconciliation] No orphan running sessions to reconcile.');
    return { scanned: 0, reconciled: 0 };
  }
  let reconciled = 0;
  for (const session of sessions) {
    try {
      await archModelClient.patchCaptureSession(session.project_id, session.id, {
        status: 'failed',
        error_message: 'secrets_lost_during_run',
        completed_at: new Date().toISOString(),
      });
      reconciled += 1;
      console.log(
        `[startupReconciliation] Marked session ${session.id} failed (secrets_lost_during_run).`,
      );
    } catch (err) {
      console.error(
        `[startupReconciliation] Failed to mark session ${session.id} as failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { scanned: sessions.length, reconciled };
}
