/**
 * PackageSetCell Component
 * Spec: Service Package Set Assignment Dropdown
 * Spec: Package Set Standards Import (Iteration 6) - Task Group 6
 *
 * A custom cell component for the Services grid that provides a dropdown
 * to select a Package Set or trigger create/clone workflows.
 *
 * Task Group 6 Enhancement:
 * - When service.package_set_id is null, compute resolved default using matching rules
 * - Display: "Default (Auto) -> <Name>" when matched, "Default (Auto) (no match)" when unmatched
 * - Show PackageSetPreview for resolved default
 * - IMPORTANT: Do NOT write resolved id back to service.package_set_id
 *
 * Dropdown Structure:
 * - "Default (Auto)" option (displayed when package_set_id is null)
 * - Divider line
 * - List of existing Package Sets by name
 * - Divider line
 * - "Create new..." action item
 * - "Clone and customize..." action item (disabled when no concrete selection)
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { PackageSet, Package, Service } from '../../types/model';
import { PackageSetDefaultRule, resolveDefaultPackageSetId } from '../../types/packageSetStandards';
import { PackageSetPreview } from './PackageSetPreview';
import styles from './Grid.module.css';
import packageSetStyles from './PackageSetCell.module.css';

export interface PackageSetCellProps {
  /** Current package_set_id value (null for "Default (Auto)") */
  value: string | null | undefined;
  /** Available Package Sets from the model */
  packageSets: PackageSet[];
  /** Available Packages from the model (for preview) */
  packages: Package[];
  /** Callback when a Package Set is selected */
  onChange: (value: string | null) => void;
  /** Callback when "Create new..." is clicked */
  onCreateNew: () => void;
  /** Callback when "Clone and customize..." is clicked */
  onClone: () => void;
  /**
   * Spec: Package Set Standards Import (Iteration 6) - Task Group 6
   * Default rules for resolving "Default (Auto)" package sets.
   * Rules should be pre-sorted by priority descending.
   */
  defaultRules?: PackageSetDefaultRule[];
  /**
   * Spec: Package Set Standards Import (Iteration 6) - Task Group 6
   * Service data for computing resolved default (core_tech, service_type).
   */
  service?: Pick<Service, 'core_tech' | 'service_type'>;
}

/**
 * Get dropdown position based on cell position relative to container.
 * Prevents dropdown from being cut off at the bottom of the grid.
 */
function getDropdownPosition(
  cellRect: DOMRect,
  containerRect: DOMRect
): 'below' | 'above' {
  const containerMidY = containerRect.top + (containerRect.height / 2);
  const cellCenterY = cellRect.top + (cellRect.height / 2);
  return cellCenterY < containerMidY ? 'below' : 'above';
}

/**
 * Custom hook for resolving the default package set ID.
 * Returns the resolved package set ID, name, and whether a match was found.
 */
function useDefaultPackageSetResolution(
  service: Pick<Service, 'core_tech' | 'service_type'> | undefined,
  rules: PackageSetDefaultRule[],
  packageSets: PackageSet[]
): { resolvedId: string | null; resolvedName: string | null; hasMatch: boolean } {
  return useMemo(() => {
    if (!service || rules.length === 0) {
      return { resolvedId: null, resolvedName: null, hasMatch: false };
    }

    const resolvedId = resolveDefaultPackageSetId(service, rules);

    if (resolvedId) {
      const packageSet = packageSets.find(ps => ps.id === resolvedId);
      return {
        resolvedId,
        resolvedName: packageSet?.name || 'Unknown',
        hasMatch: true,
      };
    }

    return { resolvedId: null, resolvedName: null, hasMatch: false };
  }, [service, rules, packageSets]);
}

