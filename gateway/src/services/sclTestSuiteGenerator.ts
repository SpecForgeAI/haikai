/**
 * SCL TDD test-suite generator (SCL pipeline spec 9 of 10, 2026-08-18 design:
 * agent-os/planning/2026-08-18-scl-pipeline-design.md, "Final rulings round 3"
 * — "TDD = generated failing suites").
 *
 * PURE + DETERMINISTIC: tests are generated from the corpus contracts (one
 * test per behaviour-table row, fixtures from shape contracts, golden-path
 * integration skeletons) and are WRITTEN INTO THE STORY BRANCH as the spec's
 * first commit by the execution driver (spec 10) — never transcribed through
 * the implementer. The generated Java 21 / JUnit 5 / Mockito source is
 * SYNTACTICALLY well-formed but will not compile until the production classes
 * exist — that IS the red state (red = not-green; compile failure counts).
 *
 * Determinism contract: same story + contracts + basePackage in ⇒ byte-
 * identical files and manifest out. NO timestamps inside file contents; the
 * manifest's `generated_at_note` is a static string. File ordering is
 * deterministic (sorted by path); manifest sha256s are computed with
 * node:crypto over the exact emitted content.
 *
 * File scheme (all under src/test/java/<basePackage-as-path>/):
 *   - testkit/<ShapeSimple>Fixtures.java      one per non-enum shape contract
 *   - behaviour/<Class>_<method>BehaviourTest.java  one per behaviour table
 *   - golden/<ControllerSimple>GoldenPathsTest.java external endpoint groups
 *     only — one @Test per DISTINCT root-level outcomeLabel
 */

import { createHash } from 'node:crypto';
import {
  SclContractDto,
  classOfSymbol,
  isBoundary,
  isRootTable,
  simpleClassName,
  symbolOf,
} from './sclCorpusPlanner';
import { deriveHttpMethod, derivePathFragment } from './sclAnnotationPass';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SclSuiteStory {
  title: string;
  sclContractKeys: string[];
  layer?: string | null;
  controllerClass?: string | null;
  tags: string[];
}

export interface SclGeneratedFile {
  path: string;
  content: string;
}

export interface SclGeneratedSuite {
  files: SclGeneratedFile[];
  manifest: {
    /** STATIC note — never a timestamp (byte-determinism across runs). */
    generated_at_note: string;
    files: Array<{ path: string; sha256: string }>;
    contract_keys: string[];
    story_title: string;
  };
  stats: { fixtureBuilders: number; rowTests: number; goldenPaths: number };
}

/** The static manifest note (exported so spec 10 / tests can pin it). */
export const SCL_SUITE_GENERATED_NOTE =
  'generated deterministically from the SCL corpus at dispatch time — ' +
  'content-hash stable, no timestamps';

