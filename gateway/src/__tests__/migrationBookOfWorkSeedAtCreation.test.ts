/**
 * Tests for seed-build-files story minting at BOOK-OF-WORK CREATION time.
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring (Spec 5 Phase 2) —
 * follow-up relocation. The dormant upload-time `seed_build_files` mint was
 * removed from `targetManifestUpload.ts` and the seed is now prepended at book
 * creation, inside `generateMigrationBookOfWork`, IFF a confirmed manifest
 * exists for the target architecture. It rides the initial `book_of_work_json`
 * blob (which AMS `createDraft` persists WITHOUT per-item kind validation), so
 * it sidesteps the AMS ALLOWED_KINDS 400 entirely — no AMS change.
 *
 * Covered here (the manifest-read seam + the AMS createDraft seam are both
 * stubbed; no live AMS):
 *   (a) seed PREPENDED at sequenceOrder:0 FIRST, carrying the
 *       `seed_build_files` kind marker, when the stubbed manifest read returns
 *       >= 1 artifact;
 *   (b) NOT prepended when the read returns an empty list;
 *   (c) FAIL-SOFT — the read throwing does NOT break book creation (the AMS
 *       write still happens, with NO seed item);
 *   (d) the pure builder shape (`buildSeedBuildFilesStoryItem`) — story type,
 *       sequenceOrder 0, kind marker recognised by `isSeedBuildFilesStory`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildSeedBuildFilesStoryItem,
  generateMigrationBookOfWork,
} from '../services/migrationBookOfWorkHandler';
import { isSeedBuildFilesStory } from '../services/migrationSeedBuildFilesEnrichment';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import { GeneratedMigrationBookOfWork } from '../services/generatedMigrationBookOfWorkSchema';
import { TargetManifestArtifactWire } from '../services/targetManifestArtifactsClient';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-05-17-pm-migration-delivery-plan-book-of-work-draft',
  'planning',
  'visuals',
  'fixture-migration-delivery-plan-scenario.json',
);

function loadFixture(): MigrationDiscoveryContext {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) as MigrationDiscoveryContext;
}

// Minimal-but-valid GeneratedMigrationBookOfWork JSON (one item of each type).
function makeValidBookOfWorkJson(): string {
  const payload: GeneratedMigrationBookOfWork = {
    title: 'Draft Migration Delivery Plan',
    summary: 'A summary.',
    generationInputs: {},
    generationSummary: { totalItems: 4 },
    qualityAssessment: { overallScore: 'high' },
    items: [
      {
        id: 'I1',
        type: 'initiative',
        parentId: null,
        title: 'Split monolith',
        description: 'Top-level initiative',
        acceptanceCriteria: [],
        workstream: 'architecture_refinement',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Begin.',
        traceabilitySummary: 'Derived.',
      },
      {
        id: 'E1',
        type: 'epic',
        parentId: 'I1',
        title: 'Extraction',
        description: 'Extract.',
        acceptanceCriteria: ['done.'],
        workstream: 'target_service_api_implementation',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Author.',
        traceabilitySummary: 'Maps.',
      },
      {
        id: 'F1',
        type: 'feature',
        parentId: 'E1',
        title: 'GET /x',
        description: 'A feature.',
        acceptanceCriteria: ['parity.'],
        workstream: 'target_service_api_implementation',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Write story.',
        traceabilitySummary: 'Traces.',
      },
      {
        id: 'S1',
        type: 'story',
        parentId: 'F1',
        title: 'Implement GET /x',
        description: 'Implement.',
        acceptanceCriteria: ['identical body.'],
        workstream: 'target_service_api_implementation',
        sequenceOrder: 1,
        tags: [],
        confidence: 'high',
        readiness: 'ready_for_spec',
        readinessReasons: [],
        missingInputs: [],
        recommendedNextAction: 'Begin.',
        traceabilitySummary: 'Traces.',
      },
    ],
  };
  return JSON.stringify(payload);
}

function wireArtifact(tag: string): TargetManifestArtifactWire {
  return {
    id: `row-${tag}`,
    project_id: 'proj-1',
    target_architecture_id: 'arch-1',
    tag,
    kind: 'pom',
    ecosystem: 'MAVEN',
    manifest_path: 'pom.xml',
    content: '<project/>\n',
    package_lock_content: null,
    resolved_dependencies: [],
    is_latest: true,
    created_at: '2026-06-25T00:00:00Z',
  };
}

describe('Seed-build-files story minted at book-of-work creation (Spec 2026-06-25 relocation)', () => {
  it('(d) buildSeedBuildFilesStoryItem — story, sequenceOrder 0, kind marker recognised by isSeedBuildFilesStory', () => {
    const seed = buildSeedBuildFilesStoryItem();
    expect(seed.type).toBe('story');
    expect(seed.sequenceOrder).toBe(0);
    expect(seed.parentId).toBeNull();
    // The downstream carriage recognises the seed by its `kind` marker.
    expect(isSeedBuildFilesStory(seed as never)).toBe(true);
  });

  it('(a) prepends the seed FIRST (sequenceOrder:0, kind marker) when the manifest read returns >= 1 artifact', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd1', summary: 'ok' });
    const fetchTargetManifestArtifacts = jest
      .fn()
      .mockResolvedValue([wireArtifact('orders-service')]);

    await generateMigrationBookOfWork(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'arch-1',
      },
      { fetchContext, callLlm, createDraft, fetchTargetManifestArtifacts, systemPromptOverride: 'SYS' },
    );

    // The read seam was consulted with (projectId, targetArchitectureId).
    expect(fetchTargetManifestArtifacts).toHaveBeenCalledTimes(1);
    expect(fetchTargetManifestArtifacts).toHaveBeenCalledWith('proj-1', 'arch-1');

    // The body POSTed to AMS carries the seed as the FIRST item.
    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(5); // 4 generated + 1 seed
    const first = items[0];
    expect(first.type).toBe('story');
    expect(first.sequenceOrder).toBe(0);
    expect(first.kind).toBe('seed_build_files');
    // The originally-generated items are still present, after the seed.
    expect(items.slice(1).map((i) => i.id)).toEqual(['I1', 'E1', 'F1', 'S1']);
  });

  it('(b) does NOT prepend the seed when the manifest read returns an empty list', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd2', summary: 'ok' });
    const fetchTargetManifestArtifacts = jest.fn().mockResolvedValue([]);

    await generateMigrationBookOfWork(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'arch-1',
      },
      { fetchContext, callLlm, createDraft, fetchTargetManifestArtifacts, systemPromptOverride: 'SYS' },
    );

    expect(fetchTargetManifestArtifacts).toHaveBeenCalledTimes(1);
    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<Record<string, unknown>>;
    // No seed: exactly the 4 generated items, none carrying the kind marker.
    expect(items.length).toBe(4);
    expect(items.some((i) => i.kind === 'seed_build_files')).toBe(false);
  });

  it('(c) FAIL-SOFT — a manifest-read throw does NOT break book creation; AMS is still written with NO seed', async () => {
    const fixture = loadFixture();
    const fetchContext = jest.fn().mockResolvedValue(fixture);
    const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd3', summary: 'ok' });
    const fetchTargetManifestArtifacts = jest
      .fn()
      .mockRejectedValue(new Error('AMS manifest-artifacts list failed: HTTP 503'));

    const result = await generateMigrationBookOfWork(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'arch-1',
      },
      { fetchContext, callLlm, createDraft, fetchTargetManifestArtifacts, systemPromptOverride: 'SYS' },
    );

    // Book creation still succeeded (no throw) and AMS was written.
    expect(result.draftId).toBe('d3');
    expect(createDraft).toHaveBeenCalledTimes(1);
    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<Record<string, unknown>>;
    // No seed prepended on the fail-soft path.
    expect(items.length).toBe(4);
    expect(items.some((i) => i.kind === 'seed_build_files')).toBe(false);
  });
});
