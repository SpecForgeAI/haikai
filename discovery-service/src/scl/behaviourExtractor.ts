/**
 * SCL behaviour extractor — `[T-...]` behaviour tables + `[Q-...]` boundary
 * contracts from a Java project index.
 *
 * Deterministic (no LLM). Pass 2 of the SCL slicer:
 *
 *   - BOUNDARIES first: a project class whose simple name ends with 'Dao' /
 *     'Repository' (or carries @Repository) becomes ONE `[Q-...]` boundary
 *     contract with one operation per public method (verbatim SQL from the
 *     String constant the method references, result shape resolved to its
 *     S-key). Boundary methods get NO behaviour tables — extraction stops at
 *     the boundary.
 *   - Every OTHER project-class method with a body gets an `[T-...]`
 *     behaviour table (accessors and inline-trivial methods excepted): rows
 *     are the method's control-flow arms in source order with VERBATIM
 *     conditions / outcomes and file:line cites. Calls to project methods
 *     resolve to `call` outcomes; interface calls with 2+ implementations
 *     become `dispatch` rows plus a LOUD `dispatch_ambiguity` finding.
 *   - INLINE-TRIVIAL callees (<=1 effective top-level statement, no control
 *     flow, no throws, no project calls — e.g. `CookieUtils.readSsoCookie`)
 *     get NO table; their calls stay inside the calling row's verbatim text
 *     and their symbols are recorded in `inlined` for testability.
 *   - Keys are content-hashed over a canonical body whose call rows carry
 *     `targetSymbol` (never `targetKey`), so key assignment is
 *     order-independent; `targetKey` + `references` are filled in a second
 *     pass and the contentHash is computed INCLUDING the resolved references.
 *   - COMPLEXITY BUDGET: {@link MAX_ROWS_PER_TABLE} rows per table; beyond it
 *     the table is truncated LOUDLY (a `complexity_truncated` finding plus a
 *     final `/* TRUNCATED *\/` terminal row) — never silently.
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md ("SCL",
 * `[T-...]` behaviour tables / `[Q-...]` boundary contracts).
 */

import {
  collectNodesOfType,
  type JavaClassInfo,
  type JavaFieldInfo,
  type JavaMethodInfo,
  type JavaProjectIndex,
  type SyntaxNode,
} from './javaProjectIndex';
import {
  contentHashOf,
  contractKey,
  type SclBehaviourTable,
  type SclBoundaryContract,
  type SclBoundaryOperation,
  type SclFinding,
  type SclOutcome,
  type SclRow,
  type SclRowOutcome,
  type SclSourceRef,
} from './sclTypes';

/** Default per-table row budget. Exceeding it truncates LOUDLY (finding + marker row). */
export const MAX_ROWS_PER_TABLE = 60;

export interface BehaviourExtractionOptions {
  /** Overrides {@link MAX_ROWS_PER_TABLE}. */
  maxRowsPerTable?: number;
}

export interface BehaviourExtractionResult {
  /** Sorted by symbol. */
  tables: SclBehaviourTable[];
  /** Sorted by symbol (class FQN). */
  boundaries: SclBoundaryContract[];
  /** Deduplicated, sorted (kind, symbol, detail). */
  findings: SclFinding[];
  /**
   * Table symbol → T-key, plus boundary class FQN and boundary method
   * symbols → Q-key.
   */
  keyBySymbol: Map<string, string>;
  /**
   * Symbols of inline-trivial methods whose tables were suppressed (their
   * call sites keep the call verbatim instead of referencing them). Sorted.
   * Getter/setter accessors are skipped silently and NOT listed here.
   */
  inlined: string[];
}

// ---------------------------------------------------------------------------
// Type resolution (same discipline as shapeExtractor)
// ---------------------------------------------------------------------------

function stripGenerics(t: string): string {
  const i = t.indexOf('<');
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

function packageOf(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i >= 0 ? fqn.slice(0, i) : '';
}

/**
 * Resolves a declared type text to a project class, using (in order): exact
 * FQN, the owner's imports, the owner's own package, then a UNIQUE
 * simple-name match across the project. Null when not a project type.
 */
function resolveProjectType(
  typeText: string,
  owner: JavaClassInfo,
  index: JavaProjectIndex
): JavaClassInfo | null {
  const bare = stripGenerics(typeText);
  if (bare.includes('.')) {
    return index.classesByFqn.get(bare) || null;
  }
  for (const imp of owner.imports) {
    if (imp.endsWith(`.${bare}`)) {
      return index.classesByFqn.get(imp) || null;
    }
  }
  const samePackage = index.classesByFqn.get(`${packageOf(owner.fqn)}.${bare}`);
  if (samePackage) return samePackage;
  const bySimple = index.classesBySimpleName.get(bare) || [];
  return bySimple.length === 1 ? bySimple[0] : null;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

const COMMENT_TYPES = new Set(['line_comment', 'block_comment']);

function namedNonComment(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && !COMMENT_TYPES.has(c.type)) out.push(c);
  }
  return out;
}

