export function filterRubyFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, src] of sourceFiles) {
    const lower = path.toLowerCase();
    if (!(lower.endsWith('.rb') || lower.endsWith('.rake'))) continue;
    if (lower.includes('/vendor/')) continue;
    out.set(path, src);
  }
  return out;
}

export function isRubyTestFile(filePath: string): boolean {
  const f = filePath.toLowerCase();
  return /\/(tests?|specs?)\//.test(f) || /_spec\.rb$/i.test(f) || /_test\.rb$/i.test(f);
}
