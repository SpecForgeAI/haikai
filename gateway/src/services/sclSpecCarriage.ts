/**
 * SCL spec carriage (SCL pipeline spec 8 of 10, 2026-08-18 design:
 * agent-os/planning/2026-08-18-scl-pipeline-design.md, "Carriage" +
 * "Final rulings round 3").
 *
 * Deterministic spec text for the corpus-derived stories (spec 7's foundation
 * layers + endpoint groups, tagged `provenance:scl_corpus`). The LLM is NEVER
 * called: the SCL contracts persisted by the scan ARE the construction truth,
 * so the spec embeds them VERBATIM — the carriage arranges around the
 * contracts, never paraphrases inside them (mirroring the scaffold /
 * DB-pack / code carriages: no context resolver, no prompt, no confidence
 * downgrade).
 *
 * Assembly (per the design + round-3 rulings):
 *   1. header + provenance statement;
 *   2. story-type objective (layer-specific for foundation layers, "implement
 *      the <controller> endpoints against the pre-built foundational layers"
 *      for endpoint groups);
 *   3. MODERNIZATION DECISIONS — the confirmed `modernize.*` decisions
 *      RELEVANT to this story's contracts, each cited `[decision:<code>]`
 *      (relevance mapping documented on {@link isModernizeDecisionRelevant});
 *      ZERO modernize.* decisions captured at all → honest
 *      `insufficient_context` naming `confirmed_modernization_decisions`;
 *   4. CONTRACT BLOCKS in `scl_contract_keys` order — behaviour tables as
 *      markdown row tables (verbatim conditions/outcomes + file:line cites),
 *      shapes as field tables (mutated-in-flight warnings), boundaries as
 *      verbatim SQL blocks. An UNRESOLVABLE contract key →
 *      `insufficient_context` naming `scl_contracts` (NO partial specs);
 *   5. ACCEPTANCE CRITERIA = the TDD ruling verbatim (shipped suite green /
 *      no shipped test modified + contested-test protocol / rows are the
 *      contract). Captured-examples sections are REMOVED ENTIRELY (round-3
 *      ruling: captures live only in reconcile + the contradiction pass);
 *   6. target-stack section, then wire-fidelity section (same append helpers
 *      and order as the LLM path — form facts stay in the contract).
 */

import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from './migrationShapeSpecGenerationHandler';
import { TargetStateCapturedDecision } from './targetStateCapturedDecisionsClient';
import {
  SclContractDto,
  classOfSymbol,
  isBoundary,
  isRootTable,
  simpleClassName,
  symbolOf,
} from './sclCorpusPlanner';
import { stableStringify } from './sclAnnotationPass';
import {
  appendTargetStackSection,
  buildTargetStackSpecSection,
} from './migrationTargetStackSpecSection';
import { appendWireFidelitySection } from './migrationBaselineWireFacts';
import { defaultModernizationRuleset } from './sclModernizationRuleset';
import { contractIsUnimplementable } from './sclCorpusPlanner';

// ---------------------------------------------------------------------------
// Story recognition + blob markers
// ---------------------------------------------------------------------------

/**
 * Provenance tag stamped on every corpus-derived item by spec 7's expansion
 * (migrationBookOfWorkExpansionHandler.SCL_CORPUS_PROVENANCE_TAG — kept as a
 * local mirror to avoid a module cycle with the expansion handler).
 */
export const SCL_CORPUS_STORY_TAG = 'provenance:scl_corpus';

/** A corpus-derived story: its blob tags carry `provenance:scl_corpus`. */
export function isSclCorpusStory(
  story: Pick<LoadedBookOfWorkItem, 'tags'>
): boolean {
  return (story.tags ?? []).includes(SCL_CORPUS_STORY_TAG);
}

/** SCL corpus markers spec 7 flattens onto the book-of-work blob item. */
export interface SclCarriageMarkers {
  sclContractKeys: string[] | null;
  /** Q- boundaries reached transitively by the story's rows (2026-09-03). */
  sclBoundaryKeys: string[] | null;
  /** "VERB /path" routes declared by the story's endpoint contracts. */
  sclDeclaredRoutes: string[] | null;
  sclLayer: string | null;
  sclControllerClass: string | null;
  sclRowCount: number | null;
}

/**
 * Pure blob→markers mapping (snake_case as stamped + camelCase tolerated,
 * mirroring codeCarriageMarkersFromBlob). Spread into the book-of-work loader.
 */
export function sclCarriageMarkersFromBlob(
  obj: Record<string, unknown>
): SclCarriageMarkers {
  const strings = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.map((v) => String(v)) : null;
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    sclContractKeys: strings(obj.scl_contract_keys ?? obj.sclContractKeys),
    sclBoundaryKeys: strings(obj.scl_boundary_keys ?? obj.sclBoundaryKeys),
    sclDeclaredRoutes: strings(obj.scl_declared_routes ?? obj.sclDeclaredRoutes),
    sclLayer: str(obj.scl_layer ?? obj.sclLayer),
    sclControllerClass: str(obj.scl_controller_class ?? obj.sclControllerClass),
    sclRowCount: num(obj.scl_row_count ?? obj.sclRowCount),
  };
}

// ---------------------------------------------------------------------------
// Tolerant contract-body readers (the AMS body_json is loosely typed on the
// gateway; the authoritative producer shapes live in
// discovery-service/src/scl/sclTypes.ts)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function bodyOf(contract: SclContractDto): Rec {
  return (contract.body_json ?? {}) as Rec;
}

function glossOf(contract: SclContractDto): Rec {
  return (contract.gloss_json ?? {}) as Rec;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `path:line` cite from an SclSourceRef-shaped value, or null. */
function citeOf(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const r = ref as Rec;
  const path = asString(r.path);
  if (!path) return null;
  return typeof r.line === 'number' ? `${path}:${r.line}` : path;
}

/** Markdown table cell: escape pipes, flatten newlines. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function normalizeFlag(flag: string): string {
  return flag.replace(/_/g, '-');
}

function flagsOf(contract: SclContractDto): string[] {
  const flags = bodyOf(contract).flags;
  return Array.isArray(flags)
    ? flags.filter((f): f is string => typeof f === 'string').map(normalizeFlag)
    : [];
}

// ---------------------------------------------------------------------------
// Modernization-decision relevance (DETERMINISTIC, documented)
// ---------------------------------------------------------------------------

interface StoryContractContext {
  /** stableStringify of every contract body + symbol — the verbatim corpus text. */
  corpusText: string;
  isEndpointGroup: boolean;
  layer: string | null;
  hasShapes: boolean;
  hasBoundaries: boolean;
  /** Normalized (hyphenated) shape flags across the story's contracts. */
  shapeFlags: Set<string>;
  /** Verbatim annotation texts across the story's behaviour tables. */
  annotations: string[];
  /** Contract symbols (relevance for the exceptions family). */
  symbols: string[];
}