/** Statements of a block, or the single statement itself when there are no braces. */
function blockStatements(node: SyntaxNode): SyntaxNode[] {
  return node.type === 'block' ? namedNonComment(node) : [node];
}

const CONTROL_FLOW_TYPES = [
  'if_statement',
  'switch_expression',
  'switch_statement',
  'try_statement',
  'try_with_resources_statement',
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
];

function hasControlFlow(body: SyntaxNode): boolean {
  return CONTROL_FLOW_TYPES.some((t) => collectNodesOfType(body, t).length > 0);
}

/** `throw new X(...)` → 'throws:X' (simple name); otherwise 'throws:unknown'. */
function throwsLabel(throwText: string): string {
  const m = throwText.match(/throw\s+new\s+([A-Za-z_$][\w$.]*)/);
  if (m) {
    const s = m[1];
    return `throws:${s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s}`;
  }
  return 'throws:unknown';
}

/**
 * Exact source text of a condition, outer syntactic parens stripped.
 * Grammar note: newer tree-sitter-java grammars type the `if (...)` condition
 * node `parenthesized_expression`; the 0.20.x grammar (the tree-sitter-wasms
 * build) types it `condition`. Both are a parenthesized wrapper around one
 * named expression child.
 */
function conditionText(cond: SyntaxNode): string {
  if (cond.type === 'parenthesized_expression' || cond.type === 'condition') {
    const inner = namedNonComment(cond);
    if (inner.length === 1) return inner[0].text;
  }
  return cond.text;
}

function outcomeKindOf(label: string): SclOutcome['kind'] {
  if (label.startsWith('throws:')) return 'throws';
  if (label === 'effect') return 'effect';
  return 'value';
}

function methodSymbol(m: JavaMethodInfo): string {
  return `${m.classFqn}#${m.name}(${m.paramTypes.join(',')})`;
}

/** Non-private/protected. Interface (body-less) methods count as public. */
function isPublicMethod(m: JavaMethodInfo): boolean {
  if (!m.bodyNode) return true;
  const decl = m.bodyNode.parent;
  if (!decl) return true;
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i);
    if (c && c.type === 'modifiers' && /\b(private|protected)\b/.test(c.text)) return false;
  }
  return true;
}

/** Declared-type lookup for an identifier: params, then locals, then class fields. */
function buildDeclaredTypeLookup(
  cls: JavaClassInfo,
  method: JavaMethodInfo
): (identifier: string) => string | null {
  const localTypes = new Map<string, string>();
  if (method.bodyNode) {
    for (const local of collectNodesOfType(method.bodyNode, 'local_variable_declaration')) {
      const typeNode = local.childForFieldName('type');
      if (!typeNode) continue;
      for (let i = 0; i < local.namedChildCount; i++) {
        const decl = local.namedChild(i);
        if (!decl || decl.type !== 'variable_declarator') continue;
        const nm = decl.childForFieldName('name');
        if (nm) localTypes.set(nm.text, typeNode.text);
      }
    }
  }
  return (identifier: string): string | null => {
    const paramIdx = method.paramNames.indexOf(identifier);
    if (paramIdx >= 0) return method.paramTypes[paramIdx];
    const local = localTypes.get(identifier);
    if (local) return local;
    const field = cls.fields.find((f) => f.name === identifier);
    return field ? field.type : null;
  };
}

