/** Foundations rules (Spec 2, 2026-08-22) — deterministic derivation +
 *  stored-decision reconciliation (settled / stale / open). */

import { describe, it, expect } from 'vitest';
import {
  backupCopyTargets,
  deriveFoundationQuestions,
  entityFactsFromCandidates,
  evidenceHash,
  keyPostureOf,
  type CandidateLike,
  type StoredFoundationDecision,
} from './foundationRules';

function entityCand(name: string, constraints?: Record<string, unknown>): CandidateLike {
  return {
    candidate_type: 'physical_data_entities',
    name,
    data: { objectType: 'table', schemaName: 'dbo', constraints_metadata: constraints ?? null },
  };
}

function attrCand(
  tableName: string,
  name: string,
  dataType: string,
  isNullable = true,
  isPrimaryKey = false,
): CandidateLike {
  return {
    candidate_type: 'physical_data_attributes',
    name,
    data: { tableName, columnName: name, dataType, isNullable, isPrimaryKey },
  };
}

const CANDIDATES: CandidateLike[] = [
  entityCand('orders'),
  attrCand('orders', 'id', 'int', false, true),
  attrCand('orders', 'total', 'money'),

  entityCand('orders_bak_2018'),
  attrCand('orders_bak_2018', 'id', 'int', false),
  attrCand('orders_bak_2018', 'total', 'money'),

  entityCand('load_orders'),
  attrCand('load_orders', 'id', 'int'),

  entityCand('rules_versioned', {
    indexes: [{ name: 'rv_ix', columns: ['RuleId', 'ValidFrom'], is_unique: true }],
  }),
  attrCand('rules_versioned', 'RuleId', 'int', false),
  attrCand('rules_versioned', 'ValidFrom', 'datetime', false),

  entityCand('event_sink'),
  attrCand('event_sink', 'what', 'varchar'),
];

describe('entityFactsFromCandidates', () => {
  it('joins attributes to tables and carries constraints', () => {
    const facts = entityFactsFromCandidates(CANDIDATES);
    expect(facts).toHaveLength(5);
    const orders = facts.find((f) => f.name === 'orders')!;
    expect(orders.attributes).toHaveLength(2);
    expect(orders.attributes[0]).toMatchObject({ name: 'id', isPrimaryKey: true });
  });
});