function buildStoryContractContext(
  story: LoadedBookOfWorkItem,
  contracts: SclContractDto[]
): StoryContractContext {
  const tags = story.tags ?? [];
  const isEndpointGroup =
    story.codeStoryKind === 'scl-endpoint-group' ||
    tags.some((t) => t.startsWith('scl:endpoint:'));
  const layer =
    story.sclLayer ??
    tags
      .find((t) => t.startsWith('scl:foundation:'))
      ?.slice('scl:foundation:'.length) ??
    null;
  const shapeFlags = new Set<string>();
  const annotations: string[] = [];
  for (const contract of contracts) {
    if (contract.kind === 'shape') {
      for (const flag of flagsOf(contract)) shapeFlags.add(flag);
    }
    const anns = bodyOf(contract).annotations;
    if (Array.isArray(anns)) {
      for (const a of anns) {
        annotations.push(typeof a === 'string' ? a : JSON.stringify(a ?? ''));
      }
    }
  }
  return {
    corpusText: contracts
      .map((c) => `${symbolOf(c)}\n${stableStringify(c.body_json ?? {})}`)
      .join('\n'),
    isEndpointGroup,
    layer,
    hasShapes: contracts.some((c) => c.kind === 'shape'),
    hasBoundaries: contracts.some(isBoundary),
    shapeFlags,
    annotations,
    symbols: contracts.map(symbolOf),
  };
}

/** Tokens whose verbatim presence marks date-carrier content (family fallback). */
const DATE_CARRIER_RE = /joda|Date\b|Calendar|Instant|java\.time/;

/**
 * DETERMINISTIC decision→story relevance mapping (the documented mapping the
 * spec demands — simple, no LLM):
 *
 * 1. When the decision code matches a pair-ruleset rule
 *    (services/sclModernizationRuleset.ts), the rule's OWN matcher decides:
 *    - `sourceCarrier` / `typeReference` → the matcher's verbatim type text
 *      appears anywhere in the story's contract-body text (covers shape-field
 *      sourceCarriers AND `opaque:<type>` kinds in tables);
 *    - `annotationPrefix` → endpoint-group story, OR any contract annotation
 *      starts with one of the prefixes;
 *    - `representation` → the story carries any shape contract;
 *    - `boundaryClass` → the story carries any boundary [Q-] contract;
 *    - `flag` → any shape contract carries the flag (hyphen/underscore
 *      spellings tolerated).
 * 2. Codes with NO ruleset rule (LLM-proposed / future pairs) fall back to
 *    FAMILY defaults, family = second segment of `modernize.<family>.<slug>`:
 *    - `http`, `serialization` → endpoint-group stories;
 *    - `dto` → stories carrying shape contracts;
 *    - `dataaccess` → stories carrying boundary contracts;
 *    - `dates` → a date-carrier token (joda / Date / Calendar / Instant /
 *      java.time) appears verbatim in the contract text;
 *    - `collections`, `concurrency` → an `opaque:` kind appears in the
 *      contract text;
 *    - `exceptions` → the constants-exceptions layer, or any contract symbol
 *      ends with `Exception`;
 *    - `utility` → the utilities layer; `crosscutting` → the
 *      cross-cutting-fragments layer;
 *    - anything else → NOT story-relevant (the decision still rides the
 *      target-stack section every spec carries — nothing is hidden).
 */
export function isModernizeDecisionRelevant(
  decisionCode: string,
  ctx: StoryContractContext
): boolean {
  const rule = defaultModernizationRuleset().rules.find(
    (r) => r.code === decisionCode
  );
  if (rule) {
    switch (rule.matcher.kind) {
      case 'sourceCarrier':
      case 'typeReference':
        return ctx.corpusText.includes(rule.matcher.value);
      case 'annotationPrefix': {
        const prefixes = rule.matcher.anyOf;
        return (
          ctx.isEndpointGroup ||
          ctx.annotations.some((a) => prefixes.some((p) => a.startsWith(p)))
        );
      }
      case 'representation':
        return ctx.hasShapes;
      case 'boundaryClass':
        return ctx.hasBoundaries;
      case 'flag':
        return ctx.shapeFlags.has(normalizeFlag(rule.matcher.value));
      default:
        return false;
    }
  }
  const family = decisionCode.split('.')[1] ?? '';
  switch (family) {
    case 'http':
    case 'serialization':
      return ctx.isEndpointGroup;
    case 'dto':
      return ctx.hasShapes;
    case 'dataaccess':
      return ctx.hasBoundaries;
    case 'dates':
      return DATE_CARRIER_RE.test(ctx.corpusText);
    case 'collections':
    case 'concurrency':
      return ctx.corpusText.includes('opaque:');
    case 'exceptions':
      return (
        ctx.layer === 'constants-exceptions' ||
        ctx.symbols.some((s) => classOfSymbol(s).endsWith('Exception'))
      );
    case 'utility':
      return ctx.layer === 'utilities';
    case 'crosscutting':
      return ctx.layer === 'cross-cutting-fragments';
    default:
      return false;
  }
}

