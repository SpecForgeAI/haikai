/**
 * Python Language Extractor
 *
 * Parses a `.py` source file into a universal SourceFileIR.
 *
 * IR mapping:
 *   class Foo(Base):                              → ClassIR (isInterface=false)
 *   def foo(): ...                                → FunctionIR (top-level)
 *   class Foo:\n  def bar(): ...                  → ClassIR.methods[]
 *   class Foo:\n  field: str = ...                → ClassIR.fields[]
 *   @decorator / @app.get('/path')                → AnnotationIR on class / method / field
 *   import x / from x import a, b                 → ImportIR
 *
 * Python doesn't have strict modifiers (public/private), so the modifiers
 * array carries synthetic markers:
 *   'export' — added for all top-level names (Python has no `export` keyword;
 *              external use is controlled by __all__ and _prefix convention)
 *   'async'  — added to async functions
 */
import { parsePythonFile, type Tree, type SyntaxNode } from './parser';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  FieldIR,
  ParameterIR,
  AnnotationIR,
  ImportIR,
} from '../../languageIR';

// --- helpers ---------------------------------------------------------------

function safe(n: SyntaxNode | null | undefined): string {
  if (!n) return '';
  try {
    return n.text || '';
  } catch {
    return '';
  }
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

function firstChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

// --- decorators ------------------------------------------------------------

/**
 * A Python decorator is stored in the AST as a `decorator` node that wraps
 * either an identifier, attribute, or call expression. Decorators are
 * children of the `decorated_definition` node whose final child is the
 * actual function_definition / class_definition.
 */
function extractDecoratorsFromDecoratedDef(decoratedDef: SyntaxNode): AnnotationIR[] {
  const decorators: AnnotationIR[] = [];
  for (let i = 0; i < decoratedDef.childCount; i++) {
    const c = decoratedDef.child(i);
    if (!c || c.type !== 'decorator') continue;
    const ir = decoratorToIR(c);
    if (ir) decorators.push(ir);
  }
  return decorators;
}

/**
 * Convert a Python expression (usually the RHS of a class-body assignment)
 * into one or more AnnotationIR entries that adapters can query. Recognises:
 *   models.CharField(max_length=256)     → [{name: 'CharField', args: {max_length: '256'}}]
 *   Column(Integer, primary_key=True)    → [{name: 'Column', args: {arg0: 'Integer', primary_key: 'True'}}]
 *   Field(..., description='...')        → [{name: 'Field', args: {...}}]
 *   relationship('User', backref='...')  → [{name: 'relationship', args: {...}}]
 * Non-call expressions return an empty array so the field is still stored
 * with no annotation.
 */
function callExprToAnnotations(rhs: SyntaxNode): AnnotationIR[] {
  if (rhs.type !== 'call') return [];
  const callee = rhs.childForFieldName('function');
  if (!callee) return [];
  // Use the LAST segment of a dotted callee (models.CharField → CharField).
  const calleeText = safe(callee);
  const name = calleeText.includes('.') ? calleeText.split('.').pop() || calleeText : calleeText;
  const args: Record<string, string> = {};
  const argsNode = rhs.childForFieldName('arguments');
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i);
      if (!a) continue;
      if (a.type === 'keyword_argument') {
        const nameN = a.childForFieldName('name');
        const valueN = a.childForFieldName('value');
        if (nameN) args[safe(nameN)] = safe(valueN);
      } else {
        args[`arg${i}`] = safe(a);
      }
    }
  }
  return [{ name, args, line: rhs.startPosition.row }];
}

function decoratorToIR(decorator: SyntaxNode): AnnotationIR | null {
  // decorator has one named child: identifier | attribute | call
  const inner = decorator.namedChild(0);
  if (!inner) return null;

  if (inner.type === 'identifier' || inner.type === 'attribute') {
    return { name: safe(inner), args: {}, line: decorator.startPosition.row };
  }
  if (inner.type === 'call') {
    const callee = inner.childForFieldName('function');
    const argsNode = inner.childForFieldName('arguments');
    const args: Record<string, string> = {};
    if (argsNode) {
      // argument_list → positional + keyword_argument
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const a = argsNode.namedChild(i);
        if (!a) continue;
        if (a.type === 'keyword_argument') {
          const nameN = a.childForFieldName('name');
          const valueN = a.childForFieldName('value');
          if (nameN) args[safe(nameN)] = safe(valueN);
        } else {
          args[`arg${i}`] = safe(a);
        }
      }
    }
    return { name: safe(callee), args, line: decorator.startPosition.row };
  }
  return null;
}