// ---------------------------------------------------------------------------
// Tolerant contract-body readers
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function bodyOf(contract: SclContractDto): Rec {
  return (contract.body_json ?? {}) as Rec;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function keyOf(contract: SclContractDto): string {
  return contract.contract_key ?? symbolOf(contract);
}

interface ShapeFieldView {
  name: string;
  kind: string;
  nullable: boolean | null;
}

function fieldsOf(contract: SclContractDto): ShapeFieldView[] {
  const fields = bodyOf(contract).fields;
  if (!Array.isArray(fields)) return [];
  return fields.map((raw, i) => {
    const f = (raw ?? {}) as Rec;
    return {
      name: asString(f.name) ?? `field${i}`,
      kind: asString(f.kind) ?? 'opaque',
      nullable: typeof f.nullable === 'boolean' ? f.nullable : null,
    };
  });
}

function flagsOf(contract: SclContractDto): string[] {
  const flags = bodyOf(contract).flags;
  return Array.isArray(flags)
    ? flags.filter((f): f is string => typeof f === 'string').map((f) => f.replace(/_/g, '-'))
    : [];
}

function isEnumShape(contract: SclContractDto): boolean {
  return bodyOf(contract).representation === 'enum';
}

interface RowView {
  index: number;
  kind: string;
  conditionVerbatim: string | null;
  conditionCite: string | null;
  outcome: Rec;
}

function citeOf(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const r = ref as Rec;
  const path = asString(r.path);
  if (!path) return null;
  return typeof r.line === 'number' ? `${path}:${r.line}` : path;
}

function rowsOf(contract: SclContractDto): RowView[] {
  const rows = bodyOf(contract).rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((raw, i) => {
    const row = (raw ?? {}) as Rec;
    return {
      index: typeof row.index === 'number' ? row.index : i,
      kind: asString(row.kind) ?? 'branch',
      conditionVerbatim: asString(row.conditionVerbatim),
      conditionCite: citeOf(row.conditionRef),
      outcome: (row.outcome && typeof row.outcome === 'object' ? row.outcome : {}) as Rec,
    };
  });
}

interface SignatureInputView {
  name: string;
  typeRef: string;
}

function signatureInputsOf(contract: SclContractDto): SignatureInputView[] {
  const inputs = bodyOf(contract).signatureInputs;
  if (!Array.isArray(inputs)) return [];
  return inputs.map((raw, i) => {
    const input = (raw ?? {}) as Rec;
    return {
      name: asString(input.name) ?? `arg${i}`,
      typeRef: asString(input.typeRef) ?? 'Object',
    };
  });
}

// ---------------------------------------------------------------------------
// Java text helpers (escaping + naming — the syntactic-validity bar)
// ---------------------------------------------------------------------------

/** Safe inside any Java comment: strip block-comment closers, flatten lines. */
function escapeComment(text: string): string {
  return text.replace(/\*\//g, '*\\/').replace(/\r?\n/g, ' ');
}

/** Safe inside a Java string literal. */
function javaString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/** Lower-case-first identifier (mock field names). */
function lowerFirst(name: string): string {
  return name.length > 0 ? name[0].toLowerCase() + name.slice(1) : name;
}

/** Deterministic method-name slug from arbitrary verbatim text. */
function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return s.length > 0 ? s : 'case';
}

/** `Class#method(args)` → the method name (whole symbol when no '#'). */
function methodOfSymbol(symbol: string): string {
  const hash = symbol.indexOf('#');
  const tail = hash >= 0 ? symbol.slice(hash + 1) : symbol;
  const paren = tail.indexOf('(');
  return paren >= 0 ? tail.slice(0, paren) : tail;
}

/** Argument count of a `Class#method(A,B)` symbol (0 when unparseable). */
function argCountOfSymbol(symbol: string): number {
  const m = symbol.match(/\(([^)]*)\)/);
  if (!m || m[1].trim().length === 0) return 0;
  return m[1].split(',').length;
}

/** A Java simple type name token, or null (guards exceptionType/labels). */
function simpleTypeToken(text: string | null): string | null {
  if (!text) return null;
  const simple = simpleClassName(text.trim());
  return /^[A-Z][A-Za-z0-9_$]*$/.test(simple) ? simple : null;
}

// ---------------------------------------------------------------------------
// Fixture builders (from shape contracts)
// ---------------------------------------------------------------------------

interface ShapeIndex {
  /** contract key → shape contract (resolution set = ALL provided contracts). */
  byKey: Map<string, SclContractDto>;
  /** simple type name → shape contract. */
  bySimpleName: Map<string, SclContractDto>;
}

function buildShapeIndex(contracts: SclContractDto[]): ShapeIndex {
  const byKey = new Map<string, SclContractDto>();
  const bySimpleName = new Map<string, SclContractDto>();
  for (const contract of contracts) {
    if (contract.kind !== 'shape') continue;
    const key = contract.contract_key;
    if (typeof key === 'string' && !byKey.has(key)) byKey.set(key, contract);
    const simple = simpleClassName(classOfSymbol(symbolOf(contract)));
    if (simple && !bySimpleName.has(simple)) bySimpleName.set(simple, contract);
  }
  return { byKey, bySimpleName };
}

interface FixtureImports {
  set: Set<string>;
}

