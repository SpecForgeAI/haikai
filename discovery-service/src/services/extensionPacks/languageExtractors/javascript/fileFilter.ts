/**
 * JavaScript file filter — selects .js / .jsx / .mjs / .cjs files.
 */
export function filterJsFiles(
  sourceFiles: Map<string, string>,
  _techHints: Record<string, { language?: string; technology?: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, src] of sourceFiles) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
      // Skip minified, bundle output, and declaration files
      if (lower.endsWith('.min.js')) continue;
      if (lower.includes('/node_modules/')) continue;
      out.set(path, src);
    }
  }
  return out;
}

export function isJsTestFile(filePath: string): boolean {
  const f = filePath.toLowerCase();
  return (
    f.endsWith('.test.js') || f.endsWith('.test.jsx') ||
    f.endsWith('.spec.js') || f.endsWith('.spec.jsx') ||
    /\/__tests__\//.test(f) ||
    /\/tests?\//.test(f)
  );
}
