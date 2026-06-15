/**
 * Go Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 7)
 *
 * Stage 1 producer for Go source files. Wraps the existing
 * `extractGoIR` + `filterGoFiles` + `isGoTestFile` logic previously
 * bundled inside `kratosPackV2` into the typed `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'Go' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.go` files (excluding
 *    `_test.go` and `/vendor/` paths), and parse each remaining file
 *    into `SourceFileIR` via `extractGoIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged, consistent with the V2
 *    pack behaviour we are replacing).
 *
 * FrameworkPack consumers of this IR: `kratosFrameworkPack`. Delegates
 * to the existing deterministic `runKratosAdapter` implementation in
 * `frameworkAdapters/kratos/`.
 *
 * The file-filter + isGoTestFile helpers are imported from
 * `languageExtractors/go/fileFilter` — this follows the same lift
 * pattern as `rubyLangPack` / `pythonLangPack` / `typescriptLangPack` /
 * `javaLangPack`. The extractor module is retained in-tree until
 * Group 11 removes V2.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractGoIR } from '../../languageExtractors/go';
import {
  filterGoFiles,
  isGoTestFile,
} from '../../languageExtractors/go/fileFilter';

export const goLangPack: LanguagePack = {
  id: 'go-lang',
  when: { language: 'Go' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const goFiles = filterGoFiles(sourceFiles, techHints);
    if (goFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of goFiles) {
      if (isGoTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractGoIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[go-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[go-lang] Parsed ${parsed} Go files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
