/**
 * Plain-Java `main()` batch-entrypoint emission (D2 — Capability Synthesis +
 * Batch Spines, Task Group 3).
 *
 * The classic risk-hierarchy batch tier is plain-Java `main()` classes invoked
 * from shell scripts orchestrated by Autosys. Spring's `processController` /
 * `processServiceLayerBusinessLogic` paths never see them (no stereotype, no
 * mapping), so they fall through `springClassic/index.ts`'s
 * `if (!stereotyped && !nameSuggests) return;` gate. This sibling detector
 * closes that gap WITHOUT touching the Spring emission paths.
 *
 * Decision D3:
 *  - Recognise `public static void main(String[])` AND (a batch package/name
 *    signal OR shell-invocation — the shell-invocation linkage is refined in
 *    Group 4; this module gates on the batch package/name signal and exposes a
 *    `shellInvokedNames` seam the synthesis step can widen).
 *  - Emit the class as candidate type `class` (NOT `app_component`) with a
 *    `batch_entrypoint` marker in `data`.
 *  - Emit `main` / `execute` as child `method` candidates.
 *  - Capture the `-o UPDATE` / `-o ARCHIVE` operation-flag pattern from the
 *    method call args / arg parsing when detectable; else leave `operations` [].
 *  - Gate to runs carrying batch signals ONLY (a run-level flag) so a normal
 *    web run with an incidental CLI `main()` is never affected.
 *
 * Reuses the EXISTING Java tree-sitter IR (`ClassIR` / `FunctionIR` /
 * `ParameterIR`, `modifiers: string[]`, `parameters[].type`) — NO new parse and
 * NO bare `require('tree-sitter')`.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FunctionIR } from '../../languageIR';

/** The `data._addedBy` tag this detector stamps. */
const BATCH_ENTRYPOINT_TAG = 'spring-classic-batch-entrypoint';

/**
 * File extensions whose mere PRESENCE in the scanned IR set marks the run as
 * "carrying batch signals" (the run-level gate). Autosys JIL + shell scripts
 * are the batch-orchestration substrate of the target system.
 */
const BATCH_FILE_EXT_RE = /\.(jil|sh|ksh|bash|bat|cmd)$/i;

/**
 * Class-name suffixes that signal a batch entrypoint. Deliberately
 * conservative — a `main()` in one of these is almost certainly a batch job,
 * not an application bootstrap or a throwaway CLI.
 */
const BATCH_NAME_SUFFIX_RE = /(Job|Loader|Batch|Runner|Processor|Loader|Driver|Daemon|Worker|Importer|Exporter|Extractor)$/;

/**
 * Package-segment signal: a package path containing a `batch` (or `batches`)
 * segment, or a `jobs` segment, flags every `main()` within it as batch.
 */
const BATCH_PACKAGE_RE = /(^|\.)(batch|batches|jobs)(\.|$)/i;

/** The methods promoted to child `method` candidates on a batch entrypoint. */
const ENTRYPOINT_METHOD_NAMES = new Set(['main', 'execute', 'run', 'process']);

/**
 * Whether `m` is a `public static void main(String[] args)` signature. Reuses
 * the IR `modifiers` + `parameters[].type` faithfully (the Java extractor
 * captures `["public","static"]` and a `String[]` parameter type).
 */
export function isMainMethod(m: FunctionIR): boolean {
  if (m.name !== 'main') return false;
  if (!m.modifiers.includes('static')) return false;
  if (!m.modifiers.includes('public')) return false;
  if (m.parameters.length !== 1) return false;
  const t = (m.parameters[0].type || '').replace(/\s+/g, '');
  // Accept `String[]` and the varargs `String...` spelling.
  return t === 'String[]' || t === 'String...';
}

/** Does this class declare a `public static void main(String[])`? */
function hasMain(cls: ClassIR): boolean {
  return cls.methods.some(isMainMethod);
}

/**
 * The batch package/name signal for a class: a batch-flavoured package segment
 * OR a batch-flavoured class-name suffix.
 */
