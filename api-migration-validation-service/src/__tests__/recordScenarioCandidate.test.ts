/**
 * record_scenario_candidate — AMS-required request_method/request_path
 * (2026-08-26). AMS's ApiBehaviourScenarioService.create 400s when either
 * is blank (NOT NULL columns). The orchestrator's own scenario create
 * learned this long ago and sources them from the persisted operation row;
 * the TOOL path never got the same fix — the schema marks the args
 * optional, the LLM legitimately omits them, and every such call 400'd
 * systematically (losing the variant and burning budget rounds on the
 * error round-trip — Kiro run-3 Issue 3, feeder of Issue 2).
 */

import { recordScenarioCandidateTool } from '../services/tools/record_scenario_candidate';
import type { ToolExecutionContext } from '../services/tools';
import type { OperationDto } from '../services/archModelClient';

function buildContext(): {
  ctx: ToolExecutionContext;
  createScenario: jest.Mock;
} {
  const createScenario = jest.fn(async () => ({ id: 'scenario-1' }));
  const op = {
    id: 'op-row-1',
    session_id: 'session-1',
    operation_id: 'markFavourite',
    method: 'POST',
    path: '/filters/{filterId}/markFavourite',
    included: true,
    safe_to_execute: true,
  } as unknown as OperationDto;
  const ctx = {
    session: { id: 'session-1', projectId: 'proj-1' },
    operationsByOasId: new Map([['markFavourite', op]]),
    archModelClient: {
      createScenario,
      createDiagnostic: jest.fn(),
      createCapture: jest.fn(),
    },
    currentScenarioId: null,
  } as unknown as ToolExecutionContext;
  return { ctx, createScenario };
}

describe('record_scenario_candidate method/path defaults (2026-08-26)', () => {
  it('omitted requestMethod/requestPath default from the persisted operation row', async () => {
    const { ctx, createScenario } = buildContext();
    await recordScenarioCandidateTool.handler(
      { operationId: 'markFavourite', scenarioName: 'favourite toggles on' },
      ctx,
    );
    expect(createScenario).toHaveBeenCalledTimes(1);
    const body = createScenario.mock.calls[0][1] as Record<string, unknown>;
    // The AMS-required pair is ALWAYS populated — never null (the 400).
    expect(body.request_method).toBe('POST');
    expect(body.request_path).toBe('/filters/{filterId}/markFavourite');
  });

  it('explicit LLM-provided values still win (variant paths with params filled)', async () => {
    const { ctx, createScenario } = buildContext();
    await recordScenarioCandidateTool.handler(
      {
        operationId: 'markFavourite',
        scenarioName: 'favourite on a concrete filter',
        requestMethod: 'post',
        requestPath: '/filters/4593/markFavourite',
      },
      ctx,
    );
    const body = createScenario.mock.calls[0][1] as Record<string, unknown>;
    expect(body.request_method).toBe('post');
    expect(body.request_path).toBe('/filters/4593/markFavourite');
  });

  it('blank strings are treated as omitted, not sent to AMS', async () => {
    const { ctx, createScenario } = buildContext();
    await recordScenarioCandidateTool.handler(
      {
        operationId: 'markFavourite',
        scenarioName: 'blank args',
        requestMethod: '',
        requestPath: '  ',
      },
      ctx,
    );
    const body = createScenario.mock.calls[0][1] as Record<string, unknown>;
    expect(body.request_method).toBe('POST');
    expect(body.request_path).toBe('/filters/{filterId}/markFavourite');
  });
});
