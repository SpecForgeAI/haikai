/**
 * Migration-pair ruleset loader + comparison strategy library — Spec O of
 * the Data-Tier Oracle Program
 * (agent-os/planning/2026-07-14-data-tier-oracle-program.md).
 *
 * GENERIC CORE: this module never names a database engine. Pair knowledge
 * (divergence classes, equality tolerances, rewrite guidance, scenario
 * seeds) lives in a versioned repo DATA file under `migration-pairs/`; this
 * module loads it, validates it, and applies its comparison strategies. A
 * new migration pair costs authoring a document, not writing a codebase.
 *
 * This file is the CANONICAL copy; byte-identical copies live in each Node
 * service (gateway, discovery-service, api-migration-validation-service) —
 * the trace.ts convention. Keep them byte-identical.
 *
 * Env:
 *   MIGRATION_PAIR               ruleset id — loads migration-pairs/<id>.rules.json.
 *                                Optional when exactly ONE ruleset file exists.
 *   MIGRATION_PAIR_RULESET_PATH  explicit file path (overrides MIGRATION_PAIR).
 *
 * Loading is FAIL-SOFT and cached: a missing/invalid ruleset yields null —
 * callers degrade honestly and the BOOT config header reports pair 'none'.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

// ---------------------------------------------------------------------------
// Ruleset shape (mirrors migration-pairs/*.rules.json)
// ---------------------------------------------------------------------------

export interface MigrationPairEndpoint {
  engine: string;
  version: string;
  display?: string;
}

export interface PairComparison {
  strategy: string;
  params?: Record<string, unknown>;
}

export interface MigrationPairRule {
  id: string;
  divergence_class: string;
  title: string;
  /**
   * Selectors. `column_types` (v1) keys table/cell rules; v2 (Stored Proc &
   * Function Behaviour Program, Spec 2, 2026-09-09) adds `object_kinds`,
   * `constructs` and `dimensions` for routine-envelope rules.
   */
  applies_to?: {
    column_types?: string[];
    object_kinds?: string[];
    constructs?: string[];
    dimensions?: string[];
  };
  /** null/absent = guidance-only rule (no comparator behaviour). */
  comparison?: PairComparison | null;
  rewrite_guidance?: string;
  /** v2 data payloads (calling convention, error/session conventions, type map, call-site matrix). */
  convention?: Record<string, unknown>;
  type_map?: Record<string, string>;
  matrix?: Record<string, Record<string, string>>;
  session_profile?: { driver?: string; set?: string[] };
  scenario_seed?: string;
  severity?: string;
  /** Default true. Estate-conditional rules ship disabled. */
  enabled_by_default?: boolean;
}

export interface PairConstructRef {
  construct: string;
  seed?: string;
}

export interface MigrationPairRuleset {
  pair_id: string;
  version: number;
  source: MigrationPairEndpoint;
  target: MigrationPairEndpoint;
  guidance_heading?: string;
  notes?: string;
  rules: MigrationPairRule[];
  construct_refs?: PairConstructRef[];
}

// ---------------------------------------------------------------------------
// Loader (cached, fail-soft)
// ---------------------------------------------------------------------------

const RULESET_DIR_NAME = 'migration-pairs';
const RULESET_SUFFIX = '.rules.json';
const WALK_UP_LEVELS = 5;

/** Walk up from cwd to find the repo's `migration-pairs/` directory. */
function findRulesetDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i <= WALK_UP_LEVELS; i++) {
    const candidate = join(dir, RULESET_DIR_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveRulesetPath(): string | null {
  const explicit = process.env.MIGRATION_PAIR_RULESET_PATH;
  if (explicit && explicit.trim() !== '') return resolve(explicit.trim());
  const dir = findRulesetDir();
  if (!dir) return null;
  const pairId = process.env.MIGRATION_PAIR;
  if (pairId && pairId.trim() !== '') {
    return join(dir, `${pairId.trim()}${RULESET_SUFFIX}`);
  }
  // No pair selected: unambiguous only when exactly one ruleset exists.
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(RULESET_SUFFIX));
    if (files.length === 1) return join(dir, files[0]);
  } catch {
    /* fail-soft */
  }
  return null;
}

/** Minimal structural validation — enough to fail-soft on garbage. */
function validateRuleset(raw: unknown): MigrationPairRuleset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pair_id !== 'string' || r.pair_id === '') return null;
  if (typeof r.version !== 'number') return null;
  if (!r.source || typeof r.source !== 'object') return null;
  if (!r.target || typeof r.target !== 'object') return null;
  if (!Array.isArray(r.rules)) return null;
  for (const rule of r.rules) {
    if (!rule || typeof rule !== 'object') return null;
    const ru = rule as Record<string, unknown>;
    if (typeof ru.id !== 'string' || ru.id === '') return null;
    if (typeof ru.divergence_class !== 'string') return null;
  }
  return raw as MigrationPairRuleset;
}

let cached: MigrationPairRuleset | null | undefined;

/**
 * Load the configured migration-pair ruleset (cached after first call).
 * Returns null when no ruleset is configured/found/valid — callers must
 * degrade honestly, never throw.
 */
export function loadPairRuleset(): MigrationPairRuleset | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const path = resolveRulesetPath();
    if (!path || !existsSync(path)) return cached;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    cached = validateRuleset(parsed);
  } catch {
    cached = null; // fail-soft: a broken ruleset must never break a service
  }
  return cached;
}

/** Test-only seam: clear the loader cache (env-driven tests reload). */
export function resetPairRulesetCacheForTest(): void {
  cached = undefined;
}

