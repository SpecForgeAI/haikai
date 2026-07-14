/**
 * Engine-name guard (Data-Tier Oracle Program, Spec O governance).
 *
 * Architecture principle: two kinds of code, one kind of data. GENERIC
 * modules never name a database engine — engine knowledge lives in pack
 * code (designated paths, e.g. services/dbMigrationPack/**, discovery's
 * dialect classifier) or in the migration-pair ruleset
 * (migration-pairs/*.rules.json).
 *
 * This guard counts lines containing an engine token in each designated
 * GENERIC module and pins the count EXACTLY (never >=, per the
 * anti-pattern-guard discipline: a >= guard is what hides the next leak).
 * The allowlist below is a BURN-DOWN list — counts may only go DOWN. If
 * this test fails because a count went UP: move the engine knowledge into
 * the pair ruleset or a pack module instead of raising the allowance.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC_ROOT = join(__dirname, '..');

const ENGINE_TOKEN = /sybase|postgres|t-?sql/i;

/**
 * file → allowed count of lines containing an engine token, with the reason
 * the residue is (temporarily) tolerated.
 */
const GENERIC_MODULE_ALLOWLIST: Record<string, { allowed: number; reason: string }> = {
  // Wire vocabulary ('tsql' sql_dialect values, "sql_dialect":"tsql" probe)
  // + Spec F provenance comments + SPEC.DIAL predicate titles. Burn-down:
  // neutralise the wire values behind a ruleset-owned label (recorded
  // follow-up in the program doc).
  'services/migrationCodeSpecCarriage.ts': { allowed: 13, reason: 'tsql wire vocabulary + Spec F comments' },
  // 'tsql_dialect_sql' / 'translated_proc' affected-reason vocabulary shared
  // with AMS readiness counts — renaming is a cross-service wire change.
  'services/dbChangeConsumerResolver.ts': { allowed: 9, reason: 'affected-reason wire vocabulary' },
  'services/migrationBookOfWorkHandler.ts': { allowed: 3, reason: 'dialect_affected wiring comments/reasons' },
  'services/migrationBookOfWorkExpansionHandler.ts': { allowed: 3, reason: 'dialect_affected wiring comments/reasons' },
  'services/migrationCodeStreamPlanner.ts': { allowed: 2, reason: 'dialect_affected flag vocabulary' },
  'routes/migrationExecution.ts': { allowed: 5, reason: 'target-DB credential route comments (Spec N residual)' },
  // Generic-by-construction modules: MUST stay clean.
  'services/migrationShapeSpecGenerationHandler.ts': { allowed: 0, reason: 'generic' },
  'services/migrationParityVerdictEmitter.ts': { allowed: 0, reason: 'generic' },
  'services/migrationRunParityStatus.ts': { allowed: 0, reason: 'generic' },
  'services/migrationReconciliationDriver.ts': { allowed: 0, reason: 'generic' },
  'migrationPairRules.ts': { allowed: 0, reason: 'the pair-rules library itself is generic core' },
};

function engineTokenLineCount(relPath: string): number {
  const text = readFileSync(join(SRC_ROOT, relPath), 'utf8');
  return text.split(/\r?\n/).filter((line) => ENGINE_TOKEN.test(line)).length;
}

describe('engine-name guard (generic modules)', () => {
  for (const [relPath, entry] of Object.entries(GENERIC_MODULE_ALLOWLIST)) {
    test(`${relPath} has exactly ${entry.allowed} engine-token line(s) [${entry.reason}]`, () => {
      const actual = engineTokenLineCount(relPath);
      if (actual > entry.allowed) {
        throw new Error(
          `${relPath}: ${actual} engine-token lines (allowed ${entry.allowed}). ` +
            `Engine knowledge belongs in a pack module or the migration-pair ` +
            `ruleset (migration-pairs/*.rules.json) — do not raise the allowance.`,
        );
      }
      if (actual < entry.allowed) {
        throw new Error(
          `${relPath}: ${actual} engine-token lines but the allowlist says ${entry.allowed}. ` +
            `A leak was burned down — ratchet the allowlist DOWN to ${actual} so it cannot creep back.`,
        );
      }
      expect(actual).toBe(entry.allowed);
    });
  }
});
