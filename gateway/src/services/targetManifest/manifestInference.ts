/**
 * Manifest inference layer (badged, write-immediately).
 *
 * Spec: 2026-06-26-target-dependency-manifest-auto-answer-comprehensive (Spec 2)
 * — Task Group 4 (R4/FR4).
 *
 * PURE. No I/O, no LLM, no network. Runs OVER the deterministic-direct candidate
 * set already derived from coordinates + pom properties/plugins (Groups 2/3) and
 * produces the codes that NO single coordinate/property DIRECTLY witnesses but
 * that a deterministic hit reliably IMPLIES:
 *
 *   - `db.driver` => `db.engine` — FAMILY ONLY. A JDBC/native driver pins the
 *     server FAMILY (pgjdbc => Postgres, mysql-connector-j => MySQL, ...) but
 *     NEVER the server VERSION, so the engine is emitted bare-stem with
 *     `version-unknown` (no guessing). Source-dependency = the driver coordinate.
 *   - `service.language` => `service.runtime` — reuses Spec 1's cascade seed
 *     (Java/Kotlin => Eclipse Temurin, TypeScript/Node => Node 20 LTS, ...). The
 *     language never reveals the runtime patch version either, so the runtime is
 *     emitted bare-stem `version-unknown`. Source-dependency = the language
 *     evidence (e.g. `java.version 21`).
 *
 * The family maps are NOT re-declared here: they are READ from the live
 * `questionLibrary.ts` cascade seeds (`db.engine` => `db.driver` inverted, and
 * `service.language` => `service.runtime` direct) so this layer can never drift
 * from Spec 1's seed.
 *
 * Every inferred candidate carries `provenance: 'inferred'` + the triggering
 * `sourceDependency`. Inferred candidates are WRITTEN IMMEDIATELY (not held as
 * proposals); downstream de-dup (Task Group 6) ranks them ABOVE the LLM and
 * BELOW deterministic-direct + manual.
 */

import { VERSION_UNKNOWN } from '../../config/architect-conversation/frameworkVersionShape';
import { QUESTION_LIBRARY } from '../../config/architect-conversation/questionLibrary';
import type { ManifestAnswerCandidate } from './manifestAutoAnswerer';

// ---------------------------------------------------------------------------
// Cascade-seed readers (reuse Spec 1's seed — never re-declared locally)
// ---------------------------------------------------------------------------

/**
 * Read one cascade seed (`triggerCode` => `targetCode`) off the live question
 * library as a `Record<string,string>` (the library stores values as `unknown`).
 * Returns `{}` when the cascade is absent so the inference simply produces no
 * candidate rather than throwing.
 */
function readCascadeSeed(
  triggerCode: string,
  targetCode: string,
): Record<string, string> {
  const entry = QUESTION_LIBRARY.find((q) => q.code === triggerCode);
  const cascade = entry?.cascades.find((c) => c.decisionCode === targetCode);
  const out: Record<string, string> = {};
  if (!cascade) return out;
  for (const [k, v] of Object.entries(cascade.valueByTriggerValue)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/** Invert a `{ a: b }` map to `{ b: a }` (first-wins on duplicate values). */
function invert(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!(v in out)) out[v] = k;
  }
  return out;
}

/**
 * `db.driver` bare stem => `db.engine` bare stem, derived by INVERTING Spec 1's
 * `db.engine` => `db.driver` cascade seed (`Postgres` => `pgjdbc` becomes
 * `pgjdbc` => `Postgres`, etc.). Matches the spec's family map exactly:
 * pgjdbc/Postgres, mysql-connector-j/MySQL, mssql-jdbc/MS SQL Server,
 * oracle ojdbc11/Oracle, jtds/Sybase ASE, mongo-java-driver/MongoDB,
 * dynamodb-enhanced/DynamoDB.
 */
const DRIVER_STEM_TO_ENGINE: Record<string, string> = invert(
  readCascadeSeed('db.engine', 'db.driver'),
);

