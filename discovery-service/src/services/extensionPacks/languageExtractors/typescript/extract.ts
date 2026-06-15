/**
 * TypeScript Language Extractor
 *
 * Parses a TypeScript or TSX source file into the universal SourceFileIR shape.
 * Like the Java extractor, this is the "language layer" — it knows TypeScript
 * syntax but has zero framework knowledge (no React, Redux, axios awareness).
 *
 * IR mapping:
 * - `interface Foo { ... }` and `type Foo = { ... }` → IR ClassIR with isInterface=true
 * - `class Foo { ... }` → IR ClassIR with isInterface=false
 * - `export function foo() {}`, `export const foo = () => {}` → IR FunctionIR
 * - `import { ... } from '...'` → IR ImportIR
 *
 * Delegates parsing to ./tsxParser (co-located in this directory). The
 * parser was lifted from the legacy reactTypescript pack as part of the
 * V3 V2-removal (V3 Pack Migration Batch — Task Group 11).
 */
import { parseFile, type SyntaxNode, type Tree } from './tsxParser';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  FieldIR,
  ParameterIR,
  AnnotationIR,
  ImportIR,
  CallIR,
} from '../../languageIR';

// --- Helpers ---------------------------------------------------------------

function safeText(n: SyntaxNode | null | undefined): string {
  if (!n) return '';
  try {
    return n.text || '';
  } catch {
    return '';
  }
}

function findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  if (node.type === type) results.push(node);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) results.push(...findNodesByType(c, type));
  }
  return results;
}

function firstChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

/** Convert a single `decorator` SyntaxNode into an AnnotationIR entry. */
function decoratorToIR(c: SyntaxNode): AnnotationIR | null {
  // decorator → call_expression | identifier | member_expression
  const inner = c.namedChild(0);
  if (!inner) return null;
  if (inner.type === 'identifier' || inner.type === 'member_expression') {
    return { name: safeText(inner), args: {}, line: c.startPosition.row };
  }
  if (inner.type === 'call_expression') {
    const callee = inner.childForFieldName('function');
    const args: Record<string, string> = {};
    const argsNode = inner.childForFieldName('arguments');
    if (argsNode) {
      for (let j = 0; j < argsNode.namedChildCount; j++) {
        const arg = argsNode.namedChild(j);
        if (arg) args[`arg${j}`] = safeText(arg);
      }
    }
    return { name: safeText(callee), args, line: c.startPosition.row };
  }
  return null;
}

/**
 * Parse decorators attached to a node. Tree-sitter-typescript places
 * decorators in two different spots depending on context:
 *   1. On classes and methods: decorators are PRECEDING SIBLINGS of the
 *      class_declaration / method_definition node (or direct children of
 *      the parent class_body / program).
 *   2. On parameters and fields: decorators are CHILDREN of the
 *      required_parameter / public_field_definition node.
 * We walk both to cover all cases.
 */
function extractDecorators(node: SyntaxNode): AnnotationIR[] {
  const annotations: AnnotationIR[] = [];
  // 1. Children of the node (parameter + field decorators sit here)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type !== 'decorator') continue;
    const ir = decoratorToIR(c);
    if (ir) annotations.push(ir);
  }
  // 2. Preceding siblings (class + method decorators sit here)
  let prev: SyntaxNode | null = node.previousNamedSibling;
  const prevDecorators: AnnotationIR[] = [];
  while (prev && prev.type === 'decorator') {
    const ir = decoratorToIR(prev);
    if (ir) prevDecorators.unshift(ir); // preserve source order
    prev = prev.previousNamedSibling;
  }
  return [...prevDecorators, ...annotations];
}

function getModifiers(node: SyntaxNode): string[] {
  const modifiers: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (['export', 'default', 'async', 'abstract', 'readonly', 'static', 'public', 'private', 'protected'].includes(c.type)) {
      modifiers.push(c.type);
    }
  }
  return modifiers;
}

// --- Imports ---------------------------------------------------------------

