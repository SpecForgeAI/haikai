/**
 * CreatePackageSetModal Component
 * Spec: Create Package Set Modal with Embedded Packages Builder
 * Spec: Clone Package Set Modal (Task Group 1: Modal Mode Support)
 *
 * This modal allows users to create a new Package Set or clone an existing one.
 * Features:
 * - Package Set Name field (required)
 * - Packages builder table with add/remove/reorder functionality
 * - Package Name (required) and Purpose (optional) fields per row
 * - Validation before submission
 * - Keyboard shortcuts: Escape to close, Ctrl+Enter to submit
 * - Mode support: 'create' (default) or 'clone'
 * - Name uniqueness validation in both modes
 * - Pre-population from initialData in clone mode
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { PackageSet, Package } from '../../types/model';
import { generateEntityId } from '../../utils/idGenerator';
import styles from './CreatePackageSetModal.module.css';

// ============================================================================
// Props Interface (Task Group 2 + Clone Package Set Modal Task Group 1)
// ============================================================================

/**
 * Initial data structure for clone mode pre-population.
 * Contains the source package set's name (with "(copy)" suffix) and packages.
 */
export interface CloneInitialData {
  /** Pre-filled name (should be "<original name> (copy)") */
  name: string;
  /** Array of packages to clone (name, purpose, sort_order) */
  packages: Array<{
    name: string;
    purpose?: string;
    sort_order?: number;
  }>;
}

/**
 * Props for the CreatePackageSetModal component.
 */
export interface CreatePackageSetModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when a new PackageSet and Packages are submitted */
  onSubmit: (packageSet: PackageSet, packages: Package[]) => void;
  /**
   * Modal mode: 'create' (default) or 'clone'
   * - 'create': Empty form for creating new Package Set
   * - 'clone': Pre-populated form for cloning existing Package Set
   */
  mode?: 'create' | 'clone';
  /**
   * Initial data for clone mode pre-population.
   * Contains name and packages from the source Package Set.
   * Only used when mode is 'clone'.
   */
  initialData?: CloneInitialData;
  /**
   * Array of existing package set names for uniqueness validation.
   * Names are compared case-insensitively after trimming.
   */
  existingPackageSetNames?: string[];
}

// ============================================================================
// Package Row Interface (Task Group 4)
// ============================================================================

/**
 * Internal package row data structure for the packages builder.
 * Uses tempId for React key tracking before final ID generation.
 */
interface PackageRowData {
  /** Temporary ID for React key tracking */
  tempId: string;
  /** Package name (required) */
  name: string;
  /** Package purpose (optional) */
  purpose: string;
}

// ============================================================================
// Form Data Interface (Task Group 3)
// ============================================================================

/**
 * Internal form data structure for the modal.
 */
interface CreatePackageSetFormData {
  /** Package Set name */
  name: string;
  /** Array of package rows */
  packages: PackageRowData[];
}

/**
 * Validation errors for form fields
 */
