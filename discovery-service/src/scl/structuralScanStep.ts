/**
 * Structural (SCL) scan as a CODE-DISCOVERY STEP (2026-08-19 user ruling:
 * the code discovery is THE one full pass over the codebase — it must
 * produce the structural model too. One scan, one clone; never a separate
 * trigger, never scanning the same code twice).
 *
 * The service-scoped run calls this right after its last repo-using step,
 * while the clone is still on disk, pointing at the SAME root directory the
 * LLM analysis scanned. The runner (`runSclScan`) owns the AMS scan-row
 * lifecycle (create → contracts → reachability → completed/failed PATCH), so
 * the Structural Model tab reflects the outcome either way.
 *
 * FAIL-SOFT, LOUD: a structural-scan failure never fails the code run (the
 * candidates are valuable on their own) — the outcome (completed / failed /
 * skipped + detail) rides the run's step payload.
 *
 * SKIP-WITHOUT-A-ROW when the source tree has no Java files: the corpus is
 * architecture-scoped and the tab reads the LATEST scan, so an empty scan
 * from a non-Java service would supersede a real corpus minted by a Java
 * sibling. No Java → no scan row.
 *
 * The manual route (POST /discovery/scl/scans) stays as the recovery path.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL, GATEWAY_BASE_URL } from '../config';
import { runSclScan, type RunSclScanArgs, type RunSclScanResult } from './sclScanRunner';

/**
 * Annotation request outcome (2026-08-19 user ruling: annotation is
 * AUTOMATIC with the code scan). `requested` means the gateway accepted the
 * background pass (202) — the pass itself merges its summary into the scan's
 * stats, which the Structural Model tab renders when done.
 */
export interface AnnotationRequestOutcome {
  status: 'requested' | 'request_failed';
  detail: string | null;
}

export interface StructuralScanStepOutcome {
  status: 'completed' | 'failed' | 'skipped';
  scanId: string | null;
  contractCount: number | null;
  detail: string | null;
  /** Present only when the scan completed; null on skipped/failed scans. */
  annotation: AnnotationRequestOutcome | null;
}

/** Directories never containing first-party Java sources; skipped wholesale. */
const WALK_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'target', 'build', 'out', 'dist', '.idea']);

/** Hard cap on visited entries — a runaway tree never stalls the run. */
const WALK_ENTRY_CAP = 50_000;

/**
 * True as soon as one `.java` file exists under `dir` (breadth-first walk,
 * excluded build/VCS dirs pruned, symlinks not followed, entry-capped).
 */
export async function hasJavaSources(dir: string): Promise<boolean> {
  const queue: string[] = [dir];
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue; // unreadable subtree — keep walking the rest
    }
    for (const entry of entries) {
      if (++visited > WALK_ENTRY_CAP) return false;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!WALK_EXCLUDED_DIRS.has(entry.name)) queue.push(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        return true;
      }
    }
  }
  return false;
}

export interface StructuralScanStepDeps {
  /** Scan seam (tests inject a fake); default {@link runSclScan}. */
  runScan?: (args: RunSclScanArgs) => Promise<RunSclScanResult>;
  /** Java-detection seam; default {@link hasJavaSources}. */
  hasJava?: (dir: string) => Promise<boolean>;
  /** HTTP seam for the gateway annotation request; default global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Requests the LLM annotation pass from the gateway for a completed scan.
 * The gateway answers 202 and runs the pass in the background (it logs its
 * own completion; the summary lands in the scan's stats for the tab).
 * Never throws — a refusal/outage is recorded, the scan outcome stands.
 */
async function requestAnnotationPass(
  args: { projectId: string; architectureId: string; scanId: string },
  fetchFn: typeof fetch
): Promise<AnnotationRequestOutcome> {
  try {
    const response = await fetchFn(
      `${GATEWAY_BASE_URL}/api/v1/projects/${encodeURIComponent(args.projectId)}` +
        `/architectures/${encodeURIComponent(args.architectureId)}/scl/annotation/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ scan_id: args.scanId }),
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        status: 'request_failed',
        detail: `gateway returned HTTP ${response.status}${text ? `: ${text.substring(0, 200)}` : ''}`,
      };
    }
    return { status: 'requested', detail: null };
  } catch (err) {
    return {
      status: 'request_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Runs the structural scan against the code scan's own root directory and
 * returns the step outcome. Never throws.
 */
export async function runStructuralScanStep(
  args: { projectId: string; architectureId: string; sourceDir: string },
  deps?: StructuralScanStepDeps
): Promise<StructuralScanStepOutcome> {
  const runScan = deps?.runScan ?? runSclScan;
  const hasJava = deps?.hasJava ?? hasJavaSources;
  const fetchFn = deps?.fetchFn ?? fetch;

  try {
    if (!(await hasJava(args.sourceDir))) {
      return {
        status: 'skipped',
        scanId: null,
        contractCount: null,
        detail: 'no Java sources under the scanned root — structural corpus not applicable',
        annotation: null,
      };
    }
  } catch (err) {
    return {
      status: 'failed',
      scanId: null,
      contractCount: null,
      detail: `Java-source detection failed: ${err instanceof Error ? err.message : String(err)}`,
      annotation: null,
    };
  }

  try {
    const result = await runScan({
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceDir: args.sourceDir,
      amsBaseUrl: ARCHITECTURE_MODEL_SERVICE_BASE_URL,
    });
    // 2026-08-19 ruling: the annotation pass fires automatically with the
    // scan (the user opted for automatic despite the LLM token cost). A
    // request failure is recorded loudly but never dents the scan outcome.
    const annotation = await requestAnnotationPass(
      { projectId: args.projectId, architectureId: args.architectureId, scanId: result.scanId },
      fetchFn
    );
    return {
      status: 'completed',
      scanId: result.scanId,
      contractCount: result.corpus.stats.contractCount,
      detail: null,
      annotation,
    };
  } catch (err) {
    // runSclScan has already best-effort PATCHed its scan row `failed`, so
    // the Structural Model tab shows the failure too.
    return {
      status: 'failed',
      scanId: null,
      contractCount: null,
      detail: err instanceof Error ? err.message : String(err),
      annotation: null,
    };
  }
}
