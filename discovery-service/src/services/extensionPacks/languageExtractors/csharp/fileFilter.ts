export function filterCSharpFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, src] of sourceFiles) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.cs')) continue;
    if (lower.includes('/bin/') || lower.includes('/obj/')) continue; // build outputs
    out.set(path, src);
  }
  return out;
}

export function isCSharpTestFile(filePath: string): boolean {
  const f = filePath.toLowerCase();
  return /\/tests?\//.test(f) || /Tests\.cs$/i.test(f) || /Test\.cs$/i.test(f);
}
