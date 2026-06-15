/**
 * Core Tech Parser Utility
 *
 * Parses a service's `core_tech` free-text CSV field into structured
 * technology hint pairs with optional version. Used by the service-scoped
 * discovery pipeline to build techHints from a service entity's core_tech.
 *
 * Heuristic:
 * - Split by comma, trim each entry
 * - For each entry, split the last whitespace-separated token as version
 *   if it starts with a digit
 * - Assign `language` for known programming languages, `technology` for
 *   everything else (frameworks, libraries, databases, etc.)
 *
 * Example:
 *   "Java 25, Spring Boot 3.4" =>
 *   { "0": { language: "Java", version: "25" }, "1": { technology: "Spring Boot", version: "3.4" } }
 *
 * Spec: Service-Scoped Discovery (TG6)
 */

/**
 * Known programming languages for classification.
 * Case-insensitive matching is used when comparing.
 */
const KNOWN_LANGUAGES = new Set([
  'java',
  'python',
  'typescript',
  'javascript',
  'c#',
  'csharp',
  'go',
  'golang',
  'rust',
  'kotlin',
  'scala',
  'ruby',
  'php',
  'swift',
  'c',
  'c++',
  'cpp',
  'dart',
  'elixir',
  'erlang',
  'haskell',
  'lua',
  'perl',
  'r',
  'clojure',
  'groovy',
  'objective-c',
  'f#',
  'fsharp',
]);

/**
 * Parsed technology hint entry. Each entry is either a language or a
 * technology (framework/library), optionally with a version string.
 */
export interface ParsedCoreTechEntry {
  language?: string;
  technology?: string;
  version?: string;
}

/**
 * Parses a core_tech CSV free-text string into structured technology hints.
 *
 * @param coreTech - The core_tech field value (e.g., "Java 25, Spring Boot 3.4")
 * @returns A record keyed by numeric string indices matching the existing
 *          techHints pattern in DiscoveryConfigPayload
 */
export function parseCoretech(
  coreTech: string
): Record<string, { language?: string; technology?: string; version?: string }> {
  if (!coreTech || coreTech.trim() === '') {
    return {};
  }

  const result: Record<string, { language?: string; technology?: string; version?: string }> = {};
  const entries = coreTech.split(',').map(e => e.trim()).filter(e => e.length > 0);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const tokens = entry.split(/\s+/);

    let name: string;
    let version: string | undefined;

    // If the last token starts with a digit, treat it as a version
    if (tokens.length > 1 && /^\d/.test(tokens[tokens.length - 1])) {
      version = tokens[tokens.length - 1];
      name = tokens.slice(0, -1).join(' ');
    } else {
      name = entry;
    }

    // Classify as language or technology
    const nameNormalized = name.toLowerCase();
    const isLanguage = KNOWN_LANGUAGES.has(nameNormalized);

    const hint: ParsedCoreTechEntry = {};
    if (isLanguage) {
      hint.language = name;
    } else {
      hint.technology = name;
    }
    if (version) {
      hint.version = version;
    }

    result[String(i)] = hint;
  }

  return result;
}
