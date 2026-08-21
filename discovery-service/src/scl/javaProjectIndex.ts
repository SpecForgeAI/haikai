/**
 * SCL Java project index — parse + index an entire Java source tree.
 *
 * Walks `**\/*.java` under a root directory (skipping `target/`, `build/`,
 * `.git/`, `node_modules/`), parses each file with the SCL wasm Java parser
 * (`./wasmJavaParser`, web-tree-sitter — NOT the native node-tree-sitter
 * binding, whose nondeterministic node-read corruption is documented there),
 * and builds a deterministic class/method index the SCL extractors
 * (shape / behaviour / boundary) consume.
 *
 * Tolerance contract: a file that fails to parse lands in `parseErrors` and
 * indexing continues; `indexJavaProject` never throws for source-level
 * problems. Determinism contract: files are visited in sorted path order, so
 * map insertion order (and everything derived from it) is stable across runs.
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md
 * ("Extraction pipeline", step 1 — deterministic slice).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ensureJavaWasmParser,
  parseJavaWasm,
  type WasmSyntaxNode,
  type WasmTree,
} from './wasmJavaParser';

/**
 * The syntax-node type used throughout src/scl (web-tree-sitter's node).
 * Exported under the historical name so the SCL extractors keep importing
 * `SyntaxNode` from this module — the single source for the SCL node type.
 */
export type SyntaxNode = WasmSyntaxNode;

// ---------------------------------------------------------------------------
// Index model
// ---------------------------------------------------------------------------

/**
 * One method of a project class. `startLine` is 1-based. `filePath` is
 * RELATIVE to the indexed root, posix-separated — stable across machines so
 * it is safe inside content-hashed contract bodies.
 */
export interface JavaMethodInfo {
  name: string;
  paramTypes: string[];
  paramNames: string[];
  returnType: string;
  /** Verbatim annotation text incl. '@' and arguments, e.g. `@Path("/views")`. */
  annotations: string[];
  /** The method body's syntax node, or null for abstract/interface methods. */
  bodyNode: SyntaxNode | null;
  startLine: number;
  classFqn: string;
  filePath: string;
  /** Whole file text, for verbatim slicing by the behaviour extractor. */
  sourceText: string;
}

/** One field of a project class (or one constant of an enum). */
export interface JavaFieldInfo {
  name: string;
  type: string;
  /** Verbatim annotation text incl. '@', e.g. `@JsonProperty("view_name")`. */
  annotations: string[];
  /**
   * Extension beyond the minimal contract (documented for pass 2): declared
   * modifiers ('private', 'static', 'final', ...). Lets the shape extractor
   * skip static constants and the boundary extractor find `static final
   * String ..._SQL` fields.
   */
  modifiers: string[];
  /**
   * Extension for pass 2 (boundary/Q contracts): the verbatim initializer
   * expression text (e.g. the SQL string literal), or null when the field has
   * no initializer.
   */
  initializer: string | null;
  /** 1-based declaration line. */
  line: number;
}

/** One project type (class / interface / enum). Annotation types (`@interface`) are NOT indexed as classes. */
export interface JavaClassInfo {
  fqn: string;
  simpleName: string;
  kind: 'class' | 'interface' | 'enum';
  filePath: string;
  /** Declared superclass text (simple or qualified, as written), or null. */
  superClass: string | null;
  /** Declared `implements` list, verbatim type texts. */
  interfaces: string[];
  /** Verbatim annotation text incl. '@' on the type declaration. */
  annotations: string[];
  fields: JavaFieldInfo[];
  methods: JavaMethodInfo[];
  imports: string[];
  /** 1-based declaration line (extension; handy for cites). */
  startLine: number;
  isProjectType: true;
}

