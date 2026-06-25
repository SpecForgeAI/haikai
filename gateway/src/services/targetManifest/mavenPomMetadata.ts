/**
 * Maven POM metadata parser — gateway-local port of the LOCKED discovery-service
 * `mavenPomMetadataParser.ts` pure string seam.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 2.
 *
 * The authoritative parser lives in
 *   discovery-service/src/services/dependencyResolvers/maven/mavenPomMetadataParser.ts
 * and exports `parsePomMetadataFromString`, `resolvePropertyRef`, `PomMetadata`.
 * That file is a LOCKED contract and MUST NOT be modified (Spec 3
 * contract-preservation guardrail). It cannot be imported across the
 * gateway↔discovery-service build boundary (gateway `rootDir: ./src` rejects a
 * cross-package import; see the header of `manifestDependencyResolvers.ts` for
 * the full rationale).
 *
 * This is a FAITHFUL port of the parser's PURE functions
 * (`parsePomMetadataFromString` + `resolvePropertyRef` + the section parsers) so
 * the Group 2 version-resolution layer can:
 *   - resolve `${...}` placeholders in declared versions via `resolvePropertyRef`
 *     (NOT reimplement placeholder logic — this IS that helper, ported), and
 *   - recover BOM/parent-managed versions from `dependencyManagement` / `parent`.
 *
 * The parser deliberately keeps `dependencyManagement` SEPARATE (not merged into
 * resolved deps) — that separation is exactly what enables managed-version
 * recovery in Task Group 2.
 *
 * PURE: no I/O (the file-reading `parsePomMetadataFromFile` variant is NOT
 * ported — uploads are in-memory strings).
 */

/**
 * Top-level metadata extracted from a single pom.xml. Structurally identical to
 * the discovery-service `PomMetadata`.
 */
export interface PomMetadata {
  /** Repo-relative POM path (same convention as DeclaredDependency.manifestPath). */
  pomPath: string;
  /** `<properties>` block: key -> verbatim text value. Empty if not declared. */
  properties: Record<string, string>;
  /** `<parent>` block. `null` when not declared. */
  parent: PomParent | null;
  /** `<build><plugins>` AND `<build><pluginManagement><plugins>` plugins. */
  plugins: PomPlugin[];
  /** `<dependencyManagement>` entries (NOT merged into resolved deps). */
  dependencyManagement: PomDependencyEntry[];
}

export interface PomParent {
  groupId: string | null;
  artifactId: string | null;
  version: string | null;
}

export interface PomPlugin {
  groupId: string | null;
  artifactId: string | null;
  version: string | null;
  configSummary: string | null;
  isManaged: boolean;
}

export interface PomDependencyEntry {
  groupId: string | null;
  artifactId: string | null;
  version: string | null;
  scope: string | null;
}

const MAX_CONFIG_SUMMARY_CHARS = 1000;

/**
 * Parse a POM from its raw string content. Pure, no I/O. Best-effort — never
 * throws on parse failure (returns partial data with empty fields), matching
 * the discovery-service contract.
 */
export function parsePomMetadataFromString(
  pomPath: string,
  raw: string,
): PomMetadata {
  if (!raw || typeof raw !== 'string') {
    return emptyMetadata(pomPath);
  }
  try {
    return {
      pomPath,
      properties: parseProperties(raw),
      parent: parseParent(raw),
      plugins: parsePlugins(raw),
      dependencyManagement: parseDependencyManagement(raw),
    };
  } catch {
    return emptyMetadata(pomPath);
  }
}

function emptyMetadata(pomPath: string): PomMetadata {
  return {
    pomPath,
    properties: {},
    parent: null,
    plugins: [],
    dependencyManagement: [],
  };
}

