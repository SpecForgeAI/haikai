export function filterGoFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, src] of sourceFiles) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.go')) continue;
    if (lower.endsWith('_test.go')) continue;
    if (lower.includes('/vendor/')) continue;
    out.set(path, src);
  }
  return out;
}

export function isGoTestFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('_test.go');
}