/** Deterministic default Java expression for one shape-field kind. */
function fieldDefault(
  field: ShapeFieldView,
  shapes: ShapeIndex,
  imports: FixtureImports
): string {
  const kind = field.kind;
  if (kind === 'string') return javaString(`x-${field.name}`);
  if (kind === 'int64') return '1L';
  if (kind === 'boolean') return 'false';
  if (kind === 'date') {
    imports.set.add('java.time.LocalDate');
    return 'LocalDate.of(2026, 1, 1)';
  }
  if (kind === 'timestamp') {
    imports.set.add('java.time.ZonedDateTime');
    imports.set.add('java.time.ZoneOffset');
    return 'ZonedDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC)';
  }
  if (kind === 'decimal') {
    imports.set.add('java.math.BigDecimal');
    return 'new BigDecimal("1.00")';
  }
  if (kind === 'integer-wide') {
    imports.set.add('java.math.BigInteger');
    return 'new BigInteger("1")';
  }
  if (kind.startsWith('list<')) {
    imports.set.add('java.util.List');
    return 'List.of()';
  }
  if (kind.startsWith('map<')) {
    imports.set.add('java.util.Map');
    return 'Map.of()';
  }
  if (kind.startsWith('ref:')) {
    const refKey = kind.slice('ref:'.length);
    const target = shapes.byKey.get(refKey);
    if (!target) {
      return `null /* unresolved ${escapeComment(kind)} */`;
    }
    const targetSimple = simpleClassName(classOfSymbol(symbolOf(target)));
    if (isEnumShape(target)) {
      const constants = fieldsOf(target);
      return constants.length > 0
        ? `${targetSimple}.${constants[0].name}`
        : `null /* enum ${escapeComment(targetSimple)} has no recorded constants */`;
    }
    return `${targetSimple}Fixtures.a${targetSimple}()`;
  }
  // int32 / int / other plain numerics → 1 ("numbers 1").
  if (/^(int|int32|integer|number|short|byte)$/.test(kind)) return '1';
  if (/^(double|float)$/.test(kind)) return '1.0';
  // opaque:<carrier> and anything unrecognised: null with a comment.
  return `null /* ${escapeComment(kind)} — no deterministic default */`;
}

