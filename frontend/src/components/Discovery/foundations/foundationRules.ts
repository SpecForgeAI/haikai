/**
 * Foundations Review — deterministic rules (Foundations & Scope program,
 * Spec 2, 2026-08-22).
 *
 * Questions are DERIVED, decisions are STORED: this module computes the
 * open questions for a DB-scan review from the run's candidates plus the
 * architecture's saved foundation decisions. Accretion and staleness come
 * free — an answered question disappears while its evidence hash matches
 * the stored decision, and REOPENS (stale-chipped, previous answer shown)
 * when the evidence changed. Unanswered questions apply safe defaults
 * downstream (include everything, keys fail-closed) — they never block.
 *
 * v1 rule set (metadata-only, engine-agnostic):
 *   backup_copy   — column-signature near-duplicates + copy-name patterns
 *   temp_working  — temp/load/stage/work name patterns => volatile
 *   key_posture   — per-table: declared PK / promotable unique / keyless
 *   engine_hazard — legacy datatypes that need a mapping decision
 */

export type QuestionScope = 'in_scope' | 'excluded' | 'volatile' | 'data_only' | null;

export interface FoundationQuestionOption {
  answer: string;
  label: string;
  scope?: QuestionScope;
  recommended?: boolean;
  payload?: Record<string, unknown>;
}

export interface FoundationQuestionTarget {
  entity_name: string;
  note?: string;
  attribute_count: number;
}

export interface StaleDecisionRef {
  decision_key: string;
  previous_answer: string;
}

export interface FoundationQuestion {
  /** Stable key: `FQ-<rule>` or `FQ-<rule>-<table>` for per-table rules. */
  question_key: string;
  rule_key:
    | 'backup_copy'
    | 'temp_working'
    | 'key_posture'
    | 'engine_hazard'
    | 'crud_never'
    | 'crud_write_only'
    | 'crud_conflicting'
    | 'crud_read_only'
    | 'scope_code_conflict'
    | 'legacy_cache_strategy'
    | 'sequence_generator';
  title: string;
  detail: string;
  targets: FoundationQuestionTarget[];
  options: FoundationQuestionOption[];
  evidence_hash: string;
  /** Set when a stored decision existed but its evidence changed. */
  stale_decision: StaleDecisionRef | null;
}

export interface StoredFoundationDecision {
  decision_key: string;
  rule_key: string;
  answer: string;
  scope?: string | null;
  targets_json?: Array<{ entity_name?: string }> | null;
  evidence_hash?: string | null;
  stale?: boolean | null;
}

export interface CandidateLike {
  candidate_type?: string;
  candidateType?: string;
  name?: string | null;
  data?: Record<string, unknown> | null;
}

export interface EntityFacts {
  name: string;
  schema: string | null;
  kind: 'table' | 'view' | 'other';
  attributes: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
    isPrimaryKey: boolean;
  }>;
  constraints: {
    primary_key?: { columns?: string[] } | null;
    unique_constraints?: Array<{ name?: string; columns?: string[] }> | null;
    indexes?: Array<{ name?: string; columns?: string[]; is_unique?: boolean }> | null;
  } | null;
  /** DB-scan enrichment (Oracle Nine item 2): the table IS a legacy
   *  sequence-generator (increment proc + rows), with live values and
   *  proposed name -> table.column mappings. */
  /** Live uniqueness probes for parity-key proposals (item 4). */
  parityKeyProbes?: Array<{
    columns: string[];
    total: number | null;
    distinct: number | null;
    unique: boolean | null;
  }> | null;
  sequenceGeneratorIdiom?: {
    procName?: string;
    numberColumn?: string;
    nameColumn?: string | null;
    rows?: Array<{ name: string | null; value: number | null }>;
    proposedMappings?: Array<{
      sequenceName: string;
      currentValue: number | null;
      proposals: Array<{ table: string; column: string; exact: boolean }>;
    }>;
  } | null;
}

// ---------------------------------------------------------------------------
// Candidate -> facts
// ---------------------------------------------------------------------------

function candType(c: CandidateLike): string {
  return String(c.candidate_type ?? c.candidateType ?? '');
}

/** Build per-table facts from a DB-scan run's candidates (entity rows +
 *  their column candidates joined on `data.tableName`). */
