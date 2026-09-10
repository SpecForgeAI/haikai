/**
 * SCL spec carriage deterministic pins (SCL pipeline spec 8, 2026-08-18). Pins:
 *   - the spec is assembled with NO LLM: contract blocks embedded VERBATIM in
 *     scl_contract_keys order (behaviour rows with cites, call/absorb outcome
 *     rendering, shape field tables, mutated-in-flight warnings);
 *   - the MODERNIZATION DECISIONS section lists only the modernize.* decisions
 *     RELEVANT to the story's contracts (documented deterministic mapping) as
 *     `- [decision:<code>] <answerSummary>`;
 *   - the round-3 TDD acceptance criteria ride verbatim (suite green BEFORE
 *     implementation / no shipped test edited + contested-test protocol /
 *     rows are the contract) and NO captured-examples section exists anywhere;
 *   - missing contract keys / zero modernize.* decisions -> honest
 *     insufficient_context naming the exact remedy (NO partial specs);
 *   - unresolved call references INSIDE a table -> generated_with_warnings
 *     with an UNRESOLVED_REFERENCE warning (carried loudly, never dropped).
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  isSclCorpusStory,
  runSclSpecCarriage,
  sclCarriageMarkersFromBlob,
} from '../sclSpecCarriage';
import { SclContractDto } from '../sclCorpusPlanner';
import { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from '../migrationShapeSpecGenerationHandler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function decision(
  code: string,
  summary: string,
): TargetStateCapturedDecision {
  return {
    decisionId: `d-${code}`,
    projectId: 'p1',
    targetArchitectureId: 'arch-t-1',
    decisionCode: code,
    scopeKind: 'architecture',
    scopeRefId: null,
    answerValue: summary,
    answerSummary: summary,
    createdAt: '2026-08-18T00:00:00Z',
    createdByTask: 'scl-modernization-review',
  };
}

const HTTP_DECISION = decision(
  'modernize.http.jaxrs-annotations',
  'JAX-RS resource annotations -> Spring MVC annotations',
);
const DATES_DECISION = decision(
  'modernize.dates.joda-localdate',
  'org.joda.time.LocalDate -> java.time.LocalDate',
);
const DTO_DECISION = decision('modernize.dto.pojo-record', 'getter/setter POJO -> Java record');
// Irrelevant for an endpoint story with no boundary contract (matcher:
// boundaryClass) — asserted ABSENT from the modernization section.
const DATA_ACCESS_DECISION = decision(
  'modernize.dataaccess.dao-jparepository',
  '*Dao classes -> Spring Data JpaRepository',
);

const GET_ORDER = 'com.app.OrdersController#getOrder(String)';
const VALIDATE = 'com.app.OrdersController#validate(String)';

/** Root behaviour table: terminal + resolved call + absorb rows, glossed. */
function getOrderTable(overrides: Partial<SclContractDto> = {}): SclContractDto {
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
      signatureInputs: [
        { name: 'id', typeRef: 'java.lang.String' },
        { name: 'from', typeRef: 'org.joda.time.LocalDate' },
      ],
      outcomeSignature: [
        { label: 'OK', kind: 'value' },
        { label: 'NOT_FOUND', kind: 'throws' },
      ],
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
        {
          index: 1,
          kind: 'branch',
          conditionVerbatim: 'order != null',
          conditionRef: { path: 'src/com/app/OrdersController.java', line: 47 },
          outcome: { type: 'call', targetKey: 'T-VAL', targetSymbol: VALIDATE },
        },
        {
          index: 2,
          kind: 'catch',
          conditionVerbatim: null,
          conditionRef: null,
          outcome: {
            type: 'absorb',
            exceptionType: 'NotFoundException',
            thenVerbatim: 'return Response.status(404).build()',
            ref: { path: 'src/com/app/OrdersController.java', line: 55 },
            outcomeLabel: 'NOT_FOUND',
          },
        },
      ],
      references: ['T-VAL'],
    },
    gloss_json: {
      intent: 'Fetches an order by id.',
      fragment_name: 'get order',
      row_glosses: { '0': 'Rejects a missing id.' },
    },
    ...overrides,
  };
}

