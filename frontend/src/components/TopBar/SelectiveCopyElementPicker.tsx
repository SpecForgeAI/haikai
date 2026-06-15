/**
 * SelectiveCopyElementPicker
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 7
 *
 * Pure presentation component that renders the source architecture's element
 * inventory as a collapsible tree (Domain -> Type -> Instance), with:
 *   - Tri-state checkboxes at every internal node (domain + type level).
 *   - A search box at the top that filters visible nodes by instance name
 *     across all domains and types -- client-side, no API round-trip.
 *   - Auto-included badge + tooltip on instances that the preflight pulled in
 *     to satisfy a parent's missing reference.
 *
 * The component owns NO API state -- inventory + selection state + the
 * auto-included list are all passed in as props by the wizard
 * (`SelectiveCopyWizardModal`, Group 9). Selection mutations are emitted
 * upward via `onSelectionChange(newSelection: Set<string>)`. The wizard then
 * decides whether to re-run preflight (for example, when the user un-ticks
 * an auto-included element).
 *
 * Domain ordering is fixed by the backend (Applications, Data, Business, UI,
 * Behavioural, Diagrams). This component renders domains in whatever order
 * the inventory provides them -- the backend's contract is the single source
 * of truth (per Group 1's `ArchitectureElementInventoryService`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ElementInventoryDomain,
  ElementInventoryInstance,
  ElementInventoryResponse,
  ElementInventoryType,
  SelectiveCopyAutoIncluded,
} from '../../api/architecturesApi';
import styles from './SelectiveCopyElementPicker.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SelectiveCopyElementPickerProps {
  /** Full element inventory from `getElementsInventory(...)`. */
  inventory: ElementInventoryResponse;
  /**
   * Currently selected element ids (instance ids only -- domain / type rows
   * are derived). Always treated as immutable; mutations are emitted as a
   * brand-new Set via `onSelectionChange`.
   */
  selectedIds: Set<string>;
  /**
   * Auto-included elements from the most recent preflight, if any. Drives the
   * `auto-included` badge + tooltip rendering on the matching instance rows.
   * Auto-included elements appear here even when they're also present in
   * `selectedIds` (the wizard typically merges them so the picker reflects
   * what will actually be copied).
   */
  autoIncluded?: SelectiveCopyAutoIncluded[];
  /**
   * Called whenever the user interacts with any checkbox. The handler
   * receives a brand-new Set instance reflecting the post-interaction
   * selection -- the wizard layer is responsible for re-running preflight
   * when needed.
   */
  onSelectionChange: (newSelection: Set<string>) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns the case-insensitive substring filter predicate. Empty / whitespace
 * input is treated as "match all".
 */
function buildSearchPredicate(query: string): (instance: ElementInventoryInstance) => boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return () => true;
  return (instance) => instance.name.toLowerCase().includes(trimmed);
}

/**
 * Filters one type's instances by the search predicate. Returns null if the
 * type ends up with zero matching instances (caller should hide the type
 * group entirely).
 */
function filterType(
  type: ElementInventoryType,
  predicate: (i: ElementInventoryInstance) => boolean,
): ElementInventoryType | null {
  const filtered = type.instances.filter(predicate);
  if (filtered.length === 0) return null;
  return { ...type, instances: filtered };
}

/**
 * Filters a domain's types + instances by the search predicate. Returns the
 * domain even if no types matched -- the caller decides whether to render the
 * empty-state placeholder or hide it entirely.
 */
function filterDomain(
  domain: ElementInventoryDomain,
  predicate: (i: ElementInventoryInstance) => boolean,
): ElementInventoryDomain {
  const filteredTypes: ElementInventoryType[] = [];
  for (const t of domain.types) {
    const ft = filterType(t, predicate);
    if (ft) filteredTypes.push(ft);
  }
  return { ...domain, types: filteredTypes };
}

/**
 * Compute the tri-state value of a domain or type checkbox from the union of
 * its descendant instance ids and the current selection set.
 */
type TriState = 'unchecked' | 'checked' | 'indeterminate';

function computeTriState(descendantIds: string[], selected: Set<string>): TriState {
  if (descendantIds.length === 0) return 'unchecked';
  let some = false;
  let all = true;
  for (const id of descendantIds) {
    if (selected.has(id)) {
      some = true;
    } else {
      all = false;
    }
  }
  if (all) return 'checked';
  if (some) return 'indeterminate';
  return 'unchecked';
}

// ---------------------------------------------------------------------------
// Tri-state checkbox primitive
// ---------------------------------------------------------------------------

interface TriStateCheckboxProps {
  state: TriState;
  onToggle: () => void;
  disabled?: boolean;
  ariaLabel: string;
  testId?: string;
  title?: string;
}

/**
 * Standard React indeterminate-checkbox pattern: render a normal `<input
 * type="checkbox">` and set `el.indeterminate = true` after render via a ref
 * (the DOM property is the only way to express the indeterminate visual --
 * there is no HTML attribute for it).
 */