/**
 * `service.language` family => `service.runtime` value, read DIRECTLY off Spec
 * 1's `service.language` => `service.runtime` cascade seed (Java => Eclipse
 * Temurin, Kotlin => Eclipse Temurin, TypeScript/Node => Node 20 LTS, ...).
 */
const LANGUAGE_FAMILY_TO_RUNTIME: Record<string, string> = readCascadeSeed(
  'service.language',
  'service.runtime',
);

const DB_DRIVER_CODE = 'db.driver';
const DB_ENGINE_CODE = 'db.engine';
const SERVICE_LANGUAGE_CODE = 'service.language';
const SERVICE_RUNTIME_CODE = 'service.runtime';

/**
 * Find the cascade value for a candidate framework: an EXACT family-key match
 * first (the property extractor emits bare `Java`/`Kotlin`; the registry emits
 * bare driver stems), then a tolerant `startsWith` fallback so a fuller label
 * (e.g. `Java 21`) still resolves its family. Returns `null` on no match.
 */
function lookupFamily(
  framework: string,
  seed: Record<string, string>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(seed, framework)) return seed[framework];
  for (const key of Object.keys(seed)) {
    if (framework === key || framework.startsWith(`${key} `)) return seed[key];
  }
  return null;
}

/**
 * Derive the inferred candidates from the deterministic-direct candidate set.
 * Reads `db.driver` => `db.engine` (version-unknown) and `service.language` =>
 * `service.runtime` (version-unknown). Each inferred candidate carries
 * `provenance: 'inferred'` + the triggering `sourceDependency`. At most one
 * inferred candidate per target code (the FIRST triggering deterministic hit in
 * order wins; downstream de-dup also enforces one-per-code).
 *
 * NOTE: this consults ONLY deterministic-direct candidates — it never chains off
 * an LLM-proposed or already-inferred row (so an inference is always grounded in
 * a manifest-witnessed fact).
 */
export function deriveInferredCandidates(
  deterministicCandidates: readonly ManifestAnswerCandidate[],
): ManifestAnswerCandidate[] {
  const inferred: ManifestAnswerCandidate[] = [];
  const seenTargets = new Set<string>();

  for (const candidate of deterministicCandidates) {
    // Only ground inference in deterministic-direct hits.
    if ((candidate.provenance ?? 'deterministic') !== 'deterministic') continue;

    // db.driver => db.engine (family only => version-unknown).
    if (candidate.decisionCode === DB_DRIVER_CODE && !seenTargets.has(DB_ENGINE_CODE)) {
      const engine = lookupFamily(candidate.framework, DRIVER_STEM_TO_ENGINE);
      if (engine) {
        seenTargets.add(DB_ENGINE_CODE);
        const sourceDependency = candidate.sourceDependency ?? candidate.framework;
        inferred.push({
          decisionCode: DB_ENGINE_CODE,
          answerKind: 'framework-version',
          framework: engine,
          version: VERSION_UNKNOWN,
          sourceFile: candidate.sourceFile,
          sourceQuote: `${engine} (inferred from driver ${sourceDependency})`,
          tag: candidate.tag,
          provenance: 'inferred',
          sourceDependency,
        });
      }
    }

    // service.language => service.runtime (family seed => version-unknown).
    if (
      candidate.decisionCode === SERVICE_LANGUAGE_CODE &&
      !seenTargets.has(SERVICE_RUNTIME_CODE)
    ) {
      const runtime = lookupFamily(candidate.framework, LANGUAGE_FAMILY_TO_RUNTIME);
      if (runtime) {
        seenTargets.add(SERVICE_RUNTIME_CODE);
        const sourceDependency = candidate.sourceDependency ?? candidate.framework;
        inferred.push({
          decisionCode: SERVICE_RUNTIME_CODE,
          answerKind: 'framework-version',
          framework: runtime,
          version: VERSION_UNKNOWN,
          sourceFile: candidate.sourceFile,
          sourceQuote: `${runtime} (inferred from ${candidate.framework} ${sourceDependency})`,
          tag: candidate.tag,
          provenance: 'inferred',
          sourceDependency,
        });
      }
    }
  }

  return inferred;
}
