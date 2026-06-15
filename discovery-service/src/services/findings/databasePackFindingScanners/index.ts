/**
 * Database-pack finding builder barrel.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 * Extended: 2026-05-29 DB Structural Fidelity (Group B) -- trigger_logic /
 * view_definition / sequence_definition builders.
 * Extended: 2026-05-30 Data-Layer Fidelity 2 -- collation CI->CS hazard (B),
 * sequence cutover hazard + detector (C), non-portable default hazard +
 * detector (D), database-resident scheduled-job finding (F).
 *
 * Re-exports the per-finding-type builders so engine packs (PostgresPack in
 * Group 3, SybasePack in Group 4) can import them from a single barrel:
 *
 *     import {
 *       buildMissingPrimaryKeyFinding,
 *       buildInferredRelationshipFinding,
 *       ...
 *     } from '../findings/databasePackFindingScanners';
 *
 * Also re-exports `MAX_FINDINGS_PER_TYPE_PER_RUN` from the existing
 * `packFindingScanners/constants` so DB packs respect the same cap as
 * code packs (no parallel constant; single source of truth).
 */

export {
  buildMissingPrimaryKeyFinding,
  buildNoForeignKeysDeclaredFinding,
  buildInferredRelationshipFinding,
  buildHighNullRateFinding,
  buildDbMigrationRiskFinding,
  buildStoredProcedureLogicFinding,
  buildHiddenBusinessLogicFinding,
  buildTriggerLogicFinding,
  buildViewDefinitionFinding,
  buildSequenceDefinitionFinding,
  buildSequenceCutoverHazardFinding,
  buildCollationHazardFinding,
  collationImpliesCaseInsensitive,
  detectNonPortableDefault,
  buildNonPortableDefaultFinding,
  buildScheduledJobFinding,
  buildDbEvidenceGapFinding,
  buildDbPackWarningFinding,
  type DbFindingEngineKey,
  type DbMigrationRiskCategory,
  type HiddenLogicSourceObjectType,
  type DbEvidenceGapType,
} from './databasePackFindingBuilders';

export { MAX_FINDINGS_PER_TYPE_PER_RUN } from '../packFindingScanners/constants';
