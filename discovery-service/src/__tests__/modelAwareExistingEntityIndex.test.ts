/**
 * Tests for Model-Aware Discovery -- Task Group 2 (model-as-input).
 *
 * Spec: 2026-05-30 Model-Aware Discovery / Dedup Against Existing Entities.
 *
 * Scope (2.1): the LEAN existing-entity index build + the prompt injection.
 * Covers ONLY:
 *   (a) the lean index includes the scanned service's subtree + ALL data
 *       entities and carries id/type/name/parent-hint per entry (NOT full
 *       attributes / descriptions / relationship payloads),
 *   (b) whole-model is used when under the size cap,
 *   (c) when the model is too large to inject in full, a Finding is emitted and
 *       the run proceeds with the slice,
 *   (d) the composed prompt contains the "existing entities" section when the
 *       model is non-empty.
 *
 * The index builder + composer are pure/deterministic so most assertions run
 * directly against them. Test (c) exercises the pipeline wiring with
 * `archModelClient.getModel` mocked.
 */

// Mock dotenv so config side-effects don't hit disk.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Mock the arch-model-service HTTP client -- the pipeline test (c) drives the
// model load through `getModel`; the other methods are stubbed to no-ops.
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getModel: jest.fn(),
    getProject: jest.fn(),
  },
}));

// Mock the gap-fill stage so test (c) does not invoke the gateway relay; we
// only need to capture the `existingEntities` threaded into the stage input.
jest.mock('../services/llmGapFillStep', () => ({
  runLlmGapFill: jest.fn(),
}));

import {
  buildLeanExistingEntityIndex,
  DEFAULT_EXISTING_ENTITY_INDEX_CHAR_CAP,
} from '../services/prompts/existingEntityIndex';
import { composePrompt } from '../services/prompts/composer';
import { archModelClient } from '../services/archModelClient';
import { runDiscoveryV3 } from '../services/discoveryV3Pipeline';
import { runLlmGapFill } from '../services/llmGapFillStep';
import { clearRegistry } from '../services/extensionPackRegistry';

const runLlmGapFillMock = runLlmGapFill as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A small model with one service subtree (service -> interface -> endpoint),
 * data entities (one logical + one physical), and -- critically -- entities
 * carrying FULL attribute lists + descriptions so we can assert they are
 * DROPPED from the lean index.
 */
function makeModel() {
  return {
    metaModel: {
      entities: {
        applications: [{ id: 'app-1', name: 'BillingApp', description: 'top app' }],
        services: [
          {
            id: 'svc-1',
            name: 'InvoiceService',
            application_id: 'app-1',
            description: 'a long service description that must NOT be injected',
          },
        ],
        interfaces: [
          { id: 'ifc-1', name: 'InvoiceApi', service_id: 'svc-1', description: 'iface desc' },
        ],
        endpoints: [
          { id: 'ep-1', name: 'GET /invoices', interface_id: 'ifc-1', description: 'ep desc' },
        ],
        logical_data_entities: [
          {
            id: 'lde-1',
            name: 'Invoice',
            description: 'logical invoice entity -- description must be dropped',
            attributes: [{ name: 'total', dataType: 'number' }],
          },
        ],
        physical_data_entities: [
          {
            id: 'pde-1',
            name: 'invoices',
            table_name: 'invoices',
            physical_type: 'Table',
            description: 'the invoices table',
            attributes: [{ name: 'total_cents', dataType: 'bigint' }],
          },
        ],
        // Auto-managed polymorphic wrappers -- MUST never appear in the index.
        application_points: [{ id: 'ap-1', name: 'should-never-appear' }],
        data_entity_points: [{ id: 'dep-1', name: 'should-never-appear' }],
      },
      relationships: {
        logical_data_entity_physical_data_entities: [],
      },
    },
    diagrams: [],
  };
}

const TEST_RUN_ID = 'run-ma-001';
const TEST_PROJECT_ID = 'proj-ma-001';

// ---------------------------------------------------------------------------
// (a) Lean index: subtree + ALL data entities; id/type/name/parent-hint only.
// ---------------------------------------------------------------------------

