/**
 * MigrationBookOfWorkFilters
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 11.
 *
 * Filter bar above the hierarchy tree. All filters compose with AND
 * semantics; an unset filter does not constrain. Workstream filter
 * surfaces the `unknown` sentinel per Q-7 so the reviewer can find and
 * reclassify those items.
 *
 * The "type-specific" toggles (API / data / infrastructure / test pack)
 * are convenience filters that map to specific workstream values per
 * spec.md.
 */

import React from 'react';
import {
  ALL_WORKSTREAMS,
  type MigrationBookOfWorkConfidence,
  type MigrationBookOfWorkReadiness,
  type MigrationBookOfWorkWorkstream,
} from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

export interface MigrationBookOfWorkFilterState {
  workstreams: MigrationBookOfWorkWorkstream[];
  confidences: MigrationBookOfWorkConfidence[];
  readinesses: MigrationBookOfWorkReadiness[];
  blockingGapsOnly: boolean;
  lowConfidenceOnly: boolean;
  apiWorkOnly: boolean;
  dataMigrationOnly: boolean;
  infrastructureOnly: boolean;
  testPackOnly: boolean;
  /** Free-text search over `discoveryFindingReferences` per spec.md. */
  findingReferenceSearch: string;
}

export const EMPTY_FILTERS: MigrationBookOfWorkFilterState = {
  workstreams: [],
  confidences: [],
  readinesses: [],
  blockingGapsOnly: false,
  lowConfidenceOnly: false,
  apiWorkOnly: false,
  dataMigrationOnly: false,
  infrastructureOnly: false,
  testPackOnly: false,
  findingReferenceSearch: '',
};

const ALL_CONFIDENCES: MigrationBookOfWorkConfidence[] = ['high', 'medium', 'low'];
const ALL_READINESSES: MigrationBookOfWorkReadiness[] = [
  'ready_for_spec',
  'needs_focused_context',
  'needs_user_decision',
  'blocked',
];

export interface MigrationBookOfWorkFiltersProps {
  value: MigrationBookOfWorkFilterState;
  onChange: (next: MigrationBookOfWorkFilterState) => void;
}

function toggleEnumValue<T extends string>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export const MigrationBookOfWorkFilters: React.FC<
  MigrationBookOfWorkFiltersProps
