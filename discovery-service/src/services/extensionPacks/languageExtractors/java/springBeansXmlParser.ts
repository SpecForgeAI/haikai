/**
 * Spring bean XML parser.
 *
 * Targets classic-Spring `applicationContext*.xml` / `*-context.xml` /
 * `beans.xml` files. Codebases like OpenMRS Core (49 `<bean>` declarations
 * in `applicationContext-service.xml` on master, 2026-04-25) wire the bulk
 * of their architectural surface through these files — invisible to
 * annotation-driven extraction. This parser surfaces them as structured
 * data so the spring-classic framework adapter can emit `interfaces`
 * candidates with `springConfigKind: 'xml-bean'`.
 *
 * Extracts:
 *  - `<bean id="..." class="..."/>` — bean definitions (with property /
 *    constructor-arg refs collected as `data.dependencies`).
 *  - `<context:component-scan base-package="..."/>` (also `<context:include-filter>`
 *    is left for a future enhancement).
 *  - `<import resource="..."/>` — cross-XML wiring edges so reviewers can
 *    traverse the config graph without an LLM round-trip.
 *  - `<context:property-placeholder location="classpath:…"/>` — surfaced as
 *    a hint that external properties files participate in wiring.
 *
 * NOT in scope (deferred):
 *  - `<aop:config>`, `<tx:annotation-driven>`, `<jms:listener-container>`
 *    and other namespace-specific elements. The presence of these
 *    namespaces is reported via `usedNamespaces` so the adapter / LLM
 *    can flag them.
 *  - Nested inner beans (`<property><bean class="…"/></property>`). Outer
 *    beans are extracted; nested anonymous beans are NOT.
 *  - Profile-conditional bean blocks (`<beans profile="prod">…`). The
 *    parser is profile-agnostic — every bean in the file is reported.
 *  - SpEL expressions in `<value>` / `<property value="…"/>` — bare
 *    string values are kept verbatim.
 *
 * No XML library dependency — the bean XML grammar is regular enough that
 * a streaming regex scan covers the architecturally-significant signals.
 * Mirrors the dependency-free style of `hbmXmlParser.ts`.
 */

/**
 * One bean's structured shape, as extracted from a single `<bean>` block.
 *
 * `id` and `name` differ in Spring: `id` is unique-required, `name` may be
 * a comma-separated alias list. We surface both verbatim and normalise the
 * canonical key as `id ?? firstName(name)`.
 */
export interface SpringXmlBean {
  /** Canonical bean key — `id` if present, else first token of `name`. */
  beanKey: string;
  /** Raw `id` attribute, or null when only `name` is set. */
  id: string | null;
  /** Aliases parsed from the `name` attribute (comma- or whitespace-separated). */
  aliases: string[];
  /** Fully-qualified class as declared in `class="..."`, or null when absent. */
  fullyQualifiedClass: string | null;
  /** Simple class name (last segment of fullyQualifiedClass), or null. */
  simpleClassName: string | null;
  /** Bean ids referenced via `<property ref="x"/>` and `<constructor-arg ref="x"/>`. */
  dependencyRefs: string[];
}

export interface SpringXmlComponentScan {
  /** Comma-separated `base-package` attribute, split into individual packages. */
  basePackages: string[];
}

export interface SpringXmlImport {
  /** The `resource="..."` value, e.g. `classpath:applicationContext-data.xml`. */
  resource: string;
}

export interface SpringXmlPropertyPlaceholder {
  /** `location="..."` value(s), e.g. `classpath:application.properties`. */
  locations: string[];
}

/**
 * Parsed result of one Spring bean XML file.
 */
export interface SpringBeansXmlResult {
  beans: SpringXmlBean[];
  componentScans: SpringXmlComponentScan[];
  imports: SpringXmlImport[];
  propertyPlaceholders: SpringXmlPropertyPlaceholder[];
  /** Namespace prefixes detected at the root <beans> element (excluding default + xsi). */
  usedNamespaces: string[];
}

/**
 * Strip XML comments and CDATA so downstream regex matching is simpler.
 */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
}

/**
 * Extract the value of an XML attribute from a tag-open fragment. Tolerant
 * of single / double quotes and arbitrary whitespace. Returns the captured
 * value or null. Mirrors the hbmXmlParser helper.
 */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = tag.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * Reduce a possibly package-qualified class name to its simple name.
 * `org.openmrs.api.PatientService` → `PatientService`.
 */
function simpleName(qualified: string | null): string | null {
  if (!qualified) return null;
  const dot = qualified.lastIndexOf('.');
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}

/**
 * Split a Spring `name` attribute (which may carry multiple aliases) into
 * a clean string array. Spring accepts both comma- and whitespace-separated
 * tokens, intermingled (`name="a,b c"` is valid).
 */
