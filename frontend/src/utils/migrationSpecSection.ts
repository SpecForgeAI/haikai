/**
 * migrationSpecSection
 *
 * Spec: 2026-06-14 Implementation-Ready Migration Spec Generation (Spec 1 of 4),
 * Task Group 4 (D3 / D7).
 *
 * Read-only derivation of the scope-in / scope-out / acceptance-criteria tiles
 * shown on the migration-story review surfaces (`StoryResultDrawer` +
 * `ImplementTabShapeSpecCard`).
 *
 * Scope-in/out and acceptance criteria are NOT persisted as discrete columns on
 * the AMS `migration_story_spec_generations` row -- they live inline in the
 * canonical combined `generated_spec_text` body (D3). The gateway already
 * parses them out of that body server-side (`migrationImplementReadyState.ts`
 * `extractSpecSection`) when it writes `implement-state.json`. This frontend
 * reader mirrors that parser so the read-only tiles surface the same content
 * without a second fetch.
 *
 * Per D7 the tiles are READ-ONLY and MAY drift from the combined spec text once
 * the user has manually edited it (accepted v1): they are a best-effort,
 * heading-keyed view of whatever the combined text currently contains.
 */

/**
 * Pull a `Heading:` ... block out of the spec body. Returns the lines that
 * follow the heading until the next blank line / next heading, stripped of any
 * leading `- ` / `* ` / `1. ` bullet markers. Best-effort: returns [] when the
 * heading is absent. Case-insensitive heading match.
 *
 * Mirrors the gateway's `extractSpecSection` (same heading-match regex + bullet
 * stripping) so the tiles agree with the server-derived PlannerResponse the
 * implement screen hydrates from.
 */
export function extractSpecSection(
  specText: string | null | undefined,
  headingAliases: readonly string[],
): string[] {
  if (typeof specText !== 'string' || specText.length === 0) return [];
  const lines = specText.split(/\r?\n/);
  const aliasSet = headingAliases.map((h) => h.toLowerCase());
  const out: string[] = [];
  let capturing = false;
  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(/^#{0,6}\s*([A-Za-z][^:]*):\s*(.*)$/);
    if (headingMatch) {
      const headingName = headingMatch[1].trim().toLowerCase();
      if (aliasSet.includes(headingName)) {
        capturing = true;
        // Inline content on the heading line itself (e.g. "Scope out: none").
        const inline = headingMatch[2].trim();
        if (inline.length > 0) out.push(inline);
        continue;
      }
      if (capturing) {
        // A different heading ends the captured section.
        break;
      }
    }
    if (capturing) {
      if (line.length === 0) {
        // Blank line ends the section.
        break;
      }
      const item = line
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .trim();
      if (item.length > 0) out.push(item);
    }
  }
  return out;
}

/** Heading aliases the gateway emits for each derived section. */
export const SCOPE_IN_ALIASES = [
  'scope in',
  'scope-in',
  'in scope',
  'in-scope',
] as const;

export const SCOPE_OUT_ALIASES = [
  'scope out',
  'scope-out',
  'out of scope',
  'out-of-scope',
] as const;

export const ACCEPTANCE_CRITERIA_ALIASES = [
  'acceptance criteria',
  'acceptance criterion',
] as const;

/**
 * A single structured test as surfaced on the spec-generation row (the
 * `structured_tests_json` JSONB column). Aligns 1:1 with the gateway's
 * `StructuredTest` and the Test Engineer `TestDefinition` (`unit | functional`).
 * Fields are read defensively (the JSONB blob is untyped on the wire).
 */
export interface StructuredTestTile {
  title: string;
  description: string;
  type: 'unit' | 'functional' | string;
}

/**
 * Normalise a raw `structuredTestsJson` blob into renderable tiles. Tolerant of
 * missing fields so a partially-shaped row never throws in the drawer; entries
 * with neither a title nor description are dropped.
 */
export function toStructuredTestTiles(
  raw: Array<Record<string, unknown>> | null | undefined,
): StructuredTestTile[] {
  if (!Array.isArray(raw)) return [];
  const out: StructuredTestTile[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const title = typeof entry.title === 'string' ? entry.title : '';
    const description =
      typeof entry.description === 'string' ? entry.description : '';
    const type = typeof entry.type === 'string' ? entry.type : '';
    if (title.length === 0 && description.length === 0) continue;
    out.push({ title, description, type });
  }
  return out;
}

/** Human label for a structured-test `type`. */
export function testTypeLabel(type: string): string {
  switch (type) {
    case 'unit':
      return 'Unit';
    case 'functional':
      return 'Functional';
    default:
      return type || 'Test';
  }
}
