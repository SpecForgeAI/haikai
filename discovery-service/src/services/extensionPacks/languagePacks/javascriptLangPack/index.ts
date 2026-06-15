/**
 * JavaScript Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 9)
 *
 * Stage 1 producer for plain JavaScript source files (.js / .jsx /
 * .mjs / .cjs). Wraps the existing `extractJavaScriptIR` +
 * `filterJsFiles` + `isJsTestFile` logic previously bundled inside
 * `reactJavascriptPackV2` and `jqueryPackV2` into the typed
 * `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'JavaScript' }` (per
 *    the V3 `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to .js / .jsx / .mjs / .cjs
 *    files (skipping `.min.js`, `node_modules/`, and conventional test
 *    paths) and parse each remaining file into `SourceFileIR` via
 *    `extractJavaScriptIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged, consistent with the V2
 *    pack behaviour we are replacing).
 *
 * FrameworkPack consumers of this IR: `reactJavascriptFrameworkPack`
 * (delegates to `runReactAxiosAdapter`) and `jqueryFrameworkPack`
 * (delegates to `runJqueryAdapter`).
 *
 * Why a SEPARATE pack from `typescriptLangPack`:
 *  - The V2 extractors differ. `extractJavaScriptIR` rewrites .jsx/.js
 *    paths to .tsx/.ts so the underlying tree-sitter-typescript grammar
 *    is selected (TS is a superset of ES6+), and re-tags the resulting
 *    IR's `language` field as `'javascript'`. The TypeScript pack does
 *    not perform this rewrite + retag.
 *  - The file filter differs. `filterJsFiles` selects .js / .jsx / .mjs
 *    / .cjs and excludes `.min.js` / `node_modules/`. `filterTsFiles`
 *    selects .ts / .tsx and excludes `.d.ts`.
 *  - jQuery's V2 pack (`jqueryPackV2`) used a thin
 *    `extractJavaScriptES5IR` wrapper that re-tags IR's `language`
 *    field as `'javascript-es5'`. The jQuery adapter does NOT inspect
 *    the `language` field — it keys off call-expression shapes
 *    (`$.ajax`, `$.widget`, etc.) — so the single shared
 *    `javascriptLangPack` (producing `language: 'javascript'` IR) is
 *    functionally equivalent. Same pattern as `phpLangPack` covering
 *    both modern PHP and `php-legacy` consumers, and `csharpLangPack`
 *    covering both asp-net-core and asp-net-framework.
 *
 * The file-filter + isJsTestFile helpers are imported from
 * `languageExtractors/javascript/fileFilter` — same lift pattern as
 * `csharpLangPack` / `goLangPack` / `rubyLangPack` /
 * `pythonLangPack` / `typescriptLangPack` / `javaLangPack`. The
 * extractor + helper modules are retained in-tree until Group 11
 * removes V2.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractJavaScriptIR } from '../../languageExtractors/javascript';
import {
  filterJsFiles,
  isJsTestFile,
} from '../../languageExtractors/javascript/fileFilter';

export const javascriptLangPack: LanguagePack = {
  id: 'javascript-lang',
  when: { language: 'JavaScript' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const jsFiles = filterJsFiles(sourceFiles, techHints);
    if (jsFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of jsFiles) {
      if (isJsTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractJavaScriptIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[javascript-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[javascript-lang] Parsed ${parsed} JS/JSX files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
