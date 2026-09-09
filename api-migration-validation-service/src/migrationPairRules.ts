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
   * Function Behaviour Program, Spec 2, 2026-09-09) adds `object_kinds`
   * (procedure | function | trigger), `constructs` (profile construct tags
   * such as getdate / transaction_control) and `dimensions` (the envelope
   * dimension a rule governs: outcome | messages | result_sets |
   * result_set_columns | result_set_cells | output_params).
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
  scenario_seed?: string;
  severity?: string;
  /** Default true. Estate-conditional rules ship disabled. */
  enabled_by_default?: boolean;
  /** v2 data payloads (calling convention, error/session conventions, type map, call-site matrix). */
  convention?: Record<string, unknown>;
  type_map?: Record<string, string>;
  matrix?: Record<string, Record<string, string>>;
  session_profile?: { driver?: string; set?: string[] };
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

/** One rule by id (active or not) — the citation lookup. */
export function ruleById(ruleset: MigrationPairRuleset, id: string): MigrationPairRule | null {
  return ruleset.rules.find((r) => r.id === id) ?? null;
}

/**
 * Active rules governing one envelope DIMENSION for one object kind (v2,
 * Spec 2). Rules with `constructs` apply only when the routine profile
 * carries at least one of them — clock / random volatility is BY RULE and
 * BY EVIDENCE, never a blanket mask.
 */
export function rulesForDimension(
  ruleset: MigrationPairRuleset,
  dimension: string,
  objectKind: string,
  constructsPresent: string[] = [],
): MigrationPairRule[] {
  const kind = objectKind.trim().toLowerCase();
  const present = new Set(constructsPresent.map((c) => c.trim().toLowerCase()));
  return activeRules(ruleset).filter((r) => {
    const dims = r.applies_to?.dimensions;
    if (!dims || !dims.includes(dimension)) return false;
    const kinds = r.applies_to?.object_kinds;
    if (kinds && kinds.length > 0 && !kinds.some((k) => k.toLowerCase() === kind)) return false;
    const constructs = r.applies_to?.constructs;
    if (constructs && constructs.length > 0 && !constructs.some((c) => present.has(c.toLowerCase()))) {
      return false;
    }
    return true;
  });
}

/**
 * Map an engine-reported cell type (driver / catalog token) onto the ruleset
 * column-type vocabulary via SYBPG.PROC.RS.TYPE.001's `type_map`; unknown
 * tokens map to themselves (strict comparison then applies).
 */
