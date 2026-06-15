/**
 * JavaScript Language Extractor (ES6+)
 *
 * For plain JavaScript sources (.js / .jsx). Reuses the TypeScript language
 * extractor's tree walking — the tree-sitter-typescript grammar parses valid
 * ES6+ JavaScript without issue (TS is a superset of JS). Type annotations
 * simply won't appear in the IR because they don't exist in the source.
 *
 * Why a separate pack: so that framework packs can target the
 * javascript-modern language (React-Redux-RealWorld, jquery-ui, Vue/Angular
 * pre-TS) cleanly.
 */
import { extractTypeScriptIR } from '../typescript';
import type { SourceFileIR } from '../../languageIR';

/**
 * Parse a JavaScript source. For .jsx files we must use the TSX grammar
 * (which supports JSX); for .js we pretend it's .ts so the TS grammar handles
 * it. Bare .mjs / .cjs are treated as .js.
 */
export function extractJavaScriptIR(filePath: string, sourceCode: string): SourceFileIR | null {
  // Rewrite the path suffix so the underlying parseFile selects the right grammar.
  let adjustedPath = filePath;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jsx')) adjustedPath = filePath.replace(/\.jsx$/i, '.tsx');
  else if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    adjustedPath = filePath.replace(/\.(mjs|cjs|js)$/i, '.ts');
  }
  const ir = extractTypeScriptIR(adjustedPath, sourceCode);
  if (!ir) return null;
  // Restore the original file path + override language tag so downstream
  // adapters can dispatch precisely.
  return { ...ir, filePath, language: 'javascript' };
}
