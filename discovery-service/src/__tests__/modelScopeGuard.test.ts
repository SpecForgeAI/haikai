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


import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..');

const BASELINE = new Set<string>([
  'src/constants/candidateTypes.ts',
  'src/scl/effectCandidateEmitter.ts',
  'src/services/candidateIdentity.ts',
  'src/services/candidateMerge.ts',
  // Candidate-TYPE discriminator only (`candidateType === 'physical_data_entities'`
  // on the DB run's own candidates — Oracle Nine item 2 sequence-idiom
  // enrichment). Never reads the raw model collection.
  'src/services/runManager.ts',
  'src/services/databasePacks/DatabaseDiscoveryPack.ts',
  'src/services/databasePacks/candidateStructuralFidelity.ts',
  'src/services/databasePacks/postgres/PostgresDiscoveryPack.ts',
  'src/services/databasePacks/sybase/SybaseDiscoveryPack.ts',
  'src/services/discoveryV3Pipeline.ts',
  'src/services/extensionPacks/frameworkAdapters/aspNetCore/index.ts',
  'src/services/extensionPacks/frameworkAdapters/django/index.ts',
  'src/services/extensionPacks/frameworkAdapters/flask/index.ts',
  'src/services/extensionPacks/frameworkAdapters/kratos/index.ts',
  'src/services/extensionPacks/frameworkAdapters/magento/index.ts',
  'src/services/extensionPacks/frameworkAdapters/nestjs/index.ts',
  'src/services/extensionPacks/frameworkAdapters/rails/index.ts',
  'src/services/extensionPacks/frameworkAdapters/springBoot/index.ts',
  'src/services/extensionPacks/frameworkAdapters/springClassic/index.ts',
  'src/services/extensionPacks/frameworkAdapters/symfony/index.ts',
  'src/services/extensionPacks/frameworkAdapters/wordpress/index.ts',
  'src/services/extensionPacks/languagePacks/javaLangPack/index.ts',
  'src/services/findings/databasePackFindingScanners/databasePackFindingBuilders.ts',
  'src/services/findings/evidenceGapScanner.ts',
  'src/services/llmGapFillStep.ts',
  'src/services/performanceHeuristics.ts',
  'src/services/performancePostRun.ts',
  'src/services/prompts/existingEntityIndex.ts',
  'src/services/reviewModel/buildReviewModel.ts',
  'src/services/reviewModel/computeBlastRadiusAndAggregations.ts',
  'src/services/reviewModel/scanSelection.ts',
  'src/services/reviewModel/types.ts',
  'src/types/candidate.ts',
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
      if (rel === 'src/services/modelScope.ts') continue;
      if (BASELINE.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('physical_data_entities')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
