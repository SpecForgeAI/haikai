/**
 * Tests for create-time book-of-work behaviour AFTER the orphan-seed removal.
 *
 * Spec: 2026-06-26-book-of-work-scaffold-and-reference-names — Task Group 1
 * (FR1: delete the orphan `parentId:null` seed story + its post-validation
 * prepend bypass). The dedicated seed-build-files story is no longer minted at
 * book CREATION time; scaffold work is injected as a hierarchy-legal
 * feature+story at PHASE-2 expansion instead. So create-time must:
 *
 *   (a) produce NO top-level `parentId:null` "seed build files" story on the
 *       posted `book_of_work_json.items` — every item is exactly what the
 *       generator emitted, all hierarchy-legal;
 *   (b) emit NO `seed_build_files_prepended` / `seed_build_files_skipped`
 *       diagnostic at create time (the whole gate is gone);
 *   (c) leave nothing created at book-creation time that evades
 *       `validateBookOfWorkHierarchy` (the property FR1 restores).
 *
 * The AMS createDraft seam is stubbed; no live AMS.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateMigrationBookOfWork } from '../services/migrationBookOfWorkHandler';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import {
  GeneratedMigrationBookOfWork,
  MigrationBookOfWorkItem,
  validateBookOfWorkHierarchy,
} from '../services/generatedMigrationBookOfWorkSchema';

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

async function runCreate(createDraft: jest.Mock): Promise<void> {
  const fetchContext = jest.fn().mockResolvedValue(loadFixture());
  const callLlm = jest.fn().mockResolvedValue({ content: makeValidBookOfWorkJson() });
  await generateMigrationBookOfWork(
    {
      projectId: 'proj-1',
      currentArchitectureId: 'curr-1',
      // A confirmed manifest may well exist for arch-1 — but create-time no
      // longer reads it, so the posted book carries NO seed story regardless.
      targetArchitectureId: 'arch-1',
    },
    { fetchContext, callLlm, createDraft, systemPromptOverride: 'SYS' },
  );
}

describe('Create-time book-of-work has no orphan seed story (Spec 2026-06-26 FR1)', () => {
  it('(a) posts NO top-level parentId:null seed-build-files story — only the generated items', async () => {
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd1', summary: 'ok' });
    await runCreate(createDraft);

    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as Array<Record<string, unknown>>;
    // Exactly the four generated items, in order — nothing prepended.
    expect(items.map((i) => i.id)).toEqual(['I1', 'E1', 'F1', 'S1']);
    // No item carries the seed marker, and no story sits at parentId:null.
    expect(items.some((i) => i.kind === 'seed_build_files')).toBe(false);
    expect(items.some((i) => i.tags && (i.tags as string[]).includes('seed_build_files'))).toBe(
      false,
    );
    expect(
      items.some((i) => i.type === 'story' && i.parentId === null),
    ).toBe(false);
  });

  it('(b) emits NO seed_build_files prepend/skip diagnostic at create time', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const createDraft = jest.fn().mockResolvedValue({ draftId: 'd2', summary: 'ok' });
      await runCreate(createDraft);
      const emitted = [...logSpy.mock.calls, ...warnSpy.mock.calls]
        .map((c) => String(c[0] ?? ''))
        .join('\n');
      expect(emitted).not.toContain('seed_build_files_prepended');
      expect(emitted).not.toContain('seed_build_files_skipped');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('(c) every create-time item passes validateBookOfWorkHierarchy (no bypass remains)', async () => {
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'd3', summary: 'ok' });
    await runCreate(createDraft);

    const [, postedBody] = createDraft.mock.calls[0];
    const items = postedBody.book_of_work_json.items as MigrationBookOfWorkItem[];
    const result = validateBookOfWorkHierarchy(items);
    expect(result.ok).toBe(true);
  });
});
