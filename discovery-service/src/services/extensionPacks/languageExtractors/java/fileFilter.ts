/**
 * File Filtering Utilities
 *
 * Provides utilities for filtering source files from the LanguagePack
 * to identify Java source files, test files, and configuration files
 * relevant to the Java/Spring Boot Extension Pack.
 *
 * The pack receives LanguagePack `extract` source-file map which is a Map<string, string>
 * of all source files from the scan plan. These utilities filter that map to
 * the subsets needed by different extractors.
 *
 * Spec: Java/Spring Boot Extension Pack
 * - Task Group 2: File Filtering Utility
 */

/**
 * Filters source files to only Java files (.java) whose paths match
 * the techHints entries for Java/Spring Boot.
 *
 * A Java file matches if any techHint entry has language 'Java' (case-insensitive)
 * and the file path ends with '.java'.
 *
 * @param sourceFiles - All source files from the context (path -> content)
 * @param techHints - Technology hints from the discovery config
 * @returns A filtered map containing only matching Java source files
 */
export function filterJavaFiles(
  sourceFiles: Map<string, string>,
  techHints: Record<string, { language?: string; technology?: string; version?: string }>
): Map<string, string> {
  // Check if any techHint indicates Java
  const hasJavaHint = Object.values(techHints).some(
    hint => hint.language?.toLowerCase() === 'java'
  );

  if (!hasJavaHint) {
    return new Map();
  }

  const result = new Map<string, string>();

  for (const [filePath, content] of sourceFiles) {
    if (filePath.endsWith('.java')) {
      result.set(filePath, content);
    }
  }

  return result;
}

/**
 * Determines whether a file path corresponds to a test file.
 *
 * A file is considered a test file if its path contains '/src/test/'
 * or '/test/' (using forward slashes; also handles backslash paths).
 *
 * Test files are excluded from candidate extraction but may still be
 * scanned for inter-service dependency detection patterns.
 *
 * @param filePath - The file path to check
 * @returns true if the file is a test file
 */
export function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/src/test/') || normalized.includes('/test/');
}

/**
 * Filters source files to configuration files relevant to the
 * Java/Spring Boot Extension Pack:
 * - application.yml / application.yaml
 * - application.properties
 * - application-{profile}.yml / application-{profile}.yaml
 * - application-{profile}.properties
 * - db.changelog-master.yaml / db.changelog-master.xml
 * - db-changelog-master.yaml / db-changelog-master.xml
 *
 * @param sourceFiles - All source files from the context (path -> content)
 * @returns A filtered map containing only matching config files
 */
export function filterConfigFiles(
  sourceFiles: Map<string, string>
): Map<string, string> {
  const result = new Map<string, string>();

  for (const [filePath, content] of sourceFiles) {
    const normalized = filePath.replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || '';

    if (isConfigFile(fileName)) {
      result.set(filePath, content);
    }
  }

  return result;
}

/**
 * Checks whether a file name matches one of the known configuration
 * file patterns for Java/Spring Boot projects.
 */
function isConfigFile(fileName: string): boolean {
  // Application config files
  if (/^application(-[\w-]+)?\.(yml|yaml|properties)$/.test(fileName)) {
    return true;
  }

  // Liquibase changelog files
  if (/^db[.-]changelog[.-]master\.(yaml|yml|xml)$/.test(fileName)) {
    return true;
  }

  return false;
}
