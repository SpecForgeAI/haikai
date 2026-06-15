/**
 * Hand-rolled Autosys JIL parser (D2 — Capability Synthesis + Batch Spines,
 * Task Group 2).
 *
 * Autosys Job Information Language (JIL) is a flat `key: value` definition
 * language. A `.jil` file is a sequence of job stanzas, each opened by an
 * `insert_job:` (or `update_job:`) directive and followed by attribute lines.
 * Boxes (`job_type: b`) own child jobs that reference them via `box_name:`;
 * jobs trigger one another through `condition:` expressions
 * (`success(j)`, `done(j)`, `notrunning(j)`, `failure(j)`).
 *
 * This is a DELIBERATELY hand-rolled key:value scanner — NOT tree-sitter, and
 * with NO `require('tree-sitter')` (Autosys is not a tree-sitter grammar and
 * the tree-sitter binding is reserved for the source-language extractors). It
 * is pure: it returns a structured {@link JilTopology} and mints NO discovery
 * candidates. Group 4's capability synthesis consumes the topology and lands it
 * authoritatively in capability `detail_json`, enriching (not competing with)
 * the `.jil` file's D1 `operational_artifact` finding.
 *
 * Dialect tolerance (D7): unknown keywords never hard-fail; they are preserved
 * verbatim in the per-job / per-box `attributes` bag so a vendor dialect or a
 * site-local keyword survives the round-trip.
 */

/**
 * The `condition` keywords Autosys uses to express the trigger DAG. A job's
 * `condition:` expression references upstream jobs by these predicates; each
 * reference becomes one directed {@link JilEdge} (upstream -> this job).
 */
export type JilConditionKind = 'success' | 'done' | 'notrunning' | 'failure';

/** The Autosys `job_type` values this parser distinguishes. */
export type JilJobType =
  | 'c' // command job
  | 'b' // box (container / scheduler grouping)
  | 'f' // file-watcher
  | string; // tolerate any other dialect-specific type verbatim

/** The schedule attributes captured off a box or job stanza. */
export interface JilSchedule {
  /** `start_times:` value (verbatim, quotes preserved). */
  startTimes?: string;
  /** `start_mins:` value. */
  startMins?: string;
  /** `days_of_week:` value. */
  daysOfWeek?: string;
  /** `run_calendar:` value. */
  runCalendar?: string;
}

/** A single parsed JIL stanza (a job, a box, or a file-watcher). */
export interface JilJob {
  /** The `insert_job:` / `update_job:` name — the stanza key. */
  name: string;
  /** `job_type:` value (`c` | `b` | `f` | any dialect string). */
  jobType: JilJobType;
  /** Owning box name (`box_name:`), if this stanza is a box child. */
  boxName?: string;
  /** `command:` value (verbatim, may include flags / args). */
  command?: string;
  /** `machine:` value (the execution host / machine alias). */
  machine?: string;
  /** `alarm_if_fail:` value. */
  alarmIfFail?: string;
  /** `std_out_file:` value. */
  stdOutFile?: string;
  /** `std_err_file:` value. */
  stdErrFile?: string;
  /** Schedule attributes (present only when at least one schedule key appears). */
  schedule?: JilSchedule;
  /** The raw `condition:` expression text (verbatim) if present. */
  conditionExpr?: string;
  /**
   * Every unmodelled keyword on this stanza, preserved verbatim. The
   * dialect-tolerance bag (D7) — keys are the raw JIL keyword, values the raw
   * value text. NEVER throws on an unknown keyword.
   */
  attributes: Record<string, string>;
}

/**
 * One directed edge in the orchestration DAG.
 *
 *  - `box-member`: a box (`from`) contains a child job (`to`) — structural
 *    ownership derived from the child's `box_name:`.
 *  - `condition`: an upstream job (`from`) must satisfy `condition` before the
 *    downstream job (`to`) runs — derived from the downstream job's
 *    `condition:` expression.
 */
export interface JilEdge {
  type: 'box-member' | 'condition';
  from: string;
  to: string;
  /** Populated for `type: 'condition'` edges only. */
  condition?: JilConditionKind;
}

/**
 * The structured topology produced by {@link parseJil}. This is the
 * self-contained object Group 4 lands in capability `detail_json`. Boxes and
 * file-watchers are convenience projections over `jobs` (every box / watcher is
 * also present in `jobs`) so a consumer can walk either the flat job list or
 * the typed sub-lists.
 */