/** Non-shared residue table referenced by the root. */
function validateTable(): SclContractDto {
  return {
    contract_key: 'T-VAL',
    kind: 'behaviour_table',
    source_path: 'src/com/app/OrdersController.java',
    source_symbol: VALIDATE,
    fan_in: 1,
    roots_json: { roots: [GET_ORDER] },
    body_json: {
      symbol: VALIDATE,
      annotations: [],
      rows: [
        {
          index: 0,
          kind: 'branch',
          conditionVerbatim: 'id.isEmpty()',
          conditionRef: { path: 'src/com/app/OrdersController.java', line: 80 },
          outcome: {
            type: 'terminal',
            verbatim: 'return false',
            ref: { path: 'src/com/app/OrdersController.java', line: 81 },
            outcomeLabel: 'INVALID',
          },
        },
      ],
      references: [],
    },
  };
}

function orderShape(): SclContractDto {
  return {
    contract_key: 'S-ORDER',
    kind: 'shape',
    source_path: 'src/com/app/Order.java',
    source_symbol: 'com.app.Order',
    fan_in: 0,
    body_json: {
      symbol: 'com.app.Order',
      representation: 'pojo',
      flags: [],
      fields: [
        {
          name: 'orderDate',
          kind: 'date',
          nullable: false,
          wireName: 'order_date',
          sourceCarrier: 'org.joda.time.LocalDate',
          notes: [],
        },
        {
          name: 'total',
          kind: 'decimal(10,2)',
          nullable: true,
          wireName: null,
          sourceCarrier: 'java.math.BigDecimal',
          notes: ['carried, no observed reader'],
        },
      ],
    },
  };
}

function userShapeMutated(): SclContractDto {
  return {
    contract_key: 'S-USER',
    kind: 'shape',
    source_path: 'src/com/app/User.java',
    source_symbol: 'com.app.User',
    fan_in: 0,
    body_json: {
      symbol: 'com.app.User',
      representation: 'pojo',
      flags: ['mutated_in_flight'],
      fields: [
        {
          name: 'name',
          kind: 'string',
          nullable: false,
          wireName: null,
          sourceCarrier: null,
          notes: [],
        },
      ],
    },
  };
}

function endpointStory(overrides: Partial<LoadedBookOfWorkItem> = {}): LoadedBookOfWorkItem {
  return {
    id: 's-scl-1',
    type: 'story',
    parentId: 'f-1',
    title: 'Implement OrdersController (1 endpoints)',
    sequenceOrder: 10,
    workItemId: 'wi-scl-1',
    tags: [
      'provenance:plan-deterministic',
      'stream:api_migration',
      'provenance:scl_corpus',
      'scl',
      'scl:endpoint:external',
    ],
    codeStoryKind: 'scl-endpoint-group',
    apiEndpointIds: [],
    sclContractKeys: ['T-GET', 'T-VAL'],
    sclLayer: 'endpoint:external',
    sclControllerClass: 'com.app.OrdersController',
    sclRowCount: 4,
    ...overrides,
  } as LoadedBookOfWorkItem;
}

function foundationStory(overrides: Partial<LoadedBookOfWorkItem> = {}): LoadedBookOfWorkItem {
  return {
    id: 's-scl-dto',
    type: 'story',
    parentId: 'f-2',
    title: 'DTO & domain shapes',
    sequenceOrder: 5,
    workItemId: 'wi-scl-dto',
    tags: [
      'provenance:plan-deterministic',
      'stream:api_migration',
      'provenance:scl_corpus',
      'scl',
      'scl:foundation:dto-shapes',
    ],
    codeStoryKind: 'foundation',
    sclContractKeys: ['S-ORDER', 'S-USER'],
    sclLayer: 'dto-shapes',
    sclRowCount: 0,
    ...overrides,
  } as LoadedBookOfWorkItem;
}

const BASE_ROW = {
  projectId: 'p1',
  workItemId: 'wi-scl-1',
  bookOfWorkId: 'bow-1',
  bookItemId: 's-scl-1',
  status: 'failed',
} as MigrationStorySpecGenerationDto;

const STACK_SECTION = '## Target technology stack (captured decisions)\n\n- stack rows here';
const WIRE_SECTION = '## Wire-format fidelity (mined from the captured baseline)\n\n- wire rows here';

// ---------------------------------------------------------------------------
// 1. Endpoint-group full assembly
// ---------------------------------------------------------------------------

