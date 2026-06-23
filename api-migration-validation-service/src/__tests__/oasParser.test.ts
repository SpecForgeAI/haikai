import path from 'path';
import { parseOasFromFile, parseOasFromObject } from '../services/oasParser';
import { extractContractFieldFormats } from '../services/dataTypeClassifier';

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

/**
 * PathItem-level `parameters` merge (bug fix 2026-06-22). OAS allows shared
 * `parameters` on the PathItem; they are inherited by every operation on that
 * path, with an operation-level parameter winning on a `(name, in)` collision.
 * The inventory builder must fold them into each stored operation so downstream
 * contract-format extraction (Step 5 Col-3) sees path params like `{id}`.
 */
describe('oasParser path-item-level parameters', () => {
  it('merges PathItem-level parameters into each operation (operation-level wins on name+in)', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Path Params API', version: '1.0.0' },
      paths: {
        '/widgets/{id}': {
          // Shared path-level params: `id` (path) + `trace` (header). `id`
          // collides by (name, in) with the GET operation's own `id` param.
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'trace', in: 'header', schema: { type: 'string' } },
          ],
          get: {
            operationId: 'getWidget',
            // Operation-level `id` MUST win the (id, path) collision: integer/int64,
            // not the path-level uuid.
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
          delete: {
            operationId: 'deleteWidget',
            // No own params -> inherits BOTH path-level params verbatim.
            responses: { '204': { description: 'no content' } },
          },
        },
      },
    };

    const inventory = await parseOasFromObject(spec);

    // GET: operation-level `id` wins (integer/int64), and the path-level
    // `trace` header is inherited. Exactly one `id` param (no duplicate).
    const get = inventory.operations.find((o) => o.operationId === 'getWidget');
    expect(get).toBeDefined();
    const getParams = (get!.oasOperation as { parameters?: Array<Record<string, unknown>> }).parameters!;
    const getIds = getParams.filter((pm) => pm.name === 'id');
    expect(getIds).toHaveLength(1);
    expect((getIds[0].schema as Record<string, unknown>).type).toBe('integer');
    expect((getIds[0].schema as Record<string, unknown>).format).toBe('int64');
    expect(getParams.some((pm) => pm.name === 'trace' && pm.in === 'header')).toBe(true);

    // DELETE: no own params -> inherits BOTH shared path-level params, and the
    // inherited `id` keeps the path-level uuid schema.
    const del = inventory.operations.find((o) => o.operationId === 'deleteWidget');
    expect(del).toBeDefined();
    const delParams = (del!.oasOperation as { parameters?: Array<Record<string, unknown>> }).parameters!;
    const delId = delParams.find((pm) => pm.name === 'id');
    expect(delId).toBeDefined();
    expect((delId!.schema as Record<string, unknown>).format).toBe('uuid');
    expect(delParams.some((pm) => pm.name === 'trace' && pm.in === 'header')).toBe(true);

    // The merged operation is what `extractContractFieldFormats` reads for Col-3,
    // so the path-level `{id}` is no longer dropped.
    const fields = extractContractFieldFormats(del!.oasOperation);
    expect(fields.some((f) => f.name === 'id' && f.location === 'path')).toBe(true);
  });
});
