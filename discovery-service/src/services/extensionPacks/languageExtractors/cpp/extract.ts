/**
 * C++ Language Extractor (cpp-legacy: 98/03; cpp-modern: 11/14/17; cpp-contemporary: 20/23).
 *
 * Captures classes (class_specifier + struct_specifier), member functions,
 * member variables, function_definition (top-level).
 */
import { loadTreeSitter, loadTreeSitterGrammar } from '../treeSitterBinding';

const Parser = loadTreeSitter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Cpp = loadTreeSitterGrammar('tree-sitter-cpp', () => require('tree-sitter-cpp'));
import type {
  SourceFileIR, ClassIR, FunctionIR, FieldIR, ParameterIR, AnnotationIR, ImportIR,
} from '../../languageIR';

type Tree = ReturnType<InstanceType<typeof Parser>['parse']>;
type SyntaxNode = Tree['rootNode'];

let parser: InstanceType<typeof Parser> | null = null;
function getParser() { if (!parser) { parser = new Parser(); parser.setLanguage(Cpp); } return parser!; }

function safe(n: SyntaxNode | null | undefined): string { if (!n) return ''; try { return n.text || ''; } catch { return ''; } }
function findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  if (node.type === type) out.push(node);
  for (let i = 0; i < node.childCount; i++) { const c = node.child(i); if (c) out.push(...findNodesByType(c, type)); }
  return out;
}

function extractParams(paramsNode: SyntaxNode | null): ParameterIR[] {
  if (!paramsNode) return [];
  const out: ParameterIR[] = [];
  for (const p of findNodesByType(paramsNode, 'parameter_declaration')) {
    const pType = p.childForFieldName('type');
    const pDecl = p.childForFieldName('declarator');
    const pName = pDecl ? findNodesByType(pDecl, 'identifier')[0] : null;
    if (pName) out.push({ name: safe(pName), type: pType ? safe(pType) : 'unknown', annotations: [] });
  }
  return out;
}

function extractFunction(node: SyntaxNode): FunctionIR | null {
  const declN = node.childForFieldName('declarator');
  if (!declN) return null;
  const idCandidates = findNodesByType(declN, 'identifier');
  if (idCandidates.length === 0) return null;
  const name = safe(idCandidates[0]);
  const typeN = node.childForFieldName('type');
  const returnType = typeN ? safe(typeN) : 'void';
  const paramsN = findNodesByType(declN, 'parameter_list')[0];
  return { name, returnType, parameters: extractParams(paramsN), annotations: [], modifiers: ['export'], line: node.startPosition.row, calls: [] };
}

function extractClass(node: SyntaxNode): ClassIR | null {
  // class_specifier / struct_specifier
  // childForFieldName('name') can return null on error-recovered nodes, so
  // fall back to the first type_identifier child.
  let nameN = node.childForFieldName('name');
  if (!nameN) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === 'type_identifier') { nameN = c; break; }
    }
  }
  if (!nameN) return null;
  const bodyN = node.childForFieldName('body');
  const fields: FieldIR[] = [];
  const methods: FunctionIR[] = [];
  let extendsName: string | null = null;

  // Base class clause — can be type_identifier OR qualified_identifier.
  // Take the LAST type_identifier in the chain so ns::foo::Bar → Bar.
  const baseClauseNodes = findNodesByType(node, 'base_class_clause');
  if (baseClauseNodes.length > 0) {
    const typeIds = findNodesByType(baseClauseNodes[0], 'type_identifier');
    if (typeIds.length > 0) extendsName = safe(typeIds[typeIds.length - 1]);
  }

  if (bodyN) {
    for (const fd of findNodesByType(bodyN, 'field_declaration')) {
      const typeN = fd.childForFieldName('type');
      // Could be a field OR a method declaration
      const declN = fd.childForFieldName('declarator');
      if (!declN) continue;
      if (declN.type === 'function_declarator') {
        // Method without body — method declaration
        const idCandidates = findNodesByType(declN, 'identifier');
        if (idCandidates.length === 0) continue;
        methods.push({
          name: safe(idCandidates[0]),
          returnType: typeN ? safe(typeN) : 'void',
          parameters: extractParams(findNodesByType(declN, 'parameter_list')[0] || null),
          annotations: [], modifiers: [], line: fd.startPosition.row, calls: [],
        });
      } else if (declN.type === 'field_identifier' || declN.type === 'identifier') {
        fields.push({ name: safe(declN), type: typeN ? safe(typeN) : 'unknown', annotations: [], modifiers: [], line: fd.startPosition.row });
      }
    }
    // Method definitions with body
    for (const fdef of findNodesByType(bodyN, 'function_definition')) {
      const fn = extractFunction(fdef);
      if (fn) methods.push(fn);
    }
  }

  return {
    name: safe(nameN),
    annotations: [],
    extends: extendsName,
    implements: [],
    isInterface: false,
    isAbstract: false,
    modifiers: [],
    fields, methods, line: node.startPosition.row,
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

export function extractCppIR(filePath: string, sourceCode: string): SourceFileIR | null {
  let tree: Tree | null = null;
  try { tree = getParser().parse(sourceCode); } catch { return null; }
  const root = tree.rootNode;
  const classes: ClassIR[] = [];
  const seenClassNames = new Set<string>();
  for (const c of findNodesByType(root, 'class_specifier')) {
    const cls = extractClass(c);
    if (cls && !seenClassNames.has(cls.name)) { classes.push(cls); seenClassNames.add(cls.name); }
  }
  for (const s of findNodesByType(root, 'struct_specifier')) {
    const cls = extractClass(s);
    // Skip anonymous structs and deduplicate
    if (cls && cls.name && !cls.name.startsWith('(') && !seenClassNames.has(cls.name)) {
      classes.push(cls);
      seenClassNames.add(cls.name);
    }
  }
  const functions: FunctionIR[] = [];
  for (const fd of findNodesByType(root, 'function_definition')) {
    // Skip function definitions that are members of a class (we already walked those)
    let p: SyntaxNode | null = fd.parent;
    let inClass = false;
    while (p) { if (p.type === 'class_specifier' || p.type === 'struct_specifier') { inClass = true; break; } p = p.parent; }
    if (inClass) continue;
    const fn = extractFunction(fd);
    if (fn) functions.push(fn);
  }
  return { filePath, language: 'cpp', packageOrNamespace: null, imports: extractIncludes(root), classes, functions };
}