function splitNameAliases(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Cheap-and-correct test for whether an XML document looks like a Spring
 * bean configuration. We treat the presence of an opening `<beans>` /
 * `<beans:beans>` tag at the document level as the signal — Spring's bean
 * schema mandates this root element.
 */
export function isSpringBeansXml(xmlContent: string): boolean {
  const trimmed = stripComments(xmlContent).trimStart();
  return /<\s*(?:[A-Za-z][A-Za-z0-9_-]*:)?beans\b/.test(trimmed);
}

/**
 * Detect the namespace prefixes declared on the root <beans> element. The
 * default namespace and `xsi` are uninteresting; everything else (`context`,
 * `tx`, `aop`, `jms`, `mybatis`, `cache`, `task`, etc.) hints at additional
 * Spring features beyond plain bean wiring.
 */
function detectNamespaces(xml: string): string[] {
  const beansOpenMatch = /<\s*(?:[A-Za-z][A-Za-z0-9_-]*:)?beans\b([^>]*)>/.exec(xml);
  if (!beansOpenMatch) return [];
  const attrs = beansOpenMatch[1];
  const re = /xmlns:([A-Za-z][A-Za-z0-9_-]*)\s*=/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs)) !== null) {
    if (m[1] === 'xsi') continue;
    out.push(m[1]);
  }
  return out;
}

/**
 * Parse a single Spring bean XML file's content into a structured result.
 *
 * Tolerant on every axis: missing class attributes, missing ids, mixed
 * indentation, prefixed or default namespace, profile-conditional inner
 * `<beans>` blocks. Returns an empty bundle for non-Spring XML so callers
 * can route any `.xml` file through this without a pre-check.
 */
export function parseSpringBeansXml(xmlContent: string): SpringBeansXmlResult {
  const empty: SpringBeansXmlResult = {
    beans: [],
    componentScans: [],
    imports: [],
    propertyPlaceholders: [],
    usedNamespaces: [],
  };
  if (!isSpringBeansXml(xmlContent)) return empty;
  const xml = stripComments(xmlContent);

  const usedNamespaces = detectNamespaces(xml);

  // --- <bean> ---------------------------------------------------------------
  // We accept `<bean .../>` (self-closing) AND `<bean ...>...</bean>`
  // (paired). The body of the paired form is scanned for `<property
  // ref="..."/>` and `<constructor-arg ref="..."/>` so we can record
  // architectural dependency edges.
  const beans: SpringXmlBean[] = [];
  const beanOpenRe = /<\s*(?:[A-Za-z][A-Za-z0-9_-]*:)?bean\b([^>/]*)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = beanOpenRe.exec(xml)) !== null) {
    const tagAttrs = m[1];
    const selfClosing = m[2] === '/';
    const id = attr(tagAttrs, 'id');
    const name = attr(tagAttrs, 'name');
    const fullyQualifiedClass = attr(tagAttrs, 'class');
    const aliases = splitNameAliases(name);
    const beanKey = id ?? aliases[0] ?? null;
    if (!beanKey) {
      // Anonymous nested bean — skip; outer bean's body will mention it.
      continue;
    }

    let dependencyRefs: string[] = [];
    if (!selfClosing) {
      // Find the matching `</bean>` for this opener.
      const closeIdx = xml.indexOf('</bean>', beanOpenRe.lastIndex);
      const altCloseIdx = (() => {
        // Support prefixed close tag too.
        const re = /<\/\s*(?:[A-Za-z][A-Za-z0-9_-]*:)?bean\s*>/g;
        re.lastIndex = beanOpenRe.lastIndex;
        const r = re.exec(xml);
        return r ? r.index : -1;
      })();
      const effectiveClose = altCloseIdx >= 0 ? altCloseIdx : closeIdx;
      const bodyEnd = effectiveClose >= 0 ? effectiveClose : xml.length;
      const body = xml.slice(beanOpenRe.lastIndex, bodyEnd);
      const refRe = /<\s*(?:[A-Za-z][A-Za-z0-9_-]*:)?(?:property|constructor-arg)\b([^>/]*)(?:\/?)>/g;
      const seen = new Set<string>();
      let r: RegExpExecArray | null;
      while ((r = refRe.exec(body)) !== null) {
        const refTo = attr(r[1], 'ref');
        if (refTo && !seen.has(refTo)) {
          seen.add(refTo);
          dependencyRefs.push(refTo);
        }
      }
    }

    beans.push({
      beanKey,
      id,
      aliases,
      fullyQualifiedClass,
      simpleClassName: simpleName(fullyQualifiedClass),
      dependencyRefs,
    });
  }

  // --- <context:component-scan> ---------------------------------------------
  const componentScans: SpringXmlComponentScan[] = [];
  const scanRe = /<\s*context:component-scan\b([^>/]*)(?:\/?)>/g;
  while ((m = scanRe.exec(xml)) !== null) {
    const raw = attr(m[1], 'base-package');
    const basePackages = raw
      ? raw
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
    if (basePackages.length > 0) {
      componentScans.push({ basePackages });
    }
  }

  // --- <import resource="..."/> ---------------------------------------------
  const imports: SpringXmlImport[] = [];
  const importRe = /<\s*import\b([^>/]*)(?:\/?)>/g;
  while ((m = importRe.exec(xml)) !== null) {
    const resource = attr(m[1], 'resource');
    if (resource) imports.push({ resource });
  }

  // --- <context:property-placeholder location="..."/> -----------------------
  const propertyPlaceholders: SpringXmlPropertyPlaceholder[] = [];
  const ppRe = /<\s*context:property-placeholder\b([^>/]*)(?:\/?)>/g;
  while ((m = ppRe.exec(xml)) !== null) {
    const raw = attr(m[1], 'location');
    const locations = raw
      ? raw
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
    if (locations.length > 0) {
      propertyPlaceholders.push({ locations });
    }
  }

  return { beans, componentScans, imports, propertyPlaceholders, usedNamespaces };
}
