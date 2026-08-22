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