describe('rules', () => {
  const facts = entityFactsFromCandidates(CANDIDATES);

  it('backup_copy: copy-suffixed name with existing base, column signature noted', () => {
    const copies = backupCopyTargets(facts);
    expect(copies).toHaveLength(1);
    expect(copies[0].entity.name).toBe('orders_bak_2018');
    expect(copies[0].base.name).toBe('orders');
    expect(copies[0].identicalColumns).toBe(true);
  });

  it('key posture: declared PK skips; non-null unique promotes; bare heap is keyless', () => {
    expect(keyPostureOf(facts.find((f) => f.name === 'orders')!).posture).toBe('declared_pk');
    const promotable = keyPostureOf(facts.find((f) => f.name === 'rules_versioned')!);
    expect(promotable.posture).toBe('promotable_unique');
    expect(promotable.uniqueColumns).toEqual(['RuleId', 'ValidFrom']);
    expect(keyPostureOf(facts.find((f) => f.name === 'event_sink')!).posture).toBe('keyless');
  });

  it('derives the four question families with recommended defaults', () => {
    const questions = deriveFoundationQuestions(facts, []);
    const keys = questions.map((q) => q.question_key);
    expect(keys).toContain('FQ-backup_copy');
    expect(keys).toContain('FQ-temp_working');
    expect(keys).toContain('FQ-key_posture-rules_versioned');
    expect(keys).toContain('FQ-key_posture-event_sink');
    expect(keys).toContain('FQ-engine_hazard');
    const promote = questions.find((q) => q.question_key === 'FQ-key_posture-rules_versioned')!;
    expect(promote.options[0]).toMatchObject({
      answer: 'promote_pk',
      recommended: true,
      payload: { promote_pk_columns: ['RuleId', 'ValidFrom'] },
    });
    // backup copies never double-report as temp tables.
    const temp = questions.find((q) => q.question_key === 'FQ-temp_working')!;
    expect(temp.targets.map((t) => t.entity_name)).toEqual(['load_orders']);
  });

  it('an answered question with UNCHANGED evidence is settled (not re-asked)', () => {
    const open = deriveFoundationQuestions(facts, []);
    const backup = open.find((q) => q.question_key === 'FQ-backup_copy')!;
    const decisions: StoredFoundationDecision[] = [
      {
        decision_key: 'F-1',
        rule_key: 'backup_copy',
        answer: 'exclude_all',
        targets_json: [{ entity_name: 'orders_bak_2018' }],
        evidence_hash: backup.evidence_hash,
        stale: false,
      },
    ];
    const after = deriveFoundationQuestions(facts, decisions);
    expect(after.some((q) => q.question_key === 'FQ-backup_copy')).toBe(false);
  });

  it('changed evidence REOPENS the question stale-chipped with the previous answer', () => {
    const decisions: StoredFoundationDecision[] = [
      {
        decision_key: 'F-1',
        rule_key: 'backup_copy',
        answer: 'exclude_all',
        targets_json: [{ entity_name: 'orders_bak_2018' }],
        evidence_hash: 'stale-hash',
        stale: false,
      },
    ];
    const after = deriveFoundationQuestions(facts, decisions);
    const reopened = after.find((q) => q.question_key === 'FQ-backup_copy')!;
    expect(reopened.stale_decision).toEqual({
      decision_key: 'F-1',
      previous_answer: 'exclude_all',
    });
  });

  it('evidenceHash is deterministic', () => {
    expect(evidenceHash({ a: 1 })).toBe(evidenceHash({ a: 1 }));
    expect(evidenceHash({ a: 1 })).not.toBe(evidenceHash({ a: 2 }));
  });
});

// ---------------------------------------------------------------------------
// Spec 5: JOINT CRUD-matrix rules (code + DB evidence over the model)
// ---------------------------------------------------------------------------

import { crudFactsFromModel, deriveJointFoundationQuestions } from './foundationRules';

const JOINT_MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        { id: 'e1', name: 'orders' },
        { id: 'e2', name: 'ref_rates' },
        { id: 'e3', name: 'audit_log' },
        { id: 'e4', name: 'ghost_table' },
        { id: 'e5', name: 'orders_bak', migration_scope: 'excluded', scope_decision_ref: 'F-1' },
        { id: 'e6', name: 'a_view', physical_type: 'View' },
      ],
    },
    relationships: {
      endpoint_data_effects: [
        { access_mode: 'write', data_entity_point_id: 'dep_phy_e1' },
        { access_mode: 'read', data_entity_point_id: 'dep_phy_e1' },
        { access_mode: 'read', data_entity_point_id: 'dep_phy_e2' },
        { access_mode: 'write', data_entity_point_id: 'dep_phy_e3' },
        { access_mode: 'write', data_entity_point_id: 'dep_phy_e5' },
      ],
    },
  },
};

