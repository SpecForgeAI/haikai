/* Anchored splices for TG5 — SaveAsBaselineModal batch + navigate-to-list.
 * Preserves CRLF. Fails loudly if any anchor is missing or not unique. */
const fs = require('fs');
const path =
  'C:/Workspaces/SSD/haikai/frontend/src/components/DashboardView/SaveAsBaselineModal.tsx';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(label, find, repl) {
  const i = s.indexOf(find);
  if (i === -1) throw new Error(`ANCHOR NOT FOUND [${label}]`);
  if (s.indexOf(find, i + 1) !== -1)
    throw new Error(`ANCHOR NOT UNIQUE [${label}]`);
  s = s.slice(0, i) + repl + s.slice(i + find.length);
}

// --- 1) Import: swap createBaselineItem for createBaselineItemsBatch + type ---
replaceOnce(
  'import-createBaselineItem',
  '  createBaseline,\r\n  createBaselineItem,\r\n} from \'../../api/apiBehaviourClient\';',
  '  createBaseline,\r\n  createBaselineItemsBatch,\r\n  type BatchCreateBaselineItemFailure,\r\n} from \'../../api/apiBehaviourClient\';',
);

// --- 2) State: add a `warning` next to `error` ---
replaceOnce(
  'state-error',
  '  const [error, setError] = useState<string | null>(null);\r\n',
  '  const [error, setError] = useState<string | null>(null);\r\n  // Best-effort batch save (Spec 2026-06-20, R1/R4): the save POSTs every\r\n  // accepted capture in ONE `createBaselineItemsBatch` call rather than looping\r\n  // one gateway request per capture (which tripped the rate limiter). The call\r\n  // is NON-atomic: a bad item is reported in `failed[]` WITHOUT aborting the\r\n  // rest, so the save still succeeds for the `created` rows. Surface `failed[]`\r\n  // here as a non-fatal warning naming the captures that did not persist.\r\n  const [warning, setWarning] = useState<string | null>(null);\r\n',
);

// --- 3) Replace the sequential loop with a single batch call ---
replaceOnce(
  'reset-warning',
  '    setSubmitting(true);\r\n    setError(null);\r\n    try {',
  '    setSubmitting(true);\r\n    setError(null);\r\n    setWarning(null);\r\n    try {',
);

const loopFind =
  '      // Sequential bulk create -- see file comment for rationale.\r\n' +
  '      for (const cap of acceptedCaptures) {\r\n' +
  '        const op = operationById.get(cap.operation_id);\r\n' +
  '        const scenario = scenarioById.get(cap.scenario_id);\r\n' +
  '        await createBaselineItem(projectId, architectureId, {\r\n' +
  '          baseline_id: baseline.id,';

const loopRepl =
  '      // Best-effort batch create (Spec 2026-06-20, R1/R4). Build the item\r\n' +
  '      // array EXACTLY as the former per-capture loop did (the\r\n' +
  '      // `{ query, headers, body }` request_json envelope, the\r\n' +
  '      // `{ headers, body }` response_json envelope, and the volatile /\r\n' +
  '      // sequence carry per item), then POST them all in ONE\r\n' +
  '      // `createBaselineItemsBatch` call instead of N sequential POSTs. The\r\n' +
  '      // call is non-atomic: `created` rows commit even when `failed[]` is\r\n' +
  '      // non-empty, so we treat the save as succeeded for the created items.\r\n' +
  '      const items = acceptedCaptures.map((cap) => {\r\n' +
  '        const op = operationById.get(cap.operation_id);\r\n' +
  '        const scenario = scenarioById.get(cap.scenario_id);\r\n' +
  '        return {\r\n' +
  '          baseline_id: baseline.id,';

replaceOnce('loop-head', loopFind, loopRepl);

// Close the per-item object + close the loop body, then issue the batch call.
const loopTailFind =
  '          sequence_json:\r\n' +
  '            sequenceCarryByCaptureId.get(cap.id)?.sequence_json ?? null,\r\n' +
  '        });\r\n' +
  '      }\r\n';