describe('buildLeanExistingEntityIndex -- lean projection', () => {
  test('includes the service subtree + ALL data entities, carrying only id/type/name/parent-hint', () => {
    const { items, tooLarge } = buildLeanExistingEntityIndex(makeModel());
    expect(tooLarge).toBe(false);

    const byName = new Map(items.map((i) => [i.name, i]));

    // Subtree entities present.
    expect(byName.has('InvoiceService')).toBe(true);
    expect(byName.has('InvoiceApi')).toBe(true);
    expect(byName.has('GET /invoices')).toBe(true);
    // ALL data entities present (logical + physical).
    expect(byName.has('Invoice')).toBe(true);
    expect(byName.has('invoices')).toBe(true);

    // Type + parent/table hints resolved.
    expect(byName.get('InvoiceService')).toMatchObject({ type: 'services', parentOrTableHint: 'app-1' });
    expect(byName.get('InvoiceApi')).toMatchObject({ type: 'interfaces', parentOrTableHint: 'svc-1' });
    expect(byName.get('GET /invoices')).toMatchObject({ type: 'endpoints', parentOrTableHint: 'ifc-1' });
    expect(byName.get('Invoice')).toMatchObject({ type: 'logical_data_entities' });
    // Physical entity carries a table/physical-type hint, not the entity name.
    expect(byName.get('invoices')!.type).toBe('physical_data_entities');
    expect(byName.get('invoices')!.parentOrTableHint).toBe('Table');

    // LEAN: NO attribute lists / descriptions / relationship payloads anywhere.
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        expect.arrayContaining(['id', 'name', 'type']),
      );
      expect((item as unknown as Record<string, unknown>).description).toBeUndefined();
      expect((item as unknown as Record<string, unknown>).attributes).toBeUndefined();
    }

    // Auto-managed `*_points` wrappers are NEVER included.
    expect(items.some((i) => i.type.endsWith('_points'))).toBe(false);
    expect(items.some((i) => i.name === 'should-never-appear')).toBe(false);
  });

  test('tolerates an empty / absent / malformed model by returning an empty index', () => {
    expect(buildLeanExistingEntityIndex(null).items).toEqual([]);
    expect(buildLeanExistingEntityIndex(undefined).items).toEqual([]);
    expect(buildLeanExistingEntityIndex({}).items).toEqual([]);
    expect(buildLeanExistingEntityIndex({ metaModel: { entities: {} } }).items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) Whole-model under the cap; (c-builder) too-large narrows + flags.
// ---------------------------------------------------------------------------

describe('buildLeanExistingEntityIndex -- size cap', () => {
  test('uses the whole model when the serialized index is under the cap', () => {
    const result = buildLeanExistingEntityIndex(makeModel(), undefined, DEFAULT_EXISTING_ENTITY_INDEX_CHAR_CAP);
    expect(result.tooLarge).toBe(false);
    // The top-level application is included only in the whole-model path (it is
    // not part of the subtree slice), proving the whole model was used.
    expect(result.items.some((i) => i.name === 'BillingApp')).toBe(true);
  });

  test('narrows to the relevant slice and flags tooLarge when over the cap', () => {
    // Force the narrowing path with a tiny cap.
    const result = buildLeanExistingEntityIndex(makeModel(), undefined, 1);
    expect(result.tooLarge).toBe(true);
    expect(result.wholeModelCount).toBeGreaterThan(0);
    // The slice still contains ALL data entities (cross-cutting reconcile).
    expect(result.items.some((i) => i.name === 'Invoice')).toBe(true);
    expect(result.items.some((i) => i.name === 'invoices')).toBe(true);
    // Still never any `*_points`.
    expect(result.items.some((i) => i.type.endsWith('_points'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) Composed prompt contains the "existing entities" section when non-empty.
// ---------------------------------------------------------------------------

describe('composePrompt -- existing-entity section', () => {
  test('renders the "Existing Entities" section with the lean names when the index is non-empty', () => {
    const { items } = buildLeanExistingEntityIndex(makeModel());
    const { prompt } = composePrompt({
      tier: 'B',
      language: 'java',
      sourceFile: { filePath: 'src/Foo.java', content: 'class Foo {}' },
      existingEntities: items,
    });
    expect(prompt).toContain('Existing Entities (already in the model');
    // The lean names appear in the rendered JSON block.
    expect(prompt).toContain('"InvoiceService"');
    expect(prompt).toContain('"invoices"');
    // The nudge instructs enrich/link-by-name and forbids `*_points`.
    expect(prompt).toContain('operation: "enrich"');
    expect(prompt).toContain('operation: "link"');
    expect(prompt).toContain('*_points');
  });

  test('renders the first-run stub when no existing entities are supplied', () => {
    const { prompt } = composePrompt({
      tier: 'B',
      language: 'java',
      sourceFile: { filePath: 'src/Foo.java', content: 'class Foo {}' },
    });
    expect(prompt).toContain('No existing entities for this run');
  });
});

// ---------------------------------------------------------------------------
// (c-pipeline) Too-large model -> Finding emitted; run proceeds with the slice.
// ---------------------------------------------------------------------------

describe('runDiscoveryV3 -- model-as-input wiring', () => {
  beforeEach(() => {
    clearRegistry();
    jest.clearAllMocks();
    (archModelClient.getDiscoveryRun as jest.Mock).mockResolvedValue({
      id: TEST_RUN_ID,
      project_id: TEST_PROJECT_ID,
      steps_payload: {},
    });
    (archModelClient.getProject as jest.Mock).mockResolvedValue(null);
    (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
    (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);
    runLlmGapFillMock.mockResolvedValue({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 0,
      crossFileDedupCount: 0,
      promptVersion: { base: 'a', language: 'b', framework: 'c', composed: 'd' },
    });
  });

  test('threads the lean index into the gap-fill stage when a model loads', async () => {
    (archModelClient.getModel as jest.Mock).mockResolvedValue(makeModel());

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/Foo.java', 'class Foo {}']]),
      techHints: { repo1: { language: 'Python' } }, // tier C, no packs
    });

    expect(archModelClient.getModel).toHaveBeenCalledWith(TEST_PROJECT_ID, TEST_RUN_ID);
    const gapFillArg = runLlmGapFillMock.mock.calls[0][0] as {
      existingEntities?: Array<{ name: string }>;
    };
    expect(gapFillArg.existingEntities).toBeDefined();
    expect(gapFillArg.existingEntities!.some((e) => e.name === 'Invoice')).toBe(true);
  });

  test('emits a Finding (and proceeds) when the model is too large to inject whole', async () => {
    // Force the too-large path by injecting a huge model: many logical entities
    // so the whole-model serialized index easily exceeds the default cap.
    const huge = makeModel();
    const manyLogical = [];
    for (let i = 0; i < 5000; i++) {
      manyLogical.push({ id: `lde-${i}`, name: `LogicalEntity${i}WithAFairlyLongName` });
    }
    (huge.metaModel.entities as Record<string, unknown>).logical_data_entities = manyLogical;
    (archModelClient.getModel as jest.Mock).mockResolvedValue(huge);

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/Foo.java', 'class Foo {}']]),
      techHints: { repo1: { language: 'Python' } },
    });

    // A model-too-large Finding is built + deferred to the caller (NOT a silent drop).
    const tooLargeFinding = (result.findingInputs ?? []).find(
      (f) => f.findingType === 'model_too_large_for_injection',
    );
    expect(tooLargeFinding).toBeDefined();
    expect(tooLargeFinding!.severity).toBe('info');

    // The run still proceeded and still threaded a (narrowed) slice in. The
    // slice always carries ALL data entities (cross-cutting reconcile), so the
    // physical `invoices` table + the many logical entities are present.
    const gapFillArg = runLlmGapFillMock.mock.calls[0][0] as {
      existingEntities?: Array<{ name: string }>;
    };
    expect(gapFillArg.existingEntities).toBeDefined();
    expect(gapFillArg.existingEntities!.some((e) => e.name === 'invoices')).toBe(true);
    expect(
      gapFillArg.existingEntities!.some((e) => e.name === 'LogicalEntity0WithAFairlyLongName'),
    ).toBe(true);
  });
});
