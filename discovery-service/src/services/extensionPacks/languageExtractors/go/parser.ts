import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Go = loadTreeSitterGrammar('tree-sitter-go', () => require('tree-sitter-go'));

export type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
export type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;
function getParser() { if (!parser) { parser = new Parser(); parser.setLanguage(Go); } return parser!; }

export function parseGoFile(src: string): Tree | null {
  try { return getParser().parse(src); }
  catch (err) { console.warn(`[GoParser] ${err instanceof Error ? err.message : String(err)}`); return null; }
}
