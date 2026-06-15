/**
 * Ruby Language Extractor (ruby-modern — 1.9 onwards).
 *
 * Captures Ruby classes, modules, methods, and "macro calls" in class bodies
 * (has_many, belongs_to, validates, etc.). Rails relies heavily on these
 * declarative macros — the adapter inspects them.
 *
 * Ruby has no decorators in the Python/TS sense; the closest analog is the
 * macro-call-in-class-body pattern. We store those as synthetic AnnotationIR
 * entries on a "meta" pseudo-field so Rails adapter can query them.
 */
import { parseRubyFile, type Tree, type SyntaxNode } from './parser';
import type {
  SourceFileIR, ClassIR, FunctionIR, FieldIR, ParameterIR, AnnotationIR, ImportIR,
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

function extractClassMacros(bodyNode: SyntaxNode): AnnotationIR[] {
  // Walk only TOP-LEVEL children of the class body, looking for `call` nodes
  // whose receiver is implicit (ie. `has_many :posts`). These are Rails macros.
  const out: AnnotationIR[] = [];
  for (let i = 0; i < bodyNode.namedChildCount; i++) {
    const stmt = bodyNode.namedChild(i);
    if (!stmt) continue;
    if (stmt.type !== 'call' && stmt.type !== 'method_call' && stmt.type !== 'identifier') continue;
    // In tree-sitter-ruby, a bare macro `has_many :posts, through: :memberships` appears as call node.
    const methodN = stmt.type === 'call' ? stmt.childForFieldName('method') : stmt;
    const argsN = stmt.childForFieldName('arguments');
    const name = safe(methodN);
    if (!name) continue;
    const args: Record<string, string> = {};
    if (argsN) {
      for (let j = 0; j < argsN.namedChildCount; j++) {
        const a = argsN.namedChild(j);
        if (!a) continue;
        if (a.type === 'pair' || a.type === 'keyword_argument') {
          const k = a.childForFieldName('key');
          const v = a.childForFieldName('value');
          if (k) args[safe(k).replace(/^:/, '').replace(/:$/, '')] = safe(v);
        } else {
          args[`arg${j}`] = safe(a);
        }
      }
    }
    out.push({ name, args, line: stmt.startPosition.row });
  }
  return out;
}

function extractMethod(node: SyntaxNode): FunctionIR | null {
  // node: method or singleton_method
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const paramsN = node.childForFieldName('parameters');
  const parameters: ParameterIR[] = [];
  if (paramsN) {
    for (let i = 0; i < paramsN.namedChildCount; i++) {
      const p = paramsN.namedChild(i);
      if (!p) continue;
      parameters.push({ name: safe(p).replace(/[:=].*$/, '').trim(), type: 'unknown', annotations: [] });
    }
  }
  return {
    name: safe(nameN),
    returnType: 'unknown', // Ruby doesn't declare return types
    parameters,
    annotations: [],
    modifiers: ['export'], // Ruby has no visibility keyword for top-level methods
    line: node.startPosition.row,
    calls: [],
  };
}

function extractClass(node: SyntaxNode): ClassIR | null {
  // node: class
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const supN = node.childForFieldName('superclass');
  const bodyN = node.childForFieldName('body');

  const className = safe(nameN).replace(/^::/, '');
  let extendsName: string | null = null;
  if (supN) {
    // superclass node has one child: the identifier/scope_resolution
    const inner = supN.namedChild(0) || supN;
    extendsName = safe(inner).replace(/^::/, '');
  }

  const methods: FunctionIR[] = [];
  const classMacros: AnnotationIR[] = bodyN ? extractClassMacros(bodyN) : [];
  if (bodyN) {
    for (const m of findNodesByType(bodyN, 'method')) {
      const fn = extractMethod(m);
      if (fn) methods.push(fn);
    }
  }

  return {
    name: className,
    annotations: classMacros,
    extends: extendsName,
    implements: [],
    isInterface: false,
    isAbstract: false,
    modifiers: [],
    fields: [], // Ruby fields aren't declared; they come via attr_accessor macros (captured as annotations above)
    methods,
    line: node.startPosition.row,
  };
}

function extractRequires(root: SyntaxNode): ImportIR[] {
  const out: ImportIR[] = [];
  // Ruby imports take the form `require 'foo'` or `require_relative '../x'`
  for (const c of findNodesByType(root, 'call')) {
    const m = c.childForFieldName('method');
    if (!m) continue;
    const name = safe(m);
    if (name !== 'require' && name !== 'require_relative' && name !== 'autoload') continue;
    const args = c.childForFieldName('arguments');
    if (!args) continue;
    const first = args.namedChild(0);
    if (!first) continue;
    const path = safe(first).replace(/^['"]|['"]$/g, '');
    if (path) out.push({ path, names: [] });
  }
  return out;
}

export function extractRubyIR(filePath: string, sourceCode: string): SourceFileIR | null {
  const tree: Tree | null = parseRubyFile(sourceCode);
  if (!tree) return null;
  const root = tree.rootNode;
  const classes: ClassIR[] = [];
  for (const n of findNodesByType(root, 'class')) {
    const c = extractClass(n);
    if (c) classes.push(c);
  }
  // Top-level methods (rarely seen in Rails, but in plain Ruby lib files)
  const functions: FunctionIR[] = [];
  for (const n of findNodesByType(root, 'method')) {
    let p: SyntaxNode | null = n.parent;
    let inClassOrMethod = false;
    while (p) {
      if (p.type === 'class' || p.type === 'module' || p.type === 'method') { inClassOrMethod = true; break; }
      p = p.parent;
    }
    if (inClassOrMethod) continue;
    const fn = extractMethod(n);
    if (fn) functions.push(fn);
  }
  return {
    filePath,
    language: 'ruby',
    packageOrNamespace: null,
    imports: extractRequires(root),
    classes,
    functions,
  };
}
