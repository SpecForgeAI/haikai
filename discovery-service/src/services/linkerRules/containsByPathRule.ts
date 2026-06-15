/**
 * ContainsByPathRule (Phase 1b Linker Rule)
 *
 * Matches `file_structure` atoms where one `relativePath` is a
 * directory-prefix of another. Produces `contains` relationships
 * at 1.0 confidence -- purely structural and deterministic.
 */

import { EvidenceAtom, FileStructureData } from '../../types/evidenceAtom';
import { ContainsRelationshipData } from '../../types/relationship';
import { LinkerRule, CandidateRelationship } from '../../types/linkerRule';

/**
 * ContainsByPathRule linker rule instance.
 */
export const containsByPathRule: LinkerRule = {
  id: 'contains-by-path',
  name: 'Contains By Path',
  description: 'Matches file_structure atoms where one relativePath is a directory-prefix of another, producing contains relationships at 1.0 confidence.',
  targetRelationshipType: 'contains',

  match(atoms: EvidenceAtom[]): CandidateRelationship[] {
    const candidates: CandidateRelationship[] = [];

    // Filter to file_structure atoms only
    const fileAtoms = atoms.filter(a => a.type === 'file_structure');

    for (let i = 0; i < fileAtoms.length; i++) {
      for (let j = 0; j < fileAtoms.length; j++) {
        if (i === j) continue;

        const containerData = fileAtoms[i].data as FileStructureData;
        const containedData = fileAtoms[j].data as FileStructureData;

        const containerPath = containerData.relativePath;
        const containedPath = containedData.relativePath;

        // Check if containerPath is a directory prefix of containedPath
        // containerPath must be a proper prefix (not equal) and must end at a directory boundary
        if (
          containedPath.startsWith(containerPath) &&
          containedPath.length > containerPath.length &&
          (containerPath.endsWith('/') || containedPath[containerPath.length] === '/')
        ) {
          // Check this is a direct parent (no intermediate directories between them)
          const remainder = containedPath.slice(
            containerPath.endsWith('/') ? containerPath.length : containerPath.length + 1
          );

          // Direct containment: no additional '/' in the remainder
          if (!remainder.includes('/')) {
            const data: ContainsRelationshipData = {
              containerPath: containerPath,
              containedPath: containedPath,
            };

            candidates.push({
              sourceAtomId: fileAtoms[i].id,
              targetAtomId: fileAtoms[j].id,
              relationshipType: 'contains',
              confidence: 1.0,
              data,
              ruleId: 'contains-by-path',
            });
          }
        }
      }
    }

    return candidates;
  },
};
