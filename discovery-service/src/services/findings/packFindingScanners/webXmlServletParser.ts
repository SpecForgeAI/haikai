/**
 * Pure `web.xml` servlet-mapping parser (Spec #4, Task Group 3).
 *
 * Parses the classic Servlet deployment descriptor (`web.xml`)
 * `<servlet>` + `<servlet-mapping>` declarations into a flat
 * (servlet-class -> url-pattern[]) result so BOTH:
 *   - `scanWebXmlPresence` (the finding scanner) can summarise the parsed
 *     mappings on its `web_xml_present` finding, AND
 *   - the spring-classic adapter's servlet detector can emit endpoint
 *     candidates for XML-declared servlets,
 * consume ONE pure parser (no duplicate XML logic, no candidate minting in the
 * finding scanner).
 *
 * Regex-based, mirroring the existing `springBeansXmlParser` approach (the
 * codebase parses Spring bean XML with regex, not a DOM parser, for these
 * small deterministic descriptors). NO new dependency. Namespace-prefixed
 * tags (`<javaee:servlet>`) are tolerated. Pure: no I/O, no throw on
 * malformed input (returns what it could parse).
 */

export interface WebXmlServletMapping {
  /** The `<servlet-class>` text (may be fully-qualified). */
  servletClass: string;
  /** The url-patterns mapped to this servlet via `<servlet-mapping>`. */
  urlPatterns: string[];
}

/** Strip an optional XML namespace prefix from a tag local-name regex. */
const NS = '(?:[A-Za-z][A-Za-z0-9_-]*:)?';

/** Read the text content of a `<tag>…</tag>` inside `block`, trimmed, or null. */
function readTagText(block: string, localName: string): string | null {
  const re = new RegExp(`<\\s*${NS}${localName}\\s*>([\\s\\S]*?)<\\s*/\\s*${NS}${localName}\\s*>`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

/** Read ALL occurrences of `<tag>…</tag>` text inside `block`. */
function readAllTagText(block: string, localName: string): string[] {
  const re = new RegExp(`<\\s*${NS}${localName}\\s*>([\\s\\S]*?)<\\s*/\\s*${NS}${localName}\\s*>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const t = m[1].trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}

/**
 * Parse `web.xml` content into (servlet-class -> url-pattern[]) mappings.
 *
 * Joins the two halves of the descriptor:
 *   `<servlet>`         : servlet-name -> servlet-class
 *   `<servlet-mapping>` : servlet-name -> url-pattern(s)
 *
 * A servlet declared with a class but no mapping yields an entry with an empty
 * `urlPatterns` (so callers can still see the servlet exists); a mapping whose
 * servlet-name has no `<servlet-class>` is skipped (nothing addressable to
 * emit). Deterministic: declaration order preserved.
 */
export function parseWebXmlServletMappings(xml: string): WebXmlServletMapping[] {
  if (!xml || typeof xml !== 'string') return [];

  // servlet-name -> servlet-class (from <servlet> blocks).
  const classByName = new Map<string, string>();
  const nameOrder: string[] = [];
  const servletBlockRe = new RegExp(
    `<\\s*${NS}servlet\\b[^>]*>([\\s\\S]*?)<\\s*/\\s*${NS}servlet\\s*>`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = servletBlockRe.exec(xml)) !== null) {
    const block = m[1];
    const name = readTagText(block, 'servlet-name');
    const klass = readTagText(block, 'servlet-class');
    if (!name) continue;
    if (!classByName.has(name)) nameOrder.push(name);
    if (klass) classByName.set(name, klass);
  }

  // servlet-name -> url-pattern[] (from <servlet-mapping> blocks).
  const patternsByName = new Map<string, string[]>();
  const mappingBlockRe = new RegExp(
    `<\\s*${NS}servlet-mapping\\b[^>]*>([\\s\\S]*?)<\\s*/\\s*${NS}servlet-mapping\\s*>`,
    'gi',
  );
  while ((m = mappingBlockRe.exec(xml)) !== null) {
    const block = m[1];
    const name = readTagText(block, 'servlet-name');
    if (!name) continue;
    const patterns = readAllTagText(block, 'url-pattern');
    if (patterns.length === 0) continue;
    const existing = patternsByName.get(name) ?? [];
    for (const p of patterns) if (!existing.includes(p)) existing.push(p);
    patternsByName.set(name, existing);
  }

  const out: WebXmlServletMapping[] = [];
  for (const name of nameOrder) {
    const servletClass = classByName.get(name);
    if (!servletClass) continue; // no class -> nothing to emit
    out.push({
      servletClass,
      urlPatterns: patternsByName.get(name) ?? [],
    });
  }
  return out;
}