/** Method lookup by name, arity as tiebreak when the name is overloaded. */
function findMethod(cls: JavaClassInfo, name: string, argCount: number): JavaMethodInfo | null {
  const byName = cls.methods.filter((m) => m.name === name);
  if (byName.length === 0) return null;
  if (byName.length === 1) return byName[0];
  return byName.find((m) => m.paramTypes.length === argCount) ?? byName[0];
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type MethodClass = 'accessor' | 'trivial' | 'table';

type CallResolution =
  | { kind: 'call'; symbol: string; targetKey: string | null }
  | { kind: 'dispatch'; symbol: string; candidates: string[] }
  | { kind: 'inline'; symbol: string };

type RowDraft = Omit<SclRow, 'index'>;

interface TableDraft {
  symbol: string;
  sourcePath: string;
  startLine: number;
  signatureInputs: Array<{ name: string; typeRef: string }>;
  outcomeSignature: SclOutcome[];
  annotations: string[];
  rows: SclRow[];
  key: string;
}

const BOUNDARY_NAME_RE = /(?:Dao|Repository)$/;

function lastTypeSegment(t: string): string {
  const s = t.replace(/<.*>$/, '').trim();
  return s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
}

function isBoundaryClass(cls: JavaClassInfo): boolean {
  if (cls.kind === 'enum') return false;
  if (BOUNDARY_NAME_RE.test(cls.simpleName)) return true;
  if (cls.annotations.some((a) => /^@Repository(\(|$)/.test(a))) return true;
  // The DAO-interface + Impl idiom (2026-08-21 live diagnosis): the
  // INTERFACE matches the name rule but is bodyless, while the class with
  // the actual SQL is `XxxDaoImpl implements XxxDao` (or extends an
  // abstract `XxxDao`) — previously never boundary-classified, so its SQL
  // was invisible and every walk ended on the blind interface contract.
  if (cls.kind === 'class') {
    if (cls.interfaces.some((i) => BOUNDARY_NAME_RE.test(lastTypeSegment(i)))) return true;
    if (cls.superClass && BOUNDARY_NAME_RE.test(lastTypeSegment(cls.superClass))) return true;
  }
  return false;
}

/**
 * Extracts all `[T-...]` behaviour tables and `[Q-...]` boundary contracts
 * from the project index. `shapeKeyBySymbol` is the shape extractor's
 * FQN → S-key map (signature inputs and boundary result shapes resolve
 * through it).
 */
export function extractBehaviour(
  index: JavaProjectIndex,
  shapeKeyBySymbol: Map<string, string>,
  options?: BehaviourExtractionOptions
): BehaviourExtractionResult {
  const maxRows = options?.maxRowsPerTable ?? MAX_ROWS_PER_TABLE;
  const findings: SclFinding[] = [];

  // -------------------------------------------------------------------------
  // 1. Boundary contracts (extraction stops here — no tables for these).
  // -------------------------------------------------------------------------

  const resolveResultShape = (m: JavaMethodInfo, cls: JavaClassInfo): string | null => {
    let t = m.returnType.trim();
    let match: RegExpMatchArray | null;
    while ((match = t.match(/^(?:java\.util\.)?(?:List|Set|Collection|Optional)<(.+)>$/))) {
      t = match[1].trim();
    }
    const project = resolveProjectType(t, cls, index);
    const sKey = project ? shapeKeyBySymbol.get(project.fqn) : undefined;
    return sKey ?? m.returnType;
  };

  // SQL-ish text detector (2026-08-21 widened): SELECT-family verbs PLUS the
  // stored-procedure idioms legacy Sybase DAOs actually use —
  // CallableStatement "{call dbo.sp_x(?)}" and raw "exec sp_x" — which the
  // old verb-only regex missed entirely (live diagnosis: every DAO op showed
  // sql 0 although the walks completed).
  const SQL_TEXT_RE =
    /\b(select|insert|update|delete|exec|execute|merge|truncate)\b|\{\s*call\s/i;

  const isStringConstField = (f: JavaFieldInfo): boolean =>
    f.type === 'String' && f.initializer !== null && f.initializer.startsWith('"');

  // Gather EVERY string source one method body touches (2026-08-21):
  //   (a) same-class String constants referenced by identifier;
  //   (b) CROSS-CLASS constants (`SqlConstants.GET_VIEWS` field access);
  //   (c) all in-body string literals, so concatenated fragments
  //       ("SELECT a " + "FROM t") reassemble instead of losing the
  //       FROM clause.
  // The pieces are space-joined; SQL is claimed only when the joined text
  // is SQL-ish, so log-message-only methods stay null.
  const mineSqlFromMethod = (
    owner: JavaClassInfo,
    m: JavaMethodInfo
  ): { sqlVerbatim: string; ref: SclSourceRef } | null => {
    if (!m.bodyNode) return null;
    const ownerConsts = owner.fields.filter(isStringConstField);
    const pieces: Array<{ text: string; path: string; line: number }> = [];
    const seenPiece = new Set<string>();
    const push = (text: string, path: string, line: number): void => {
      if (seenPiece.has(text)) return;
      seenPiece.add(text);
      pieces.push({ text, path, line });
    };
    const ids = new Set(collectNodesOfType(m.bodyNode, 'identifier').map((n) => n.text));
    for (const f of ownerConsts) {
      if (ids.has(f.name)) push(f.initializer as string, owner.filePath, f.line);
    }
    for (const fa of collectNodesOfType(m.bodyNode, 'field_access')) {
      const obj = fa.childForFieldName('object');
      const fld = fa.childForFieldName('field');
      if (!obj || !fld || obj.type !== 'identifier') continue;
      const target = resolveProjectType(obj.text, owner, index);
      const constant = target?.fields.find((f) => f.name === fld.text && isStringConstField(f));
      if (constant) push(constant.initializer as string, target!.filePath, constant.line);
    }
    for (const lit of collectNodesOfType(m.bodyNode, 'string_literal')) {
      push(lit.text, owner.filePath, lit.startPosition.row + 1);
    }
    const joined = pieces.map((p) => p.text).join(' ');
    if (!SQL_TEXT_RE.test(joined)) return null;
    const first = pieces.find((p) => SQL_TEXT_RE.test(p.text)) ?? pieces[0];
    return { sqlVerbatim: joined, ref: { path: first.path, line: first.line } };
  };

  const buildBoundary = (cls: JavaClassInfo): SclBoundaryContract => {
    // Bodyless ops (interface methods / abstract methods) mine their SQL
    // from the IMPLEMENTING classes' matching methods (2026-08-21: the
    // DAO-interface + Impl idiom left interface boundaries blind).
    const implementors =
      cls.kind === 'interface'
        ? index.implementationsOf(cls.fqn)
        : index.subclassesOf(cls.fqn);
    const operations: SclBoundaryOperation[] = [];
    for (const m of cls.methods) {
      if (!isPublicMethod(m)) continue;
      let mined = mineSqlFromMethod(cls, m);
      if (!mined && !m.bodyNode) {
        for (const impl of implementors) {
          const im = findMethod(impl, m.name, m.paramTypes.length);
          const implMined = im ? mineSqlFromMethod(impl, im) : null;
          if (implMined) {
            mined = mined
              ? { sqlVerbatim: `${mined.sqlVerbatim} ${implMined.sqlVerbatim}`, ref: mined.ref }
              : implMined;
          }
        }
      }
      operations.push({
        name: m.name,
        sqlVerbatim: mined?.sqlVerbatim ?? null,
        ref: mined?.ref ?? null,
        resultShape: resolveResultShape(m, cls),
      });
    }
    const canonical = {
      kind: 'boundary' as const,
      symbol: cls.fqn,
      sourcePath: cls.filePath,
      operations,
    };
    return { key: contractKey('Q', canonical), ...canonical, contentHash: contentHashOf(canonical) };
  };

  const boundaryClasses = Array.from(index.classesByFqn.values())
    .filter(isBoundaryClass)
    .sort((a, b) => (a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0));
  const boundaryClassFqns = new Set(boundaryClasses.map((c) => c.fqn));
  const boundaries: SclBoundaryContract[] = [];
  const boundaryKeyBySymbol = new Map<string, string>();
  for (const cls of boundaryClasses) {
    const contract = buildBoundary(cls);
    boundaries.push(contract);
    boundaryKeyBySymbol.set(cls.fqn, contract.key);
    for (const m of cls.methods) {
      if (isPublicMethod(m)) boundaryKeyBySymbol.set(methodSymbol(m), contract.key);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Method classification: accessor skip, inline-trivial skip, or table.
  // -------------------------------------------------------------------------

  const hasProjectCall = (cls: JavaClassInfo, method: JavaMethodInfo): boolean => {
    if (!method.bodyNode) return false;
    const declaredTypeOf = buildDeclaredTypeLookup(cls, method);
    for (const inv of collectNodesOfType(method.bodyNode, 'method_invocation')) {
      const nameNode = inv.childForFieldName('name');
      if (!nameNode) continue;
      const objectNode = inv.childForFieldName('object');
      if (!objectNode || objectNode.type === 'this') {
        if (cls.methods.some((m) => m !== method && m.name === nameNode.text)) return true;
        continue;
      }
      if (objectNode.type === 'identifier') {
        const declared = declaredTypeOf(objectNode.text);
        const target = declared
          ? resolveProjectType(declared, cls, index)
          : resolveProjectType(objectNode.text, cls, index);
        if (target) return true;
      }
    }
    return false;
  };

  const classify = (cls: JavaClassInfo, method: JavaMethodInfo): MethodClass => {
    const body = method.bodyNode as SyntaxNode;
    const statements = namedNonComment(body);
    const nonDeclCount = statements.filter((s) => s.type !== 'local_variable_declaration').length;
    const controlFlow = hasControlFlow(body);
    const throws = collectNodesOfType(body, 'throw_statement').length > 0;
    const projectCall = hasProjectCall(cls, method);
    if (
      /^(get|set|is)[A-Z]/.test(method.name) &&
      statements.length <= 2 &&
      !controlFlow &&
      !throws &&
      !projectCall
    ) {
      return 'accessor';
    }
    if (nonDeclCount <= 1 && !controlFlow && !throws && !projectCall) {
      return 'trivial';
    }
    return 'table';
  };

  const classificationByMethod = new Map<JavaMethodInfo, MethodClass>();
  const inlinedSet = new Set<string>();
  for (const cls of index.classesByFqn.values()) {
    if (cls.kind === 'interface' || boundaryClassFqns.has(cls.fqn)) continue;
    for (const m of cls.methods) {
      if (!m.bodyNode) continue;
      const c = classify(cls, m);
      classificationByMethod.set(m, c);
      if (c === 'trivial') inlinedSet.add(methodSymbol(m));
    }
  }

  // -------------------------------------------------------------------------
  // 3. Row extraction per table method.
  // -------------------------------------------------------------------------

  const classResolution = (targetClass: JavaClassInfo, target: JavaMethodInfo): CallResolution => {
    const sym = methodSymbol(target);
    if (boundaryClassFqns.has(targetClass.fqn)) {
      return {
        kind: 'call',
        symbol: sym,
        targetKey: boundaryKeyBySymbol.get(sym) ?? boundaryKeyBySymbol.get(targetClass.fqn) ?? null,
      };
    }
    const cl = classificationByMethod.get(target);
    if (cl === 'accessor' || cl === 'trivial') return { kind: 'inline', symbol: sym };
    return { kind: 'call', symbol: sym, targetKey: null };
  };

  const buildRowsForMethod = (cls: JavaClassInfo, method: JavaMethodInfo): RowDraft[] => {
    const declaredTypeOf = buildDeclaredTypeLookup(cls, method);
    const ref = (node: SyntaxNode): SclSourceRef => ({
      path: method.filePath,
      line: node.startPosition.row + 1,
    });

    const resolveInvocation = (inv: SyntaxNode): CallResolution | null => {
      const nameNode = inv.childForFieldName('name');
      if (!nameNode) return null;
      const objectNode = inv.childForFieldName('object');
      let targetClass: JavaClassInfo | null = null;
      if (!objectNode || objectNode.type === 'this') {
        targetClass = cls.methods.some((m) => m.name === nameNode.text) ? cls : null;
      } else if (objectNode.type === 'identifier') {
        const declared = declaredTypeOf(objectNode.text);
        // Field/param/local receiver by declared type; otherwise a static
        // `Cls.m(...)` call resolved by class name.
        targetClass = declared
          ? resolveProjectType(declared, cls, index)
          : resolveProjectType(objectNode.text, cls, index);
      } else if (objectNode.type === 'field_access') {
        const fo = objectNode.childForFieldName('object');
        const fieldNode = objectNode.childForFieldName('field');
        if (fo && fieldNode && fo.type === 'this') {
          const declared = declaredTypeOf(fieldNode.text);
          if (declared) targetClass = resolveProjectType(declared, cls, index);
        }
      }
      if (!targetClass) return null;
      const argsNode = inv.childForFieldName('arguments');
      const argCount = argsNode ? namedNonComment(argsNode).length : 0;

      // A call whose DECLARED type is a boundary class (interface, abstract
      // base, or concrete DAO) is the data layer — route it straight to that
      // boundary contract (2026-08-21: interface dispatch used to resolve to
      // the Impl's behaviour TABLE, a dead end that hid the DAO entirely).
      if (boundaryClassFqns.has(targetClass.fqn)) {
        const bm = findMethod(targetClass, nameNode.text, argCount);
        const sym = bm ? methodSymbol(bm) : `${targetClass.fqn}#${nameNode.text}(?)`;
        return {
          kind: 'call',
          symbol: sym,
          targetKey:
            boundaryKeyBySymbol.get(sym) ?? boundaryKeyBySymbol.get(targetClass.fqn) ?? null,
        };
      }

      if (targetClass.kind === 'interface') {
        const ifaceMethod = findMethod(targetClass, nameNode.text, argCount);
        if (!ifaceMethod) return null;
        const impls = index.implementationsOf(targetClass.fqn);
        if (impls.length === 0) return null;
        if (impls.length === 1) {
          const implMethod = findMethod(impls[0], nameNode.text, argCount);
          return implMethod ? classResolution(impls[0], implMethod) : null;
        }
        const candidates = impls.map((impl) => {
          const m = findMethod(impl, nameNode.text, argCount);
          return m ? methodSymbol(m) : `${impl.fqn}#${nameNode.text}(?)`;
        });
        return { kind: 'dispatch', symbol: methodSymbol(ifaceMethod), candidates };
      }
      const target = findMethod(targetClass, nameNode.text, argCount);
      if (target && target.bodyNode) return classResolution(targetClass, target);
      // Abstract-class dispatch (2026-08-21): the declared type is a CLASS but
      // the matched method has no body (abstract) or is absent — the
      // factory/loader pattern (abstract base, concrete subclasses picked at
      // runtime). Devirtualize exactly like interface dispatch, over the
      // transitive subclasses. Previously these calls stayed unresolved
      // forever, so the whole downstream chain (assembler closure, effect
      // walk) broke at every factory call site.
      const subs = index.subclassesOf(targetClass.fqn);
      if (subs.length > 0) {
        const overrides: Array<{ cls: JavaClassInfo; method: JavaMethodInfo }> = [];
        for (const sub of subs) {
          const m = findMethod(sub, nameNode.text, argCount);
          if (m && m.bodyNode) overrides.push({ cls: sub, method: m });
        }
        if (overrides.length === 1) {
          return classResolution(overrides[0].cls, overrides[0].method);
        }
        if (overrides.length > 1) {
          return {
            kind: 'dispatch',
            symbol: target
              ? methodSymbol(target)
              : `${targetClass.fqn}#${nameNode.text}(?)`,
            candidates: overrides.map((o) => methodSymbol(o.method)),
          };
        }
      }
      return target ? classResolution(targetClass, target) : null;
    };

    const firstResolution = (stmt: SyntaxNode): CallResolution | null => {
      for (const inv of collectNodesOfType(stmt, 'method_invocation')) {
        const r = resolveInvocation(inv);
        if (r) return r;
      }
      return null;
    };

    const recordDispatch = (res: Extract<CallResolution, { kind: 'dispatch' }>): void => {
      findings.push({
        kind: 'dispatch_ambiguity',
        symbol: methodSymbol(method),
        detail: `unresolved dynamic dispatch of ${res.symbol}: ${res.candidates.length} project implementations`,
        candidates: [...res.candidates].sort(),
      });
    };

    /** Row for a plain statement that contains a resolvable project call. */
    function statementRow(stmt: SyntaxNode): RowDraft | null {
      const res = firstResolution(stmt);
      if (!res) return null;
      if (res.kind === 'dispatch') {
        recordDispatch(res);
        return {
          kind: 'dispatch',
          conditionVerbatim: null,
          conditionRef: ref(stmt),
          outcome: { type: 'call', targetKey: null, targetSymbol: res.symbol },
        };
      }
      if (res.kind === 'inline') {
        // Inline-trivial / accessor callee: the call stays verbatim.
        return {
          kind: 'branch',
          conditionVerbatim: null,
          conditionRef: ref(stmt),
          outcome: { type: 'terminal', verbatim: stmt.text, ref: ref(stmt), outcomeLabel: 'effect' },
        };
      }
      return {
        kind: 'branch',
        conditionVerbatim: null,
        conditionRef: ref(stmt),
        outcome: { type: 'call', targetKey: res.targetKey, targetSymbol: res.symbol },
      };
    }

    function returnRow(stmt: SyntaxNode): RowDraft {
      const res = firstResolution(stmt);
      if (res && res.kind === 'dispatch') {
        recordDispatch(res);
        return {
          kind: 'dispatch',
          conditionVerbatim: null,
          conditionRef: ref(stmt),
          outcome: { type: 'call', targetKey: null, targetSymbol: res.symbol },
        };
      }
      if (res && res.kind === 'call') {
        return {
          kind: 'terminal',
          conditionVerbatim: null,
          conditionRef: null,
          outcome: { type: 'call', targetKey: res.targetKey, targetSymbol: res.symbol },
        };
      }
      // Inline resolutions keep the call inside the verbatim return.
      return {
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: {
          type: 'terminal',
          verbatim: stmt.text,
          ref: ref(stmt),
          outcomeLabel: `value:${method.returnType}`,
        },
      };
    }

    function throwRow(stmt: SyntaxNode): RowDraft {
      return {
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: {
          type: 'terminal',
          verbatim: stmt.text,
          ref: ref(stmt),
          outcomeLabel: throwsLabel(stmt.text),
        },
      };
    }

    function loopRow(stmt: SyntaxNode): RowDraft {
      const body = stmt.childForFieldName('body');
      const header = body
        ? method.sourceText.slice(stmt.startIndex, body.startIndex).trim()
        : stmt.text;
      let outcome: SclRowOutcome | null = null;
      if (body) {
        const terminals = [
          ...collectNodesOfType(body, 'return_statement'),
          ...collectNodesOfType(body, 'throw_statement'),
        ].sort((a, b) => a.startIndex - b.startIndex);
        if (terminals.length > 0) {
          const t = terminals[0];
          outcome = {
            type: 'terminal',
            verbatim: t.text,
            ref: ref(t),
            outcomeLabel:
              t.type === 'throw_statement' ? throwsLabel(t.text) : `value:${method.returnType}`,
          };
        }
      }
      // Loops = map/filter row semantics (design doc): a loop body that
      // contains a resolvable project call IS a behavioural edge — without it
      // the corpus closure would silently lose the callee (observed on the
      // fixture: NightlyRollupJob#run's per-node findNode call). Terminals in
      // the body still win (they end the enclosing method); otherwise the
      // first resolvable call/dispatch in the body becomes the loop outcome.
      if (!outcome && body) {
        const res = firstResolution(body);
        if (res && res.kind === 'dispatch') {
          recordDispatch(res);
          outcome = { type: 'call', targetKey: null, targetSymbol: res.symbol };
        } else if (res && res.kind === 'call') {
          outcome = { type: 'call', targetKey: res.targetKey, targetSymbol: res.symbol };
        }
      }
      if (!outcome) {
        outcome = { type: 'terminal', verbatim: header, ref: ref(stmt), outcomeLabel: 'value' };
      }
      return { kind: 'loop', conditionVerbatim: header, conditionRef: ref(stmt), outcome };
    }

    function catchRow(clause: SyntaxNode): RowDraft {
      const body = clause.childForFieldName('body');
      const param = collectNodesOfType(clause, 'catch_formal_parameter')[0] ?? null;
      let exceptionType = 'unknown';
      if (param) {
        const t = collectNodesOfType(param, 'catch_type')[0] ?? param.namedChild(0);
        if (t) exceptionType = t.text;
      }
      let primary: SyntaxNode | null = null;
      if (body) {
        const candidates = [
          ...collectNodesOfType(body, 'return_statement'),
          ...collectNodesOfType(body, 'throw_statement'),
        ].sort((a, b) => a.startIndex - b.startIndex);
        primary = candidates[0] ?? null;
      }
      const thenVerbatim = primary ? primary.text : body ? body.text : clause.text;
      const outcomeLabel = primary
        ? primary.type === 'throw_statement'
          ? throwsLabel(primary.text)
          : `value:${method.returnType}`
        : 'absorbed';
      const header = body
        ? method.sourceText.slice(clause.startIndex, body.startIndex).trim()
        : null;
      return {
        kind: 'catch',
        conditionVerbatim: header,
        conditionRef: ref(clause),
        outcome: {
          type: 'absorb',
          exceptionType,
          thenVerbatim,
          ref: ref(primary ?? clause),
          outcomeLabel,
        },
      };
    }

    /**
     * Rows for one branch arm. A simple arm (whose body yields no rows or a
     * single unconditioned row) collapses to ONE 'branch' row carrying the
     * arm's condition; a complex arm contributes its inner rows in source
     * order (the guard split is already established by the sibling arms).
     */
    function armRows(condVerbatim: string, refNode: SyntaxNode, stmts: SyntaxNode[], depth: number): RowDraft[] {
      const inner = processStatements(stmts, depth + 1);
      if (inner.length === 0) {
        const last = stmts.length > 0 ? stmts[stmts.length - 1] : refNode;
        return [
          {
            kind: 'branch',
            conditionVerbatim: condVerbatim,
            conditionRef: ref(refNode),
            outcome: { type: 'terminal', verbatim: last.text, ref: ref(last), outcomeLabel: 'value' },
          },
        ];
      }
      if (
        inner.length === 1 &&
        inner[0].conditionVerbatim === null &&
        (inner[0].kind === 'terminal' || inner[0].kind === 'branch')
      ) {
        return [
          { ...inner[0], kind: 'branch', conditionVerbatim: condVerbatim, conditionRef: ref(refNode) },
        ];
      }
      return inner;
    }

    function processStatements(stmts: SyntaxNode[], depth: number): RowDraft[] {
      const rows: RowDraft[] = [];
      for (const stmt of stmts) {
        switch (stmt.type) {
          case 'if_statement': {
            let node: SyntaxNode | null = stmt;
            while (node) {
              const condNode = node.childForFieldName('condition');
              const consequence = node.childForFieldName('consequence');
              if (condNode && consequence) {
                rows.push(
                  ...armRows(conditionText(condNode), condNode, blockStatements(consequence), depth)
                );
              }
              const alternative: SyntaxNode | null = node.childForFieldName('alternative');
              if (alternative && alternative.type === 'if_statement') {
                node = alternative;
                continue;
              }
              if (alternative) {
                rows.push(...armRows('else', alternative, blockStatements(alternative), depth));
              }
              node = null;
            }
            break;
          }
          case 'switch_expression':
          case 'switch_statement': {
            const body = stmt.childForFieldName('body');
            if (body) {
              for (const group of namedNonComment(body)) {
                if (group.type !== 'switch_block_statement_group' && group.type !== 'switch_rule') {
                  continue;
                }
                const children = namedNonComment(group);
                const labelNode = children.find((c) => c.type === 'switch_label') ?? group;
                const caseStmts = children.filter((c) => c.type !== 'switch_label');
                rows.push(...armRows(labelNode.text, labelNode, caseStmts, depth));
              }
            }
            break;
          }
          case 'try_statement':
          case 'try_with_resources_statement': {
            const body = stmt.childForFieldName('body');
            if (body) rows.push(...processStatements(blockStatements(body), depth + 1));
            for (let i = 0; i < stmt.namedChildCount; i++) {
              const c = stmt.namedChild(i);
              if (!c) continue;
              if (c.type === 'catch_clause') {
                rows.push(catchRow(c));
              } else if (c.type === 'finally_clause') {
                const fb = namedNonComment(c).find((n) => n.type === 'block');
                if (fb) rows.push(...processStatements(namedNonComment(fb), depth + 1));
              }
            }
            break;
          }
          case 'for_statement':
          case 'enhanced_for_statement':
          case 'while_statement':
          case 'do_statement':
            rows.push(loopRow(stmt));
            break;
          case 'return_statement':
            rows.push(returnRow(stmt));
            break;
          case 'throw_statement':
            rows.push(throwRow(stmt));
            break;
          default: {
            const r = statementRow(stmt);
            if (r) rows.push(r);
            break;
          }
        }
      }
      return rows;
    }

    return processStatements(blockStatements(method.bodyNode as SyntaxNode), 0);
  };

  // -------------------------------------------------------------------------
  // 4. Draft tables (rows + signature), complexity budget applied per table.
  // -------------------------------------------------------------------------

  // Class-level routing annotations (@Path / @RequestMapping on the TYPE)
  // are prepended to each table's annotations (2026-08-21): a handler whose
  // method-level @Path is placeholders-only ("{date}/{id}") carries its
  // literal route prefix at class level, and without it such handlers have
  // no usable root fragment at all (the no_root_match diagnosis). Consumers
  // (`derivePathFragment` in the emitter + gateway) compose ALL @Path values
  // in order into one fragment.
  const CLASS_ROUTING_RE = /@(?:Path|RequestMapping)\s*\(/;

  const drafts: TableDraft[] = [];
  for (const cls of index.classesByFqn.values()) {
    if (cls.kind === 'interface' || boundaryClassFqns.has(cls.fqn)) continue;
    const classRoutingAnnotations = cls.annotations.filter((a) => CLASS_ROUTING_RE.test(a));
    for (const method of cls.methods) {
      if (!method.bodyNode || classificationByMethod.get(method) !== 'table') continue;
      const symbol = methodSymbol(method);

      let rowDrafts = buildRowsForMethod(cls, method);
      if (rowDrafts.length > maxRows) {
        const total = rowDrafts.length;
        rowDrafts = rowDrafts.slice(0, maxRows);
        rowDrafts.push({
          kind: 'terminal',
          conditionVerbatim: '/* TRUNCATED */',
          conditionRef: null,
          outcome: {
            type: 'terminal',
            verbatim: '/* TRUNCATED */',
            ref: { path: method.filePath, line: method.startLine },
            outcomeLabel: 'truncated',
          },
        });
        findings.push({
          kind: 'complexity_truncated',
          symbol,
          detail: `row budget exceeded: ${total} rows > ${maxRows}; table truncated — raise maxRowsPerTable or split the method`,
        });
      }
      const rows: SclRow[] = rowDrafts.map((r, i) => ({ index: i, ...r }));

      const signatureInputs = method.paramNames.map((name, i) => {
        const t = method.paramTypes[i];
        const project = resolveProjectType(t, cls, index);
        const sKey = project ? shapeKeyBySymbol.get(project.fqn) : undefined;
        return { name, typeRef: sKey ?? t };
      });

      const outcomeSignature: SclOutcome[] = [];
      const seenLabels = new Set<string>();
      for (const row of rows) {
        const label =
          row.outcome.type === 'call'
            ? `call:${row.outcome.targetSymbol}`
            : row.outcome.outcomeLabel;
        if (seenLabels.has(label)) continue;
        seenLabels.add(label);
        outcomeSignature.push({
          label,
          kind: row.outcome.type === 'call' ? 'value' : outcomeKindOf(label),
          detail: null,
        });
      }

      drafts.push({
        symbol,
        sourcePath: method.filePath,
        startLine: method.startLine,
        signatureInputs,
        outcomeSignature,
        annotations: [...classRoutingAnnotations, ...method.annotations],
        rows,
        key: '',
      });
    }
  }
  drafts.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));

  // -------------------------------------------------------------------------
  // 5. Key pass (order-independent: call rows keyed by targetSymbol, never
  //    targetKey), then reference fill + contentHash INCLUDING references.
  // -------------------------------------------------------------------------

  const canonicalOf = (d: TableDraft, rows: SclRow[]) => ({
    kind: 'behaviour_table' as const,
    symbol: d.symbol,
    sourcePath: d.sourcePath,
    startLine: d.startLine,
    signatureInputs: d.signatureInputs,
    outcomeSignature: d.outcomeSignature,
    annotations: d.annotations,
    rows,
  });

  const stripTargetKeys = (rows: SclRow[]): SclRow[] =>
    rows.map((r) =>
      r.outcome.type === 'call'
        ? { ...r, outcome: { type: 'call' as const, targetKey: null, targetSymbol: r.outcome.targetSymbol } }
        : r
    );

  const keyBySymbol = new Map<string, string>();
  for (const d of drafts) {
    d.key = contractKey('T', canonicalOf(d, stripTargetKeys(d.rows)));
    keyBySymbol.set(d.symbol, d.key);
  }
  for (const [sym, key] of boundaryKeyBySymbol) keyBySymbol.set(sym, key);

  const tables: SclBehaviourTable[] = drafts.map((d) => {
    const referenced = new Set<string>();
    for (const input of d.signatureInputs) {
      if (/^S-[0-9a-f]{12}$/.test(input.typeRef)) referenced.add(input.typeRef);
    }
    const rows: SclRow[] = d.rows.map((r) => {
      if (r.outcome.type !== 'call') return r;
      const targetKey = r.outcome.targetKey ?? keyBySymbol.get(r.outcome.targetSymbol) ?? null;
      if (targetKey) referenced.add(targetKey);
      return { ...r, outcome: { ...r.outcome, targetKey } };
    });
    const references = Array.from(referenced).sort();
    const body = { ...canonicalOf(d, rows), references };
    return { key: d.key, ...body, contentHash: contentHashOf(body) };
  });

  // Findings: dedup + deterministic order.
  const findingByIdentity = new Map<string, SclFinding>();
  for (const f of findings) {
    findingByIdentity.set(`${f.kind}|${f.symbol}|${f.detail}`, f);
  }
  const sortedFindings = Array.from(findingByIdentity.values()).sort((a, b) => {
    const ka = `${a.kind}|${a.symbol}|${a.detail}`;
    const kb = `${b.kind}|${b.symbol}|${b.detail}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    tables,
    boundaries,
    findings: sortedFindings,
    keyBySymbol,
    inlined: Array.from(inlinedSet).sort(),
  };
}
