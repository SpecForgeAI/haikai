/**
 * COBOL Language Extractor — STUB.
 *
 * Blocked: tree-sitter-cobol native binding requires Visual Studio C++ build
 * tools on Windows (not installed on this host). Left as a stub; adapters that
 * depend on it will see zero input.
 */
import type { SourceFileIR } from '../../languageIR';

export function extractCobolIR(_filePath: string, _sourceCode: string): SourceFileIR | null {
  return null;
}
