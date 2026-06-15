/**
 * selectionUtils.ts
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 2: Section-Level Select All
 * Task 2.2: Selection state derivation utility
 *
 * This module provides:
 * - deriveCheckboxState: Computes checkbox state (checked/unchecked/indeterminate) from selection counts
 *
 * Used by ContextPickerModal for section-level and group-level Select All checkboxes.
 */

/**
 * Checkbox state type for three-state checkbox behavior
 */
export type CheckboxState = 'checked' | 'unchecked' | 'indeterminate';

/**
 * Derives the checkbox state based on selection counts.
 *
 * Three-state checkbox behavior:
 * - 'checked': All items are selected (selectedCount === totalCount && totalCount > 0)
 * - 'unchecked': No items are selected (selectedCount === 0)
 * - 'indeterminate': Some but not all items are selected (0 < selectedCount < totalCount)
 *
 * @param selectedCount - Number of currently selected items
 * @param totalCount - Total number of items in the scope
 * @returns The checkbox state: 'checked', 'unchecked', or 'indeterminate'
 */
export function deriveCheckboxState(selectedCount: number, totalCount: number): CheckboxState {
  // If no items exist, return unchecked
  if (totalCount === 0) {
    return 'unchecked';
  }

  // All items selected
  if (selectedCount === totalCount) {
    return 'checked';
  }

  // No items selected
  if (selectedCount === 0) {
    return 'unchecked';
  }

  // Some but not all items selected
  return 'indeterminate';
}