function hasBatchNameSignal(cls: ClassIR, file: SourceFileIR): boolean {
  const pkg = file.packageOrNamespace || '';
  if (BATCH_PACKAGE_RE.test(pkg)) return true;
  if (BATCH_NAME_SUFFIX_RE.test(cls.name)) return true;
  return false;
}

/**
 * Result of the run-level batch-signal scan. `present` is the gate; the two
 * sets are forward seams the Group 4 synthesis step widens (shell-invocation
 * linkage resolves `main()` classes named in `.sh` / `.jil` commands).
 */
export interface BatchSignalScan {
  /** True when the run carries batch signals (the run-level emission gate). */
  present: boolean;
  /** Paths of batch-orchestration files (`.jil` / `.sh` / ...) in the scan. */
  batchFilePaths: string[];
  /**
   * Simple class names that appear (by token) inside a batch file's text —
   * a coarse shell-invocation hint. Empty unless the batch files carry
   * `rawContent`. Group 4 refines this into typed invocation edges.
   */
  shellInvokedNames: Set<string>;
}

/**
 * Scan the whole IR file set ONCE for batch signals. The run "carries batch
 * signals" if any batch-orchestration file is present OR any class is a
 * `main()` with a batch package/name signal.
 */
export function detectBatchSignals(files: SourceFileIR[]): BatchSignalScan {
  const batchFilePaths: string[] = [];
  const shellInvokedNames = new Set<string>();
  let mainBatchClassPresent = false;

  // Collect candidate class names up front so the shell-invocation token scan
  // (below) can match `main()` classes referenced inside a `.sh` / `.jil`.
  const mainClassNames: string[] = [];
  for (const file of files) {
    for (const cls of file.classes) {
      if (hasMain(cls)) {
        mainClassNames.push(cls.name);
        if (hasBatchNameSignal(cls, file)) mainBatchClassPresent = true;
      }
    }
  }

  for (const file of files) {
    if (BATCH_FILE_EXT_RE.test(file.filePath)) {
      batchFilePaths.push(file.filePath);
      const raw = file.rawContent;
      if (typeof raw === 'string' && raw.length > 0) {
        for (const name of mainClassNames) {
          // Word-boundary token match keeps `FooJob` from matching `FooJobs`.
          const re = new RegExp(`\\b${name}\\b`);
          if (re.test(raw)) shellInvokedNames.add(name);
        }
      }
    }
  }

  return {
    present: batchFilePaths.length > 0 || mainBatchClassPresent,
    batchFilePaths,
    shellInvokedNames,
  };
}

/**
 * Extract the `-o <OPERATION>` flag pattern (e.g. `-o UPDATE`, `-o ARCHIVE`)
 * from a class: its `main` / `execute` method call args AND, as a fallback, the
 * raw source. Returns the DISTINCT, upper-cased operation tokens in
 * first-seen order. Empty when the pattern is not detectable (D3: "else leave
 * the operations list empty").
 */
function captureOperationFlags(cls: ClassIR, file: SourceFileIR): string[] {
  const ops: string[] = [];
  const seen = new Set<string>();
  const add = (op: string) => {
    const norm = op.toUpperCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      ops.push(norm);
    }
  };

  // (a) Structured: a method call with consecutive `-o` then `<OP>` string-args
  // (e.g. `app.execute("-o", "ARCHIVE")`).
  for (const m of cls.methods) {
    for (const call of m.calls || []) {
      const args = call.args || [];
      for (let i = 0; i < args.length; i += 1) {
        const a = stripQuotes(args[i]);
        if (a === '-o' && i + 1 < args.length) {
          const op = stripQuotes(args[i + 1]);
          if (/^[A-Za-z][A-Za-z0-9_]*$/.test(op)) add(op);
        } else {
          // `"-o ARCHIVE"` packed into a single literal.
          const packed = a.match(/^-o\s+([A-Za-z][A-Za-z0-9_]*)$/);
          if (packed) add(packed[1]);
        }
      }
    }
  }

  // (b) Fallback: scan raw source for the `-o <OP>` flag pattern anywhere
  // (string literals the IR call-arg capture may not have surfaced).
  const raw = file.rawContent;
  if (typeof raw === 'string') {
    const re = /-o\s+["']?([A-Za-z][A-Za-z0-9_]*)["']?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) add(m[1]);
  }

  return ops;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(),
    runId,
    candidateType: type,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: BATCH_ENTRYPOINT_TAG },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

