/**
 * Ruby Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 5)
 *
 * Stage 1 producer for Ruby source files. Wraps the existing
 * `extractRubyIR` + `filterRubyFiles` + `isRubyTestFile` logic
 * previously bundled inside `railsPackV2` into the typed `LanguagePack`
 * contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'Ruby' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.rb` / `.rake` files, skip
 *    test files (`/tests?/`, `/specs?/`, `*_spec.rb`, `*_test.rb`), and
 *    parse each remaining file into `SourceFileIR` via `extractRubyIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged, consistent with the V2
 *    pack behaviour we are replacing).
 *
 * FrameworkPack consumers of this IR: `railsFrameworkPack`. Delegates to
 * the existing deterministic `runRailsAdapter` implementation in
 * `frameworkAdapters/rails/`.
 *
 * The file-filter + isRubyTestFile helpers are imported from
 * `languageExtractors/ruby/fileFilter` — this follows the same lift
 * pattern as `pythonLangPack` / `typescriptLangPack` / `javaLangPack`.
 * The extractor module is retained in-tree until Group 11 removes V2.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractRubyIR } from '../../languageExtractors/ruby';
import {
  filterRubyFiles,
  isRubyTestFile,
} from '../../languageExtractors/ruby/fileFilter';

export const rubyLangPack: LanguagePack = {
  id: 'ruby-lang',
  when: { language: 'Ruby' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const rbFiles = filterRubyFiles(sourceFiles, techHints);
    if (rbFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of rbFiles) {
      if (isRubyTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractRubyIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[ruby-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[ruby-lang] Parsed ${parsed} Ruby files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