function extractImports(root: SyntaxNode): ImportIR[] {
  const imports: ImportIR[] = [];
  const importNodes = findNodesByType(root, 'import_statement');
  for (const imp of importNodes) {
    const srcNode = imp.childForFieldName('source');
    const path = srcNode ? safeText(srcNode).replace(/['"]/g, '') : '';
    const names: string[] = [];
    for (let i = 0; i < imp.namedChildCount; i++) {
      const child = imp.namedChild(i);
      if (!child) continue;
      if (child.type === 'import_clause') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const clauseChild = child.namedChild(j);
          if (!clauseChild) continue;
          if (clauseChild.type === 'identifier') {
            names.push(safeText(clauseChild));
          } else if (clauseChild.type === 'named_imports') {
            const specs = findNodesByType(clauseChild, 'import_specifier');
            for (const spec of specs) {
              const alias = spec.childForFieldName('alias');
              const name = spec.childForFieldName('name');
              names.push(safeText(alias || name));
            }
          } else if (clauseChild.type === 'namespace_import') {
            for (let k = 0; k < clauseChild.namedChildCount; k++) {
              const ns = clauseChild.namedChild(k);
              if (ns && ns.type === 'identifier') names.push(safeText(ns));
            }
          }
        }
      }
    }
    imports.push({ path, names: names.filter((n) => n && n.length > 0) });
  }
  return imports;
}

// --- Property/field extraction (for interfaces, types, classes) -----------

function extractPropertySignatures(bodyNode: SyntaxNode): FieldIR[] {
  const fields: FieldIR[] = [];
  // interface/type object body can contain property_signature, method_signature, etc.
  const propNodes = [
    ...findNodesByType(bodyNode, 'property_signature'),
    ...findNodesByType(bodyNode, 'public_field_definition'),
  ];
  for (const prop of propNodes) {
    const nameNode = prop.childForFieldName('name');
    const typeAnnotation = prop.childForFieldName('type');
    const name = safeText(nameNode);
    if (!name) continue;
    // type_annotation usually has format ": SomeType" — strip leading ':' and whitespace
    let type = safeText(typeAnnotation).replace(/^:\s*/, '');
    if (!type) type = 'unknown';
    fields.push({
      name,
      type,
      annotations: extractDecorators(prop),
      modifiers: getModifiers(prop),
      line: prop.startPosition.row,
    });
  }
  return fields;
}

// --- Interface/type/class extraction --------------------------------------

function extractInterfaceDeclaration(node: SyntaxNode): ClassIR | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  const bodyNode = node.childForFieldName('body') || firstChildOfType(node, 'object_type') || firstChildOfType(node, 'interface_body');
  const fields = bodyNode ? extractPropertySignatures(bodyNode) : [];
  const extendsList: string[] = [];
  // interface extends are stored in "extends_type_clause" or similar
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === 'extends_type_clause' || c.type === 'extends_clause') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const ext = c.namedChild(j);
        if (ext) extendsList.push(safeText(ext));
      }
    }
  }
  return {
    name: safeText(nameNode),
    annotations: extractDecorators(node),
    extends: extendsList.length > 0 ? extendsList[0] : null,
    implements: extendsList.length > 1 ? extendsList.slice(1) : [],
    isInterface: true,
    isAbstract: false,
    modifiers: getModifiers(node),
    fields,
    methods: [],
    line: node.startPosition.row,
  };
}

function extractTypeAliasDeclaration(node: SyntaxNode): ClassIR | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  const valueNode = node.childForFieldName('value');
  if (!valueNode) return null;
  // Only emit a class-like record for object types: `type X = { a: string; }`.
  // Aliases of primitives/unions aren't logical entities.
  if (valueNode.type !== 'object_type') return null;
  const fields = extractPropertySignatures(valueNode);
  return {
    name: safeText(nameNode),
    annotations: extractDecorators(node),
    extends: null,
    implements: [],
    isInterface: true,
    isAbstract: false,
    modifiers: getModifiers(node),
    fields,
    methods: [],
    line: node.startPosition.row,
  };
}

