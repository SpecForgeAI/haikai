/**
 * Haikai workflow trace logger — see docs/trace-logging.md.
 *
 * Self-contained, ZERO external deps. This file is the CANONICAL copy; an
 * identical copy lives in each Node service (gateway, discovery-service,
 * api-migration-validation-service, mcp-server). Keep them byte-identical.
 *
 * OFF by default. Controlled by:
 *   HAIKAI_TRACE       = off | summary | detail   (default off)
 *   HAIKAI_TRACE_FILE  = path                      (default ~/.haikai/trace.log)
 *
 * Two tiers, one shared file (atomic single-line appends so concurrent service
 * processes interleave cleanly):
 *   [SUMMARY]  human prose, one glyph-led line per step  (tier >= summary)
 *   [detail]   event + compact JSON for diagnosis        (tier == detail)
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
}

/** Build a tracer bound to a service name (see the registry in the doc). */
export function createTracer(service: string): Tracer {
  const off = TIER === 'off';
  const detailOn = TIER === 'detail';

  const summary = (glyph: Glyph, message: string, corr?: Corr): void => {
    if (off) return;
    emit([nowTs(), '[SUMMARY]', service, fmtCorr(corr) || undefined, `${glyph} ${message}`]);
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
  };
}
