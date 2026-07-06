/**
 * Java Language Pack (V3 `LanguagePack`).
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 4)
 *
 * Stage 1 producer for Java source files. Wraps the existing
 * `extractJavaIR` + `filterJavaFiles` + `isTestFile` logic into the typed
 * `LanguagePack` contract.
 *
 * Responsibilities:
 *  - Activate when techHints include `{ language: 'Java' }` (per the V3
 *    `LanguagePackPredicate`, language-only match).
 *  - Filter the raw source-file map down to `.java` files, skip test
 *    files (`/src/test/`, `/test/`), and parse each file into
 *    `SourceFileIR` via `extractJavaIR`.
 *  - Return a `Map<filePath, SourceFileIR>` — files that fail to parse
 *    are simply omitted (a warning is logged).
 *
 * The FrameworkPack tier (e.g. `springClassicFrameworkPack`) consumes
 * the IR emitted here. IR shape is re-used unchanged from
 * `languageIR.ts`.
 *
 * The file-filter + parser helpers were lifted from the legacy
 * `extensionPacks/javaSpringBoot/` directory into
 * `extensionPacks/languageExtractors/java/` as part of the V2 removal
 * (V3 Pack Migration Batch — Task Group 11). They live next to the
 * `extract.ts` they support so all Java-language plumbing is in one
 * place.
 */