describe('runSclSpecCarriage — endpoint-group assembly', () => {
  const row = runSclSpecCarriage({
    story: endpointStory(),
    baseRow: BASE_ROW,
    contracts: [getOrderTable(), validateTable()],
    decisions: [HTTP_DECISION, DATES_DECISION, DATA_ACCESS_DECISION],
    wireFactsSectionText: WIRE_SECTION,
    targetStackSectionText: STACK_SECTION,
  });
  const text = row.generatedSpecText as string;

  it('generates deterministically with high confidence and carriage provenance', () => {
    expect(row.status).toBe('generated');
    expect(row.confidence).toBe('high');
    expect(row.missingInputsJson).toEqual([]);
    expect(row.focusedContextRefsJson).toMatchObject({
      source: 'scl_spec_carriage',
      contractCount: 2,
      controller: 'com.app.OrdersController',
    });
    expect(text).toContain('assembled DETERMINISTICALLY from the SCL corpus');
    expect(text).toContain('never re-derive, substitute, or paraphrase inside a contract block');
    expect(text).toContain(
      'Implement the OrdersController endpoints (1 external) against the pre-built foundational layers'
    );
  });

  it('renders the contract blocks in scl_contract_keys order with verbatim rows + cites', () => {
    const getIdx = text.indexOf(`### Behaviour: ${GET_ORDER}`);
    const valIdx = text.indexOf(`### Behaviour: ${VALIDATE}`);
    expect(getIdx).toBeGreaterThan(-1);
    expect(valIdx).toBeGreaterThan(getIdx);
    // Verbatim condition in backticks + its file:line cite.
    expect(text).toContain('`if (id == null)` (src/com/app/OrdersController.java:42)');
    // Terminal outcome: verbatim + label.
    expect(text).toContain('`throw new BadRequestException("id required")`');
    expect(text).toContain('→ BAD_REQUEST');
    // Call outcome shows the target contract key + symbol.
    expect(text).toContain(`call → [T-VAL] ${VALIDATE}`);
    // Absorb row: exception type + verbatim consequence + label.
    expect(text).toContain('absorb NotFoundException → `return Response.status(404).build()`');
    expect(text).toContain('→ NOT_FOUND');
    // Gloss intent + row gloss included.
    expect(text).toContain('_Intent (guarded gloss): Fetches an order by id._');
    expect(text).toContain('Rejects a missing id.');
    // Outcome signature + references lines.
    expect(text).toContain('Outcome signature: `OK` (value), `NOT_FOUND` (throws)');
    expect(text).toContain('References: `T-VAL`');
  });

  it('normalizes cache-bridge rows and appends the anti-imitation legacy cache note', () => {
    const cached = getOrderTable();
    (cached.body_json as { rows: unknown[] }).rows = [
      ...((cached.body_json as { rows: unknown[] }).rows as unknown[]),
      {
        index: 9,
        kind: 'branch',
        conditionVerbatim: 'cache miss -> loader',
        conditionRef: { path: 'src/com/app/FilterCacheFront.java', line: 21 },
        outcome: { type: 'call', targetKey: 'T-VAL', targetSymbol: VALIDATE },
      },
    ];
    const cachedRow = runSclSpecCarriage({
      story: endpointStory(),
      baseRow: BASE_ROW,
      contracts: [cached, validateTable()],
      decisions: [HTTP_DECISION, DATES_DECISION, DATA_ACCESS_DECISION],
      wireFactsSectionText: WIRE_SECTION,
      targetStackSectionText: STACK_SECTION,
    });
    const cachedText = cachedRow.generatedSpecText as string;
    // The sentinel never reaches the spec verbatim — normalized wording +
    // the ruling note replace it.
    expect(cachedText).not.toContain('`cache miss -> loader`');
    expect(cachedText).toContain('`on legacy cache miss` (src/com/app/FilterCacheFront.java:21)');
    expect(cachedText).toContain('Data effect is the requirement; the legacy cache is NOT.');
    expect(cachedText).toContain('**Legacy cache note:**');
    expect(cachedText).toContain('Do NOT add caching to satisfy this spec.');
    // A carriage run WITHOUT bridge rows carries no note.
    expect(text).not.toContain('**Legacy cache note:**');
  });

  it('cites only the RELEVANT modernize.* decisions (http + dates in; dataaccess out)', () => {
    const section = text.slice(
      text.indexOf('## Modernization decisions'),
      text.indexOf('## Contract blocks'),
    );
    expect(section).toContain(
      '- [decision:modernize.http.jaxrs-annotations] JAX-RS resource annotations -> Spring MVC annotations'
    );
    expect(section).toContain('- [decision:modernize.dates.joda-localdate]');
    // No boundary contract in this story -> the dataaccess decision is ABSENT.
    expect(text).not.toContain('modernize.dataaccess.dao-jparepository');
  });

  it('carries the round-3 TDD acceptance criteria and NO captured-examples section', () => {
    expect(text).toContain('BEFORE implementation');
    expect(text).toContain('is GREEN');
    expect(text).toContain('NO shipped test file was modified');
    expect(text).toContain('CONTESTED');
    expect(text).toContain('contested-test protocol');
    expect(text).toContain('never edited');
    expect(text).toContain('quarantine the test visibly');
    expect(text).toContain('representation may modernize per the cited decisions, semantics may not');
    // Round-3 ruling: captures live ONLY in reconcile + the contradiction pass.
    expect(text).not.toContain('Captured examples');
  });

  it('appends the target-stack section then the wire-fidelity section, in that order', () => {
    const stackIdx = text.indexOf(STACK_SECTION);
    const wireIdx = text.indexOf(WIRE_SECTION);
    const criteriaIdx = text.indexOf('## Acceptance criteria');
    expect(stackIdx).toBeGreaterThan(criteriaIdx);
    expect(wireIdx).toBeGreaterThan(stackIdx);
  });
});