function decisionSummary(decision: TargetStateCapturedDecision): string {
  return (
    (decision.answerSummary && decision.answerSummary.trim()) ||
    decision.answerValue ||
    ''
  );
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

function cite(code: string): string {
  return `[decision:${code}]`;
}

function foundationObjective(
  layer: string | null,
  decisionCodes: Set<string>
): string {
  const dataAccessCodes = [...decisionCodes]
    .filter((c) => c.startsWith('modernize.dataaccess.'))
    .sort();
  switch (layer) {
    case 'constants-exceptions':
      return (
        'Implement the constants, enums and custom exception types in the contract ' +
        'blocks below — the zero-dependency layer every later story builds on. Enum ' +
        'values and exception type names are BEHAVIOUR (verbatim conditions and ' +
        '`throws:` outcomes reference them by name) — carry them verbatim.'
      );
    case 'dto-shapes':
      return (
        'Implement the DTO/domain shapes exactly as the shape contracts below specify. ' +
        'Field names, kinds, nullability and wire names are NORMATIVE; representation is ' +
        'not — implement shapes as records per ' +
        (decisionCodes.has('modernize.dto.pojo-record')
          ? cite('modernize.dto.pojo-record')
          : 'the confirmed modernization decisions') +
        ', EXCEPT shapes flagged mutated-in-flight (see the per-shape warnings below: ' +
        'those keep a mutable class or gain a builder).'
      );
    case 'cross-cutting-fragments':
      return (
        'Implement the shared behaviour fragments (fan-in >= 2) hoisted out of the ' +
        'endpoint verticals. Each fragment is implemented ONCE here; endpoint stories ' +
        'reference its outcome labels and NEVER re-implement it.'
      );
    case 'utilities':
      return (
        'Implement the shared utility functions (*Utils/*Util/*Helper fragments with ' +
        'fan-in >= 2) per their behaviour tables below. Every consumer story depends on ' +
        'the verbatim row semantics — outcome labels are the public surface.'
      );
    case 'data-access':
      return (
        'Implement the data-access repositories for the boundary [Q-] contracts below. ' +
        'The verbatim SQL / derived-query outcomes ARE the contract' +
        (dataAccessCodes.length > 0
          ? `; the repository idiom follows ${dataAccessCodes.map(cite).join(' ')}`
          : '') +
        ' — never paraphrase a query into a lossy derived name.'
      );
    case 'test-kit':
      return (
        'Build the shared test kit: fixture builders derived from the shape contracts ' +
        'below — the builders every endpoint story’s generated per-row suite consumes ' +
        'for its inputs and expected values. Builder defaults must satisfy each shape’s ' +
        'nullability exactly.'
      );
    default:
      return (
        'Implement the SCL corpus contracts in the blocks below for this foundation ' +
        'layer, exactly as specified.'
      );
  }
}

// ---------------------------------------------------------------------------
// Contract-block rendering
// ---------------------------------------------------------------------------

/**
 * Where an unresolved callee sits relative to the corpus (2026-09-10).
 *
 * Every low-scoring corpus spec carried the same UNRESOLVED_REFERENCE warning,
 * and two very different things were being penalised identically: an
 * in-project callee the scan did not mine (a real gap -- one unmined contract
 * was dragging down three specs across two layers) and a call OUTSIDE the
 * corpus boundary by nature (a JDK/library method such as a StringBuilder
 * append or a Class check, or a chain-break `?#name(?)` whose method name no
 * corpus contract carries). The latter will never have a contract, so warning
 * on it is noise that costs real quality points; it is now rendered as an
 * external call and NOT warned.
 */
export type UnresolvedTargetClass = 'outside_corpus' | 'in_project_unmined';

const OUTSIDE_CORPUS_PREFIXES = [
  'java.', 'javax.', 'jakarta.', 'kotlin.', 'scala.', 'sun.', 'jdk.',
  'org.springframework.', 'org.slf4j.', 'org.apache.', 'org.hibernate.', 'org.junit.',
  'com.google.', 'com.fasterxml.', 'lombok.', 'io.micrometer.', 'org.aspectj.', 'reactor.',
];

export function classifyUnresolvedTarget(
  targetSymbol: string,
  corpusByKey?: ReadonlyMap<string, SclContractDto>
): UnresolvedTargetClass {
  const hash = targetSymbol.indexOf('#');
  const cls = hash >= 0 ? targetSymbol.slice(0, hash) : targetSymbol;
  const method = hash >= 0 ? targetSymbol.slice(hash + 1).replace(/\(.*$/, '') : '';
  if (OUTSIDE_CORPUS_PREFIXES.some((p) => cls.startsWith(p))) return 'outside_corpus';
  if (cls === '?' || cls === '') {
    // Unknown receiver (chain break). In-project only if SOME corpus contract
    // carries a method of that name; otherwise nothing in the scan could ever
    // have resolved it and it is treated as external.
    if (!corpusByKey || !method) return 'outside_corpus';
    for (const c of corpusByKey.values()) {
      const sym = asString(bodyOf(c).symbol) ?? c.source_symbol ?? '';
      if (sym.includes(`#${method}(`)) return 'in_project_unmined';
    }
    return 'outside_corpus';
  }
  return 'in_project_unmined';
}

interface RenderState {
  warnings: Array<Record<string, unknown>>;
  /** Key -> contract for the whole corpus (2026-09-03); empty = legacy bare keys. */
  corpusByKey?: ReadonlyMap<string, SclContractDto>;
  /** Key -> carrying book item, for cross-spec navigation. */
  carriers?: ReadonlyMap<string, { itemId: string; title: string }>;
  /** Every contract key the rendered blocks referenced (for the index). */
  referencedKeys?: Set<string>;
}

/**
 * `References:` entry (2026-09-03, Kiro review IMPL-02 / C-1): the bare key
 * was dead text — nothing in any spec defined it, shape headings use the FQN.
 * Render the SYMBOL with the key parenthesised, and the spec that carries it.
 */
function renderReference(ref: string, state: RenderState): string {
  state.referencedKeys?.add(ref);
  const contract = state.corpusByKey?.get(ref);
  if (!contract) {
    return state.corpusByKey && state.corpusByKey.size > 0
      ? `\`${ref}\` (unresolved in corpus)`
      : `\`${ref}\``;
  }
  const carrier = state.carriers?.get(ref);
  const where = carrier ? ` → spec "${carrier.title}" (${carrier.itemId})` : '';
  return `\`${symbolOf(contract)}\` [${ref}]${where}`;
}

function renderOutcome(
  outcome: unknown,
  contractKey: string,
  state: RenderState
): string {
  if (!outcome || typeof outcome !== 'object') return '`(no outcome recorded)`';
  const o = outcome as Rec;
  const type = asString(o.type);
  if (type === 'terminal') {
    const ref = citeOf(o.ref);
    return (
      `terminal: \`${asString(o.verbatim) ?? ''}\`` +
      (ref ? ` (${ref})` : '') +
      (asString(o.outcomeLabel) ? ` → ${asString(o.outcomeLabel)}` : '')
    );
  }
  if (type === 'call') {
    const targetSymbol = asString(o.targetSymbol) ?? '?';
    const targetKey = asString(o.targetKey);
    // Verbatim call arguments (2026-09-03, DETAIL-02): the signature alone
    // hid which feed / flag the callee received.
    const callArgs = Array.isArray(o.args)
      ? o.args.filter((a): a is string => typeof a === 'string' && a.length > 0)
      : [];
    const argsSuffix =
      callArgs.length > 0 ? ` ← args (${callArgs.map((a) => `\`${a}\``).join(', ')})` : '';
    // Multi-candidate dispatch (2026-09-03): every implementation is carried;
    // the DI-wired primary leads when the injection site named it.
    const targetKeys = Array.isArray(o.targetKeys)
      ? o.targetKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : [];
    if (targetKeys.length > 1) {
      const [first, ...rest] = targetKeys;
      // Slash-separated: a pipe inside a markdown table cell is escaped.
      const label = targetKey
        ? `${first} (primary, DI-wired) / ${rest.join(' / ')}`
        : targetKeys.join(' / ');
      return (
        `call → [${label}] ${targetSymbol} — multi-candidate dispatch ` +
        `(${targetKeys.length} implementations, all carried below)${argsSuffix}`
      );
    }
    if (!targetKey) {
      if (classifyUnresolvedTarget(targetSymbol, state.corpusByKey) === 'outside_corpus') {
        // A JDK/library call, or a chain break no corpus contract could ever
        // resolve: outside the corpus boundary by nature. Rendered, not warned.
        return `call → (external — outside the corpus boundary, no contract by design) ${targetSymbol}${argsSuffix}`;
      }
      state.warnings.push({
        code: 'UNRESOLVED_REFERENCE',
        contractKey,
        targetSymbol,
        message:
          `Behaviour table ${contractKey} delegates to '${targetSymbol}' but the callee ` +
          `has no contract key in the corpus (targetKey null) — an IN-PROJECT callee the ` +
          `scan did not mine; the row is carried with an UNRESOLVED marker. Re-scan with ` +
          `that source in scope, or verify against the reachability report.`,
      });
      return `call → (UNRESOLVED — in-project callee with no corpus contract) ${targetSymbol}${argsSuffix}`;
    }
    return `call → [${targetKey}] ${targetSymbol}${argsSuffix}`;
  }
  if (type === 'absorb') {
    const ref = citeOf(o.ref);
    return (
      `absorb ${asString(o.exceptionType) ?? '?'} → \`${asString(o.thenVerbatim) ?? ''}\`` +
      (ref ? ` (${ref})` : '') +
      (asString(o.outcomeLabel) ? ` → ${asString(o.outcomeLabel)}` : '')
    );
  }
  return `\`${stableStringify(outcome)}\``;
}

