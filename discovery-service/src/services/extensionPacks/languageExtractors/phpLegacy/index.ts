/**
 * php-legacy extractor — thin wrapper over php-modern extractor.
 * PHP 4/5 syntax is a subset of PHP 7+ for AST purposes.
 */
import { extractPhpIR } from '../php';
import type { SourceFileIR } from '../../languageIR';

export function extractPhpLegacyIR(filePath: string, source: string): SourceFileIR | null {
  const ir = extractPhpIR(filePath, source);
  if (!ir) return null;
  return { ...ir, language: 'php-legacy' };
}