export interface JavaProjectIndex {
  /** The indexed root directory (absolute). All `filePath`s are relative to it. */
  rootDir: string;
  /** Keyed by fully-qualified name, insertion in sorted-file/declaration order. */
  classesByFqn: Map<string, JavaClassInfo>;
  /** Keyed by simple name; a name can collide across packages. */
  classesBySimpleName: Map<string, JavaClassInfo[]>;
  /**
   * Project classes whose `implements` list names the given interface (simple
   * or fully-qualified form accepted). Sorted by FQN. Two results for one
   * interface = the dispatch-ambiguity case the slicer surfaces as a finding.
   */
  implementationsOf(interfaceSimpleOrFqn: string): JavaClassInfo[];
  /**
   * Project classes that `extends` the given class, TRANSITIVELY (simple or
   * fully-qualified form accepted; matched by last segment, mirroring
   * `implementationsOf`). Sorted by FQN. Powers abstract-class dispatch
   * expansion (2026-08-21: the factory/loader pattern — an abstract base
   * whose concrete subclasses the factory picks — resolved like interface
   * dispatch; previously only `implements` was devirtualized, so those
   * call chains broke and their endpoints could never be effect-mapped).
   */
  subclassesOf(classSimpleOrFqn: string): JavaClassInfo[];
  parseErrors: Array<{ path: string; message: string }>;
  /**
   * INTERNAL — parsed Trees pinned for the index's lifetime. Extractors hold
   * SyntaxNodes (e.g. method bodyNode) long after indexing; a GC'd tree
   * behind a live node silently corrupts reads (2026-08-18 determinism fix).
   * Never read this; it exists purely to keep the trees alive.
   */
  __pinnedTrees?: unknown[];
  /**
   * Extension: non-Java resource files under the root that MENTION a project
   * FQN (e.g. Spring `beans.xml`) — a config-reference reachability signal
   * for the corpus closure. Maps resource path → the FQNs it mentions.
   */
  configReferences: Map<string, string[]>;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['target', 'build', '.git', 'node_modules']);

function walkFiles(rootDir: string): { javaFiles: string[]; resourceXmlFiles: string[] } {
  const javaFiles: string[] = [];
  const resourceXmlFiles: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — tolerant skip
    }
    // Sort for determinism; push subdirs in reverse so the stack pops them in order.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (e.name.endsWith('.java')) javaFiles.push(full);
        else if (e.name.endsWith('.xml') || e.name.endsWith('.properties')) resourceXmlFiles.push(full);
      }
    }
  }
  javaFiles.sort();
  resourceXmlFiles.sort();
  return { javaFiles, resourceXmlFiles };
}

// ---------------------------------------------------------------------------
// AST helpers (SCL-specific: verbatim annotation text, enum support)
// ---------------------------------------------------------------------------

/**
 * Iterative whole-subtree collection of nodes of one type. Exported for the
 * SCL extractors (shape / behaviour / boundary) — the shared AST idiom.
 */
export function collectNodesOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop() as SyntaxNode;
    if (n.type === type) out.push(n);
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
  return out;
}

/** Verbatim annotation texts (incl. '@') from a declaration's modifiers. */
function verbatimAnnotations(declNode: SyntaxNode): string[] {
  const out: string[] = [];
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (!child) continue;
    if (child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const m = child.child(j);
        if (m && (m.type === 'marker_annotation' || m.type === 'annotation')) {
          out.push(m.text);
        }
      }
    } else if (child.type === 'marker_annotation' || child.type === 'annotation') {
      // e.g. annotations directly on formal parameters
      out.push(child.text);
    }
  }
  return out;
}

function extractModifierKeywords(declNode: SyntaxNode): string[] {
  const out: string[] = [];
  for (let i = 0; i < declNode.childCount; i++) {
    const child = declNode.child(i);
    if (child && child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const m = child.child(j);
        if (m && m.type !== 'marker_annotation' && m.type !== 'annotation' && /^[a-z]/.test(m.type)) {
          out.push(m.text);
        }
      }
    }
  }
  return out;
}

function packageNameOf(root: SyntaxNode): string {
  const decl = collectNodesOfType(root, 'package_declaration')[0];
  if (!decl) return '';
  for (let i = 0; i < decl.namedChildCount; i++) {
    const c = decl.namedChild(i);
    if (c && (c.type === 'scoped_identifier' || c.type === 'identifier')) return c.text;
  }
  return '';
}