function renderBehaviourBlock(
  contract: SclContractDto,
  state: RenderState
): string[] {
  const key = contract.contract_key ?? symbolOf(contract);
  const body = bodyOf(contract);
  const gloss = glossOf(contract);
  const lines: string[] = [];
  lines.push(`### Behaviour: ${symbolOf(contract)}`);
  lines.push('');
  // Verbatim annotations (2026-09-03, DETAIL-06): cross-cutting markers such
  // as audit/timing annotations are behaviour the target must honour; they
  // were collected for relevance but never shown.
  const annotationTexts = Array.isArray(body.annotations)
    ? body.annotations
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a ?? '')))
        .filter((a) => a.length > 0)
    : [];
  if (annotationTexts.length > 0) {
    lines.push(`Annotations: ${annotationTexts.map((a) => `\`${a}\``).join(', ')}`);
    lines.push('');
  }
  lines.push(...renderCapturedFacts(body));
  const intent = asString(gloss.intent);
  if (intent) {
    lines.push(`_Intent (guarded gloss): ${intent}_`);
    lines.push('');
  }
  const rowGlosses =
    gloss.row_glosses && typeof gloss.row_glosses === 'object'
      ? (gloss.row_glosses as Record<string, unknown>)
      : {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  lines.push('| # | Kind | Condition (verbatim) | Outcome | Gloss |');
  lines.push('| --- | --- | --- | --- | --- |');
  let hadCacheBridge = false;
  rows.forEach((raw, i) => {
    const row = (raw ?? {}) as Rec;
    const index = typeof row.index === 'number' ? row.index : i;
    const kind = asString(row.kind) ?? '';
    const conditionVerbatim = asString(row.conditionVerbatim);
    const conditionCite = citeOf(row.conditionRef);
    // Cache-bridge rows (2026-08-23): the extractor's sentinel documents HOW
    // the legacy service served the read (in-process cache in front of the
    // DB loader). Normalize it so implementers read a DATA requirement, not
    // a caching instruction — the note below carries the ruling.
    const isCacheBridge = conditionVerbatim === 'cache miss -> loader';
    if (isCacheBridge) hadCacheBridge = true;
    const condition = isCacheBridge
      ? '`on legacy cache miss`' + (conditionCite ? ` (${conditionCite})` : '')
      : conditionVerbatim
        ? `\`${conditionVerbatim}\`` + (conditionCite ? ` (${conditionCite})` : '')
        : '—';
    const outcome = renderOutcome(row.outcome, key, state);
    const rowGloss =
      asString(row.gloss) ??
      asString(rowGlosses[String(index)]) ??
      (isCacheBridge ? 'Data effect is the requirement; the legacy cache is NOT.' : '');
    lines.push(
      `| ${index} | ${cell(kind)} | ${cell(condition)} | ${cell(outcome)} | ${cell(rowGloss)} |`
    );
  });
  lines.push('');
  if (hadCacheBridge) {
    lines.push(
      '**Legacy cache note:** the `on legacy cache miss` row(s) above document how the ' +
        'legacy service served these reads — an in-process cache in front of the DB ' +
        'loader. The DATA EFFECTS are the behavioural requirement; replicating the ' +
        'cache is a target-architecture choice recorded as the `legacy_cache_strategy` ' +
        'foundations decision. Do NOT add caching to satisfy this spec.'
    );
    lines.push('');
  }
  const outcomeSignature = Array.isArray(body.outcomeSignature)
    ? body.outcomeSignature
    : [];
  if (outcomeSignature.length > 0) {
    const rendered = outcomeSignature
      .map((o) => {
        const oo = (o ?? {}) as Rec;
        const label = asString(oo.label) ?? '?';
        const kind = asString(oo.kind);
        return `\`${label}\`${kind ? ` (${kind})` : ''}`;
      })
      .join(', ');
    lines.push(`Outcome signature: ${rendered}`);
  }
  const references = Array.isArray(body.references)
    ? body.references.filter((r): r is string => typeof r === 'string')
    : [];
  lines.push(
    references.length > 0
      ? `References: ${references.map((r) => renderReference(r, state)).join(', ')}`
      : 'References: none'
  );
  lines.push('');
  return lines;
}

/** JDK / framework result types that never have a corpus shape contract. */
const NON_SHAPE_RETURN_TYPES = new Set([
  'void', 'Void', 'boolean', 'Boolean', 'byte', 'short', 'int', 'Integer', 'long', 'Long',
  'float', 'Float', 'double', 'Double', 'char', 'Character', 'String', 'Object',
  'List', 'Map', 'Set', 'Collection', 'Optional', 'Response', 'ResponseEntity', 'Iterable',
]);

/** `value:com.app.Foo<Bar>[]` -> `com.app.Foo` (outer type only, generics/arrays stripped). */
function returnedTypeOf(label: string): string | null {
  if (!label.startsWith('value:')) return null;
  let type = label.slice('value:'.length).trim();
  const lt = type.indexOf('<');
  if (lt >= 0) type = type.slice(0, lt);
  type = type.replace(/\[\s*\]/g, '').trim();
  if (type.length === 0) return null;
  const simple = type.includes('.') ? type.slice(type.lastIndexOf('.') + 1) : type;
  if (NON_SHAPE_RETURN_TYPES.has(simple)) return null;
  if (/^(java|javax|jakarta)\./.test(type)) return null;
  return type;
}

export interface JoinedResponseShape {
  label: string;
  rootSymbol: string;
  /** The joined shape; null when `unmatched` names a returned type with no corpus shape. */
  contract: SclContractDto | null;
  unmatched: string[];
}

/**
 * Join the returned types named by the story's behaviour-table outcome
 * signatures to shape contracts. Exact FQN match first, then a UNIQUE
 * simple-name match; shapes already carried by the story are not repeated.
 * Exported for tests.
 */
