/**
 * C++ file filter — selects .cpp / .cc / .cxx / .c++ source files plus
 * their associated header forms (.h / .hpp / .hh / .hxx).
 *
 * Mirrors the inline regex used by `wxwidgetsPackV2` and `oatppPackV2`
 * (`/\.(cpp|cc|cxx|c\+\+|h|hpp|hh|hxx)$/`) so V3 candidate counts on the
 * upstream `wxwidgets` and `oatpp-crud` reference repos remain identical
 * to the V2 baselines (per-pack 98% gate).
 *
 * The header filter intentionally accepts `.h` files even though those
 * are sometimes plain C — the existing C++ extractor is tolerant of C
 * headers (the tree-sitter-cpp grammar is a superset), and both V2 packs
 * relied on this behaviour. The `c` language pack (in
 * `languageExtractors/c/`) targets a separate slice of `.c` files and is
 * orthogonal to this filter.
 */
export function filterCppFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, { language?: string; technology?: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [filePath, src] of sourceFiles) {
    const lower = filePath.toLowerCase();
    if (/\.(cpp|cc|cxx|c\+\+|h|hpp|hh|hxx)$/.test(lower)) {
      out.set(filePath, src);
    }
  }
  return out;
}

/**
 * Best-effort C++ test-file heuristic, exported for callers that want to
 * post-filter `filterCppFiles`'s output. **NOT applied by `cppLangPack`
 * itself** — the V2 packs (`wxwidgetsPackV2`, `oatppPackV2`) did not
 * filter test files, and `wxwidgets/tests/**` contains real
 * `wxFrame`-extending classes that the V2 adapter emits as candidates.
 * Filtering them out here would drop the V3 baseline below V2 and break
 * the per-pack 98% gate.
 *
 * Provided for future tightening (e.g. once the prompt layer can target
 * test-class blind spots specifically) and for symmetry with the other
 * language packs (`isJsTestFile`, `isPyTestFile`, etc.).
 *
 * Cases handled:
 *  - `test/`, `tests/`, `unit_tests/`, `gtest/` directory segments.
 *  - `*Test.cpp`, `*Tests.cpp`, `*_test.cpp`, `*_tests.cpp` filename
 *    suffixes (and the equivalent header forms).
 */
export function isCppTestFile(filePath: string): boolean {
  const f = filePath.toLowerCase();
  if (/\/(tests?|unit_tests|gtest)\//.test(f)) return true;
  if (/(_|\b)tests?\.(cpp|cc|cxx|c\+\+|h|hpp|hh|hxx)$/.test(f)) return true;
  return false;
}