function importsOf(root: SyntaxNode): string[] {
  const out: string[] = [];
  for (const imp of collectNodesOfType(root, 'import_declaration')) {
    const m = imp.text.match(/import\s+(?:static\s+)?([^;]+);/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function superClassOf(classNode: SyntaxNode): string | null {
  for (let i = 0; i < classNode.childCount; i++) {
    const child = classNode.child(i);
    if (child && child.type === 'superclass') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (c && (c.type === 'type_identifier' || c.type === 'generic_type' || c.type === 'scoped_type_identifier')) {
          return c.text;
        }
      }
      return child.text.replace(/^extends\s+/, '').trim();
    }
  }
  return null;
}

function interfacesOf(classNode: SyntaxNode): string[] {
  const names: string[] = [];
  for (let i = 0; i < classNode.childCount; i++) {
    const child = classNode.child(i);
    // `super_interfaces` = a class's `implements` list;
    // `extends_interfaces` = an INTERFACE's `extends` list (2026-08-21:
    // previously dropped, so methods declared on parent interfaces were
    // invisible to hierarchy lookup).
    if (child && (child.type === 'super_interfaces' || child.type === 'extends_interfaces')) {
      for (const typeList of collectNodesOfType(child, 'type_list')) {
        for (let j = 0; j < typeList.namedChildCount; j++) {
          const t = typeList.namedChild(j);
          if (t) names.push(t.text);
        }
      }
    }
  }
  return names;
}

/**
 * True when `node` sits inside a NESTED type body relative to `outerBody` —
 * used to avoid attributing anonymous/inner-class members to the outer type.
 *
 * NOTE: web-tree-sitter materialises a FRESH JS object per node access
 * (`.parent` twice yields two objects for the same node), so ancestry must
 * compare `node.id` — never JS object identity.
 */
function isInsideNestedBody(node: SyntaxNode, outerBody: SyntaxNode): boolean {
  let anc: SyntaxNode | null = node.parent;
  while (anc && anc.id !== outerBody.id) {
    if (anc.type === 'class_body' || anc.type === 'enum_body' || anc.type === 'interface_body') return true;
    anc = anc.parent;
  }
  return false;
}

function fieldsOf(classNode: SyntaxNode): JavaFieldInfo[] {
  const fields: JavaFieldInfo[] = [];
  const body = classNode.childForFieldName('body');
  if (!body) return fields;

  if (classNode.type === 'enum_declaration') {
    // Enum constants become the "fields" of the enum (declaration order).
    for (const constant of collectNodesOfType(body, 'enum_constant')) {
      if (isInsideNestedBody(constant, body)) continue;
      const nameNode = constant.childForFieldName('name') || constant.namedChild(0);
      if (!nameNode) continue;
      fields.push({
        name: nameNode.text,
        type: 'enum-constant',
        annotations: verbatimAnnotations(constant),
        modifiers: [],
        initializer: null,
        line: constant.startPosition.row + 1,
      });
    }
    // fall through: enums can also declare regular fields in their body
  }

  for (const fieldNode of collectNodesOfType(body, 'field_declaration')) {
    if (isInsideNestedBody(fieldNode, body)) continue;
    const typeNode = fieldNode.childForFieldName('type');
    const annotations = verbatimAnnotations(fieldNode);
    const modifiers = extractModifierKeywords(fieldNode);
    // One field_declaration can declare several variables (`int a, b;`).
    for (let i = 0; i < fieldNode.namedChildCount; i++) {
      const decl = fieldNode.namedChild(i);
      if (!decl || decl.type !== 'variable_declarator') continue;
      const nameNode = decl.childForFieldName('name');
      if (!nameNode) continue;
      const valueNode = decl.childForFieldName('value');
      fields.push({
        name: nameNode.text,
        type: typeNode ? typeNode.text : 'var',
        annotations,
        modifiers,
        initializer: valueNode ? valueNode.text : null,
        line: fieldNode.startPosition.row + 1,
      });
    }
  }
  return fields;
}

function methodsOf(
  classNode: SyntaxNode,
  classFqn: string,
  filePath: string,
  sourceText: string
): JavaMethodInfo[] {
  const methods: JavaMethodInfo[] = [];
  const body = classNode.childForFieldName('body');
  if (!body) return methods;

  for (const methodNode of collectNodesOfType(body, 'method_declaration')) {
    if (isInsideNestedBody(methodNode, body)) continue;
    const nameNode = methodNode.childForFieldName('name');
    if (!nameNode) continue;

    const paramTypes: string[] = [];
    const paramNames: string[] = [];
    const paramsNode = methodNode.childForFieldName('parameters');
    if (paramsNode) {
      for (let i = 0; i < paramsNode.namedChildCount; i++) {
        const p = paramsNode.namedChild(i);
        if (!p || (p.type !== 'formal_parameter' && p.type !== 'spread_parameter')) continue;
        const pType = p.childForFieldName('type');
        const pName = p.childForFieldName('name');
        paramTypes.push(pType ? pType.text : '?');
        paramNames.push(pName ? pName.text : '');
      }
    }

    const typeNode = methodNode.childForFieldName('type');
    methods.push({
      name: nameNode.text,
      paramTypes,
      paramNames,
      returnType: typeNode ? typeNode.text : 'void',
      annotations: verbatimAnnotations(methodNode),
      bodyNode: methodNode.childForFieldName('body') || null,
      startLine: methodNode.startPosition.row + 1,
      classFqn,
      filePath,
      sourceText,
    });
  }
  return methods;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const TYPE_DECL_KINDS: Array<{ nodeType: string; kind: JavaClassInfo['kind'] }> = [
  { nodeType: 'class_declaration', kind: 'class' },
  { nodeType: 'interface_declaration', kind: 'interface' },
  { nodeType: 'enum_declaration', kind: 'enum' },
];

// ---------------------------------------------------------------------------
// Deterministic parsing (2026-08-18 determinism fixes)
//
// The native tree-sitter Node binding exhibited nondeterministic node-read
// corruption that poisoned the content-hashed corpus (observed live on the
// fixture app — same process, run-to-run shape-set divergence: a class body
// intermittently walked as EMPTY, fields AND methods vanishing while the
// class name survived). SCL therefore parses via web-tree-sitter (WASM — see
// `./wasmJavaParser`), which has no shared native transfer buffer. The
// validation belts below are retained (they're cheap even under wasm): tree
// validation (full span, no ERROR nodes), the class-level member-loss staging
// check, bounded re-parse retries, and every Tree PINNED on the index so no
// tree is GC'd while extractors still hold SyntaxNodes into it. Persistent
// problems land LOUDLY in parseErrors — never a silent drop.
// ---------------------------------------------------------------------------

/** Parse ONE file with the wasm parser + validity checks. */
function parseValidated(
  sourceText: string
): { tree: WasmTree; rootNode: SyntaxNode } | { problem: string } {
  let tree: WasmTree | null = null;
  try {
    tree = parseJavaWasm(sourceText);
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
  if (!tree || !tree.rootNode) {
    return { problem: 'tree-sitter returned no tree for file' };
  }
  const root = tree.rootNode;
  // web-tree-sitter indexes are UTF-16 code units, NOT bytes — compare
  // against source.length, never Buffer.byteLength.
  if (root.endIndex < sourceText.length) {
    return {
      problem:
        `tree-sitter returned a TRUNCATED tree (root spans ${root.endIndex} of ` +
        `${sourceText.length} UTF-16 code units)`,
    };
  }
  // hasError is a method on some binding versions, a property on others
  // (web-tree-sitter 0.22.6 types declare a property; the runtime is a method).
  const rootAny = root as unknown as { hasError?: boolean | (() => boolean) };
  const errored =
    typeof rootAny.hasError === 'function' ? rootAny.hasError() : Boolean(rootAny.hasError);
  if (errored) {
    return { problem: 'tree-sitter parse produced ERROR nodes' };
  }
  return { tree, rootNode: root };
}

/**
 * Parse + index every Java file under `rootDir`. Deterministic (sorted file
 * order) and tolerant (per-file failures land in `parseErrors`, never throw).
 */
export async function indexJavaProject(rootDir: string): Promise<JavaProjectIndex> {
  await ensureJavaWasmParser();
  const classesByFqn = new Map<string, JavaClassInfo>();
  const classesBySimpleName = new Map<string, JavaClassInfo[]>();
  const parseErrors: Array<{ path: string; message: string }> = [];
  const configReferences = new Map<string, string[]>();

  const { javaFiles, resourceXmlFiles } = walkFiles(rootDir);
  // filePaths on the index are RELATIVE to rootDir, posix-separated — stable
  // across machines, so safe inside content-hashed contract bodies.
  const relPath = (abs: string): string => path.relative(rootDir, abs).split(path.sep).join('/');

  // Every accepted Tree is pinned here for the index's lifetime — extractors
  // hold SyntaxNodes (method bodyNode) long after this loop, and a GC'd tree
  // behind a live node is one of the observed member-vanishing modes.
  const pinnedTrees: unknown[] = [];

  for (const absPath of javaFiles) {
    const filePath = relPath(absPath);
    try {
      const sourceText = fs.readFileSync(absPath, 'utf8');

      const MAX_ATTEMPTS = 3;
      let lastProblem: string | null = null;
      let committed = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !committed; attempt++) {
        const parsed = parseValidated(sourceText);
        if ('problem' in parsed) {
          lastProblem = parsed.problem;
          continue;
        }
        const root = parsed.rootNode;
        const pkg = packageNameOf(root);
        const imports = importsOf(root);

        // Extract into a per-file staging list so a glitched walk can be
        // retried without half-committed classes.
        const staged: JavaClassInfo[] = [];
        let memberLossSuspected = false;

        for (const { nodeType, kind } of TYPE_DECL_KINDS) {
          for (const declNode of collectNodesOfType(root, nodeType)) {
            const nameNode = declNode.childForFieldName('name');
            if (!nameNode) continue;

            // Qualify nested types as Outer.Inner (walk enclosing type decls).
            const nameParts: string[] = [nameNode.text];
            let anc: SyntaxNode | null = declNode.parent;
            while (anc) {
              if (
                anc.type === 'class_declaration' ||
                anc.type === 'interface_declaration' ||
                anc.type === 'enum_declaration'
              ) {
                const ancName = anc.childForFieldName('name');
                if (ancName) nameParts.unshift(ancName.text);
              }
              anc = anc.parent;
            }
            const qualified = nameParts.join('.');
            const fqn = pkg ? `${pkg}.${qualified}` : qualified;

            const info: JavaClassInfo = {
              fqn,
              simpleName: nameNode.text,
              kind,
              filePath,
              superClass: kind === 'class' ? superClassOf(declNode) : null,
              // For interfaces this is the `extends` list (parent
              // interfaces); for classes the `implements` list.
              interfaces: interfacesOf(declNode),
              annotations: verbatimAnnotations(declNode),
              fields: fieldsOf(declNode),
              methods: methodsOf(declNode, fqn, filePath, sourceText),
              imports,
              startLine: declNode.startPosition.row + 1,
              isProjectType: true,
            };

            // Member-loss glitch check (2026-08-18): the observed failure mode
            // walks a class body as EMPTY (zero child declarations) while the
            // class name survives. The precise signature: a substantial body
            // span (>60 bytes between the braces) whose node reports ZERO
            // named children — a genuinely member-less body of that size does
            // not exist, but a constructor-only class (e.g. an exception)
            // legitimately has 0 fields/0 extracted methods and MUST NOT trip
            // this, so we test the node's own child count, not our extraction.
            {
              const body = declNode.childForFieldName('body');
              if (!body) {
                // A Java type declaration ALWAYS has a body — a null body
                // lookup is the glitch itself (observed: the same node that
                // reports fields=0/methods=0 also fails the body lookup).
                memberLossSuspected = true;
              } else if (body.endIndex - body.startIndex > 60 && body.namedChildCount === 0) {
                memberLossSuspected = true;
              }
            }
            staged.push(info);
          }
        }

        if (memberLossSuspected) {
          lastProblem =
            'tree-sitter walked a substantial class body as EMPTY (member-loss glitch)';
          continue;
        }

        for (const info of staged) {
          classesByFqn.set(info.fqn, info);
          const bySimple = classesBySimpleName.get(info.simpleName) || [];
          bySimple.push(info);
          classesBySimpleName.set(info.simpleName, bySimple);
        }
        pinnedTrees.push(parsed.tree);
        committed = true;
      }

      if (!committed) {
        parseErrors.push({
          path: filePath,
          message: `${lastProblem ?? 'unknown parse problem'} (after ${MAX_ATTEMPTS} attempts)`,
        });
      }
    } catch (err) {
      parseErrors.push({
        path: filePath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Config-reference reachability signal: resource files that mention a
  // project FQN verbatim (e.g. Spring beans.xml class="com.legacy...Impl").
  const allFqns = Array.from(classesByFqn.keys());
  // Identifier-boundary match: `a.b.NodeService` must NOT hit inside
  // `a.b.NodeServiceImpl` (substring false positive would wrongly mark the
  // interface as config-wired).
  const mentionsFqn = (text: string, fqn: string): boolean => {
    let from = 0;
    for (;;) {
      const i = text.indexOf(fqn, from);
      if (i < 0) return false;
      const next = text.charAt(i + fqn.length);
      if (!/[\w$.]/.test(next)) return true;
      from = i + 1;
    }
  };
  for (const resPath of resourceXmlFiles) {
    try {
      const text = fs.readFileSync(resPath, 'utf8');
      const mentioned = allFqns.filter((fqn) => mentionsFqn(text, fqn));
      if (mentioned.length > 0) configReferences.set(relPath(resPath), mentioned);
    } catch {
      // tolerant: unreadable resources are simply not signals
    }
  }

  const stripGenerics = (t: string): string => t.replace(/<.*>$/, '').trim();
  const lastSegment = (t: string): string => {
    const s = stripGenerics(t);
    return s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
  };

  return {
    rootDir,
    classesByFqn,
    classesBySimpleName,
    parseErrors,
    configReferences,
    __pinnedTrees: pinnedTrees,
    implementationsOf(interfaceSimpleOrFqn: string): JavaClassInfo[] {
      const wanted = lastSegment(interfaceSimpleOrFqn);
      const impls: JavaClassInfo[] = [];
      for (const cls of classesByFqn.values()) {
        if (cls.kind !== 'class') continue;
        if (cls.interfaces.some((i) => lastSegment(i) === wanted)) impls.push(cls);
      }
      impls.sort((a, b) => (a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0));
      return impls;
    },
    subclassesOf(classSimpleOrFqn: string): JavaClassInfo[] {
      // Transitive BFS over the direct extends-relation; cycle-safe via the
      // seen set (a superclass cycle is invalid Java but hostile input is
      // tolerated everywhere in this index).
      const out: JavaClassInfo[] = [];
      const seen = new Set<string>();
      let wanted = [lastSegment(classSimpleOrFqn)];
      while (wanted.length > 0) {
        const next: string[] = [];
        for (const cls of classesByFqn.values()) {
          if (cls.kind !== 'class' || !cls.superClass || seen.has(cls.fqn)) continue;
          if (wanted.includes(lastSegment(cls.superClass))) {
            seen.add(cls.fqn);
            out.push(cls);
            next.push(cls.simpleName);
          }
        }
        wanted = next;
      }
      out.sort((a, b) => (a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0));
      return out;
    },
  };
}
