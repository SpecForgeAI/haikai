/**
 * Deterministic heading parser for the migration shape-spec body.
 *
 * Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 5 (gateway-side companion to the canonical
 * AMS-side `ShapeSpecHeadingParser`).
 *
 * The canonical parser lives in AMS at write time (Task Group 2). This
 * gateway-side mirror exists to extract `decisions[]` / `interfaces[]` /
 * `assumptions[]` for the gateway's post-persist auto-seed of epic captured
 * decisions and for pass-2 contradiction detection -- both of which run in
 * the gateway and need the structured arrays. Re-deriving them locally is
 * acceptable because:
 *
 *   - The parser is deterministic; the AMS-side and gateway-side implementations
 *     will return the same arrays for the same input (the prompt's stable
 *     headings are the contract).
 *   - The AMS-side `MigrationStorySpecGenerationDto` does not currently surface
 *     decisions_json / interfaces_json / assumptions_json on the persist
 *     response wire; reading them gateway-side avoids an additional fetch round
 *     trip per story.
 *
 * Behaviour mirrors the AMS Java implementation:
 *   - Heading patterns are case-insensitive; both prose ("Decisions:") and
 *     markdown ATX ("## Decisions") headings are recognised.
 *   - A section ends at the next recognised heading boundary or at EOF.
 *   - Bullet markers (-, *, +) and numbered markers (1.) are stripped.
 *   - Missing headings emit a `parser_missing_heading` warning but never throw.
 *
 * Tests in `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts`
 * exercise this parser indirectly via the auto-seed and contradiction flows.
 */

export interface ShapeSpecHeadingParseResult {
  decisions: string[];
  interfaces: string[];
  assumptions: string[];
  warnings: Array<{ kind: string; section?: string; message?: string }>;
}

export const PARSER_WARNING_KIND_MISSING_HEADING = 'parser_missing_heading';
export const PARSER_WARNING_KIND_PARSE_ERROR = 'parser_error';

const DECISIONS_HEADING = /^\s*(?:#{1,6}\s+)?decisions\s*:?\s*$/i;
const INTERFACES_HEADING = /^\s*(?:#{1,6}\s+)?interfaces\s*:?\s*$/i;
const ASSUMPTIONS_HEADING = /^\s*(?:#{1,6}\s+)?assumptions\s*:?\s*$/i;

// Generic boundary: markdown ATX heading or "Word:" prose heading.
const GENERIC_HEADING_BOUNDARY = /^\s*(?:#{1,6}\s+\S.*|[A-Z][A-Za-z0-9 _/&-]{0,80}:\s*)$/;

const BULLET_ITEM = /^\s*[-*+]\s+(.+?)\s*$/;
const ORDERED_ITEM = /^\s*\d+\.\s+(.+?)\s*$/;

/**
 * Parse the supplied shape-spec text. NEVER throws; on any internal failure
 * the result is an empty extraction plus a single `parser_error` warning.
 */
export function parseShapeSpecHeadings(
  specText: string | null | undefined
): ShapeSpecHeadingParseResult {
  if (!specText || specText.trim() === '') {
    return {
      decisions: [],
      interfaces: [],
      assumptions: [],
      warnings: [
        missingHeading('decisions'),
        missingHeading('interfaces'),
        missingHeading('assumptions'),
      ],
    };
  }

  try {
    const lines = specText.split(/\r?\n/);
    const decisions = extractSection(lines, DECISIONS_HEADING);
    const interfaces = extractSection(lines, INTERFACES_HEADING);
    const assumptions = extractSection(lines, ASSUMPTIONS_HEADING);
    const warnings: ShapeSpecHeadingParseResult['warnings'] = [];
    if (decisions === null) warnings.push(missingHeading('decisions'));
    if (interfaces === null) warnings.push(missingHeading('interfaces'));
    if (assumptions === null) warnings.push(missingHeading('assumptions'));
    return {
      decisions: decisions ?? [],
      interfaces: interfaces ?? [],
      assumptions: assumptions ?? [],
      warnings,
    };
  } catch (e) {
    return {
      decisions: [],
      interfaces: [],
      assumptions: [],
      warnings: [
        {
          kind: PARSER_WARNING_KIND_PARSE_ERROR,
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }
}

function extractSection(lines: string[], heading: RegExp): string[] | null {
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx < 0) return null;
  const body: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (isHeadingBoundary(raw)) break;
    const item = stripListMarker(trimmed);
    if (item !== '') body.push(item);
  }
  return body;
}

function isHeadingBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (BULLET_ITEM.test(trimmed)) return false;
  if (ORDERED_ITEM.test(trimmed)) return false;
  return GENERIC_HEADING_BOUNDARY.test(line);
}

function stripListMarker(trimmedLine: string): string {
  const b = BULLET_ITEM.exec(trimmedLine);
  if (b) return b[1].trim();
  const o = ORDERED_ITEM.exec(trimmedLine);
  if (o) return o[1].trim();
  return trimmedLine;
}

function missingHeading(section: string): {
  kind: string;
  section: string;
  message: string;
} {
  return {
    kind: PARSER_WARNING_KIND_MISSING_HEADING,
    section,
    message: `spec body did not contain a '${section}' section heading`,
  };
}

/**
 * Best-effort key extraction for a decision line. Decisions in the prompt
 * follow the convention `<key>: <text>` (e.g. "auth-method: Use OAuth 2.0").
 * When a colon is present, the key is the trimmed lhs; otherwise the key
 * defaults to a slug of the first few words. The contradiction-detection +
 * auto-seed flows use the key for cross-row matching.
 */
export function extractDecisionKey(decisionLine: string): string {
  if (!decisionLine) return '';
  const colonIdx = decisionLine.indexOf(':');
  if (colonIdx > 0 && colonIdx < 80) {
    return decisionLine.substring(0, colonIdx).trim().toLowerCase();
  }
  return decisionLine
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 4)
    .join('-')
    .replace(/[^a-z0-9-]/g, '-');
}
