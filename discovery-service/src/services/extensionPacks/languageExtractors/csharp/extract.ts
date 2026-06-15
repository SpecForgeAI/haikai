/**
 * C# Language Extractor (csharp-modern, .NET Core/5+/6+/7+/8+).
 *
 * Captures classes, methods, properties, fields, namespaces, using directives,
 * and C# attributes `[ApiController]`, `[HttpGet("/x")]`, `[Route(...)]` etc.
 * as AnnotationIR entries so adapters (asp-net-core, asp-net-framework, etc.)
 * can match on them.
 */
import { parseCSharpFile, type Tree, type SyntaxNode } from './parser';
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

function extractAttributesFrom(node: SyntaxNode): AnnotationIR[] {
  const out: AnnotationIR[] = [];
  // In C# AST, attribute_list is a child of the declaration node
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c || c.type !== 'attribute_list') continue;
    const attrs = findNodesByType(c, 'attribute');
    for (const a of attrs) {
      const nameN = a.childForFieldName('name') || a.namedChild(0);
      const argsN = a.childForFieldName('arguments') || findNodesByType(a, 'attribute_argument_list')[0];
      const args: Record<string, string> = {};
      if (argsN) {
        for (let j = 0; j < argsN.namedChildCount; j++) {
          const arg = argsN.namedChild(j);
          if (arg) args[`arg${j}`] = safe(arg);
        }
      }
      out.push({ name: safe(nameN), args, line: a.startPosition.row });
    }
  }
  return out;
}

function extractMethod(node: SyntaxNode): FunctionIR | null {
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const paramsN = node.childForFieldName('parameters');
  // tree-sitter-c-sharp names the return-type field 'returns' (not 'type').
  const returnTypeN = node.childForFieldName('returns') || node.childForFieldName('type');
  const returnType = returnTypeN ? safe(returnTypeN) : 'void';
  const modifiers: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === 'modifier') modifiers.push(safe(c));
  }
  const parameters: ParameterIR[] = [];
  if (paramsN) {
    const paramNodes = findNodesByType(paramsN, 'parameter');
    for (const p of paramNodes) {
      const pname = p.childForFieldName('name');
      const ptype = p.childForFieldName('type');
      parameters.push({
        name: safe(pname),
        type: ptype ? safe(ptype) : 'object',
        annotations: extractAttributesFrom(p),
      });
    }
  }
  return {
    name: safe(nameN),
    returnType,
    parameters,
    annotations: extractAttributesFrom(node),
    modifiers,
    line: node.startPosition.row,
    calls: [], // skipped for now — adapters don't rely on C# call-site extraction yet
  };
}

function extractFields(bodyNode: SyntaxNode): FieldIR[] {
  const out: FieldIR[] = [];
  // C# properties live in property_declaration; fields live in field_declaration.
  // Both carry attribute_list + type + variable_declaration.
  const propNodes = findNodesByType(bodyNode, 'property_declaration');
  for (const pn of propNodes) {
    const nameN = pn.childForFieldName('name');
    const typeN = pn.childForFieldName('type');
    if (!nameN) continue;
    out.push({
      name: safe(nameN),
      type: typeN ? safe(typeN) : 'object',
      annotations: extractAttributesFrom(pn),
      modifiers: [],
      line: pn.startPosition.row,
    });
  }
  const fieldNodes = findNodesByType(bodyNode, 'field_declaration');
  for (const fn of fieldNodes) {
    const decl = findNodesByType(fn, 'variable_declarator')[0];
    const nameN = decl ? (decl.childForFieldName('name') || decl.namedChild(0)) : null;
    const typeN = fn.childForFieldName('type');
    if (!nameN) continue;
    out.push({
      name: safe(nameN),
      type: typeN ? safe(typeN) : 'object',
      annotations: extractAttributesFrom(fn),
      modifiers: [],
      line: fn.startPosition.row,
    });
  }
  return out;
}

function extractClass(node: SyntaxNode): ClassIR | null {
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const bodyN = node.childForFieldName('body');
  const fields = bodyN ? extractFields(bodyN) : [];
  const methods: FunctionIR[] = [];
  if (bodyN) {
    for (const m of findNodesByType(bodyN, 'method_declaration')) {
      const fn = extractMethod(m);
      if (fn) methods.push(fn);
    }
    for (const m of findNodesByType(bodyN, 'constructor_declaration')) {
      const fn = extractMethod(m);
      if (fn) methods.push(fn);
    }
  }
  // base list: class Foo : BaseType, IInterface, ...
  let extendsName: string | null = null;
  const implementsList: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c || c.type !== 'base_list') continue;
    for (let j = 0; j < c.namedChildCount; j++) {
      const b = c.namedChild(j);
      if (!b) continue;
      const t = safe(b).trim();
      if (!extendsName) extendsName = t;
      else implementsList.push(t);
    }
  }
  return {
    name: safe(nameN),
    annotations: extractAttributesFrom(node),
    extends: extendsName,
    implements: implementsList,
    isInterface: node.type === 'interface_declaration',
    isAbstract: false,
    modifiers: [],
    fields,
    methods,
    line: node.startPosition.row,
  };
}

function extractNamespace(root: SyntaxNode): string | null {
  const ns = findNodesByType(root, 'namespace_declaration')[0]
    || findNodesByType(root, 'file_scoped_namespace_declaration')[0];
  if (!ns) return null;
  const n = ns.childForFieldName('name');
  return n ? safe(n) : null;
}

function extractImports(root: SyntaxNode): ImportIR[] {
  const out: ImportIR[] = [];
  for (const u of findNodesByType(root, 'using_directive')) {
    const n = u.childForFieldName('name') || u.namedChild(0);
    if (!n) continue;
    const path = safe(n);
    out.push({ path, names: [path.split('.').pop() || path] });
  }
  return out;
}

export function extractCSharpIR(filePath: string, sourceCode: string): SourceFileIR | null {
  const tree: Tree | null = parseCSharpFile(sourceCode);
  if (!tree) return null;
  const root = tree.rootNode;

  const classes: ClassIR[] = [];
  for (const n of findNodesByType(root, 'class_declaration')) {
    const c = extractClass(n);
    if (c) classes.push(c);
  }
  for (const n of findNodesByType(root, 'interface_declaration')) {
    const c = extractClass(n);
    if (c) classes.push(c);
  }
  for (const n of findNodesByType(root, 'record_declaration')) {
    const c = extractClass(n);
    if (c) classes.push(c);
  }

  return {
    filePath,
    language: 'csharp',
    packageOrNamespace: extractNamespace(root),
    imports: extractImports(root),
    classes,
    functions: [], // C# doesn't have top-level fns outside classes (mostly)
  };
}
