/**
 * Gateway typed-client wrapper tests for the api-behaviour surface.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 4
 * sub-task 4.1 (the fourth gateway test in the 4-test budget).
 *
 * Focused on the wire-shape contract -- the wrapper POSTs to the right
 * gateway URL with the right body shape and returns the typed response
 * shape unchanged. The proxy URL-forwarding contract is covered by
 * `apiMigrationValidation-target-capture-proxy.test.ts`; this file
 * exercises the in-process client surface only.
 */

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
  createTargetCaptureSession,
  type ApiBehaviourCaptureSessionDto,
  type CreateTargetCaptureSessionRequest,
} from '../services/apiBehaviourClient';

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 201 ? 'Created' : status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    } as any,
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test: createTargetCaptureSession POSTs to the right gateway URL with the
// right body shape and returns the typed `ApiBehaviourCaptureSessionDto`
// response.
//
// The type-level assertions below (`session.kind`, `session.source_baseline_id`)
// hold by virtue of the typed return; if the wrapper ever drifts away from
// the documented shape, the compile step will catch it before the runtime
// assertions do.
// ---------------------------------------------------------------------------
test('createTargetCaptureSession POSTs body verbatim and returns typed session shape with kind+source_baseline_id', async () => {
  const projectId = 'proj-abc';
  const architectureId = 'arch-xyz';
  const sourceBaselineId = 'base-src-1';

  const createdSession: ApiBehaviourCaptureSessionDto = {
    id: 'sess-tgt-9',
    project_id: projectId,
    architecture_id: architectureId,
    status: 'draft',
    kind: 'target',
    source_baseline_id: sourceBaselineId,
    api_base_url: 'https://target.example/v1',
    mutating_calls_confirmed: false,
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(201, createdSession));

  const body: CreateTargetCaptureSessionRequest = {
    projectId,
    architectureId,
    sourceBaselineId,
    targetApiBaseUrl: 'https://target.example/v1',
    name: 'Target replay 1',
    authType: 'bearer',
    authConfigRedactedJson: { bearer: '***' },
    defaultHeadersRedactedJson: { 'X-Tenant': 'acme' },
    mutatingCallsConfirmed: false,
  };

  const session = await createTargetCaptureSession(
    'http://localhost:3001',
    body,
  );

  // Type-level assertions: these only compile if the wrapper's return
  // signature is `ApiBehaviourCaptureSessionDto` -- the kind discriminator
  // and pairing field added by Spec 2026-05-25 are visible on the typed
  // shape.
  expect(session.id).toBe('sess-tgt-9');
  expect(session.kind).toBe('target');
  expect(session.source_baseline_id).toBe(sourceBaselineId);
  expect(session.status).toBe('draft');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:3001/api/v1/api-migration-validation/target-capture-sessions',
  );
  expect(calledInit.method).toBe('POST');
  expect(calledInit.headers).toEqual({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  expect(JSON.parse(calledInit.body as string)).toEqual(body);
});
