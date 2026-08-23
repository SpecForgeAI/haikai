/**
 * Deterministic log4j/logback ConversionPattern -> LogRecipe translation
 * (Oracle Nine item 9).
 *
 * When the run's config carries the app's ACTUAL logging pattern (e.g.
 * `%d{dd,HH:mm:ss,SSS} %p [%t] [%c{1}] - %m%n`), no model needs to GUESS the
 * record shape: the pattern is a machine-readable grammar and this module
 * translates it mechanically into the same {@link LogRecipe} structure the
 * LLM induction path produces -- start-of-record regex from the rendered
 * timestamp/level/thread prefix (multi-line stack traces fold into their
 * parent record for free), plus the shared TG1 method/path/status field
 * rules applied per record. The LLM induction becomes the FALLBACK for
 * files the declared pattern does not actually match (mixed bundles stay
 * honest: a translated recipe is only accepted when it matches the sampled
 * lines of THAT file).
 *
 * Vendor-generic: log4j 1.x/2.x and logback share this converter syntax;
 * nothing here is estate-specific. Unknown converters degrade to a
 * non-greedy wildcard and are reported, never fatal.
 */

import type {
  LogRecipe,
  RecipeFieldRules,
} from './logRecipeInduction';
import { fingerprintFromBlocks } from './logRecipeInduction';
import type { SampleBlock } from './logPreScanSampler';

/** Regex-escape a literal character sequence. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render a SimpleDateFormat-style date format (the `{...}` argument of `%d`)
 * into a regex source. Named log4j shorthands first; otherwise a mechanical
 * letter-run walk (yyyy -> \d{4}, SSS -> \d{3}, MMM -> [A-Za-z]{3,} ...).
 */
