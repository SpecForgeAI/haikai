/**
 * PHP Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Stage 1 producer for PHP source files. Wraps the existing
 * `extractPhpIR` + `filterPhpFiles` + `isPhpTestFile` logic previously
 * bundled inside `wordpressPackV2`, `symfonyPackV2`, and `magentoPackV2`
 * (all three V2 packs share the same extract/filter pair) into the typed
 * `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'PHP' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.php` / `.phtml` files, skip
 *    `/vendor/` and `/node_modules/` directories, skip test files
 *    (`/tests?/`, `*Test.php`, `*Spec.php`), and parse each remaining
 *    file into `SourceFileIR` via `extractPhpIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged, consistent with the V2
 *    pack behaviour we are replacing).
 *
 * FrameworkPack consumers of this IR: `wordpressFrameworkPack`,
 * `symfonyFrameworkPack`, `magentoFrameworkPack`. All three delegate to
 * the existing deterministic `runWordpressAdapter` / `runSymfonyAdapter`
 * / `runMagentoAdapter` implementations in
 * `frameworkAdapters/wordpress/`, `frameworkAdapters/symfony/`, and
 * `frameworkAdapters/magento/` respectively.
 *
 * Note on magento + php-legacy: the V2 `magentoPackV2` used a thin
 * `extractPhpLegacyIR` wrapper that re-tagged the IR's `language` field
 * as `'php-legacy'`. None of the three framework adapters inspect the
 * `language` field (all three key off classes / functions / calls), so
 * the single `php` IR tag is functionally equivalent — the per-pack
 * baseline gate against magento-lts confirms parity.
 *
 * The file-filter + isPhpTestFile helpers are imported from
 * `languageExtractors/php/fileFilter` — this follows the same lift
 * pattern as `pythonLangPack` / `rubyLangPack` / `typescriptLangPack`
 * / `javaLangPack`. The extractor module is retained in-tree until
 * Group 11 removes V2.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractPhpIR } from '../../languageExtractors/php';
import {
  filterPhpFiles,
  isPhpTestFile,
} from '../../languageExtractors/php/fileFilter';

export const phpLangPack: LanguagePack = {
  id: 'php-lang',
  when: { language: 'PHP' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const phpFiles = filterPhpFiles(sourceFiles, techHints);
    if (phpFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of phpFiles) {
      if (isPhpTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractPhpIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[php-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[php-lang] Parsed ${parsed} PHP files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