/**
 * Emit a batch-entrypoint `class` + child `method` candidates for `cls` IF it
 * qualifies. Returns [] (no emission) when the class is not a qualifying batch
 * entrypoint or the run does not carry batch signals.
 *
 * Recognition (D3): `public static void main(String[])` AND
 *   (a batch package/name signal OR the class is shell-invoked per `scan`)
 *   AND the run carries batch signals (`scan.present`).
 */
export function detectBatchEntrypoint(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  scan: BatchSignalScan,
): DiscoveryCandidate[] {
  // Run-level gate: do nothing on a run that carries no batch signals.
  if (!scan.present) return [];
  // Interfaces / abstract types are never batch entrypoints.
  if (cls.isInterface) return [];
  if (!hasMain(cls)) return [];

  const nameSignal = hasBatchNameSignal(cls, file);
  const shellInvoked = scan.shellInvokedNames.has(cls.name);
  // Per-class trigger: batch package/name signal OR shell-invocation.
  if (!nameSignal && !shellInvoked) return [];

  const out: DiscoveryCandidate[] = [];
  const operations = captureOperationFlags(cls, file);

  const fqcn = file.packageOrNamespace
    ? `${file.packageOrNamespace}.${cls.name}`
    : cls.name;

  const classData: Record<string, unknown> = {
    // The marker the synthesis step + the read-only UI key off.
    batch_entrypoint: true,
    className: cls.name,
    fullyQualifiedClass: fqcn,
    operations,
    // Provenance of the recognition decision (audit / Group 4 widening).
    batchSignalSource: shellInvoked ? 'shell-invoked' : 'package-or-name',
    shellInvoked,
  };

  const classCandidate = makeCandidate('class', cls.name, file.filePath, classData, runId);
  out.push(classCandidate);

  // Spec 2026-07-23: ALSO emit an `endpoints` candidate for the batch main.
  // Pre-fix batch entrypoints existed only as `class` candidates, so they
  // could never reach the committed endpoint surface the migration planner
  // partitions — the internal-processing stream stayed unplannable for
  // batch-main apps even after the internal-endpoint commit fix. The subtype
  // marker (`endpoint_subtype`) is what the save-back's internal-entry-point
  // rescue keys on; `httpMethod: 'BATCH_MAIN'` is a NON-HTTP verb token, so
  // the planner's `verb === null` heuristic classifies the committed row as
  // internal.
  out.push(
    makeCandidate(
      'endpoints',
      `BATCH_MAIN ${fqcn}`,
      file.filePath,
      {
        endpoint_subtype: 'batch-main',
        httpMethod: 'BATCH_MAIN',
        fullPath: fqcn,
        className: cls.name,
        methodName: 'main',
        batchSignalSource: shellInvoked ? 'shell-invoked' : 'package-or-name',
      },
      runId,
    ),
  );

  // Child `method` candidates for the entrypoint methods (main + execute/run/
  // process), de-duplicated on method name (the meta-model `method` is
  // signature-less).
  const seenMethods = new Set<string>();
  for (const m of cls.methods) {
    if (!ENTRYPOINT_METHOD_NAMES.has(m.name)) continue;
    // `main` always qualifies; the others only as public instance entrypoints.
    if (m.name !== 'main' && !m.modifiers.includes('public')) continue;
    if (seenMethods.has(m.name)) continue;
    seenMethods.add(m.name);
    out.push(
      makeCandidate(
        'method',
        m.name,
        file.filePath,
        {
          className: cls.name,
          returnType: m.returnType,
          parameterCount: m.parameters.length,
          isMain: m.name === 'main',
          batchEntrypointMethod: true,
        },
        runId,
        classCandidate.id,
      ),
    );
  }

  return out;
}
