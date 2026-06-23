/**
 * Deterministic project-wide GLOBAL date-format resolver (Spring Classic,
 * Signal #2).
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction -- Task Group 2.
 *
 * Classic Spring code keeps the wire date format in ONE of a small number of
 * converter-level places, NOT on every field. This pass resolves a SINGLE
 * project-wide pattern via a strict PRECEDENCE LADDER and tags it with the
 * winning `source` + a `confidence`:
 *
 *   (1) `spring.jackson.date-format` (application.properties / application.yml)
 *   (2) `ObjectMapper.setDateFormat("...")` / `Jackson2ObjectMapperBuilder`
 *       `.simpleDateFormat("...")` in a `@Configuration`
 *   (3) `@InitBinder` + `CustomDateEditor` /
 *       `registerCustomEditor(Date.class, new SimpleDateFormat("..."))`
 *   (4) a bare `new SimpleDateFormat("...")` / `DateTimeFormatter.ofPattern("...")`
 *       literal
 *
 * The HIGHER rank wins. A same-rank disagreement takes the FIRST candidate in
 * stable file order and LOWERS the confidence (the spec deliberately surfaces
 * exactly ONE value; disagreeing siblings are not all reported).
 *
 * The pass is PURE (reads the supplied `SourceFileIR[]` only). Properties / yml
 * + `@Configuration` are read structurally from config content; the method-body
 * cases (`@InitBinder` / `new SimpleDateFormat` / `ofPattern`) reuse the proven
 * `rawContent`-regex idiom from `responseContractScanner.parseSecurityJavaConfig`
 * (iterate files, gate on `.java` + a marker substring, regex the body). The
 * idiom is REPLICATED here (not imported) to avoid a module cycle.
 *
 * This is distinct from the per-import `old_date_time_api` CVE flag in
 * `javaFindingScanner.ts` (that flag stays untouched): this pass resolves the
 * project's ACTUAL wire date format, it does not flag a risky import.
 */

import type { SourceFileIR } from '../../languageIR';

/** The single resolved project-wide date format. */
export interface GlobalDateFormat {
  /** The concrete pattern string, e.g. `dd-MMM-yyyy`. */
  format: string;
  /** Which ladder rung resolved it (human label; carries the rank context). */
  source: string;
  /** Confidence in [0,1]; highest at rank 1, lowered on a same-rank tie. */
  confidence: number;
}

/** A candidate hit before precedence resolution. */
interface FormatCandidate {
  format: string;
  source: string;
  /** Ladder rank (1 = highest precedence). */
  rank: number;
  /** Stable file order index (lower = earlier) for the same-rank tiebreak. */
  fileOrder: number;
}

// Per-rank base confidence (highest at the top of the ladder).
const RANK_CONFIDENCE: Record<number, number> = {
  1: 0.95,
  2: 0.9,
  3: 0.85,
  4: 0.7,
};
// Penalty applied when a same-rank disagreement forces a deterministic pick.
const TIEBREAK_PENALTY = 0.15;

// ---------------------------------------------------------------------------
// Small shared helpers.
// ---------------------------------------------------------------------------

/**
 * Whether a file path is a Spring config file (`application[-profile].{yml,
 * yaml,properties}`). Replicates `languageExtractors/java/fileFilter.isConfigFile`
 * (which is not exported) so this module stays self-contained.
 */
function isConfigFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  return /^application(-[\w-]+)?\.(yml|yaml|properties)$/.test(fileName);
}

function rawOf(file: SourceFileIR): string {
  return typeof file.rawContent === 'string' ? file.rawContent : '';
}

// ---------------------------------------------------------------------------
// Rank 1: spring.jackson.date-format in application.properties / yml.
// ---------------------------------------------------------------------------

/**
 * Read `spring.jackson.date-format` from a config file's raw content. Handles
 * both the flat `.properties` form (`spring.jackson.date-format=dd-MMM-yyyy`)
 * and the nested YAML form (`spring:` -> `jackson:` -> `date-format: ...`).
 */
