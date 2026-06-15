/**
 * ImportsByPatternRule (Phase 1b Linker Rule)
 *
 * Matches `string_pattern` atoms with import-related `patternName`
 * (e.g., `import_statement`, `require_statement`) to `symbol` atoms
 * where `matchedText` contains the symbol's `name`.
 *
 * Confidence scoring:
 * - Exact name match (symbol name appears as a whole word): 0.9
 * - Partial/ambiguous match (symbol name is a substring): 0.5-0.7
 */

import { EvidenceAtom, StringPatternData, SymbolData } from '../../types/evidenceAtom';
import { ImportsRelationshipData } from '../../types/relationship';
import { LinkerRule, CandidateRelationship } from '../../types/linkerRule';

/** Pattern names that indicate import/require statements */
const IMPORT_PATTERN_NAMES = ['import_statement', 'require_statement'];

/**
 * ImportsByPatternRule linker rule instance.
 */
export const importsByPatternRule: LinkerRule = {
  id: 'imports-by-pattern',
  name: 'Imports By Pattern',
  description: 'Matches string_pattern atoms with import-related patternName to symbol atoms where matchedText contains the symbol name, producing imports relationships.',
  targetRelationshipType: 'imports',

  match(atoms: EvidenceAtom[]): CandidateRelationship[] {
    const candidates: CandidateRelationship[] = [];

    // Filter to import-related string_pattern atoms
    const importAtoms = atoms.filter(
      a => a.type === 'string_pattern' &&
        IMPORT_PATTERN_NAMES.includes((a.data as StringPatternData).patternName)
    );

    // Filter to symbol atoms
    const symbolAtoms = atoms.filter(a => a.type === 'symbol');

    for (const importAtom of importAtoms) {
      const patternData = importAtom.data as StringPatternData;

      for (const symbolAtom of symbolAtoms) {
        const symbolData = symbolAtom.data as SymbolData;

        // Skip if symbol name is too short (single character) to avoid false positives
        if (symbolData.name.length < 2) continue;

        if (patternData.matchedText.includes(symbolData.name)) {
          // Determine confidence based on match quality
          // Exact match: the symbol name appears as a whole word boundary match
          const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(symbolData.name)}\\b`);
          const isExactMatch = wordBoundaryRegex.test(patternData.matchedText);
          const confidence = isExactMatch ? 0.9 : 0.6;

          const data: ImportsRelationshipData = {
            importStatement: patternData.matchedText,
            line: patternData.line,
            isDefault: false,
          };

          candidates.push({
            sourceAtomId: importAtom.id,
            targetAtomId: symbolAtom.id,
            relationshipType: 'imports',
            confidence,
            data,
            ruleId: 'imports-by-pattern',
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
