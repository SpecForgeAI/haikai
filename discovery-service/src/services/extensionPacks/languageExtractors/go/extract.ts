/**
 * Go Language Extractor
 *
 * Captures:
 *   package X                 → packageOrNamespace
 *   import "foo/bar"          → imports
 *   type Foo struct { ... }   → ClassIR (isInterface=false)
 *   type Foo interface { ... }→ ClassIR (isInterface=true)
 *   func Foo(x int) string {} → FunctionIR (top-level)
 *   func (r *Recv) Foo()      → method on the Recv class
 *   struct tags `json:"..."`  → captured on FieldIR via annotations
 */
import { parseGoFile, type Tree, type SyntaxNode } from './parser';
import type {
  SourceFileIR, ClassIR, FunctionIR, FieldIR, ParameterIR, AnnotationIR, ImportIR, CallIR,
} from '../../languageIR';

function safe(n: SyntaxNode | null | undefined): string {
  if (!n) return '';
  try { return n.text || ''; } catch { return ''; }
}

function findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  if (node.type === type) out.push(node);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) out.push(...findNodesByType(c, type));
  }
  return out;
}

function extractStructTag(tagNode: SyntaxNode | null): AnnotationIR[] {
  // struct tag like `json:"name" validate:"required"` — parse into AnnotationIR.
  if (!tagNode) return [];
  const raw = safe(tagNode).replace(/^`|`$/g, '');
  const out: AnnotationIR[] = [];
  const tagRe = /(\w+):"([^"]*)"/g;
  let m;
  while ((m = tagRe.exec(raw)) !== null) {
    out.push({ name: m[1], args: { value: m[2] }, line: tagNode.startPosition.row });
  }
  return out;
}

function extractFieldsFromStruct(structNode: SyntaxNode): FieldIR[] {
  const out: FieldIR[] = [];
  // struct_type has a child field_declaration_list containing field_declaration
  const list = findNodesByType(structNode, 'field_declaration_list')[0];
  if (!list) return out;
  for (const fd of findNodesByType(list, 'field_declaration')) {
    const nameNodes: SyntaxNode[] = [];
    const typeN = fd.childForFieldName('type');
    const tagN = fd.childForFieldName('tag');
    // field_declaration can have multiple field_identifier names on the same line:
    // X, Y int
    for (let i = 0; i < fd.namedChildCount; i++) {
      const c = fd.namedChild(i);
      if (c && c.type === 'field_identifier') nameNodes.push(c);
    }
    const tags = extractStructTag(tagN);
    for (const nameN of nameNodes) {
      out.push({
        name: safe(nameN),
        type: typeN ? safe(typeN) : 'unknown',
        annotations: tags,
        modifiers: [],
        line: fd.startPosition.row,
      });
    }
  }
  return out;
}

function extractParameters(paramsNode: SyntaxNode | null): ParameterIR[] {
  if (!paramsNode) return [];
  const params: ParameterIR[] = [];
  for (const p of findNodesByType(paramsNode, 'parameter_declaration')) {
    const typeN = p.childForFieldName('type');
    const typeStr = typeN ? safe(typeN) : 'unknown';
    // multiple names possible: `a, b int`
    const names: SyntaxNode[] = [];
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i);
      if (c && c.type === 'identifier') names.push(c);
    }
    if (names.length === 0) names.push(p); // fallback
    for (const n of names) {
      params.push({ name: safe(n), type: typeStr, annotations: [] });
    }
  }
  return params;
}

