/**
 * SCL pipeline END-TO-END fixture proof (spec 10 of 10, 2026-08-18 design:
 * agent-os/planning/2026-08-18-scl-pipeline-design.md).
 *
 * The program's CI proof over SCAN-SHAPED data: the canned corpus in
 * `fixtures/scl-fixture-corpus.json` is written by discovery-service's
 * `src/scl/__tests__/corpusExport.e2e.test.ts` from a REAL sliceProject +
 * assembleCorpus run over the fixture legacy app, in the exact SclContractDto
 * wire shape AMS returns (snake_case, body_json). This test drives that data
 * through the whole gateway pipeline, all deterministic, zero network:
 *
 *   corpus → deriveCorpusPlan (spec 7)
 *          → runSclSpecCarriage (spec 8: complete spec, decisions cited,
 *            TDD criteria, NO captured examples)
 *          → generateSclTestSuite (spec 9: the red suite — behaviour tests
 *            for the HierarchyViewProvider chain, fixture builders for
 *            HierarchyViewDetail, golden paths for ViewResource)
 *          → manifest hashes byte-stable across two runs (spec 10's
 *            first-commit delivery depends on that determinism).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SclContractDto,
  SclCorpusPlan,
  SclPlannedStory,
  deriveCorpusPlan,
} from '../services/sclCorpusPlanner';
import { runSclSpecCarriage } from '../services/sclSpecCarriage';
import { generateSclTestSuite } from '../services/sclTestSuiteGenerator';
import type {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from '../services/migrationShapeSpecGenerationHandler';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

// ---------------------------------------------------------------------------
// The canned corpus (scan-shaped wire data)
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'scl-fixture-corpus.json');

function loadCorpus(): SclContractDto[] {
  const doc = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as {
    contracts: SclContractDto[];
  };
  return doc.contracts;
}

const VIEW_RESOURCE = 'com.legacy.hier.api.ViewResource';

// ---------------------------------------------------------------------------
// Fixture modernize.* decisions (the confirmed conversation output)
// ---------------------------------------------------------------------------

function decision(
  code: string,
  summary: string
): TargetStateCapturedDecision {
  return {
    decisionId: `d-${code}`,
    projectId: 'proj-001',
    targetArchitectureId: 'arch-target-001',
    decisionCode: code,
    scopeKind: 'architecture',
    scopeRefId: null,
    answerValue: summary,
    answerSummary: summary,
    createdAt: '2026-08-18T00:00:00Z',
    createdByTask: 'scl-modernization-review',
  };
}

const DECISIONS: TargetStateCapturedDecision[] = [
  decision(
    'modernize.http.jaxrs-annotations',
    'JAX-RS resource annotations -> Spring MVC annotations'
  ),
  decision('modernize.dto.pojo-record', 'POJOs -> Java records'),
];

// ---------------------------------------------------------------------------
// Story/baseRow adapters (planner story -> the carriage's blob-item shape)
// ---------------------------------------------------------------------------

function toLoadedStory(planned: SclPlannedStory, id: string): LoadedBookOfWorkItem {
  return {
    id,
    type: 'story',
    parentId: null,
    title: planned.title,
    sequenceOrder: 1,
    workItemId: `wi-${id}`,
    tags: ['provenance:plan-deterministic', 'provenance:scl_corpus', ...planned.tags],
    codeStoryKind: planned.layer.startsWith('endpoint:')
      ? 'scl-endpoint-group'
      : 'scl-foundation',
    sclContractKeys: planned.contractKeys,
    sclLayer: planned.layer,
    sclControllerClass: planned.controllerClass ?? null,
    sclRowCount: planned.rowCount,
  } as LoadedBookOfWorkItem;
}

function baseRow(workItemId: string): MigrationStorySpecGenerationDto {
  return {
    projectId: 'proj-001',
    workItemId,
    bookOfWorkId: 'book-001',
    bookItemId: `item-${workItemId}`,
    status: 'failed',
    confidence: null,
    predictedReadiness: null,
    generatedSpecText: null,
    warningsJson: null,
    missingInputsJson: null,
    focusedContextRefsJson: null,
    evidenceRefsJson: null,
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: 'test',
    generationPass: 1,
  } as MigrationStorySpecGenerationDto;
}

function resolveContracts(
  contracts: SclContractDto[],
  keys: string[]
): SclContractDto[] {
  const byKey = new Map(contracts.map((c) => [c.contract_key as string, c]));
  return keys.map((k) => byKey.get(k)).filter((c): c is SclContractDto => !!c);
}

// ---------------------------------------------------------------------------

describe('SCL pipeline end-to-end (canned corpus → plan → spec → red suite)', () => {
  const contracts = loadCorpus();
  let plan: SclCorpusPlan;
  let viewGroup: SclPlannedStory;
  let dtoShapes: SclPlannedStory;

  beforeAll(() => {
    plan = deriveCorpusPlan(contracts);
    const found = plan.externalEndpointGroups.find(
      (s) => s.controllerClass === VIEW_RESOURCE
    );
    const dto = plan.foundationStories.find((s) => s.layer === 'dto-shapes');
    expect(found).toBeDefined();
    expect(dto).toBeDefined();
    viewGroup = found as SclPlannedStory;
    dtoShapes = dto as SclPlannedStory;
  });

  // -------------------------------------------------------------------------
  // 1. Plan derivation (spec 7) over the scan-shaped corpus
  // -------------------------------------------------------------------------

  it('derives the ViewResource external group with its vertical residue, plus the dto-shapes foundation layer', () => {
    // The two JAX-RS endpoints of ViewResource...
    expect(viewGroup.title).toContain('ViewResource');
    expect(viewGroup.tags).toContain('scl:endpoint:external');
    const symbols = resolveContracts(contracts, viewGroup.contractKeys).map(
      (c) => c.source_symbol
    );
    expect(symbols).toContain(
      `${VIEW_RESOURCE}#getView(String,String,Integer,HttpHeaders)`
    );
    expect(symbols).toContain(
      `${VIEW_RESOURCE}#getAllViews(String,String,HttpHeaders)`
    );
    // ...carry the provider-chain residue (fan-in < 2 verticals ride along).
    expect(
      symbols.some((s) =>
        (s ?? '').startsWith('com.legacy.hier.provider.HierarchyViewProvider#')
      )
    ).toBe(true);

    // The dto-shapes foundation story owns HierarchyViewDetail.
    const dtoSymbols = resolveContracts(contracts, dtoShapes.contractKeys).map(
      (c) => c.source_symbol
    );
    expect(dtoSymbols).toContain('com.legacy.hier.model.HierarchyViewDetail');
  });

  // -------------------------------------------------------------------------
  // 2. Spec carriage (spec 8): complete spec, decisions cited, TDD criteria,
  //    NO captured examples
  // -------------------------------------------------------------------------

  it('produces a complete deterministic endpoint-group spec citing the confirmed decisions', () => {
    const story = toLoadedStory(viewGroup, 'scl-view');
    const row = runSclSpecCarriage({
      story,
      baseRow: baseRow('wi-scl-view'),
      contracts: resolveContracts(contracts, viewGroup.contractKeys),
      decisions: DECISIONS,
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    expect(['generated', 'generated_with_warnings']).toContain(row.status);
    const text = row.generatedSpecText as string;

    // Contract blocks — verbatim behaviour tables for the endpoint roots.
    expect(text).toContain('## Contract blocks (verbatim — the construction truth)');
    expect(text).toContain(
      `### Behaviour: ${VIEW_RESOURCE}#getView(String,String,Integer,HttpHeaders)`
    );
    expect(text).toContain('| # | Kind | Condition (verbatim) | Outcome | Gloss |');

    // Confirmed decisions cited — the HTTP-idiom decision is relevant to an
    // endpoint group.
    expect(text).toContain('[decision:modernize.http.jaxrs-annotations]');

    // TDD acceptance criteria (round-3 ruling verbatim posture).
    expect(text).toContain('## Acceptance criteria');
    expect(text).toContain('committed to this branch BEFORE implementation');
    expect(text).toContain('NO shipped test file was modified');
    expect(text).toContain('CONTESTED');

    // Captured examples are gone from spec construction ENTIRELY.
    expect(text).not.toContain('Captured examples');
  });

  it('produces the dto-shapes foundation spec with normative shape tables citing the record decision', () => {
    const story = toLoadedStory(dtoShapes, 'scl-dto');
    const row = runSclSpecCarriage({
      story,
      baseRow: baseRow('wi-scl-dto'),
      contracts: resolveContracts(contracts, dtoShapes.contractKeys),
      decisions: DECISIONS,
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    expect(['generated', 'generated_with_warnings']).toContain(row.status);
    const text = row.generatedSpecText as string;
    expect(text).toContain('### Shape: com.legacy.hier.model.HierarchyViewDetail');
    expect(text).toContain('| Field | Kind | Nullable | Wire name | Source carrier | Notes |');
    expect(text).toContain('[decision:modernize.dto.pojo-record]');
    expect(text).not.toContain('Captured examples');
  });

  // -------------------------------------------------------------------------
  // 3. Suite generation (spec 9): the red suite for the endpoint group +
  //    fixture builders from the dto-shapes/test-kit side
  // -------------------------------------------------------------------------

  function generateFor(planned: SclPlannedStory) {
    return generateSclTestSuite({
      story: {
        title: planned.title,
        sclContractKeys: planned.contractKeys,
        layer: planned.layer,
        controllerClass: planned.controllerClass ?? null,
        tags: planned.tags,
      },
      // Resolution set = the WHOLE corpus (ref:S-key fixture targets resolve).
      contracts,
      basePackage: 'com.example.app',
    });
  }

  it('generates the endpoint-group red suite: HierarchyViewProvider-chain behaviour tests + ViewResource golden paths', () => {
    const suite = generateFor(viewGroup);
    const paths = suite.files.map((f) => f.path);

    // Behaviour tests for the provider chain behind the endpoints.
    expect(
      paths.some((p) =>
        p.includes('behaviour/HierarchyViewProvider_getView')
      )
    ).toBe(true);
    expect(
      paths.some((p) =>
        p.includes('behaviour/HierarchyViewProvider_getAllViews')
      )
    ).toBe(true);
    // The endpoint roots themselves get per-row behaviour suites too.
    expect(paths.some((p) => p.includes('behaviour/ViewResource_getView'))).toBe(true);

    // Golden paths — one MockMvc test per distinct root-level outcome label.
    const golden = suite.files.find((f) =>
      f.path.endsWith('golden/ViewResourceGoldenPathsTest.java')
    );
    expect(golden).toBeDefined();
    expect(golden!.content).toContain('class ViewResourceGoldenPathsTest');
    expect(suite.stats.goldenPaths).toBeGreaterThan(0);
    expect(suite.stats.rowTests).toBeGreaterThan(0);

    // Every file is accounted for in the manifest with a sha256.
    expect(suite.manifest.files.map((f) => f.path).sort()).toEqual([...paths].sort());
    for (const entry of suite.manifest.files) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('generates fixture builders for HierarchyViewDetail from the shape-carrying foundation story', () => {
    const suite = generateFor(dtoShapes);
    const fixture = suite.files.find((f) =>
      f.path.endsWith('testkit/HierarchyViewDetailFixtures.java')
    );
    expect(fixture).toBeDefined();
    expect(fixture!.content).toContain('class HierarchyViewDetailFixtures');
    expect(fixture!.content).toContain('public static HierarchyViewDetail aHierarchyViewDetail()');
    expect(suite.stats.fixtureBuilders).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 4. Determinism: manifest hashes byte-stable across two runs (the
  //    first-commit delivery contract)
  // -------------------------------------------------------------------------

  it('manifest + file bytes are identical across two generation runs', () => {
    const first = generateFor(viewGroup);
    const second = generateFor(viewGroup);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.files).toEqual(first.files);

    const dtoFirst = generateFor(dtoShapes);
    const dtoSecond = generateFor(dtoShapes);
    expect(dtoSecond.manifest).toEqual(dtoFirst.manifest);
  });
});