import type { LanguagePack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import { extractJavaIR } from '../../languageExtractors/java';
import { filterJavaFiles, filterConfigFiles, isTestFile } from '../../languageExtractors/java/fileFilter';
import { parseHbmXml, isHbmXmlFile, type HbmClassMapping } from '../../languageExtractors/java/hbmXmlParser';
import { mergeHbmMappingsIntoIr } from '../../languageExtractors/java/hbmXmlMerge';
import { parseSpringBeansXml, isSpringBeansXml } from '../../languageExtractors/java/springBeansXmlParser';

export const javaLangPack: LanguagePack = {
  id: 'java-lang',
  when: { language: 'Java' },

  extract(
    sourceFiles: Map<string, string>,
    techHints: TechHints,
  ): Map<string, SourceFileIR> {
    const irFiles = new Map<string, SourceFileIR>();

    const javaFiles = filterJavaFiles(sourceFiles, techHints);
    // Note: previously this returned early when `javaFiles.size === 0`,
    // which silently skipped the HBM-XML and Spring-bean-XML passes
    // below for repos that contain only XML config (rare, but possible
    // in the unit-test path and in service-scoped scopes that exclude
    // src/main/java). Continue past the empty-Java case so XML extraction
    // still fires.

    let parsed = 0;
    let skipped = 0;
    for (const [filePath, src] of javaFiles) {
      if (isTestFile(filePath)) {
        skipped++;
        continue;
      }
      try {
        const ir = extractJavaIR(filePath, src);
        if (ir) {
          irFiles.set(filePath, ir);
          parsed++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(
          `[java-lang] Error parsing ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        skipped++;
      }
    }
    console.log(
      `[java-lang] Parsed ${parsed} Java files (${skipped} skipped).`,
    );

    // Bug 17 fix (2026-04-22): classic Spring + Hibernate projects (e.g.
    // OpenMRS) declare entities via `*.hbm.xml` rather than JPA
    // annotations. Parse any HBM XML files in the source tree and merge
    // their mappings into the corresponding Java ClassIR entries so the
    // spring-classic framework pack can emit physical_data_entities +
    // attributes + relationships for them without any adapter changes.
    // Skip files under `/test/` to match the same test-exclusion rule we
    // apply to Java.
    const hbmMappings: HbmClassMapping[] = [];
    let hbmFilesParsed = 0;
    let hbmFilesFailed = 0;
    for (const [filePath, src] of sourceFiles) {
      if (!isHbmXmlFile(filePath)) continue;
      if (isTestFile(filePath)) continue;
      try {
        const mappings = parseHbmXml(src);
        if (mappings.length > 0) {
          hbmMappings.push(...mappings);
          hbmFilesParsed++;
        }
      } catch (err) {
        console.warn(
          `[java-lang] Error parsing HBM XML ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        hbmFilesFailed++;
      }
    }
    if (hbmMappings.length > 0) {
      const { matched, orphaned } = mergeHbmMappingsIntoIr(irFiles, hbmMappings);
      console.log(
        `[java-lang] Merged ${matched} HBM mappings into Java IR from ` +
          `${hbmFilesParsed} HBM XML files (${orphaned} orphaned, ` +
          `${hbmFilesFailed} parse failures).`,
      );
    }

    // 2026-04-25: classic Spring projects (e.g. OpenMRS — 49 beans in
    // `applicationContext-service.xml`) wire the bulk of their
    // architectural surface through bean XML files. Parse any `beans`-
    // rooted XML in the source tree and surface a `SourceFileIR` whose
    // `springXmlBeans` field carries the structured result. The
    // spring-classic framework adapter narrows + emits candidates.
    let springXmlFilesParsed = 0;
    let springXmlBeansTotal = 0;
    for (const [filePath, src] of sourceFiles) {
      if (!filePath.endsWith('.xml')) continue;
      if (isHbmXmlFile(filePath)) continue; // already handled
      if (isTestFile(filePath)) continue;
      if (!isSpringBeansXml(src)) continue;
      try {
        const parsed = parseSpringBeansXml(src);
        if (
          parsed.beans.length === 0 &&
          parsed.componentScans.length === 0 &&
          parsed.imports.length === 0 &&
          parsed.propertyPlaceholders.length === 0
        ) {
          continue;
        }
        irFiles.set(filePath, {
          filePath,
          language: 'spring-xml',
          packageOrNamespace: null,
          imports: [],
          classes: [],
          functions: [],
          springXmlBeans: parsed,
          // Spec 2026-07-06-l: verbatim source so the spring-classic XML-MVC
          // scanner can read the namespaces `springXmlBeans` does not model
          // (mvc:interceptors, SimpleUrlHandlerMapping props, security
          // intercept-url, tx:advice / aop:config). Mirrors the web.xml /
          // WADL / WSDL rawContent admission precedent.
          rawContent: src,
        });
        springXmlFilesParsed++;
        springXmlBeansTotal += parsed.beans.length;
      } catch (err) {
        console.warn(
          `[java-lang] Error parsing Spring bean XML ${filePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (springXmlFilesParsed > 0) {
      console.log(
        `[java-lang] Parsed ${springXmlBeansTotal} Spring bean(s) from ` +
          `${springXmlFilesParsed} XML file(s).`,
      );
    }

    // -----------------------------------------------------------------------
    // Bug-fix 2026-05-22: Contract-file admission (WADL / WSDL / XSD).
    //
    // The scanPlanBuilder (`SOURCE_EXTENSIONS`) admits these three contract
    // formats to `sourceFiles`, but until this branch landed they were
    // silently dropped here -- only `.java` and matched `.xml` files reached
    // `irFiles`. Downstream packs (`restWadl`, `springClassicSoap`) filter
    // `input.irFiles` for these extensions AND require `ir.rawContent` to
    // be populated, so without admission they emitted nothing in
    // production.
    //
    // Admission is intentionally minimal: structural IR fields stay empty
    // (no parsing here -- the WADL/WSDL/XSD packs own their own parsers).
    // `rawContent` carries the verbatim source so the downstream pack can
    // feed it into `fast-xml-parser`. `language` is the format-specific
    // discriminator so packs can filter without re-checking the extension.
    //
    // Test-file exclusion mirrors the Java and Spring-XML branches: WADL
    // / WSDL / XSD fixtures under `/test/` or `/tests/` are not admitted
    // (they would otherwise pollute production findings).
    //
    // This branch lives in `javaLangPack` for pragmatism (the user's
    // services are Java-based). A future spec could extract these admissions
    // into a standalone "contracts" language pack so they fire regardless
    // of the host service's primary language.
    let contractFilesAdmitted = 0;
    for (const [filePath, src] of sourceFiles) {
      if (isTestFile(filePath)) continue;
      const lower = filePath.toLowerCase();
      let contractLanguage: 'wadl' | 'wsdl' | 'xsd' | null = null;
      if (lower.endsWith('.wadl')) contractLanguage = 'wadl';
      else if (lower.endsWith('.wsdl')) contractLanguage = 'wsdl';
      else if (lower.endsWith('.xsd')) contractLanguage = 'xsd';
      if (!contractLanguage) continue;
      // Do not clobber an existing IR entry. The only path that would
      // collide today is the Spring-XML branch above, and that only matches
      // .xml files (none of these contract extensions), so the guard is
      // defensive only.
      if (irFiles.has(filePath)) continue;
      irFiles.set(filePath, {
        filePath,
        language: contractLanguage,
        packageOrNamespace: null,
        imports: [],
        classes: [],
        functions: [],
        rawContent: src,
      });
      contractFilesAdmitted++;
    }
    if (contractFilesAdmitted > 0) {
      console.log(
        `[java-lang] Admitted ${contractFilesAdmitted} contract file(s) ` +
          `(.wadl / .wsdl / .xsd) with rawContent for deterministic pack scanning.`,
      );
    }

    // Inbound-surface completeness (Spec #4, Task Group 3): admit the classic
    // Servlet deployment descriptor (`web.xml`) with verbatim `rawContent` so
    // BOTH the finding scanner (the `web_xml_present` finding + servlet-mapping
    // summary) and the spring-classic adapter's servlet detector
    // (`inboundSurfaceDetectors.ts`, which parses `<servlet-mapping>` URLs to
    // emit servlet endpoint candidates) can see it. Mirrors the contract-file
    // admission above; structural IR fields stay empty (the servlet parser owns
    // the XML parse). Test-file exclusion + no-clobber guard preserved.
    let webXmlAdmitted = 0;
    for (const [filePath, src] of sourceFiles) {
      if (isTestFile(filePath)) continue;
      const lower = filePath.toLowerCase();
      const isWebXml =
        lower.endsWith('/web.xml') ||
        lower.endsWith('\\web.xml') ||
        lower === 'web.xml';
      if (!isWebXml) continue;
      if (irFiles.has(filePath)) continue;
      irFiles.set(filePath, {
        filePath,
        language: 'web-xml',
        packageOrNamespace: null,
        imports: [],
        classes: [],
        functions: [],
        rawContent: src,
      });
      webXmlAdmitted++;
    }
    if (webXmlAdmitted > 0) {
      console.log(
        `[java-lang] Admitted ${webXmlAdmitted} web.xml deployment descriptor(s) ` +
          `with rawContent for servlet-mapping detection.`,
      );
    }

    // -----------------------------------------------------------------------
    // Spring config-file admission (application[-profile].{properties,yml,yaml}).
    //
    // Spec: 2026-06-22 Spring Classic code-evidence format extraction --
    // global-date-format ladder, rank-1 follow-up wiring.
    //
    // The global-date-format resolver (springClassic/globalDateFormatScanner.ts)
    // reads spring.jackson.date-format off application.properties / .yml at the
    // TOP of its precedence ladder (rank 1), but those config files never reached
    // the IR files array the spring-classic adapter receives -- only .java,
    // spring-bean .xml, WADL/WSDL/XSD, and web.xml were admitted -- so the
    // rank-1 rung was inert in production (only the .java rungs fired). Admit
    // the Spring config files here via the existing filterConfigFiles helper
    // (its intended purpose; it matches application[-profile].{yml,yaml,
    // properties}) so the resolver can read them.
    //
    // Admission is intentionally minimal and mirrors the WADL / web.xml branches
    // above: structural IR fields stay EMPTY (no classes / functions), so the
    // Java scanners that iterate file.classes simply see nothing for a config
    // file -- it is NOT fed to the tree-sitter Java parser. rawContent carries
    // the verbatim source so resolveGlobalDateFormat (and any future config
    // reader) can scan it. language=spring-config is the discriminator.
    // Test-file exclusion + no-clobber guard preserved.
    let configFilesAdmitted = 0;
    for (const [filePath, src] of filterConfigFiles(sourceFiles)) {
      if (isTestFile(filePath)) continue;
      if (irFiles.has(filePath)) continue;
      irFiles.set(filePath, {
        filePath,
        language: 'spring-config',
        packageOrNamespace: null,
        imports: [],
        classes: [],
        functions: [],
        rawContent: src,
      });
      configFilesAdmitted++;
    }
    if (configFilesAdmitted > 0) {
      console.log(
        `[java-lang] Admitted ${configFilesAdmitted} Spring config file(s) ` +
          `(application*.{properties,yml,yaml}) with rawContent for deterministic pack scanning of spring config.`,
      );
    }

    return irFiles;
  },
};