// ---------------------------------------------------------------------------
// Rule selection
// ---------------------------------------------------------------------------

/** Rules enabled for this estate (enabled_by_default !== false). */
export function activeRules(ruleset: MigrationPairRuleset): MigrationPairRule[] {
  return ruleset.rules.filter((r) => r.enabled_by_default !== false);
}

/**
 * Active comparison-bearing rules applying to a source column type
 * (case-insensitive match on the ruleset's declared type names).
 */
export function rulesForColumnType(
  ruleset: MigrationPairRuleset,
  columnType: string,
): MigrationPairRule[] {
  const wanted = columnType.trim().toLowerCase();
  return activeRules(ruleset).filter((r) => {
    if (!r.comparison) return false;
    const types = r.applies_to?.column_types;
    if (!types || types.length === 0) return false;
    return types.some((t) => t.trim().toLowerCase() === wanted);
  });
}

// ---------------------------------------------------------------------------
// Strategy library (generic; parameterised by rule data)
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | null;

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function num(params: Record<string, unknown> | undefined, key: string): number | null {
  const v = params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Canonicalize one value under one comparison strategy. Null/undefined pass
 * through untouched (absence is compared as absence). Unknown strategies and
 * unparseable values return the input unchanged — canonicalization is
 * fail-soft; strictness lives in the final comparison.
 */
export function canonicalize(value: unknown, comparison: PairComparison): unknown {
  if (value === null || value === undefined) return value ?? null;
  const params = comparison.params;
  switch (comparison.strategy) {
    case 'timestamp-truncate': {
      const ms = toEpochMs(value);
      if (ms === null) return value;
      const tps = num(params, 'ticks_per_second');
      if (tps !== null && tps > 0) return Math.floor((ms * tps) / 1000);
      const granularity = num(params, 'granularity_ms');
      if (granularity !== null && granularity > 0) return Math.floor(ms / granularity);
      return ms;
    }
    case 'string-rtrim':
      return String(value).replace(/ +$/, '');
    case 'numeric-rescale': {
      const n = Number(value);
      if (!Number.isFinite(n)) return value;
      const scale = num(params, 'scale') ?? 0;
      return n.toFixed(scale);
    }
    case 'numeric-epsilon': {
      // Tolerance strategy: canonical form is the number itself; the
      // epsilon is applied pairwise in compareWithRules.
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case 'charset-normalize': {
      const form = typeof params?.form === 'string' ? params.form : 'NFC';
      try {
        return String(value).normalize(form);
      } catch {
        return String(value);
      }
    }
    case 'collation-case':
      return String(value).toLowerCase();
    default:
      return value;
  }
}

export interface PairComparisonResult {
  equal: boolean;
  /** Rule ids whose strategies participated (citation model). */
  appliedRuleIds: string[];
  /** Strategy names the library did not recognise (flag, don't hide). */
  unknownStrategies: string[];
  canonicalA: unknown;
  canonicalB: unknown;
}

const KNOWN_STRATEGIES = new Set([
  'timestamp-truncate',
  'string-rtrim',
  'numeric-rescale',
  'numeric-epsilon',
  'charset-normalize',
  'collation-case',
  // v2 (Spec 2, 2026-09-09): routine-envelope strategies — recognised here
  // so a v2 ruleset never reads as "unknown"; their behaviour lives in the
  // validation service's comparator.
  'numeric-canonical',
  'bytes-hex',
  'timestamp-window',
  'masked',
  'multiset',
  'error-source-number',
  'advisory',
]);

/**
 * Compare two values under a set of pair rules: canonicalizers apply in rule
 * order to both sides; a `numeric-epsilon` rule (if present) then supplies
 * tolerance on the canonical numeric forms. With no applicable rules this is
 * strict equality — divergence tolerance is always rule-cited, never silent.
 */
export function compareWithRules(
  a: unknown,
  b: unknown,
  rules: MigrationPairRule[],
): PairComparisonResult {
  let ca: unknown = a;
  let cb: unknown = b;
  const appliedRuleIds: string[] = [];
  const unknownStrategies: string[] = [];
  let epsilon: { relative: number; absolute: number; ruleId: string } | null = null;

  for (const rule of rules) {
    if (!rule.comparison) continue;
    const { strategy } = rule.comparison;
    if (!KNOWN_STRATEGIES.has(strategy)) {
      unknownStrategies.push(strategy);
      continue;
    }
    if (strategy === 'numeric-epsilon') {
      epsilon = {
        relative: num(rule.comparison.params, 'relative') ?? 0,
        absolute: num(rule.comparison.params, 'absolute') ?? 0,
        ruleId: rule.id,
      };
      ca = canonicalize(ca, rule.comparison);
      cb = canonicalize(cb, rule.comparison);
      appliedRuleIds.push(rule.id);
      continue;
    }
    ca = canonicalize(ca, rule.comparison);
    cb = canonicalize(cb, rule.comparison);
    appliedRuleIds.push(rule.id);
  }

  let equal: boolean;
  if (ca === null && cb === null) {
    equal = true;
  } else if (ca === null || cb === null) {
    equal = false;
  } else if (
    epsilon &&
    typeof ca === 'number' &&
    typeof cb === 'number'
  ) {
    const diff = Math.abs(ca - cb);
    const bound = Math.max(
      epsilon.absolute,
      epsilon.relative * Math.max(Math.abs(ca), Math.abs(cb)),
    );
    equal = diff <= bound;
  } else {
    equal = ca === cb || String(ca as Primitive) === String(cb as Primitive);
  }

  return { equal, appliedRuleIds, unknownStrategies, canonicalA: ca, canonicalB: cb };
}