interface ValidationErrors {
  /** Error for package set name field */
  name?: string;
  /** Errors for package rows (keyed by tempId) */
  packageNames?: Record<string, string>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a temporary ID for package rows (before final entity ID generation)
 */
let tempIdCounter = 0;
function generateTempId(): string {
  tempIdCounter++;
  return `temp_${Date.now()}_${tempIdCounter}`;
}

/**
 * Create an empty package row with default values
 */
function createEmptyPackageRow(): PackageRowData {
  return {
    tempId: generateTempId(),
    name: '',
    purpose: '',
  };
}

/**
 * Default form values - empty package set name with one empty package row
 */
function getDefaultFormData(): CreatePackageSetFormData {
  return {
    name: '',
    packages: [createEmptyPackageRow()],
  };
}

/**
 * Get form data from initial data (for clone mode).
 * Sorts packages by sort_order and assigns tempIds.
 */
function getFormDataFromInitialData(initialData: CloneInitialData): CreatePackageSetFormData {
  // Sort packages by sort_order with stable fallback for undefined values
  const sortedPackages = [...initialData.packages].sort((a, b) => {
    const orderA = a.sort_order ?? Infinity;
    const orderB = b.sort_order ?? Infinity;
    return orderA - orderB;
  });

  return {
    name: initialData.name,
    packages: sortedPackages.map((pkg) => ({
      tempId: generateTempId(),
      name: pkg.name,
      purpose: pkg.purpose ?? '',
    })),
  };
}

// ============================================================================
// Component Implementation
// ============================================================================

/**
 * CreatePackageSetModal Component
 *
 * Modal for creating new Package Set entities or cloning existing ones.
 * Supports two modes via the `mode` prop:
 * - 'create' (default): Empty form for new Package Set
 * - 'clone': Pre-populated form for cloning with initialData
 */
export function CreatePackageSetModal({
  isOpen,
  onClose,
  onSubmit,
  mode = 'create',
  initialData,
  existingPackageSetNames = [],
}: CreatePackageSetModalProps) {
  // ============================================================================
  // Form State Management (Task Group 3)
  // ============================================================================

  const [formData, setFormData] = useState<CreatePackageSetFormData>(getDefaultFormData);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ============================================================================
  // Derive effective mode and title/button text
  // ============================================================================

  const effectiveMode = mode ?? 'create';
  const isCloneMode = effectiveMode === 'clone';

  const modalTitle = isCloneMode ? 'Clone Package Set' : 'Create Package Set';
  const submitButtonText = isSubmitting
    ? (isCloneMode ? 'Cloning...' : 'Creating...')
    : (isCloneMode ? 'Clone' : 'Create');

  // ============================================================================
  // Form Reset on Open (Task Group 3.5 + Clone Mode Support)
  // ============================================================================

  /**
   * Reset form when modal opens.
   * In clone mode, pre-populate from initialData.
   * In create mode, reset to default empty values.
   */
  useEffect(() => {
    if (isOpen) {
      if (isCloneMode && initialData) {
        setFormData(getFormDataFromInitialData(initialData));
      } else {
        setFormData(getDefaultFormData());
      }
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen, isCloneMode, initialData]);

  // ============================================================================
  // Package Set Name Change Handler (Task Group 3.4)
  // ============================================================================

  /**
   * Handle package set name changes.
   * Clears name error when field is modified.
   */
  const handleNameChange = useCallback((value: string) => {
    setFormData((prev) => ({ ...prev, name: value }));
    // Clear error when field is modified
    setErrors((prev) => {
      if (prev.name) {
        const { name: _, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  }, []);

  // ============================================================================
  // Package Row Change Handlers (Task Group 4.6)
  // ============================================================================

  /**
   * Handle package name changes for a specific row.
   * Clears row-level validation error on modification.
   */
  const handlePackageNameChange = useCallback((tempId: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      packages: prev.packages.map((pkg) =>
        pkg.tempId === tempId ? { ...pkg, name: value } : pkg
      ),
    }));
    // Clear row-level error when field is modified
    setErrors((prev) => {
      if (prev.packageNames?.[tempId]) {
        const updatedPackageNames = { ...prev.packageNames };
        delete updatedPackageNames[tempId];
        return {
          ...prev,
          packageNames: Object.keys(updatedPackageNames).length > 0 ? updatedPackageNames : undefined,
        };
      }
      return prev;
    });
  }, []);

  /**
   * Handle package purpose changes for a specific row.
   */
  const handlePackagePurposeChange = useCallback((tempId: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      packages: prev.packages.map((pkg) =>
        pkg.tempId === tempId ? { ...pkg, purpose: value } : pkg
      ),
    }));
  }, []);

  // ============================================================================
  // Add Package Functionality (Task Group 4.4)
  // ============================================================================

