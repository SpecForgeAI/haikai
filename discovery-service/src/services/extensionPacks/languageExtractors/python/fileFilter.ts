/**
 * Python file filter — selects .py files from the source set.
 * Technology-agnostic: both Django and Flask packs use this.
 */
export function filterPythonFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, { language?: string; technology?: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, src] of sourceFiles) {
    if (!path.endsWith('.py')) continue;
    out.set(path, src);
  }
  return out;
}

/** Identify files that belong to a test suite and should be skipped. */
export function isPythonTestFile(filePath: string): boolean {
  return (
    /\/tests?\//i.test(filePath) ||
    /(^|\/)test_[^/]+\.py$/i.test(filePath) ||
    /(^|\/)[^/]+_test\.py$/i.test(filePath) ||
    /(^|\/)conftest\.py$/i.test(filePath)
  );
}
