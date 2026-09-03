/**
 * SCL carriage — contract-key index + boundaries reached (2026-09-03).
 *
 * Kiro review IMPL-02 / C-1: 305 distinct S-/T-/Q- keys were referenced across
 * the book and none was ever defined — shape headings use the FQN, so every
 * `References:` line was dead text. A-2 / C-2: the boundary contracts (DAO
 * SQL) the rows reach were referenced 76 times and rendered in one spec.
 *
 * Pins: References render symbol + [key] + carrying spec; unresolvable keys
 * are marked; reached boundaries carry their verbatim SQL; the spec ends with
 * a key -> kind -> symbol -> carrier index; legacy call (no corpus index)
 * still renders bare keys and no extra sections.
 */

import { runSclSpecCarriage } from '../services/sclSpecCarriage';
import { boundariesReachedBy, SclContractDto } from '../services/sclCorpusPlanner';
import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from '../services/migrationShapeSpecGenerationHandler';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

const GET_ORDER = 'com.app.OrdersController#getOrder(String)';
const DAO = 'com.app.dao.OrderDao';
const DTO = 'com.app.OrderResponse';

function table(refs: string[]): SclContractDto {
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
          kind: 'dispatch',
          conditionVerbatim: '—',
          outcome: { type: 'call', targetKey: 'Q-ORD', targetSymbol: `${DAO}#findById(String)` },
        },
      ],
      references: refs,
    },
  } as unknown as SclContractDto;
}

function shape(): SclContractDto {
  return {
    contract_key: 'S-RESP',
    kind: 'shape',
    source_path: 'src/com/app/OrderResponse.java',
    source_symbol: DTO,
    fan_in: 2,
    roots_json: { roots: [] },
    body_json: { symbol: DTO, representation: 'immutable', fields: [] },
  } as unknown as SclContractDto;
}

function boundary(): SclContractDto {
  return {
    contract_key: 'Q-ORD',
    kind: 'boundary',
    source_path: 'src/com/app/dao/OrderDao.java',
    source_symbol: DAO,
    fan_in: 4,
    roots_json: { roots: [] },
    body_json: {
      symbol: DAO,
      operations: [
        {
          name: 'findById',
          ref: { path: 'src/com/app/dao/impl/OrderDaoImpl.java', line: 42 },
          sqlVerbatim: 'select order_id, total from orders where order_id = ?',
        },
      ],
    },
  } as unknown as SclContractDto;
}

function story(boundaryKeys: string[] | null): LoadedBookOfWorkItem {
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
    sclBoundaryKeys: boundaryKeys,
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

const CARRIERS = new Map<string, { itemId: string; title: string }>([
  ['S-RESP', { itemId: 'SCL-7', title: 'DTO & domain shapes (part 1)' }],
  ['Q-ORD', { itemId: 'SCL-9', title: 'Data-access layer' }],
]);

describe('SCL carriage contract index + boundaries reached', () => {
  it('References render as symbol [key] -> carrying spec; unresolvable keys are marked; index + boundaries render', () => {
    const row = runSclSpecCarriage({
      story: story(['Q-ORD']),
      baseRow: baseRow(),
      contracts: [table(['S-RESP', 'Q-ORD', 'T-MISSING'])],
      decisions: [decision()],
      wireFactsSectionText: null,
      targetStackSectionText: null,
      corpusIndex: [table(['S-RESP', 'Q-ORD', 'T-MISSING']), shape(), boundary()],
      contractCarriers: CARRIERS,
    });
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;

    // References: symbol first, key parenthesised, carrier named.
    expect(text).toContain(`\`${DTO}\` [S-RESP] → spec "DTO & domain shapes (part 1)" (SCL-7)`);
    expect(text).toContain(`\`${DAO}\` [Q-ORD] → spec "Data-access layer" (SCL-9)`);
    expect(text).toContain('`T-MISSING` (unresolved in corpus)');

    // Boundaries reached: the DAO SQL is carried verbatim.
    expect(text).toContain('## Boundaries reached (data access)');
    expect(text).toContain(`### Boundary reached: ${DAO} [Q-ORD] — carried by "Data-access layer" (SCL-9)`);
    expect(text).toContain('select order_id, total from orders where order_id = ?');
    expect(text).toContain('(src/com/app/dao/impl/OrderDaoImpl.java:42)');

    // Contract index: every carried or referenced key, resolved.
    expect(text).toContain('## Contract index');
    expect(text).toContain('| `T-GET` | behaviour_table | `' + GET_ORDER + '` | this spec |');
    expect(text).toContain('| `S-RESP` | shape | `' + DTO + '` | "DTO & domain shapes (part 1)" (SCL-7) |');
    expect(text).toContain('| `Q-ORD` | boundary | `' + DAO + '` | "Data-access layer" (SCL-9) |');
    expect(text).toContain('| `T-MISSING` | unresolved | _not in corpus_ | no carrying spec found |');
  });

  it('legacy call without a corpus index renders bare keys and no index/boundaries sections', () => {
    const row = runSclSpecCarriage({
      story: story(null),
      baseRow: baseRow(),
      contracts: [table(['S-RESP'])],
      decisions: [decision()],
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    const text = row.generatedSpecText as string;
    expect(text).toContain('References: `S-RESP`');
    expect(text).not.toContain('## Contract index');
    expect(text).not.toContain('## Boundaries reached');
  });
});

describe('boundariesReachedBy (planner)', () => {
  it('collects Q- boundaries transitively through shared tables and never descends past a boundary', () => {
    const shared: SclContractDto = {
      ...table(['Q-USR']),
      contract_key: 'T-SHARED',
      source_symbol: 'com.app.Shared#helper()',
      body_json: { symbol: 'com.app.Shared#helper()', rows: [], references: ['Q-USR'] },
    } as unknown as SclContractDto;
    const qUsr: SclContractDto = {
      ...boundary(),
      contract_key: 'Q-USR',
      source_symbol: 'com.app.dao.UserDao',
      body_json: { symbol: 'com.app.dao.UserDao', operations: [], references: ['T-GET'] }, // cycle bait
    } as unknown as SclContractDto;
    const byKey = new Map<string, SclContractDto>([
      ['T-GET', table(['S-RESP', 'Q-ORD', 'T-SHARED'])],
      ['T-SHARED', shared],
      ['S-RESP', shape()],
      ['Q-ORD', boundary()],
      ['Q-USR', qUsr],
    ]);
    const reached = boundariesReachedBy(['T-GET'], (ref) => byKey.get(ref));
    expect(reached).toEqual(['Q-ORD', 'Q-USR']);
    // A shape-only start reaches nothing; an unknown key is ignored.
    expect(boundariesReachedBy(['S-RESP', 'X-NOPE'], (ref) => byKey.get(ref))).toEqual([]);
  });
});