function extractClassDeclaration(node: SyntaxNode): ClassIR | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  const bodyNode = node.childForFieldName('body');
  const fields = bodyNode ? extractPropertySignatures(bodyNode) : [];
  const methods: FunctionIR[] = [];
  if (bodyNode) {
    const methodNodes = findNodesByType(bodyNode, 'method_definition');
    for (const m of methodNodes) {
      const fn = buildFunctionIR(m, safeText(m.childForFieldName('name')));
      if (fn) methods.push(fn);
    }
  }

  // Extract superclass via TypeScript's class_heritage → extends_clause structure.
  // In tree-sitter-typescript, `class_declaration` has a `class_heritage` child
  // (not a named field). Inside class_heritage there's an `extends_clause`
  // containing the extended identifier (may be a dotted member expression like
  // `React.Component`).
  let extendsName: string | null = null;
  const implementsList: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c || c.type !== 'class_heritage') continue;
    for (let j = 0; j < c.childCount; j++) {
      const h = c.child(j);
      if (!h) continue;
      if (h.type === 'extends_clause') {
        // Find the first identifier / member_expression child
        for (let k = 0; k < h.namedChildCount; k++) {
          const e = h.namedChild(k);
          if (e && (e.type === 'identifier' || e.type === 'member_expression' || e.type === 'generic_type')) {
            extendsName = safeText(e).trim();
            break;
          }
        }
      } else if (h.type === 'implements_clause') {
        for (let k = 0; k < h.namedChildCount; k++) {
          const e = h.namedChild(k);
          if (e && e.type !== ',') implementsList.push(safeText(e).trim());
        }
      }
    }
  }

  return {
    name: safeText(nameNode),
    annotations: extractDecorators(node),
    extends: extendsName,
    implements: implementsList,
    isInterface: false,
    isAbstract: getModifiers(node).includes('abstract'),
    modifiers: getModifiers(node),
    fields,
    methods,
    line: node.startPosition.row,
  };
}

// --- Functions -------------------------------------------------------------

function extractParams(paramsNode: SyntaxNode | null | undefined): ParameterIR[] {
  if (!paramsNode) return [];
  const params: ParameterIR[] = [];
  const paramNodes = [
    ...findNodesByType(paramsNode, 'required_parameter'),
    ...findNodesByType(paramsNode, 'optional_parameter'),
  ];
  for (const p of paramNodes) {
    const name = safeText(p.childForFieldName('pattern') || p.namedChild(0));
    const typeAnn = p.childForFieldName('type');
    const type = typeAnn ? safeText(typeAnn).replace(/^:\s*/, '') : 'unknown';
    params.push({ name, type, annotations: extractDecorators(p) });
  }
  return params;
}

/** Extract all call expressions inside a function body. */
function extractCalls(fnNode: SyntaxNode): CallIR[] {
  const bodyNode = fnNode.childForFieldName('body');
  if (!bodyNode) return [];
  const calls: CallIR[] = [];
  const callNodes = findNodesByType(bodyNode, 'call_expression');
  for (const c of callNodes) {
    const fnField = c.childForFieldName('function');
    if (!fnField) continue;
    const callee = safeText(fnField);
    // Extract typed generic args if present (e.g. axios.get<UserDto[]>(...))
    const typeArgsField = c.childForFieldName('type_arguments');
    const typeArgs = typeArgsField ? safeText(typeArgsField).replace(/^</, '').replace(/>$/, '').trim() : null;
    // Extract argument texts
    const argsField = c.childForFieldName('arguments');
    const args: string[] = [];
    if (argsField) {
      for (let i = 0; i < argsField.namedChildCount; i++) {
        const a = argsField.namedChild(i);
        if (a) args.push(safeText(a));
      }
    }
    calls.push({ callee, args, typeArgs, line: c.startPosition.row });
  }
  return calls;
}

function buildFunctionIR(node: SyntaxNode, name: string): FunctionIR | null {
  if (!name) return null;
  const paramsNode = node.childForFieldName('parameters');
  const returnTypeNode = node.childForFieldName('return_type');
  const returnType = returnTypeNode ? safeText(returnTypeNode).replace(/^:\s*/, '') : 'unknown';
  return {
    name,
    returnType,
    parameters: extractParams(paramsNode),
    annotations: extractDecorators(node),
    modifiers: getModifiers(node),
    line: node.startPosition.row,
    calls: extractCalls(node),
  };
}