export function PackageSetCell({
  value,
  packageSets,
  packages,
  onChange,
  onCreateNew,
  onClone,
  defaultRules = [],
  service,
}: PackageSetCellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const containerRef = useRef<HTMLDivElement>(null);

  // Get the currently selected Package Set (if any)
  const selectedPackageSet = value
    ? packageSets.find((ps) => ps.id === value)
    : null;

  // Task Group 6: Compute resolved default when in "Default (Auto)" mode
  const { resolvedId, resolvedName, hasMatch } = useDefaultPackageSetResolution(
    service,
    defaultRules,
    packageSets
  );

  // Task Group 6: Determine display text based on selection and resolution
  const displayText = useMemo(() => {
    // If a concrete Package Set is selected, show its name
    if (selectedPackageSet) {
      return selectedPackageSet.name;
    }

    // In "Default (Auto)" mode, show resolution result
    if (hasMatch && resolvedName) {
      return `Default (Auto) -> ${resolvedName}`;
    }

    return 'Default (Auto) (no match)';
  }, [selectedPackageSet, hasMatch, resolvedName]);

  // Task Group 6: Determine which package set ID to use for preview
  // When in Default (Auto) mode with a match, show preview for resolved set
  const previewPackageSetId = value || (hasMatch ? resolvedId : null);

  // Check if clone should be disabled (no concrete selection)
  const isCloneDisabled = !value || !selectedPackageSet;

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowPreview(false);
      }
    };

    if (isOpen || showPreview) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, showPreview]);

  // Calculate dropdown position when opening
  const handleOpen = useCallback(() => {
    if (containerRef.current) {
      const cellRect = containerRef.current.getBoundingClientRect();
      const gridContainer = containerRef.current.closest('[class*="gridContainer"]');
      if (gridContainer) {
        const containerRect = gridContainer.getBoundingClientRect();
        const position = getDropdownPosition(cellRect, containerRect);
        setDropdownPosition(position);
      }
    }
    setIsOpen(true);
  }, []);

  // Handle cell click to toggle dropdown
  const handleCellClick = useCallback(() => {
    if (isOpen) {
      setIsOpen(false);
    } else {
      handleOpen();
    }
  }, [isOpen, handleOpen]);

  // Handle mouse enter to show preview
  const handleMouseEnter = useCallback(() => {
    if (!isOpen && previewPackageSetId) {
      setShowPreview(true);
    }
  }, [isOpen, previewPackageSetId]);

  // Handle mouse leave to hide preview
  const handleMouseLeave = useCallback(() => {
    setShowPreview(false);
  }, []);

  // Handle selecting "Default (Auto)"
  const handleSelectDefault = useCallback(() => {
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  // Handle selecting a Package Set
  const handleSelectPackageSet = useCallback((packageSetId: string) => {
    onChange(packageSetId);
    setIsOpen(false);
  }, [onChange]);

  // Handle "Create new..." action
  const handleCreateNew = useCallback(() => {
    setIsOpen(false);
    onCreateNew();
  }, [onCreateNew]);

  // Handle "Clone and customize..." action
  const handleClone = useCallback(() => {
    if (!isCloneDisabled) {
      setIsOpen(false);
      onClone();
    }
  }, [isCloneDisabled, onClone]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setShowPreview(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (!isOpen) {
        handleOpen();
      }
    }
  }, [isOpen, handleOpen]);

  const dropdownClass = dropdownPosition === 'above'
    ? `${styles.typeaheadDropdown} ${styles.typeaheadDropdownAbove} ${packageSetStyles.packageSetDropdown}`
    : `${styles.typeaheadDropdown} ${styles.typeaheadDropdownBelow} ${packageSetStyles.packageSetDropdown}`;

  // Task Group 6: Determine if we're in "Default (Auto)" mode
  const isDefaultMode = !value;

  return (
    <div
      ref={containerRef}
      className={styles.typeaheadContainer}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid="package-set-cell"
    >
      {/* Display value - clickable to open dropdown */}
      <div
        className={`${styles.cellValue} ${packageSetStyles.packageSetValue}`}
        onClick={handleCellClick}
        data-testid="package-set-cell-value"
        tabIndex={0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className={isDefaultMode ? packageSetStyles.defaultOption : ''}>
          {displayText}
        </span>
        <span className={packageSetStyles.dropdownArrow}>
          {isOpen ? '\u25B2' : '\u25BC'}
        </span>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className={dropdownClass}
          role="listbox"
          data-testid="package-set-dropdown"
        >
          {/* Default (Auto) option */}
          <div
            className={`${styles.typeaheadOption} ${packageSetStyles.defaultOptionItem} ${!value ? packageSetStyles.selectedOption : ''}`}
            onClick={handleSelectDefault}
            role="option"
            aria-selected={!value}
            data-testid="package-set-option-default"
          >
            Default (Auto)
          </div>

          {/* Divider */}
          <div className={packageSetStyles.divider} role="separator" />

          {/* Package Sets list */}
          {packageSets.length > 0 ? (
            packageSets.map((ps) => (
              <div
                key={ps.id}
                className={`${styles.typeaheadOption} ${value === ps.id ? packageSetStyles.selectedOption : ''}`}
                onClick={() => handleSelectPackageSet(ps.id)}
                role="option"
                aria-selected={value === ps.id}
                data-testid={`package-set-option-${ps.id}`}
              >
                {ps.name}
              </div>
            ))
          ) : (
            <div className={packageSetStyles.noPackageSets}>
              No package sets available
            </div>
          )}

          {/* Divider */}
          <div className={packageSetStyles.divider} role="separator" />

          {/* Action items */}
          <div
            className={`${styles.typeaheadOption} ${packageSetStyles.actionItem}`}
            onClick={handleCreateNew}
            role="option"
            data-testid="package-set-action-create"
          >
            Create new...
          </div>
          <div
            className={`${styles.typeaheadOption} ${packageSetStyles.actionItem} ${isCloneDisabled ? packageSetStyles.actionItemDisabled : ''}`}
            onClick={handleClone}
            role="option"
            aria-disabled={isCloneDisabled}
            data-testid="package-set-action-clone"
          >
            Clone and customize...
          </div>
        </div>
      )}

      {/* Task Group 6: Package preview for resolved default or concrete selection */}
      {showPreview && previewPackageSetId && !isOpen && (
        <PackageSetPreview
          packageSetId={previewPackageSetId}
          packageSets={packageSets}
          packages={packages}
        />
      )}
    </div>
  );
}

export default PackageSetCell;