function extractFunction(node: SyntaxNode, fileImports: ImportIR[]): FunctionIR | null {
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const paramsN = node.childForFieldName('parameters');
  const returnN = node.childForFieldName('result');
  const returnType = returnN ? safe(returnN) : 'void';
  const modifiers: string[] = [];
  const name = safe(nameN);
  // Go: exported if first letter is uppercase
  if (/^[A-Z]/.test(name)) modifiers.push('export');
  // Capture call expressions inside the body
  const body = node.childForFieldName('body');
  const calls: CallIR[] = [];
  if (body) {
    for (const c of findNodesByType(body, 'call_expression')) {
      const fnN = c.childForFieldName('function');
      const argsN = c.childForFieldName('arguments');
      const callee = safe(fnN);
      const args: string[] = [];
      if (argsN) {
        for (let i = 0; i < argsN.namedChildCount; i++) {
          const a = argsN.namedChild(i);
          if (a) args.push(safe(a));
        }
      }
      calls.push({ callee, args, typeArgs: null, line: c.startPosition.row });
    }
  }
  return {
    name,
    returnType,
    parameters: extractParameters(paramsN),
    annotations: [],
    modifiers,
    line: node.startPosition.row,
    calls,
  };
}

function extractPackage(root: SyntaxNode): string | null {
  const pkg = findNodesByType(root, 'package_clause')[0];
  if (!pkg) return null;
  const name = findNodesByType(pkg, 'package_identifier')[0];
  return name ? safe(name) : null;
}

function extractImports(root: SyntaxNode): ImportIR[] {
  const out: ImportIR[] = [];
  for (const imp of findNodesByType(root, 'import_declaration')) {
    const specs = findNodesByType(imp, 'import_spec');
    for (const s of specs) {
      const path = findNodesByType(s, 'interpreted_string_literal')[0];
      if (!path) continue;
      const p = safe(path).replace(/^"|"$/g, '');
      out.push({ path: p, names: [p.split('/').pop() || p] });
    }
  }
  return out;
}

export function extractGoIR(filePath: string, sourceCode: string): SourceFileIR | null {
  const tree: Tree | null = parseGoFile(sourceCode);
  if (!tree) return null;
  const root = tree.rootNode;
  const imports = extractImports(root);
  const classes: ClassIR[] = [];
  const functions: FunctionIR[] = [];

  // type X struct {...} / type X interface {...}
  for (const td of findNodesByType(root, 'type_declaration')) {
    for (const ts of findNodesByType(td, 'type_spec')) {
      const nameN = ts.childForFieldName('name');
      const typeN = ts.childForFieldName('type');
      if (!nameN || !typeN) continue;
      const isInterface = typeN.type === 'interface_type';
      const isStruct = typeN.type === 'struct_type';
      if (!isInterface && !isStruct) continue;
      const cls: ClassIR = {
        name: safe(nameN),
        annotations: [],
        extends: null,
        implements: [],
        isInterface,
        isAbstract: false,
        modifiers: /^[A-Z]/.test(safe(nameN)) ? ['export'] : [],
        fields: isStruct ? extractFieldsFromStruct(typeN) : [],
        methods: [],
        line: ts.startPosition.row,
      };
      classes.push(cls);
    }
  }

  // Function declarations — split into methods (w/ receiver) and top-level fns
  for (const fd of findNodesByType(root, 'function_declaration')) {
    const fn = extractFunction(fd, imports);
    if (fn) functions.push(fn);
  }
  for (const md of findNodesByType(root, 'method_declaration')) {
    const receiverN = md.childForFieldName('receiver');
    const fn = extractFunction(md, imports);
    if (!fn || !receiverN) continue;
    // Receiver: `(r *Foo)` — find the type identifier
    const typeNodes = [
      ...findNodesByType(receiverN, 'type_identifier'),
      ...findNodesByType(receiverN, 'pointer_type'),
    ];
    let recvType = typeNodes.find((n) => n.type === 'type_identifier');
    if (!recvType) {
      const pt = typeNodes.find((n) => n.type === 'pointer_type');
      if (pt) recvType = findNodesByType(pt, 'type_identifier')[0];
    }
    const recvName = recvType ? safe(recvType) : null;
    if (!recvName) { functions.push(fn); continue; }
    const cls = classes.find((c) => c.name === recvName);
    if (cls) cls.methods.push(fn); else functions.push(fn);
  }

  return {
    filePath,
    language: 'go',
    packageOrNamespace: extractPackage(root),
    imports,
    classes,
    functions,
  };
}
