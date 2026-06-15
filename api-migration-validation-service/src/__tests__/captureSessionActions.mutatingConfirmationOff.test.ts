/**
 * parse-oas: mutating-call confirmation OFF branch test
 * (Task Group 11.3 gap-fill #4).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 11.
 *
 * Why: the existing `captureSessionActions.test.ts` parse-oas happy path
 * (Task 6.1 test #1) drives the wizard happy path with
 * `mutating_calls_confirmed=true` and asserts every row lands
 * `included=true`. The OPPOSITE branch -- the spec-mandated guardrail
 * where the user has NOT confirmed mutating calls -- is not exercised at
 * the integration level by any existing test.
 *
 * Per spec section "Mutating-call confirmation":
 *   "Without confirmation: `safe_to_execute` is set TRUE for `GET|HEAD|OPTIONS`
 *    only; mutating ops are inserted with `included=FALSE` and a visual
 *    'excluded -- mutating not confirmed' marker in step 4."
 *
 * The fixture OAS (`fixtures/sample-oas.json`) carries one POST (`createPet`)
 * alongside two GETs (`listPets`, `showPetById`). With confirmation OFF:
 *   - The two GETs must land `included=true, safe_to_execute=true`.
 *   - The POST must land `included=false, safe_to_execute=false`.
 */

import express from 'express';
import path from 'path';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type {
  CaptureSessionDto,
  InterfaceDto,
  OperationDto,
} from '../services/archModelClient';

const FIXTURE_OAS_PATH = path.resolve(__dirname, 'fixtures', 'sample-oas.json');

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'mutating-off',
    status: 'draft',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false, // <-- the branch under test
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
});

test('parse-oas with mutating_calls_confirmed=false marks mutating ops included=false, safe_to_execute=false', async () => {
  const interfaceRow: InterfaceDto = {
    id: 'iface-1',
    name: 'pet-api',
    spec_link: FIXTURE_OAS_PATH,
    architecture_id: ARCH_ID,
  };
  const session = buildSession({ mutating_calls_confirmed: false });

  const operationsCreated: Array<{ projectId: string; body: any }> = [];
  const mockArchClient = {
    getCaptureSession: jest.fn(async () => session),
    listInterfacesForArchitecture: jest.fn(async () => [interfaceRow]),
    listOperationsBySession: jest.fn(async () => []),
    createOperation: jest.fn(async (projectId: string, body: any) => {
      operationsCreated.push({ projectId, body });
      return {
        id: `op-${operationsCreated.length}`,
        session_id: body.session_id,
        operation_id: body.operation_id,
        method: body.method,
        path: body.path,
        summary: body.summary ?? null,
        description: body.description ?? null,
        included: body.included ?? null,
        safe_to_execute: body.safe_to_execute ?? null,
        request_schema_json: body.request_schema_json ?? null,
        response_schema_json: body.response_schema_json ?? null,
        oas_operation_json: body.oas_operation_json ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as OperationDto;
    }),
    patchCaptureSession: jest.fn(),
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };

  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter({ archModelClient: mockArchClient as any }));

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-1'] });

  expect(res.status).toBe(200);
  // Three operations from the fixture: listPets (GET), createPet (POST),
  // showPetById (GET).
  expect(operationsCreated).toHaveLength(3);

  const byMethod = new Map<string, { projectId: string; body: any }>();
  for (const row of operationsCreated) {
    byMethod.set(row.body.method, row);
  }
  expect(byMethod.has('GET')).toBe(true);
  expect(byMethod.has('POST')).toBe(true);

  // ---- GET ops: included=true, safe_to_execute=true (non-mutating verbs
  //      are always safe regardless of the confirmation toggle).
  const getRows = operationsCreated.filter((r) => r.body.method === 'GET');
  expect(getRows.length).toBeGreaterThanOrEqual(1);
  for (const row of getRows) {
    expect(row.body.included).toBe(true);
    expect(row.body.safe_to_execute).toBe(true);
  }

  // ---- POST op: included=false AND safe_to_execute=false because mutating
  //      verbs require the per-session confirmation toggle to be on.
  const postRow = byMethod.get('POST')!;
  expect(postRow.body.included).toBe(false);
  expect(postRow.body.safe_to_execute).toBe(false);

  // Inventory cached as before (parse step never depends on the toggle).
  expect(oasInventoryStore.has(SESSION_ID)).toBe(true);
});