function TriStateCheckbox({
  state,
  onToggle,
  disabled,
  ariaLabel,
  testId,
  title,
}: TriStateCheckboxProps): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === 'indeterminate';
    }
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      checked={state === 'checked'}
      onChange={onToggle}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
      data-testid={testId}
      title={title}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SelectiveCopyElementPicker({
  inventory,
  selectedIds,
  autoIncluded = [],
  onSelectionChange,
}: SelectiveCopyElementPickerProps): JSX.Element {
  const [search, setSearch] = useState('');

  // Domains start expanded by default so the user sees scope on first render.
  // Type-level expansion follows the same default. A user-driven collapse
  // flips the entry to false; once present, manual state wins.
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({});

  const isDomainExpanded = useCallback(
    (key: string) => expandedDomains[key] !== false,
    [expandedDomains],
  );
  const isTypeExpanded = useCallback(
    (key: string) => expandedTypes[key] !== false,
    [expandedTypes],
  );

  const toggleDomain = useCallback((key: string) => {
    setExpandedDomains((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }));
  }, []);
  const toggleType = useCallback((key: string) => {
    setExpandedTypes((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }));
  }, []);

  // Index auto-included entries by id for O(1) lookup during render.
  const autoIncludedById = useMemo(() => {
    const m = new Map<string, SelectiveCopyAutoIncluded>();
    for (const a of autoIncluded) m.set(a.elementId, a);
    return m;
  }, [autoIncluded]);

  // Apply the search filter to derive the visible tree without mutating the
  // inventory prop. Domains with zero matching types are still rendered with
  // an empty-state row so the canonical six-domain layout is preserved when
  // search is empty; when the user is searching we hide empty domains entirely
  // so the result list is tightly focused.
  const isSearching = search.trim().length > 0;
  const filteredDomains = useMemo(() => {
    const predicate = buildSearchPredicate(search);
    const out: ElementInventoryDomain[] = [];
    for (const d of inventory.domains) {
      const fd = filterDomain(d, predicate);
      if (isSearching && fd.types.length === 0) continue;
      out.push(fd);
    }
    return out;
  }, [inventory.domains, search, isSearching]);

  // ----- Selection mutations -----

  /** Check or uncheck a single instance. */
  const toggleInstance = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  /**
   * Toggle every descendant instance of an internal node (domain or type)
   * to a single target state. Clicking a checked or indeterminate node
   * un-checks all descendants; clicking an unchecked node checks all
   * descendants -- per spec.
   */
  const toggleSubtree = useCallback(
    (descendantIds: string[], currentState: TriState) => {
      const next = new Set(selectedIds);
      if (currentState === 'unchecked') {
        for (const id of descendantIds) next.add(id);
      } else {
        // checked OR indeterminate -> uncheck all descendants
        for (const id of descendantIds) next.delete(id);
      }
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  // ----- Render -----

  return (
    <div className={styles.root} data-testid="selective-copy-element-picker">
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search elements by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="selective-copy-element-picker-search"
          aria-label="Search elements by name"
        />
        {search.length > 0 ? (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setSearch('')}
            data-testid="selective-copy-element-picker-search-clear"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className={styles.tree} role="tree" data-testid="selective-copy-element-picker-tree">
        {filteredDomains.length === 0 ? (
          <div className={styles.emptyTree} data-testid="selective-copy-element-picker-empty">
            No elements match &quot;{search}&quot;.
          </div>
        ) : (
          filteredDomains.map((domain) => (
            <DomainGroup
              key={domain.name}
              domain={domain}
              expanded={isDomainExpanded(domain.name)}
              onToggleExpand={() => toggleDomain(domain.name)}
              isTypeExpanded={isTypeExpanded}
              onToggleType={toggleType}
              selectedIds={selectedIds}
              autoIncludedById={autoIncludedById}
              onToggleInstance={toggleInstance}
              onToggleSubtree={toggleSubtree}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DomainGroup -- internal sub-component
// ---------------------------------------------------------------------------

interface DomainGroupProps {
  domain: ElementInventoryDomain;
  expanded: boolean;
  onToggleExpand: () => void;
  isTypeExpanded: (key: string) => boolean;
  onToggleType: (key: string) => void;
  selectedIds: Set<string>;
  autoIncludedById: Map<string, SelectiveCopyAutoIncluded>;
  onToggleInstance: (id: string) => void;
  onToggleSubtree: (descendantIds: string[], currentState: TriState) => void;
}

function DomainGroup({
  domain,
  expanded,
  onToggleExpand,
  isTypeExpanded,
  onToggleType,
  selectedIds,
  autoIncludedById,
  onToggleInstance,
  onToggleSubtree,
}: DomainGroupProps): JSX.Element {
  const allDescendantIds = useMemo(() => {
    const ids: string[] = [];
    for (const t of domain.types) {
      for (const i of t.instances) ids.push(i.id);
    }
    return ids;
  }, [domain]);

  const triState = computeTriState(allDescendantIds, selectedIds);

  const hasAnyInstances = allDescendantIds.length > 0;

  return (
    <div className={styles.domain} data-testid={`selective-copy-domain-${domain.name}`}>
      <div className={`${styles.row} ${styles.rowDomain}`} role="treeitem" aria-expanded={expanded}>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={onToggleExpand}
          aria-label={expanded ? `Collapse ${domain.name}` : `Expand ${domain.name}`}
          data-testid={`selective-copy-domain-toggle-${domain.name}`}
        >
          {expanded ? '\u25BE' : '\u25B8'}
        </button>
        <TriStateCheckbox
          state={triState}
          onToggle={() => onToggleSubtree(allDescendantIds, triState)}
          disabled={!hasAnyInstances}
          ariaLabel={`Select all in ${domain.name}`}
          testId={`selective-copy-domain-checkbox-${domain.name}`}
        />
        <span className={styles.label}>{domain.name}</span>
        <span className={styles.count}>
          {allDescendantIds.length === 0 ? '(empty)' : `(${allDescendantIds.length})`}
        </span>
      </div>

      {expanded ? (
        domain.types.length === 0 ? (
          <div className={styles.emptyDomain} data-testid={`selective-copy-domain-empty-${domain.name}`}>
            No elements
          </div>
        ) : (
          domain.types.map((type) => (
            <TypeGroup
              key={`${domain.name}::${type.name}`}
              domainName={domain.name}
              type={type}
              expanded={isTypeExpanded(`${domain.name}::${type.name}`)}
              onToggleExpand={() => onToggleType(`${domain.name}::${type.name}`)}
              selectedIds={selectedIds}
              autoIncludedById={autoIncludedById}
              onToggleInstance={onToggleInstance}
              onToggleSubtree={onToggleSubtree}
            />
          ))
        )
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TypeGroup -- internal sub-component
// ---------------------------------------------------------------------------

interface TypeGroupProps {
  domainName: string;
  type: ElementInventoryType;
  expanded: boolean;
  onToggleExpand: () => void;
  selectedIds: Set<string>;
  autoIncludedById: Map<string, SelectiveCopyAutoIncluded>;
  onToggleInstance: (id: string) => void;
  onToggleSubtree: (descendantIds: string[], currentState: TriState) => void;
}

function TypeGroup({
  domainName,
  type,
  expanded,
  onToggleExpand,
  selectedIds,
  autoIncludedById,
  onToggleInstance,
  onToggleSubtree,
}: TypeGroupProps): JSX.Element {
  const descendantIds = useMemo(() => type.instances.map((i) => i.id), [type]);
  const triState = computeTriState(descendantIds, selectedIds);

  return (
    <div className={styles.type} data-testid={`selective-copy-type-${domainName}-${type.name}`}>
      <div className={`${styles.row} ${styles.rowType}`} role="treeitem" aria-expanded={expanded}>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={onToggleExpand}
          aria-label={expanded ? `Collapse ${type.name}` : `Expand ${type.name}`}
          data-testid={`selective-copy-type-toggle-${domainName}-${type.name}`}
        >
          {expanded ? '\u25BE' : '\u25B8'}
        </button>
        <TriStateCheckbox
          state={triState}
          onToggle={() => onToggleSubtree(descendantIds, triState)}
          disabled={descendantIds.length === 0}
          ariaLabel={`Select all in ${type.name}`}
          testId={`selective-copy-type-checkbox-${domainName}-${type.name}`}
        />
        <span className={styles.label}>{type.name}</span>
        <span className={styles.count}>({descendantIds.length})</span>
      </div>

      {expanded
        ? type.instances.map((instance) => (
            <InstanceRow
              key={instance.id}
              instance={instance}
              selected={selectedIds.has(instance.id)}
              autoIncluded={autoIncludedById.get(instance.id)}
              onToggle={() => onToggleInstance(instance.id)}
            />
          ))
        : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstanceRow -- leaf
// ---------------------------------------------------------------------------

interface InstanceRowProps {
  instance: ElementInventoryInstance;
  selected: boolean;
  autoIncluded?: SelectiveCopyAutoIncluded;
  onToggle: () => void;
}

function InstanceRow({ instance, selected, autoIncluded, onToggle }: InstanceRowProps): JSX.Element {
  const tooltip = autoIncluded
    ? `Auto-included because referenced by ${autoIncluded.includedBecause}`
    : undefined;

  // Auto-included instances render with the badge + tooltip. The user CAN
  // un-tick (per spec): clicking removes the id from the selection, the
  // wizard re-runs preflight, and the parent's missing-reference conflict
  // is surfaced.
  return (
    <div
      className={`${styles.row} ${styles.rowInstance}`}
      role="treeitem"
      data-testid={`selective-copy-instance-${instance.id}`}
    >
      <span className={styles.toggleSpacer} aria-hidden="true" />
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${instance.name}`}
        data-testid={`selective-copy-instance-checkbox-${instance.id}`}
        title={tooltip}
      />
      <span className={styles.label}>{instance.name}</span>
      {autoIncluded ? (
        <span
          className={styles.autoBadge}
          title={tooltip}
          data-testid={`selective-copy-instance-auto-badge-${instance.id}`}
        >
          auto
        </span>
      ) : null}
    </div>
  );
}

export default SelectiveCopyElementPicker;
