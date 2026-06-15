/**
 * Python Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 4)
 *
 * Stage 1 producer for Python source files. Wraps the existing
 * `extractPythonIR` + `filterPythonFiles` + `isPythonTestFile` logic
 * previously bundled inside `djangoPackV2` and `flaskPackV2` (both V2 packs
 * share the same extract/filter pair) into the typed `LanguagePack`
 * contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'Python' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.py` files, skip test files
 *    (`/tests?/`, `test_*.py`, `*_test.py`, `conftest.py`), and parse each
 *    file into `SourceFileIR` via `extractPythonIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged, consistent with the V2
 *    pack behaviour we are replacing).
 *
 * FrameworkPack consumers of this IR: `djangoFrameworkPack`,
 * `flaskFrameworkPack`. Both delegate to the existing deterministic
 * `runDjangoAdapter` / `runFlaskAdapter` implementations in
 * `frameworkAdapters/django/` and `frameworkAdapters/flask/` respectively.
 *
 * The file-filter + isPythonTestFile helpers are imported from
 * `languageExtractors/python/fileFilter` — this follows the same lift
 * pattern as `typescriptLangPack` / `javaLangPack`. The extractor module
 * is retained in-tree until Group 11 removes V2.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractPythonIR } from '../../languageExtractors/python';
import {
  filterPythonFiles,
  isPythonTestFile,
} from '../../languageExtractors/python/fileFilter';

export const pythonLangPack: LanguagePack = {
  id: 'python-lang',
  when: { language: 'Python' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const pyFiles = filterPythonFiles(sourceFiles, techHints);
    if (pyFiles.size === 0) return irFiles;

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of pyFiles) {
      if (isPythonTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractPythonIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[python-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[python-lang] Parsed ${parsed} Python files (${skipped} skipped).`,
    );
    return irFiles;
  },
};
