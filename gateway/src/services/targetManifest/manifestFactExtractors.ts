/**
 * Pom property + plugin fact extractors.
 *
 * Spec: 2026-06-26-target-dependency-manifest-auto-answer-comprehensive (Spec 2)
 * — Task Group 3 (R3/FR3).
 *
 * PURE. No I/O, no LLM, no network. Reads the `pomMetadata` now carried on
 * {@link ResolvedManifest} (Spec 2 FR1) — the `<properties>` and `<plugins>`
 * blocks the resolver parses then used to DISCARD — and derives the
 * dependency-answerable codes that NO single library coordinate witnesses:
 *
 *   - PROPERTY extractor: `<java.version>` / `maven.compiler.release` /
 *     `maven.compiler.target` / `maven.compiler.source` => `service.language`
 *     bare stem `Java`; `kotlin.version` => `Kotlin` (Kotlin wins when both are
 *     present — a Kotlin/JVM project still pins `java.version` for the bytecode
 *     target). The declared property VALUE is the version (deterministic-direct,
 *     verbatim — NO curated guess); an unresolved `${...}` / empty value degrades
 *     to `version-unknown` (no guessing).
 *   - PLUGIN extractor: a `flyway-maven-plugin` (groupId `org.flywaydb`) =>
 *     `db.migrations` bare stem `Flyway`; a `liquibase-maven-plugin` (groupId
 *     `org.liquibase`) => `Liquibase`. The plugin version (often parent-managed
 *     and absent) flows through, degrading to `version-unknown` when not pinned.
 *
 * Both codes are Spec-1 `versioned: true`, so both facts are emitted as bare-stem
 * `{ framework, version }` answers (aligned with the registry union shape). A
 * fact is a DETERMINISTIC-DIRECT hit (not inferred, not LLM): it reads a value
 * the author wrote in the pom, exactly like a coordinate witness.
 */

import { VERSION_UNKNOWN } from '../../config/architect-conversation/frameworkVersionShape';
import { PomMetadata, PomPlugin } from './mavenPomMetadata';

/**
 * One deterministic-direct fact derived from a pom `<properties>` / `<plugins>`
 * block. Mirrors a coordinate witness: a bare-stem framework + the resolved
 * version (concrete OR `version-unknown`) + a short evidence string. Always a
 * `framework-version` answer (both witnessed codes are Spec-1 versioned).
 */
export interface ManifestPomFact {
  decisionCode: string;
  /** Canonical bare-stem framework label (e.g. `Java`, `Kotlin`, `Flyway`). */
  framework: string;
  /** Concrete version OR `version-unknown` (flows through unchanged). */
  version: string;
  /** Short evidence string for `sourceQuote` (e.g. `java.version 21`). */
  evidence: string;
}

const PLACEHOLDER_RE = /^\$\{[^}]+\}$/;

/**
 * Normalise a declared property/plugin version text to a concrete version OR the
 * `version-unknown` sentinel. An empty value or an unresolved `${...}` reference
 * degrades to `version-unknown` (no guessing); anything else passes verbatim.
 */
function normaliseVersion(raw: string | null | undefined): string {
  if (raw == null) return VERSION_UNKNOWN;
  const v = raw.trim();
  if (v.length === 0 || PLACEHOLDER_RE.test(v)) return VERSION_UNKNOWN;
  return v;
}

/** The first property key in `keys` whose value is a non-empty string, or null. */
function firstPresentKey(
  properties: Record<string, string>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const v = properties[k];
    if (typeof v === 'string' && v.trim().length > 0) return k;
  }
  return null;
}

/** Property keys that, when present, witness a Java target language. */
const JAVA_VERSION_KEYS = [
  'java.version',
  'maven.compiler.release',
  'maven.compiler.target',
  'maven.compiler.source',
] as const;

/**
 * Derive a `service.language` fact from `<properties>`. `kotlin.version` wins
 * over the Java keys (a Kotlin/JVM project pins both); otherwise any of the Java
 * compiler properties yields `Java`. Returns `null` when no language property is
 * present.
 */
export function deriveServiceLanguageFromProperties(
  properties: Record<string, string>,
): ManifestPomFact | null {
  const kotlin = properties['kotlin.version'];
  if (typeof kotlin === 'string' && kotlin.trim().length > 0) {
    return {
      decisionCode: 'service.language',
      framework: 'Kotlin',
      version: normaliseVersion(kotlin),
      evidence: `kotlin.version ${kotlin.trim()}`,
    };
  }
  const javaKey = firstPresentKey(properties, JAVA_VERSION_KEYS);
  if (javaKey) {
    const raw = properties[javaKey];
    return {
      decisionCode: 'service.language',
      framework: 'Java',
      version: normaliseVersion(raw),
      evidence: `${javaKey} ${raw.trim()}`,
    };
  }
  return null;
}

/**
 * Derive a `db.migrations` fact from `<plugins>` (incl. `<pluginManagement>`).
 * A flyway (`org.flywaydb` / `flyway-maven-plugin`) plugin yields `Flyway`; a
 * liquibase (`org.liquibase` / `liquibase-maven-plugin`) plugin yields
 * `Liquibase`. The FIRST matching plugin in declaration order wins. Returns
 * `null` when neither migration plugin is declared.
 */
export function deriveDbMigrationsFromPlugins(
  plugins: readonly PomPlugin[],
): ManifestPomFact | null {
  for (const plugin of plugins) {
    const group = (plugin.groupId ?? '').toLowerCase();
    const artifact = (plugin.artifactId ?? '').toLowerCase();
    const isFlyway =
      group === 'org.flywaydb' ||
      artifact === 'flyway-maven-plugin' ||
      artifact.startsWith('flyway-');
    if (isFlyway) {
      return {
        decisionCode: 'db.migrations',
        framework: 'Flyway',
        version: normaliseVersion(plugin.version),
        evidence: `${plugin.groupId ?? ''}:${plugin.artifactId ?? ''} (maven-plugin)`,
      };
    }
    const isLiquibase =
      group === 'org.liquibase' ||
      artifact === 'liquibase-maven-plugin' ||
      artifact.startsWith('liquibase-');
    if (isLiquibase) {
      return {
        decisionCode: 'db.migrations',
        framework: 'Liquibase',
        version: normaliseVersion(plugin.version),
        evidence: `${plugin.groupId ?? ''}:${plugin.artifactId ?? ''} (maven-plugin)`,
      };
    }
  }
  return null;
}

/**
 * Derive ALL deterministic-direct pom facts (property + plugin extractors) from
 * the metadata carried on a resolved manifest. `null`/absent metadata (the npm
 * path) yields no facts. At most one fact per witnessed code; the caller's
 * existing per-code de-dup keeps the highest-precedence hit.
 */
export function deriveManifestPomFacts(
  metadata: PomMetadata | null | undefined,
): ManifestPomFact[] {
  if (!metadata) return [];
  const facts: ManifestPomFact[] = [];
  const language = deriveServiceLanguageFromProperties(metadata.properties);
  if (language) facts.push(language);
  const migrations = deriveDbMigrationsFromPlugins(metadata.plugins);
  if (migrations) facts.push(migrations);
  return facts;
}
