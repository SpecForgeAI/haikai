/**
 * Java Parser Module
 *
 * Provides tree-sitter-based Java source code parsing for the
 * Java/Spring Boot Extension Pack. Uses the native tree-sitter
 * and tree-sitter-java packages for robust AST-based parsing.
 *
 * The parser handles multi-line annotations, nested annotation arguments,
 * complex generics, and Lombok-generated patterns correctly.
 *
 * Falls back gracefully if parsing fails for a specific file:
 * logs a warning and returns null.
 *
 * Spec: Java/Spring Boot Extension Pack
 * - Task Group 2: tree-sitter Integration
 */

import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Java = loadTreeSitterGrammar('tree-sitter-java', () => require('tree-sitter-java'));

/** tree-sitter Tree type (re-exported for consumers) */
export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;

/** tree-sitter SyntaxNode type (re-exported for consumers) */
export type SyntaxNode = Tree['rootNode'];

// Singleton parser instance
let parser: InstanceType<typeof Parser> | null = null;

/**
 * Returns the singleton tree-sitter parser instance, initialized
 * with the Java language grammar.
 */
function getParser(): InstanceType<typeof Parser> {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Java);
  }
  return parser;
}

/**
 * Parses a Java source code string into a tree-sitter syntax tree.
 *
 * @param sourceCode - The Java source code to parse
 * @returns The parsed syntax tree, or null if parsing failed
 */
export function parseJavaFile(sourceCode: string): Tree | null {
  try {
    const p = getParser();
    // Bug 6 fix (2026-04-21): tree-sitter's Node binding defaults to a
    // ~32KB buffer, throwing "Invalid argument" on files larger than that.
    // Fat services like `ScenarioDetailService` (~50KB) were silently
    // dropped from the IR. Size the buffer to the source length plus a
    // 16KB cushion for AST scratch space — cheap for small files, critical
    // for large ones.
    const bufferSize = sourceCode.length + 16 * 1024;
    const tree = p.parse(sourceCode, null, { bufferSize });
    return tree;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[JavaParser] Failed to parse Java source: ${message}`);
    return null;
  }
}

/**
 * Disposes the singleton parser instance.
 * Primarily used for testing cleanup.
 */
export function disposeParser(): void {
  parser = null;
}
