/**
 * Candidate dedup helpers for the V3 LLM gap-fill stage.
 *
 * The LLM gap-fill stage is instructed not to restate adapter-produced
 * pack-output candidates, but some duplication is inevitable. This module
 * provides the normalization + key-building + drop logic used to reconcile
 * LLM candidates against pack candidates before emission.
 *
 * Dedup key (per Q8 in requirements): `(type, normalize(name), filePath)`.
 * - `type` compared exactly
 * - `name` normalized: trim + lowercase + collapse internal
 *   whitespace/underscores/hyphens to a single space
 * - `filePath` forward-slash normalized (Windows-friendly)
 *
 * Dedup-AGAINST-EXISTING (Model-Aware Discovery, 2026-05-30) -- CONCEPT ONLY:
 * a separate, model-aware concern asks whether an LLM candidate restates an
 * entity that ALREADY exists in the persisted (project, architecture) model
 * (not just one produced WITHIN this run). That nudge is delivered to the LLM
 * purely through the prompt's "Existing Entities" section (see
 * `composer.ts` / `injection.ts` / `existingEntityIndex.ts`): the model is
 * asked not to restate known entities and to propose `enrich` / `link`
 * candidates instead. The AUTHORITATIVE dedup-against-existing match is
 * deliberately NOT implemented here -- it runs deterministically in CODE at
 * save-back (`mcp-server/candidateSaveBackService.ts`, exact = 1.0 /
 * normalized = 0.7 / 0.75 gate). This module stays scoped to WITHIN-run
 * dedup-against-pack-output; it must never become the load-bearing
 * cross-run matcher.
 *
 * Spec: V3 Layered Prompt System — Task Group 2 (dedup helper);
 *       2026-05-30 Model-Aware Discovery — Task Group 2 (framing nudge).
 */

/**
 * Candidate shape sufficient for dedup.
 *
 * Intentionally loose: dedup runs over both pack-adapter candidates and
 * LLM-parsed candidates, whose full shapes differ. Only the three dedup-key
 * fields are required here.
 */
export interface DedupCandidate {
  type: string;
  name: string;
  filePath: string;
  /**
   * Optional source tag (e.g. `'angularjs-classic-adapter'`) inherited from
   * a pack candidate's `data._addedBy`. Used by the type-swap guard so
   * adapters explicitly enrolled in the trusted-classifier set can prevent
   * the LLM from re-emitting the same name+path under a different `type`.
   * Unset on LLM candidates and on adapters not enrolled.
   */
  addedBy?: string;
}

/**
 * Pack adapters whose classifications the dedup pass treats as authoritative
 * for the type-swap guard. When a pack candidate from one of these adapters
 * shares a `(normalizedName, filePath)` tuple with an LLM candidate but the
 * `type` differs, the LLM candidate is dropped.
 *
 * Carve-out rationale: most adapters emit a partial view, so the LLM may
 * legitimately re-classify their output. AngularJS 1.x is a special case
 * because the screen-vs-component distinction is determined by an explicit
 * route binding the LLM cannot see in a per-file prompt — the pack scans
 * every file, so it owns that classification.
 */
const TRUSTED_CLASSIFIER_ADAPTERS = new Set<string>([
  'angularjs-classic-adapter',
]);

/**
 * Structured dedup key tuple.
 *
 * Returned from `dedupKey` so callers can inspect components individually
 * (e.g. for logging). The string form used for `Set`/`Map` lookups is
 * produced by `dedupKeyString`.
 */
export interface DedupKey {
  type: string;
  normalized: string;
  filePath: string;
}

/**
 * Normalize a candidate name for dedup comparison.
 *
 * Steps:
 *   1. Trim leading/trailing whitespace
 *   2. Lowercase
 *   3. Collapse any run of internal whitespace, underscores, or hyphens into
 *      a single ASCII space
 *
 * Examples:
 *   "PatientController"       -> "patientcontroller"
 *   "patient_controller"      -> "patient controller"
 *   "Patient Controller"      -> "patient controller"
 *   "  PATIENT--Controller "  -> "patient controller"
 *
 * Note: camelCase is NOT split — `PatientController` normalizes to
 * `patientcontroller`. Callers emitting both `PatientController` and
 * `patient_controller` will still dedup together because both variants
 * typically come through one side only (LLM emits human-readable names,
 * adapters emit class-literal names); the overlap is handled elsewhere
 * when needed.
 */
export function normalizeName(name: string): string {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim().toLowerCase();
  // Collapse whitespace/underscores/hyphens (one or more) into a single space.
  return trimmed.replace(/[\s_\-]+/g, ' ');
}