  /**
   * Add a new empty package row to the table.
   */
  const handleAddPackage = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      packages: [...prev.packages, createEmptyPackageRow()],
    }));
  }, []);

  // ============================================================================
  // Remove Package Functionality (Task Group 4.5)
  // ============================================================================

  /**
   * Remove a package row from the table.
   * Prevents removal of the last remaining row.
   */
  const handleRemovePackage = useCallback((tempId: string) => {
    setFormData((prev) => {
      // Prevent removal of last row
      if (prev.packages.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        packages: prev.packages.filter((pkg) => pkg.tempId !== tempId),
      };
    });
  }, []);

  // ============================================================================
  // Package Row Reordering (Task Group 5)
  // ============================================================================

  /**
   * Move a package row up in the list.
   */
  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setFormData((prev) => {
      const packages = [...prev.packages];
      [packages[index - 1], packages[index]] = [packages[index], packages[index - 1]];
      return { ...prev, packages };
    });
  }, []);

  /**
   * Move a package row down in the list.
   */
  const handleMoveDown = useCallback((index: number) => {
    setFormData((prev) => {
      if (index >= prev.packages.length - 1) return prev;
      const packages = [...prev.packages];
      [packages[index], packages[index + 1]] = [packages[index + 1], packages[index]];
      return { ...prev, packages };
    });
  }, []);

  // ============================================================================
  // Name Uniqueness Check (Clone Package Set Modal Task 1.6)
  // ============================================================================

  /**
   * Check if the name already exists (case-insensitive, trimmed comparison).
   */
  const isNameDuplicate = useCallback((name: string): boolean => {
    const trimmedLowerName = name.trim().toLowerCase();
    return existingPackageSetNames.some(
      (existingName) => existingName.trim().toLowerCase() === trimmedLowerName
    );
  }, [existingPackageSetNames]);

  // ============================================================================
  // Form Validation (Task Group 6 + Name Uniqueness)
  // ============================================================================

  /**
   * Check if form is valid for enabling Create/Clone button.
   * - Package Set Name is non-empty (trimmed)
   * - Package Set Name is unique (case-insensitive)
   * - At least 1 package row exists
   * - All package names are non-empty (trimmed)
   */
  const isFormValid = useMemo(() => {
    // Check package set name
    if (!formData.name.trim()) {
      return false;
    }

    // Check name uniqueness
    if (isNameDuplicate(formData.name)) {
      return false;
    }

    // Check at least 1 package row exists
    if (formData.packages.length === 0) {
      return false;
    }

    // Check all package names are non-empty
    for (const pkg of formData.packages) {
      if (!pkg.name.trim()) {
        return false;
      }
    }

    return true;
  }, [formData.name, formData.packages, isNameDuplicate]);

  /**
   * Validate all fields and return validation errors.
   */
  const validateForm = useCallback((): ValidationErrors => {
    const newErrors: ValidationErrors = {};

    // Validate package set name (required)
    if (!formData.name.trim()) {
      newErrors.name = 'Package set name is required';
    }
    // Validate package set name uniqueness (only if name is not empty)
    else if (isNameDuplicate(formData.name)) {
      newErrors.name = 'A package set with this name already exists.';
    }

    // Validate package names
    const packageNameErrors: Record<string, string> = {};
    for (const pkg of formData.packages) {
      if (!pkg.name.trim()) {
        packageNameErrors[pkg.tempId] = 'Package name is required';
      }
    }
    if (Object.keys(packageNameErrors).length > 0) {
      newErrors.packageNames = packageNameErrors;
    }

    return newErrors;
  }, [formData, isNameDuplicate]);

  // ============================================================================
  // Submit Handler (Task Group 8)
  // ============================================================================

  /**
   * Handle form submission.
   * Creates PackageSet and Package entities with generated IDs.
   */
  const handleSubmit = useCallback(() => {
    // Validate all fields before proceeding
    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);

    // Generate Package Set ID using standard pattern
    const packageSetId = generateEntityId('package_sets');

    // Create PackageSet entity
    const packageSet: PackageSet = {
      id: packageSetId,
      name: formData.name.trim(),
    };

    // Create Package entities with generated IDs and sort_order
    const packages: Package[] = formData.packages.map((pkg, index) => ({
      id: generateEntityId('packages'),
      package_set_id: packageSetId,
      name: pkg.name.trim(),
      purpose: pkg.purpose.trim() || undefined,
      sort_order: index + 1, // Consecutive integers starting at 1
    }));

    // Call onSubmit callback with created entities
    onSubmit(packageSet, packages);

    setIsSubmitting(false);
    onClose();
  }, [formData, validateForm, onSubmit, onClose]);

  // ============================================================================
  // Cancel Handler
  // ============================================================================

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // ============================================================================
  // Overlay Click Handler
  // ============================================================================

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // ============================================================================
  // Keyboard Handler (Task Group 2.6)
  // ============================================================================

  /**
   * Handle keyboard events.
   * Escape: close modal
   * Ctrl+Enter: submit if valid
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && e.ctrlKey && isFormValid) {
        handleSubmit();
      }
    },
    [onClose, handleSubmit, isFormValid]
  );

  // ============================================================================
  // Render
  // ============================================================================

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      data-testid="create-package-set-modal"
    >
      <div className={`${styles.modal} ${isSubmitting ? styles.loading : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{modalTitle}</h2>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            title="Close"
            data-testid="modal-close-button"
          >
            &times;
          </button>
        </div>

        {/* Content - Form */}
        <div className={styles.content}>
          <div className={styles.form}>
            {/* Package Set Name (required) */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Name<span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                className={`${styles.textInput} ${errors.name ? styles.inputError : ''}`}
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Enter package set name"
                data-testid="field-package-set-name"
                autoFocus
              />
              {errors.name && (
                <span className={styles.errorMessage} data-testid="error-package-set-name">
                  {errors.name}
                </span>
              )}
            </div>

            {/* Packages Builder Table */}
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Packages</label>
              <div className={styles.packagesBuilder}>
                <table className={styles.packagesTable}>
                  <thead>
                    <tr>
                      <th className={styles.packageNameColumn}>Package Name<span className={styles.required}>*</span></th>
                      <th className={styles.purposeColumn}>Purpose</th>
                      <th className={styles.actionsColumn}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.packages.map((pkg, index) => (
                      <tr key={pkg.tempId} data-testid={`package-row-${index}`}>
                        <td className={styles.packageNameColumn}>
                          <input
                            type="text"
                            className={`${styles.tableInput} ${errors.packageNames?.[pkg.tempId] ? styles.inputError : ''}`}
                            value={pkg.name}
                            onChange={(e) => handlePackageNameChange(pkg.tempId, e.target.value)}
                            placeholder="Enter package name"
                            data-testid={`field-package-name-${index}`}
                          />
                          {errors.packageNames?.[pkg.tempId] && (
                            <span className={styles.errorMessage} data-testid={`error-package-name-${index}`}>
                              {errors.packageNames[pkg.tempId]}
                            </span>
                          )}
                        </td>
                        <td className={styles.purposeColumn}>
                          <input
                            type="text"
                            className={styles.tableInput}
                            value={pkg.purpose}
                            onChange={(e) => handlePackagePurposeChange(pkg.tempId, e.target.value)}
                            placeholder="Enter purpose"
                            data-testid={`field-package-purpose-${index}`}
                          />
                        </td>
                        <td className={styles.actionsColumn}>
                          <div className={styles.actionButtons}>
                            {/* Reorder buttons */}
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => handleMoveUp(index)}
                              disabled={index === 0}
                              title="Move up"
                              data-testid={`btn-move-up-${index}`}
                            >
                              &#9650;
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => handleMoveDown(index)}
                              disabled={index === formData.packages.length - 1}
                              title="Move down"
                              data-testid={`btn-move-down-${index}`}
                            >
                              &#9660;
                            </button>
                            {/* Remove button */}
                            <button
                              type="button"
                              className={`${styles.actionButton} ${styles.removeButton}`}
                              onClick={() => handleRemovePackage(pkg.tempId)}
                              disabled={formData.packages.length <= 1}
                              title="Remove package"
                              data-testid={`btn-remove-${index}`}
                            >
                              &#128465;
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className={styles.addPackageButton}
                  onClick={handleAddPackage}
                  data-testid="btn-add-package"
                >
                  + Add Package
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Action Buttons */}
        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={handleCancel}
            disabled={isSubmitting}
            data-testid="modal-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSubmit}
            disabled={isSubmitting || !isFormValid}
            data-testid="modal-submit-button"
          >
            {submitButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreatePackageSetModal;