export interface JilTopology {
  /** Every stanza, flat (commands, boxes, and file-watchers alike). */
  jobs: JilJob[];
  /** The `job_type: b` stanzas (a projection of `jobs`). */
  boxes: JilJob[];
  /** The `job_type: f` stanzas (a projection of `jobs`). */
  fileWatchers: JilJob[];
  /** The orchestration DAG (box-membership + condition edges). */
  edges: JilEdge[];
}

/**
 * The modelled JIL keywords. `insert_job` / `update_job` open a stanza and are
 * handled specially; the rest are attribute keywords scanned within a stanza.
 * Any keyword NOT in this set is captured into the stanza `attributes` bag.
 */
const STANZA_OPENERS = new Set(['insert_job', 'update_job']);
const MODELLED_KEYWORDS = new Set([
  'job_type',
  'box_name',
  'command',
  'machine',
  'condition',
  'start_times',
  'start_mins',
  'days_of_week',
  'run_calendar',
  'alarm_if_fail',
  'std_out_file',
  'std_err_file',
]);

/** All keywords that can appear inline (used to tokenise multi-pair lines). */
const ALL_KEYWORDS = new Set<string>([
  ...STANZA_OPENERS,
  ...MODELLED_KEYWORDS,
]);

/** A `keyword: value` pair scanned out of a (possibly multi-pair) JIL line. */
interface JilPair {
  keyword: string;
  value: string;
}

/**
 * Strip JIL comments. Autosys supports `/* ... *​/` block comments and
 * `#`-prefixed line comments. We remove block comments wholesale, then drop
 * the remainder of any line from an unquoted `#`.
 */
function stripComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return withoutBlocks
    .split('\n')
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === '#' && !inSingle && !inDouble) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/**
 * Tokenise one logical JIL line into its `keyword: value` pairs.
 *
 * JIL permits several pairs on one physical line, e.g.
 * `insert_job: risk_hier_box   job_type: b`. We find every `<keyword>:`
 * occurrence (keyword ∈ {@link ALL_KEYWORDS}) and slice each value up to the
 * NEXT recognised `<keyword>:` (or end of line). That keeps values that contain
 * spaces or their own colons intact (e.g. `command: /opt/x/run.sh -o UPDATE`,
 * `start_times: "06:00"`) while still splitting genuine multi-pair lines.
 *
 * An unmodelled `keyword:` (not in {@link ALL_KEYWORDS}) does NOT act as a
 * split boundary on its own line position UNLESS it is at the start of the
 * line — i.e. a stanza attribute line `owner: batchsvc` is still captured as a
 * single (unknown) pair so it can land in the `attributes` bag.
 */
function tokeniseLine(line: string): JilPair[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Find boundaries: every `<word>:` where <word> is a recognised keyword.
  // We additionally treat the FIRST `<word>:` on the line as a boundary even
  // when unrecognised, so unknown stanza attributes (`owner: x`) are captured.
  const boundaryRe = /(^|\s)([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  const boundaries: Array<{ index: number; keyword: string; valueStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = boundaryRe.exec(trimmed)) !== null) {
    const keyword = m[2];
    const isKnown = ALL_KEYWORDS.has(keyword);
    const isFirst = boundaries.length === 0;
    // Known keywords are always boundaries; an unknown keyword is a boundary
    // only when it is the first pair on the line (the attribute-line case).
    if (isKnown || isFirst) {
      boundaries.push({
        index: m.index + m[1].length, // skip the leading whitespace capture
        keyword,
        valueStart: boundaryRe.lastIndex,
      });
    }
  }

  if (boundaries.length === 0) return [];

  const pairs: JilPair[] = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const b = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : trimmed.length;
    const value = trimmed.slice(b.valueStart, end).trim();
    pairs.push({ keyword: b.keyword, value });
  }
  return pairs;
}

/**
 * Parse a `condition:` expression into its referenced upstream jobs.
 *
 * Autosys conditions combine predicates with `&` / `|`, e.g.
 * `success(jobA) & notrunning(jobB)`. We extract every
 * `<kind>(<job>[, status])` occurrence; the first argument is the referenced
 * job name. Unknown predicate kinds are ignored (no edge), tolerating dialects.
 */
