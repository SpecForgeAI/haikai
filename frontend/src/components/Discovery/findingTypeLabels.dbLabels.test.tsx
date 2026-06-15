/**
 * findingTypeLabels -- DB finding labels (Spec 2026-05-16 Group 5)
 *
 * Verifies the new DB finding-type labels resolve via `labelForFindingType`.
 * Parameterised over the full label set (Phase 5.4 / spec section "DB
 * Finding Types") so any drop / typo in the map surfaces immediately.
 *
 * Per the Group 5 task list this single parameterised test covers the
 * ~16-18 new entries with one assertion each.
 */

import { describe, it, expect } from 'vitest';
import {
  FINDING_TYPE_LABELS,
  labelForFindingType,
} from './findingTypeLabels';

const DB_FINDING_LABELS: Record<string, string> = {
  missing_primary_key: 'Missing primary key',
  no_foreign_keys_declared: 'No foreign keys declared',
  inferred_relationship: 'Inferred relationship',
  unenforced_relationship: 'Unenforced relationship',
  ambiguous_relationship: 'Ambiguous relationship',
  large_table: 'Large table',
  empty_table: 'Empty table',
  sparse_column: 'Sparse column',
  high_null_rate: 'High null rate',
  unexpected_nulls: 'Unexpected nulls',
  duplicate_business_key: 'Duplicate business key',
  orphaned_reference: 'Orphaned reference',
  unexpected_code_values: 'Unexpected code values',
  sentinel_value_detected: 'Sentinel value detected',
  invalid_date_value: 'Invalid date value',
  inconsistent_reference_data: 'Inconsistent reference data',
  migration_data_quality_risk: 'Migration data quality risk',
  stored_procedure_logic: 'Stored procedure logic',
  procedure_data_write: 'Procedure data write',
  procedure_dependency: 'Procedure dependency',
  trigger_side_effect: 'Trigger side-effect',
  hidden_business_logic: 'Hidden business logic',
  db_migration_risk: 'DB migration risk',
  sample_data_hint: 'Sample data hint',
  reconciliation_hint: 'Reconciliation hint',
  api_test_data_candidate: 'API test data candidate',
  unsupported_db_feature: 'Unsupported DB feature',
  db_pack_warning: 'DB pack warning',
};

describe('findingTypeLabels -- DB labels (Spec 2026-05-16 Group 5)', () => {
  it.each(Object.entries(DB_FINDING_LABELS))(
    'labelForFindingType("%s") -> "%s"',
    (rawType, expected) => {
      expect(labelForFindingType(rawType)).toBe(expected);
      // Sanity check: the constant table also exposes the mapping (so a
      // direct map consumer such as a filter dropdown sees the new label
      // without depending on the helper).
      expect(FINDING_TYPE_LABELS[rawType]).toBe(expected);
    },
  );

  it('existing labels are untouched', () => {
    // Pre-Group-5 entries must still resolve -- the patch is additive.
    expect(labelForFindingType('raw_sql_detected')).toBe('Raw SQL detected');
    expect(labelForFindingType('risky_dependency')).toBe('Risky dependency');
    expect(labelForFindingType('spring_xml_bean_wiring')).toBe('Spring XML bean wiring');
  });
});
