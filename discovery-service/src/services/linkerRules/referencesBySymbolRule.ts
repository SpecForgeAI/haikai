/**
 * ReferencesBySymbolRule (Phase 1b Linker Rule)
 *
 * Catch-all rule that finds `string_pattern` atoms referencing `symbol`
 * atom names that are NOT already matched by more specific rules
 * (imports/extends). Produces `references` relationships at lower
 * confidence (0.3-0.6), which are more likely to generate DecisionTasks
 * or be auto-discarded.
 */

import { EvidenceAtom, StringPatternData, SymbolData } from '../../types/evidenceAtom';
import { ReferencesRelationshipData } from '../../types/relationship';
import { LinkerRule, CandidateRelationship } from '../../types/linkerRule';

/**
 * Pattern names that are handled by more specific rules (imports, extends).
 * This rule excludes these patterns to avoid duplicate relationship proposals.
 */
const EXCLUDED_PATTERN_NAMES = [
  'import_statement',
  'require_statement',
];

/**
 * Pattern names related to inheritance (handled by ExtendsByPatternRule).
 * Checked via substring match on the pattern name.
 */
const INHERITANCE_KEYWORDS = ['extends', 'implements'];

/**
 * ReferencesBySymbolRule linker rule instance.
 */
export const referencesBySymbolRule: LinkerRule = {
  id: 'references-by-symbol',
  name: 'References By Symbol',
  description: 'Catch-all rule matching string_pattern atoms referencing symbol names not captured by more specific rules, producing references relationships at 0.3-0.6 confidence.',
  targetRelationshipType: 'references',

  match(atoms: EvidenceAtom[]): CandidateRelationship[] {
    const candidates: CandidateRelationship[] = [];

    // Filter to string_pattern atoms NOT already handled by imports/extends rules
    const patternAtoms = atoms.filter(a => {
      if (a.type !== 'string_pattern') return false;
      const patternName = (a.data as StringPatternData).patternName;

      // Exclude import/require patterns (handled by ImportsByPatternRule)
      if (EXCLUDED_PATTERN_NAMES.includes(patternName)) return false;

      // Exclude inheritance patterns (handled by ExtendsByPatternRule)
      const lowerName = patternName.toLowerCase();
      if (INHERITANCE_KEYWORDS.some(kw => lowerName.includes(kw))) return false;

      return true;
    });

    // Filter to symbol atoms
    const symbolAtoms = atoms.filter(a => a.type === 'symbol');

    for (const patternAtom of patternAtoms) {
      const patternData = patternAtom.data as StringPatternData;

      for (const symbolAtom of symbolAtoms) {
        const symbolData = symbolAtom.data as SymbolData;

        // Skip if symbol name is too short to avoid false positives
        if (symbolData.name.length < 2) continue;

        if (patternData.matchedText.includes(symbolData.name)) {
          // Lower confidence for catch-all references
          // Exact word boundary match gets higher confidence (0.5)
          // Partial/substring match gets lower confidence (0.3)
          const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(symbolData.name)}\\b`);
          const isExactMatch = wordBoundaryRegex.test(patternData.matchedText);
          const confidence = isExactMatch ? 0.5 : 0.3;

          const data: ReferencesRelationshipData = {
            referenceContext: patternData.contextSnippet || patternData.matchedText,
            line: patternData.line,
          };

          candidates.push({
            sourceAtomId: patternAtom.id,
            targetAtomId: symbolAtom.id,
            relationshipType: 'references',
            confidence,
            data,
            ruleId: 'references-by-symbol',
          });
        }
      }
    }

    return candidates;
  },
};

/**
 * Escapes special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
