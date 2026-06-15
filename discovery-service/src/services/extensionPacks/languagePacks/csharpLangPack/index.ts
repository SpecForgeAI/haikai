/**
 * C# Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 8)
 *
 * Stage 1 producer for C# source files. Wraps the existing
 * `extractCSharpIR` + `filterCSharpFiles` + `isCSharpTestFile` logic
 * previously bundled inside `aspNetCorePackV2` / `aspNetFrameworkPackV2`
 * into the typed `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'C#' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.cs` files (excluding
 *    build outputs `/bin/` and `/obj/`), and parse each remaining file
 *    into `SourceFileIR` via `extractCSharpIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged, consistent with the V2
 *    pack behaviour we are replacing).
 *
 * FrameworkPack consumers of this IR: `aspNetCoreFrameworkPack` +
 * `aspNetFrameworkFrameworkPack`. Both delegate to deterministic
 * adapter functions in `frameworkAdapters/aspNetCore/` and
 * `frameworkAdapters/aspNetFramework/`.
 *
 * Note on `csharp-netfx` IR tag: the V2 `aspNetFrameworkPackV2` used a
 * thin `extractCSharpNetFxIR` wrapper (re-tagged IR's `language` field
 * as `'csharp-netfx'`). The asp-net-framework adapter does NOT inspect
 * the `language` field — it delegates to `runAspNetCoreAdapter` keyed
 * off attribute + base-type heuristics — so the single shared
 * `csharpLangPack` (producing `language: 'csharp'` IR) is functionally
 * equivalent. Same pattern as `phpLangPack` covering both modern PHP
 * and `php-legacy` consumers.
 *
 * The file-filter + isCSharpTestFile helpers are imported from
 * `languageExtractors/csharp/fileFilter` — this follows the same lift
 * pattern as `goLangPack` / `rubyLangPack` / `pythonLangPack` /
 * `typescriptLangPack` / `javaLangPack`. The extractor module is
 * retained in-tree until Group 11 removes V2.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractCSharpIR } from '../../languageExtractors/csharp';
import {
  filterCSharpFiles,
  isCSharpTestFile,
} from '../../languageExtractors/csharp/fileFilter';

export const csharpLangPack: LanguagePack = {
  id: 'csharp-lang',
  when: { language: 'C#' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const csFiles = filterCSharpFiles(sourceFiles, techHints);
    if (csFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of csFiles) {
      if (isCSharpTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractCSharpIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[csharp-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[csharp-lang] Parsed ${parsed} C# files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