> = ({ value, onChange }) => {
  const update = (patch: Partial<MigrationBookOfWorkFilterState>) =>
    onChange({ ...value, ...patch });

  return (
    <div className={styles.filtersBar} data-testid="filters-bar">
      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Workstream</span>
        <select
          multiple
          className={styles.filterSelect}
          value={value.workstreams}
          onChange={(e) => {
            const next: MigrationBookOfWorkWorkstream[] = [];
            for (const opt of Array.from(e.target.selectedOptions)) {
              next.push(opt.value as MigrationBookOfWorkWorkstream);
            }
            update({ workstreams: next });
          }}
          data-testid="filter-workstreams"
        >
          {ALL_WORKSTREAMS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Confidence</span>
        {ALL_CONFIDENCES.map((c) => (
          <label key={c} className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={value.confidences.includes(c)}
              onChange={() =>
                update({ confidences: toggleEnumValue(value.confidences, c) })
              }
              data-testid={`filter-confidence-${c}`}
            />
            {c}
          </label>
        ))}
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Readiness</span>
        {ALL_READINESSES.map((r) => (
          <label key={r} className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={value.readinesses.includes(r)}
              onChange={() =>
                update({ readinesses: toggleEnumValue(value.readinesses, r) })
              }
              data-testid={`filter-readiness-${r}`}
            />
            {r}
          </label>
        ))}
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Toggles</span>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={value.blockingGapsOnly}
            onChange={(e) => update({ blockingGapsOnly: e.target.checked })}
            data-testid="filter-blocking-gaps"
          />
          Blocking gaps
        </label>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={value.lowConfidenceOnly}
            onChange={(e) => update({ lowConfidenceOnly: e.target.checked })}
            data-testid="filter-low-confidence"
          />
          Low confidence
        </label>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={value.apiWorkOnly}
            onChange={(e) => update({ apiWorkOnly: e.target.checked })}
            data-testid="filter-api-work"
          />
          API work
        </label>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={value.dataMigrationOnly}
            onChange={(e) => update({ dataMigrationOnly: e.target.checked })}
            data-testid="filter-data-migration"
          />
          Data migration
        </label>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={value.infrastructureOnly}
            onChange={(e) => update({ infrastructureOnly: e.target.checked })}
            data-testid="filter-infrastructure"
          />
          Infrastructure
        </label>
        <label className={styles.filterToggle}>
          <input
            type="checkbox"
            checked={value.testPackOnly}
            onChange={(e) => update({ testPackOnly: e.target.checked })}
            data-testid="filter-test-pack"
          />
          Test pack
        </label>
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Finding ref</span>
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Search finding id..."
          value={value.findingReferenceSearch}
          onChange={(e) =>
            update({ findingReferenceSearch: e.target.value })
          }
          data-testid="filter-finding-reference"
        />
      </div>

      <button
        type="button"
        className={styles.filterClearButton}
        onClick={() => onChange(EMPTY_FILTERS)}
        data-testid="filter-clear"
      >
        Clear filters
      </button>
    </div>
  );
};

// ============================================================================
// Filter application
// ============================================================================

/**
 * Map of the convenience type-specific toggles to the workstream values
 * they admit. Used by `applyFilters` so the toggles behave like virtual
 * workstream filters.
 */
const TOGGLE_WORKSTREAM_MAP: Record<
  'apiWorkOnly' | 'dataMigrationOnly' | 'infrastructureOnly' | 'testPackOnly',
  MigrationBookOfWorkWorkstream[]
> = {
  apiWorkOnly: [
    'target_service_api_implementation',
    'api_soap_integration_compatibility',
  ],
  dataMigrationOnly: ['data_migration', 'target_database_schema_implementation'],
  infrastructureOnly: ['target_infrastructure_environment_implementation'],
  testPackOnly: ['migration_test_pack', 'test_strategy'],
};

export interface FilterableItem {
  id: string;
  workstream: MigrationBookOfWorkWorkstream;
  confidence: MigrationBookOfWorkConfidence;
  readiness: MigrationBookOfWorkReadiness;
  readinessReasons?: string[];
  missingInputs?: string[];
  discoveryFindingReferences?: string[];
}

/**
 * Returns true when the item passes all currently-set filters. AND
 * semantics across filter groups; OR semantics within a multi-select
 * (e.g. selecting two workstreams admits items matching either).
 */
export function itemPassesFilters(
  item: FilterableItem,
  filters: MigrationBookOfWorkFilterState,
): boolean {
  if (
    filters.workstreams.length > 0 &&
    !filters.workstreams.includes(item.workstream)
  ) {
    return false;
  }
  if (
    filters.confidences.length > 0 &&
    !filters.confidences.includes(item.confidence)
  ) {
    return false;
  }
  if (
    filters.readinesses.length > 0 &&
    !filters.readinesses.includes(item.readiness)
  ) {
    return false;
  }
  if (filters.blockingGapsOnly) {
    const hasBlocker =
      item.readiness === 'blocked' ||
      (item.readinessReasons?.length ?? 0) > 0 ||
      (item.missingInputs?.length ?? 0) > 0;
    if (!hasBlocker) return false;
  }
  if (filters.lowConfidenceOnly && item.confidence !== 'low') {
    return false;
  }
  for (const key of [
    'apiWorkOnly',
    'dataMigrationOnly',
    'infrastructureOnly',
    'testPackOnly',
  ] as const) {
    if (filters[key]) {
      if (!TOGGLE_WORKSTREAM_MAP[key].includes(item.workstream)) {
        return false;
      }
    }
  }
  if (filters.findingReferenceSearch.trim().length > 0) {
    const needle = filters.findingReferenceSearch.trim().toLowerCase();
    const refs = item.discoveryFindingReferences ?? [];
    if (!refs.some((r) => r.toLowerCase().includes(needle))) {
      return false;
    }
  }
  return true;
}

export default MigrationBookOfWorkFilters;
