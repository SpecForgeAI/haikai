/**
 * PackageSetsView Component
 *
 * A master-detail view for Package Sets and their Packages.
 * - Master grid: List of package sets with Name, Package Count, and Actions columns
 * - Detail panel: List of packages for the selected package set
 * - "Create Package Set" button to open creation modal
 * - "Clone" action button in each row to clone existing Package Sets
 * - "Import Package Set Standards" button to import from JSON files (Iteration 6)
 *
 * Spec: 2026-01-06-package-sets-screen
 * Spec: 2026-01-06-create-package-set-modal (Task Group 9)
 * Spec: 2026-01-06-clone-package-set-modal (Task Group 2)
 * Spec: 2026-01-06-package-set-standards-import (Task Group 5)
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useArchitecture, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { PackageSet, Package } from '../../types/model';
import { CreatePackageSetModal, CloneInitialData } from './CreatePackageSetModal';
import {
  importPackageSetStandards,
  getPackageSetStandardsImportStatus,
} from '../../utils/packageSetStandardsApi';
import {
  PackageSetStandardsImportResult,
  PackageSetStandardsImportStatus,
  formatImportTimestamp,
} from '../../types/packageSetStandards';
import styles from './PackageSetsView.module.css';

/**
 * PackageSetsView - View for Package Sets and their Packages
 *
 * Layout:
 * - Left panel: Package Sets master grid with Name, Package Count, and Actions columns
 * - Right panel: Packages detail table showing packages for selected package set
 *
 * Task Group 9: Integration with CreatePackageSetModal
 * - "Create Package Set" button in header opens modal
 * - On submit, dispatches ADD_ENTITY for package_sets and packages
 * - Auto-selects newly created Package Set
 *
 * Clone Package Set Modal Task Group 2: Clone Entry Point
 * - Clone button in each row opens modal in clone mode
 * - Pre-populates modal with source Package Set data
 * - Auto-selects newly cloned Package Set
 *
 * Package Set Standards Import Task Group 5: Import UI
 * - "Import Standards" button in header triggers import API call
 * - Displays import status (timestamp and counts) after import
 * - Refreshes model to show imported package sets
 */
