/**
 * Captured-decision write → manifest auto-apply hook (2026-08-16).
 *
 * postCapturedDecision is the ONE seam every captured-decision producer
 * funnels through (conversation answers/captures/revisions/cascades, the
 * decisions-file import, vulnerability-reduction revisions, the manifest
 * auto-answerer). Pins:
 *   - a SUCCESSFUL write schedules the debounced decision→manifest auto-apply
 *     for the same (project, target architecture);
 *   - a FAILED write (non-2xx) schedules nothing;
 *   - a scheduling failure can never break the decision write (fail-soft).
 */

jest.mock('../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../config', () => ({
  getConfig: () => ({ architectureModelServiceBaseUrl: 'http://ams:8080' }),
}));

const scheduleMock = jest.fn();
jest.mock('../../targetManifest/manifestDecisionAutoApply', () => ({
  scheduleDecisionManifestAutoApply: (...args: unknown[]) => scheduleMock(...args),
}));

import {
  CapturedDecisionsWriteError,
  postCapturedDecision,
} from '../targetStateCapturedDecisionsWriter';

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

const BODY = {
  decisionCode: 'db.migrations',
  scopeKind: 'architecture',
  answerValue: 'Liquibase 4',
  answerSummary: 'Liquibase 4',
} as never;

afterEach(() => {
  jest.clearAllMocks();
});

it('a successful decision write schedules the debounced manifest auto-apply', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ decisionId: 'd1', decisionCode: 'db.migrations' }),
  });

  await postCapturedDecision('p1', 'arch-1', BODY);

  expect(scheduleMock).toHaveBeenCalledTimes(1);
  expect(scheduleMock).toHaveBeenCalledWith('p1', 'arch-1');
});

it('a FAILED write schedules nothing', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

  await expect(postCapturedDecision('p1', 'arch-1', BODY)).rejects.toThrow(
    CapturedDecisionsWriteError
  );
  expect(scheduleMock).not.toHaveBeenCalled();
});

it('a scheduling failure never breaks the decision write (fail-soft)', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ decisionId: 'd1', decisionCode: 'db.migrations' }),
  });
  scheduleMock.mockImplementation(() => {
    throw new Error('scheduler exploded');
  });

  const created = await postCapturedDecision('p1', 'arch-1', BODY);
  expect(created).toMatchObject({ decisionId: 'd1' });
});