describe('joint CRUD-matrix rules (Spec 5)', () => {
  it('classifies the CRUD shapes (views skipped)', () => {
    const facts = crudFactsFromModel(JOINT_MODEL);
    expect(facts.map((f) => f.name)).not.toContain('a_view');
    const byName = new Map(facts.map((f) => [f.name, f]));
    expect(byName.get('orders')).toMatchObject({ reads: 1, writes: 1 });
    expect(byName.get('ghost_table')).toMatchObject({ reads: 0, writes: 0 });
  });

  it('derives never-CRUDed, write-only, read-only and the scope conflict', () => {
    const questions = deriveJointFoundationQuestions(JOINT_MODEL, []);
    const keys = questions.map((q) => q.question_key);
    expect(keys).toContain('FQ-crud_never');
    expect(keys).toContain('FQ-crud_write_only');
    expect(keys).toContain('FQ-crud_read_only');
    expect(keys).toContain('FQ-scope_code_conflict-orders_bak');

    const never = questions.find((q) => q.question_key === 'FQ-crud_never')!;
    expect(never.targets.map((t) => t.entity_name)).toEqual(['ghost_table']);
    expect(never.options[0]).toMatchObject({ answer: 'keep_all', recommended: true });

    const conflict = questions.find(
      (q) => q.question_key === 'FQ-scope_code_conflict-orders_bak',
    )!;
    expect(conflict.title).toContain('F-1');
    expect(conflict.options[0]).toMatchObject({ answer: 'keep_excluded', recommended: true });
  });

  it('annotates never-touched targets with caller-less proc touchers, hash unchanged (2026-08-23)', () => {
    const plain = deriveJointFoundationQuestions(JOINT_MODEL, []);
    const annotated = deriveJointFoundationQuestions(JOINT_MODEL, [], {
      orphanProcTouchers: {
        ghost_table: ['importvirtualnodes', 'removetreebranch'],
        unrelated_table: ['someproc'],
      },
    });
    const never = annotated.find((q) => q.question_key === 'FQ-crud_never')!;
    expect(never.targets).toHaveLength(1);
    expect(never.targets[0].note).toBe(
      'only touched by caller-less deployed proc(s): importvirtualnodes, removetreebranch — no rooted code path reaches them',
    );
    // The annotation is presentation-only: the evidence hash stays the
    // name-based hash, so a stored decision never goes stale from it.
    const plainNever = plain.find((q) => q.question_key === 'FQ-crud_never')!;
    expect(never.evidence_hash).toBe(plainNever.evidence_hash);
    // Tables WITHOUT orphan touchers keep the generic note.
    expect(plainNever.targets[0].note).toBe('no discovered endpoint reads or writes this table');
  });

  it('Kiro bug 3: a read-write edge counts as BOTH read and write evidence', () => {
    const model = {
      metaModel: {
        entities: { physical_data_entities: [{ id: 'e1', name: 'auth_list' }] },
        relationships: {
          endpoint_data_effects: [
            { access_mode: 'read-write', data_entity_point_id: 'dep_phy_e1' },
          ],
        },
      },
    };
    const facts = crudFactsFromModel(model);
    expect(facts[0]).toMatchObject({ name: 'auth_list', reads: 1, writes: 1 });
    // read-write alone must NOT produce a write-only (audit-sink) card.
    const questions = deriveJointFoundationQuestions(model, []);
    expect(questions.some((q) => q.rule_key === 'crud_write_only')).toBe(false);
  });

  it('Kiro backstop: unrooted read evidence REFUSES the write-only bucket', () => {
    const withRefusal = deriveJointFoundationQuestions(JOINT_MODEL, [], {
      readAnywhereTables: ['audit_log'],
    });
    // audit_log is write-only by rooted edges, but parsed SQL reads it
    // somewhere -> refused from the audit-sink bucket, refusal named.
    const writeOnly = withRefusal.find((q) => q.rule_key === 'crud_write_only');
    expect(writeOnly).toBeUndefined();
    const without = deriveJointFoundationQuestions(JOINT_MODEL, []);
    const writeOnlyBefore = without.find((q) => q.rule_key === 'crud_write_only')!;
    expect(writeOnlyBefore.targets.map((tg) => tg.entity_name)).toEqual(['audit_log']);
  });

  it('a settled joint decision with unchanged evidence stays silent', () => {
    const open = deriveJointFoundationQuestions(JOINT_MODEL, []);
    const never = open.find((q) => q.question_key === 'FQ-crud_never')!;
    const after = deriveJointFoundationQuestions(JOINT_MODEL, [
      {
        decision_key: 'F-9',
        rule_key: 'crud_never',
        answer: 'keep_all',
        targets_json: [{ entity_name: 'ghost_table' }],
        evidence_hash: never.evidence_hash,
        stale: false,
      },
    ]);
    expect(after.some((q) => q.question_key === 'FQ-crud_never')).toBe(false);
  });
});

