/**
 * TypeScript/TSX Parser Module
 *
 * Provides tree-sitter-based TypeScript and TSX source code parsing for the
 * React/TypeScript Extension Pack. Uses the native tree-sitter and
 * tree-sitter-typescript packages for robust AST-based parsing.
 *
 * Manages TWO grammar variants:
 * - TypeScript grammar for `.ts` files
 * - TSX grammar for `.tsx` files (includes JSX support)
 *
 * Falls back gracefully if parsing fails for a specific file:
 * logs a warning and returns null.
 *
 * Spec: React/TypeScript Extension Pack
 * - Task Group 2: tree-sitter TypeScript/TSX Integration
 */

import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TreeSitterTypeScript = loadTreeSitterGrammar('tree-sitter-typescript', () => require('tree-sitter-typescript'));

const TypeScriptGrammar = TreeSitterTypeScript.typescript;
const TsxGrammar = TreeSitterTypeScript.tsx;

/** tree-sitter Tree type (re-exported for consumers) */
export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;

/** tree-sitter SyntaxNode type (re-exported for consumers) */
export type SyntaxNode = Tree['rootNode'];

// Singleton parser instances -- one per grammar
let tsParser: InstanceType<typeof Parser> | null = null;
let tsxParser: InstanceType<typeof Parser> | null = null;

/**
 * Returns the singleton tree-sitter parser instance initialized
 * with the TypeScript grammar (for .ts files).
 */
function getTsParser(): InstanceType<typeof Parser> {
  if (!tsParser) {
    tsParser = new Parser();
    tsParser.setLanguage(TypeScriptGrammar);
  }
  return tsParser;
}

/**
 * Returns the singleton tree-sitter parser instance initialized
 * with the TSX grammar (for .tsx files).
 */
function getTsxParser(): InstanceType<typeof Parser> {
  if (!tsxParser) {
    tsxParser = new Parser();
    tsxParser.setLanguage(TsxGrammar);
  }
  return tsxParser;
}

/**
 * Parses a TypeScript source code string (.ts file) into a tree-sitter syntax tree.
 *
 * Uses the TypeScript grammar (no JSX support).
 *
 * @param sourceCode - The TypeScript source code to parse
 * @returns The parsed syntax tree, or null if parsing failed
 */
export function parseTsFile(sourceCode: string): Tree | null {
  try {
    const parser = getTsParser();
    const tree = parser.parse(sourceCode);
    return tree;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[TsxParser] Failed to parse TypeScript source: ${message}`);
    return null;
  }
}

/**
 * Parses a TSX source code string (.tsx file) into a tree-sitter syntax tree.
 *
 * Uses the TSX grammar (includes JSX support).
 *
 * @param sourceCode - The TSX source code to parse
 * @returns The parsed syntax tree, or null if parsing failed
 */
export function parseTsxFile(sourceCode: string): Tree | null {
  try {
    const parser = getTsxParser();
    const tree = parser.parse(sourceCode);
    return tree;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[TsxParser] Failed to parse TSX source: ${message}`);
    return null;
  }
}

/**
 * Convenience function that selects the appropriate grammar based on file extension.
 *
 * - `.tsx` files are parsed with the TSX grammar
 * - `.ts` files are parsed with the TypeScript grammar
 * - Other extensions default to the TypeScript grammar
 *
 * @param sourceCode - The source code to parse
 * @param filePath - The file path (used to determine grammar selection)
 * @returns The parsed syntax tree, or null if parsing failed
 */
export function parseFile(sourceCode: string, filePath: string): Tree | null {
  if (filePath.endsWith('.tsx')) {
    return parseTsxFile(sourceCode);
  }
  return parseTsFile(sourceCode);
}

/**
 * Disposes the singleton parser instances.
 * Primarily used for testing cleanup.
 */
export function disposeParser(): void {
  tsParser = null;
  tsxParser = null;
}
