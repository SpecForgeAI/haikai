import path from 'path';
import { parseOasFromFile, parseOasFromObject } from '../services/oasParser';

/**
 * OAS parser smoke test. Uses a tiny petstore-shaped fixture
 * (`fixtures/sample-oas.json`) to assert the dereferenced inventory shape:
 *   - one ParsedOasOperation per operation
 *   - method / path / operationId / summary populated
 *   - request schema dereferenced (POST has the inlined NewPet object,
 *     not a `$ref`)
 *   - response schema dereferenced (GET picks the lowest 2xx)
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4
 * sub-task 4.1.
 */

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-oas.json');

describe('oasParser', () => {
  it('parseOasFromFile produces a dereferenced inventory', async () => {
    const inventory = await parseOasFromFile(FIXTURE_PATH);

    expect(inventory.title).toBe('Sample Pet API');
    expect(inventory.version).toBe('1.0.0');
    expect(inventory.operations).toHaveLength(3);

    const list = inventory.operations.find((o) => o.operationId === 'listPets');
    expect(list).toBeDefined();
    expect(list?.method).toBe('get');
    expect(list?.path).toBe('/pets');
    expect(list?.summary).toBe('List all pets');
    expect(list?.responseSchema).toBeTruthy();
    // The Pets schema is an array referencing Pet; dereference must replace
    // the `$ref` with the full inlined Pet object.
    expect(list?.responseSchema?.type).toBe('array');
    const items = (list?.responseSchema as { items?: Record<string, unknown> } | null)?.items;
    expect(items).toBeDefined();
    expect((items as { type?: string } | undefined)?.type).toBe('object');
    // `$ref` MUST be gone -- dereference was real.
    expect(JSON.stringify(list?.responseSchema)).not.toContain('$ref');

    const create = inventory.operations.find((o) => o.operationId === 'createPet');
    expect(create).toBeDefined();
    expect(create?.method).toBe('post');
    expect(create?.requestSchema).toBeTruthy();
    expect(create?.requestSchema?.type).toBe('object');
    // The dereferenced request body schema MUST list `name` as required.
    const required = create?.requestSchema?.required;
    expect(required).toContain('name');
  });

  it('parseOasFromObject returns the same inventory shape for an in-memory spec', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const spec = require('./fixtures/sample-oas.json');
    const inventory = await parseOasFromObject(spec);

    expect(inventory.operations).toHaveLength(3);
    const ids = inventory.operations.map((o) => o.operationId).sort();
    expect(ids).toEqual(['createPet', 'listPets', 'showPetById']);
  });
});
