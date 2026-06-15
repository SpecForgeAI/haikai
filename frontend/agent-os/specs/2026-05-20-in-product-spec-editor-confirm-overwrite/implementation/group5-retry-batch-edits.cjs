/*
 * Retry-batch route extension for Task Group 5.
 * Handles CRLF line endings.
 */
const fs = require('fs');
const ROUTE = 'C:/Workspaces/SSD/architecture-store-and-diagrams/gateway/src/routes/missingInputResolutions.ts';

function normalize(s) {
  return s.replace(/\r\n/g, '\n');
}

const edits = [
  {
    find: `    const body = (req.body ?? {}) as {
      workItemIds?: unknown;
      bookOfWorkId?: unknown;
      confirmed?: unknown;
      confirmOverwrite?: unknown;
    };`,
    replace: `    const body = (req.body ?? {}) as {
      workItemIds?: unknown;
      bookOfWorkId?: unknown;
      confirmed?: unknown;
      confirmOverwrite?: unknown;
      // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5).
      overwriteManuallyEdited?: unknown;
      manuallyEditedWorkItemIdsToOverwrite?: unknown;
    };`,
  },

  {
    find: `      const result = await runShapeSpecGenerationBatch(
        {
          projectId,
          bookOfWorkId,
          regenerateAll: true,
          confirmOverwrite:
            typeof body.confirmOverwrite === 'boolean'
              ? body.confirmOverwrite
              : false,
          targetWorkItemIds: workItemIds,
        },
        productionDeps,
      );`,
    replace: `      const result = await runShapeSpecGenerationBatch(
        {
          projectId,
          bookOfWorkId,
          regenerateAll: true,
          confirmOverwrite:
            typeof body.confirmOverwrite === 'boolean'
              ? body.confirmOverwrite
              : false,
          targetWorkItemIds: workItemIds,
          // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task
          // Group 5): forward the overwrite flag + allow-list so the
          // handler's pre-flight + filter step splits the candidate set
          // into "overwrite" vs "skip" before the batch loop fires.
          overwriteManuallyEdited:
            typeof body.overwriteManuallyEdited === 'boolean'
              ? body.overwriteManuallyEdited
              : undefined,
          manuallyEditedWorkItemIdsToOverwrite: Array.isArray(
            body.manuallyEditedWorkItemIdsToOverwrite,
          )
            ? (body.manuallyEditedWorkItemIdsToOverwrite as unknown[]).filter(
                (v): v is string => typeof v === 'string' && v.length > 0,
              )
            : undefined,
        },
        productionDeps,
      );`,
  },
];

// Read as buffer to detect CRLF
const buf = fs.readFileSync(ROUTE);
const hadCRLF = buf.includes(Buffer.from('\r\n'));
let src = buf.toString('utf-8');
const srcNorm = normalize(src);

let outNorm = srcNorm;
for (const e of edits) {
  const findNorm = normalize(e.find);
  const replaceNorm = normalize(e.replace);
  if (outNorm.indexOf(findNorm) === -1) {
    console.error('Find pattern not found:');
    console.error(findNorm.split('\n').slice(0, 4).join('\n'));
    process.exit(2);
  }
  if (outNorm.indexOf(findNorm) !== outNorm.lastIndexOf(findNorm)) {
    console.error('Find pattern AMBIGUOUS');
    process.exit(3);
  }
  outNorm = outNorm.replace(findNorm, replaceNorm);
}

const final = hadCRLF ? outNorm.replace(/\n/g, '\r\n') : outNorm;
fs.writeFileSync(ROUTE, final);
console.log('Retry-batch route updated:', ROUTE, 'CRLF:', hadCRLF);