/**
 * Normalize a file path for dedup comparison.
 *
 * Forward-slash normalization only — we do not resolve, strip roots, or
 * canonicalize case (filesystems differ). The intent is that
 * `src\\main\\X.java` and `src/main/X.java` compare equal.
 */
export function forwardSlashNormalize(filePath: string): string {
  if (typeof filePath !== 'string') return '';
  return filePath.replace(/\\/g, '/');
}

/**
 * Build the structured dedup key for a candidate.
 */
export function dedupKey(candidate: DedupCandidate): DedupKey {
  return {
    type: candidate.type,
    normalized: normalizeName(candidate.name),
    filePath: forwardSlashNormalize(candidate.filePath),
  };
}

/**
 * Build the string form of the dedup key for Set/Map membership checks.
 *
 * Uses a delimiter unlikely to appear in any of the three components
 * (null byte) so we never get collisions from unlucky content.
 */
export function dedupKeyString(candidate: DedupCandidate): string {
  const key = dedupKey(candidate);
  return `${key.type}\u0000${key.normalized}\u0000${key.filePath}`;
}

/**
 * Result shape returned by `dedupLlmCandidates`.
 *
 * `kept` holds the surviving LLM candidates; `droppedCount` is surfaced onto
 * the stage payload so operators can monitor how often the LLM restates
 * adapter findings despite the anti-restate rule in `base.md`.
 */
export interface DedupResult<T extends DedupCandidate> {
  kept: T[];
  droppedCount: number;
}

/**
 * Optional logger injection — the production path writes to `console.log`
 * but tests can pass a custom sink to verify log content.
 */
export type DedupLogger = (message: string) => void;

/**
 * Drop LLM candidates whose dedup key matches any pack candidate's key.
 *
 * Logs one line per dropped duplicate; returns the surviving candidates plus
 * the dropped count for stage-payload reporting.
 *
 * The input lists stay untouched (pure function w.r.t. inputs).
 */
export function dedupLlmCandidates<T extends DedupCandidate>(
  packCandidates: DedupCandidate[],
  llmCandidates: T[],
  logger: DedupLogger = (msg) => console.log(msg),
): DedupResult<T> {
  const packKeys = new Set<string>();
  // Index for the type-swap guard: `(normalizedName, filePath)` →
  // `{type, addedBy}` for every pack candidate flagged as a trusted
  // classifier. Lookups here let us drop an LLM candidate that matches
  // a trusted pack candidate by name+path under a different type.
  const trustedByNamePath = new Map<string, { type: string; addedBy: string }>();
  for (const pack of packCandidates || []) {
    packKeys.add(dedupKeyString(pack));
    if (pack.addedBy && TRUSTED_CLASSIFIER_ADAPTERS.has(pack.addedBy)) {
      const k = dedupKey(pack);
      const namePathKey = `${k.normalized}\u0000${k.filePath}`;
      // First-write-wins: if the same name+path appears multiple times
      // in pack output (rare but possible), keep the first claim.
      if (!trustedByNamePath.has(namePathKey)) {
        trustedByNamePath.set(namePathKey, { type: pack.type, addedBy: pack.addedBy });
      }
    }
  }

  const kept: T[] = [];
  let droppedCount = 0;
  for (const llm of llmCandidates || []) {
    const key = dedupKeyString(llm);
    if (packKeys.has(key)) {
      droppedCount += 1;
      const k = dedupKey(llm);
      logger(
        `[dedup] dropping LLM candidate duplicating pack output: type=${k.type} name="${llm.name}" (normalized="${k.normalized}") filePath=${k.filePath}`,
      );
      continue;
    }
    // Type-swap guard: same name+path, different type, trusted pack
    // adapter. The LLM is trying to re-classify a pack candidate; drop.
    const llmKey = dedupKey(llm);
    const namePathKey = `${llmKey.normalized}\u0000${llmKey.filePath}`;
    const trusted = trustedByNamePath.get(namePathKey);
    if (trusted && trusted.type !== llmKey.type) {
      droppedCount += 1;
      logger(
        `[dedup] dropping LLM candidate via type-swap guard: pack ${trusted.addedBy} emitted type=${trusted.type} for name="${llm.name}" (normalized="${llmKey.normalized}") filePath=${llmKey.filePath}; LLM tried to re-emit as type=${llmKey.type}`,
      );
      continue;
    }
    kept.push(llm);
  }

  return { kept, droppedCount };
}