function readPropertiesDateFormat(file: SourceFileIR): string | null {
  const raw = rawOf(file);
  if (!raw) return null;

  // Flat .properties (also matches the inline `spring.jackson.date-format` key
  // some YAML files use). Allow `=` or `:` as the separator.
  const flat = /(?:^|\n)\s*spring\.jackson\.date-format\s*[:=]\s*([^\r\n#]+)/.exec(raw);
  if (flat) {
    const v = flat[1].trim().replace(/^["']|["']$/g, '').trim();
    if (v) return v;
  }

  // Nested YAML: spring: / jackson: / date-format: <value>. Tolerant of
  // arbitrary indentation; requires the three keys in order.
  const nested =
    /spring\s*:[\s\S]*?\bjackson\s*:[\s\S]*?\bdate-format\s*:\s*([^\r\n#]+)/.exec(raw);
  if (nested) {
    const v = nested[1].trim().replace(/^["']|["']$/g, '').trim();
    if (v) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rank 2: ObjectMapper.setDateFormat / Jackson2ObjectMapperBuilder in @Configuration.
// ---------------------------------------------------------------------------

/**
 * Read a date pattern off a Jackson configuration body:
 *   - `mapper.setDateFormat(new SimpleDateFormat("yyyy/MM/dd"))`
 *   - `Jackson2ObjectMapperBuilder...simpleDateFormat("yyyy/MM/dd")`
 *   - `builder.setDateFormat(new SimpleDateFormat("..."))`
 * Gated on the file looking like a Jackson @Configuration (`setDateFormat`
 * / `simpleDateFormat` marker) so a stray match elsewhere is not promoted.
 */
function readConfigSetDateFormat(raw: string): string | null {
  // setDateFormat(new SimpleDateFormat("PATTERN"))
  const setFmt =
    /setDateFormat\s*\(\s*new\s+SimpleDateFormat\s*\(\s*"([^"]+)"/.exec(raw);
  if (setFmt) return setFmt[1];
  // Jackson2ObjectMapperBuilder().simpleDateFormat("PATTERN")
  const builder = /\.simpleDateFormat\s*\(\s*"([^"]+)"/.exec(raw);
  if (builder) return builder[1];
  return null;
}

// ---------------------------------------------------------------------------
// Rank 3: @InitBinder + CustomDateEditor / registerCustomEditor(Date.class, ...).
// ---------------------------------------------------------------------------

/**
 * Read a date pattern off an `@InitBinder` registration:
 *   - `binder.registerCustomEditor(Date.class, new CustomDateEditor(new SimpleDateFormat("..."), true))`
 *   - `new CustomDateEditor(new SimpleDateFormat("..."), ...)`
 * Gated on the `@InitBinder` marker being present in the file.
 */
function readInitBinderDateFormat(raw: string): string | null {
  // The pattern lives in the SimpleDateFormat fed to the CustomDateEditor.
  const editor =
    /CustomDateEditor\s*\(\s*new\s+SimpleDateFormat\s*\(\s*"([^"]+)"/.exec(raw);
  if (editor) return editor[1];
  // registerCustomEditor(Date.class, new SimpleDateFormat("..."))  (rare direct form)
  const direct =
    /registerCustomEditor\s*\([^,]*Date\.class[^,]*,\s*new\s+SimpleDateFormat\s*\(\s*"([^"]+)"/.exec(
      raw,
    );
  if (direct) return direct[1];
  return null;
}

// ---------------------------------------------------------------------------
// Rank 4: bare new SimpleDateFormat("...") / DateTimeFormatter.ofPattern("...").
// ---------------------------------------------------------------------------

function readBareLiteral(raw: string): string | null {
  const sdf = /new\s+SimpleDateFormat\s*\(\s*"([^"]+)"/.exec(raw);
  if (sdf) return sdf[1];
  const ofPattern = /DateTimeFormatter\s*\.\s*ofPattern\s*\(\s*"([^"]+)"/.exec(raw);
  if (ofPattern) return ofPattern[1];
  return null;
}

// ---------------------------------------------------------------------------
// Candidate collection (one pass over files, all ranks).
// ---------------------------------------------------------------------------

function collectCandidates(files: SourceFileIR[]): FormatCandidate[] {
  const candidates: FormatCandidate[] = [];

  files.forEach((file, fileOrder) => {
    // Rank 1: properties / yml config keys.
    if (isConfigFile(file.filePath)) {
      const fmt = readPropertiesDateFormat(file);
      if (fmt) {
        candidates.push({
          format: fmt,
          source: `spring.jackson.date-format (${file.filePath})`,
          rank: 1,
          fileOrder,
        });
      }
      return; // a config file carries no Java method bodies.
    }

    const lower = file.filePath.toLowerCase();
    if (!lower.endsWith('.java')) return;
    const raw = rawOf(file);
    if (!raw) return;

    // Rank 2: @Configuration Jackson date-format. Gate on the marker so a
    // method-local SimpleDateFormat is not mis-ranked as a config bean.
    if (raw.includes('setDateFormat') || raw.includes('simpleDateFormat')) {
      const fmt = readConfigSetDateFormat(raw);
      if (fmt) {
        candidates.push({
          format: fmt,
          source: `ObjectMapper.setDateFormat (${file.filePath})`,
          rank: 2,
          fileOrder,
        });
        return;
      }
    }

    // Rank 3: @InitBinder + CustomDateEditor.
    if (raw.includes('@InitBinder') || raw.includes('InitBinder')) {
      if (raw.includes('CustomDateEditor') || raw.includes('registerCustomEditor')) {
        const fmt = readInitBinderDateFormat(raw);
        if (fmt) {
          candidates.push({
            format: fmt,
            source: `@InitBinder CustomDateEditor (${file.filePath})`,
            rank: 3,
            fileOrder,
          });
          return;
        }
      }
    }

    // Rank 4: a bare SimpleDateFormat / ofPattern literal anywhere in the body.
    if (
      raw.includes('SimpleDateFormat') ||
      raw.includes('ofPattern')
    ) {
      const fmt = readBareLiteral(raw);
      if (fmt) {
        candidates.push({
          format: fmt,
          source: `bare SimpleDateFormat/ofPattern (${file.filePath})`,
          rank: 4,
          fileOrder,
        });
      }
    }
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// Public resolver.
// ---------------------------------------------------------------------------

/**
 * Resolve the ONE project-wide date format via the precedence ladder, or null
 * when nothing resolves. Pure. The higher rank wins; a same-rank disagreement
 * takes the first in stable file order and lowers the confidence.
 */
export function resolveGlobalDateFormat(
  files: SourceFileIR[],
): GlobalDateFormat | null {
  const candidates = collectCandidates(files);
  if (candidates.length === 0) return null;

  // Best rank wins (rank 1 is highest precedence -> smallest number).
  const bestRank = Math.min(...candidates.map((c) => c.rank));
  const atBest = candidates
    .filter((c) => c.rank === bestRank)
    .sort((a, b) => a.fileOrder - b.fileOrder);

  const winner = atBest[0];
  const base = RANK_CONFIDENCE[winner.rank] ?? 0.6;

  // A same-rank disagreement (two distinct formats at the winning rank) forces a
  // deterministic first-in-file-order pick at a LOWER confidence.
  const distinctFormats = new Set(atBest.map((c) => c.format));
  const ambiguous = distinctFormats.size > 1;
  const confidence = ambiguous
    ? Math.max(0, Number((base - TIEBREAK_PENALTY).toFixed(4)))
    : base;

  return {
    format: winner.format,
    source: ambiguous ? `${winner.source} [ambiguous: first of ${distinctFormats.size}]` : winner.source,
    confidence,
  };
}
