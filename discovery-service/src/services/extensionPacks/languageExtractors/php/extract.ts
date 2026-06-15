/**
 * PHP Language Extractor (PHP 7+/8+, modern).
 *
 * Emits SourceFileIR capturing:
 *   namespace declaration             → packageOrNamespace
 *   use X\Y\Z / use X as Y             → imports
 *   class Foo extends B implements I  → ClassIR
 *   property declarations              → ClassIR.fields
 *   function declarations (method + top-level)
 *   PHP attributes `#[Route('/api')]`  → AnnotationIR
 *   call expressions inside function bodies → CallIR (for WordPress hook
 *     detection, Laravel route registrations, etc.)
 */
import { parsePhpFile, type Tree, type SyntaxNode } from './parser';
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

// --- attributes (PHP 8+): `#[Foo('bar')]` or `#[Route('/')] ----------------

function extractAttributesFrom(node: SyntaxNode): AnnotationIR[] {
  const out: AnnotationIR[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type !== 'attribute_list') continue;
    // attribute_list → attribute_group → attribute
    const attrs = findNodesByType(c, 'attribute');
    for (const a of attrs) {
      // The 'name' is stored as the FIRST named child (not via a field).
      // Arguments are stored as a child named 'arguments' (or via the
      // `parameters` field, depending on tree-sitter-php version).
      let nameNode: SyntaxNode | null = null;
      let argsNode: SyntaxNode | null = null;
      for (let j = 0; j < a.namedChildCount; j++) {
        const child = a.namedChild(j);
        if (!child) continue;
        if (child.type === 'name' || child.type === 'qualified_name') nameNode = child;
        else if (child.type === 'arguments') argsNode = child;
      }
      if (!argsNode) {
        argsNode = a.childForFieldName('arguments') || a.childForFieldName('parameters');
      }
      const args: Record<string, string> = {};
      if (argsNode) {
        // arguments → argument / named_argument children
        for (let j = 0; j < argsNode.namedChildCount; j++) {
          const arg = argsNode.namedChild(j);
          if (!arg) continue;
          if (arg.type === 'argument') {
            // named vs positional
            const nameChild = arg.childForFieldName('name');
            const valueChild = arg.namedChild(arg.namedChildCount - 1);
            if (nameChild) {
              args[safe(nameChild).replace(/:$/, '').trim()] = safe(valueChild);
            } else {
              args[`arg${j}`] = safe(valueChild || arg);
            }
          } else {
            args[`arg${j}`] = safe(arg);
          }
        }
      }
      out.push({ name: safe(nameNode), args, line: a.startPosition.row });
    }
  }
  return out;
}

// --- function / method ----------------------------------------------------

function extractFunction(node: SyntaxNode): FunctionIR | null {
  // node can be function_definition or method_declaration
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const paramsN = node.childForFieldName('parameters');
  const returnTypeN = node.childForFieldName('return_type');
  const returnType = returnTypeN ? safe(returnTypeN) : 'unknown';
  const modifiers: string[] = [];
  // Capture visibility modifiers (public/private/protected/static)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === 'visibility_modifier') modifiers.push(safe(c));
    if (c.type === 'static_modifier') modifiers.push('static');
  }
  if (node.type === 'function_definition') modifiers.push('export'); // top-level functions are implicitly public
  const parameters: ParameterIR[] = [];
  if (paramsN) {
    for (let i = 0; i < paramsN.namedChildCount; i++) {
      const p = paramsN.namedChild(i);
      if (!p) continue;
      const nN = p.childForFieldName('name');
      const tN = p.childForFieldName('type');
      if (nN) {
        parameters.push({ name: safe(nN), type: tN ? safe(tN) : 'mixed', annotations: [] });
      }
    }
  }
  return {
    name: safe(nameN),
    returnType,
    parameters,
    annotations: extractAttributesFrom(node),
    modifiers,
    line: node.startPosition.row,
    calls: extractCallsInFunctionBody(node),
  };
}

