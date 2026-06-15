import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Ruby = loadTreeSitterGrammar('tree-sitter-ruby', () => require('tree-sitter-ruby'));

export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
export type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;

function getParser(): InstanceType<typeof Parser> {
  if (!parser) { parser = new Parser(); parser.setLanguage(Ruby); }
  return parser;
}

export function parseRubyFile(source: string): Tree | null {
  try { return getParser().parse(source); }
  catch (err) {
    console.warn(`[RubyParser] parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
