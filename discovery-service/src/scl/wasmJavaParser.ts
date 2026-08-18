/**
 * SCL wasm Java parser — web-tree-sitter (WASM) binding for the SCL pipeline.
 *
 * WHY WASM (2026-08-18 determinism fix): the NATIVE node-tree-sitter binding
 * exhibited nondeterministic node-read corruption in the SCL slice — a class
 * body intermittently walks as EMPTY (0 fields / 0 methods while the class
 * name survives), reproducible within ~40 repeated `indexJavaProject` runs of
 * the fixture app. The corruption lives in the native transfer-buffer /
 * node-marshalling layer; web-tree-sitter has no shared native buffer, so SCL
 * (and ONLY SCL — the legacy extractors under `src/services/` keep the native
 * path through `treeSitterBinding.ts`) parses via WASM.
 *
 * Initialisation is async (`ensureJavaWasmParser`), cached both at module
 * scope AND on `process`: module scope covers production (modules evaluate
 * once); the `process` cache survives Jest's per-file module-registry resets
 * so parse-heavy suites in one worker don't re-initialise the wasm runtime
 * needlessly (re-initialisation is harmless, merely slow — unlike the native
 * binding, where a second evaluation corrupts the process; see
 * `src/services/extensionPacks/languageExtractors/treeSitterBinding.ts`).
 *
 * NOTE web-tree-sitter node indexes (`startIndex` / `endIndex`) are UTF-16
 * code units, NOT bytes — validate spans against `source.length`, never
 * `Buffer.byteLength`.
 */

import Parser from 'web-tree-sitter';

/** web-tree-sitter's node type — the SyntaxNode used throughout src/scl. */
export type WasmSyntaxNode = Parser.SyntaxNode;
export type WasmTree = Parser.Tree;

const PROCESS_CACHE_KEY = '__haikaiSclWasmJavaParser__';

/** Module-scope cache (production fast path). */
let moduleParser: Parser | null = null;
let moduleInitPromise: Promise<Parser> | null = null;

function processCache(): { parser?: Parser } {
  const proc = process as unknown as Record<string, { parser?: Parser }>;
  if (!proc[PROCESS_CACHE_KEY]) proc[PROCESS_CACHE_KEY] = {};
  return proc[PROCESS_CACHE_KEY];
}

async function initParser(): Promise<Parser> {
  await Parser.init();
  const wasmPath = require.resolve('tree-sitter-wasms/out/tree-sitter-java.wasm');
  const Java = await Parser.Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(Java);
  return parser;
}

/**
 * Initialises the wasm Java parser once per process (idempotent; concurrent
 * callers share one in-flight init). MUST be awaited before `parseJavaWasm`.
 */
export async function ensureJavaWasmParser(): Promise<void> {
  if (moduleParser) return;
  const cached = processCache().parser;
  if (cached) {
    moduleParser = cached;
    return;
  }
  if (!moduleInitPromise) {
    moduleInitPromise = initParser();
  }
  try {
    const parser = await moduleInitPromise;
    moduleParser = parser;
    processCache().parser = parser;
  } finally {
    moduleInitPromise = null;
  }
}

/**
 * Parses Java source synchronously with the process-cached wasm parser.
 * Throws if `ensureJavaWasmParser` has not completed in this process.
 */
export function parseJavaWasm(source: string): WasmTree {
  if (!moduleParser) {
    const cached = processCache().parser;
    if (cached) {
      moduleParser = cached;
    } else {
      throw new Error(
        'SCL wasm Java parser not initialised — await ensureJavaWasmParser() before parseJavaWasm()'
      );
    }
  }
  return moduleParser.parse(source);
}