export function joinResponseShapes(
  storyContracts: ReadonlyArray<SclContractDto>,
  shapeIndex: ReadonlyArray<SclContractDto>
): JoinedResponseShape[] {
  if (shapeIndex.length === 0) return [];
  const carriedKeys = new Set(storyContracts.map((c) => c.contract_key ?? symbolOf(c)));
  const byFqn = new Map<string, SclContractDto>();
  const bySimple = new Map<string, SclContractDto[]>();
  for (const shape of shapeIndex) {
    if (shape.kind !== 'shape') continue;
    const sym = symbolOf(shape);
    if (!sym) continue;
    byFqn.set(sym, shape);
    const simple = sym.includes('.') ? sym.slice(sym.lastIndexOf('.') + 1) : sym;
    bySimple.set(simple, [...(bySimple.get(simple) ?? []), shape]);
  }
  const out: JoinedResponseShape[] = [];
  const seenKeys = new Set<string>();
  const unmatchedSeen = new Set<string>();
  for (const contract of storyContracts) {
    if (contract.kind !== 'behaviour_table') continue;
    const body = bodyOf(contract);
    const signature = Array.isArray(body.outcomeSignature) ? body.outcomeSignature : [];
    for (const raw of signature) {
      const label = asString((raw as Rec)?.label);
      if (!label) continue;
      const type = returnedTypeOf(label);
      if (!type) continue;
      const simple = type.includes('.') ? type.slice(type.lastIndexOf('.') + 1) : type;
      const candidates = byFqn.has(type) ? [byFqn.get(type)!] : bySimple.get(simple) ?? [];
      const match = candidates.length === 1 ? candidates[0] : null;
      if (!match) {
        if (candidates.length === 0 && !unmatchedSeen.has(type)) {
          unmatchedSeen.add(type);
          out.push({ label, rootSymbol: symbolOf(contract), contract: null, unmatched: [type] });
        }
        continue;
      }
      const key = match.contract_key ?? symbolOf(match);
      if (carriedKeys.has(key) || seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push({ label, rootSymbol: symbolOf(contract), contract: match, unmatched: [] });
    }
  }
  return out;
}

/**
 * Captured behaviour facts the rows alone hid (2026-09-03, BEHAV-03/04/05):
 * cache-fronting, aspect advice, data-derived authorisation. Rendered under
 * the behaviour heading so the reader sees them before the rows.
 */
function renderCapturedFacts(body: Rec): string[] {
  const lines: string[] = [];
  const cache = body.cacheFacts as Rec | undefined;
  if (cache && typeof cache === 'object') {
    const missLoads = Array.isArray(cache.missLoads) ? cache.missLoads.map(String) : [];
    const mutators = Array.isArray(cache.mutators) ? (cache.mutators as Rec[]) : [];
    lines.push(
      `**Cache-fronting (legacy read path):** reads through \`${asString(cache.cacheField) ?? '?'}\` ` +
        `(\`${asString(cache.cacheType) ?? '?'}\`` +
        (asString(cache.keyType) ? `, keyed by \`${asString(cache.keyType)}\`` : '') +
        '). A WARM cache serves this read with NO data access; ' +
        (missLoads.length > 0
          ? `a MISS loads via ${missLoads.map((s) => `\`${s}\``).join(', ')}; `
          : 'the miss path is not carried on this table; ') +
        (mutators.length > 0
          ? `process-local mutation/invalidation sites: ${mutators
              .map((m) => `\`${asString(m.symbol) ?? '?'}\` (${(Array.isArray(m.operations) ? m.operations : []).join('/')})`)
              .join(', ')}.`
          : 'no in-class mutation/invalidation sites — entries live until process restart.') +
        ' Other processes do not observe process-local writes until expiry or an explicit refresh.'
    );
    lines.push('');
  }
  const advisedBy = Array.isArray(body.advisedBy) ? (body.advisedBy as Rec[]) : [];
  if (advisedBy.length > 0) {
    lines.push(
      `**Advised by:** ${advisedBy
        .map((a) => {
          const key = asString(a.targetKey);
          return `\`${asString(a.aspectSymbol) ?? '?'}\` ${asString(a.adviceKind) ?? ''} ` +
            `(\`${asString(a.pointcut) ?? ''}\`)${key ? ` → [${key}]` : ' (advice body not a table)'}`;
        })
        .join('; ')} — the advice runs on EVERY invocation of this method; its data effects are part of this endpoint's behaviour.`
    );
    lines.push('');
  }
  const auth = body.authorisation as Rec | undefined;
  if (auth && typeof auth === 'object') {
    const predicates = Array.isArray(auth.predicates) ? auth.predicates.map(String) : [];
    const denied = Array.isArray(auth.deniedOutcomes) ? auth.deniedOutcomes.map(String) : [];
    const boundaries = Array.isArray(auth.boundaryKeys) ? auth.boundaryKeys.map(String) : [];
    lines.push(
      `**Authorisation (data-derived):** access is decided by ${predicates.map((p) => `\`${p}\``).join(', ')}` +
        (denied.length > 0 ? `, denying with ${denied.map((d) => `\`${d}\``).join(', ')}` : '') +
        (boundaries.length > 0
          ? `; the predicate reads ${boundaries.map((b) => `[${b}]`).join(', ')} — those tables ARE the access-control list and must be migrated as such.`
          : '.') +
        ' Do NOT replace this with annotation- or group-based authorisation: the rule lives in data.'
    );
    lines.push('');
  }
  return lines;
}

function renderShapeBlock(contract: SclContractDto): string[] {
  const body = bodyOf(contract);
  const lines: string[] = [];
  lines.push(`### Shape: ${symbolOf(contract)}`);
  lines.push('');
  const representation = asString(body.representation);
  const flags = flagsOf(contract);
  lines.push(
    `Representation: ${representation ?? 'unspecified'} (non-normative); ` +
      `flags: ${flags.length > 0 ? flags.join(', ') : 'none'}`
  );
  if (flags.includes('mutated-in-flight')) {
    lines.push('');
    lines.push(
      '**WARNING — mutated-in-flight:** the slicer observed a setter call AFTER ' +
        'construction on this shape (the record-conversion hazard the flag notes). ' +
        'This shape keeps a mutable class or gains a builder EVEN where the ' +
        'record-representation decision applies — never silently drop the mutation ' +
        'site’s behaviour.'
    );
  }
  lines.push('');
  lines.push('| Field | Kind | Nullable | Wire name | Source carrier | Notes |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  const fields = Array.isArray(body.fields) ? body.fields : [];
  for (const raw of fields) {
    const f = (raw ?? {}) as Rec;
    const notes = Array.isArray(f.notes)
      ? f.notes.filter((n): n is string => typeof n === 'string').join('; ')
      : '';
    lines.push(
      `| ${cell(asString(f.name) ?? '')} ` +
        `| ${cell(asString(f.kind) ?? '')} ` +
        `| ${f.nullable === true ? 'yes' : f.nullable === false ? 'no' : '?'} ` +
        `| ${cell(asString(f.wireName) ?? '—')} ` +
        `| ${cell(asString(f.sourceCarrier) ?? '—')} ` +
        `| ${cell(notes)} |`
    );
  }
  lines.push('');
  return lines;
}

function renderBoundaryBlock(contract: SclContractDto): string[] {
  const body = bodyOf(contract);
  const lines: string[] = [];
  lines.push(`### Boundary: ${symbolOf(contract)}`);
  lines.push('');
  const operations = Array.isArray(body.operations) ? body.operations : [];
  for (const raw of operations) {
    const op = (raw ?? {}) as Rec;
    const name = asString(op.name) ?? '?';
    const sql = asString(op.sqlVerbatim) ?? asString(op.sql);
    const ref = citeOf(op.ref);
    if (sql) {
      lines.push(`Operation \`${name}\`${ref ? ` (${ref})` : ''}:`);
      lines.push('');
      lines.push('```sql');
      lines.push(sql);
      lines.push('```');
    } else {
      lines.push(
        `Operation \`${name}\`${ref ? ` (${ref})` : ''}: derived query (no verbatim SQL) — ` +
          'the method NAME is the contract.'
      );
    }
    const resultShape = asString(op.resultShape);
    lines.push(
      resultShape ? `Result shape: \`${resultShape}\`` : 'Result shape: unspecified'
    );
    lines.push('');
  }
  if (operations.length === 0) {
    lines.push('_No operations recorded on this boundary contract._');
    lines.push('');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The carriage entry point (mirrors runScaffoldSpecCarriage)
// ---------------------------------------------------------------------------

export function runSclSpecCarriage(args: {
  story: LoadedBookOfWorkItem;
  baseRow: MigrationStorySpecGenerationDto;
  /** The story's contracts, resolved from the fetched corpus by key. */
  contracts: SclContractDto[];
  decisions: readonly TargetStateCapturedDecision[];
  /** Pre-built wire-fidelity section (buildWireFidelitySpecSection), or null. */
  wireFactsSectionText: string | null;
  /** Pre-built target-stack section (buildTargetStackSpecSection), or null. */
  targetStackSectionText: string | null;
  /**
   * Every SHAPE contract of the corpus (2026-09-03), not just the story's own
   * keys, so an endpoint spec can JOIN its roots' declared return types to the
   * shape contracts that describe them. Optional: absent = no join rendered.
   */
  shapeIndex?: ReadonlyArray<SclContractDto>;
  /**
   * The WHOLE corpus (2026-09-03), so `References:` lines resolve keys to
   * symbols and reached boundaries carry their verbatim SQL. Optional: absent
   * = keys render bare (legacy) and no boundaries-reached section.
   */
  corpusIndex?: ReadonlyArray<SclContractDto>;
  /** Which book item CARRIES each contract key (its scl_contract_keys). */
  contractCarriers?: ReadonlyMap<string, { itemId: string; title: string }>;
}): MigrationStorySpecGenerationDto {
  const { story, baseRow, contracts, decisions } = args;
  const corpusIndex = args.corpusIndex ?? [];
  // Legacy callers pass no index: References stay bare keys, no index section.
  const hasCorpusIndex = args.corpusIndex !== undefined;
  const shapeIndex = args.shapeIndex ?? corpusIndex.filter((c) => c.kind === 'shape');
  const corpusByKey = new Map<string, SclContractDto>();
  for (const c of corpusIndex) {
    if (typeof c.contract_key === 'string') corpusByKey.set(c.contract_key, c);
  }
  for (const c of contracts) {
    if (typeof c.contract_key === 'string' && !corpusByKey.has(c.contract_key)) {
      corpusByKey.set(c.contract_key, c);
    }
  }
  const carriers = args.contractCarriers ?? new Map<string, { itemId: string; title: string }>();

  // -- Contract resolution: NO partial specs -------------------------------
  const orderedKeys = story.sclContractKeys ?? [];
  const byKey = new Map<string, SclContractDto>();
  for (const contract of contracts) {
    if (typeof contract.contract_key === 'string') {
      byKey.set(contract.contract_key, contract);
    }
  }
  const missingKeys = orderedKeys.filter((k) => !byKey.has(k));
  if (orderedKeys.length === 0 || missingKeys.length > 0) {
    const detail =
      orderedKeys.length === 0
        ? 'the story blob carries no scl_contract_keys'
        : `SCL contract(s) ${missingKeys.map((k) => `'${k}'`).join(', ')} are not ` +
          'resolvable from the latest scan’s corpus (or the corpus could not be read)';
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'scl_contracts',
          missingKeys,
          reason:
            `Corpus-derived specs embed their SCL contracts VERBATIM and never ` +
            `partial-fill, but ${detail}. Re-run the code scan (Structural Model tab), ` +
            `then regenerate this spec.`,
        },
      ],
      errorMessage: null,
    };
  }

  // -- Modernization decisions: blocking input (missing-inputs discipline) --
  const modernizeDecisions = decisions.filter((d) =>
    d.decisionCode.startsWith('modernize.')
  );
  if (modernizeDecisions.length === 0) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'confirmed_modernization_decisions',
          reason:
            'No modernize.* decisions are captured for this plan’s target ' +
            'architecture — the corpus-derived spec cites a confirmed decision for ' +
            'every representation choice and will not guess. Confirm the ' +
            'modernization decisions on the Target State screen, then regenerate.',
        },
      ],
      errorMessage: null,
    };
  }

  const orderedContracts = orderedKeys.map((k) => byKey.get(k)!);

  // Contract sufficiency (2026-09-09). A contract with a signature and NOTHING
  // to build from -- no rows, no SQL-bearing operation, no fields -- cannot be
  // implemented from this spec. Every carried contract unimplementable =>
  // this story is refused as insufficient context (never a spec that reads as
  // buildable). Some => they are kept AND stamped as declared gaps, so the
  // traceability that made the failure diagnosable is not lost by silently
  // excluding them.
  const unimplementableKeys = orderedKeys.filter((k) => contractIsUnimplementable(byKey.get(k)!));
  if (unimplementableKeys.length === orderedKeys.length) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'scl_contracts_unimplementable',
          missingKeys: unimplementableKeys,
          reason:
            `Every SCL contract this story carries (${unimplementableKeys.map((k) => `'${k}'`).join(', ')}) ` +
            'has a signature and NOTHING to build from: no behaviour rows, no boundary ' +
            'operation with verbatim SQL, no shape fields. Corpus-derived specs never ' +
            'invent behaviour, so there is no spec to write. Re-run the code scan with ' +
            'the missing source in scope, or accept the gap as a known_gap disposition, ' +
            'then regenerate.',
        },
      ],
      errorMessage: null,
    };
  }

  const ctx = buildStoryContractContext(story, orderedContracts);
  const state: RenderState = {
    warnings: [],
    corpusByKey: hasCorpusIndex ? corpusByKey : undefined,
    carriers,
    referencedKeys: new Set<string>(),
  };
  for (const key of unimplementableKeys) {
    state.warnings.push({
      code: 'CONTRACT_UNIMPLEMENTABLE',
      contractKey: key,
      message:
        `SCL contract ${key} carries a signature and nothing to build from (no rows, ` +
        `no SQL-bearing operation, no fields). It is rendered as a DECLARED GAP; the ` +
        `implementer must not invent its behaviour.`,
    });
  }
  const boundaryKeys = (story.sclBoundaryKeys ?? []).filter((k) => !orderedKeys.includes(k));

  // -- Header + objective ---------------------------------------------------
  const lines: string[] = [];
  lines.push(`# ${story.title}`);
  lines.push('');
  lines.push(
    'This spec was assembled DETERMINISTICALLY from the SCL corpus — reproduce it ' +
      'faithfully; never re-derive, substitute, or paraphrase inside a contract block. ' +
      'The contracts below are the construction truth mined from the legacy source ' +
      '(verbatim conditions/outcomes with file:line cites); representation modernizes ' +
      'per the cited decisions, semantics never do.'
  );
  lines.push('');
  lines.push('## Objective');
  lines.push('');
  const decisionCodes = new Set(modernizeDecisions.map((d) => d.decisionCode));
  if (ctx.isEndpointGroup) {
    const endpointKind = (story.tags ?? []).includes('scl:endpoint:internal')
      ? 'internal'
      : 'external';
    const rootCount =
      orderedContracts.filter(isRootTable).length || orderedContracts.length;
    const controller =
      story.sclControllerClass ??
      classOfSymbol(symbolOf(orderedContracts[0]));
    lines.push(
      `Implement the ${simpleClassName(controller)} endpoints (${rootCount} ` +
        `${endpointKind}) against the pre-built foundational layers. Shared fragments ` +
        `(fan-in >= 2), shapes and boundary repositories are ALREADY implemented by the ` +
        `foundation stories — reference them by their contract keys and outcome labels, ` +
        `never re-implement them. The behaviour tables below (including this ` +
        `controller’s non-shared vertical residue) are the whole scope.`
    );
  } else {
    lines.push(foundationObjective(ctx.layer, decisionCodes));
  }
  lines.push('');

  // -- Modernization decisions section --------------------------------------
  lines.push('## Modernization decisions (confirmed — cite, never re-decide)');
  lines.push('');
  const relevant = modernizeDecisions.filter((d) =>
    isModernizeDecisionRelevant(d.decisionCode, ctx)
  );
  if (relevant.length > 0) {
    lines.push(
      'The confirmed modernization decisions below are RELEVANT to this story’s ' +
        'contracts (deterministic mapping — see sclSpecCarriage.ts). Representation ' +
        'follows them; the verbatim semantics in the contract blocks never change.'
    );
    lines.push('');
    for (const decision of relevant) {
      lines.push(`- ${cite(decision.decisionCode)} ${decisionSummary(decision)}`);
    }
  } else {
    lines.push(
      '_None of the confirmed modernization decisions map to this story’s ' +
        'contracts; the full set rides the target-stack section below._'
    );
  }
  lines.push('');

  // -- Contract blocks -------------------------------------------------------
  lines.push('## Contract blocks (verbatim — the construction truth)');
  lines.push('');
  for (const contract of orderedContracts) {
    if (isBoundary(contract)) {
      lines.push(...renderBoundaryBlock(contract));
    } else if (contract.kind === 'shape') {
      lines.push(...renderShapeBlock(contract));
    } else {
      lines.push(...renderBehaviourBlock(contract, state));
    }
  }

  // -- Response shapes joined by declared return type (2026-09-03) ------------
  // Kiro review IMPL-03 / C-3: the corpus held a full field table for the
  // exact type every resource method returns, while the endpoint spec said
  // "no committed response contract" in a different document with no
  // cross-reference. The root tables' outcome signatures name the returned
  // type (`value:<Type>`); join it to the shape contract and carry the shape
  // verbatim here. Duplicated by design — each endpoint spec must be
  // implementable alone.
  const joinedShapes = joinResponseShapes(orderedContracts, shapeIndex);
  if (joinedShapes.length > 0) {
    lines.push('## Response shapes (joined by declared return type)');
    lines.push('');
    lines.push(
      'The shape contracts below describe the types the behaviour tables above RETURN ' +
        '(`value:<Type>` outcomes). They are carried verbatim from the corpus so the ' +
        'response wire shape is constructible from this spec alone.'
    );
    lines.push('');
    for (const joined of joinedShapes) {
      if (!joined.contract) {
        for (const missing of joined.unmatched) {
          lines.push(
            `_No shape contract in the corpus for returned type \`${missing}\` ` +
              `(from \`${joined.label}\` on \`${joined.rootSymbol}\`)._`
          );
          lines.push('');
        }
        continue;
      }
      lines.push(
        `Joined from \`${joined.label}\` on \`${joined.rootSymbol}\` → contract ` +
          `\`${joined.contract.contract_key ?? symbolOf(joined.contract)}\``
      );
      lines.push('');
      lines.push(...renderShapeBlock(joined.contract));
    }
  }

  // -- Declared gaps (2026-09-09) ---------------------------------------------
  if (unimplementableKeys.length > 0) {
    lines.push('## Declared gaps (contracts with nothing to build from)');
    lines.push('');
    lines.push(
      'The following carried contract(s) have a signature and NOTHING captured to ' +
        'build from: no behaviour rows, no boundary operation with verbatim SQL, no ' +
        'shape fields. They are listed here as DECLARED GAPS, not as work. Do NOT ' +
        'invent their behaviour, do NOT stub them to make a test pass, and do NOT ' +
        'mark a task for them done: record any task that depends on one as ' +
        '`- [~] <task> — BLOCKED: contract <key> is a declared gap (no captured ' +
        'behaviour)`. The gap is resolved upstream (re-scan with the missing source ' +
        'in scope, or a known_gap disposition), not in this story.'
    );
    lines.push('');
    for (const key of unimplementableKeys) {
      const c = byKey.get(key)!;
      lines.push(`- [${key}] \`${asString(bodyOf(c).symbol) ?? c.source_symbol ?? key}\` — ${c.kind ?? 'contract'} with no captured behaviour`);
    }
    lines.push('');
  }

  // -- Boundaries reached (2026-09-03, Kiro review A-2 / C-2) ---------------
  // The planner lists the Q- boundaries this story's rows reach transitively;
  // the DAO SQL an endpoint delegates to is part of its behaviour, so it is
  // carried here verbatim (the data-access layer spec still owns the
  // implementation; this is the reader's view of what the rows touch).
  const reachedBoundaries = boundaryKeys
    .map((k) => corpusByKey.get(k))
    .filter((c): c is SclContractDto => c !== undefined);
  const unresolvedBoundaryKeys = boundaryKeys.filter((k) => !corpusByKey.has(k));
  if (reachedBoundaries.length > 0 || unresolvedBoundaryKeys.length > 0) {
    lines.push('## Boundaries reached (data access)');
    lines.push('');
    lines.push(
      'Repositories / DAOs this story\'s behaviour rows reach through delegation. The ' +
        'verbatim SQL is the behavioural requirement the target must reproduce; the ' +
        'data-access layer spec owns the implementation.'
    );
    lines.push('');
    for (const boundary of reachedBoundaries) {
      const key = boundary.contract_key ?? symbolOf(boundary);
      state.referencedKeys?.add(key);
      const carrier = carriers.get(key);
      lines.push(
        `### Boundary reached: ${symbolOf(boundary)} [${key}]` +
          (carrier ? ` — carried by "${carrier.title}" (${carrier.itemId})` : '')
      );
      lines.push('');
      const body = bodyOf(boundary);
      const operations = Array.isArray(body.operations) ? body.operations : [];
      if (operations.length === 0) lines.push('_No operations recorded on this boundary contract._');
      for (const raw of operations) {
        const op = (raw ?? {}) as Rec;
        const name = asString(op.name) ?? '?';
        const sql = asString(op.sqlVerbatim) ?? asString(op.sql);
        const ref = citeOf(op.ref);
        lines.push(`- \`${name}\`${ref ? ` (${ref})` : ''}`);
        if (sql) {
          lines.push('');
          lines.push('```sql');
          lines.push(sql);
          lines.push('```');
          lines.push('');
        }
      }
      lines.push('');
    }
    for (const k of unresolvedBoundaryKeys) {
      lines.push(`_Boundary \`${k}\` is listed on the story but not resolvable from the corpus._`);
    }
    lines.push('');
  }

  // -- Contract index (2026-09-03, Kiro review IMPL-02 / C-1) -----------------
  // Every key this spec carries or references, resolved to symbol + kind +
  // the book item that carries it: 305 bare keys used to be dead text.
  if (hasCorpusIndex) {
    const indexKeys = [...new Set([...orderedKeys, ...(state.referencedKeys ?? [])])].sort();
    lines.push('## Contract index');
    lines.push('');
    lines.push('| Key | Kind | Symbol | Carried by |');
    lines.push('| --- | --- | --- | --- |');
    for (const key of indexKeys) {
      const contract = corpusByKey.get(key);
      const carrier = orderedKeys.includes(key)
        ? 'this spec'
        : carriers.get(key)
          ? `"${carriers.get(key)!.title}" (${carriers.get(key)!.itemId})`
          : 'no carrying spec found';
      lines.push(
        `| \`${key}\` | ${contract?.kind ?? 'unresolved'} | ` +
          `${contract ? `\`${symbolOf(contract)}\`` : '_not in corpus_'} | ${carrier} |`
      );
    }
    lines.push('');
  }

  // -- Acceptance criteria (the round-3 TDD ruling, verbatim posture) --------
  lines.push('## Acceptance criteria');
  lines.push('');
  // Template criteria reworded with MEASURABLE signals (2026-09-10). The
  // quality scorer's ac_measurability dimension (25% of the score) rates each
  // criterion on numeric token / status keyword / named entity / measurable
  // verb; "is GREEN." carried one of the four, so this one tool-authored
  // sentence was the weakest criterion on EVERY corpus spec in the book
  // (ac_measurability 42-46 on every low scorer). The criteria now say what
  // "green" and "not modified" mean in checkable terms.
  lines.push(
    '1. The shipped test suite (committed to this branch BEFORE implementation) is GREEN: ' +
      "the repository's test runner MUST exit 0 and its reports MUST show 0 failures, " +
      '0 errors and 0 wholly-skipped test classes (skipped is not passed).'
  );
  lines.push(
    '2. NO shipped test file was modified: `git diff` over the shipped file set MUST ' +
      'report 0 changed lines. A test you believe is wrong must be ' +
      'CONTESTED (flag with evidence via the contested-test protocol) — never edited; ' +
      'upheld contests quarantine the test visibly.'
  );
  // Assertion guidance for the implementer's OWN tests (2026-09-09). Live
  // cost: three consecutive parts of one layer each quarantined the previous
  // part's "scope boundary" / "roster" assertions -- exact file or class
  // counts in a package -- because every part ADDS files, so each part is
  // structurally guaranteed to invalidate its predecessor's counts. Seven
  // quarantine entries with multi-paragraph justifications, for assertions
  // nothing tool-side ever asked for: the implementing agent invented the
  // pattern. The valuable assertions in those same classes never needed
  // quarantining, because they pinned semantic invariants.
  lines.push(
    '   Additional tests you write yourself MUST NOT pin the NUMBER of files or ' +
      'classes in a package, nor enumerate a "roster" of expected types: every later ' +
      'part of this layer ADDS files, so such an assertion is guaranteed to break and ' +
      'be quarantined. Pin the semantic invariant instead — no controller mapping ' +
      'added, every mapped table pre-existing, one repository home per aggregate, no ' +
      'duplicate DAO beyond the declared seam. If you find yourself counting, you are ' +
      'asserting the wrong thing.'
  );
  lines.push(
    '3. Every behaviour-table row above corresponds to implemented behaviour; verbatim ' +
      'conditions/outcomes are the contract — representation may modernize per the ' +
      'cited decisions, semantics may not.'
  );
  // Replay criteria (2026-09-03, Kiro review MECH-02 / IMPL-07): name the
  // verification assets that exist. Each resolved endpoint gets one criterion
  // naming the active baseline that covers it (the AMVS replay harness's
  // machine-readable target); an uncovered endpoint says so instead of
  // pretending.
  const acEndpointIds = story.apiEndpointIds ?? [];
  const baselineByEndpoint = story.baselineByEndpointId ?? {};
  const declaredRoutes = story.sclDeclaredRoutes ?? [];
  let acIndex = 4;
  for (const endpointId of acEndpointIds) {
    const baselineId = baselineByEndpoint[endpointId] ?? null;
    if (baselineId) {
      lines.push(
        `${acIndex}. Endpoint \`${endpointId}\`: replay EVERY accepted capture of baseline ` +
          `\`${baselineId}\` against the target (AMVS replay) — status, declared headers ` +
          'and body must match; a divergence is a failed criterion, not a note.'
      );
    } else {
      lines.push(
        `${acIndex}. Endpoint \`${endpointId}\`: NO active baseline covers it — capture and ` +
          'save a baseline before this story can be verified (missing_baseline).'
      );
    }
    acIndex += 1;
  }
  // One criterion per carried contract block (2026-09-03, MECH-03): the AC
  // count scales with the content instead of a constant three.
  for (const contract of orderedContracts) {
    const key = contract.contract_key ?? symbolOf(contract);
    lines.push(
      `${acIndex}. Contract \`${symbolOf(contract)}\` [${key}] (${contract.kind}): every carried ` +
        'row / field / operation above is implemented and verified row-by-row.'
    );
    acIndex += 1;
  }
  if (declaredRoutes.length > 0) {
    lines.push('');
    lines.push(`Declared routes under verification: ${declaredRoutes.map((r) => `\`${r}\``).join(', ')}`);
  }
  lines.push('');
  // Attached discovery findings (2026-09-03, BEHAV-07): the plan item carried
  // them but the spec body never did.
  const findingIds = story.findingIds ?? [];
  if (findingIds.length > 0) {
    lines.push('## Attached findings');
    lines.push('');
    lines.push(
      'Discovery findings attached to the endpoints this story implements. Each must be ' +
        'addressed in the implementation or explicitly carried forward with a reason — ' +
        'silence is not a disposition.'
    );
    lines.push('');
    for (const id of findingIds) lines.push(`- \`${id}\``);
    lines.push('');
  }

  // -- Stack + wire sections (same helpers + order as the LLM path). NOTE:
  // NO captured-examples section anywhere — captures live only in reconcile
  // and the extraction-time contradiction pass (round-3 ruling).
  let text = lines.join('\n');
  // The spec above already lists the story-RELEVANT modernize.* decisions;
  // the stack dump therefore carries the target stack proper only (no
  // modernize.* repeat, no identity no-ops) — Kiro review BEHAV-08: two-thirds
  // of every spec was the identical 98-decision dump.
  // Fallback keeps a stack section whenever the batch built one: a project
  // whose only captured decisions are modernize.* gets the batch section
  // (no-op-free) rather than nothing.
  text = appendTargetStackSection(
    text,
    args.targetStackSectionText
      ? buildTargetStackSpecSection(decisions, {
          dropIdentityNoOps: true,
          excludeCodes: (code) => code.startsWith('modernize.'),
        }) ?? args.targetStackSectionText
      : null
  );
  text = appendWireFidelitySection(text, args.wireFactsSectionText);

  return {
    ...baseRow,
    status: state.warnings.length > 0 ? 'generated_with_warnings' : 'generated',
    confidence: 'high',
    generatedSpecText: text,
    // D9 groundwork finally populated for deterministic carriages (2026-09-03):
    // the endpoint coverage gate and Join 4 read this column.
    coveredEndpointIds: story.apiEndpointIds ?? [],
    warningsJson: state.warnings.length > 0 ? state.warnings : null,
    missingInputsJson: [],
    focusedContextRefsJson: {
      source: 'scl_spec_carriage',
      contractCount: orderedContracts.length,
      layer: ctx.isEndpointGroup ? null : ctx.layer,
      controller: ctx.isEndpointGroup ? (story.sclControllerClass ?? null) : null,
    },
    generatedAt: new Date().toISOString(),
    errorMessage: null,
  };
}
