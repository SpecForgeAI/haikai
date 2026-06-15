import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CSharp = loadTreeSitterGrammar('tree-sitter-c-sharp', () => require('tree-sitter-c-sharp'));

export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
export type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;

function getParser(): InstanceType<typeof Parser> {
  if (!parser) { parser = new Parser(); parser.setLanguage(CSharp); }
  return parser;
}

export function parseCSharpFile(source: string): Tree | null {
  try { return getParser().parse(source); }
  catch (err) {
    console.warn(`[CSharpParser] parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
