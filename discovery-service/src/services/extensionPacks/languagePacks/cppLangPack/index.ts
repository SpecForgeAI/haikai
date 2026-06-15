/**
 * C++ Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 10)
 *
 * Stage 1 producer for C++ source files (.cpp / .cc / .cxx / .c++ /
 * .h / .hpp / .hh / .hxx). Wraps the existing `extractCppIR` +
 * `filterCppFiles` logic previously bundled inside `wxwidgetsPackV2`
 * and `oatppPackV2` into the typed `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'C++' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to C++ source/header files via
 *    `filterCppFiles` and parse each remaining file into `SourceFileIR`
 *    via `extractCppIR`.
 *  - Mirror the V2 packs' behaviour exactly — files that fail to parse
 *    are simply omitted (a `console.warn` is logged for visibility but
 *    no exception is propagated, consistent with the swallow-and-skip
 *    `try { ... } catch {}` in `wxwidgetsPackV2.enrich`).
 *  - **Side-channel raw-source cache** — populate `setCppRawSources`
 *    before returning so `oatppFrameworkPack.adapt` can do its
 *    ENDPOINT-macro regex scan without a contract-level
 *    `rawSources` parameter on `FrameworkPack.adapt`. See
 *    `rawSourceCache.ts` for the full rationale on why this side
 *    channel exists at all.
 *
 * FrameworkPack consumers of this IR:
 *  - `wxwidgetsFrameworkPack` — delegates to `runWxwidgetsAdapter`,
 *    which inspects `class.extends` against `wxFrame` / `wxDialog` /
 *    `wxPanel` / etc. base names. Pure IR consumer; ignores the raw-
 *    source side channel.
 *  - `oatppFrameworkPack` — delegates to `runOatppAdapter` with raw
 *    sources from the side-channel cache. The adapter cannot work
 *    from IR alone because tree-sitter-cpp emits zero
 *    `class_specifier` nodes for files containing `ENDPOINT(...)`
 *    macro bodies — the parser bails on the unparseable macro
 *    arguments. The adapter therefore falls back to pure-regex
 *    detection on the raw text for both controller-class names AND
 *    endpoint signatures.
 *
 * Test-file filtering: deliberately NOT applied (see
 * `fileFilter.ts::isCppTestFile` for the exported helper that callers
 * can use post-hoc). The V2 packs included `tests/` directories and
 * any class hierarchy inside test files contributes to the V2 baseline
 * the per-pack 98% gate is calibrated against — filtering them out
 * here would silently regress the V3 candidate count.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractCppIR } from '../../languageExtractors/cpp';
import { filterCppFiles } from '../../languageExtractors/cpp/fileFilter';
import { setCppRawSources } from './rawSourceCache';

export const cppLangPack: LanguagePack = {
  id: 'cpp-lang',
  when: { language: 'C++' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const cppFiles = filterCppFiles(sourceFiles, techHints);
    // Populate the side-channel cache regardless — even an empty map
    // must overwrite a previous run's residue so oatppFrameworkPack
    // does not see stale source from an unrelated invocation.
    setCppRawSources(cppFiles);

    if (cppFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of cppFiles) {
      try {
        const ir = extractCppIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          // Tree-sitter-cpp returned null — common for files that contain
          // unparseable macro bodies (ENDPOINT, BOOST_*, Qt MOC etc.).
          // The framework packs cope: oatppFrameworkPack reads raw
          // source for these via the side-channel cache;
          // wxwidgetsFrameworkPack simply emits nothing for them.
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[cpp-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[cpp-lang] Parsed ${parsed} C++ files (${skipped} skipped).`,
    );
    return irFiles;
  },
};

// Re-export the raw-source cache helpers so consumers can import
// everything from a single barrel rather than reaching into the
// internal `rawSourceCache` module.
export {
  getCppRawSources,
  setCppRawSources,
  clearCppRawSources,
} from './rawSourceCache';
