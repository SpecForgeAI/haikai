/**
 * File Filtering Utilities for React/TypeScript Extension Pack
 *
 * Provides utilities for filtering source files from the LanguagePack
 * to identify TypeScript and TSX source files relevant to the React/TypeScript
 * Extension Pack.
 *
 * The pack receives LanguagePack `extract` source-file map which is a Map<string, string>
 * of all source files from the scan plan. These utilities filter that map to
 * the subsets needed by different extractors.
 *
 * Spec: React/TypeScript Extension Pack
 * - Task Group 1: File Filtering Utility
 */

/**
 * Filters source files to only TypeScript/TSX files (.ts and .tsx) whose
 * paths match the techHints entries for TypeScript.
 *
 * A TypeScript file matches if any techHint entry has language 'TypeScript'
 * (case-insensitive) and the file path ends with '.ts' or '.tsx'.
 *
 * Excludes:
 * - Test files (paths containing `/__tests__/`, `__test__/`, or files
 *   matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`)
 * - Declaration files (`*.d.ts`)
 * - `node_modules/` paths
 *
 * Includes route-related files (`routes.ts`, `router.ts`, `App.tsx`) even
 * if they do not match a typical component naming pattern.
 *
 * @param sourceFiles - All source files from the context (path -> content)
 * @param techHints - Technology hints from the discovery config
 * @returns A filtered map containing only matching TypeScript/TSX source files
 */
export function filterTsFiles(
  sourceFiles: Map<string, string>,
  techHints: Record<string, { language?: string; technology?: string; version?: string }>
): Map<string, string> {
  // Check if any techHint indicates TypeScript
  const hasTypeScriptHint = Object.values(techHints).some(
    hint => hint.language?.toLowerCase() === 'typescript'
  );

  if (!hasTypeScriptHint) {
    return new Map();
  }

  const result = new Map<string, string>();

  for (const [filePath, content] of sourceFiles) {
    // Must be a .ts or .tsx file
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
      continue;
    }

    // Exclude node_modules
    if (isNodeModules(filePath)) {
      continue;
    }

    // Exclude declaration files
    if (isDeclarationFile(filePath)) {
      continue;
    }

    // Exclude test files
    if (isTestFile(filePath)) {
      continue;
    }

    result.set(filePath, content);
  }

  return result;
}

/**
 * Determines whether a file path corresponds to a test file.
 *
 * A file is considered a test file if:
 * - Its path contains `/__tests__/` or `__test__/`
 * - Its filename matches `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx`
 *
 * Test files are excluded from candidate extraction.
 *
 * @param filePath - The file path to check
 * @returns true if the file is a test file
 */
export function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  // Check for test directory patterns
  if (normalized.includes('/__tests__/') || normalized.includes('__test__/')) {
    return true;
  }

  // Check for test file name patterns
  const fileName = normalized.split('/').pop() || '';
  if (
    fileName.endsWith('.test.ts') ||
    fileName.endsWith('.test.tsx') ||
    fileName.endsWith('.spec.ts') ||
    fileName.endsWith('.spec.tsx')
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether a file path is a TypeScript declaration file (.d.ts).
 *
 * @param filePath - The file path to check
 * @returns true if the file is a declaration file
 */
export function isDeclarationFile(filePath: string): boolean {
  return filePath.endsWith('.d.ts');
}

/**
 * Determines whether a file path is inside a node_modules directory.
 *
 * @param filePath - The file path to check
 * @returns true if the file is in node_modules
 */
export function isNodeModules(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('node_modules/');
}
