/**
 * SCL carriage — response shapes joined by declared return type (2026-09-03).
 *
 * Kiro review IMPL-03 / C-3: the corpus held a full field table for the exact
 * type every resource method returns, while the endpoint spec said "no
 * committed response contract" in a different document with no
 * cross-reference. The behaviour tables' outcome signatures name the returned
 * type (`value:<Type>`); the carriage now joins that to the shape contract
 * and carries the shape verbatim in the endpoint spec.
 */

import {
  joinResponseShapes,
  runSclSpecCarriage,
} from '../services/sclSpecCarriage';
import { SclContractDto } from '../services/sclCorpusPlanner';
import { LoadedBookOfWorkItem } from '../services/migrationShapeSpecGenerationHandler';
import { MigrationStorySpecGenerationDto } from '../services/migrationShapeSpecGenerationHandler';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

const GET_ORDER = 'com.app.OrdersController#getOrder(String)';

function behaviourTable(returnLabel: string): SclContractDto {
  return {
    contract_key: 'T-GET',
    kind: 'behaviour_table',
    source_path: 'src/com/app/OrdersController.java',
    source_symbol: GET_ORDER,
    fan_in: 0,
    roots_json: { roots: [GET_ORDER] },
    body_json: {
      symbol: GET_ORDER,
      annotations: ['@GET', '@Path("/orders/{id}")'],
      rows: [
        {
          index: 0,
          kind: 'branch',
          conditionVerbatim: 'if (id == null)',
          conditionRef: { path: 'src/com/app/OrdersController.java', line: 42 },
          outcome: {
            type: 'terminal',
            verbatim: 'throw new BadRequestException("id required")',
            ref: { path: 'src/com/app/OrdersController.java', line: 43 },
            outcomeLabel: 'BAD_REQUEST',
          },
        },
      ],
      outcomeSignature: [
        { label: returnLabel, kind: 'value' },
        { label: 'throws:BadRequestException', kind: 'throw' },
      ],
    },
  } as unknown as SclContractDto;
}

function shape(key: string, fqn: string): SclContractDto {
  return {
    contract_key: key,
    kind: 'shape',
    source_path: `src/${fqn.replace(/\./g, '/')}.java`,
    source_symbol: fqn,
    fan_in: 3,
    roots_json: { roots: [] },
    body_json: {
      symbol: fqn,
      representation: 'immutable',
      fields: [
        { name: 'orderId', kind: 'String', nullable: false, wireName: 'order_id', sourceCarrier: 'field' },
        { name: 'total', kind: 'BigDecimal', nullable: true, wireName: 'total', sourceCarrier: 'field' },
      ],
    },
  } as unknown as SclContractDto;
}

function story(): LoadedBookOfWorkItem {
  return {
    id: 'SCL-1',
    type: 'story',
    parentId: null,
    title: 'Implement OrdersController (1 endpoints)',
    sequenceOrder: 1,
    workItemId: 'wi-scl',
    tags: ['provenance:plan-deterministic', 'provenance:scl_corpus', 'scl', 'scl:endpoint:external'],
    codeStoryKind: 'scl-endpoint-group',
    apiEndpointIds: ['ep-1'],
    sclContractKeys: ['T-GET'],
    sclLayer: 'endpoint:external',
    sclControllerClass: 'com.app.OrdersController',
    sclRowCount: 1,
  } as LoadedBookOfWorkItem;
}

function baseRow(): MigrationStorySpecGenerationDto {
  return {
    projectId: 'p-1',
    workItemId: 'wi-scl',
    bookOfWorkId: 'bow-1',
    bookItemId: 'SCL-1',
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

function decision(): TargetStateCapturedDecision {
  return {
    decisionId: 'd-http',
    projectId: 'p-1',
    targetArchitectureId: 'arch-target-001',
    decisionCode: 'modernize.http.jaxrs-annotations',
    scopeKind: 'architecture',
    scopeRefId: null,
    answerValue: 'Spring MVC annotations',
    answerSummary: 'JAX-RS resource annotations -> Spring MVC annotations',
    createdAt: '2026-08-18T00:00:00Z',
    createdByTask: 'scl-modernization-review',
  };
}

function run(returnLabel: string, shapeIndex: SclContractDto[]) {
  return runSclSpecCarriage({
    story: story(),
    baseRow: baseRow(),
    contracts: [behaviourTable(returnLabel)],
    decisions: [decision()],
    wireFactsSectionText: null,
    targetStackSectionText: null,
    shapeIndex,
  });
}

describe('joinResponseShapes', () => {
  it('joins a value:<FQN> outcome to the shape contract of that type (exact FQN first)', () => {
    const joined = joinResponseShapes(
      [behaviourTable('value:com.app.OrderResponse')],
      [shape('S-RESP', 'com.app.OrderResponse'), shape('S-OTHER', 'com.other.OrderResponse')],
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].contract?.contract_key).toBe('S-RESP');
    expect(joined[0].label).toBe('value:com.app.OrderResponse');
  });

  it('joins a SIMPLE-name outcome only when the simple name is unique in the corpus', () => {
    const unique = joinResponseShapes(
      [behaviourTable('value:OrderResponse')],
      [shape('S-RESP', 'com.app.OrderResponse')],
    );
    expect(unique[0].contract?.contract_key).toBe('S-RESP');
    const ambiguous = joinResponseShapes(
      [behaviourTable('value:OrderResponse')],
      [shape('S-A', 'com.app.OrderResponse'), shape('S-B', 'com.other.OrderResponse')],
    );
    expect(ambiguous).toHaveLength(0);
  });

  it('skips JDK / framework return types and reports a non-JDK type with no shape', () => {
    expect(joinResponseShapes([behaviourTable('value:java.util.List<String>')], [shape('S', 'x.Y')])).toHaveLength(0);
    expect(joinResponseShapes([behaviourTable('value:Response')], [shape('S', 'x.Y')])).toHaveLength(0);
    const missing = joinResponseShapes([behaviourTable('value:com.app.Unknown')], [shape('S', 'x.Y')]);
    expect(missing).toHaveLength(1);
    expect(missing[0].contract).toBeNull();
    expect(missing[0].unmatched).toEqual(['com.app.Unknown']);
  });
});

describe('runSclSpecCarriage response-shape section', () => {
  it('carries the joined shape VERBATIM in the endpoint spec, keyed and symbol-named', () => {
    const row = run('value:com.app.OrderResponse', [shape('S-RESP', 'com.app.OrderResponse')]);
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Response shapes (joined by declared return type)');
    expect(text).toContain('Joined from `value:com.app.OrderResponse` on `' + GET_ORDER + '` → contract `S-RESP`');
    expect(text).toContain('### Shape: com.app.OrderResponse');
    expect(text).toContain('| Field | Kind | Nullable | Wire name | Source carrier | Notes |');
    expect(text).toContain('order_id');
  });

  it('renders no section when the index is absent, and an honest note for a type with no shape', () => {
    const none = run('value:com.app.OrderResponse', []);
    expect(none.generatedSpecText).not.toContain('## Response shapes');
    const missing = run('value:com.app.Ghost', [shape('S-RESP', 'com.app.OrderResponse')]);
    expect(missing.generatedSpecText).toContain(
      '_No shape contract in the corpus for returned type `com.app.Ghost`',
    );
  });
});
