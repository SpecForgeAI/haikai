import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PHP = loadTreeSitterGrammar('tree-sitter-php', () => require('tree-sitter-php'));

export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
export type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;

function getParser(): InstanceType<typeof Parser> {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(PHP.php || PHP);
  }
  return parser;
}

export function parsePhpFile(sourceCode: string): Tree | null {
  try {
    return getParser().parse(sourceCode);
  } catch (err) {
    console.warn(`[PhpParser] parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
