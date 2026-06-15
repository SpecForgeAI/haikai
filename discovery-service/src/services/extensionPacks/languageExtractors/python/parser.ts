/**
 * Python parser — wraps tree-sitter-python for the language extractor layer.
 */
import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Python = loadTreeSitterGrammar('tree-sitter-python', () => require('tree-sitter-python'));

export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
export type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;

function getParser(): InstanceType<typeof Parser> {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Python);
  }
  return parser;
}

export function parsePythonFile(sourceCode: string): Tree | null {
  try {
    return getParser().parse(sourceCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[PythonParser] parse failed: ${msg}`);
    return null;
  }
}