function extractCallsInFunctionBody(fnNode: SyntaxNode): CallIR[] {
  const body = fnNode.childForFieldName('body');
  if (!body) return [];
  const calls: CallIR[] = [];
  const callNodes = findNodesByType(body, 'function_call_expression');
  for (const c of callNodes) {
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
  // Also include method calls like `$this->foo()` or `Obj::bar()`
  const memberCalls = [
    ...findNodesByType(body, 'member_call_expression'),
    ...findNodesByType(body, 'scoped_call_expression'),
  ];
  for (const c of memberCalls) {
    const objN = c.childForFieldName('object') || c.childForFieldName('scope');
    const nameN = c.childForFieldName('name');
    const argsN = c.childForFieldName('arguments');
    const callee = `${safe(objN)}.${safe(nameN)}`;
    const args: string[] = [];
    if (argsN) {
      for (let i = 0; i < argsN.namedChildCount; i++) {
        const a = argsN.namedChild(i);
        if (a) args.push(safe(a));
      }
    }
    calls.push({ callee, args, typeArgs: null, line: c.startPosition.row });
  }
  return calls;
}

// --- class / field -------------------------------------------------------

function extractClass(node: SyntaxNode): ClassIR | null {
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const bodyN = node.childForFieldName('body');
  const fields: FieldIR[] = [];
  const methods: FunctionIR[] = [];
  let extendsName: string | null = null;
  const implementsList: string[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === 'base_clause') {
      // PHP: extends X — may be one or more (PHP doesn't allow multi-extends for classes, but keep array)
      for (let j = 0; j < c.namedChildCount; j++) {
        const x = c.namedChild(j);
        if (x) { extendsName = safe(x).trim(); break; }
      }
    } else if (c.type === 'class_interface_clause') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const x = c.namedChild(j);
        if (x) implementsList.push(safe(x).trim());
      }
    }
  }

  if (bodyN) {
    // Properties + methods
    const propNodes = findNodesByType(bodyN, 'property_declaration');
    for (const pn of propNodes) {
      // Collect property_element
      const elems = findNodesByType(pn, 'property_element');
      const annotations = extractAttributesFrom(pn);
      const typeN = pn.childForFieldName('type');
      for (const el of elems) {
        const vn = el.childForFieldName('name') || el.namedChild(0);
        if (vn) {
          fields.push({
            name: safe(vn).replace(/^\$/, ''),
            type: typeN ? safe(typeN) : 'mixed',
            annotations,
            modifiers: [],
            line: el.startPosition.row,
          });
        }
      }
    }
    const methodNodes = findNodesByType(bodyN, 'method_declaration');
    for (const m of methodNodes) {
      const fn = extractFunction(m);
      if (fn) methods.push(fn);
    }
  }

  return {
    name: safe(nameN),
    annotations: extractAttributesFrom(node),
    extends: extendsName,
    implements: implementsList,
    isInterface: false,
    isAbstract: false,
    modifiers: [],
    fields,
    methods,
    line: node.startPosition.row,
  };
}

// --- namespace + use (imports) --------------------------------------------

function extractNamespace(root: SyntaxNode): string | null {
  const ns = findNodesByType(root, 'namespace_definition')[0];
  if (!ns) return null;
  const nameN = ns.childForFieldName('name');
  return nameN ? safe(nameN) : null;
}

function extractImports(root: SyntaxNode): ImportIR[] {
  const imports: ImportIR[] = [];
  for (const u of findNodesByType(root, 'namespace_use_declaration')) {
    const clauses = findNodesByType(u, 'namespace_use_clause');
    for (const c of clauses) {
      const nameN = c.childForFieldName('name') || c.namedChild(0);
      const aliasN = c.childForFieldName('alias');
      const path = safe(nameN);
      const names = aliasN ? [safe(aliasN)] : [path.split('\\').pop() || path];
      imports.push({ path, names });
    }
  }
  return imports;
}

// --- entry point ----------------------------------------------------------

// Collect every `function_call_expression` (and member/scoped call) in the
// file regardless of whether it sits inside a function/method body. WordPress
// core in particular registers most of its architecture via FILE-LEVEL hook
// calls (`add_action(...)`, `add_filter(...)`, `register_widget(...)`) that
// the adapter cannot see if we only walk function bodies. This is what
// `SourceFileIR.allCalls` is designed for — TypeScript already populates it.
function extractAllCallsInFile(root: SyntaxNode): CallIR[] {
  const calls: CallIR[] = [];
  for (const c of findNodesByType(root, 'function_call_expression')) {
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
  for (const c of [
    ...findNodesByType(root, 'member_call_expression'),
    ...findNodesByType(root, 'scoped_call_expression'),
  ]) {
    const objN = c.childForFieldName('object') || c.childForFieldName('scope');
    const nameN = c.childForFieldName('name');
    const argsN = c.childForFieldName('arguments');
    const callee = `${safe(objN)}.${safe(nameN)}`;
    const args: string[] = [];
    if (argsN) {
      for (let i = 0; i < argsN.namedChildCount; i++) {
        const a = argsN.namedChild(i);
        if (a) args.push(safe(a));
      }
    }
    calls.push({ callee, args, typeArgs: null, line: c.startPosition.row });
  }
  return calls;
}

export function extractPhpIR(filePath: string, sourceCode: string): SourceFileIR | null {
  const tree: Tree | null = parsePhpFile(sourceCode);
  if (!tree) return null;
  const root = tree.rootNode;

  const classes: ClassIR[] = [];
  for (const n of findNodesByType(root, 'class_declaration')) {
    const cls = extractClass(n);
    if (cls) classes.push(cls);
  }
  for (const n of findNodesByType(root, 'interface_declaration')) {
    const cls = extractClass(n);
    if (cls) classes.push({ ...cls, isInterface: true });
  }

  const functions: FunctionIR[] = [];
  // Top-level function definitions (children of program / php_tag blocks).
  for (const n of findNodesByType(root, 'function_definition')) {
    // Skip nested functions (inside classes, methods — we already captured those)
    let p: SyntaxNode | null = n.parent;
    let inClassOrMethod = false;
    while (p) {
      if (p.type === 'class_declaration' || p.type === 'method_declaration') { inClassOrMethod = true; break; }
      p = p.parent;
    }
    if (inClassOrMethod) continue;
    const fn = extractFunction(n);
    if (fn) functions.push(fn);
  }

  return {
    filePath,
    language: 'php',
    packageOrNamespace: extractNamespace(root),
    imports: extractImports(root),
    classes,
    functions,
    allCalls: extractAllCallsInFile(root),
  };
}
