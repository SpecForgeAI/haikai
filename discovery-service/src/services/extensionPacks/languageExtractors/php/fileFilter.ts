export function filterPhpFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, src] of sourceFiles) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.php') || lower.endsWith('.phtml')) {
      if (lower.includes('/vendor/')) continue; // composer dependencies
      if (lower.includes('/node_modules/')) continue;
      out.set(path, src);
    }
  }
  return out;
}

export function isPhpTestFile(filePath: string): boolean {
  const f = filePath.toLowerCase();
  return /\/tests?\//.test(f) || /Test\.php$/i.test(f) || /Spec\.php$/i.test(f);
}