export const PackageSetsView: React.FC = () => {
  const { model, refreshModel } = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const [selectedPackageSetId, setSelectedPackageSetId] = useState<string | null>(null);

  // Task Group 9.2: Create modal state management
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Clone Package Set Modal Task Group 2.3: Clone modal state management
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloneSourcePackageSetId, setCloneSourcePackageSetId] = useState<string | null>(null);

  // Package Set Standards Import Task Group 5.4: Import state management
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<PackageSetStandardsImportStatus | null>(null);
  const [importResult, setImportResult] = useState<PackageSetStandardsImportResult | null>(null);

  // Get package_sets and packages from meta-model entities
  const packageSets: PackageSet[] = model?.metaModel?.entities?.package_sets ?? [];
  const packages: Package[] = model?.metaModel?.entities?.packages ?? [];

  // Get existing package set names for uniqueness validation
  const existingPackageSetNames = useMemo(() => {
    return packageSets.map((set) => set.name);
  }, [packageSets]);

  // Compute package count for each package set using useMemo
  const packageSetWithCounts = useMemo(() => {
    return packageSets.map((set) => ({
      ...set,
      packageCount: packages.filter((p) => p.package_set_id === set.id).length,
    }));
  }, [packageSets, packages]);

  // Get packages for selected package set, sorted by sort_order
  const selectedPackages = useMemo(() => {
    if (!selectedPackageSetId) return [];

    const filtered = packages.filter((p) => p.package_set_id === selectedPackageSetId);

    // Sort by sort_order (or stable index fallback for undefined sort_order)
    return [...filtered].sort((a, b) => {
      const orderA = a.sort_order ?? Infinity;
      const orderB = b.sort_order ?? Infinity;
      return orderA - orderB;
    });
  }, [selectedPackageSetId, packages]);

  // Get selected package set name for detail panel header
  const selectedPackageSet = useMemo(() => {
    return packageSets.find((set) => set.id === selectedPackageSetId);
  }, [selectedPackageSetId, packageSets]);

  // Clone Package Set Modal Task Group 2.4: Prepare clone initial data
  const cloneInitialData: CloneInitialData | undefined = useMemo(() => {
    if (!cloneSourcePackageSetId) return undefined;

    const sourcePackageSet = packageSets.find((set) => set.id === cloneSourcePackageSetId);
    if (!sourcePackageSet) return undefined;

    // Get packages for the source Package Set
    const sourcePackages = packages.filter((p) => p.package_set_id === cloneSourcePackageSetId);

    // Sort packages by sort_order with stable fallback
    const sortedPackages = [...sourcePackages].sort((a, b) => {
      const orderA = a.sort_order ?? Infinity;
      const orderB = b.sort_order ?? Infinity;
      return orderA - orderB;
    });

    return {
      name: `${sourcePackageSet.name} (copy)`,
      packages: sortedPackages.map((pkg) => ({
        name: pkg.name,
        purpose: pkg.purpose,
        sort_order: pkg.sort_order,
      })),
    };
  }, [cloneSourcePackageSetId, packageSets, packages]);

  // Package Set Standards Import Task Group 5.5: Load import status on mount
  useEffect(() => {
    const loadImportStatus = async () => {
      try {
        const status = await getPackageSetStandardsImportStatus();
        setImportStatus(status);
      } catch (error) {
        // Silently handle error - status is optional display information
        console.debug('Could not load import status:', error);
      }
    };

    loadImportStatus();
  }, []);

  // Handle row click for package set selection
  const handleRowClick = (packageSetId: string) => {
    setSelectedPackageSetId(packageSetId);
  };

  // Task Group 9.3: Open create modal handler
  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true);
  }, []);

  // Task Group 9.4: Close create modal handler
  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  // Clone Package Set Modal Task Group 2.3: Open clone modal handler
  const handleOpenCloneModal = useCallback((packageSetId: string, event: React.MouseEvent) => {
    // Prevent row selection when clicking Clone button
    event.stopPropagation();
    setCloneSourcePackageSetId(packageSetId);
    setIsCloneModalOpen(true);
  }, []);

  // Clone Package Set Modal Task Group 2.3: Close clone modal handler
  const handleCloseCloneModal = useCallback(() => {
    setIsCloneModalOpen(false);
    setCloneSourcePackageSetId(null);
  }, []);

  // Task Group 9.5: Submit handler - dispatch ADD_ENTITY for package_sets and packages
  // Used for both Create and Clone operations
  const handleSubmit = useCallback((packageSet: PackageSet, newPackages: Package[]) => {
    // Dispatch ADD_ENTITY for the package set
    dispatch({
      type: 'ADD_ENTITY',
      entityType: 'package_sets',
      entity: packageSet,
    });

    // Dispatch ADD_ENTITY for each package
    for (const pkg of newPackages) {
      dispatch({
        type: 'ADD_ENTITY',
        entityType: 'packages',
        entity: pkg,
      });
    }

    // Auto-select the newly created/cloned Package Set
    setSelectedPackageSetId(packageSet.id);
  }, [dispatch]);

  // Package Set Standards Import Task Group 5.4: Import handler
  const handleImport = useCallback(async () => {
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const result = await importPackageSetStandards();
      setImportResult(result);

      if (result.success) {
        // Refresh model to show imported package sets
        if (refreshModel) {
          await refreshModel();
        }

        // Update import status display
        const status = await getPackageSetStandardsImportStatus();
        setImportStatus(status);
      } else {
        setImportError(result.message);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      setImportError(errorMessage);
    } finally {
      setIsImporting(false);
    }
  }, [refreshModel]);

  // Render empty state for package sets
  const renderMasterEmptyState = () => (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>&#128230;</div>
      <div className={styles.emptyStateText}>No package sets available yet.</div>
    </div>
  );

  // Render empty state for packages
  const renderDetailEmptyState = () => (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>&#128221;</div>
      <div className={styles.emptyStateText}>No packages defined for this package set.</div>
    </div>
  );

  // Render no selection state for detail panel
  const renderNoSelectionState = () => (
    <div className={styles.noSelectionState}>
      <div className={styles.noSelectionText}>Select a package set to view its packages.</div>
    </div>
  );

  // Package Set Standards Import Task Group 5.5: Render import status display
  const renderImportStatus = () => {
    // Show import result if just completed
    if (importResult) {
      return (
        <div className={styles.importStatus} data-testid="import-status">
          {importResult.success ? (
            <span className={styles.importStatusSuccess}>
              Imported: {importResult.inserted_sets} new, {importResult.updated_sets} updated sets |{' '}
              {importResult.inserted_packages} new, {importResult.updated_packages} updated packages |{' '}
              {importResult.inserted_rules} new, {importResult.updated_rules} updated rules
            </span>
          ) : (
            <span className={styles.importStatusError}>{importResult.message}</span>
          )}
        </div>
      );
    }

    // Show last import status if available
    if (importStatus) {
      return (
        <div className={styles.importStatus} data-testid="import-status">
          <span className={styles.importStatusInfo}>
            Last import: {formatImportTimestamp(importStatus.imported_at)}
          </span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={styles.container}>
      {/* Package Set Standards Import Task Group 5.5: Import status display */}
      {renderImportStatus()}

      {/* Import error display */}
      {importError && (
        <div className={styles.importError} data-testid="import-error">
          <strong>Import Error:</strong> {importError}
        </div>
      )}

      <div className={styles.masterDetailContainer}>
        {/* Master Panel - Package Sets Grid */}
        <div className={styles.masterPanel}>
          {/* Task Group 9.3: Header with title and buttons */}
          <div className={styles.masterHeader}>
            <span className={styles.masterHeaderTitle}>Package Sets</span>
            <div className={styles.headerButtons}>
              {/* Package Set Standards Import Task Group 5.4: Import button */}
              <button
                className={styles.importButton}
                onClick={handleImport}
                disabled={isImporting}
                data-testid="btn-import-standards"
                title="Import package set standards from company and project JSON files"
              >
                {isImporting ? 'Importing...' : 'Import Standards'}
              </button>
              <button
                className={styles.createButton}
                onClick={handleOpenCreateModal}
                data-testid="btn-create-package-set"
              >
                Create Package Set
              </button>
            </div>
          </div>
          <div className={styles.masterContent}>
            {packageSetWithCounts.length === 0 ? (
              renderMasterEmptyState()
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.nameColumn}>Name</th>
                    <th className={`${styles.countColumn} ${styles.countColumnHeader}`}>
                      Package Count
                    </th>
                    {/* Clone Package Set Modal Task Group 2.2: Actions column header */}
                    <th className={`${styles.actionsColumn} ${styles.actionsColumnHeader}`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {packageSetWithCounts.map((set) => (
                    <tr
                      key={set.id}
                      className={selectedPackageSetId === set.id ? styles.selected : ''}
                      onClick={() => handleRowClick(set.id)}
                      data-testid={`package-set-row-${set.id}`}
                    >
                      <td className={styles.nameColumn}>
                        {set.name}
                        {set.standard_source && (
                          <span className={styles.standardSourceBadge} title={`Source: ${set.standard_source}`}>
                            {set.standard_source}
                          </span>
                        )}
                      </td>
                      <td className={styles.countColumn}>{set.packageCount}</td>
                      {/* Clone Package Set Modal Task Group 2.2: Clone action button */}
                      <td className={styles.actionsColumn}>
                        <button
                          className={styles.cloneButton}
                          onClick={(e) => handleOpenCloneModal(set.id, e)}
                          title="Clone Package Set"
                          data-testid={`btn-clone-${set.id}`}
                        >
                          {/* Clone/copy icon - clipboard with document */}
                          &#128203;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Detail Panel - Packages Table */}
        <div className={styles.detailPanel}>
          <div className={styles.detailHeader}>
            <h3 className={styles.detailTitle}>
              {selectedPackageSet ? selectedPackageSet.name : 'Packages'}
            </h3>
            {selectedPackageSet && (
              <div className={styles.detailSubtitle}>
                {selectedPackages.length} package{selectedPackages.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <div className={styles.detailContent}>
            {!selectedPackageSetId ? (
              renderNoSelectionState()
            ) : selectedPackages.length === 0 ? (
              renderDetailEmptyState()
            ) : (
              <table className={styles.packagesTable}>
                <thead>
                  <tr>
                    <th className={styles.nameColumn}>Name</th>
                    <th>Purpose</th>
                    <th className={`${styles.orderColumn} ${styles.orderColumnHeader}`}>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPackages.map((pkg, index) => (
                    <tr key={pkg.id} data-testid={`package-row-${pkg.id}`}>
                      <td className={styles.nameColumn}>{pkg.name}</td>
                      <td className={styles.purposeColumn}>{pkg.purpose || '-'}</td>
                      <td className={styles.orderColumn}>
                        {pkg.sort_order !== undefined ? pkg.sort_order : index + 1}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Task Group 9.4: Render CreatePackageSetModal for Create mode */}
      <CreatePackageSetModal
        isOpen={isCreateModalOpen}
        onClose={handleCloseCreateModal}
        onSubmit={handleSubmit}
        mode="create"
        existingPackageSetNames={existingPackageSetNames}
      />

      {/* Clone Package Set Modal Task Group 2.5: Render CreatePackageSetModal for Clone mode */}
      <CreatePackageSetModal
        isOpen={isCloneModalOpen}
        onClose={handleCloseCloneModal}
        onSubmit={handleSubmit}
        mode="clone"
        initialData={cloneInitialData}
        existingPackageSetNames={existingPackageSetNames}
      />
    </div>
  );
};

export default PackageSetsView;
