/**
 * Pure helper for the Create Product modal's "Product Hierarchy" autocomplete.
 *
 * Spec 2026-06-06: the field suggests the distinct, non-empty Product Hierarchy
 * values of EXISTING products in the SELECTED organisation ONLY. The
 * organisation is identified by an exact name match against the loaded
 * organisations (the same match the create handler uses); before an organisation
 * is identified there are no suggestions. The field stays free-text — these
 * SUGGEST existing values, they do not restrict to them.
 *
 * Extracted as a pure function so the derivation is unit-testable without
 * rendering the modal.
 */
import type { ProjectDto } from '../../api/projectsApi';
import type { OrganisationDto } from '../../api/organisationsApi';

/**
 * Returns the distinct, non-empty `projectHierarchy` values of the products
 * belonging to the organisation whose name exactly matches `organisationName`
 * (trimmed), sorted alphabetically. Returns `[]` when no organisation matches
 * (including a blank name) — i.e. there are no suggestions until an organisation
 * is identified.
 */
export function deriveHierarchySuggestions(
  projects: readonly ProjectDto[],
  organisations: readonly OrganisationDto[],
  organisationName: string,
): string[] {
  const organisationId =
    organisations.find((org) => org.name === organisationName.trim())?.id ?? null;
  if (!organisationId) {
    return [];
  }
  return Array.from(
    new Set(
      projects
        .filter((p) => p.organisationId === organisationId)
        .map((p) => p.projectHierarchy)
        .filter((h): h is string => h !== null && h.trim().length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
}
