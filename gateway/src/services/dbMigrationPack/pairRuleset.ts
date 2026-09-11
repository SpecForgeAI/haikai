/**
 * Pack-side pair-ruleset resolution (pair-per-project, SQL Server 16 ->
 * PostgreSQL 18 pair programme, Spec 0, 2026-09-11).
 *
 * The pack manifest carries the pair the pack was generated for (`pair_id`,
 * `source_engine`, `target_engine`); every gateway consumer of the ruleset
 * that has a pack at hand resolves through here instead of the process-wide
 * `loadPairRuleset()` (which is now only the deployment PIN / single-file
 * discovery).
 *
 * Resolution order:
 *   1. an injected loader (test seam / explicit dependency) when it yields a
 *      ruleset — this is also how the env PIN wins, because the default
 *      injected loader IS `loadPairRuleset()`;
 *   2. the manifest's `pair_id`;
 *   3. the manifest's `source_engine` (+ `target_engine`, default postgres);
 *   4. null — callers degrade honestly (no rule citations), never throw.
 */
import {
  activeRules,
  loadPairRuleset,
  loadPairRulesetById,
  resolvePairRuleset,
  type MigrationPairRuleset,
} from '../../migrationPairRules';

export interface PairManifestLike {
  pair_id?: unknown;
  source_engine?: unknown;
  target_engine?: unknown;
}

/**
 * Look one rule up by its `divergence_class` and return its ID (Spec 5.5).
 *
 * The ruleset is DATA: the pack cites rule IDs, it never SPELLS them. A
 * divergence_class (`temporal_table`, `fulltext`, `spatial`, `hierarchyid`,
 * `sql_variant`, `xml_methods`, `collation_case`, …) is a stable vocabulary
 * shared across pairs, so the same lookup finds the right rule whichever
 * ruleset is loaded — and returns null, honestly, when the pair declares no
 * rule for the class (the emitted text then simply carries no citation).
 */
export function ruleIdForDivergenceClass(
  ruleset: MigrationPairRuleset | null | undefined,
  divergenceClass: string,
): string | null {
  if (!ruleset) return null;
  const cls = String(divergenceClass ?? '').trim().toLowerCase();
  if (cls === '') return null;
  for (const rule of activeRules(ruleset)) {
    const rc = (rule as { divergence_class?: unknown }).divergence_class;
    if (typeof rc === 'string' && rc.trim().toLowerCase() === cls) return rule.id;
  }
  return null;
}

/** A `ruleCite` closure for the emitters: divergence class -> rule id or null. */
export function ruleCiteFor(
  ruleset: MigrationPairRuleset | null | undefined,
): (divergenceClass: string) => string | null {
  return (divergenceClass: string) => ruleIdForDivergenceClass(ruleset, divergenceClass);
}

export function manifestSourceEngine(manifest: PairManifestLike | null | undefined): string | null {
  const v = manifest?.source_engine;
  return typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : null;
}

export function rulesetForManifest(
  manifest: PairManifestLike | null | undefined,
  loader: () => MigrationPairRuleset | null = loadPairRuleset,
): MigrationPairRuleset | null {
  let injected: MigrationPairRuleset | null = null;
  try {
    injected = loader();
  } catch {
    injected = null;
  }
  if (injected) return injected;
  if (!manifest) return null;
  const byId = typeof manifest.pair_id === 'string' ? loadPairRulesetById(manifest.pair_id) : null;
  if (byId) return byId;
  const sourceEngine = manifestSourceEngine(manifest);
  if (!sourceEngine) return null;
  const targetEngine = typeof manifest.target_engine === 'string' ? manifest.target_engine : 'postgres';
  return resolvePairRuleset({ sourceEngine, targetEngine });
}