function parseCondition(expr: string): Array<{ kind: JilConditionKind; job: string }> {
  const out: Array<{ kind: JilConditionKind; job: string }> = [];
  const re = /\b(success|done|notrunning|failure|terminated|exitcode)\s*\(\s*([^),\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const kindRaw = m[1].toLowerCase();
    // Only the four modelled kinds become typed edges (D7).
    if (
      kindRaw === 'success' ||
      kindRaw === 'done' ||
      kindRaw === 'notrunning' ||
      kindRaw === 'failure'
    ) {
      out.push({ kind: kindRaw, job: m[2] });
    }
  }
  return out;
}

function ensureSchedule(job: JilJob): JilSchedule {
  if (!job.schedule) job.schedule = {};
  return job.schedule;
}

/**
 * Apply one scanned `keyword: value` pair to the stanza currently being built.
 * Modelled keywords map onto typed fields; everything else falls into the
 * `attributes` bag (D7 dialect tolerance).
 */
function applyPair(job: JilJob, keyword: string, value: string): void {
  switch (keyword) {
    case 'job_type':
      job.jobType = value;
      break;
    case 'box_name':
      job.boxName = value;
      break;
    case 'command':
      job.command = value;
      break;
    case 'machine':
      job.machine = value;
      break;
    case 'alarm_if_fail':
      job.alarmIfFail = value;
      break;
    case 'std_out_file':
      job.stdOutFile = value;
      break;
    case 'std_err_file':
      job.stdErrFile = value;
      break;
    case 'start_times':
      ensureSchedule(job).startTimes = value;
      break;
    case 'start_mins':
      ensureSchedule(job).startMins = value;
      break;
    case 'days_of_week':
      ensureSchedule(job).daysOfWeek = value;
      break;
    case 'run_calendar':
      ensureSchedule(job).runCalendar = value;
      break;
    case 'condition':
      job.conditionExpr = value;
      break;
    default:
      // Dialect tolerance: anything we don't model is preserved verbatim.
      job.attributes[keyword] = value;
      break;
  }
}

/**
 * Parse Autosys JIL text into a structured {@link JilTopology}.
 *
 * Deterministic and total: malformed / empty / comment-only input yields an
 * empty topology, and unknown keywords never throw (they land in `attributes`).
 */
export function parseJil(text: string): JilTopology {
  const jobs: JilJob[] = [];
  const cleaned = stripComments(text ?? '');
  const lines = cleaned.split('\n');

  let current: JilJob | null = null;
  for (const line of lines) {
    const pairs = tokeniseLine(line);
    if (pairs.length === 0) continue;

    let idx = 0;
    // A stanza opener (`insert_job`/`update_job`) starts a new job. It may be
    // followed by more pairs on the SAME line (e.g. `... job_type: b`).
    if (STANZA_OPENERS.has(pairs[0].keyword)) {
      current = {
        name: pairs[0].value,
        jobType: 'c', // Autosys default when job_type is omitted.
        attributes: {},
      };
      jobs.push(current);
      idx = 1;
    }

    if (!current) {
      // Attribute line before any stanza opener — ignore (nothing to attach to).
      continue;
    }

    for (; idx < pairs.length; idx += 1) {
      applyPair(current, pairs[idx].keyword, pairs[idx].value);
    }
  }

  // Drop a `schedule: {}` that ended up empty (no schedule keys seen).
  for (const job of jobs) {
    if (job.schedule && Object.keys(job.schedule).length === 0) {
      delete job.schedule;
    }
  }

  const boxes = jobs.filter((j) => j.jobType === 'b');
  const fileWatchers = jobs.filter((j) => j.jobType === 'f');

  // Build the DAG: structural box-membership edges first, then condition edges.
  const edges: JilEdge[] = [];
  const jobNames = new Set(jobs.map((j) => j.name));
  for (const job of jobs) {
    if (job.boxName && jobNames.has(job.boxName)) {
      edges.push({ type: 'box-member', from: job.boxName, to: job.name });
    }
    if (job.conditionExpr) {
      for (const ref of parseCondition(job.conditionExpr)) {
        edges.push({
          type: 'condition',
          from: ref.job,
          to: job.name,
          condition: ref.kind,
        });
      }
    }
  }

  return { jobs, boxes, fileWatchers, edges };
}