export function canonicalColumnType(ruleset: MigrationPairRuleset, reportedType: string): string {
  const token = reportedType.trim().toLowerCase().replace(/\(.*$/, '');
  for (const r of activeRules(ruleset)) {
    if (!r.type_map) continue;
    const hit = r.type_map[token];
    if (typeof hit === 'string' && hit.length > 0) return hit;
  }
  return token;
}

// ---------------------------------------------------------------------------
// Strategy library (generic; parameterised by rule data)
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | null;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Canonical instant (epoch ms) with an EXPLICIT naive-timestamp-is-UTC policy
 * (2026-08-07): a datetime string with no timezone designator (the raw
 * `timestamp without time zone` wire form) is interpreted as UTC — never the
 * process's locale. `Date.parse` on a naive string uses LOCAL time, which is
 * exactly the ±1h BST/GMT artifact that made SYBPG.DT.001 "fail" on every
 * ValidFrom/ValidTo cell: the rule was fine, its inputs were locale-shifted.
 * Handles every wire form both adapters emit: ISO with offset
 * (`2014-05-15T23:00:00.000+00:00`), raw Postgres timestamptz with a SHORT
 * offset and space separator (`2014-05-15 23:00:00+00`), naive timestamp
 * (`2014-05-15 23:00:00` → UTC by policy), and date-only (`2014-05-15` →
 * UTC midnight).
 */
function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  if (DATE_ONLY_RE.test(s)) {
    s = `${s}T00:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    if (/[+-]\d{2}$/.test(s)) {
      s = `${s}:00`; // pg short offset "+00" -> ISO "+00:00"
    } else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      s = `${s}Z`; // NAIVE -> UTC by policy (never the process locale)
    }
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : parsed;
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
      // ROUND, never floor (2026-08-11): ticks_per_second RECOVERS a stored
      // tick index from a millisecond RENDERING. Renderings sit within
      // ±0.5ms of the true tick (ASE 1/300s ticks render .003/.007/.010…),
      // so rounding is exact for every tick while flooring drops boundary
      // renderings into the adjacent bucket (.457 → 137.1 → 137 vs the
      // same tick's .456 → 136.8 → 136 — a false key mismatch).
      if (tps !== null && tps > 0) return Math.round((ms * tps) / 1000);
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
    case 'numeric-canonical': {
      // Exact decimal canonical form (2026-08-07): both wires render
      // numeric/decimal as STRINGS with engine-dependent trailing zeros
      // ('123.40' vs '123.4'). Normalise sign + strip insignificant zeros
      // WITHOUT parsing to a float (precision preserved). Unparseable
      // values pass through (strictness lives in the final comparison).
      const s = String(value).trim();
      const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
      if (!m) return value;
      const sign = m[1] === '-' ? '-' : '';
      const intPart = m[2].replace(/^0+(?=\d)/, '');
      const fracPart = (m[3] ?? '').replace(/0+$/, '');
      const canonical = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
      return canonical === '0' ? '0' : `${sign}${canonical}`;
    }
    case 'bytes-hex': {
      // Byte-exact binary canonical form (2026-08-07): the Sybase wire
      // renders binary as '\x'+lowercase hex; node-pg renders bytea as a
      // Buffer. Canonicalise BOTH to the same '\x'-hex string.
      if (typeof value === 'object' && value !== null && 'length' in (value as object)) {
        const buf = value as { length: number; [i: number]: number };
        let hex = '';
        for (let i = 0; i < buf.length; i++) {
          hex += (buf[i] & 0xff).toString(16).padStart(2, '0');
        }
        return `\\x${hex}`;
      }
      const s = String(value);
      return s.startsWith('\\x') ? `\\x${s.slice(2).toLowerCase()}` : s;
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
  // 2026-08-07 (gold standard C5): exact-decimal + binary canonical forms.
  'numeric-canonical',
  'bytes-hex',
  // 2026-09-09 (Stored Proc & Function Behaviour Program, Spec 2): routine
  // envelope strategies. `timestamp-window` and `masked` are pairwise
  // tolerances (clock / random volatility BY RULE); `multiset`,
  // `error-source-number` and `advisory` are DRIVER-level strategies the
  // proc comparator applies to whole dimensions — cell canonicalisation
  // passes them through unchanged (never "unknown").
  'timestamp-window',
  'masked',
  'multiset',
  'error-source-number',
  'advisory',
]);

/** Strategies whose semantics live in a dimension driver, not per cell. */
const DRIVER_LEVEL_STRATEGIES = new Set(['multiset', 'error-source-number', 'advisory']);

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
  let windowMs: { ms: number; ruleId: string } | null = null;
  let masked: string | null = null;

  for (const rule of rules) {
    if (!rule.comparison) continue;
    const { strategy } = rule.comparison;
    if (!KNOWN_STRATEGIES.has(strategy)) {
      unknownStrategies.push(strategy);
      continue;
    }
    if (DRIVER_LEVEL_STRATEGIES.has(strategy)) continue;
    if (strategy === 'timestamp-window') {
      // Clock volatility BY RULE (2026-09-09): both sides must be parseable
      // instants within the window; the window is never a blanket mask.
      windowMs = { ms: num(rule.comparison.params, 'window_ms') ?? 86_400_000, ruleId: rule.id };
      appliedRuleIds.push(rule.id);
      continue;
    }
    if (strategy === 'masked') {
      masked = rule.id;
      appliedRuleIds.push(rule.id);
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
  } else if (masked) {
    // Presence-only equality (random / generated values): both non-null.
    equal = true;
  } else if (windowMs) {
    const ta = toEpochMs(ca);
    const tb = toEpochMs(cb);
    equal = ta !== null && tb !== null && Math.abs(ta - tb) <= windowMs.ms;
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
  } else if (typeof ca !== typeof cb) {
    // STRICT cross-type (gold standard 2026-08-07): the old String()
    // coercion silently equated 1 with '1' and true with 'true' — a type
    // divergence IS a divergence unless a rule canonicalised it away.
    equal = false;
  } else {
    equal = ca === cb || String(ca as Primitive) === String(cb as Primitive);
  }

  return { equal, appliedRuleIds, unknownStrategies, canonicalA: ca, canonicalB: cb };
}
