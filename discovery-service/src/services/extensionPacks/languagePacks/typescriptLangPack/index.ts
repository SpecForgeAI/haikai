/**
 * TypeScript Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 3)
 *
 * Stage 1 producer for TypeScript / TSX source files. Wraps the
 * `extractTypeScriptIR` + `filterTsFiles` + `isTestFile` logic into the
 * typed `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'TypeScript' }` (per the
 *    V3 `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.ts` / `.tsx` files, skip
 *    test + declaration + node_modules files, and parse each file into
 *    `SourceFileIR` via `extractTypeScriptIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged).
 *
 * FrameworkPack consumers of this IR: `reactTypescriptFrameworkPack`,
 * `nestjsFrameworkPack`, `angularFrameworkPack`. A separate
 * `javascriptLangPack` exists (Task Group 9) because the JavaScript
 * extractor differs from the TypeScript one — do not conflate them.
 *
 * The file-filter + isTestFile helpers were lifted from the legacy
 * `extensionPacks/reactTypescript/` directory into
 * `extensionPacks/languageExtractors/typescript/` as part of the V2
 * removal (V3 Pack Migration Batch — Task Group 11) so all
 * TypeScript-language plumbing is in one place.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractTypeScriptIR } from '../../languageExtractors/typescript';
import { filterTsFiles, isTestFile } from '../../languageExtractors/typescript/fileFilter';

export const typescriptLangPack: LanguagePack = {
  id: 'typescript-lang',
  when: { language: 'TypeScript' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const tsFiles = filterTsFiles(sourceFiles, techHints);
    if (tsFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of tsFiles) {
      if (isTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractTypeScriptIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[typescript-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[typescript-lang] Parsed ${parsed} TS/TSX files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
