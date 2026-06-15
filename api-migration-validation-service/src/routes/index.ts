import { Router } from 'express';
import { captureSessionActionsRouter } from './captureSessionActions';
import { targetCaptureSessionActionsRouter } from './targetCaptureSessionActions';
import { diffActionsRouter } from './diffActions';
import { testConnectionActionRouter } from './testConnectionAction';

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

export { apiMigrationValidationRouter };
