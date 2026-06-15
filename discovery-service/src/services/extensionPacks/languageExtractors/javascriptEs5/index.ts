/**
 * javascript-es5 language extractor — thin wrapper over javascript-modern.
 * ES5 code (var, function expressions, module.exports) parses correctly with
 * the TS grammar used underneath the javascript extractor.
 */
import { extractJavaScriptIR } from '../javascript';
import type { SourceFileIR } from '../../languageIR';

export function extractJavaScriptES5IR(filePath: string, src: string): SourceFileIR | null {
  const ir = extractJavaScriptIR(filePath, src);
  if (!ir) return null;
  return { ...ir, language: 'javascript-es5' };
}
