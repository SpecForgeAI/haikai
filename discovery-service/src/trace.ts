/**
 * Haikai workflow trace logger — see docs/trace-logging.md.
 *
 * Self-contained, ZERO external deps. This file is the CANONICAL copy; an
 * identical copy lives in each Node service (gateway, discovery-service,
 * api-migration-validation-service). Keep them byte-identical.
 *
 * OFF by default. Controlled by:
 *   HAIKAI_TRACE       = off | summary | detail   (default off)
 *   HAIKAI_TRACE_FILE  = path                      (default ~/.haikai/trace.log)
 *
 * Two tiers, one shared file (atomic single-line appends so concurrent service
 * processes interleave cleanly):
 *   [SUMMARY]  human prose, one glyph-led line per step  (tier >= summary)
 *   [detail]   event + compact JSON for diagnosis        (tier == detail)
 *
 * Predicate self-scoring layer (rides the SUMMARY tier; greppable markers —
 * see agent-os/planning/2026-07-10-predicate-run-judging-design.md):
 *   HAIKAI_PREDICATE    one boolean check {"id","title","verdict","expected","actual","corr"?}
 *   HAIKAI_STAGE_START  stage banner for absence detection {"stage"}
 *   HAIKAI_SCORECARD    per-stage tally, emitted at stage end (doubles as the END banner)
 *   HAIKAI_CONFIG       startup config header (booleans/counts only — never secrets)
 */
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

type Tier = 'off' | 'summary' | 'detail';
type Glyph = '▶' | '✓' | '⚠' | '✗';

/** Correlation ids. Emitted in this stable order; only set keys appear. */
export interface Corr {
  run?: string | null;
  session?: string | null;
  job?: string | null;
  bug?: string | null;
  project?: string | null;
  arch?: string | null;
}

const TIER: Tier = (() => {
  const v = (process.env.HAIKAI_TRACE ?? 'off').toLowerCase();
  return v === 'summary' || v === 'detail' ? v : 'off';
})();

// Default matches docs/trace-logging.md (`~/.haikai/trace.log`). The old
// hardcoded `C:\dev\data\haikai-trace.log` default was a bug — the doc was
// never implemented (fixed 2026-07-10, predicate-run-judging batch).
const FILE: string =
  process.env.HAIKAI_TRACE_FILE && process.env.HAIKAI_TRACE_FILE.trim() !== ''
    ? process.env.HAIKAI_TRACE_FILE
    : join(homedir(), '.haikai', 'trace.log');

let dirEnsured = false;
function ensureDir(): void {
  if (dirEnsured) return;
  try {
    mkdirSync(dirname(FILE), { recursive: true });
  } catch {
    /* ignore — tracing must never throw */
  }
  dirEnsured = true;
}

const CORR_ORDER: (keyof Corr)[] = ['run', 'session', 'job', 'bug', 'project', 'arch'];
function fmtCorr(corr?: Corr): string {
  if (!corr) return '';
  const parts: string[] = [];
  for (const k of CORR_ORDER) {
    const val = corr[k];
    if (val === undefined || val === null || val === '') continue;
    const s = String(val);
    parts.push(/\s/.test(s) ? `${k}="${s}"` : `${k}=${s}`);
  }
  return parts.join(' ');
}

