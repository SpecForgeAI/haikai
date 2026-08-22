/**
 * modelScope guard (Foundations Spec 1, 2026-08-22) — the architecture
 * test behind persistence ruling OPTION (a): the raw
 * `physical_data_entities` collection may only be read through the
 * modelScope accessors (`allEntities` / `inScopeEntities`), so a
 * downstream consumer can never silently leak excluded entities into
 * target artifacts.
 *
 * RATCHET semantics: the baseline below freezes the files that already
 * touched the raw key when the guard landed. A NEW file mentioning it
 * fails this test — either read through the accessors or (for writers /
 * wire builders that legitimately construct the key) consciously add the
 * file to the baseline in the same PR. Files migrated to the accessors
 * SHOULD be removed from the baseline (the ratchet only tightens).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..');

const BASELINE = new Set<string>([
  'src/api/discoveryApi.ts',
  'src/api/implementContextApi.ts',
  'src/components/DiagramsView/AdvancedAddDialog.tsx',
  'src/components/DiagramsView/ER/LogicalErCreateModal.tsx',
  'src/components/DiagramsView/PaletteContextMenu.tsx',
  'src/components/DiagramsView/PalettePanel.tsx',
  'src/components/DiagramsView/PalettePanel_tmp.tsx',
  'src/components/DiagramsView/SelectionInspector.tsx',
  'src/components/DiagramsView/SequenceDiagramRenderer.tsx',
  'src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx',
  'src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx',
  'src/components/Discovery/BulkCandidateActionConfirmModal.tsx',
  'src/components/Discovery/DiscoveryReviewRoom.tsx',
  'src/components/Discovery/batchResolveConflictsSupport.ts',
  // Conscious adds (2026-08-22, foundations receipts): both compare
  // DiscoveryCandidateDto.candidate_type === 'physical_data_entities' on the
  // CANDIDATE plane — neither reads the raw model collection this ratchet
  // protects. foundationRules.ts predates this PR as an unnoticed offender.
  'src/components/Discovery/foundations/foundationRules.ts',
  'src/components/DashboardView/DiscoveryCandidateTable.tsx',
  'src/components/Discovery/resolveBulkActionSet.ts',
  'src/components/Grid/Grid.tsx',
  'src/components/Grid/GridCell.tsx',
  'src/components/Grid/RelationshipGrid.tsx',
  'src/components/Import/CherryPickMergeModal.tsx',
  'src/components/ProductView/FeatureDefinitionPanel.tsx',
  'src/config/defaults.ts',
  'src/config/gridConfigs.ts',
  'src/config/relationshipDefinitions.ts',
  'src/contexts/ArchitectureContext.tsx',
  'src/types/config.ts',
  'src/types/model.ts',
  'src/utils/advancedAddRelationships.ts',
  'src/utils/applicationPointSync.ts',
  'src/utils/businessPointSync.ts',
  'src/utils/contextBundleTypes.ts',
  'src/utils/contextHeuristics.ts',
  'src/utils/contextPickListBuilders.ts',
  'src/utils/contextPickerDomainMappings.ts',
  'src/utils/contextRelationshipLabelUtils.ts',
  'src/utils/dataEntityPointOptions.ts',
  'src/utils/entityTypeRegistry.ts',
  'src/utils/excelOperations.ts',
  'src/utils/fileOperations.ts',
  'src/utils/idGenerator.ts',
  'src/utils/importMergeUtils.ts',
  'src/utils/infrastructureLayout.ts',
  'src/utils/interfaceCompositeBuilder.ts',
  'src/utils/mappingConfirmationUtils.ts',
  'src/utils/nodeCreation.ts',
  'src/utils/paletteData.ts',
  'src/utils/relationshipUtils.ts',
  'src/utils/rendering.ts',
  'src/utils/resolveDataEntityPointName.ts',
  'src/utils/sanitize.ts',
  'src/utils/sequenceDiagramUtils.ts',
  'src/utils/temporaryDiagramMapping.ts',
  'src/utils/validation.ts',
]);

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/[.](ts|tsx)$/.test(entry.name) && !/[.]test[.](ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

describe('modelScope guard (ratchet)', () => {
  it('no NEW file reads the raw physical_data_entities collection', () => {
    const files: string[] = [];
    walk(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = ('src/' + path.relative(SRC_ROOT, file)).split(path.sep).join('/');
      if (rel === 'src/utils/modelScope.ts') continue;
      if (BASELINE.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('physical_data_entities')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
