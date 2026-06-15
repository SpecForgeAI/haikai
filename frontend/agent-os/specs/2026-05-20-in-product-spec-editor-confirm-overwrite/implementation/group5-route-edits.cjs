/*
 * Route edits for Task Group 5: extend migrationShapeSpecGeneration.ts with
 * - manual-edit proxy
 * - manually-edited-in-scope proxy
 * - flag pass-through on generate-batch + regenerate-single
 * and wire the new ManuallyEditedInScopeFetcher + ManuallyEditedFlagClearer
 * defaults into productionDeps.
 */
const fs = require('fs');
const ROUTE = 'C:/Workspaces/SSD/architecture-store-and-diagrams/gateway/src/routes/migrationShapeSpecGeneration.ts';

const edits = [
  // 1. Update productionDeps to wire the new defaults via the handler's
  //    own default fetchers (we use the gateway's fetch wrapper there).
  //    Since the handler defaults already call AMS directly when these
  //    deps are unset, the simplest gateway wiring is "leave them unset
  //    and the handler uses defaultFetchManuallyEditedInScope +
  //    defaultClearManuallyEditedFlag". But the missingInputResolutions
  //    route already uses ShapeSpecGenerationDeps -- we keep the existing
  //    fields here and DO NOT need to add the new ones because the handler
  //    auto-falls-back to its own defaults when deps are unset.
  //
  //    BUT wait: read the handler again -- the existing pattern is
  //    `deps.persistBatchResults ?? defaultPersistBatchResults` inside
  //    runSinglePassBatch. The new fetchScope is only used when wired,
  //    so the gateway MUST wire it for production calls to reach AMS.
  //    Update productionDeps to include both new defaults.
  {
    find: `import {
  runShapeSpecGenerationBatch,
  RunShapeSpecGenerationBatchInput,
  ShapeSpecGenerationDeps,
  WorkstreamLockedError,
} from '../services/migrationShapeSpecGenerationHandler';
import { fetchProjectConfigWithDefaults } from '../services/architectureModelClient';
import { autoSeedEpicCapturedDecision } from '../services/epicCapturedDecisionsClient';

export const migrationShapeSpecGenerationRouter = Router();

// Production dep wiring for the cross-story two-pass loop.
// Without this, the handler treats \`autoRunPass2\` as false by default and
// \`autoSeedEpicCapturedDecision\` as a no-op (see handler docstring at line 1009
// and 1137). Wiring here ensures production behaviour matches spec defaults.
const productionDeps: ShapeSpecGenerationDeps = {
  fetchProjectConfig: fetchProjectConfigWithDefaults,
  autoSeedEpicCapturedDecision,
};`,
    replace: `import {
  runShapeSpecGenerationBatch,
  RunShapeSpecGenerationBatchInput,
  ShapeSpecGenerationDeps,
  WorkstreamLockedError,
} from '../services/migrationShapeSpecGenerationHandler';
import { fetchProjectConfigWithDefaults } from '../services/architectureModelClient';
import { autoSeedEpicCapturedDecision } from '../services/epicCapturedDecisionsClient';

export const migrationShapeSpecGenerationRouter = Router();

// Production dep wiring for the cross-story two-pass loop.
// Without this, the handler treats \`autoRunPass2\` as false by default and
// \`autoSeedEpicCapturedDecision\` as a no-op (see handler docstring at line 1009
// and 1137). Wiring here ensures production behaviour matches spec defaults.
//
// In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5): the
// handler exposes \`fetchManuallyEditedInScope\` + \`clearManuallyEditedFlag\`
// dep seams. Production leaves them undefined so the handler uses its own
// AMS-default implementations (defaultFetchManuallyEditedInScope +
// defaultClearManuallyEditedFlag). Tests override the seams via the
// dep-injection path.
const productionDeps: ShapeSpecGenerationDeps = {
  fetchProjectConfig: fetchProjectConfigWithDefaults,
  autoSeedEpicCapturedDecision,
};`,
  },

  // 2. Forward overwriteManuallyEdited + manuallyEditedWorkItemIdsToOverwrite
  //    from generate-batch body
  {
    find: `      const result = await runShapeSpecGenerationBatch({
        projectId,
        bookOfWorkId: bookId,
        batchSize: body.batchSize,
        regenerateAll: body.regenerateAll,
        skipBlockedStories: body.skipBlockedStories,
        confirmOverwrite: body.confirmOverwrite,
        maxFindings: body.maxFindings,
        maxEvidenceItems: body.maxEvidenceItems,
        maxBaselineItems: body.maxBaselineItems,
        autoRunPass2: body.autoRunPass2,
        workstreamId: body.workstreamId,
      }, productionDeps);`,
    replace: `      const result = await runShapeSpecGenerationBatch({
        projectId,
        bookOfWorkId: bookId,
        batchSize: body.batchSize,
        regenerateAll: body.regenerateAll,
        skipBlockedStories: body.skipBlockedStories,
        confirmOverwrite: body.confirmOverwrite,
        maxFindings: body.maxFindings,
        maxEvidenceItems: body.maxEvidenceItems,
        maxBaselineItems: body.maxBaselineItems,
        autoRunPass2: body.autoRunPass2,
        workstreamId: body.workstreamId,
        // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
        // pass through the overwrite flag + allow-list so the handler's
        // pre-flight + filter step (applyManuallyEditedPreFlight) can split
        // the candidate set into "overwrite" vs "skip" before the batch loop.
        overwriteManuallyEdited: body.overwriteManuallyEdited,
        manuallyEditedWorkItemIdsToOverwrite:
          body.manuallyEditedWorkItemIdsToOverwrite,
      }, productionDeps);`,
  },

  // 3. Update the regenerate-single body type + pass-through
  {
    find: `    const body = (req.body ?? {}) as {
      workItemId?: string;
      confirmOverwrite?: boolean;
    };`,
    replace: `    const body = (req.body ?? {}) as {
      workItemId?: string;
      confirmOverwrite?: boolean;
      // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5).
      overwriteManuallyEdited?: boolean;
      manuallyEditedWorkItemIdsToOverwrite?: string[];
    };`,
  },

  {
    find: `      const result = await runShapeSpecGenerationBatch({
        projectId,
        bookOfWorkId: bookId,
        batchSize: 1,
        regenerateAll: true,
        confirmOverwrite: !!body.confirmOverwrite,
        targetWorkItemIds: [body.workItemId],
      }, productionDeps);`,
    replace: `      const result = await runShapeSpecGenerationBatch({
        projectId,
        bookOfWorkId: bookId,
        batchSize: 1,
        regenerateAll: true,
        confirmOverwrite: !!body.confirmOverwrite,
        targetWorkItemIds: [body.workItemId],
        // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
        // pass through the overwrite flag + allow-list so the regenerate-single
        // path can clear the manually_edited flag when the user confirms.
        overwriteManuallyEdited: body.overwriteManuallyEdited,
        manuallyEditedWorkItemIdsToOverwrite:
          body.manuallyEditedWorkItemIdsToOverwrite,
      }, productionDeps);`,
  },

  // 4. Append the two new proxy routes at the end of the file (after the
  //    bulk recompute-quality route).
  {
    find: `      handleQualityRecomputeUpstreamError(
        res,
        error,
        'recompute-quality-bulk',
        requestId,
        { projectId },
      );
    }
  },
);
`,
    replace: `      handleQualityRecomputeUpstreamError(
        res,
        error,
        'recompute-quality-bulk',
        requestId,
        { projectId },
      );
    }
  },
);

// ---------------------------------------------------------------------------
// In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5)
//
// Thin pass-through proxies to two new AMS endpoints introduced by Spec
// Group 3:
//
//   POST /api/v1/projects/:projectId/spec-generations/:specId/manual-edit
//     - Body \`{ specText }\`; header \`X-User-Id\`. AMS persists the manual
//       edit, re-runs the parser + scorer, and returns the updated DTO.
//
//   GET /api/v1/projects/:projectId/migration-books-of-work/:bookId/
//       spec-generations/manually-edited-in-scope
//     - Optional query \`?workItemIds=...&workItemIds=...\` narrows the
//       candidate set (drives the retry-batch flow's pre-flight). Returns
//       the list of manually-edited rows the bulk picker will show.
//
// Both routes preserve 4xx/5xx envelopes (404 from AMS round-trips back as
// 404 with body intact) and forward the optional \`X-User-Id\` header to AMS.
// No new LLM calls or token-counting logic.
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/spec-generations/:specId/manual-edit',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, specId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      \`\${baseUrl}/api/projects/\${encodeURIComponent(projectId)}\` +
      \`/spec-generations/\${encodeURIComponent(specId)}/manual-edit\`;
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        \`[diag-gw] route=spec-generations-manual-edit \` +
          \`status=\${upstream.status} elapsed_ms=\${Date.now() - start}\`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(
        res,
        error,
        'manual-edit',
        requestId,
        { projectId, specId },
      );
    }
  },
);

migrationShapeSpecGenerationRouter.get(
  '/projects/:projectId/migration-books-of-work/:bookId/spec-generations/manually-edited-in-scope',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    // Forward the \`workItemIds\` query verbatim (repeated key or comma form).
    // Express parses repeated \`?workItemIds=A&workItemIds=B\` as either a
    // string (single) or string[] (multi); we re-serialise into the same
    // shape AMS expects on its @RequestParam List<UUID>.
    const baseUrl2 = baseUrl; // alias to keep formatting consistent below
    let url =
      \`\${baseUrl2}/api/projects/\${encodeURIComponent(projectId)}\` +
      \`/migration-books-of-work/\${encodeURIComponent(bookId)}\` +
      \`/spec-generations/manually-edited-in-scope\`;
    const raw = req.query.workItemIds;
    if (raw) {
      const ids: string[] = Array.isArray(raw)
        ? raw.map((v) => String(v)).filter((v) => v.length > 0)
        : [String(raw)].filter((v) => v.length > 0);
      if (ids.length > 0) {
        const qs = ids
          .map((v) => \`workItemIds=\${encodeURIComponent(v)}\`)
          .join('&');
        url = \`\${url}?\${qs}\`;
      }
    }
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, { method: 'GET', headers });
      console.log(
        \`[diag-gw] route=spec-generations-manually-edited-in-scope \` +
          \`status=\${upstream.status} elapsed_ms=\${Date.now() - start}\`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(
        res,
        error,
        'manually-edited-in-scope',
        requestId,
        { projectId, bookId },
      );
    }
  },
);
`,
  },
];

let src = fs.readFileSync(ROUTE, 'utf-8');
for (const e of edits) {
  if (src.indexOf(e.find) === -1) {
    console.error('Find pattern not found:');
    console.error(e.find.split('\n').slice(0, 4).join('\n'));
    process.exit(2);
  }
  if (src.indexOf(e.find) !== src.lastIndexOf(e.find)) {
    console.error('Find pattern AMBIGUOUS:');
    console.error(e.find.split('\n').slice(0, 4).join('\n'));
    process.exit(3);
  }
  src = src.replace(e.find, e.replace);
}
fs.writeFileSync(ROUTE, src);
console.log('Route updated:', ROUTE);
