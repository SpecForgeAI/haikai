import { Router } from 'express';
import { captureSessionActionsRouter } from './captureSessionActions';
import { targetCaptureSessionActionsRouter } from './targetCaptureSessionActions';
import { diffActionsRouter } from './diffActions';
import { testConnectionActionRouter } from './testConnectionAction';
import { dataParityRunRouter } from './dataParityRun';
import { dataMigrationRunRouter } from './dataMigrationRun';
import { schemaApplyRunRouter, schemaDriftRouter } from './schemaApplyRun';
import { s0SnapshotRouter } from './s0Snapshot';
import { logReplayRunRouter } from './logReplayRun';

/**
 * API Migration Validation Routes Barrel
 *
 * Mounted at `/api-migration-validation` in the Express app entry point.
 *
 * Action endpoints (`POST /capture-sessions/:id/parse-oas`,
 * `/test-api-connection`, `/test-db-connection`, `/start`, `/cancel`,
 * `/secrets`) live in `captureSessionActions.ts` (Task Group 6) and are
 * wired in here. The action router carries its own internal paths
 * (`/api/capture-sessions/:id/...`), which keeps the spec route shape on
 * the wire while letting the gateway proxy hand off `:projectId` /
 * `:architectureId` via query params.
 *
 * The new target-side capture action endpoints
 * (`POST /target-capture-sessions`, `/target-capture-sessions/:id/secrets`,
 * `/test-connection`, `/start`, `/cancel`, `/status`) live in
 * `targetCaptureSessionActions.ts` (Spec 2026-05-25, Task Group 3) and are
 * wired in here on the SAME `/api-migration-validation` prefix. Target
 * routes are kept on a separate sub-router (per accepted Q8) so the
 * payload schemas + discriminator-to-route mapping stay clear.
 *
 * The diff engine action endpoints (`POST /diffs`, `/diffs/:id/recompute`,
 * `/diffs/:id/cancel`, `GET /diffs/:id/status`) live in
 * `diffActions.ts` (Spec 2026-05-25 Diff Engine, Task Group 3) and are
 * wired in here on the SAME `/api-migration-validation` prefix.
 *
 * The STATELESS wizard pre-flight connection test
 * (`POST /test-connection`, i.e. `/api/test-connection` internally) lives
 * in `testConnectionAction.ts`. It probes a target DIRECTLY from the request
 * body with NO session + NO secrets persistence -- it is the session-less
 * sibling of `/capture-sessions/:id/test-api-connection`, used by the wizard
 * before a session exists. Mounted on the SAME `/api-migration-validation`
 * prefix.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Groups
 * 4 (scaffold) and 6 (action endpoints).
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3
 *   (target-side replay routes).
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3
 *   (diff engine routes).
 * Spec: 2026-05-25 API Test Harness -- wizard pre-flight stateless
 *   test-connection endpoint.
 */
const apiMigrationValidationRouter = Router({ mergeParams: true });

apiMigrationValidationRouter.use(captureSessionActionsRouter);
apiMigrationValidationRouter.use(targetCaptureSessionActionsRouter);
apiMigrationValidationRouter.use(diffActionsRouter);
apiMigrationValidationRouter.use(testConnectionActionRouter);
// Data-parity run (Spec P, Data-Tier Oracle Program): one-shot session-less
// source/target data comparison; credentials request-scoped only.
apiMigrationValidationRouter.use(dataParityRunRouter);
// Data-migration run (Spec Y / W runner dispatch): one-shot session-less
// Phase-2 bulk load source -> target through the pair ruleset; credentials
// request-scoped only.
apiMigrationValidationRouter.use(dataMigrationRunRouter);
// Schema-apply run (WS2 DB-plane execution chain, 2026-07-31): applies the
// pack's Liquibase-formatted changesets to the live target by phase context
// (structural before the load, post-load after); credentials request-scoped
// only; applied ids tracked in haikai_schema_apply_log on the target.
apiMigrationValidationRouter.use(schemaApplyRunRouter);
apiMigrationValidationRouter.use(schemaDriftRouter);
// S0 snapshot / fingerprint / restore (Capture-State Discipline Spec 2):
// the pinned canonical source state — snapshot doubles as the migration dump
// artifact; verify is the end-of-job "still S0?" check; restore is the
// safety-net payout. Credentials request-scoped only.
apiMigrationValidationRouter.use(s0SnapshotRouter);
// Log-replay round-2 current-side run (CSD Spec 7): staged corpus ->
// `log_replay` baseline at S0; phase B rides the headless reconcile with
// that baseline as its source. Credentials request-scoped only.
apiMigrationValidationRouter.use(logReplayRunRouter);

export { apiMigrationValidationRouter };
