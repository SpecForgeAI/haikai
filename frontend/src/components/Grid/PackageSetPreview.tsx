/**
 * PackageSetPreview Component
 * Spec: Service Package Set Assignment Dropdown - Task Group 2 (Optional)
 *
 * Shows a compact read-only preview of packages when a concrete Package Set is selected.
 * The preview is hidden when "Default (Auto)" is selected (package_set_id is null).
 */

import { useMemo } from 'react';
import { PackageSet, Package } from '../../types/model';
import styles from './PackageSetPreview.module.css';

export interface PackageSetPreviewProps {
  /** The currently selected package_set_id (null for "Default (Auto)") */
  packageSetId: string | null | undefined;
  /** Available Package Sets from the model */
  packageSets: PackageSet[];
  /** Available Packages from the model */
  packages: Package[];
}

/**
 * PackageSetPreview - displays a compact preview of packages in a Package Set.
 *
 * Features:
 * - Shows package name and purpose for each package in the set
 * - Orders packages by sort_order ascending
 * - Hidden when no concrete Package Set is selected
 */
export function PackageSetPreview({
  packageSetId,
  packageSets,
  packages,
}: PackageSetPreviewProps) {
  // Get the selected Package Set
  const selectedPackageSet = useMemo(() => {
    if (!packageSetId) return null;
    return packageSets.find((ps) => ps.id === packageSetId) || null;
  }, [packageSetId, packageSets]);

  // Get packages for the selected Package Set, sorted by sort_order
  const previewPackages = useMemo(() => {
    if (!packageSetId) return [];

    const filtered = packages.filter((p) => p.package_set_id === packageSetId);

    // Sort by sort_order ascending (undefined values go to the end)
    return [...filtered].sort((a, b) => {
      const orderA = a.sort_order ?? Infinity;
      const orderB = b.sort_order ?? Infinity;
      return orderA - orderB;
    });
  }, [packageSetId, packages]);

  // Don't render if no concrete Package Set is selected
  if (!packageSetId || !selectedPackageSet) {
    return null;
  }

  return (
    <div className={styles.previewContainer} data-testid="package-set-preview">
      <div className={styles.previewHeader}>
        Packages in "{selectedPackageSet.name}"
      </div>
      {previewPackages.length === 0 ? (
        <div className={styles.emptyState}>No packages defined</div>
      ) : (
        <ul className={styles.packageList}>
          {previewPackages.map((pkg) => (
            <li key={pkg.id} className={styles.packageItem} data-testid={`preview-package-${pkg.id}`}>
              <span className={styles.packageName}>{pkg.name}</span>
              {pkg.purpose && (
                <span className={styles.packagePurpose} title={pkg.purpose}>
                  - {pkg.purpose}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PackageSetPreview;