function extractTopLevelFunctions(root: SyntaxNode): FunctionIR[] {
  const fns: FunctionIR[] = [];
  // Walk export_statement + function_declaration + lexical_declaration.
  // tree-sitter wraps the `export` keyword in the parent export_statement, so
  // we synthesise 'export' (and 'default' when present) on the child's
  // modifier list so downstream consumers don't need AST-level awareness.
  const exportNodes = findNodesByType(root, 'export_statement');
  for (const exp of exportNodes) {
    const expText = safeText(exp);
    const isDefault = expText.startsWith('export default');
    const syntheticModifiers = isDefault ? ['export', 'default'] : ['export'];

    for (let i = 0; i < exp.namedChildCount; i++) {
      const c = exp.namedChild(i);
      if (!c) continue;
      if (c.type === 'function_declaration') {
        const name = safeText(c.childForFieldName('name'));
        const fn = buildFunctionIR(c, name);
        if (fn) {
          fn.modifiers = [...syntheticModifiers, ...fn.modifiers];
          fns.push(fn);
        }
      } else if (c.type === 'lexical_declaration') {
        // `export const foo = () => {}` or `export const foo = function() {}`
        const decl = findNodesByType(c, 'variable_declarator')[0];
        if (decl) {
          const name = safeText(decl.childForFieldName('name'));
          const valueNode = decl.childForFieldName('value');
          if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression' || valueNode.type === 'function')) {
            const fn = buildFunctionIR(valueNode, name);
            if (fn) {
              fn.modifiers = [...syntheticModifiers, ...fn.modifiers];
              fns.push(fn);
            }
          }
        }
      }
    }
  }
  // Top-level function_declarations not wrapped in export_statement
  for (const fn of findNodesByType(root, 'function_declaration')) {
    if (fn.parent && fn.parent.type !== 'export_statement') {
      // Only pick up declarations directly under program
      if (fn.parent.type === 'program') {
        const name = safeText(fn.childForFieldName('name'));
        const built = buildFunctionIR(fn, name);
        if (built) fns.push(built);
      }
    }
  }
  return fns;
}

// --- Main entry point ------------------------------------------------------

export function extractTypeScriptIR(
  filePath: string,
  sourceCode: string,
): SourceFileIR | null {
  const tree: Tree | null = parseFile(sourceCode, filePath);
  if (!tree) return null;
  const root = tree.rootNode;

  const imports = extractImports(root);

  // Collect classes — in TS, this includes: class, interface, type-alias-of-object
  const classes: ClassIR[] = [];

  for (const node of findNodesByType(root, 'interface_declaration')) {
    const ir = extractInterfaceDeclaration(node);
    if (ir) classes.push(ir);
  }

  for (const node of findNodesByType(root, 'type_alias_declaration')) {
    const ir = extractTypeAliasDeclaration(node);
    if (ir) classes.push(ir);
  }

  for (const node of findNodesByType(root, 'class_declaration')) {
    const ir = extractClassDeclaration(node);
    if (ir) classes.push(ir);
  }

  const functions = extractTopLevelFunctions(root);

  // Collect ALL call_expressions in the file regardless of nesting. Needed
  // by frameworks whose detection signals are module-level calls (e.g.
  // AngularJS 1.x `angular.module(...).controller(...)` chains, often
  // wrapped in RequireJS `define([...], function(){...})` callbacks).
  const allCalls: CallIR[] = [];
  for (const c of findNodesByType(root, 'call_expression')) {
    const fnField = c.childForFieldName('function');
    if (!fnField) continue;
    const callee = safeText(fnField);
    const typeArgsField = c.childForFieldName('type_arguments');
    const typeArgs = typeArgsField ? safeText(typeArgsField).replace(/^</, '').replace(/>$/, '').trim() : null;
    const argsField = c.childForFieldName('arguments');
    const args: string[] = [];
    if (argsField) {
      for (let i = 0; i < argsField.namedChildCount; i++) {
        const a = argsField.namedChild(i);
        if (a) args.push(safeText(a));
      }
    }
    allCalls.push({ callee, args, typeArgs, line: c.startPosition.row });
  }

  return {
    filePath,
    language: 'typescript',
    packageOrNamespace: null, // TS doesn't have packages; module = file itself
    imports,
    classes,
    functions,
    allCalls,
    // Stash the raw source so adapters can do flow-sensitive pattern
    // resolution without needing a second extractor pass (e.g. the
    // AngularJS pack's `let req = {...}; $http(req)` variable-resolution
    // for Bug 23).
    rawContent: sourceCode,
  };
}