// --- imports ---------------------------------------------------------------

function extractImports(root: SyntaxNode): ImportIR[] {
  const imports: ImportIR[] = [];

  // `import x`, `import x.y`, `import x as y`
  for (const imp of findNodesByType(root, 'import_statement')) {
    for (let i = 0; i < imp.namedChildCount; i++) {
      const c = imp.namedChild(i);
      if (!c) continue;
      if (c.type === 'dotted_name' || c.type === 'aliased_import') {
        const pathText = c.type === 'aliased_import'
          ? safe(c.childForFieldName('name'))
          : safe(c);
        imports.push({ path: pathText, names: [] });
      }
    }
  }

  // `from x import a, b` / `from x import a as b`
  for (const imp of findNodesByType(root, 'import_from_statement')) {
    const mod = imp.childForFieldName('module_name');
    const modName = safe(mod);
    const names: string[] = [];
    for (let i = 0; i < imp.namedChildCount; i++) {
      const c = imp.namedChild(i);
      if (!c) continue;
      if (c === mod) continue;
      if (c.type === 'dotted_name' || c.type === 'identifier') {
        names.push(safe(c));
      } else if (c.type === 'aliased_import') {
        const alias = c.childForFieldName('alias');
        const nm = c.childForFieldName('name');
        names.push(safe(alias || nm));
      } else if (c.type === 'wildcard_import') {
        names.push('*');
      }
    }
    imports.push({ path: modName, names });
  }

  return imports;
}

// --- parameters ------------------------------------------------------------

function extractParams(paramsNode: SyntaxNode | null): ParameterIR[] {
  if (!paramsNode) return [];
  const out: ParameterIR[] = [];
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const p = paramsNode.namedChild(i);
    if (!p) continue;
    let name = '';
    let type = 'unknown';
    switch (p.type) {
      case 'identifier':
        name = safe(p);
        break;
      case 'typed_parameter': {
        // "name: Type"
        const id = firstChild(p, 'identifier');
        name = safe(id);
        const typeN = p.childForFieldName('type');
        if (typeN) type = safe(typeN);
        break;
      }
      case 'default_parameter': {
        const nameN = p.childForFieldName('name');
        name = safe(nameN);
        break;
      }
      case 'typed_default_parameter': {
        const nameN = p.childForFieldName('name');
        const typeN = p.childForFieldName('type');
        name = safe(nameN);
        if (typeN) type = safe(typeN);
        break;
      }
      case 'list_splat_pattern':
      case 'dictionary_splat_pattern':
        name = safe(p);
        break;
      default:
        name = safe(p);
    }
    if (!name) continue;
    out.push({ name, type, annotations: [] });
  }
  return out;
}

// --- functions -------------------------------------------------------------

function buildFunctionIR(node: SyntaxNode, extraDecorators: AnnotationIR[] = []): FunctionIR | null {
  // node is function_definition
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;
  const paramsN = node.childForFieldName('parameters');
  const returnTypeN = node.childForFieldName('return_type');
  const returnType = returnTypeN ? safe(returnTypeN) : 'unknown';
  const modifiers: string[] = ['export']; // synthetic — Python doesn't have export keyword
  // Async: tree-sitter-python labels async fns as function_definition with a "async" keyword child.
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === 'async') modifiers.push('async');
  }
  return {
    name: safe(nameN),
    returnType,
    parameters: extractParams(paramsN),
    annotations: extraDecorators,
    modifiers,
    line: node.startPosition.row,
    calls: [], // call extraction skipped for Python — not yet needed by any adapter
  };
}

// --- class bodies (fields + methods) --------------------------------------

