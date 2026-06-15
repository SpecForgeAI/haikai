/**
 * Maven POM metadata parser (sibling of {@link MavenDependencyResolver}).
 *
 * Spec: 2026-05-16 Wire Java + Spring + Maven Findings -- Task Group 5.
 *
 * The shipping `MavenDependencyResolver` only extracts the
 * `<dependency>` blocks plus project coordinates. The Maven finding
 * scanner needs additional metadata that the resolver does NOT carry
 * today:
 *
 *  - `<properties>`: key/value map. Used to resolve `${...}` references
 *    in dependency / plugin versions and to surface
 *    `maven.compiler.source/target/release` (the canonical Java-version
 *    signals).
 *  - `<parent>`: parent POM coordinates (groupId / artifactId / version).
 *    The Spring Boot starter parent version is the most reliable Spring
 *    signal in a real project.
 *  - `<build><plugins>` (and `<build><pluginManagement><plugins>`):
 *    per-plugin groupId / artifactId / version + a coarse `configSummary`
 *    payload so the scanner can detect, e.g., compiler `<source>17</source>`
 *    nested inside `<configuration>`.
 *  - `<dependencyManagement>` contents: separately captured (NOT merged
 *    into the resolver's resolved dependency list) so the scanner can
 *    flag version conflicts where a top-level `<dependency>` differs
 *    from its `<dependencyManagement>` override.
 *
 * Additive output: the parser does NOT touch `DeclaredDependency` shape
 * and does NOT change anything the resolver returns -- callers that
 * want this metadata invoke the parser explicitly.
 *
 * Best-effort: malformed POMs return partial data with the unparseable
 * fields left undefined. Soft-fail: a top-level exception is caught
 * by callers (the Maven finding scanner wraps invocation in a try/catch).
 *
 * No XML library -- a focused regex parser is sufficient for the small
 * surface area we need. The Maven POM is forgiving enough that this
 * matches every well-formed pom.xml; a future spec needing richer XML
 * can swap in xml2js without changing this contract.
 */

import * as fs from 'fs/promises';

/**
 * Top-level metadata extracted from a single pom.xml.
 *
 * All fields are present but may be empty when the source POM does not
 * declare the corresponding block. Callers MUST tolerate empty maps /
 * arrays / nulls (the scanner does).
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
  /**
   * `<dependencyManagement>` entries. Distinct from the resolver's
   * resolved dependencies (this list is NOT merged into resolved deps).
   */
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
  /**
   * Verbatim text of the plugin's `<configuration>` block, or null when
   * absent. Bounded slice (<= 1000 chars) so a noisy plugin
   * configuration does not bloat the in-memory metadata.
   */
  configSummary: string | null;
  /** Whether this entry is inside `<pluginManagement>` (vs direct `<plugins>`). */
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
 * Read a single POM file and extract metadata. Best-effort -- never
 * throws on parse failure (returns partial data with empty fields).
 * On filesystem read error the caller-supplied `pomPath` is preserved
 * and all metadata fields are empty.
 */
export async function parsePomMetadataFromFile(
  pomPath: string,
  absolutePath?: string,
): Promise<PomMetadata> {
  let raw: string;
  try {
    raw = await fs.readFile(absolutePath ?? pomPath, 'utf-8');
  } catch (err) {
    console.warn(
      `[mavenPomMetadataParser] Failed to read '${pomPath}'; returning empty metadata:`,
      err instanceof Error ? err.message : String(err),
    );
    return emptyMetadata(pomPath);
  }
  return parsePomMetadataFromString(pomPath, raw);
}

/**
 * Parse a POM from its raw string content. Pure, no I/O.
 * Exported so tests can use inline fixtures without filesystem access.
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
  } catch (err) {
    console.warn(
      `[mavenPomMetadataParser] Failed to parse '${pomPath}'; returning empty metadata:`,
      err instanceof Error ? err.message : String(err),
    );
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
 * - `${prop}` is looked up; on hit the resolved value is returned
 *   recursively (one level of indirection is enough for real POMs).
 * - On miss the original `${prop}` text is returned so callers can
 *   detect unresolved references.
 *
 * Exported so the scanner can call it on dependency versions too.
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
  // One level of indirection: if the replacement is also a ${prop}, resolve once more.
  return resolvePropertyRef(replacement, properties);
}

// ---------------------------------------------------------------------------
// Section parsers
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
  // Match every <key>value</key> entry inside the block. Maven property
  // names allow `.`, `-`, alphanumerics; the regex is intentionally
  // generous so any well-formed property name is captured.
  const entryRe = /<([A-Za-z_][A-Za-z0-9_\-.]*)>\s*([\s\S]*?)\s*<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(propsBlock)) !== null) {
    const key = m[1];
    const value = m[2].trim();
    // Skip nested blocks that contain XML (we only want leaf string values).
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

  // Identify the byte ranges of <pluginManagement> blocks inside <build>
  // so we can label each plugin entry as managed/unmanaged.
  const managementRanges: Array<[number, number]> = [];
  const mgmtRe = /<pluginManagement\b[^>]*>([\s\S]*?)<\/pluginManagement>/g;
  let mgmtMatch: RegExpExecArray | null;
  while ((mgmtMatch = mgmtRe.exec(buildBlock)) !== null) {
    managementRanges.push([mgmtMatch.index, mgmtMatch.index + mgmtMatch[0].length]);
  }

  // Match every <plugin>...</plugin> directly under <build> (or under
  // <build><pluginManagement><plugins>; the result is the same regex).
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
  // The outermost match captures the FIRST <dependencyManagement> block.
  // Real Maven POMs only have one; profiles can hold their own but those
  // are out of scope for v1 (handled identically to the main one if
  // present).
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
