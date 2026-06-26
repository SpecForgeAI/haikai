/**
 * Decisions-file import parser + per-line validator.
 *
 * Spec: 2026-06-26-target-state-decisions-file-import (Spec 3 of 3) — FR1 + FR2.
 *
 * PURE: no I/O, no network, no LLM. The route layer (decisionsFileImport.ts)
 * feeds raw uploaded text in and applies the parsed answers.
 *
 * WHAT THIS PARSES
 * ----------------
 * The round-trip source is the "Preview prompt-ready output" emitted by
 * `buildTargetStateDecisionsPromptText` (services/contextResolvers.ts) — grouped
 * markdown whose architecture-wide lines read:
 *
 *     ## Target State Decisions
 *
 *     ### Architecture-wide
 *     - `service.framework` = Spring Boot 4.0
 *     - `db.driver` = pgjdbc 42.7.4
 *
 * ONE tolerant grammar reads that literal export AND forgives hand-edits in
 * Notepad. Per architecture-wide content line it accepts:
 *   - an optional leading `- ` bullet,
 *   - optional backticks around the decision code,
 *   - `=` OR `:` as the code/value separator,
 *   - a trailing ` (standards: <ref>)` suffix (dropped),
 * and it ignores `##` / `###` header lines and blank lines. A file with NO
 * `### Architecture-wide` header at all (a bare hand-authored list) is treated as
 * architecture-wide by default, so simplified files still import.
 *
 * v1 SCOPE: only the 51 architecture-wide answers are imported. Per-scope
 * override sections (`### Per-* overrides`), the open-phase `### Additional …` /
 * `### Free-form …` sections, and the `### Lower-level facts …` (Tier-2) section
 * are recorded as SEEN-AND-SKIPPED (reported, not applied) — no silent drop.
 *
 * VALIDATION (FR2, partial-accept): every line is validated against the gateway
 * `questionLibrary`. Valid lines become {@link ParsedDecisionAnswer}; bad lines
 * become {@link DecisionsFileBadLine} (with line number + reason) and the rest of
 * the file is STILL parsed (partial-accept; no all-or-nothing).
 */

import { QUESTION_LIBRARY } from '../../config/architect-conversation/questionLibrary';
import { VERSION_UNKNOWN } from '../../config/architect-conversation/frameworkVersionShape';

// ---------------------------------------------------------------------------
// Bare-stem derivation — a FAITHFUL gateway port of the frontend
// `versionControlConfig.ts` `deriveBareStem` / `isVersionLessStem` (Spec 1).
// The gateway cannot import across the frontend build boundary, so the logic is
// ported; the Spec-1 guard-rail pins the frontend original against the same
// `questionLibrary`, keeping the two in lock-step.
// ---------------------------------------------------------------------------

const VERSION_LESS_STEM_PREFIXES = ['none', 'manual', 'in-house', 'native'] as const;

/** True iff a chip stem is genuinely version-less (no version axis). */
export function isVersionLessStem(stem: string): boolean {
  const s = stem.trim().toLowerCase();
  return VERSION_LESS_STEM_PREFIXES.some(
    (p) => s === p || s.startsWith(`${p} `) || s.startsWith(`${p}-`),
  );
}

/**
 * Strip the trailing VERSION token (a whitespace-separated final token starting
 * with a digit) from a version-laden choice: `Java 21` -> `Java`,
 * `Spring Boot 3.4` -> `Spring Boot`, `MS SQL Server 2022` -> `MS SQL Server`. A
 * choice with no trailing numeric token is already a bare stem (`pgjdbc`,
 * `Pydantic v2`, `native driver pool`).
 */
export function deriveBareStem(choice: string): string {
  const trimmed = choice.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return trimmed;
  const lastToken = trimmed.slice(lastSpace + 1);
  if (/^[0-9]/.test(lastToken)) return trimmed.slice(0, lastSpace).trim();
  return trimmed;
}

// ---------------------------------------------------------------------------
// Per-code lookups, derived once from the question library.
// ---------------------------------------------------------------------------

interface CodeMeta {
  code: string;
  versioned: boolean;
  multi: boolean;
  /** Exact choice strings (for single/multi-choice validation). */
  choices: Set<string>;
  /** Bare stems (for versioned reversal), longest-first for greedy prefix match. */
  stems: string[];
}