export function renderDateFormatRegex(format: string): string {
  const named: Record<string, string> = {
    ISO8601: String.raw`\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d{3}`,
    ISO8601_BASIC: String.raw`\d{8}T\d{6},\d{3}`,
    ABSOLUTE: String.raw`\d{2}:\d{2}:\d{2}[.,]\d{3}`,
    DATE: String.raw`\d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2}[.,]\d{3}`,
    TIME: String.raw`\d{2}:\d{2}:\d{2}[.,]\d{3}`,
    UNIX: String.raw`\d+`,
    UNIX_MILLIS: String.raw`\d+`,
  };
  const namedHit = named[format.trim()];
  if (namedHit) return namedHit;

  let out = '';
  let i = 0;
  while (i < format.length) {
    const ch = format[i];
    // SimpleDateFormat quoting: '...' is literal; '' is a single quote.
    if (ch === "'") {
      if (format[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      const close = format.indexOf("'", i + 1);
      const literal = close === -1 ? format.slice(i + 1) : format.slice(i + 1, close);
      out += escapeLiteral(literal);
      i = close === -1 ? format.length : close + 1;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let runEnd = i;
      while (runEnd < format.length && format[runEnd] === ch) runEnd += 1;
      const runLen = runEnd - i;
      switch (ch) {
        case 'y':
        case 'Y':
          out += runLen >= 4 ? String.raw`\d{4}` : String.raw`\d{2}`;
          break;
        case 'M':
          out += runLen >= 3 ? String.raw`[A-Za-z]{3,}` : runLen === 2 ? String.raw`\d{2}` : String.raw`\d{1,2}`;
          break;
        case 'd':
        case 'H':
        case 'h':
        case 'k':
        case 'K':
        case 'm':
        case 's':
          out += runLen >= 2 ? String.raw`\d{2}` : String.raw`\d{1,2}`;
          break;
        case 'S':
          out += runLen >= 3 ? String.raw`\d{3}` : String.raw`\d{1,3}`;
          break;
        case 'D':
          out += String.raw`\d{1,3}`;
          break;
        case 'E':
          out += String.raw`[A-Za-z]{2,}`;
          break;
        case 'a':
          out += String.raw`[APap]\.?[Mm]\.?`;
          break;
        case 'G':
          out += String.raw`[A-Za-z]+`;
          break;
        case 'z':
        case 'Z':
        case 'X':
        case 'x':
          out += String.raw`[A-Za-z0-9+\-:]+`;
          break;
        case 'n':
        case 'N':
          out += String.raw`\d+`;
          break;
        default:
          // Unknown format letter: tolerate any non-space run.
          out += String.raw`\S+`;
          break;
      }
      i = runEnd;
      continue;
    }
    out += ch === ' ' ? String.raw`\s` : escapeLiteral(ch);
    i += 1;
  }
  return out;
}

/** Result of walking a ConversionPattern up to its `%m` message converter. */
export interface PatternTranslation {
  /** Regex source matching the rendered line prefix (no leading `^`). */
  prefixSource: string;
  /** True when the pattern contained a message converter (`%m` family). */
  reachedMessage: boolean;
  /** Converter tokens rendered as loose wildcards (unknown to the table). */
  unsupported: string[];
}

/**
 * Converter table, longest names first so `%msg` never half-matches as `%m`
 * + literal. Regex renderings deliberately favour TOLERANT over tight --
 * the prefix's literal separators (brackets, dashes, colons) do the
 * anchoring work.
 */
const CONVERTER_RENDERINGS: Array<{ names: string[]; regex: string | null }> = [
  { names: ['message', 'msg', 'm'], regex: null }, // null = message reached
  { names: ['date', 'd'], regex: '' }, // date handled specially (argument)
  {
    names: ['level', 'p'],
    regex: String.raw`(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE|FINE|FINER|FINEST|CONFIG|ALL|OFF)`,
  },
  { names: ['logger', 'c'], regex: String.raw`[A-Za-z0-9_$.]+` },
  { names: ['class', 'C'], regex: String.raw`[A-Za-z0-9_$.]+` },
  { names: ['thread', 't'], regex: String.raw`.+?` },
  { names: ['file', 'F'], regex: String.raw`[^\s:]+` },
  { names: ['method', 'M'], regex: String.raw`[A-Za-z0-9_$<>]+` },
  { names: ['line', 'L'], regex: String.raw`\d+` },
  { names: ['relative', 'r'], regex: String.raw`\d+` },
  { names: ['sequenceNumber', 'sn'], regex: String.raw`\d+` },
  { names: ['mdc', 'X'], regex: String.raw`.*?` },
  { names: ['marker', 'markerSimpleName'], regex: String.raw`.*?` },
  { names: ['hostName', 'hostname', 'h'], regex: String.raw`[A-Za-z0-9._\-]+` },
  { names: ['processId', 'pid'], regex: String.raw`\d+` },
  { names: ['NDC', 'x'], regex: String.raw`.*?` },
  { names: ['n'], regex: '' }, // line separator: nothing to match inside a line
  { names: ['ex', 'exception', 'throwable', 'xEx', 'xException', 'xThrowable', 'rEx'], regex: '' },
];

/**
 * Walk a log4j/logback ConversionPattern and build a regex for the rendered
 * LINE PREFIX (everything before `%m`). Returns null only for an
 * empty/blank pattern -- unknown converters degrade to wildcards.
 */
export function translateConversionPattern(pattern: string): PatternTranslation | null {
  if (!pattern || pattern.trim().length === 0) return null;
  let out = '';
  const unsupported: string[] = [];
  let reachedMessage = false;
  let i = 0;
  while (i < pattern.length && !reachedMessage) {
    const ch = pattern[i];
    if (ch !== '%') {
      // Literal text: single spaces tolerate padding runs.
      out += ch === ' ' ? String.raw`\s+` : escapeLiteral(ch);
      i += 1;
      continue;
    }
    if (pattern[i + 1] === '%') {
      out += '%';
      i += 2;
      continue;
    }
    // Format modifier: -5, 5, .30, -5.30 ...
    let j = i + 1;
    const modMatch = /^-?\d*(?:\.\d+)?/.exec(pattern.slice(j));
    const hasModifier = modMatch !== null && modMatch[0].length > 0;
    if (modMatch) j += modMatch[0].length;
    // Converter name: longest alphabetic run that the table knows, else the
    // single next letter as an unknown converter.
    let rendering: { names: string[]; regex: string | null } | null = null;
    let nameLen = 0;
    const rest = pattern.slice(j);
    for (const entry of CONVERTER_RENDERINGS) {
      for (const name of entry.names) {
        if (
          rest.startsWith(name) &&
          name.length > nameLen &&
          !/[A-Za-z]/.test(rest.charAt(name.length))
        ) {
          rendering = entry;
          nameLen = name.length;
        }
      }
    }
    let converterToken: string;
    if (rendering) {
      converterToken = rest.slice(0, nameLen);
      j += nameLen;
    } else {
      const letterMatch = /^[A-Za-z]+/.exec(rest);
      converterToken = letterMatch ? letterMatch[0] : '';
      j += converterToken.length;
    }
    // Optional {argument} (repeatable, e.g. %d{...}{UTC}).
    let argument: string | null = null;
    while (pattern[j] === '{') {
      const close = pattern.indexOf('}', j + 1);
      const arg = close === -1 ? pattern.slice(j + 1) : pattern.slice(j + 1, close);
      if (argument === null) argument = arg;
      j = close === -1 ? pattern.length : close + 1;
    }
    if (rendering) {
      if (rendering.regex === null) {
        reachedMessage = true;
      } else if (rendering.names.includes('d')) {
        out += renderDateFormatRegex(argument ?? 'ISO8601');
      } else if (rendering.regex.length > 0) {
        out += hasModifier ? String.raw`\s*` + rendering.regex + String.raw`\s*` : rendering.regex;
      }
    } else if (converterToken.length > 0) {
      unsupported.push(`%${converterToken}`);
      out += String.raw`.*?`;
    } else {
      out += escapeLiteral('%');
    }
    i = j;
  }
  return { prefixSource: out, reachedMessage, unsupported };
}

/**
 * Shared TG1-equivalent field rules applied per record. Group 1 is the value
 * in every rule (the recipe engine's `extractScalar` contract); the path
 * rule may capture an absolute URL -- the engine strips it with
 * `extractPathFromTarget`, exactly like the broadened fallback matcher.
 */
function standardHttpFieldRules(): RecipeFieldRules {
  const target = String.raw`(?:https?:\/\/[^\s"'>,;)\]}]+|\/[^\s"'>,;)\]}]+)`;
  return {
    method: {
      kind: 'regex',
      pattern: String.raw`\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+` + target,
      flags: 'i',
    },
    path: {
      kind: 'regex',
      pattern: String.raw`\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(` + target + ')',
      flags: 'i',
    },
    responseStatus: {
      kind: 'regex',
      pattern: String.raw`(?:\b(?:statusCode|status_code|status|http_status|httpStatus)\s*[=:]\s*|"\s+)(\d{3})\b`,
      flags: 'i',
    },
  };
}

/** Outcome of {@link recipeFromConversionPattern}. */
export type PatternRecipeResult =
  | { status: 'accepted'; recipe: LogRecipe; matchedLineFraction: number }
  | {
      status: 'rejected';
      reason: 'empty_pattern' | 'pattern_unparsable' | 'pattern_no_match' | 'no_samples';
    };

/**
 * Build a validated recipe for ONE file from the configured pattern. The
 * translated prefix regex must actually match the file's sampled lines
 * (>= half the sampled blocks contain a matching record-start line) --
 * otherwise the file does not follow the declared pattern and the caller
 * falls through to recipe reuse / LLM induction, honestly.
 */
export function recipeFromConversionPattern(args: {
  pattern: string;
  blocks: SampleBlock[];
  sourceFilePath: string;
}): PatternRecipeResult {
  const { pattern, blocks, sourceFilePath } = args;
  if (!pattern || pattern.trim().length === 0) return { status: 'rejected', reason: 'empty_pattern' };
  if (!blocks || blocks.length === 0) return { status: 'rejected', reason: 'no_samples' };

  const translation = translateConversionPattern(pattern);
  if (!translation || translation.prefixSource.length === 0) {
    return { status: 'rejected', reason: 'pattern_unparsable' };
  }
  let startRe: RegExp;
  try {
    startRe = new RegExp('^' + translation.prefixSource);
  } catch {
    return { status: 'rejected', reason: 'pattern_unparsable' };
  }

  let matchedBlocks = 0;
  let matchedLines = 0;
  let totalLines = 0;
  for (const block of blocks) {
    const lines = block.text.split('\n').filter((line) => line.trim().length > 0);
    totalLines += lines.length;
    let blockHit = false;
    for (const line of lines) {
      if (startRe.test(line)) {
        matchedLines += 1;
        blockHit = true;
      }
    }
    if (blockHit) matchedBlocks += 1;
  }
  if (matchedBlocks < Math.max(1, Math.ceil(blocks.length / 2))) {
    return { status: 'rejected', reason: 'pattern_no_match' };
  }

  const recipe: LogRecipe = {
    recordDelimiter: { kind: 'start_regex', pattern: '^' + translation.prefixSource },
    fields: standardHttpFieldRules(),
    fingerprint: fingerprintFromBlocks(blocks),
    sourceFileKey: `file:${sourceFilePath}`,
    validationYield: totalLines > 0 ? matchedLines / totalLines : 0,
    llmCallsUsed: 0,
    origin: 'pattern_translation',
  };
  return {
    status: 'accepted',
    recipe,
    matchedLineFraction: totalLines > 0 ? matchedLines / totalLines : 0,
  };
}
