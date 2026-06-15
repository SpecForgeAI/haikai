/**
 * C Language Extractor (c-classic: C89/C99; c-modern: C11/C17/C23).
 *
 * Captures:
 *   struct Foo { ... };         → ClassIR
 *   typedef struct { ... } Bar; → ClassIR
 *   function declarations       → FunctionIR (top-level)
 *   #include <...> / "..."      → ImportIR
 *
 * C has no OO; everything is functions + structs. The adapter (if any)
 * interprets: Linux kernel patterns use struct file_operations etc. as
 * interface-ish contracts.
 */
import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = loadTreeSitterGrammar('tree-sitter-c', () => require('tree-sitter-c'));
import type {
  SourceFileIR, ClassIR, FunctionIR, FieldIR, ParameterIR, AnnotationIR, ImportIR,
} from '../../languageIR';

type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;
function getParser() { if (!parser) { parser = new Parser(); parser.setLanguage(C); } return parser!; }

function safe(n: SyntaxNode | null | undefined): string { if (!n) return ''; try { return n.text || ''; } catch { return ''; } }
function findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  if (node.type === type) out.push(node);
  for (let i = 0; i < node.childCount; i++) { const c = node.child(i); if (c) out.push(...findNodesByType(c, type)); }
  return out;
}

function extractStruct(node: SyntaxNode): ClassIR | null {
  // struct_specifier has a 'name' field (optional) and 'body' field (field_declaration_list)
  const nameN = node.childForFieldName('name');
  const bodyN = node.childForFieldName('body');
  if (!nameN && !bodyN) return null;
  const name = nameN ? safe(nameN) : '(anonymous)';
  const fields: FieldIR[] = [];
  if (bodyN) {
    for (const fd of findNodesByType(bodyN, 'field_declaration')) {
      const typeN = fd.childForFieldName('type');
      // field_identifier children
      for (let i = 0; i < fd.namedChildCount; i++) {
        const c = fd.namedChild(i);
        if (!c) continue;
        if (c.type === 'field_identifier' || c.type === 'identifier') {
          fields.push({ name: safe(c), type: typeN ? safe(typeN) : 'unknown', annotations: [], modifiers: [], line: fd.startPosition.row });
        }
      }
    }
  }
  return { name, annotations: [], extends: null, implements: [], isInterface: false, isAbstract: false, modifiers: [], fields, methods: [], line: node.startPosition.row };
}

function extractFunction(node: SyntaxNode): FunctionIR | null {
  // function_definition fields: type, declarator (→ function_declarator), body
  const declN = node.childForFieldName('declarator');
  if (!declN) return null;
  // function_declarator has name (identifier) + parameters (parameter_list)
  const nameCandidates = findNodesByType(declN, 'identifier');
  if (nameCandidates.length === 0) return null;
  const name = safe(nameCandidates[0]);
  const typeN = node.childForFieldName('type');
  const returnType = typeN ? safe(typeN) : 'void';
  const paramsN = findNodesByType(declN, 'parameter_list')[0];
  const parameters: ParameterIR[] = [];
  if (paramsN) {
    for (const p of findNodesByType(paramsN, 'parameter_declaration')) {
      const pType = p.childForFieldName('type');
      const pDecl = p.childForFieldName('declarator');
      const pName = pDecl ? findNodesByType(pDecl, 'identifier')[0] : null;
      if (pName) parameters.push({ name: safe(pName), type: pType ? safe(pType) : 'int', annotations: [] });
    }
  }
  return {
    name, returnType, parameters, annotations: [], modifiers: ['export'],
    line: node.startPosition.row, calls: [],
  };
}

function extractIncludes(root: SyntaxNode): ImportIR[] {
  const out: ImportIR[] = [];
  for (const inc of findNodesByType(root, 'preproc_include')) {
    const pathN = inc.childForFieldName('path');
    if (!pathN) continue;
    const path = safe(pathN).replace(/^[<"]|[>"]$/g, '');
    out.push({ path, names: [] });
  }
  return out;
}

export function extractCIR(filePath: string, sourceCode: string): SourceFileIR | null {
  let tree: Tree | null = null;
  try { tree = getParser().parse(sourceCode); } catch { return null; }
  const root = tree.rootNode;
  const classes: ClassIR[] = [];
  for (const s of findNodesByType(root, 'struct_specifier')) {
    const cls = extractStruct(s);
    if (cls && cls.name !== '(anonymous)') classes.push(cls);
  }
  const functions: FunctionIR[] = [];
  for (const fd of findNodesByType(root, 'function_definition')) {
    const fn = extractFunction(fd);
    if (fn) functions.push(fn);
  }
  return { filePath, language: 'c', packageOrNamespace: null, imports: extractIncludes(root), classes, functions };
}
