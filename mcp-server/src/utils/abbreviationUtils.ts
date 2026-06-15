/**
 * Utility for generating unique abbreviations (typically initials) for
 * business_users and applications entities.
 *
 * Used as a server-side safety net before putModel() to ensure every
 * business_user and application has a non-empty, unique abbreviation.
 */

/**
 * Generates initials from a name by taking the first letter of each word.
 * e.g. "Market Data Manager" → "MDM", "Strategic Risk Store" → "SRS"
 */
export function generateInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('');
}

/**
 * Returns a unique abbreviation for the given name, given a set of
 * already-taken abbreviations (case-insensitive).
 *
 * Algorithm:
 * 1. Generate initials from the name
 * 2. If unique, return as-is
 * 3. Otherwise append incrementing number: "MDM2", "MDM3", etc.
 */
export function getUniqueAbbreviation(
  name: string,
  takenAbbreviations: Set<string>
): string {
  const base = generateInitials(name);
  if (!base) return '';

  const takenUpper = new Set([...takenAbbreviations].map(a => a.toUpperCase()));

  if (!takenUpper.has(base.toUpperCase())) {
    return base;
  }

  let counter = 2;
  while (takenUpper.has(`${base}${counter}`.toUpperCase())) {
    counter++;
  }
  return `${base}${counter}`;
}

/**
 * Pre-save hook: ensures every business_user and application entity in the
 * model has a non-empty, unique abbreviation. Mutates the model in place.
 *
 * Only fills in missing/empty abbreviations — existing ones are preserved
 * (even if they happen to collide; that's for the UI validation to flag).
 */
export function ensureAbbreviations(model: any): void {
  const entities = model?.metaModel?.entities;
  if (!entities) return;

  fillAbbreviations(entities.business_users);
  fillAbbreviations(entities.applications);
}

function fillAbbreviations(arr: any[] | undefined): void {
  if (!arr || arr.length === 0) return;

  // Collect all existing non-empty abbreviations
  const taken = new Set<string>();
  for (const entity of arr) {
    if (entity.abbreviation) {
      taken.add(entity.abbreviation);
    }
  }

  // Fill in missing abbreviations
  for (const entity of arr) {
    if (!entity.abbreviation && entity.name) {
      const abbrev = getUniqueAbbreviation(entity.name, taken);
      entity.abbreviation = abbrev;
      if (abbrev) taken.add(abbrev);
    }
  }
}
