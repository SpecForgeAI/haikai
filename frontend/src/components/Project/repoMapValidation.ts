/**
 * Repo-map client-side validation helpers.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 3.
 *
 * Pure functions shared by the Create/Edit project modal's Poly repo table
 * and the post-init RepoMapEditor (add / re-point operations). Mirrors the
 * gateway-side rules in `gateway/src/routes/implementationProjects.ts`
 * (which in turn mirror the external contract: folders AND URLs must be
 * unique map-wide; folder names follow the agreed slug rule).
 */

import { normalizeIdentifier } from '../../utils/normalizeIdentifier';

/**
 * Folder-name rule (agreed in requirements Q5): lowercase alphanumeric
 * start, then lowercase alphanumerics / dot / underscore / hyphen.
 */
export const FOLDER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Human-readable description of the folder rule for inline errors. */
export const FOLDER_NAME_RULE_MESSAGE =
  "Use lowercase letters, digits, '.', '_' or '-'; must start with a letter or digit";

/** One row of the Poly repo table. */
export interface RepoRow {
  folder: string;
  url: string;
}

/** Per-row inline validation errors (absent key = field is valid). */
export interface RepoRowErrors {
  folder?: string;
  url?: string;
}

/**
 * Validates the Poly repo table rows: folder slug rule, non-empty URL per
 * row, and uniqueness on BOTH columns (no duplicate folders, no duplicate
 * URLs). Returns one error object per row (aligned by index) plus an
 * overall validity flag.
 */
export function validateRepoRows(rows: RepoRow[]): {
  rowErrors: RepoRowErrors[];
  valid: boolean;
} {
  const folderCounts = new Map<string, number>();
  const urlCounts = new Map<string, number>();
  for (const row of rows) {
    const folder = row.folder.trim();
    const url = row.url.trim();
    if (folder) folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
    if (url) urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1);
  }

  const rowErrors = rows.map((row) => {
    const folder = row.folder.trim();
    const url = row.url.trim();
    const errors: RepoRowErrors = {};
    if (!folder) {
      errors.folder = 'Folder name is required';
    } else if (!FOLDER_NAME_PATTERN.test(folder)) {
      errors.folder = FOLDER_NAME_RULE_MESSAGE;
    } else if ((folderCounts.get(folder) ?? 0) > 1) {
      errors.folder = 'Duplicate folder name';
    }
    if (!url) {
      errors.url = 'Repo URL is required';
    } else if ((urlCounts.get(url) ?? 0) > 1) {
      errors.url = 'Duplicate repo URL';
    }
    return errors;
  });

  const valid =
    rows.length > 0 &&
    rowErrors.every((e) => e.folder === undefined && e.url === undefined);
  return { rowErrors, valid };
}

/**
 * Derives the single-mode folder key from the product name, consistent with
 * the external contract's `repo_url` promotion convention (a one-entry map
 * keyed by the project name). Normalises via `normalizeIdentifier`, then
 * strips any characters outside the folder charset and any leading
 * non-alphanumerics so the result always satisfies FOLDER_NAME_PATTERN.
 * Falls back to 'repo' if nothing survives.
 */
export function deriveSingleRepoFolder(productName: string): string {
  const slug = normalizeIdentifier(productName)
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[^a-z0-9]+/, '');
  return slug || 'repo';
}