export function entityFactsFromCandidates(candidates: CandidateLike[]): EntityFacts[] {
  const tables = new Map<string, EntityFacts>();
  for (const c of candidates) {
    if (candType(c) !== 'physical_data_entities') continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    const name = String(c.name ?? data.objectName ?? data.tableName ?? '');
    if (!name) continue;
    const objectType = String(data.objectType ?? 'table').toLowerCase();
    tables.set(name.toLowerCase(), {
      name,
      schema: (data.schemaName as string | undefined) ?? null,
      kind: objectType === 'view' ? 'view' : objectType === 'table' ? 'table' : 'other',
      attributes: [],
      constraints:
        (data.constraints_metadata as EntityFacts['constraints'] | undefined) ??
        (data.constraintsMetadata as EntityFacts['constraints'] | undefined) ??
        null,
      sequenceGeneratorIdiom:
        (data.sequence_generator_idiom as EntityFacts['sequenceGeneratorIdiom']) ?? null,
      parityKeyProbes:
        (data.parity_key_probes as EntityFacts['parityKeyProbes']) ?? null,
    });
  }
  for (const c of candidates) {
    if (candType(c) !== 'physical_data_attributes') continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    const tableName = String(data.tableName ?? '');
    const facts = tables.get(tableName.toLowerCase());
    if (!facts) continue;
    facts.attributes.push({
      name: String(c.name ?? data.columnName ?? ''),
      dataType: String(data.dataType ?? data.source_type ?? ''),
      isNullable: data.isNullable !== false && data.is_nullable !== false,
      isPrimaryKey: data.isPrimaryKey === true || data.is_primary_key === true,
    });
  }
  // CANONICAL ORDER: facts (and everything hashed from them) must not
  // depend on candidate fetch order — saving flips review_status on every
  // row and the refetch can come back reordered, which must NOT read as
  // "evidence changed". Code-unit compare, deliberately locale-free.
  const out = [...tables.values()];
  for (const t of out) {
    t.attributes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Evidence hashing (deterministic; no Date/random)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit over a stable string — cheap deterministic evidence hash. */
export function evidenceHash(payload: unknown): string {
  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The evidence-hash INPUT convention per bulk rule (Spec 2 follow-up,
 * 2026-08-22). Exposed so the panel can compute the hash a FUTURE
 * re-derived question over a target SUBSET will carry — the mechanism
 * behind "a deselected remainder is decided as kept": the remainder
 * decision stores exactly the hash the residual question would have, so
 * it settles instead of re-posing.
 */
export function bulkTargetsEvidenceHash(
  ruleKey: FoundationQuestion['rule_key'],
  targets: FoundationQuestionTarget[],
): string {
  // Inputs are sorted so the hash is a function of the evidence SET, never
  // of assembly order (fetch order changes on save; that is not evidence).
  if (ruleKey === 'temp_working' || ruleKey === 'crud_never') {
    return evidenceHash(targets.map((t) => t.entity_name).sort());
  }
  return evidenceHash(
    targets
      .map((t) => [t.entity_name, t.note] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

const COPY_SUFFIX_RE =
  /(?:[_-](?:bak|old|backup|copy|before\w*|tmp|temp)\d*|[_-]\d{4,}|[_-]\d{1,2}[A-Za-z]{3}\d{2,4}|[_-][A-Za-z]{3}\d{4,})$/i;

function columnSignature(facts: EntityFacts): string {
  return facts.attributes
    .map((a) => `${a.name.toLowerCase()}:${a.dataType.toLowerCase()}`)
    .sort()
    .join('|');
}

/** Copy suspects: name = <base><copy-suffix> where <base> is another table,
 *  strengthened by column-signature equality. */
export function backupCopyTargets(
  tables: EntityFacts[],
): Array<{ entity: EntityFacts; base: EntityFacts; identicalColumns: boolean }> {
  const byLower = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const out: Array<{ entity: EntityFacts; base: EntityFacts; identicalColumns: boolean }> = [];
  for (const t of tables) {
    if (t.kind !== 'table') continue;
    // Copy names can stack suffixes (`orders_bak_2018`) — strip trailing
    // copy tokens iteratively until a base table appears (bounded).
    let candidate = t.name;
    for (let i = 0; i < 3; i++) {
      const m = candidate.match(COPY_SUFFIX_RE);
      if (!m) break;
      candidate = candidate.slice(0, candidate.length - m[0].length);
      const base = byLower.get(candidate.toLowerCase());
      if (base && base !== t) {
        out.push({
          entity: t,
          base,
          identicalColumns:
            t.attributes.length > 0 && columnSignature(t) === columnSignature(base),
        });
        break;
      }
    }
  }
  return out;
}

const TEMP_NAME_RE = /^(?:temp|tmp|load|stage|staging|work|wrk|scratch)_|_(?:temp|tmp|load|stage|staging|work|wrk)$/i;

export function tempWorkingTargets(tables: EntityFacts[]): EntityFacts[] {
  return tables.filter((t) => t.kind === 'table' && TEMP_NAME_RE.test(t.name));
}

export interface KeyPosture {
  entity: EntityFacts;
  posture: 'declared_pk' | 'promotable_unique' | 'unique_with_nullable' | 'keyless';
  /** Columns of the promotable (or nullable-risk) unique index, if any. */
  uniqueColumns: string[] | null;
  uniqueName: string | null;
}

export function keyPostureOf(entity: EntityFacts): KeyPosture {
  const declared =
    (entity.constraints?.primary_key?.columns?.length ?? 0) > 0 ||
    entity.attributes.some((a) => a.isPrimaryKey);
  if (declared) {
    return { entity, posture: 'declared_pk', uniqueColumns: null, uniqueName: null };
  }
  const nullableByName = new Map(
    entity.attributes.map((a) => [a.name.toLowerCase(), a.isNullable]),
  );
  const uniques: Array<{ name?: string; columns?: string[] }> = [
    ...(entity.constraints?.unique_constraints ?? []),
    ...(entity.constraints?.indexes ?? []).filter((i) => i.is_unique === true),
  ];
  let nullableCandidate: { name?: string; columns?: string[] } | null = null;
  for (const u of uniques) {
    const columns = u.columns ?? [];
    if (columns.length === 0) continue;
    const anyNullable = columns.some((col) => nullableByName.get(col.toLowerCase()) !== false);
    if (!anyNullable) {
      return {
        entity,
        posture: 'promotable_unique',
        uniqueColumns: columns,
        uniqueName: u.name ?? null,
      };
    }
    nullableCandidate = nullableCandidate ?? u;
  }
  if (nullableCandidate) {
    return {
      entity,
      posture: 'unique_with_nullable',
      uniqueColumns: nullableCandidate.columns ?? [],
      uniqueName: nullableCandidate.name ?? null,
    };
  }
  return { entity, posture: 'keyless', uniqueColumns: null, uniqueName: null };
}

const HAZARD_TYPES = new Set([
  'money',
  'smallmoney',
  'image',
  'text',
  'unitext',
  'smalldatetime',
]);

export function engineHazardTargets(
  tables: EntityFacts[],
): Array<{ entity: EntityFacts; columns: Array<{ name: string; dataType: string }> }> {
  const out: Array<{ entity: EntityFacts; columns: Array<{ name: string; dataType: string }> }> = [];
  for (const t of tables) {
    const columns = t.attributes
      .filter((a) => HAZARD_TYPES.has(a.dataType.toLowerCase().replace(/\(.*$/, '').trim()))
      .map((a) => ({ name: a.name, dataType: a.dataType }));
    if (columns.length > 0) out.push({ entity: t, columns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Question derivation (rules + stored-decision reconciliation)
// ---------------------------------------------------------------------------

function target(entity: EntityFacts, note?: string): FoundationQuestionTarget {
  return { entity_name: entity.name, note, attribute_count: entity.attributes.length };
}

function decisionFor(
  decisions: StoredFoundationDecision[],
  ruleKey: string,
  targetNames: string[],
): StoredFoundationDecision | null {
  const wanted = new Set(targetNames.map((n) => n.toLowerCase()));
  for (const d of decisions) {
    if (d.rule_key !== ruleKey) continue;
    const covered = new Set(
      (d.targets_json ?? [])
        .map((t) => (t.entity_name ?? '').toLowerCase())
        .filter((n) => n.length > 0),
    );
    const allCovered = [...wanted].every((n) => covered.has(n));
    if (allCovered && covered.size > 0) return d;
  }
  return null;
}

/** Lowercase table names a STORED (non-stale) decision already scoped
 *  excluded/volatile — no further questions are asked about them (Spec 2
 *  follow-up, 2026-08-22: conflicting questions are forbidden; changing the
 *  decision later reopens the dependents via the evidence-hash mechanism). */
export function tablesScopedOutByDecisions(
  decisions: StoredFoundationDecision[],
): Set<string> {
  const out = new Set<string>();
  for (const d of decisions) {
    if (d.stale) continue;
    const scope = (d.scope ?? '').toLowerCase();
    if (scope !== 'excluded' && scope !== 'volatile') continue;
    for (const target of d.targets_json ?? []) {
      const name = (target.entity_name ?? '').toLowerCase();
      if (name) out.add(name);
    }
  }
  return out;
}

export function deriveFoundationQuestions(
  tables: EntityFacts[],
  decisions: StoredFoundationDecision[],
): FoundationQuestion[] {
  const questions: FoundationQuestion[] = [];
  const scopedOut = tablesScopedOutByDecisions(decisions);
  const isScopedOut = (name: string): boolean => scopedOut.has(name.toLowerCase());

  const reconcile = (
    question: Omit<FoundationQuestion, 'stale_decision'>,
  ): FoundationQuestion | null => {
    const existing = decisionFor(
      decisions,
      question.rule_key,
      question.targets.map((t) => t.entity_name),
    );
    if (!existing) return { ...question, stale_decision: null };
    if ((existing.evidence_hash ?? '') === question.evidence_hash && !existing.stale) {
      return null; // answered, evidence unchanged — settled.
    }
    return {
      ...question,
      stale_decision: {
        decision_key: existing.decision_key,
        previous_answer: existing.answer,
      },
    };
  };

  // ---- backup_copy (one bulk question)
  const copies = backupCopyTargets(tables).filter((c) => !isScopedOut(c.entity.name));
  if (copies.length > 0) {
    const targets = copies.map((c) =>
      target(
        c.entity,
        c.identicalColumns
          ? `column-identical to ${c.base.name}`
          : `copy-named after ${c.base.name} (columns differ)`,
      ),
    );
    const q = reconcile({
      question_key: 'FQ-backup_copy',
      rule_key: 'backup_copy',
      title: `${copies.length} table(s) look like BACKUP COPIES`,
      detail:
        'Copy-suffixed names whose base table exists (column-signature match noted per table). ' +
        'Excluding keeps them in current state as documentation; nothing reaches the target.',
      targets,
      options: [
        { answer: 'exclude_all', label: 'Exclude all from migration', scope: 'excluded', recommended: true },
        { answer: 'keep_all', label: 'Keep all in migration', scope: 'in_scope' },
      ],
      evidence_hash: bulkTargetsEvidenceHash('backup_copy', targets),
    });
    if (q) questions.push(q);
  }

  // ---- temp_working (one bulk question)
  const temps = tempWorkingTargets(tables).filter(
    (t) => !copies.some((c) => c.entity === t) && !isScopedOut(t.name),
  );
  if (temps.length > 0) {
    const targets = temps.map((t) => target(t));
    const q = reconcile({
      question_key: 'FQ-temp_working',
      rule_key: 'temp_working',
      title: `${temps.length} table(s) look like TEMP/WORKING tables`,
      detail:
        'temp_/load_/stage_/work_ naming. "Volatile" keeps them in current state, excludes them ' +
        'from the target, AND tolerates their churn in the S0 fingerprint (no more false ' +
        'end-of-run mismatches from application working tables).',
      targets,
      options: [
        { answer: 'mark_volatile', label: 'Mark volatile (S0-tolerated) + exclude from target', scope: 'volatile', recommended: true },
        { answer: 'keep_all', label: 'Keep all in migration', scope: 'in_scope' },
      ],
      evidence_hash: bulkTargetsEvidenceHash('temp_working', targets),
    });
    if (q) questions.push(q);
  }

  // ---- key_posture (one question PER table without a declared PK)
  for (const t of tables) {
    if (t.kind !== 'table') continue;
    // A table a decision already excluded (or marked volatile) asks no key
    // question — its keys are irrelevant while it is out of the migration.
    if (isScopedOut(t.name)) continue;
    const posture = keyPostureOf(t);
    if (posture.posture === 'declared_pk') continue;
    const targets = [target(t)];
    let title: string;
    let detail: string;
    const options: FoundationQuestionOption[] = [];
    if (posture.posture === 'promotable_unique') {
      title = `${t.name} has NO declared PK — unique ${posture.uniqueName ?? 'index'} (${(posture.uniqueColumns ?? []).join(', ')}) is promotable`;
      detail =
        'All key columns are non-nullable, so the unique index is semantically a primary key. ' +
        'Promotion materializes it into the model (additively) — capture compensation and ' +
        'reconciliation then key on it.';
      options.push(
        {
          answer: 'promote_pk',
          label: 'Promote the unique index to PK (recommended)',
          recommended: true,
          payload: { promote_pk_columns: posture.uniqueColumns ?? [] },
        },
        { answer: 'surrogate_target', label: 'Surrogate PK on target; capture uses multiset diff', payload: { key_policy: 'surrogate_target' } },
        { answer: 'exclude', label: 'Exclude the table from migration', scope: 'excluded' },
      );
    } else if (posture.posture === 'unique_with_nullable') {
      title = `${t.name} has NO declared PK — unique ${posture.uniqueName ?? 'index'} exists but includes NULLABLE column(s)`;
      detail =
        'A PK cannot include nullable columns. Verify the data (null probe) before promoting, ' +
        'or fall back to the keyless policies.';
      options.push(
        { answer: 'keyless_multiset', label: 'Keyless: multiset diff for capture + surrogate on target (recommended)', recommended: true, payload: { key_policy: 'keyless_multiset' } },
        { answer: 'promote_pk', label: `Promote (${(posture.uniqueColumns ?? []).join(', ')}) — I confirm the columns hold no NULLs`, payload: { promote_pk_columns: posture.uniqueColumns ?? [] } },
        { answer: 'exclude', label: 'Exclude the table from migration', scope: 'excluded' },
      );
    } else {
      title = `${t.name} has NO key of any kind (bare heap)`;
      detail =
        'No PK, no unique index. Capture can only compensate via whole-row multiset diff; the ' +
        'target gets a surrogate identity PK.';
      options.push(
        { answer: 'keyless_multiset', label: 'Keyless: multiset diff for capture + surrogate on target (recommended)', recommended: true, payload: { key_policy: 'keyless_multiset' } },
        { answer: 'exclude', label: 'Exclude the table from migration', scope: 'excluded' },
      );
    }
    // Parity-key enrichment (item 4): a live-VERIFIED unique tuple rides
    // EVERY option's payload, so whichever key answer the human records,
    // the reconcile join gets a proven key; with no verified tuple on a
    // keyless table, parity degrades honestly to count+checksum.
    const verifiedProbe = (t.parityKeyProbes ?? []).find((pr) => pr.unique === true) ?? null;
    if (verifiedProbe) {
      detail +=
        ` LIVE-VERIFIED parity key available: (${verifiedProbe.columns.join(', ')}) is unique ` +
        `across ${verifiedProbe.total ?? '?'} rows — recorded with your answer for the ` +
        `reconcile join.`;
      for (const option of options) {
        option.payload = {
          ...(option.payload ?? {}),
          parity_key: verifiedProbe.columns,
          parity_key_verified: true,
        };
      }
    } else if ((t.parityKeyProbes ?? []).length > 0) {
      detail +=
        ` No probed tuple is unique on the live data (${(t.parityKeyProbes ?? [])
          .map((pr) => `(${pr.columns.join(', ')}): ${pr.distinct}/${pr.total}`)
          .join('; ')}) — parity uses count+checksum for this table.`;
      for (const option of options) {
        option.payload = { ...(option.payload ?? {}), parity_mode: 'count_checksum' };
      }
    }
    const q = reconcile({
      question_key: `FQ-key_posture-${t.name.toLowerCase()}`,
      rule_key: 'key_posture',
      title,
      detail,
      targets,
      options,
      evidence_hash: evidenceHash({
        table: t.name.toLowerCase(),
        posture: posture.posture,
        columns: posture.uniqueColumns,
        parityProbes: (t.parityKeyProbes ?? [])
          .map((pr) => [pr.columns.map((c) => c.toLowerCase()).join(','), pr.unique] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        attrs: t.attributes
          .map((a) => [a.name.toLowerCase(), a.isNullable, a.isPrimaryKey] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      }),
    });
    if (q) questions.push(q);
  }

  // ---- sequence_generator (Oracle Nine item 2): a legacy sequence TABLE +
  // increment proc replaces identity columns; the target needs an explicit
  // generator, so the strategy + name->column mappings become a decision.
  for (const t of tables) {
    const idiom = t.sequenceGeneratorIdiom;
    if (!idiom || isScopedOut(t.name)) continue;
    const mappings = (idiom.proposedMappings ?? []).map((m) => ({
      sequence_name: m.sequenceName,
      current_value: m.currentValue,
      table: m.proposals[0]?.table ?? null,
      column: m.proposals[0]?.column ?? null,
      exact: m.proposals[0]?.exact ?? false,
      ambiguous: m.proposals.length > 1,
    }));
    const mappingNote = mappings
      .map(
        (m) =>
          `${m.sequence_name}(${m.current_value ?? '?'})` +
          (m.table ? ` -> ${m.table}.${m.column}${m.exact ? '' : ' (suffix match)'}` : ' -> NO COLUMN MATCH'),
      )
      .sort()
      .join('; ');
    const targets = [
      {
        entity_name: t.name,
        note: mappingNote || 'no named rows sampled',
        attribute_count: t.attributes.length,
      },
    ];
    const q = reconcile({
      question_key: `FQ-sequence_generator-${t.name.toLowerCase()}`,
      rule_key: 'sequence_generator',
      title: `${t.name} is a legacy SEQUENCE GENERATOR (proc ${idiom.procName ?? '?'}) — choose the target identity strategy`,
      detail:
        'Create paths get their ids from this table via an increment proc; there are no ' +
        'identity columns to translate, so without a decision the target has NO id ' +
        'generator. Native sequences are seeded from the LOADED data (setval max+1) — ' +
        'deterministic at cutover. A read-only grant exists on the legacy table, so a ' +
        'compatibility view is offered for external readers ("permitted but unobserved").',
      targets,
      options: [
        {
          answer: 'native_sequences',
          label: 'Native PostgreSQL sequences per name; seed from loaded data (recommended)',
          recommended: true,
          payload: {
            sequence_strategy: 'native',
            name_column: idiom.nameColumn ?? null,
            number_column: idiom.numberColumn ?? null,
            mappings,
          },
        },
        {
          answer: 'native_with_view',
          label: 'Native sequences + read-compatibility VIEW shaped like the legacy table',
          payload: {
            sequence_strategy: 'native_with_view',
            name_column: idiom.nameColumn ?? null,
            number_column: idiom.numberColumn ?? null,
            mappings,
          },
        },
        {
          answer: 'table_emulation',
          label: 'Keep the sequence TABLE + increment semantics on the target',
          payload: {
            sequence_strategy: 'table_emulation',
            name_column: idiom.nameColumn ?? null,
            number_column: idiom.numberColumn ?? null,
            mappings,
          },
        },
      ],
      evidence_hash: bulkTargetsEvidenceHash('sequence_generator', targets),
    });
    if (q) questions.push(q);
  }

  // ---- engine_hazard (one bulk informational question)
  const hazards = engineHazardTargets(tables).filter((h) => !isScopedOut(h.entity.name));
  if (hazards.length > 0) {
    const targets = hazards.map((h) =>
      target(h.entity, h.columns.map((c) => `${c.name} ${c.dataType}`).join(', ')),
    );
    const q = reconcile({
      question_key: 'FQ-engine_hazard',
      rule_key: 'engine_hazard',
      title: `${hazards.length} table(s) carry legacy datatypes needing a mapping decision`,
      detail:
        'money/text/image/smalldatetime-class types. Acknowledging records the decision; the ' +
        'pack translation applies the default mappings.',
      targets,
      options: [
        { answer: 'acknowledge_default_mappings', label: 'Acknowledge — use default target mappings', recommended: true },
      ],
      evidence_hash: bulkTargetsEvidenceHash('engine_hazard', targets),
    });
    if (q) questions.push(q);
  }

  return questions;
}


// ---------------------------------------------------------------------------
// JOINT rules (Spec 5, 2026-08-22): the CRUD matrix — code + DB evidence.
// Derived from the COMMITTED MODEL (post both scans): entities with scope
// fields + endpoint_data_effects edges (write / read / execute).
// ---------------------------------------------------------------------------

export interface RawModelLike {
  metaModel?: {
    entities?: {
      physical_data_entities?: Array<{
        id?: string;
        name?: string;
        physical_type?: string | null;
        migration_scope?: string | null;
        scope_decision_ref?: string | null;
      }>;
      endpoints?: Array<{ id?: string; name?: string }>;
    };
    relationships?: {
      endpoint_data_effects?: Array<{
        access_mode?: string | null;
        data_entity_point_id?: string | null;
        endpoint_id?: string | null;
        path_metadata_json?: { via_legacy_cache?: boolean } | null;
      }>;
    };
  };
}

/**
 * TRUE once the committed model actually holds code-plane evidence
 * (endpoints and/or effect edges). Until the code run's candidates are
 * SAVED, the model has neither — and ABSENT evidence must not read as
 * NEGATIVE evidence ("no code path touches these 45 tables" moments after
 * the scan started). The joint rules refuse to fire before this is true.
 */
export function modelHasCodeEvidence(model: RawModelLike): boolean {
  return (
    (model.metaModel?.entities?.endpoints ?? []).length > 0 ||
    (model.metaModel?.relationships?.endpoint_data_effects ?? []).length > 0
  );
}

/**
 * TRUE once the model carries at least one READ edge. A model whose effect
 * derivation produced zero reads estate-wide (the pre-2026-08-22 verb-gated
 * scan) makes every "never read" claim unfoundable — the read-axis joint
 * questions (never-touched / write-only) refuse to fire without this.
 */
export function modelHasReadEvidence(model: RawModelLike): boolean {
  return (model.metaModel?.relationships?.endpoint_data_effects ?? []).some((edge) => {
    const mode = (edge.access_mode ?? '').toLowerCase();
    return mode === 'read' || mode === 'read-write';
  });
}

interface CrudFacts {
  name: string;
  scope: string;
  decisionRef: string | null;
  reads: number;
  writes: number;
  executes: number;
}

export function crudFactsFromModel(model: RawModelLike): CrudFacts[] {
  const entities = model.metaModel?.entities?.physical_data_entities ?? [];
  const byId = new Map<string, CrudFacts>();
  for (const e of entities) {
    if (!e.id || !e.name) continue;
    const isView = /view/i.test(e.physical_type ?? '');
    if (isView) continue; // views are derived — CRUD questions target tables
    const raw = (e.migration_scope ?? '').toLowerCase();
    byId.set(e.id, {
      name: e.name,
      scope:
        raw === 'excluded' || raw === 'volatile' || raw === 'data_only' ? raw : 'in_scope',
      decisionRef: e.scope_decision_ref ?? null,
      reads: 0,
      writes: 0,
      executes: 0,
    });
  }
  for (const edge of model.metaModel?.relationships?.endpoint_data_effects ?? []) {
    const id = (edge.data_entity_point_id ?? '').replace(/^dep_(phy|log)_/, '');
    const facts = byId.get(id);
    if (!facts) continue;
    const mode = (edge.access_mode ?? '').toLowerCase();
    // Kiro bug 3 (2026-08-24): a read-write edge is read evidence AND
    // write evidence — counting it as write-only disagreed with
    // modelHasReadEvidence and fed the audit-sink misclassification.
    if (mode === 'write' || mode === 'read-write') facts.writes += 1;
    if (mode === 'read' || mode === 'read-write') facts.reads += 1;
    else if (mode === 'execute') facts.executes += 1;
  }
  // Same canonical-order rule as entityFactsFromCandidates: model entity
  // array order shifts on save-back PUTs and is not evidence.
  return [...byId.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Joint (code+DB) questions. The same stored-decision reconciliation as
 *  the DB-side rules: settled questions disappear, changed evidence
 *  reopens them stale-chipped. */
export function deriveJointFoundationQuestions(
  model: RawModelLike,
  decisions: StoredFoundationDecision[],
  opts?: {
    /** table(lower) -> caller-less proc names touching it (code-scan
     *  emission summary). Never changes WHICH tables are dark — only lets
     *  the never-touched card say WHY (evidence hash is name-based, so
     *  richer notes never stale a stored decision). */
    orphanProcTouchers?: Record<string, string[]>;
    /** Corpus-wide UNROOTED read facts (Kiro backstop, 2026-08-24): a
     *  table read ANYWHERE in parsed SQL is refused by the write-only
     *  (audit-sink) bucket — mislabelling an authorization list as an
     *  audit sink would make the migration skip parity on it. */
    readAnywhereTables?: string[];
  },
): FoundationQuestion[] {
  // No committed code evidence -> no joint questions. Every rule below
  // reasons over effect edges; without the code save they are all vacuous
  // (crud_never would list the ENTIRE estate as "never touched").
  if (!modelHasCodeEvidence(model)) return [];
  // Zero read edges estate-wide -> the READ-AXIS rules are unfoundable
  // (2026-08-22 shakedown: a verb-gated scan derived only writes and the
  // matrix claimed "no table is ever read"). Write-independent rules
  // (scope_code_conflict) still run.
  const hasReadEvidence = modelHasReadEvidence(model);
  const facts = crudFactsFromModel(model);
  const questions: FoundationQuestion[] = [];

  const reconcile = (
    question: Omit<FoundationQuestion, 'stale_decision'>,
  ): FoundationQuestion | null => {
    const wanted = new Set(question.targets.map((t) => t.entity_name.toLowerCase()));
    for (const d of decisions) {
      if (d.rule_key !== question.rule_key) continue;
      const covered = new Set(
        (d.targets_json ?? [])
          .map((x) => (x.entity_name ?? '').toLowerCase())
          .filter((n) => n.length > 0),
      );
      if (covered.size > 0 && [...wanted].every((n) => covered.has(n))) {
        if ((d.evidence_hash ?? '') === question.evidence_hash && !d.stale) return null;
        return {
          ...question,
          stale_decision: { decision_key: d.decision_key, previous_answer: d.answer },
        };
      }
    }
    return { ...question, stale_decision: null };
  };

  const jointTarget = (f: CrudFacts, note: string): FoundationQuestionTarget => ({
    entity_name: f.name,
    note,
    attribute_count: 0,
  });

  // --- never CRUDed (in-scope tables no code path touches)
  const never = facts.filter(
    (f) => f.scope === 'in_scope' && f.reads + f.writes + f.executes === 0,
  );
  if (never.length > 0 && hasReadEvidence) {
    const orphanTouchers = opts?.orphanProcTouchers ?? {};
    const targets = never.map((f) => {
      const procs = orphanTouchers[f.name.toLowerCase()] ?? [];
      return jointTarget(
        f,
        procs.length > 0
          ? `only touched by caller-less deployed proc(s): ${procs.join(', ')} — no rooted code path reaches them`
          : 'no discovered endpoint reads or writes this table',
      );
    });
    const q = reconcile({
      question_key: 'FQ-crud_never',
      rule_key: 'crud_never',
      title: `${never.length} in-scope table(s) are never touched by ANY code path`,
      detail:
        'No effect edges of any kind. They may be reference data fed by another system, ' +
        'dead weight, or touched only by paths discovery cannot see (jobs outside the ' +
        'scanned code). Keeping them is the safe default.',
      targets,
      options: [
        { answer: 'keep_all', label: 'Keep in migration (safe default)', scope: 'in_scope', recommended: true },
        { answer: 'data_only_all', label: 'Migrate data-only (reference data — no behaviour expectations)', scope: 'data_only' },
        { answer: 'exclude_all', label: 'Exclude from migration', scope: 'excluded' },
      ],
      evidence_hash: bulkTargetsEvidenceHash('crud_never', targets),
    });
    if (q) questions.push(q);
  }

  // --- write-only (audit sinks)
  const readAnywhere = new Set((opts?.readAnywhereTables ?? []).map((x) => x.toLowerCase()));
  const writeOnlyAll = facts.filter(
    (f) => f.scope === 'in_scope' && f.writes > 0 && f.reads === 0 && f.executes === 0,
  );
  const writeOnly = writeOnlyAll.filter((f) => !readAnywhere.has(f.name.toLowerCase()));
  const writeOnlyRefusedTables = writeOnlyAll.filter((f) => readAnywhere.has(f.name.toLowerCase()));
  const writeOnlyRefused = writeOnlyRefusedTables.length;
  if (writeOnly.length > 0 && hasReadEvidence) {
    const targets = writeOnly.map((f) => jointTarget(f, `${f.writes} write edge(s), never read`));
    const q = reconcile({
      question_key: 'FQ-crud_write_only',
      rule_key: 'crud_write_only',
      title: `${writeOnly.length} table(s) are WRITE-ONLY (audit-sink shape)`,
      detail:
        'Code writes them but nothing reads them back — classic audit/journal tables. ' +
        'Acknowledging records the shape; excluding removes them from the target.' +
        (writeOnlyRefused > 0
          ? ` ${writeOnlyRefused} written table(s) were REFUSED from this bucket because parsed SQL reads them somewhere the chain rooting cannot see.`
          : ''),
      targets,
      options: [
        {
          answer: 'keep_all',
          label:
            'Keep in migration, acknowledged as audit sinks (S0-tolerated; never compensated; parity skips with a receipt)',
          scope: 'in_scope',
          recommended: true,
          payload: { audit_sink: true },
        },
        { answer: 'exclude_all', label: 'Exclude from migration', scope: 'excluded' },
      ],
      evidence_hash: bulkTargetsEvidenceHash('crud_write_only', targets),
    });
    if (q) questions.push(q);
  }

  // --- conflicting evidence (rooted writes + unrooted reads) — Kiro
  // 2026-08-24: tables REFUSED from the write-only bucket vanished from
  // every card (writes>0 skips crud_never AND crud_read_only), so no
  // decision was ever recorded and they inherited scope silently. The
  // safest tables in the estate must never be the ones that disappear
  // from review.
  if (writeOnlyRefusedTables.length > 0 && hasReadEvidence) {
    const targets = writeOnlyRefusedTables.map((f) =>
      jointTarget(
        f,
        `${f.writes} rooted write edge(s); read only by SQL the chain rooting cannot see (proc body / boundary text)`,
      ),
    );
    const q = reconcile({
      question_key: 'FQ-crud_conflicting',
      rule_key: 'crud_conflicting',
      title: `${writeOnlyRefusedTables.length} table(s) have CONFLICTING evidence (rooted writes, unrooted reads)`,
      detail:
        'Rooted chains write these tables and parsed SQL reads them somewhere the rooting cannot ' +
        'reach. They are NOT audit sinks — treating them as read-write is the safe posture.',
      targets,
      options: [
        { answer: 'keep_all', label: 'Treat as read-write; keep in migration (recommended)', scope: 'in_scope', recommended: true },
        { answer: 'audit_sink_all', label: 'The unrooted reads are spurious — acknowledge as audit sinks', scope: 'in_scope', payload: { audit_sink: true } },
        { answer: 'exclude_all', label: 'Exclude from migration', scope: 'excluded' },
      ],
      evidence_hash: bulkTargetsEvidenceHash('crud_conflicting', targets),
    });
    if (q) questions.push(q);
  }

  // --- read-only (reference data)
  const readOnly = facts.filter(
    (f) => f.scope === 'in_scope' && f.reads > 0 && f.writes === 0 && f.executes === 0,
  );
  if (readOnly.length > 0) {
    const targets = readOnly.map((f) => jointTarget(f, `${f.reads} read edge(s), never written`));
    const q = reconcile({
      question_key: 'FQ-crud_read_only',
      rule_key: 'crud_read_only',
      title: `${readOnly.length} table(s) are READ-ONLY to the code (reference-data shape)`,
      detail:
        'Read but never written by any discovered path — likely reference data seeded or ' +
        'maintained elsewhere. data_only migrates schema + data without behaviour ' +
        'expectations.',
      targets,
      options: [
        { answer: 'keep_all', label: 'Keep in migration', scope: 'in_scope', recommended: true },
        { answer: 'data_only_all', label: 'Migrate data-only (reference data)', scope: 'data_only' },
      ],
      evidence_hash: bulkTargetsEvidenceHash('crud_read_only', targets),
    });
    if (q) questions.push(q);
  }

  // --- legacy cache strategy (2026-08-23): reads derived through the
  // Guava cache-transparency bridge carry via_legacy_cache. The data
  // effects are the requirement; the cache is an implementation choice —
  // record it HERE so specs cite a decision instead of imitating the
  // legacy mechanics.
  const endpointNameById = new Map<string, string>();
  for (const ep of model.metaModel?.entities?.endpoints ?? []) {
    if (ep.id) endpointNameById.set(ep.id, ep.name ?? `endpoint ${ep.id}`);
  }
  const cacheFronted = new Map<string, string>();
  for (const edge of model.metaModel?.relationships?.endpoint_data_effects ?? []) {
    if (!edge.path_metadata_json?.via_legacy_cache) continue;
    const name = endpointNameById.get(edge.endpoint_id ?? '') ?? edge.endpoint_id ?? '';
    if (name) cacheFronted.set(name, 'read path fronted by a legacy in-process cache');
  }
  if (cacheFronted.size > 0) {
    const targets = [...cacheFronted.entries()].map(([name, note]) => ({
      entity_name: name,
      note,
      attribute_count: 0,
    }));
    const q = reconcile({
      question_key: 'FQ-legacy_cache_strategy',
      rule_key: 'legacy_cache_strategy',
      title: `${targets.length} read path(s) are cache-fronted in the legacy service`,
      detail:
        'The legacy service fronts these reads with in-process caches (whole-business-date ' +
        'granularity, node-local write-through). The DATA EFFECTS are the behavioural ' +
        'requirement carried into specs; the cache itself is an implementation choice. ' +
        'Recording the target strategy here lets specs cite a decision instead of ' +
        'imitating the legacy mechanics.',
      targets,
      options: [
        {
          answer: 'no_target_cache',
          label:
            'No in-process cache in the target — rely on the database; add caching only on measured need (recommended)',
          recommended: true,
          payload: { cache_strategy: 'none' },
        },
        {
          answer: 'local_cache',
          label: 'Replicate node-local in-process caching',
          payload: { cache_strategy: 'local' },
        },
        {
          answer: 'distributed_cache',
          label: 'Plan a shared/distributed cache',
          payload: { cache_strategy: 'distributed' },
        },
      ],
      evidence_hash: bulkTargetsEvidenceHash('legacy_cache_strategy', targets),
    });
    if (q) questions.push(q);
  }

  // --- CONFLICT: excluded/volatile but code touches it (one per table)
  for (const f of facts) {
    if (f.scope !== 'excluded' && f.scope !== 'volatile') continue;
    const touches = f.reads + f.writes + f.executes;
    if (touches === 0) continue;
    const targets = [
      jointTarget(
        f,
        `${f.writes} write / ${f.reads} read edge(s) despite ${f.scope}` +
          (f.decisionRef ? ` (${f.decisionRef})` : ''),
      ),
    ];
    const q = reconcile({
      question_key: `FQ-scope_code_conflict-${f.name.toLowerCase()}`,
      rule_key: 'scope_code_conflict',
      title: `CONFLICT: ${f.name} is ${f.scope}${f.decisionRef ? ` (${f.decisionRef})` : ''} but code touches it`,
      detail:
        'The scope ruling says this table is out of the migration, yet discovered code ' +
        'reads/writes it. Either the code path is dead (keep the exclusion) or the ' +
        'ruling needs revisiting.',
      targets,
      options: [
        { answer: 'keep_excluded', label: 'Keep the exclusion — the code path is dead', scope: f.scope as QuestionScope, recommended: true },
        { answer: 're_include', label: 'Re-include the table in the migration', scope: 'in_scope' },
      ],
      evidence_hash: evidenceHash({
        table: f.name.toLowerCase(),
        scope: f.scope,
        reads: f.reads,
        writes: f.writes,
      }),
    });
    if (q) questions.push(q);
  }

  return questions;
}