function fixtureFile(
  contract: SclContractDto,
  basePackage: string,
  pkgPath: string,
  shapes: ShapeIndex
): SclGeneratedFile {
  const simple = simpleClassName(classOfSymbol(symbolOf(contract)));
  const imports: FixtureImports = { set: new Set() };
  const fields = fieldsOf(contract);
  const args = fields.map(
    (f) => `            ${fieldDefault(f, shapes, imports)} /* ${escapeComment(f.name)} : ${escapeComment(f.kind)} */`
  );
  const mutated = flagsOf(contract).includes('mutated-in-flight');

  const lines: string[] = [];
  lines.push(`package ${basePackage}.testkit;`);
  lines.push('');
  for (const imp of [...imports.set].sort()) lines.push(`import ${imp};`);
  if (imports.set.size > 0) lines.push('');
  lines.push('/**');
  lines.push(
    ` * GENERATED fixture builder for ${escapeComment(simple)} — SCL shape contract ${escapeComment(keyOf(contract))}.`
  );
  lines.push(' * Records assumed: canonical constructor, declaration order. DO NOT MODIFY —');
  lines.push(' * shipped tests are contract artifacts (contested-test protocol applies).');
  if (mutated) {
    lines.push(' *');
    lines.push(' * WARNING — mutated-in-flight: the slicer observed a setter call AFTER');
    lines.push(' * construction on this shape (record-conversion hazard). The production');
    lines.push(' * representation may keep a mutable class or gain a builder; this fixture');
    lines.push(' * still supplies the canonical-constructor defaults.');
  }
  lines.push(' */');
  lines.push(`public final class ${simple}Fixtures {`);
  lines.push('');
  lines.push(`    private ${simple}Fixtures() {`);
  lines.push('    }');
  lines.push('');
  lines.push(`    public static ${simple} a${simple}() {`);
  if (args.length === 0) {
    lines.push(`        return new ${simple}();`);
  } else {
    lines.push(`        return new ${simple}(`);
    lines.push(args.join(',\n'));
    lines.push('        );');
  }
  lines.push('    }');
  lines.push('}');
  lines.push('');
  return {
    path: `src/test/java/${pkgPath}/testkit/${simple}Fixtures.java`,
    content: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Per-row behaviour tests (from behaviour tables)
// ---------------------------------------------------------------------------

interface CalleeMock {
  /** Callee class simple name (from targetSymbol before '#'). */
  className: string;
  fieldName: string;
  /** First-seen callee method name + arg count (absorb rows arrange on it). */
  firstMethod: string;
  firstArgCount: number;
}

function calleeMocksOf(rows: RowView[]): CalleeMock[] {
  const mocks: CalleeMock[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (asString(row.outcome.type) !== 'call') continue;
    const targetSymbol = asString(row.outcome.targetSymbol);
    if (!targetSymbol) continue;
    const className = simpleClassName(classOfSymbol(targetSymbol));
    if (!className || seen.has(className)) continue;
    seen.add(className);
    mocks.push({
      className,
      fieldName: lowerFirst(className),
      firstMethod: methodOfSymbol(targetSymbol),
      firstArgCount: argCountOfSymbol(targetSymbol),
    });
  }
  return mocks;
}

/** Deterministic default argument expression for one signature input. */
function inputDefault(input: SignatureInputView, shapes: ShapeIndex, usedFixtures: Set<string>): string {
  const simple = simpleClassName(input.typeRef);
  if (simple === 'String') return javaString(`x-${input.name}`);
  if (/^(int|short|byte)$/.test(input.typeRef)) return '0';
  if (input.typeRef === 'long') return '0L';
  if (input.typeRef === 'boolean') return 'false';
  if (/^(double|float)$/.test(input.typeRef)) return '0.0';
  const shape = shapes.bySimpleName.get(simple);
  if (shape && !isEnumShape(shape)) {
    usedFixtures.add(simple);
    return `${simple}Fixtures.a${simple}()`;
  }
  if (shape && isEnumShape(shape)) {
    const constants = fieldsOf(shape);
    if (constants.length > 0) return `${simple}.${constants[0].name}`;
  }
  return 'null';
}

/** `any(), any(), ...` matcher list for a callee arg count. */
function anyMatchers(count: number): string {
  return Array.from({ length: count }, () => 'any()').join(', ');
}

/** The row's javadoc cite: `Row N: <condition> [<path>:<line>]`. */
function rowJavadoc(row: RowView): string {
  const conditionText =
    row.conditionVerbatim ??
    asString(row.outcome.verbatim) ??
    asString(row.outcome.thenVerbatim) ??
    '(unconditional)';
  const cite = row.conditionCite ?? citeOf(row.outcome.ref);
  return `    /** Row ${row.index}: ${escapeComment(conditionText)}${cite ? ` [${escapeComment(cite)}]` : ''} */`;
}

/** Concrete TODO-free assertion lines from an outcomeLabel (terminal rows). */
function assertionForLabel(
  outcomeLabel: string | null,
  actExpr: string,
  fallbackClassToken: string | null
): string[] {
  const label = outcomeLabel ?? '';
  if (label.startsWith('throws:')) {
    const exception = simpleTypeToken(label.slice('throws:'.length)) ?? 'RuntimeException';
    return [`        assertThrows(${exception}.class, () -> ${actExpr});`];
  }
  const valueToken =
    simpleTypeToken(label.includes(':') ? label.slice(label.indexOf(':') + 1) : label) ??
    fallbackClassToken;
  if (valueToken) {
    return [
      `        Object result = ${actExpr};`,
      `        assertInstanceOf(${valueToken}.class, result);`,
    ];
  }
  return [
    `        Object result = ${actExpr};`,
    '        assertNotNull(result);',
  ];
}

/** Envelope/result class named in an absorb row's thenVerbatim, when derivable. */
function classTokenFromVerbatim(verbatim: string | null): string | null {
  if (!verbatim) return null;
  const m = verbatim.match(/(?:return|new)\s+([A-Z][A-Za-z0-9_$]*)/);
  return m ? m[1] : null;
}

function behaviourTestFile(
  contract: SclContractDto,
  basePackage: string,
  pkgPath: string,
  shapes: ShapeIndex,
  usedFileNames: Set<string>,
  stats: { rowTests: number }
): SclGeneratedFile {
  const symbol = symbolOf(contract);
  const classSimple = simpleClassName(classOfSymbol(symbol));
  const method = methodOfSymbol(symbol);
  const rows = rowsOf(contract);
  const mocks = calleeMocksOf(rows);
  const inputs = signatureInputsOf(contract);
  const usedFixtures = new Set<string>();
  const argList = inputs.map((i) => inputDefault(i, shapes, usedFixtures)).join(', ');
  const actExpr = `subject().${method}(${argList})`;

  // Deterministic overload-collision handling on the file/class name.
  let baseName = `${classSimple}_${method}BehaviourTest`;
  let n = 2;
  while (usedFileNames.has(baseName)) baseName = `${classSimple}_${method}${n++}BehaviourTest`;
  usedFileNames.add(baseName);

  const tests: string[] = [];
  const usedTestNames = new Set<string>();
  for (const row of rows) {
    const outcomeType = asString(row.outcome.type);
    let name = `row${row.index}_${slug(
      row.conditionVerbatim ??
        asString(row.outcome.outcomeLabel) ??
        asString(row.outcome.targetSymbol) ??
        row.kind
    )}`;
    let dedupe = 2;
    while (usedTestNames.has(name)) name = `${name}_${dedupe++}`;
    usedTestNames.add(name);

    const lines: string[] = [];
    lines.push(rowJavadoc(row));
    lines.push('    @Test');
    lines.push(`    void ${name}() {`);
    if (row.conditionVerbatim) {
      lines.push(`        // Condition (verbatim): ${escapeComment(row.conditionVerbatim)}`);
    }

    if (outcomeType === 'call') {
      const targetSymbol = asString(row.outcome.targetSymbol) ?? '?';
      const calleeClass = simpleTypeToken(classOfSymbol(targetSymbol));
      const mock = mocks.find((m) => m.className === calleeClass);
      lines.push(`        // Delegates to ${escapeComment(targetSymbol)}`);
      if (mock) {
        const calleeMethod = methodOfSymbol(targetSymbol);
        const matchers = anyMatchers(argCountOfSymbol(targetSymbol));
        lines.push(`        when(${mock.fieldName}.${calleeMethod}(${matchers})).thenReturn(null);`);
        lines.push(`        ${actExpr};`);
        lines.push(`        verify(${mock.fieldName}).${calleeMethod}(${matchers});`);
      } else {
        lines.push(`        assertDoesNotThrow(() -> ${actExpr});`);
      }
    } else if (outcomeType === 'absorb') {
      const exceptionType = simpleTypeToken(asString(row.outcome.exceptionType)) ?? 'RuntimeException';
      const thenVerbatim = asString(row.outcome.thenVerbatim);
      const outcomeLabel = asString(row.outcome.outcomeLabel);
      if (mocks.length > 0) {
        const mock = mocks[0];
        const matchers = anyMatchers(mock.firstArgCount);
        lines.push(
          `        when(${mock.fieldName}.${mock.firstMethod}(${matchers})).thenThrow(new ${exceptionType}(${javaString('scl-absorb')}));`
        );
      } else {
        lines.push(`        // Absorbed exception: ${exceptionType} (no corpus-resolved callee to arrange on)`);
      }
      if (thenVerbatim) {
        lines.push(`        // Handler (verbatim): ${escapeComment(thenVerbatim)}`);
      }
      const envelopeToken = classTokenFromVerbatim(thenVerbatim);
      if (outcomeLabel && outcomeLabel.startsWith('throws:')) {
        lines.push(...assertionForLabel(outcomeLabel, actExpr, null));
      } else if (envelopeToken || simpleTypeToken(outcomeLabel ? outcomeLabel.slice(outcomeLabel.indexOf(':') + 1) : null)) {
        lines.push(...assertionForLabel(outcomeLabel, actExpr, envelopeToken));
      } else {
        lines.push(`        Object result = assertDoesNotThrow(() -> ${actExpr});`);
        lines.push('        assertNotNull(result);');
      }
    } else {
      // terminal (and any unrecognised outcome type — assert on the label).
      const verbatim = asString(row.outcome.verbatim);
      if (verbatim) {
        lines.push(`        // Outcome (verbatim): ${escapeComment(verbatim)}`);
      }
      lines.push(
        ...assertionForLabel(asString(row.outcome.outcomeLabel), actExpr, classTokenFromVerbatim(verbatim))
      );
    }
    lines.push('    }');
    tests.push(lines.join('\n'));
    stats.rowTests += 1;
  }

  const header: string[] = [];
  header.push(`package ${basePackage}.behaviour;`);
  header.push('');
  for (const fixture of [...usedFixtures].sort()) {
    header.push(`import ${basePackage}.testkit.${fixture}Fixtures;`);
  }
  header.push('import org.junit.jupiter.api.Test;');
  header.push('import org.junit.jupiter.api.extension.ExtendWith;');
  if (mocks.length > 0) header.push('import org.mockito.Mock;');
  header.push('import org.mockito.junit.jupiter.MockitoExtension;');
  header.push('');
  header.push('import static org.junit.jupiter.api.Assertions.*;');
  header.push('import static org.mockito.Mockito.*;');
  header.push('');
  header.push('/**');
  header.push(
    ` * GENERATED per-row behaviour suite for ${escapeComment(symbol)} (SCL contract ${escapeComment(keyOf(contract))}).`
  );
  header.push(' * One test per behaviour-table row — rows are the contract. DO NOT MODIFY:');
  header.push(' * a test you believe is wrong must be CONTESTED with evidence, never edited.');
  header.push(' */');
  header.push('@ExtendWith(MockitoExtension.class)');
  header.push(`class ${baseName} {`);
  header.push('');
  for (const mock of mocks) {
    header.push('    @Mock');
    header.push(`    private ${mock.className} ${mock.fieldName};`);
    header.push('');
  }
  header.push('    /** Subject under test — constructor-injection assumption (mocks in field order). */');
  header.push(`    private ${classSimple} subject() {`);
  header.push(`        return new ${classSimple}(${mocks.map((m) => m.fieldName).join(', ')});`);
  header.push('    }');
  header.push('');

  const content = `${header.join('\n')}${tests.join('\n\n')}\n}\n`;
  return {
    path: `src/test/java/${pkgPath}/behaviour/${baseName}.java`,
    content,
  };
}

// ---------------------------------------------------------------------------
// Golden-path skeletons (external endpoint-group stories only)
// ---------------------------------------------------------------------------

interface GoldenOutcome {
  label: string;
  rootSymbol: string;
  httpMethod: string;
  path: string;
  pathParamCount: number;
}

/** DISTINCT root-level outcomeLabels across the controller's root tables,
 * first occurrence (tables sorted by symbol, rows in order) wins the
 * (verb, path) evidence. */
function goldenOutcomesOf(rootTables: SclContractDto[]): GoldenOutcome[] {
  const outcomes: GoldenOutcome[] = [];
  const seen = new Set<string>();
  const sorted = [...rootTables].sort(
    (a, b) => symbolOf(a).localeCompare(symbolOf(b)) || keyOf(a).localeCompare(keyOf(b))
  );
  for (const table of sorted) {
    const httpMethod = (deriveHttpMethod(table.body_json) ?? 'GET').toLowerCase();
    // derivePathFragment trims slashes (composition, 2026-08-21) — a MockMvc
    // request path must be root-relative, so restore the leading slash here.
    const rawFragment = derivePathFragment(table.body_json) ?? '/';
    const fragment = rawFragment.startsWith('/') ? rawFragment : `/${rawFragment}`;
    const pathParamCount = (fragment.match(/\{[^}]*\}/g) ?? []).length;
    for (const row of rowsOf(table)) {
      const label = asString(row.outcome.outcomeLabel);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      outcomes.push({
        label,
        rootSymbol: symbolOf(table),
        httpMethod,
        path: fragment,
        pathParamCount,
      });
    }
  }
  return outcomes;
}

function goldenPathsFile(
  controllerClass: string,
  rootTables: SclContractDto[],
  basePackage: string,
  pkgPath: string,
  stats: { goldenPaths: number }
): SclGeneratedFile | null {
  const outcomes = goldenOutcomesOf(rootTables);
  if (outcomes.length === 0) return null;
  const controllerSimple = simpleClassName(controllerClass);

  // Mocked collaborators = distinct callees across ALL the root tables.
  const allRows = rootTables.flatMap(rowsOf);
  const mocks = calleeMocksOf(allRows);

  const tests: string[] = [];
  const usedNames = new Set<string>();
  for (const outcome of outcomes) {
    let name = `golden_${slug(outcome.label)}`;
    let n = 2;
    while (usedNames.has(name)) name = `golden_${slug(outcome.label)}_${n++}`;
    usedNames.add(name);
    const pathArgs = Array.from({ length: outcome.pathParamCount }, (_, i) => `"x-p${i}"`);
    const perform = `${outcome.httpMethod}(${javaString(outcome.path)}${pathArgs.length > 0 ? `, ${pathArgs.join(', ')}` : ''})`;
    const lines: string[] = [];
    lines.push(
      `    /** Golden path: outcome \`${escapeComment(outcome.label)}\` (root: ${escapeComment(outcome.rootSymbol)}). */`
    );
    lines.push('    @Test');
    lines.push(`    void ${name}() throws Exception {`);
    if (outcome.label.startsWith('throws:')) {
      lines.push(`        // Outcome ${escapeComment(outcome.label)} — the mapped error envelope is the wire contract.`);
      lines.push(`        MvcResult result = mockMvc.perform(${perform}).andReturn();`);
      lines.push('        assertNotNull(result.getResponse());');
    } else {
      lines.push(`        // Outcome ${escapeComment(outcome.label)} — happy envelope at the wire.`);
      lines.push(`        mockMvc.perform(${perform})`);
      lines.push('            .andExpect(status().isOk());');
    }
    lines.push('    }');
    tests.push(lines.join('\n'));
    stats.goldenPaths += 1;
  }

  const header: string[] = [];
  header.push(`package ${basePackage}.golden;`);
  header.push('');
  header.push('import org.junit.jupiter.api.BeforeEach;');
  header.push('import org.junit.jupiter.api.Test;');
  header.push('import org.junit.jupiter.api.extension.ExtendWith;');
  if (mocks.length > 0) header.push('import org.mockito.Mock;');
  header.push('import org.mockito.junit.jupiter.MockitoExtension;');
  header.push('import org.springframework.test.web.servlet.MockMvc;');
  header.push('import org.springframework.test.web.servlet.MvcResult;');
  header.push('import org.springframework.test.web.servlet.setup.MockMvcBuilders;');
  header.push('');
  header.push('import static org.junit.jupiter.api.Assertions.*;');
  header.push('import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;');
  header.push('import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;');
  header.push('');
  header.push('/**');
  header.push(
    ` * GENERATED golden-path skeletons for ${escapeComment(controllerClass)} — one test per`
  );
  header.push(' * DISTINCT root-level outcomeLabel (MockMvc standaloneSetup, mocked');
  header.push(' * collaborators). DO NOT MODIFY — contested-test protocol applies.');
  header.push(' */');
  header.push('@ExtendWith(MockitoExtension.class)');
  header.push(`class ${controllerSimple}GoldenPathsTest {`);
  header.push('');
  for (const mock of mocks) {
    header.push('    @Mock');
    header.push(`    private ${mock.className} ${mock.fieldName};`);
    header.push('');
  }
  header.push('    private MockMvc mockMvc;');
  header.push('');
  header.push('    @BeforeEach');
  header.push('    void setUp() {');
  header.push('        // Constructor-injection assumption (mocks in field order).');
  header.push(
    `        mockMvc = MockMvcBuilders.standaloneSetup(new ${controllerSimple}(${mocks.map((m) => m.fieldName).join(', ')})).build();`
  );
  header.push('    }');
  header.push('');

  return {
    path: `src/test/java/${pkgPath}/golden/${controllerSimple}GoldenPathsTest.java`,
    content: `${header.join('\n')}${tests.join('\n\n')}\n}\n`,
  };
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

function sha256hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * PURE + DETERMINISTIC TDD suite generation for one corpus-derived story.
 * Called by the execution driver at DISPATCH time (spec 10); the returned
 * files become the story branch's FIRST commit.
 */
export function generateSclTestSuite(args: {
  story: SclSuiteStory;
  /** Resolution set: the story's contracts (ref:S-key targets may ride along). */
  contracts: SclContractDto[];
  /** Target base package, e.g. from the manifest coordinates — caller provides. */
  basePackage: string;
}): SclGeneratedSuite {
  const { story, contracts, basePackage } = args;
  const pkgPath = basePackage.replace(/\./g, '/');
  const shapes = buildShapeIndex(contracts);

  // Story contracts in scl_contract_keys order (deterministic; unresolvable
  // keys are the carriage's insufficient_context concern, not the generator's).
  const byKey = new Map<string, SclContractDto>();
  for (const contract of contracts) {
    const key = contract.contract_key;
    if (typeof key === 'string' && !byKey.has(key)) byKey.set(key, contract);
  }
  const storyContracts = story.sclContractKeys
    .map((k) => byKey.get(k))
    .filter((c): c is SclContractDto => c !== undefined);

  const files: SclGeneratedFile[] = [];
  const stats = { fixtureBuilders: 0, rowTests: 0, goldenPaths: 0 };

  // 1. Fixture builders — every non-enum shape contract (enums get NO fixture).
  const shapeContracts = storyContracts
    .filter((c) => c.kind === 'shape' && !isEnumShape(c))
    .sort((a, b) => symbolOf(a).localeCompare(symbolOf(b)) || keyOf(a).localeCompare(keyOf(b)));
  for (const contract of shapeContracts) {
    files.push(fixtureFile(contract, basePackage, pkgPath, shapes));
    stats.fixtureBuilders += 1;
  }

  // 2. Per-row behaviour suites — every behaviour table.
  const tableContracts = storyContracts
    .filter((c) => c.kind === 'behaviour_table' && !isBoundary(c))
    .sort((a, b) => symbolOf(a).localeCompare(symbolOf(b)) || keyOf(a).localeCompare(keyOf(b)));
  const usedFileNames = new Set<string>();
  for (const contract of tableContracts) {
    files.push(behaviourTestFile(contract, basePackage, pkgPath, shapes, usedFileNames, stats));
  }

  // 3. Golden paths — EXTERNAL endpoint-group stories only.
  const isExternalEndpointGroup =
    story.layer === 'endpoint:external' || story.tags.includes('scl:endpoint:external');
  if (isExternalEndpointGroup) {
    const rootTables = tableContracts.filter(isRootTable);
    const controllerClass =
      story.controllerClass ??
      (rootTables.length > 0 ? classOfSymbol(symbolOf(rootTables[0])) : null);
    if (controllerClass && rootTables.length > 0) {
      const controllerRoots = rootTables.filter(
        (t) => classOfSymbol(symbolOf(t)) === controllerClass
      );
      const golden = goldenPathsFile(controllerClass, controllerRoots, basePackage, pkgPath, stats);
      if (golden) files.push(golden);
    }
  }

  // Deterministic file ordering + manifest.
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    manifest: {
      generated_at_note: SCL_SUITE_GENERATED_NOTE,
      files: files.map((f) => ({ path: f.path, sha256: sha256hex(f.content) })),
      contract_keys: [...story.sclContractKeys],
      story_title: story.title,
    },
    stats,
  };
}