const CODE_META: Map<string, CodeMeta> = (() => {
  const map = new Map<string, CodeMeta>();
  for (const entry of QUESTION_LIBRARY) {
    const choices = entry.choices ?? [];
    const stems = Array.from(new Set(choices.map(deriveBareStem))).sort(
      (a, b) => b.length - a.length,
    );
    map.set(entry.code, {
      code: entry.code,
      versioned: entry.versioned === true,
      multi: entry.expectedAnswerShape === 'multi-choice',
      choices: new Set(choices),
      stems,
    });
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** One valid imported answer, ready for the capture-envelope builder. */
export interface ParsedDecisionAnswer {
  decisionCode: string;
  lineNumber: number;
  raw: string;
  /** `framework-version` for versioned codes; `single-choice` otherwise. */
  kind: 'framework-version' | 'single-choice';
  /** Versioned codes: the bare-stem framework + resolved version (`''` when version-less). */
  framework?: string;
  version?: string;
  /** Single/multi-choice codes: the exact choice value (multi joined with `, `). */
  value?: string;
}

export type DecisionsFileBadLineReason =
  | 'unknown_code'
  | 'value_not_in_choices'
  | 'malformed'
  | 'duplicate_code';

/** One rejected line — reported, never silently dropped (FR2). */
export interface DecisionsFileBadLine {
  lineNumber: number;
  raw: string;
  reason: DecisionsFileBadLineReason;
  decisionCode?: string;
  detail: string;
}

export interface ParsedDecisionsFile {
  /** Valid architecture-wide answers (partial-accept). */
  answers: ParsedDecisionAnswer[];
  /** Rejected lines with line number + reason. */
  badLines: DecisionsFileBadLine[];
  /**
   * Non-architecture-wide sections seen and skipped for v1 (e.g.
   * `Per-service overrides`, `Free-form discussion notes`). Reported, not applied.
   */
  skippedSections: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const STANDARDS_SUFFIX = /\s*\(standards:[^)]*\)\s*$/i;

/** Reverse a resolved versioned chip (`Spring Boot 4.0`) to `{framework, version}`. */
function reverseVersionedChip(
  meta: CodeMeta,
  value: string,
): { framework: string; version: string } | null {
  for (const stem of meta.stems) {
    if (value === stem) {
      return { framework: stem, version: '' };
    }
    if (value.startsWith(`${stem} `)) {
      const rest = value.slice(stem.length + 1).trim();
      const version = rest === '(version unknown)' ? VERSION_UNKNOWN : rest;
      return { framework: stem, version };
    }
  }
  return null;
}

/** Validate a single/multi-choice value against the code's choices. */
function validateChoiceValue(meta: CodeMeta, value: string): string | null {
  if (meta.multi) {
    const parts = value.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length > 0 && parts.every((p) => meta.choices.has(p))) {
      return parts.join(', ');
    }
    return null;
  }
  return meta.choices.has(value) ? value : null;
}

/**
 * Parse + validate a decisions-file's raw text. Pure; partial-accept; never
 * throws. v1 imports the architecture-wide answers only.
 */
export function parseDecisionsFile(text: string): ParsedDecisionsFile {
  const answers: ParsedDecisionAnswer[] = [];
  const badLines: DecisionsFileBadLine[] = [];
  const skippedSections: string[] = [];
  const seenCodes = new Set<string>();
  const seenSkipped = new Set<string>();

  // Default section is architecture-wide so a bare hand-authored list (no
  // headers) still imports.
  let inArchitectureWide = true;

  const rawLines = (text ?? '').split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const line = rawLines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Section headers. `### X` switches the active section; `## X` (the title)
    // is ignored without changing the section.
    if (trimmed.startsWith('###')) {
      const headerText = trimmed.replace(/^#+\s*/, '').trim();
      if (/^architecture-wide$/i.test(headerText)) {
        inArchitectureWide = true;
      } else {
        inArchitectureWide = false;
        if (!seenSkipped.has(headerText)) {
          seenSkipped.add(headerText);
          skippedSections.push(headerText);
        }
      }
      continue;
    }
    if (trimmed.startsWith('##')) continue; // the `## Target State Decisions` title

    // Content lines outside architecture-wide are skipped (section already noted).
    if (!inArchitectureWide) continue;

    // Strip an optional leading `- ` / `* ` bullet, then a trailing standards ref.
    let body = trimmed.replace(/^[-*]\s+/, '');
    body = body.replace(STANDARDS_SUFFIX, '').trim();

    // `[`]code[`] (= | :) value` — backticks optional, `=` or `:` separator.
    const m = body.match(/^`?([A-Za-z0-9_.-]+)`?\s*[=:]\s*(.+)$/);
    if (!m) {
      badLines.push({
        lineNumber,
        raw: line,
        reason: 'malformed',
        detail: 'Expected `code = value` (e.g. `service.framework = Spring Boot 4.0`).',
      });
      continue;
    }

    const code = m[1].trim();
    const value = m[2].trim();
    const meta = CODE_META.get(code);
    if (!meta) {
      badLines.push({
        lineNumber,
        raw: line,
        reason: 'unknown_code',
        decisionCode: code,
        detail: `'${code}' is not a known target-state decision code.`,
      });
      continue;
    }
    if (seenCodes.has(code)) {
      badLines.push({
        lineNumber,
        raw: line,
        reason: 'duplicate_code',
        decisionCode: code,
        detail: `'${code}' already appears earlier in the file.`,
      });
      continue;
    }

    if (meta.versioned) {
      const fv = reverseVersionedChip(meta, value);
      if (!fv) {
        badLines.push({
          lineNumber,
          raw: line,
          reason: 'value_not_in_choices',
          decisionCode: code,
          detail: `'${value}' is not a valid option for '${code}'.`,
        });
        continue;
      }
      seenCodes.add(code);
      answers.push({
        decisionCode: code,
        lineNumber,
        raw: line,
        kind: 'framework-version',
        framework: fv.framework,
        version: fv.version,
      });
    } else {
      const validated = validateChoiceValue(meta, value);
      if (validated === null) {
        badLines.push({
          lineNumber,
          raw: line,
          reason: 'value_not_in_choices',
          decisionCode: code,
          detail: `'${value}' is not a valid option for '${code}'.`,
        });
        continue;
      }
      seenCodes.add(code);
      answers.push({
        decisionCode: code,
        lineNumber,
        raw: line,
        kind: 'single-choice',
        value: validated,
      });
    }
  }

  return { answers, badLines, skippedSections };
}

/** The full set of architecture-wide decision codes (for "all answered" checks). */
export function allDecisionCodes(): string[] {
  return Array.from(CODE_META.keys());
}
