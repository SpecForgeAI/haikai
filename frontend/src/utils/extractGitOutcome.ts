/**
 * Defensive git-outcome extraction from an orchestration job result.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * Task Group 5: Defensive git-outcome rendering on completion.
 *
 * The upstream JobDetailResponse.result is UNTYPED (additionalProperties:
 * true) and the branch / PR key names are not documented in the contract.
 * This module is therefore the SINGLE, isolated place where key matching
 * happens — once the exact keys are confirmed with the upstream developer,
 * only the candidate lists below need adjusting.
 *
 * The extraction must tolerate ANY result shape: missing, null, primitives,
 * arrays, deeply nested objects — it never throws.
 */

/**
 * The git outcome of an implementation job, as best as it could be
 * determined from the untyped job result. All fields optional — absence
 * means the result did not carry a recognisable value.
 */
export interface GitOutcome {
  /** Feature branch the implementation was pushed to */
  branch?: string;
  /** Pull request URL, when the service opened one */
  prUrl?: string;
  /** URL to the job's logs */
  logsUrl?: string;
}

/**
 * Candidate key lists (compared against lower-cased keys with '-' and '.'
 * normalised to '_'). Order matters: earlier entries win when several keys
 * are present at the same depth. Adjust these once upstream confirms the
 * real key names.
 */
const BRANCH_KEYS = ['feature_branch', 'branch', 'branch_name', 'git_branch', 'feature_branch_name'];
const PR_URL_KEYS = ['pr_url', 'pull_request_url', 'pr_link', 'pull_request_link', 'pull_request', 'pr'];
const LOGS_URL_KEYS = ['logs_url', 'log_url', 'logs_link', 'logs'];

/** Maximum nesting depth to scan — keeps the walk cheap and cycle-safe. */
const MAX_SCAN_DEPTH = 4;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-.]/g, '_');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Breadth-first scan of an arbitrary value for the first non-empty string
 * held under any of the candidate keys. Shallower matches win; at equal
 * depth, earlier candidate-list entries win.
 */
function findStringByKeys(root: unknown, candidateKeys: string[]): string | undefined {
  let level: unknown[] = [root];

  for (let depth = 0; depth < MAX_SCAN_DEPTH && level.length > 0; depth++) {
    const nextLevel: unknown[] = [];
    // Collect candidate matches at this depth, then pick by candidate priority
    const matchesAtDepth = new Map<string, string>();

    for (const node of level) {
      if (Array.isArray(node)) {
        nextLevel.push(...node);
        continue;
      }
      if (!isPlainObject(node)) {
        continue;
      }
      for (const [key, value] of Object.entries(node)) {
        const normalised = normaliseKey(key);
        if (
          candidateKeys.includes(normalised) &&
          typeof value === 'string' &&
          value.trim() !== '' &&
          !matchesAtDepth.has(normalised)
        ) {
          matchesAtDepth.set(normalised, value.trim());
        } else if (isPlainObject(value) || Array.isArray(value)) {
          nextLevel.push(value);
        }
      }
    }

    for (const candidate of candidateKeys) {
      const match = matchesAtDepth.get(candidate);
      if (match !== undefined) {
        return match;
      }
    }
    level = nextLevel;
  }

  return undefined;
}

/**
 * Extracts the git outcome (feature branch / PR URL / logs URL) from an
 * untyped orchestration job result, tolerating any shape including
 * missing/empty. An explicit top-level logsUrl (from JobDetailResponse
 * .logs_url) takes precedence over anything found inside the result.
 *
 * @param result - The untyped JobDetailResponse.result payload
 * @param logsUrl - The JobDetailResponse.logs_url field, when present
 * @returns A GitOutcome with whatever could be recognised (possibly empty)
 */
export function extractGitOutcome(result: unknown, logsUrl?: string): GitOutcome {
  const outcome: GitOutcome = {};

  try {
    const branch = findStringByKeys(result, BRANCH_KEYS);
    if (branch) {
      outcome.branch = branch;
    }
    const prUrl = findStringByKeys(result, PR_URL_KEYS);
    if (prUrl) {
      outcome.prUrl = prUrl;
    }
    const embeddedLogsUrl = findStringByKeys(result, LOGS_URL_KEYS);
    const effectiveLogsUrl = (logsUrl && logsUrl.trim()) || embeddedLogsUrl;
    if (effectiveLogsUrl) {
      outcome.logsUrl = effectiveLogsUrl;
    }
  } catch {
    // Defensive: never let outcome extraction break the completion flow.
  }

  return outcome;
}

/**
 * True when the outcome carries at least one recognised value.
 */
export function hasGitOutcome(outcome: GitOutcome): boolean {
  return Boolean(outcome.branch || outcome.prUrl || outcome.logsUrl);
}