function extractClassBodyMembers(
  classBodyNode: SyntaxNode,
): { fields: FieldIR[]; methods: FunctionIR[] } {
  const fields: FieldIR[] = [];
  const methods: FunctionIR[] = [];
  // Iterate BLOCK-level statements in order so we can attach decorators to their targets
  const block = firstChild(classBodyNode, 'block') || classBodyNode;
  for (let i = 0; i < block.namedChildCount; i++) {
    const stmt = block.namedChild(i);
    if (!stmt) continue;
    if (stmt.type === 'decorated_definition') {
      const decorators = extractDecoratorsFromDecoratedDef(stmt);
      const defNode = stmt.childForFieldName('definition')
        || stmt.namedChild(stmt.namedChildCount - 1);
      if (defNode && defNode.type === 'function_definition') {
        const fn = buildFunctionIR(defNode, decorators);
        if (fn) methods.push(fn);
      }
      // Decorated class inside a class body is unusual in Python but possible — skip
    } else if (stmt.type === 'function_definition') {
      const fn = buildFunctionIR(stmt);
      if (fn) methods.push(fn);
    } else if (stmt.type === 'expression_statement') {
      // `field: Type = ...` or `field = ...` — parse as field.
      // Python has no decorator on fields; the RHS call expression is the
      // "framework tag" (e.g. `models.CharField(max_length=256)` for Django,
      // `Column(Integer)` for SQLAlchemy, `Field(...)` for Pydantic).
      // We capture the call's function name + kwargs as a synthetic
      // AnnotationIR so adapters can query via hasAnnotation / annotationArg.
      const inner = stmt.namedChild(0);
      if (!inner) continue;
      if (inner.type === 'assignment') {
        const leftField = inner.childForFieldName('left') || inner.namedChild(0);
        const typeField = inner.childForFieldName('type');
        const rightField = inner.childForFieldName('right');
        if (leftField && leftField.type === 'identifier') {
          const anns = rightField ? callExprToAnnotations(rightField) : [];
          fields.push({
            name: safe(leftField),
            type: typeField ? safe(typeField) : 'unknown',
            annotations: anns,
            modifiers: [],
            line: stmt.startPosition.row,
          });
        }
      }
    }
  }
  return { fields, methods };
}

// --- classes ---------------------------------------------------------------

function buildClassIR(node: SyntaxNode, extraDecorators: AnnotationIR[] = []): ClassIR | null {
  // node is class_definition
  const nameN = node.childForFieldName('name');
  if (!nameN) return null;

  // Bases — `class Foo(Base, Mixin):`
  const superclassesN = node.childForFieldName('superclasses');
  const bases: string[] = [];
  if (superclassesN) {
    for (let i = 0; i < superclassesN.namedChildCount; i++) {
      const b = superclassesN.namedChild(i);
      if (b) bases.push(safe(b));
    }
  }

  const bodyNode = node.childForFieldName('body');
  const { fields, methods } = bodyNode ? extractClassBodyMembers(bodyNode) : { fields: [], methods: [] };

  return {
    name: safe(nameN),
    annotations: extraDecorators,
    extends: bases.length > 0 ? bases[0] : null,
    implements: bases.length > 1 ? bases.slice(1) : [],
    isInterface: false,
    isAbstract: false,
    modifiers: ['export'],
    fields,
    methods,
    line: node.startPosition.row,
  };
}

// --- main entry point ------------------------------------------------------

export function extractPythonIR(filePath: string, sourceCode: string): SourceFileIR | null {
  const tree: Tree | null = parsePythonFile(sourceCode);
  if (!tree) return null;
  const root = tree.rootNode;

  const imports = extractImports(root);
  const classes: ClassIR[] = [];
  const functions: FunctionIR[] = [];

  // Top-level items are children of `module`. Walk them once so decorators
  // align with the decorated definition that follows.
  for (let i = 0; i < root.namedChildCount; i++) {
    const stmt = root.namedChild(i);
    if (!stmt) continue;
    if (stmt.type === 'decorated_definition') {
      const decorators = extractDecoratorsFromDecoratedDef(stmt);
      const defNode = stmt.childForFieldName('definition')
        || stmt.namedChild(stmt.namedChildCount - 1);
      if (!defNode) continue;
      if (defNode.type === 'class_definition') {
        const cls = buildClassIR(defNode, decorators);
        if (cls) classes.push(cls);
      } else if (defNode.type === 'function_definition') {
        const fn = buildFunctionIR(defNode, decorators);
        if (fn) functions.push(fn);
      }
    } else if (stmt.type === 'class_definition') {
      const cls = buildClassIR(stmt);
      if (cls) classes.push(cls);
    } else if (stmt.type === 'function_definition') {
      const fn = buildFunctionIR(stmt);
      if (fn) functions.push(fn);
    }
  }

  return {
    filePath,
    language: 'python',
    packageOrNamespace: null, // Python packages are path-based, captured elsewhere
    imports,
    classes,
    functions,
  };
}