// ---------------------------------------------------------------------------
// 2. Foundation story (dto-shapes layer)
// ---------------------------------------------------------------------------

describe('runSclSpecCarriage — dto-shapes foundation story', () => {
  const row = runSclSpecCarriage({
    story: foundationStory(),
    baseRow: { ...BASE_ROW, workItemId: 'wi-scl-dto', bookItemId: 's-scl-dto' },
    contracts: [orderShape(), userShapeMutated()],
    decisions: [DTO_DECISION, DATES_DECISION],
    wireFactsSectionText: null,
    targetStackSectionText: null,
  });
  const text = row.generatedSpecText as string;

  it('objective cites the pojo-record decision; layer rides the context refs', () => {
    expect(row.status).toBe('generated');
    const objective = text.slice(
      text.indexOf('## Objective'),
      text.indexOf('## Modernization decisions'),
    );
    expect(objective).toContain('[decision:modernize.dto.pojo-record]');
    expect(objective).toContain('NORMATIVE');
    expect(row.focusedContextRefsJson).toMatchObject({
      source: 'scl_spec_carriage',
      contractCount: 2,
      layer: 'dto-shapes',
    });
  });

  it('renders the mutated-in-flight warning on the flagged shape only', () => {
    const orderIdx = text.indexOf('### Shape: com.app.Order');
    const userIdx = text.indexOf('### Shape: com.app.User');
    expect(orderIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(orderIdx);
    const orderBlock = text.slice(orderIdx, userIdx);
    const userBlock = text.slice(userIdx, text.indexOf('## Acceptance criteria'));
    expect(userBlock).toContain('**WARNING — mutated-in-flight:**');
    expect(userBlock).toContain('record-conversion hazard');
    expect(orderBlock).not.toContain('WARNING — mutated-in-flight');
  });

  it('renders the shape field table (name / kind / nullable / wire name / source carrier / notes)', () => {
    expect(text).toContain('| Field | Kind | Nullable | Wire name | Source carrier | Notes |');
    expect(text).toContain(
      '| orderDate | date | no | order_date | org.joda.time.LocalDate |  |'
    );
    expect(text).toContain(
      '| total | decimal(10,2) | yes | — | java.math.BigDecimal | carried, no observed reader |'
    );
    // The dto + dates decisions are both relevant (shape story; Joda carrier).
    expect(text).toContain('- [decision:modernize.dto.pojo-record]');
    expect(text).toContain('- [decision:modernize.dates.joda-localdate]');
  });
});

// ---------------------------------------------------------------------------
// 3. Honest insufficient_context postures
// ---------------------------------------------------------------------------

describe('runSclSpecCarriage — insufficient_context postures', () => {
  it('missing contract key -> insufficient_context naming the key + the re-scan remedy (NO partial spec)', () => {
    const row = runSclSpecCarriage({
      story: endpointStory(),
      baseRow: BASE_ROW,
      contracts: [getOrderTable()], // T-VAL unresolvable
      decisions: [HTTP_DECISION],
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    expect(row.status).toBe('insufficient_context');
    expect(row.generatedSpecText ?? null).toBeNull();
    const missing = row.missingInputsJson as Array<Record<string, unknown>>;
    expect(missing[0].input).toBe('scl_contracts');
    expect(missing[0].missingKeys).toEqual(['T-VAL']);
    expect(String(missing[0].reason)).toContain("'T-VAL'");
    expect(String(missing[0].reason)).toContain('Re-run the code scan');
  });

  it('an EMPTY corpus resolution (fetch failed / no scan) names every key', () => {
    const row = runSclSpecCarriage({
      story: endpointStory(),
      baseRow: BASE_ROW,
      contracts: [],
      decisions: [HTTP_DECISION],
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    expect(row.status).toBe('insufficient_context');
    const missing = row.missingInputsJson as Array<Record<string, unknown>>;
    expect(missing[0].input).toBe('scl_contracts');
    expect(missing[0].missingKeys).toEqual(['T-GET', 'T-VAL']);
  });

  it('ZERO modernize.* decisions -> insufficient_context naming confirmed_modernization_decisions', () => {
    const row = runSclSpecCarriage({
      story: endpointStory(),
      baseRow: BASE_ROW,
      contracts: [getOrderTable(), validateTable()],
      // Non-modernize decisions alone do NOT satisfy the blocking input.
      decisions: [decision('service.framework', 'Spring Boot 4.0.0')],
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    expect(row.status).toBe('insufficient_context');
    const missing = row.missingInputsJson as Array<Record<string, unknown>>;
    expect(missing[0].input).toBe('confirmed_modernization_decisions');
    expect(String(missing[0].reason)).toContain(
      'Confirm the modernization decisions on the Target State screen, then regenerate'
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Unresolved reference inside a table -> warning, not a block
// ---------------------------------------------------------------------------

describe('runSclSpecCarriage — unresolved call reference', () => {
  it('renders the row with an UNRESOLVED marker and downgrades to generated_with_warnings', () => {
    const table = getOrderTable();
    const rows = (table.body_json as Record<string, unknown>).rows as Array<
      Record<string, unknown>
    >;
    rows[1].outcome = {
      type: 'call',
      targetKey: null,
      targetSymbol: 'com.app.LegacyHelper#mystery()',
    };
    const row = runSclSpecCarriage({
      story: endpointStory({ sclContractKeys: ['T-GET'] } as Partial<LoadedBookOfWorkItem>),
      baseRow: BASE_ROW,
      contracts: [table],
      decisions: [HTTP_DECISION],
      wireFactsSectionText: null,
      targetStackSectionText: null,
    });
    expect(row.status).toBe('generated_with_warnings');
    const warnings = row.warningsJson as Array<Record<string, unknown>>;
    expect(warnings.some((w) => w.code === 'UNRESOLVED_REFERENCE')).toBe(true);
    expect(
      warnings.find((w) => w.code === 'UNRESOLVED_REFERENCE')?.targetSymbol
    ).toBe('com.app.LegacyHelper#mystery()');
    expect(row.generatedSpecText).toContain(
      'call → (UNRESOLVED — in-project callee with no corpus contract) com.app.LegacyHelper#mystery()'
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Story recognition + blob markers
// ---------------------------------------------------------------------------

describe('isSclCorpusStory', () => {
  it('recognises the provenance:scl_corpus tag', () => {
    expect(isSclCorpusStory(endpointStory())).toBe(true);
    expect(isSclCorpusStory(foundationStory())).toBe(true);
  });

  it('rejects stories without the tag (including tagless / null tags)', () => {
    expect(
      isSclCorpusStory({ tags: ['provenance:plan-deterministic', 'scl'] }),
    ).toBe(false);
    expect(isSclCorpusStory({ tags: null })).toBe(false);
    expect(isSclCorpusStory({ tags: undefined })).toBe(false);
  });
});

describe('sclCarriageMarkersFromBlob', () => {
  it('maps the snake_case blob keys spec 7 stamps (camelCase tolerated)', () => {
    expect(
      sclCarriageMarkersFromBlob({
        scl_contract_keys: ['T-1', 'S-2'],
        scl_layer: 'dto-shapes',
        scl_controller_class: 'com.app.C',
        scl_row_count: 7,
        scl_boundary_keys: ['Q-3'],
        scl_declared_routes: ['GET /x'],
      }),
    ).toEqual({
      sclContractKeys: ['T-1', 'S-2'],
      sclBoundaryKeys: ['Q-3'],
      sclDeclaredRoutes: ['GET /x'],
      sclLayer: 'dto-shapes',
      sclControllerClass: 'com.app.C',
      sclRowCount: 7,
    });
    expect(
      sclCarriageMarkersFromBlob({ sclContractKeys: ['T-9'], sclRowCount: 1 }),
    ).toMatchObject({ sclContractKeys: ['T-9'], sclRowCount: 1 });
    expect(sclCarriageMarkersFromBlob({})).toEqual({
      sclContractKeys: null,
      sclBoundaryKeys: null,
      sclDeclaredRoutes: null,
      sclLayer: null,
      sclControllerClass: null,
      sclRowCount: null,
    });
  });
});
