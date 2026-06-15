/**
 * Module-level raw-source cache shared between `cppLangPack` (Stage 1
 * producer) and `oatppFrameworkPack` (Stage 2 consumer that needs raw
 * text for ENDPOINT-macro regex scanning).
 *
 * Spec: V3 Pack Migration Batch (Task Group 10)
 *
 * Why this cache exists at all:
 *
 *   The V3 `FrameworkPack.adapt(irFiles, runId, techHints)` contract
 *   intentionally does NOT pass raw source text — IR is meant to be the
 *   sufficient input for every framework pack. Every other framework
 *   pack in the spec migration honors that contract.
 *
 *   The Oatpp framework is the one outlier. Oatpp uses heavy
 *   macro-based code generation (`ENDPOINT("GET", "/users/{id}",
 *   getUser, PATH(Int32, id)) { ... }`) — tree-sitter-cpp sees the
 *   ENDPOINT macro body as an unparsed token sequence and emits zero
 *   class_specifier nodes for files containing it. The V2 adapter
 *   (`runOatppAdapter`) compensates by accepting the raw source map
 *   alongside the IR list and running a regex scan for `ENDPOINT(...)`
 *   call expressions.
 *
 *   Faithfully migrating Oatpp to V3 therefore requires routing raw
 *   source from `cppLangPack.extract` (which already has it) to
 *   `oatppFrameworkPack.adapt` (which needs it) without changing the
 *   `FrameworkPack` contract. A module-level cache is the least-bad
 *   option:
 *
 *     - Threading raw source through the IR shape would couple
 *       `SourceFileIR` to a single framework's regex needs.
 *     - Re-reading from disk would not work because the evaluation
 *       harness uses synthetic in-memory paths (`fixture.sourceFileName`
 *       is not a real path on disk).
 *     - Adding a new optional field to `FrameworkPack.adapt` would
 *       break every other migrated pack's signature even though only
 *       one pack needs it.
 *
 *   The cache is populated synchronously in `cppLangPack.extract`
 *   immediately before `oatppFrameworkPack.adapt` reads it (the V3
 *   pipeline always invokes Stage 1 then Stage 2 sequentially per
 *   `run-pack-local.ts::runHarness` and `evaluation/pipelineInvoker.ts`).
 *   The cache is keyed by `filePath` so multi-pack runs over the same
 *   `sourceFiles` map see consistent text.
 *
 *   On every `cppLangPack.extract` invocation the cache is wiped first
 *   (the new `sourceFiles` map fully replaces the previous run's view).
 *   `oatppFrameworkPack.adapt` reads but never mutates.
 *
 * Concurrency note:
 *
 *   The discovery-service runs one pipeline at a time per process. There
 *   is no concurrent V3 invocation that would race the cache. If that
 *   assumption ever changes, this would need either an `AsyncLocalStorage`
 *   binding or an explicit context object threaded through `adapt`.
 *   Spec-4 follow-up either way.
 */

let cache: Map<string, string> = new Map();

/**
 * Replace the cache with the supplied source map. Called by
 * `cppLangPack.extract` once per pipeline run.
 */
export function setCppRawSources(sourceFiles: Map<string, string>): void {
  cache = sourceFiles;
}

/**
 * Read the current raw-source map. Called by `oatppFrameworkPack.adapt`.
 * Returns an empty Map if `cppLangPack.extract` was never called for
 * this run (defensive — should not happen in normal pipeline flow but
 * keeps adapter behaviour graceful in tests that drive `adapt`
 * directly without first calling `extract`).
 */
export function getCppRawSources(): Map<string, string> {
  return cache;
}

/**
 * Reset the cache. Exported for tests that want a clean slate between
 * cases without invoking `cppLangPack.extract`.
 */
export function clearCppRawSources(): void {
  cache = new Map();
}