/** ISO-8601 UTC with millisecond precision, e.g. 2026-06-16T16:11:39.335Z. */
function nowTs(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Predicate self-scoring state. The tally is per-process (each Node service is
// its own process); scorecards group by the stage prefix of the predicate id
// ("SCAN.EDGE.03" tallies under "SCAN"), so no ambient current-stage state is
// needed and concurrent request handlers can't mis-attribute a predicate.
// ---------------------------------------------------------------------------

export type PredicateVerdict = 'pass' | 'fail' | 'skip';

interface StageTally {
  pass: number;
  fail: number;
  skip: number;
  failed: { id: string; actual: string }[];
}

const TALLY = new Map<string, StageTally>();
// Caps keep predicate/scorecard lines bounded however hot a failing loop gets.
const SCORECARD_FAILED_CAP = 25;
const SCORECARD_ACTUAL_CAP = 160;
const PREDICATE_TEXT_CAP = 400;

function capText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function stageOf(id: string): string {
  const dot = id.indexOf('.');
  return dot > 0 ? id.slice(0, dot) : id;
}

/** Corr as a plain object (stable key order, only set keys) for embedding in JSON. */
function corrJson(corr?: Corr): Record<string, string> | undefined {
  if (!corr) return undefined;
  const out: Record<string, string> = {};
  for (const k of CORR_ORDER) if (corr[k]) out[k] = String(corr[k]);
  return Object.keys(out).length > 0 ? out : undefined;
}

function emit(parts: (string | undefined)[]): void {
  ensureDir();
  const line = parts.filter((p) => p !== undefined && p !== '').join('  ');
  try {
    appendFileSync(FILE, line + '\n');
  } catch {
    /* never throw from tracing */
  }
}

export interface Tracer {
  readonly enabled: boolean;
  summary(glyph: Glyph, message: string, corr?: Corr): void;
  step(message: string, corr?: Corr): void;
  ok(message: string, corr?: Corr): void;
  warn(message: string, corr?: Corr): void;
  fail(message: string, corr?: Corr): void;
  detail(event: string, data?: Record<string, unknown>, corr?: Corr): void;
  runHeader(runId: string, project?: string | null, arch?: string | null): void;
  /** Emit a HAIKAI_PREDICATE line (pass/fail from `ok`) and tally it for the stage scorecard. */
  predicate(id: string, title: string, ok: boolean, expected: string, actual: string, corr?: Corr): void;
  /** Emit a skipped HAIKAI_PREDICATE — the check was not exercised this run; `why` says why. */
  predicateSkip(id: string, title: string, why: string, corr?: Corr): void;
  /** Emit the HAIKAI_STAGE_START banner (the judge flags started-but-never-ended stages). */
  stageStart(stage: string, corr?: Corr): void;
  /** Emit the stage's HAIKAI_SCORECARD — per-stage tally + cumulative; doubles as the END banner. */
  stageEnd(stage: string, corr?: Corr): void;
  /** Emit the startup HAIKAI_CONFIG header. Pass booleans/counts only — never secret values. */
  configHeader(config: Record<string, unknown>, corr?: Corr): void;
}

/** Build a tracer bound to a service name (see the registry in the doc). */
export function createTracer(service: string): Tracer {
  const off = TIER === 'off';
  const detailOn = TIER === 'detail';

  const summary = (glyph: Glyph, message: string, corr?: Corr): void => {
    if (off) return;
    emit([nowTs(), '[SUMMARY]', service, fmtCorr(corr) || undefined, `${glyph} ${message}`]);
  };

  const emitPredicate = (
    id: string,
    title: string,
    verdict: PredicateVerdict,
    expected: string,
    actual: string,
    corr?: Corr,
  ): void => {
    if (off) return;
    try {
      const stage = stageOf(id);
      let t = TALLY.get(stage);
      if (!t) {
        t = { pass: 0, fail: 0, skip: 0, failed: [] };
        TALLY.set(stage, t);
      }
      t[verdict] += 1;
      if (verdict === 'fail' && t.failed.length < SCORECARD_FAILED_CAP) {
        t.failed.push({ id, actual: capText(actual, SCORECARD_ACTUAL_CAP) });
      }
      const payload: Record<string, unknown> = {
        id,
        title,
        verdict,
        expected: capText(expected, PREDICATE_TEXT_CAP),
        actual: capText(actual, PREDICATE_TEXT_CAP),
      };
      const cj = corrJson(corr);
      if (cj) payload.corr = cj;
      const glyph: Glyph = verdict === 'pass' ? '✓' : verdict === 'fail' ? '✗' : '⚠';
      emit([
        nowTs(), '[SUMMARY]', service, fmtCorr(corr) || undefined,
        `${glyph} HAIKAI_PREDICATE ${JSON.stringify(payload)}`,
      ]);
    } catch {
      /* never throw from tracing */
    }
  };

  return {
    enabled: !off,
    summary,
    step: (m, c) => summary('▶', m, c),
    ok: (m, c) => summary('✓', m, c),
    warn: (m, c) => summary('⚠', m, c),
    fail: (m, c) => summary('✗', m, c),
    detail(event, data, corr) {
      if (!detailOn) return;
      // Merge corr ids into the JSON so a detail line is self-contained.
      const merged: Record<string, unknown> = {};
      if (corr) for (const k of CORR_ORDER) if (corr[k]) merged[k] = corr[k];
      Object.assign(merged, data ?? {});
      let json: string;
      try {
        json = JSON.stringify(merged);
      } catch {
        json = '{"_traceError":"unserializable"}';
      }
      emit([nowTs(), '[detail]', service, fmtCorr(corr) || undefined, `${event} ${json}`]);
    },
    runHeader(runId, project, arch) {
      if (off) return;
      const p = project ? ` project="${project}"` : '';
      const a = arch ? ` arch="${arch}"` : '';
      // Leading blank line delimits runs in the shared append-only file.
      emit([`\n=== HAIKAI TRACE  run=${runId}${p}${a}  ${nowTs()} ===`]);
    },
    predicate(id, title, ok, expected, actual, corr) {
      emitPredicate(id, title, ok ? 'pass' : 'fail', expected, actual, corr);
    },
    predicateSkip(id, title, why, corr) {
      emitPredicate(id, title, 'skip', '', why, corr);
    },
    stageStart(stage, corr) {
      if (off) return;
      try {
        emit([
          nowTs(), '[SUMMARY]', service, fmtCorr(corr) || undefined,
          `▶ HAIKAI_STAGE_START ${JSON.stringify({ stage })}`,
        ]);
      } catch {
        /* never throw from tracing */
      }
    },
    stageEnd(stage, corr) {
      if (off) return;
      try {
        const t = TALLY.get(stage) ?? { pass: 0, fail: 0, skip: 0, failed: [] };
        const cumulative = { pass: 0, fail: 0, skip: 0 };
        for (const v of TALLY.values()) {
          cumulative.pass += v.pass;
          cumulative.fail += v.fail;
          cumulative.skip += v.skip;
        }
        const payload = {
          stage,
          service,
          pass: t.pass,
          fail: t.fail,
          skip: t.skip,
          failed: t.failed,
          cumulative,
        };
        const glyph: Glyph = t.fail > 0 ? '✗' : '✓';
        emit([
          nowTs(), '[SUMMARY]', service, fmtCorr(corr) || undefined,
          `${glyph} HAIKAI_SCORECARD ${JSON.stringify(payload)}`,
        ]);
      } catch {
        /* never throw from tracing */
      }
    },
    configHeader(config, corr) {
      if (off) return;
      try {
        emit([
          nowTs(), '[SUMMARY]', service, fmtCorr(corr) || undefined,
          `▶ HAIKAI_CONFIG ${JSON.stringify({ service, ...config })}`,
        ]);
      } catch {
        /* never throw from tracing */
      }
    },
  };
}
