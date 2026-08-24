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

/** Receiver-typing verdict shared by classification and row building. */
type ReceiverResolution = { cls: JavaClassInfo } | 'external' | 'unknown';

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

/** Declared-type lookup for an identifier: params, then locals, then class
 *  fields — INCLUDING fields inherited from project superclasses when an
 *  index is supplied (2026-08-21: `protected OrgDao dao;` on a base class
 *  used from a subclass method silently resolved external). */
function buildDeclaredTypeLookup(
  cls: JavaClassInfo,
  method: JavaMethodInfo,
  index?: JavaProjectIndex
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
    let owner: JavaClassInfo | null = cls;
    const seen = new Set<string>();
    while (owner && !seen.has(owner.fqn)) {
      seen.add(owner.fqn);
      const field = owner.fields.find((f) => f.name === identifier);
      if (field) return field.type;
      owner =
        index && owner.superClass ? resolveProjectType(owner.superClass, owner, index) : null;
    }
    return null;
  };
}

/** Method lookup by name, arity as tiebreak when the name is overloaded. */
function findMethod(cls: JavaClassInfo, name: string, argCount: number): JavaMethodInfo | null {
  const byName = cls.methods.filter((m) => m.name === name);
  if (byName.length === 0) return null;
  if (byName.length === 1) return byName[0];
  return byName.find((m) => m.paramTypes.length === argCount) ?? byName[0];
}

/**
 * Method lookup across the PROJECT type hierarchy: the class itself, then
 * its transitive project superclasses and (parent) interfaces, BFS order —
 * Java shadowing semantics (2026-08-21: `sub.commonThing()` declared only
 * on the base class used to resolve to nothing, silently).
 */
function findMethodInHierarchy(
  start: JavaClassInfo,
  name: string,
  argCount: number,
  index: JavaProjectIndex
): { owner: JavaClassInfo; method: JavaMethodInfo } | null {
  const queue: JavaClassInfo[] = [start];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const c = queue.shift() as JavaClassInfo;
    if (seen.has(c.fqn)) continue;
    seen.add(c.fqn);
    const m = findMethod(c, name, argCount);
    if (m) return { owner: c, method: m };
    if (c.superClass) {
      const parent = resolveProjectType(c.superClass, c, index);
      if (parent) queue.push(parent);
    }
    for (const i of c.interfaces) {
      const parent = resolveProjectType(i, c, index);
      if (parent) queue.push(parent);
    }
  }
  return null;
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

// Case-INSENSITIVE (2026-08-22 live diagnosis): the same estate mixes
// `LedgerDaoImpl` and `LedgerAttributeMetaDataDAOImpl` — an upper-cased `DAO`
// suffix never boundary-classified, so its SQL was invisible and chains
// through it died on an empty bodyless contract, silently.
const BOUNDARY_NAME_RE = /(?:dao|repository)$/i;

function lastTypeSegment(t: string): string {
  const s = t.replace(/<.*>$/, '').trim();
  return s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
}

const ENUM_SQL_HINT_RE = /\b(select|insert|update|delete|exec|truncate|merge)\b/i;

/** An enum whose constants carry SQL constructor args IS a boundary — the
 *  executor iterates values() and runs each constant's SQL (Kiro
 *  2026-08-24: the daily COB roll lived entirely in such an enum). */
function isSqlBearingEnum(cls: JavaClassInfo): boolean {
  return (
    cls.kind === 'enum' &&
    cls.fields.some(
      (f) => f.type === 'enum-constant' && !!f.initializer && ENUM_SQL_HINT_RE.test(f.initializer),
    )
  );
}

