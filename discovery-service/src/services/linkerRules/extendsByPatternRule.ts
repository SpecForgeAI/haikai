/**
 * ExtendsByPatternRule (Phase 1b Linker Rule)
 *
 * Matches `string_pattern` atoms with inheritance-related `patternName`
 * (patterns whose name includes 'extends' or 'implements') to `symbol`
 * atoms with matching `name` and appropriate `kind` (class, interface).
 *
 * Confidence scoring:
 * - Exact name match (symbol name appears as a whole word): 0.9
 * - Partial/ambiguous match (symbol name is a substring): 0.5-0.7
 */

import { EvidenceAtom, StringPatternData, SymbolData } from '../../types/evidenceAtom';
import { ExtendsRelationshipData } from '../../types/relationship';
import { LinkerRule, CandidateRelationship } from '../../types/linkerRule';

/** Symbol kinds that are valid for inheritance/extension relationships */
const INHERITABLE_KINDS = ['class', 'interface'];

/**
 * ExtendsByPatternRule linker rule instance.
 */
export const extendsByPatternRule: LinkerRule = {
  id: 'extends-by-pattern',
  name: 'Extends By Pattern',
  description: 'Matches string_pattern atoms with inheritance-related patternName to symbol atoms with matching name and appropriate kind, producing extends relationships.',
  targetRelationshipType: 'extends',

  match(atoms: EvidenceAtom[]): CandidateRelationship[] {
    const candidates: CandidateRelationship[] = [];

    // Filter to inheritance-related string_pattern atoms
    const extendsAtoms = atoms.filter(a => {
      if (a.type !== 'string_pattern') return false;
      const patternName = (a.data as StringPatternData).patternName.toLowerCase();
      return patternName.includes('extends') || patternName.includes('implements');
    });

    // Filter to symbol atoms with inheritable kinds
    const symbolAtoms = atoms.filter(a => {
      if (a.type !== 'symbol') return false;
      const kind = (a.data as SymbolData).kind.toLowerCase();
      return INHERITABLE_KINDS.includes(kind);
    });

    for (const extendsAtom of extendsAtoms) {
      const patternData = extendsAtom.data as StringPatternData;

      for (const symbolAtom of symbolAtoms) {
        const symbolData = symbolAtom.data as SymbolData;

        // Skip if symbol name is too short to avoid false positives
        if (symbolData.name.length < 2) continue;

        if (patternData.matchedText.includes(symbolData.name)) {
          // Determine confidence based on match quality
          const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(symbolData.name)}\\b`);
          const isExactMatch = wordBoundaryRegex.test(patternData.matchedText);
          const confidence = isExactMatch ? 0.9 : 0.6;

          // Determine the mechanism from the pattern name
          const mechanism = patternData.patternName.toLowerCase().includes('implements')
            ? 'implements'
            : 'extends';

          const data: ExtendsRelationshipData = {
            parentName: symbolData.name,
            childName: patternData.matchedText,
            mechanism,
          };

          candidates.push({
            sourceAtomId: extendsAtom.id,
            targetAtomId: symbolAtom.id,
            relationshipType: 'extends',
            confidence,
            data,
            ruleId: 'extends-by-pattern',
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
