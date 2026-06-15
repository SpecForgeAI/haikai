/**
 * Package Set Standards Import Types
 *
 * Spec: Package Set Standards Import (Iteration 6)
 *
 * Types for the frontend Package Set Standards Import feature, including:
 * - API response types for import operations
 * - Import status tracking
 * - Default rule matching
 */

// ============================================================================
// Package Set Default Rule
// ============================================================================

/**
 * PackageSetDefaultRule - represents a rule for auto-resolving "Default (Auto)" package set selections.
 *
 * Rules are evaluated against Service.core_tech and Service.service_type fields.
 * First matching rule (by priority, descending) determines the default PackageSet for a Service.
 */
export interface PackageSetDefaultRule {
  /** Unique identifier for the rule */
  id: string;
  /** Source of the import: "COMPANY" or "PROJECT" */
  standard_source: 'COMPANY' | 'PROJECT';
  /** ID of the PackageSet this rule resolves to */
  package_set_id: string;
  /**
   * List of keywords to match against Service.core_tech (case-insensitive).
   * All keywords must be present for a match.
   * Example: ["java", "spring"] matches "Java, Spring Boot, PostgreSQL"
   */
  core_tech_includes: string[];
  /**
   * List of keywords to match against Service.service_type (case-insensitive).
   * All keywords must be present for a match.
   * Example: ["api"] matches "REST API"
   */
  service_type_includes: string[];
  /**
   * Priority for rule evaluation (higher = checked first).
   * Default is 0.
   */
  priority: number;
}

// ============================================================================
// Package Set Standards Import Result
// ============================================================================

/**
 * PackageSetStandardsImportResult - response from the import operation.
 *
 * Contains the import status and optionally any warnings encountered.
 */
export interface PackageSetStandardsImportResult {
  /** Whether the import was successful */
  success: boolean;
  /** Human-readable message describing the result */
  message: string;
  /** Timestamp when the import was performed */
  imported_at: string;
  /** Whether the company-level standards file was found */
  company_file_found: boolean;
  /** Whether the project-level standards file was found */
  project_file_found: boolean;
  /** Revision/version of the company standards file */
  company_revision: string | null;
  /** Revision/version of the project standards file */
  project_revision: string | null;
  /** Number of PackageSets inserted */
  inserted_sets: number;
  /** Number of PackageSets updated */
  updated_sets: number;
  /** Number of Packages inserted */
  inserted_packages: number;
  /** Number of Packages updated */
  updated_packages: number;
  /** Number of DefaultRules inserted */
  inserted_rules: number;
  /** Number of DefaultRules updated */
  updated_rules: number;
  /** List of warnings encountered during import */
  warnings: string[];
}

// ============================================================================
// Package Set Standards Import Status
// ============================================================================

/**
 * PackageSetStandardsImportStatus - tracks import history and counts for audit and display.
 */
export interface PackageSetStandardsImportStatus {
  /** Unique identifier for the import status record */
  id: string;
  /** Timestamp when the import was performed */
  imported_at: string;
  /** Path to the company-level standards file */
  company_file_path: string | null;
  /** Path to the project-level standards file */
  project_file_path: string | null;
  /** Revision/version of the company standards file */
  company_revision: string | null;
  /** Revision/version of the project standards file */
  project_revision: string | null;
  /** Number of PackageSets inserted */
  inserted_sets: number;
  /** Number of PackageSets updated */
  updated_sets: number;
  /** Number of Packages inserted */
  inserted_packages: number;
  /** Number of Packages updated */
  updated_packages: number;
  /** Number of DefaultRules inserted */
  inserted_rules: number;
  /** Number of DefaultRules updated */
  updated_rules: number;
}

// ============================================================================
// Default Package Set Resolution
// ============================================================================

/**
 * Resolves the default PackageSet ID for a Service based on matching rules.
 *
 * Algorithm:
 * 1. Rules are already sorted by priority descending
 * 2. For each rule, check if ALL core_tech_includes keywords are present in service.core_tech
 * 3. For each rule, check if ALL service_type_includes keywords are present in service.service_type
 * 4. First matching rule wins - return its package_set_id
 * 5. If no rule matches, return null
 *
 * @param service - The Service entity to resolve for
 * @param rules - Array of PackageSetDefaultRule (sorted by priority descending)
 * @returns The resolved PackageSet ID, or null if no matching rule found
 */
export function resolveDefaultPackageSetId(
  service: { core_tech?: string; service_type?: string },
  rules: PackageSetDefaultRule[]
): string | null {
  // Normalize service fields for case-insensitive matching
  const coreTechLower = (service.core_tech || '').toLowerCase();
  const serviceTypeLower = (service.service_type || '').toLowerCase();

  // Rules are already sorted by priority descending
  for (const rule of rules) {
    // Check core_tech_includes - ALL keywords must be present
    const coreTechMatch = rule.core_tech_includes.every((keyword) =>
      coreTechLower.includes(keyword.toLowerCase())
    );

    // Check service_type_includes - ALL keywords must be present
    const serviceTypeMatch = rule.service_type_includes.every((keyword) =>
      serviceTypeLower.includes(keyword.toLowerCase())
    );

    // Rule matches if both conditions are satisfied
    // Empty arrays are treated as "always match" for that condition
    if (coreTechMatch && serviceTypeMatch) {
      return rule.package_set_id;
    }
  }

  // No matching rule found
  return null;
}

/**
 * Formats the import timestamp for display.
 *
 * @param isoString - ISO 8601 timestamp string
 * @returns Formatted date string (e.g., "Jan 6, 2026 at 10:30 AM")
 */
export function formatImportTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}