/**
 * Resolve a `${name}` placeholder against the supplied properties.
 * - Verbatim non-placeholder values are returned unchanged.
 * - `${prop}` is looked up; on hit the resolved value is returned recursively
 *   (one level of indirection is enough for real POMs).
 * - On miss the original `${prop}` text is returned so callers can DETECT an
 *   unresolved reference (Group 2 marks those `version-unknown`).
 *
 * Ported verbatim from the discovery-service parser's exported helper — the
 * Spec 3 mandate is to USE this helper, not reimplement placeholder logic.
 */
export function resolvePropertyRef(
  value: string | null | undefined,
  properties: Record<string, string>,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  const m = trimmed.match(/^\$\{([^}]+)\}$/);
  if (!m) return trimmed;
  const propName = m[1];
  const replacement = properties[propName];
  if (replacement === undefined) return trimmed; // unresolved
  return resolvePropertyRef(replacement, properties);
}

// ---------------------------------------------------------------------------
// Section parsers (ported verbatim)
// ---------------------------------------------------------------------------

function extractTagText(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function extractFirstBlockBody(raw: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = raw.match(re);
  return m ? m[1] : null;
}

function parseProperties(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const propsBlock = extractFirstBlockBody(raw, 'properties');
  if (!propsBlock) return out;
  const entryRe = /<([A-Za-z_][A-Za-z0-9_\-.]*)>\s*([\s\S]*?)\s*<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(propsBlock)) !== null) {
    const key = m[1];
    const value = m[2].trim();
    if (value.includes('<')) continue;
    out[key] = value;
  }
  return out;
}

function parseParent(raw: string): PomParent | null {
  const parentBlock = extractFirstBlockBody(raw, 'parent');
  if (!parentBlock) return null;
  return {
    groupId: extractTagText(parentBlock, 'groupId'),
    artifactId: extractTagText(parentBlock, 'artifactId'),
    version: extractTagText(parentBlock, 'version'),
  };
}

function parsePlugins(raw: string): PomPlugin[] {
  const out: PomPlugin[] = [];
  const buildBlock = extractFirstBlockBody(raw, 'build');
  if (!buildBlock) return out;

  const managementRanges: Array<[number, number]> = [];
  const mgmtRe = /<pluginManagement\b[^>]*>([\s\S]*?)<\/pluginManagement>/g;
  let mgmtMatch: RegExpExecArray | null;
  while ((mgmtMatch = mgmtRe.exec(buildBlock)) !== null) {
    managementRanges.push([mgmtMatch.index, mgmtMatch.index + mgmtMatch[0].length]);
  }

  const pluginRe = /<plugin\b[^>]*>([\s\S]*?)<\/plugin>/g;
  let m: RegExpExecArray | null;
  while ((m = pluginRe.exec(buildBlock)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const isManaged = managementRanges.some(([s, e]) => start >= s && end <= e);
    const body = m[1];
    const configBody = extractFirstBlockBody(body, 'configuration');
    const configSummary = configBody !== null
      ? configBody.trim().slice(0, MAX_CONFIG_SUMMARY_CHARS)
      : null;
    out.push({
      groupId: extractTagText(body, 'groupId'),
      artifactId: extractTagText(body, 'artifactId'),
      version: extractTagText(body, 'version'),
      configSummary,
      isManaged,
    });
  }
  return out;
}

function parseDependencyManagement(raw: string): PomDependencyEntry[] {
  const out: PomDependencyEntry[] = [];
  const dmRe = /<dependencyManagement\b[^>]*>([\s\S]*?)<\/dependencyManagement>/g;
  let dmMatch: RegExpExecArray | null;
  while ((dmMatch = dmRe.exec(raw)) !== null) {
    const inner = dmMatch[1];
    const depRe = /<dependency\b[^>]*>([\s\S]*?)<\/dependency>/g;
    let m: RegExpExecArray | null;
    while ((m = depRe.exec(inner)) !== null) {
      const body = m[1];
      out.push({
        groupId: extractTagText(body, 'groupId'),
        artifactId: extractTagText(body, 'artifactId'),
        version: extractTagText(body, 'version'),
        scope: extractTagText(body, 'scope'),
      });
    }
  }
  return out;
}