const loopTailRepl =
  '          sequence_json:\r\n' +
  '            sequenceCarryByCaptureId.get(cap.id)?.sequence_json ?? null,\r\n' +
  '        };\r\n' +
  '      });\r\n' +
  '\r\n' +
  '      const { failed } = await createBaselineItemsBatch(\r\n' +
  '        projectId,\r\n' +
  '        architectureId,\r\n' +
  '        items,\r\n' +
  '      );\r\n' +
  '\r\n' +
  '      // Best-effort: the save SUCCEEDS for the created rows even when some\r\n' +
  '      // items failed. Surface the failures as a non-fatal warning naming the\r\n' +
  '      // exact captures (by `capture_id`, falling back to the submitted index)\r\n' +
  '      // so the reviewer knows the baseline is partial -- we still proceed to\r\n' +
  '      // refresh the model and navigate to the list.\r\n' +
  '      if (failed.length > 0) {\r\n' +
  '        setWarning(describeBatchFailures(failed));\r\n' +
  '      }\r\n';

replaceOnce('loop-tail', loopTailFind, loopTailRepl);

// --- 4) Navigate to the LIST route, not the detail route ---
replaceOnce(
  'navigate-list',
  '      navigate(\r\n' +
    '        `/projects/${projectId}/architectures/${architectureId}` +\r\n' +
    '          `/api-behaviour/baselines/${baseline.id}`,\r\n' +
    '      );\r\n',
  '      // Post-save navigation (Spec 2026-06-20, R4): land back on the\r\n' +
    '      // baselines LIST -- NOT the per-item detail dump. The new baseline\r\n' +
    '      // shows there as `draft`; activation is a deliberate, separate Make\r\n' +
    '      // Active action (no auto-activate, because a best-effort save can\r\n' +
    '      // leave gaps).\r\n' +
    '      navigate(\r\n' +
    '        `/projects/${projectId}/architectures/${architectureId}` +\r\n' +
    '          `/api-behaviour`,\r\n' +
    '      );\r\n',
);

// --- 5) describeBatchFailures helper (beside describeError) ---
replaceOnce(
  'helper-describeError',
  'function describeError(err: unknown): string {\r\n' +
    '  if (err instanceof Error) return err.message;\r\n' +
    '  return \'Unexpected error\';\r\n' +
    '}\r\n',
  'function describeError(err: unknown): string {\r\n' +
    '  if (err instanceof Error) return err.message;\r\n' +
    '  return \'Unexpected error\';\r\n' +
    '}\r\n' +
    '\r\n' +
    '/**\r\n' +
    ' * Render the best-effort batch `failed[]` as a single human-readable warning\r\n' +
    ' * line naming the captures that did not persist (by `capture_id`, falling\r\n' +
    ' * back to the 0-based submitted index when the item carried none). The save\r\n' +
    ' * still succeeded for the created rows -- this is informational, not an error.\r\n' +
    ' */\r\n' +
    'function describeBatchFailures(\r\n' +
    '  failed: BatchCreateBaselineItemFailure[],\r\n' +
    '): string {\r\n' +
    '  const labels = failed.map(\r\n' +
    '    (f) => f.capture_id ?? `item #${f.index}`,\r\n' +
    '  );\r\n' +
    '  const noun = failed.length === 1 ? \'item\' : \'items\';\r\n' +
    '  return (\r\n' +
    '    `${failed.length} ${noun} could not be saved and were skipped ` +\r\n' +
    '    `(the rest were saved): ${labels.join(\', \')}.`\r\n' +
    '  );\r\n' +
    '}\r\n',
);

// --- 6) Render the warning banner (after the error banner) ---
replaceOnce(
  'render-warning-banner',
  '        {error && <div className={styles.errorBanner}>{error}</div>}\r\n',
  '        {error && <div className={styles.errorBanner}>{error}</div>}\r\n' +
    '\r\n' +
    '        {warning && (\r\n' +
    '          <div\r\n' +
    '            className={styles.warningBanner}\r\n' +
    '            data-testid="save-as-baseline-batch-warning"\r\n' +
    '          >\r\n' +
    '            {warning}\r\n' +
    '          </div>\r\n' +
    '        )}\r\n',
);

fs.writeFileSync(path, s, 'utf8');
console.log('TG5 splices applied OK');