describe('derive-time suppression by stored decisions (no conflicting questions)', () => {
  it('a stored excluded/volatile decision silences key/hazard/backup questions for its tables', () => {
    const facts = entityFactsFromCandidates(CANDIDATES);
    const decisions: StoredFoundationDecision[] = [
      {
        decision_key: 'F-3',
        rule_key: 'temp_working',
        answer: 'mark_volatile',
        scope: 'volatile',
        targets_json: [{ entity_name: 'load_orders' }],
        evidence_hash: 'whatever',
        stale: false,
      },
      {
        decision_key: 'F-1',
        rule_key: 'backup_copy',
        answer: 'exclude_all',
        scope: 'excluded',
        targets_json: [{ entity_name: 'orders_bak_2018' }],
        evidence_hash: 'whatever',
        stale: false,
      },
    ];
    const questions = deriveFoundationQuestions(facts, decisions);
    const keys = questions.map((q) => q.question_key);
    // No key-posture question for scoped-out tables; no re-listing in
    // backup/temp; engine hazards drop them too.
    expect(keys.some((k) => k.includes('load_orders'))).toBe(false);
    expect(keys.some((k) => k.includes('orders_bak_2018'))).toBe(false);
    expect(keys).not.toContain('FQ-temp_working'); // its only target is decided
    expect(keys).not.toContain('FQ-backup_copy');
    const hazard = questions.find((q) => q.question_key === 'FQ-engine_hazard');
    if (hazard) {
      expect(hazard.targets.some((t) => t.entity_name === 'orders_bak_2018')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Order canonicalization (2026-08-22 live-shakedown regression): saving
// candidates flips review_status on every row and the refetch can return
// them REORDERED. That must never read as "evidence changed" — 11 settled
// questions mass-reopened stale on the user's estate.
// ---------------------------------------------------------------------------

describe('evidence hashes are fetch-order independent', () => {
  it('a reordered candidate refetch yields identical hashes; settled stays settled', () => {
    const shuffled = [...CANDIDATES].reverse();
    const before = deriveFoundationQuestions(entityFactsFromCandidates(CANDIDATES), []);
    const after = deriveFoundationQuestions(entityFactsFromCandidates(shuffled), []);

    const hashByKey = (qs: typeof before) =>
      new Map(qs.map((q) => [q.question_key, q.evidence_hash]));
    expect(hashByKey(after)).toEqual(hashByKey(before));

    // The save-reorder scenario end-to-end: decisions stored from the
    // pre-save order settle every question against the post-save order.
    const decisions: StoredFoundationDecision[] = before.map((q, i) => ({
      decision_key: `F-${i + 1}`,
      rule_key: q.rule_key,
      answer: q.options[0].answer,
      targets_json: q.targets.map((t) => ({ entity_name: t.entity_name })),
      evidence_hash: q.evidence_hash,
      stale: false,
    }));
    expect(deriveFoundationQuestions(entityFactsFromCandidates(shuffled), decisions)).toEqual([]);
  });

  it('joint questions tolerate a reordered model entity array the same way', () => {
    const reordered = {
      metaModel: {
        entities: {
          physical_data_entities: [
            ...JOINT_MODEL.metaModel.entities.physical_data_entities,
          ].reverse(),
        },
        relationships: JOINT_MODEL.metaModel.relationships,
      },
    };
    const before = deriveJointFoundationQuestions(JOINT_MODEL, []);
    const after = deriveJointFoundationQuestions(reordered, []);
    expect(new Map(after.map((q) => [q.question_key, q.evidence_hash]))).toEqual(
      new Map(before.map((q) => [q.question_key, q.evidence_hash])),
    );
  });
});

// ---------------------------------------------------------------------------
// Absent evidence is not negative evidence (2026-08-22 live-shakedown
// regression): the joint panel derived "45 in-scope tables are never touched
// by ANY code path" the moment the code scan STARTED — the code candidates
// were not saved yet, so the model held zero endpoints/effect edges and
// crud_never fired vacuously over the whole estate.
// ---------------------------------------------------------------------------

describe('joint rules refuse to fire without committed code evidence', () => {
  it('a model with tables but NO endpoints/effects derives NO joint questions', () => {
    const preCodeSaveModel = {
      metaModel: {
        entities: {
          physical_data_entities: [
            { id: 'e1', name: 'orders' },
            { id: 'e2', name: 'ref_rates' },
          ],
        },
        relationships: { endpoint_data_effects: [] },
      },
    };
    expect(deriveJointFoundationQuestions(preCodeSaveModel, [])).toEqual([]);
  });

  it('with read evidence present, an edge-less table IS real negative evidence — crud_never fires', () => {
    const model = {
      metaModel: {
        entities: {
          physical_data_entities: [
            { id: 'e1', name: 'orders' },
            { id: 'e2', name: 'ref_rates' },
          ],
          endpoints: [{ id: 'ep1' }],
        },
        relationships: {
          endpoint_data_effects: [{ access_mode: 'read', data_entity_point_id: 'dep_phy_e2' }],
        },
      },
    };
    const questions = deriveJointFoundationQuestions(model, []);
    const never = questions.find((q) => q.question_key === 'FQ-crud_never');
    expect(never?.targets.map((t) => t.entity_name)).toEqual(['orders']);
  });

  it('ZERO read edges estate-wide suppresses the read-axis questions (writes-only model)', () => {
    // The 2026-08-22 live estate: 120 write edges, 0 reads — the matrix
    // claimed "no table is ever read". Read-axis rules now refuse to fire;
    // scope conflicts (write-founded) still do.
    const writesOnly = {
      metaModel: {
        entities: {
          physical_data_entities: [
            { id: 'e1', name: 'orders' },
            { id: 'e2', name: 'audit_log' },
            { id: 'e3', name: 'orders_bak', migration_scope: 'excluded', scope_decision_ref: 'F-1' },
          ],
          endpoints: [{ id: 'ep1' }],
        },
        relationships: {
          endpoint_data_effects: [
            { access_mode: 'write', data_entity_point_id: 'dep_phy_e2' },
            { access_mode: 'write', data_entity_point_id: 'dep_phy_e3' },
          ],
        },
      },
    };
    const keys = deriveJointFoundationQuestions(writesOnly, []).map((q) => q.question_key);
    expect(keys).not.toContain('FQ-crud_never');
    expect(keys).not.toContain('FQ-crud_write_only');
    expect(keys).toContain('FQ-scope_code_conflict-orders_bak');
  });
});

describe('legacy cache strategy decision (2026-08-23)', () => {
  it('cache-fronted read edges surface the strategy question with endpoint targets', () => {
    const model = {
      metaModel: {
        entities: {
          physical_data_entities: [{ id: 'e1', name: 'screen_filter' }],
          endpoints: [
            { id: 'ep1', name: 'GET /filters/{filterId}' },
            { id: 'ep2', name: 'GET /views' },
          ],
        },
        relationships: {
          endpoint_data_effects: [
            {
              access_mode: 'read',
              data_entity_point_id: 'dep_phy_e1',
              endpoint_id: 'ep1',
              path_metadata_json: { via_legacy_cache: true },
            },
            {
              access_mode: 'read',
              data_entity_point_id: 'dep_phy_e1',
              endpoint_id: 'ep2',
              path_metadata_json: null, // direct read — not cache-fronted
            },
          ],
        },
      },
    };
    const questions = deriveJointFoundationQuestions(model, []);
    const q = questions.find((x) => x.question_key === 'FQ-legacy_cache_strategy');
    expect(q).toBeDefined();
    expect(q!.targets.map((t) => t.entity_name)).toEqual(['GET /filters/{filterId}']);
    expect(q!.options[0]).toMatchObject({
      answer: 'no_target_cache',
      recommended: true,
      payload: { cache_strategy: 'none' },
    });
  });

  it('no cache-fronted edges -> no question', () => {
    const questions = deriveJointFoundationQuestions(JOINT_MODEL, []);
    expect(questions.some((x) => x.question_key === 'FQ-legacy_cache_strategy')).toBe(false);
  });
});

describe('sequence_generator decision (Oracle Nine item 2)', () => {
  it('a sequence-idiom table surfaces the strategy card with proposed mappings', () => {
    const facts = entityFactsFromCandidates([
      {
        candidate_type: 'physical_data_entities',
        name: 'seq_registry',
        data: {
          objectType: 'table',
          sequence_generator_idiom: {
            procName: 'getnextnumber',
            numberColumn: 'SequenceNumber',
            nameColumn: 'SequenceName',
            rows: [{ name: 'WidgetId', value: 4592 }],
            proposedMappings: [
              {
                sequenceName: 'WidgetId',
                currentValue: 4592,
                proposals: [{ table: 'screen_filter', column: 'WidgetId', exact: true }],
              },
            ],
          },
        },
      },
      { candidate_type: 'physical_data_attributes', name: 'n', data: { tableName: 'seq_registry' } },
    ]);
    const questions = deriveFoundationQuestions(facts, []);
    const q = questions.find((x) => x.question_key === 'FQ-sequence_generator-seq_registry');
    expect(q).toBeDefined();
    expect(q!.targets[0].note).toContain('WidgetId(4592) -> screen_filter.WidgetId');
    expect(q!.options[0]).toMatchObject({ answer: 'native_sequences', recommended: true });
    expect(q!.options.map((o) => o.answer)).toEqual([
      'native_sequences',
      'native_with_view',
      'table_emulation',
    ]);
    expect((q!.options[0].payload as Record<string, unknown>).sequence_strategy).toBe('native');
  });

  it('no idiom -> no card; scoped-out sequence table -> no card', () => {
    const plain = entityFactsFromCandidates([
      { candidate_type: 'physical_data_entities', name: 'orders', data: { objectType: 'table' } },
    ]);
    expect(
      deriveFoundationQuestions(plain, []).some((x) => x.rule_key === 'sequence_generator'),
    ).toBe(false);
  });
});

describe('parity-key enrichment on key_posture (Oracle Nine item 4)', () => {
  const keylessTable = (probes: unknown) => [
    {
      candidate_type: 'physical_data_entities',
      name: 'deal_book',
      data: { objectType: 'table', parity_key_probes: probes },
    },
    {
      candidate_type: 'physical_data_attributes',
      name: 'HierarchyId',
      data: { tableName: 'deal_book', dataType: 'int', isNullable: true },
    },
  ];

  it('a live-VERIFIED unique tuple rides every option payload as parity_key', () => {
    const facts = entityFactsFromCandidates(
      keylessTable([
        { columns: ['ValidTo', 'HierarchyId', 'ValidFrom'], total: 954411, distinct: 954000, unique: false },
        { columns: ['HierarchyId', 'ValidFrom', 'ValidTo', 'AlternateBookId'], total: 954411, distinct: 954411, unique: true },
      ]),
    );
    const q = deriveFoundationQuestions(facts, []).find(
      (x) => x.question_key === 'FQ-key_posture-deal_book',
    )!;
    expect(q.detail).toContain('LIVE-VERIFIED parity key available');
    for (const option of q.options) {
      expect((option.payload as Record<string, unknown>).parity_key).toEqual([
        'HierarchyId',
        'ValidFrom',
        'ValidTo',
        'AlternateBookId',
      ]);
      expect((option.payload as Record<string, unknown>).parity_key_verified).toBe(true);
    }
  });

  it('no unique tuple -> honest count+checksum mode on every option', () => {
    const facts = entityFactsFromCandidates(
      keylessTable([{ columns: ['HierarchyId', 'ValidFrom'], total: 100, distinct: 93, unique: false }]),
    );
    const q = deriveFoundationQuestions(facts, []).find(
      (x) => x.question_key === 'FQ-key_posture-deal_book',
    )!;
    expect(q.detail).toContain('count+checksum');
    for (const option of q.options) {
      expect((option.payload as Record<string, unknown>).parity_mode).toBe('count_checksum');
    }
  });
});