function isBoundaryClass(cls: JavaClassInfo): boolean {
  if (cls.kind === 'enum') return isSqlBearingEnum(cls);
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
    /\b(select|insert|update|delete|exec|execute|merge|truncate)\b|\{\s*(?:\?\s*=\s*)?call\s/i;

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

  /** Boundary `Fqn#method` targets a method body delegates to: a call on a
   *  FIELD whose declared type resolves to another boundary class (the
   *  DAO->DAO idiom). The interface FQN is recorded when the field is typed
   *  to the interface — its boundary contract mines SQL from implementors,
   *  so delegate resolution still lands on real tables. */
  const mineDelegationsFromMethod = (owner: JavaClassInfo, m: JavaMethodInfo): string[] => {
    if (!m.bodyNode) return [];
    const out: string[] = [];
    for (const inv of collectNodesOfType(m.bodyNode, 'method_invocation')) {
      const obj = inv.childForFieldName('object');
      const nameNode = inv.childForFieldName('name');
      if (!obj || !nameNode || obj.type !== 'identifier') continue;
      const field = owner.fields.find((f) => f.name === obj.text);
      if (!field) continue;
      const resolved = resolveProjectType(field.type, owner, index);
      if (!resolved || resolved.fqn === owner.fqn || !isBoundaryClass(resolved)) continue;
      const target = `${resolved.fqn}#${nameNode.text}`;
      if (!out.includes(target)) out.push(target);
    }
    return out;
  };

  /** Same-class methods a body calls with an implicit or `this` receiver —
   *  the private-helper idiom. A DAO's PUBLIC method is the contract unit;
   *  its private helpers are that op's implementation, so their SQL and
   *  their DAO->DAO delegations belong to the public op (Kiro 2026-08-24:
   *  a create op mined sql=null because its INSERT lives in a private
   *  insert-row helper, and every sequence-DAO delegation site is a private
   *  helper — so the sequence table looked untouched from every create
   *  endpoint and the write ops looked contribution-free). */
  const sameClassCallees = (owner: JavaClassInfo, m: JavaMethodInfo): JavaMethodInfo[] => {
    if (!m.bodyNode) return [];
    const out: JavaMethodInfo[] = [];
    for (const inv of collectNodesOfType(m.bodyNode, 'method_invocation')) {
      const obj = inv.childForFieldName('object');
      const nameNode = inv.childForFieldName('name');
      if (!nameNode) continue;
      // Implicit receiver (`helper(...)`) or explicit `this.helper(...)` only:
      // anything with a named receiver is a collaborator, not a helper.
      if (obj && obj.type !== 'this') continue;
      const target = owner.methods.find((x) => x.name === nameNode.text && x.name !== m.name);
      if (target && !out.includes(target)) out.push(target);
    }
    return out;
  };

  /** Transitive same-class helper closure (cycle-safe, depth-capped). */
  const expandSameClass = (owner: JavaClassInfo, m: JavaMethodInfo): JavaMethodInfo[] => {
    const seen = new Set<string>([m.name]);
    const acc: JavaMethodInfo[] = [];
    const queue: Array<{ m: JavaMethodInfo; d: number }> = [{ m, d: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift() as { m: JavaMethodInfo; d: number };
      if (cur.d > 5) continue;
      for (const callee of sameClassCallees(owner, cur.m)) {
        if (seen.has(callee.name)) continue;
        seen.add(callee.name);
        acc.push(callee);
        queue.push({ m: callee, d: cur.d + 1 });
      }
    }
    return acc;
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
      let delegations = mineDelegationsFromMethod(cls, m);
      /** Fold one method's private/same-class helper closure into this op. */
      const foldHelpers = (helperOwner: JavaClassInfo, from: JavaMethodInfo): void => {
        for (const helper of expandSameClass(helperOwner, from)) {
          const helperMined = mineSqlFromMethod(helperOwner, helper);
          if (helperMined) {
            mined = mined
              ? { sqlVerbatim: `${mined.sqlVerbatim} ${helperMined.sqlVerbatim}`, ref: mined.ref }
              : helperMined;
          }
          // The delegating FIELD lives on the helper's owner, so the owner
          // passed here must be the class that declares the helper.
          for (const target of mineDelegationsFromMethod(helperOwner, helper)) {
            if (!delegations.includes(target)) delegations = [...delegations, target];
          }
        }
      };
      foldHelpers(cls, m);
      if (!mined && !m.bodyNode) {
        for (const impl of implementors) {
          const found = findMethodInHierarchy(impl, m.name, m.paramTypes.length, index);
          const implMined = found ? mineSqlFromMethod(found.owner, found.method) : null;
          if (implMined) {
            mined = mined
              ? { sqlVerbatim: `${mined.sqlVerbatim} ${implMined.sqlVerbatim}`, ref: mined.ref }
              : implMined;
          }
          if (found) {
            for (const target of mineDelegationsFromMethod(found.owner, found.method)) {
              if (!delegations.includes(target)) delegations = [...delegations, target];
            }
            // An INTERFACE op's helpers live on the impl — mine them there.
            foldHelpers(found.owner, found.method);
          }
        }
      }
      operations.push({
        name: m.name,
        sqlVerbatim: mined?.sqlVerbatim ?? null,
        ref: mined?.ref ?? null,
        resultShape: resolveResultShape(m, cls),
        ...(delegations.length > 0 ? { delegatesTo: delegations } : {}),
      });
    }
    // Enum boundaries: each SQL-bearing constant is an operation named
    // after the constant. Method ops (getSql, values) stay sql-less, so a
    // reach through them falls back to the class-level union — exactly
    // right for `for (Op op : Op.values()) exec(op.getSql())`.
    if (cls.kind === 'enum') {
      for (const f of cls.fields) {
        if (f.type !== 'enum-constant' || !f.initializer) continue;
        const literals = f.initializer.match(/"((?:[^"\\]|\\.)*)"/g) ?? [];
        const sqlPieces = literals
          .map((lit) => lit.slice(1, -1))
          .filter((inner) => ENUM_SQL_HINT_RE.test(inner));
        if (sqlPieces.length === 0) continue;
        operations.push({
          name: f.name,
          sqlVerbatim: sqlPieces.join(' '),
          ref: { path: cls.filePath, line: f.line },
          resultShape: null,
        });
      }
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

  /**
   * Receiver typing (2026-08-21 sweep). Three-way verdict:
   *   {cls}      - receiver statically types to a project class;
   *   'external' - receiver is KNOWN and not a project type (JDK /
   *                framework calls stay silent by design);
   *   'unknown'  - the shape defeated static typing. Callers MUST go LOUD:
   *                silent losses made walks look complete and let
   *                proven-read fail open (verified live: chained and
   *                ternary receivers vanished without a trace).
   * Shared by CLASSIFICATION (inline suppression must never swallow a
   * possible project call) and ROW BUILDING.
   */
  const receiverResolverFor = (cls: JavaClassInfo, method: JavaMethodInfo) => {
    const declaredTypeOf = buildDeclaredTypeLookup(cls, method, index);

    /** Static-import call resolution: `import static com.x.SqlUtil.build;`
     *  (importsOf strips the `static` keyword - entries read
     *  `com.x.SqlUtil.build` / `com.x.SqlUtil.*`). External static imports
     *  (String.format) resolve to nothing here and stay silent. */
    const resolveStaticImport = (name: string): JavaClassInfo | null => {
      for (const imp of cls.imports) {
        const clsPart = imp.endsWith(`.${name}`)
          ? imp.slice(0, imp.length - name.length - 1)
          : imp.endsWith('.*')
            ? imp.slice(0, imp.length - 2)
            : null;
        if (!clsPart) continue;
        const resolved = index.classesByFqn.get(clsPart);
        if (resolved && resolved.methods.some((m) => m.name === name)) return resolved;
      }
      return null;
    };

    const resolveReceiver = (node: SyntaxNode, depth: number): ReceiverResolution => {
      if (depth > 4) return 'unknown';
      switch (node.type) {
        case 'this':
          return { cls };
        case 'identifier': {
          const declared = declaredTypeOf(node.text);
          const resolved = declared
            ? resolveProjectType(declared, cls, index)
            : // Static `Cls.m(...)` call resolved by class name.
              resolveProjectType(node.text, cls, index);
          return resolved ? { cls: resolved } : 'external';
        }
        case 'field_access': {
          // Fully-qualified static call (`com.x.Util.m(...)`): the whole
          // receiver text IS a type.
          const asType = resolveProjectType(node.text, cls, index);
          if (asType) return { cls: asType };
          const fo = node.childForFieldName('object');
          const fieldNode = node.childForFieldName('field');
          if (!fo || !fieldNode) return 'unknown';
          const owner = resolveReceiver(fo, depth + 1);
          if (owner === 'external' || owner === 'unknown') return owner;
          const field = owner.cls.fields.find((f) => f.name === fieldNode.text);
          if (!field) return 'external'; // inherited-from-framework field
          const fieldType = resolveProjectType(field.type, owner.cls, index);
          return fieldType ? { cls: fieldType } : 'external';
        }
        case 'cast_expression': {
          const typeNode = node.childForFieldName('type');
          const resolved = typeNode ? resolveProjectType(typeNode.text, cls, index) : null;
          return resolved ? { cls: resolved } : 'external';
        }
        case 'parenthesized_expression': {
          const inner = namedNonComment(node)[0] ?? null;
          return inner ? resolveReceiver(inner, depth + 1) : 'unknown';
        }
        case 'object_creation_expression': {
          const typeNode = node.childForFieldName('type');
          const resolved = typeNode ? resolveProjectType(typeNode.text, cls, index) : null;
          return resolved ? { cls: resolved } : 'external';
        }
        case 'array_access': {
          const arrayNode = node.childForFieldName('array');
          if (arrayNode && arrayNode.type === 'identifier') {
            const declared = declaredTypeOf(arrayNode.text);
            if (declared) {
              const element = resolveProjectType(declared.replace(/\[\s*\]/g, ''), cls, index);
              return element ? { cls: element } : 'external';
            }
          }
          return 'unknown';
        }
        case 'method_invocation': {
          // Return-type chaining: `Factory.make().run()` and the singleton
          // idiom `X.getInstance().save()` type the receiver as the INNER
          // call's declared return type. Fluent chains rooted in an
          // EXTERNAL type (Response.status(...).entity(...).build()) stay
          // silent; only a genuinely untypeable root goes loud.
          const inner = resolveCallTargetMethod(node, depth + 1);
          if (inner === 'external' || inner === 'unknown') return inner;
          const returnType = stripGenerics(inner.method.returnType);
          const resolved = resolveProjectType(returnType, inner.owner, index);
          return resolved ? { cls: resolved } : 'external';
        }
        case 'super': {
          const parent = cls.superClass ? resolveProjectType(cls.superClass, cls, index) : null;
          return parent ? { cls: parent } : 'external';
        }
        default:
          return 'unknown';
      }
    };

    /** The project method one invocation statically targets (receiver typed
     *  via resolveReceiver) - the chaining primitive. A project receiver
     *  whose method is not declared in the project resolves 'external'
     *  (inherited from a framework base), never loud. */
    const resolveCallTargetMethod = (
      inv: SyntaxNode,
      depth: number
    ): { owner: JavaClassInfo; method: JavaMethodInfo } | 'external' | 'unknown' => {
      const nameNode = inv.childForFieldName('name');
      if (!nameNode) return 'unknown';
      const argsNode = inv.childForFieldName('arguments');
      const argCount = argsNode ? namedNonComment(argsNode).length : 0;
      const objectNode = inv.childForFieldName('object');
      let owner: JavaClassInfo | null = null;
      if (!objectNode) {
        owner = cls.methods.some((m) => m.name === nameNode.text)
          ? cls
          : resolveStaticImport(nameNode.text);
        if (!owner) return 'external';
      } else {
        const receiver = resolveReceiver(objectNode, depth);
        if (receiver === 'external' || receiver === 'unknown') return receiver;
        owner = receiver.cls;
      }
      const found = findMethodInHierarchy(owner, nameNode.text, argCount, index);
      return found ?? 'external';
    };

    return { resolveReceiver, resolveStaticImport };
  };

  const CACHE_GET_NAMES = new Set(['get', 'getUnchecked', 'getIfPresent', 'getAll', 'getAllPresent']);

  const isCacheTypedField = (f: JavaFieldInfo): boolean =>
    /Cache$/.test(lastTypeSegment(f.type));

  /** TRUE when the invocation receiver names a Cache-typed field of `cls`
   *  (`cache.get(k)` / `this.cache.get(k)`). */
  const isCacheFieldReceiver = (cls: JavaClassInfo, objectNode: SyntaxNode): boolean => {
    const name =
      objectNode.type === 'identifier'
        ? objectNode.text
        : objectNode.type === 'field_access' &&
            objectNode.childForFieldName('object')?.type === 'this'
          ? objectNode.childForFieldName('field')?.text ?? ''
          : '';
    if (!name) return false;
    return cls.fields.some((f) => f.name === name && isCacheTypedField(f));
  };

  const hasProjectCall = (cls: JavaClassInfo, method: JavaMethodInfo): boolean => {
    if (!method.bodyNode) return false;
    const { resolveReceiver } = receiverResolverFor(cls, method);
    for (const inv of collectNodesOfType(method.bodyNode, 'method_invocation')) {
      const nameNode = inv.childForFieldName('name');
      if (!nameNode) continue;
      const objectNode = inv.childForFieldName('object');
      if (!objectNode || objectNode.type === 'this') {
        if (cls.methods.some((m) => m !== method && m.name === nameNode.text)) return true;
        continue;
      }
      // Full receiver typing (2026-08-21): a project-typed OR untypeable
      // receiver means this might be a project call - never inline it away
      // (a trivial-looking method whose only call had a ternary receiver
      // was inlined, deleting the loud unresolved row before it could
      // exist). External-rooted receivers stay inline-eligible.
      const receiver = resolveReceiver(objectNode, 0);
      if (receiver !== 'external') return true;
      // Cache-transparency (2026-08-23): `cache.get(...)` resolves external
      // (Guava) and used to make cache-front methods look call-free — they
      // inlined away and every read chain through a cache EVAPORATED. A
      // get-family call on a Cache-typed field is a project call in spirit
      // (the class's own loader runs on a miss).
      if (CACHE_GET_NAMES.has(nameNode.text) && isCacheFieldReceiver(cls, objectNode)) {
        return true;
      }
    }
    // Method references (`store::record`) are calls too — a project-typed
    // or untypeable ref receiver blocks inlining exactly like a call
    // (2026-08-21: a forEach(store::record) method was inline-suppressed,
    // deleting the ref row before it could exist).
    for (const refNode of collectNodesOfType(method.bodyNode, 'method_reference')) {
      const named = namedNonComment(refNode);
      if (named.length === 0) continue;
      const receiver = resolveReceiver(named[0], 0);
      if (receiver !== 'external') return true;
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

    const { resolveReceiver, resolveStaticImport } = receiverResolverFor(cls, method);

    /** Synthetic symbol for a LOUD unresolved call: `?#name(?,?)` — the
     *  arity survives, so the corpus-side name+arity dispatch expansion can
     *  still resolve it downstream; failing that it lands in broken_calls. */
    const unresolvedSymbol = (name: string, argCount: number): string =>
      `?#${name}(${Array.from({ length: argCount }, () => '?').join(',')})`;

    const resolveInvocation = (inv: SyntaxNode): CallResolution | null => {
      const nameNode = inv.childForFieldName('name');
      if (!nameNode) return null;
      const argsNode = inv.childForFieldName('arguments');
      const argCount = argsNode ? namedNonComment(argsNode).length : 0;
      const objectNode = inv.childForFieldName('object');

      let targetClass: JavaClassInfo | null = null;
      if (!objectNode) {
        targetClass = cls.methods.some((m) => m.name === nameNode.text)
          ? cls
          : resolveStaticImport(nameNode.text);
        if (!targetClass) return null; // implicit/external — silent by design
      } else {
        const receiver = resolveReceiver(objectNode, 0);
        if (receiver === 'external') return null;
        if (receiver === 'unknown') {
          return {
            kind: 'call',
            symbol: unresolvedSymbol(nameNode.text, argCount),
            targetKey: null,
          };
        }
        targetClass = receiver.cls;
      }

      // A call whose DECLARED type is a boundary class (interface, abstract
      // base, or concrete DAO) is the data layer — route it straight to that
      // boundary contract (2026-08-21: interface dispatch used to resolve to
      // the Impl's behaviour TABLE, a dead end that hid the DAO entirely).
      if (boundaryClassFqns.has(targetClass.fqn)) {
        const bm = findMethodInHierarchy(targetClass, nameNode.text, argCount, index);
        const sym = bm ? methodSymbol(bm.method) : `${targetClass.fqn}#${nameNode.text}(?)`;
        return {
          kind: 'call',
          symbol: sym,
          targetKey:
            boundaryKeyBySymbol.get(sym) ?? boundaryKeyBySymbol.get(targetClass.fqn) ?? null,
        };
      }

      if (targetClass.kind === 'interface') {
        // Hierarchy-aware: the method may be declared on a PARENT interface
        // and the impl's body may be inherited from an abstract base.
        const ifaceMethod = findMethodInHierarchy(targetClass, nameNode.text, argCount, index);
        if (!ifaceMethod) return null;
        const impls = index.implementationsOf(targetClass.fqn);
        if (impls.length === 0) return null;
        if (impls.length === 1) {
          const implMethod = findMethodInHierarchy(impls[0], nameNode.text, argCount, index);
          return implMethod ? classResolution(implMethod.owner, implMethod.method) : null;
        }
        const candidates = impls.map((impl) => {
          const m = findMethodInHierarchy(impl, nameNode.text, argCount, index);
          return m ? methodSymbol(m.method) : `${impl.fqn}#${nameNode.text}(?)`;
        });
        return { kind: 'dispatch', symbol: methodSymbol(ifaceMethod.method), candidates };
      }
      const found = findMethodInHierarchy(targetClass, nameNode.text, argCount, index);
      if (found && found.method.bodyNode) return classResolution(found.owner, found.method);
      const target = found?.method ?? null;
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
          const m = findMethodInHierarchy(sub, nameNode.text, argCount, index)?.method ?? null;
          if (m && m.bodyNode && !overrides.some((o) => o.method === m)) {
            overrides.push({ cls: sub, method: m });
          }
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
      return found ? classResolution(found.owner, found.method) : null;
    };

    /** `dao::save` / `AuditStore::log` / `this::helper` — resolved like a
     *  call with unknown arity; constructor refs (`Foo::new`) and
     *  external-rooted receivers stay silent; untypeable receivers go LOUD
     *  (2026-08-21: method references previously vanished entirely). */
    const resolveMethodReference = (refNode: SyntaxNode): CallResolution | null => {
      const named = namedNonComment(refNode);
      if (named.length === 0) return null;
      const receiverNode = named[0];
      const nameNode = named[named.length - 1];
      if (!nameNode || nameNode.type !== 'identifier' || nameNode.text === 'new') return null;
      const receiver = resolveReceiver(receiverNode, 0);
      if (receiver === 'external') return null;
      if (receiver === 'unknown') {
        return { kind: 'call', symbol: unresolvedSymbol(nameNode.text, 0), targetKey: null };
      }
      if (boundaryClassFqns.has(receiver.cls.fqn)) {
        const bm = findMethodInHierarchy(receiver.cls, nameNode.text, -1, index);
        const sym = bm ? methodSymbol(bm.method) : `${receiver.cls.fqn}#${nameNode.text}(?)`;
        return {
          kind: 'call',
          symbol: sym,
          targetKey:
            boundaryKeyBySymbol.get(sym) ?? boundaryKeyBySymbol.get(receiver.cls.fqn) ?? null,
        };
      }
      const target = findMethodInHierarchy(receiver.cls, nameNode.text, -1, index);
      return target ? classResolution(target.owner, target.method) : null;
    };

    /**
     * EVERY resolvable (or loud-unresolved) invocation in one statement, in
     * source order, deduped (2026-08-21 sweep: first-resolution-wins lost
     * every nested project call — `mapper.wrap(dao.load(x))` dropped the DAO
     * read without a trace).
     */
    const allResolutions = (stmt: SyntaxNode): CallResolution[] => {
      const out: CallResolution[] = [];
      const seen = new Set<string>();
      const nodes = [
        ...collectNodesOfType(stmt, 'method_invocation'),
        ...collectNodesOfType(stmt, 'method_reference'),
      ].sort(
        (a, b) => a.startIndex - b.startIndex
      );
      for (const node of nodes) {
        const r =
          node.type === 'method_reference'
            ? resolveMethodReference(node)
            : resolveInvocation(node);
        if (!r) continue;
        const key = `${r.kind}|${r.symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
      return out;
    };

    const firstResolution = (stmt: SyntaxNode): CallResolution | null =>
      allResolutions(stmt)[0] ?? null;

    const recordDispatch = (res: Extract<CallResolution, { kind: 'dispatch' }>): void => {
      findings.push({
        kind: 'dispatch_ambiguity',
        symbol: methodSymbol(method),
        detail: `unresolved dynamic dispatch of ${res.symbol}: ${res.candidates.length} project implementations`,
        candidates: [...res.candidates].sort(),
      });
    };

    /** One row per resolution — the shared mapper for statement/return/loop
     *  extras. Dispatch resolutions record their ambiguity finding. */
    function callRowOf(res: Extract<CallResolution, { kind: 'call' | 'dispatch' }>, stmt: SyntaxNode): RowDraft {
      if (res.kind === 'dispatch') {
        recordDispatch(res);
        return {
          kind: 'dispatch',
          conditionVerbatim: null,
          conditionRef: ref(stmt),
          outcome: { type: 'call', targetKey: null, targetSymbol: res.symbol },
        };
      }
      return {
        kind: 'branch',
        conditionVerbatim: null,
        conditionRef: ref(stmt),
        outcome: { type: 'call', targetKey: res.targetKey, targetSymbol: res.symbol },
      };
    }

    /** Rows for a plain statement: ONE row per resolvable project call
     *  (2026-08-21 — previously first-resolution-wins). Inline-only
     *  statements keep the single verbatim 'effect' row. */
    function statementRows(stmt: SyntaxNode): RowDraft[] {
      const resolutions = allResolutions(stmt);
      const calls = resolutions.filter(
        (r): r is Extract<CallResolution, { kind: 'call' | 'dispatch' }> => r.kind !== 'inline'
      );
      if (calls.length > 0) return calls.map((r) => callRowOf(r, stmt));
      if (resolutions.length > 0) {
        // Inline-trivial / accessor callee(s): the call stays verbatim.
        return [
          {
            kind: 'branch',
            conditionVerbatim: null,
            conditionRef: ref(stmt),
            outcome: { type: 'terminal', verbatim: stmt.text, ref: ref(stmt), outcomeLabel: 'effect' },
          },
        ];
      }
      return [];
    }

    function returnRows(stmt: SyntaxNode): RowDraft[] {
      const calls = allResolutions(stmt).filter(
        (r): r is Extract<CallResolution, { kind: 'call' | 'dispatch' }> => r.kind !== 'inline'
      );
      if (calls.length === 0) {
        // Inline resolutions keep the call inside the verbatim return.
        return [
          {
            kind: 'terminal',
            conditionVerbatim: null,
            conditionRef: null,
            outcome: {
              type: 'terminal',
              verbatim: stmt.text,
              ref: ref(stmt),
              outcomeLabel: `value:${method.returnType}`,
            },
          },
        ];
      }
      // First (outermost) resolution keeps the terminal position it always
      // had; the REST — previously silently lost nested calls — become
      // ordinary call rows before it (2026-08-21).
      const [first, ...rest] = calls;
      const extras = rest.map((r) => callRowOf(r, stmt));
      if (first.kind === 'dispatch') {
        recordDispatch(first);
        return [
          ...extras,
          {
            kind: 'dispatch',
            conditionVerbatim: null,
            conditionRef: ref(stmt),
            outcome: { type: 'call', targetKey: null, targetSymbol: first.symbol },
          },
        ];
      }
      return [
        ...extras,
        {
          kind: 'terminal',
          conditionVerbatim: null,
          conditionRef: null,
          outcome: { type: 'call', targetKey: first.targetKey, targetSymbol: first.symbol },
        },
      ];
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

    function loopRows(stmt: SyntaxNode): RowDraft[] {
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
      // first resolvable call/dispatch in the body becomes the loop outcome —
      // and EVERY remaining body call rides along as its own row
      // (2026-08-21: a loop body writing via a second call lost that write).
      const bodyCalls = body
        ? allResolutions(body).filter(
            (r): r is Extract<CallResolution, { kind: 'call' | 'dispatch' }> =>
              r.kind !== 'inline'
          )
        : [];
      let usedIndex = -1;
      if (!outcome && bodyCalls.length > 0) {
        const res = bodyCalls[0];
        usedIndex = 0;
        if (res.kind === 'dispatch') {
          recordDispatch(res);
          outcome = { type: 'call', targetKey: null, targetSymbol: res.symbol };
        } else {
          outcome = { type: 'call', targetKey: res.targetKey, targetSymbol: res.symbol };
        }
      }
      if (!outcome) {
        outcome = { type: 'terminal', verbatim: header, ref: ref(stmt), outcomeLabel: 'value' };
      }
      const loop: RowDraft = {
        kind: 'loop',
        conditionVerbatim: header,
        conditionRef: ref(stmt),
        outcome,
      };
      const extras = bodyCalls
        .filter((_, i) => i !== usedIndex)
        .map((r) => callRowOf(r, stmt));
      return [loop, ...extras];
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
                // Catch-body project calls (compensating/audit writes in
                // handlers) ride along as rows too (2026-08-21).
                const cb = c.childForFieldName('body');
                if (cb) {
                  for (const r of allResolutions(cb)) {
                    if (r.kind !== 'inline') rows.push(callRowOf(r, c));
                  }
                }
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
            rows.push(...loopRows(stmt));
            break;
          case 'return_statement':
            rows.push(...returnRows(stmt));
            break;
          case 'throw_statement':
            rows.push(throwRow(stmt));
            break;
          default: {
            rows.push(...statementRows(stmt));
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

  // -------------------------------------------------------------------------
  // Cache-transparency bridge (2026-08-23, live-estate ruling: "pick up these
  // chains correctly"). The legacy idiom: a cache-holder class fronts a Guava
  // LoadingCache whose anonymous CacheLoader.load() — built in the
  // CONSTRUCTOR — delegates to the real DB loader. `cache.get(k)` resolves
  // external, so the chain used to evaporate. The bridge mines the class's
  // loader calls (methods named load/loadAll + anonymous `new *CacheLoader`
  // bodies in any method OR constructor) and appends them, as
  // 'cache miss -> loader' rows, to every method that reads a cache field.
  // -------------------------------------------------------------------------
  const bridgeRowsByClass = new Map<string, RowDraft[]>();
  const bridgeRowsFor = (cls: JavaClassInfo): RowDraft[] => {
    const cached = bridgeRowsByClass.get(cls.fqn);
    if (cached) return cached;
    const out: RowDraft[] = [];
    const seen = new Set<string>();
    const pushCalls = (rows: RowDraft[]): void => {
      for (const row of rows) {
        if (row.outcome.type !== 'call') continue;
        const key = row.outcome.targetSymbol;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          kind: 'branch',
          conditionVerbatim: 'cache miss -> loader',
          conditionRef: row.conditionRef,
          outcome: row.outcome,
        });
      }
    };
    for (const m of cls.methods) {
      if (!m.bodyNode) continue;
      if (m.name === 'load' || m.name === 'loadAll') pushCalls(buildRowsForMethod(cls, m));
    }
    for (const m of [...cls.methods, ...(cls.constructors ?? [])]) {
      if (!m.bodyNode) continue;
      for (const anon of collectNodesOfType(m.bodyNode, 'object_creation_expression')) {
        const typeNode = anon.childForFieldName('type');
        if (!typeNode || !/CacheLoader$/.test(lastTypeSegment(typeNode.text))) continue;
        for (const anonMethod of collectNodesOfType(anon, 'method_declaration')) {
          const anonBody = anonMethod.childForFieldName('body');
          if (!anonBody) continue;
          // Resolve in the ENCLOSING class context — the loader delegates to
          // outer fields; its own parameter never matters for chaining.
          pushCalls(buildRowsForMethod(cls, { ...m, bodyNode: anonBody }));
        }
      }
    }
    bridgeRowsByClass.set(cls.fqn, out);
    return out;
  };

  const methodReadsCacheField = (cls: JavaClassInfo, method: JavaMethodInfo): boolean => {
    if (!method.bodyNode) return false;
    for (const inv of collectNodesOfType(method.bodyNode, 'method_invocation')) {
      const nameNode = inv.childForFieldName('name');
      const objectNode = inv.childForFieldName('object');
      if (!nameNode || !objectNode) continue;
      if (CACHE_GET_NAMES.has(nameNode.text) && isCacheFieldReceiver(cls, objectNode)) {
        return true;
      }
    }
    return false;
  };

  const drafts: TableDraft[] = [];
  for (const cls of index.classesByFqn.values()) {
    if (cls.kind === 'interface' || boundaryClassFqns.has(cls.fqn)) continue;
    const classRoutingAnnotations = cls.annotations.filter((a) => CLASS_ROUTING_RE.test(a));
    for (const method of cls.methods) {
      if (!method.bodyNode || classificationByMethod.get(method) !== 'table') continue;
      const symbol = methodSymbol(method);

      let rowDrafts = buildRowsForMethod(cls, method);
      // Config-SQL rows (2026-08-23): proc names assembled from FIELD
      // initializers (static dispatch maps — `"hierarchy" ->
      // "updateTree_roll '...'"`). String-typed constants are already
      // mined for boundaries, but table classes executing config-held SQL
      // lost the name entirely. A referenced field whose initializer holds
      // long identifier-bearing literals contributes a terminal row the
      // effect walk scans against the proc catalog.
      {
        const ids = new Set(
          collectNodesOfType(method.bodyNode, 'identifier').map((n) => n.text),
        );
        const configPieces: string[] = [];
        for (const f of cls.fields) {
          if (!f.initializer || !ids.has(f.name)) continue;
          if (f.type === 'String') continue; // boundary mining owns these
          const literals = f.initializer.match(/"((?:[^"\\]|\\.)*)"/g) ?? [];
          for (const lit of literals) {
            const inner = lit.slice(1, -1);
            if (/[A-Za-z_][A-Za-z0-9_]{9,}/.test(inner)) configPieces.push(inner);
          }
        }
        // Spring bean-property hints (item 7): SQL-ish property values ride
        // verbatim (proc-call strings parse downstream); `*table?name*`
        // properties with bare-identifier values attribute the loader's
        // runtime INSERT target. Unioned across bean instances, appended to
        // every table method of the class (loaders are small classes; the
        // walk dedups by symbol).
        for (const hint of index.beanPropertyHints?.get(cls.fqn) ?? []) {
          if (SQL_TEXT_RE.test(hint.value)) {
            configPieces.push(hint.value);
          } else if (
            /table.?name/i.test(hint.name) &&
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(hint.value)
          ) {
            configPieces.push(`insert into ${hint.value}`);
          }
        }
        if (configPieces.length > 0) {
          rowDrafts = [
            ...rowDrafts,
            {
              kind: 'terminal',
              conditionVerbatim: 'config-held SQL (field initializer)',
              conditionRef: null,
              outcome: {
                type: 'terminal',
                verbatim: configPieces.join(' ').slice(0, 500),
                ref: { path: method.filePath, line: method.startLine },
                outcomeLabel: 'config-sql',
              },
            },
          ];
        }
      }
      if (
        method.name !== 'load' &&
        method.name !== 'loadAll' &&
        cls.fields.some(isCacheTypedField) &&
        methodReadsCacheField(cls, method)
      ) {
        const existing = new Set(
          rowDrafts
            .filter((r) => r.outcome.type === 'call')
            .map((r) => (r.outcome as { targetSymbol: string }).targetSymbol),
        );
        rowDrafts = [
          ...rowDrafts,
          ...bridgeRowsFor(cls).filter(
            (b) => !existing.has((b.outcome as { targetSymbol: string }).targetSymbol),
          ),
        ];
      }
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
