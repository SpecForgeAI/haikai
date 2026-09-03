/**
 * Unit pins — code-story verbatim spec carriage (Spec 2026-07-06-h,
 * Code-Tier Oracle Program; captured-examples removal 2026-08-18).
 *
 *   - VERBATIM: fenced canonical JSON round-trips deep-equal to the AMS facts
 *   - FENCE: embedded backtick runs can never terminate a fence early
 *   - NO CAPTURED EXAMPLES (SCL round-3 ruling, 2026-08-18): spec construction
 *     never embeds baseline captures — no 'Captured examples' section, and the
 *     parity obligation points at the reconcile replay instead
 *   - BUDGET: deterministic trim ladder + omission manifest; contracts and
 *     SQL are never dropped
 *   - HONESTY: no contracts -> insufficient_context(no_committed_contracts)
 *     (captures no longer substitute); model drift (endpoint gone) ->
 *     insufficient_context naming the endpoint
 *   - MANUAL-GATE: capture/closure stories get deterministic procedure text
 *   - MARKERS: blob extras map tolerantly (camelCase + snake_case)
 */

import {
  CodeSpecFacts,
  buildCodeSpecText,
  buildInternalProcessSpecText,
  canonicalJson,
  codeCarriageMarkersFromBlob,
  isCodeCarriageStory,
  isCodeFactCarriageStory,
  isManualGateCarriageStory,
  pathMatchesTemplate,
  runCodeSpecCarriage,
} from '../services/migrationCodeSpecCarriage';
import type {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from '../services/migrationShapeSpecGenerationHandler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REQUEST_CONTRACT = {
  schema_version: 'request.v1',
  content_type: 'application/json',
  param_formats: [
    { name: 'from', location: 'query', type: 'LocalDate', pattern: 'dd/MM/yyyy' },
  ],
  required_headers: [{ name: 'X-Tenant', source: '@RequestHeader' }],
};

const RESPONSE_CONTRACT = {
  schema_version: 'response.v1',
  error_responses: [{ exception: 'OwnerNotFound', statusCode: 404, body_shape: '{"error"}' }],
  serialization: { envelope: 'bare object', date_format: 'dd/MM/yyyy' },
};

const PATH_METADATA = {
  operation_hint: 'select',
  transactional: true,
  query_kind: 'native',
  query_text: 'SELECT * FROM owners WHERE id = :id -- has ```backticks``` inside',
  path: [
    { method_id: 'com.x.OwnerController#get(Long)', role: 'controller' },
    { method_id: 'com.x.OwnerService#find(Long)', role: 'service' },
  ],
};

const BEHAVIOUR = {
  schema_version: 'behaviour.v1',
  method_id: 'com.x.OwnerService#find(Long)',
  io: 'takes id, returns owner',
  data_effects: 'reads owners table',
};

function story(overrides: Partial<LoadedBookOfWorkItem> = {}): LoadedBookOfWorkItem {
  return {
    id: 's-1',
    type: 'story',
    parentId: 'f-1',
    title: 'Implement OwnerController (2 endpoints)',
    sequenceOrder: 1,
    workItemId: 'wi-1',
    predictedReadiness: 'ready_for_spec',
    description: 'GET /owners/{id}, POST /owners',
    sourceCapabilityId: null,
    provenance: null,
    kind: null,
    tags: ['provenance:plan-deterministic', 'stream:target_service_api_implementation'],
    packId: null,
    packFilePaths: null,
    packFilePathPrefixes: null,
    codeStoryKind: 'interface-cluster',
    apiInterfaceId: 'iface-1',
    apiEndpointIds: ['e-1'],
    baselineByEndpointId: { 'e-1': 'baseline-1' },
    flagReason: null,
    findingIds: null,
    protocol: 'rest',
    ...overrides,
  } as LoadedBookOfWorkItem;
}

function baseRow(): MigrationStorySpecGenerationDto {
  return {
    projectId: 'p-1',
    workItemId: 'wi-1',
    bookOfWorkId: 'bow-1',
    bookItemId: 's-1',
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

function facts(overrides: Partial<CodeSpecFacts> = {}): CodeSpecFacts {
  return {
    endpoints: [
      {
        id: 'e-1',
        name: 'GET /owners/{id}',
        verb: 'GET',
        path: '/owners/{id}',
        endpointType: 'REST',
        protocol: 'HTTP',
        interfaceName: 'OwnerController',
        requestContract: REQUEST_CONTRACT,
        responseContract: RESPONSE_CONTRACT,
        protocolMetadata: null,
      },
    ],
    dataEffects: [
      { endpointId: 'e-1', accessMode: 'read', pathMetadata: PATH_METADATA, dataEntityPointId: 'dep_phy_owners' },
    ],
    behaviours: [{ name: 'find', behavior: BEHAVIOUR }],
    ...overrides,
  };
}

/** Extract every fenced json block's parsed content from the spec text. */
function parsedJsonBlocks(specText: string): unknown[] {
  const blocks: unknown[] = [];
  const regex = /(`{4,})json\n([\s\S]*?)\n\1/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(specText)) !== null) {
    blocks.push(JSON.parse(match[2]));
  }
  return blocks;
}

// ---------------------------------------------------------------------------

describe('markers + recognition', () => {
  it('maps blob extras tolerantly (camelCase and snake_case)', () => {
    const camel = codeCarriageMarkersFromBlob({
      codeStoryKind: 'interface-cluster',
      apiInterfaceId: 'iface-1',
      apiEndpointIds: ['e-1', 'e-2'],
      baselineByEndpointId: { 'e-1': 'b-1' },
      flagReason: 'missing_baseline',
      findingIds: ['f-1'],
      protocol: 'rest',
    });
    const snake = codeCarriageMarkersFromBlob({
      code_story_kind: 'interface-cluster',
      api_interface_id: 'iface-1',
      api_endpoint_ids: ['e-1', 'e-2'],
      baseline_by_endpoint_id: { 'e-1': 'b-1' },
      flag_reason: 'missing_baseline',
      finding_ids: ['f-1'],
      protocol: 'rest',
    });
    expect(snake).toEqual(camel);
    expect(camel.apiEndpointIds).toEqual(['e-1', 'e-2']);
  });

  it('recognises fact vs manual-gate carriage stories', () => {
    expect(isCodeFactCarriageStory(story())).toBe(true);
    expect(isCodeCarriageStory(story())).toBe(true);
    const manual = story({
      tags: ['provenance:plan-deterministic', 'execution:manual-gate'],
      codeStoryKind: 'capture',
    });
    expect(isManualGateCarriageStory(manual)).toBe(true);
    expect(isCodeFactCarriageStory(manual)).toBe(false);
    const llmStory = story({ tags: ['stream:x'], apiEndpointIds: null });
    expect(isCodeCarriageStory(llmStory)).toBe(false);
  });

  it('an SCL corpus story is NEVER a code-fact-carriage story, even with resolved endpoint ids (2026-09-03)', () => {
    const corpus = story({
      tags: ['provenance:plan-deterministic', 'provenance:scl_corpus', 'scl', 'scl:endpoint:external'],
      codeStoryKind: 'scl-endpoint-group',
      apiEndpointIds: ['e-1', 'e-2'],
    });
    expect(isCodeFactCarriageStory(corpus)).toBe(false);
    expect(isCodeCarriageStory(corpus)).toBe(false);
  });
});

describe('VERBATIM + FENCE pins', () => {
  it('embeds contracts, SQL path metadata, and behaviour blocks that round-trip deep-equal', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;
    const blocks = parsedJsonBlocks(text);
    expect(blocks).toContainEqual(REQUEST_CONTRACT);
    expect(blocks).toContainEqual(RESPONSE_CONTRACT);
    expect(blocks).toContainEqual(PATH_METADATA); // verbatim SQL inside
    expect(blocks).toContainEqual(BEHAVIOUR);
    // The SQL text with backtick runs survives EXACTLY (fence pin).
    expect(text).toContain('has ```backticks``` inside');
    // Canonical serialization is stable: same value -> same text.
    expect(canonicalJson(REQUEST_CONTRACT)).toBe(canonicalJson(JSON.parse(JSON.stringify(REQUEST_CONTRACT))));
  });
});

describe('CAPTURED-EXAMPLES REMOVAL pin (SCL round-3 ruling, 2026-08-18)', () => {
  it('spec construction NEVER embeds captured examples — no section, replay-oracle parity wording instead', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;
    expect(text).not.toContain('Captured examples');
    expect(text).not.toContain('State delta: not captured');
    // The parity obligation stays — anchored on the reconcile replay, not
    // transcribed captures.
    expect(text).toContain('## Parity obligation');
    expect(text).toContain('verification oracle, never a construction input');
  });

  it('matches concrete captured paths to committed templates (reconcile helper — retained)', () => {
    expect(pathMatchesTemplate('/owners/42', '/owners/{id}')).toBe(true);
    expect(pathMatchesTemplate('/owners/42/pets', '/owners/{id}')).toBe(false);
    expect(pathMatchesTemplate('/owners/42?full=true', '/owners/{id}')).toBe(true);
  });
});

describe('BUDGET pin (trim ladder)', () => {
  it('trims read-only behaviour blocks with an omission manifest; contracts and SQL survive', async () => {
    const manyBehaviours = Array.from({ length: 40 }, (_, i) => ({
      name: `readOnly${i}`,
      behavior: {
        schema_version: 'behaviour.v1',
        method_id: `com.x.OwnerService#read${i}(Long)`,
        io: 'reads stuff '.repeat(20),
        data_effects: 'reads owners table',
      },
    }));
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: {
        fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts({ behaviours: manyBehaviours })),
        maxChars: 4_000, // force the ladder
      },
    });
    expect(row.status).toBe('generated_with_warnings');
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Omitted for size');
    expect(text).toContain('readOnly0');
    // Contracts + verbatim SQL are NEVER dropped.
    const blocks = parsedJsonBlocks(text);
    expect(blocks).toContainEqual(REQUEST_CONTRACT);
    expect(blocks).toContainEqual(PATH_METADATA);
  });
});

describe('HONESTY pins', () => {
  it('no committed contracts -> insufficient_context (captures no longer substitute, 2026-08-18)', async () => {
    const empty = facts();
    empty.endpoints[0].requestContract = null;
    empty.endpoints[0].responseContract = null;
    const blocked = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(empty) },
    });
    expect(blocked.status).toBe('insufficient_context');
    const missing = JSON.stringify(blocked.missingInputsJson);
    expect(missing).toContain('no_committed_contracts');
    // The remedy names code discovery — and states the capture posture change.
    expect(missing).toContain('reconcile time only');
  });

  it('endpoint missing from the model -> insufficient_context naming it (regenerate)', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({ apiEndpointIds: ['e-1', 'e-gone'] }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(row.status).toBe('insufficient_context');
    expect(JSON.stringify(row.missingInputsJson)).toContain('e-gone');
    expect(JSON.stringify(row.missingInputsJson)).toContain('regenerate');
  });

  it('facts read failure -> failed row, never a guessed spec', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockRejectedValue(new Error('AMS down')) },
    });
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toContain('AMS down');
  });
});

describe('MANUAL-GATE pin', () => {
  it('capture stories get deterministic procedure text without any facts fetch', async () => {
    const fetchCodeSpecFacts = jest.fn();
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({
        tags: ['provenance:plan-deterministic', 'execution:manual-gate'],
        codeStoryKind: 'capture',
        title: 'Capture API behaviour baseline — OwnerController',
      }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts },
    });
    expect(fetchCodeSpecFacts).not.toHaveBeenCalled();
    expect(row.status).toBe('generated');
    expect(row.generatedSpecText).toContain('Manual-gate work item');
    expect(row.generatedSpecText).toContain('Coverage floor');
  });
});

describe('INTERNAL RECIPE PIN (Spec 2026-07-06-m)', () => {
  it('internal-stream stories skip contract requirements and embed the DB-delta recipe', async () => {
    const internalFacts: CodeSpecFacts = {
      endpoints: [
        {
          id: 'e-1',
          name: 'SCHEDULED 0 0 * * * *',
          verb: null,
          path: null,
          endpointType: 'SCHEDULED',
          protocol: 'internal',
          interfaceName: 'OrderSyncJob',
          requestContract: null,
          responseContract: null,
          protocolMetadata: { cron: '0 0 * * * *', source: 'task-xml' },
        },
      ],
      dataEffects: [
        {
          endpointId: 'e-1',
          accessMode: 'read-write',
          pathMetadata: { query_text: 'UPDATE orders SET synced = 1' },
          dataEntityPointId: 'dep_phy_orders',
        },
      ],
      behaviours: [],
    };
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({
        protocol: 'internal',
        title: 'Implement OrderSyncJob',
        baselineByEndpointId: null,
      }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(internalFacts) },
    });
    expect(row.status).toBe('generated'); // no contracts — and that is FINE here
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Verification recipe (DB-delta oracle');
    expect(text).toContain('dep_phy_orders');
    expect(text).toContain('Trigger / schedule metadata (committed, verbatim)');
    expect(text).toContain('UPDATE orders SET synced = 1');
  });
});

describe('INTERNAL-AWARE CARRIAGE (2026-07-25 fix)', () => {
  const batchEndpoint = {
    id: 'e-b1',
    name: 'BATCH_MAIN com.x.OrderSyncMain',
    verb: 'BATCH_MAIN',
    path: null,
    endpointType: 'INTERNAL_PROCESS',
    protocol: 'internal',
    interfaceName: 'Internal Processing',
    requestContract: null,
    responseContract: null,
    protocolMetadata: {
      endpoint_subtype: 'batch-main',
      class_name: 'com.x.OrderSyncMain',
      method_name: 'main',
    },
  };

  it('an all-internal story persisted with protocol "rest" (interface-cluster bug) routes to the internal recipe, never no_committed_contracts', async () => {
    const internalFacts: CodeSpecFacts = {
      endpoints: [batchEndpoint],
      dataEffects: [
        {
          endpointId: 'e-b1',
          accessMode: 'read-write',
          pathMetadata: { query_text: 'UPDATE orders SET synced = 1' },
          dataEntityPointId: 'dep_phy_orders',
        },
      ],
      behaviours: [],
    };
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({
        protocol: 'rest', // exactly what the cluster story persisted
        title: 'Implement Internal Processing (1 endpoints)',
        apiEndpointIds: ['e-b1'],
        baselineByEndpointId: null,
      }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(internalFacts) },
    });
    expect(row.status).toBe('generated');
    expect(row.missingInputsJson).toBeNull();
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Verification recipe (DB-delta oracle');
    expect(text).toContain('com.x.OrderSyncMain');
    expect(text).not.toContain('no_committed_contracts');
  });

  it('a MIXED story grounds on the internal metadata and renders job facts for the internal endpoint, HTTP endpoint unchanged', async () => {
    const mixedFacts = facts({
      endpoints: [facts().endpoints[0], batchEndpoint],
    });
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({ apiEndpointIds: ['e-1', 'e-b1'] }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(mixedFacts) },
    });
    expect(row.status).toBe('generated_with_warnings');
    // The batch endpoint carries no effect rows -> surfaced, never silent (2026-09-03).
    expect(JSON.stringify(row.warningsJson)).toContain('DATA_EFFECTS_NOT_CAPTURED');
    const text = row.generatedSpecText as string;
    // HTTP endpoint keeps its contract sections.
    expect(text).toContain('### Request contract (committed, verbatim)');
    // Internal endpoint carries its job facts, not contract placeholders.
    expect(text).toContain('### Internal process metadata (committed, verbatim)');
    expect(text).toContain('batch-main');
    expect(text).toContain('no request/response contract applies');
  });

  it('a MIXED story whose only grounding is internal metadata passes the contract gate', async () => {
    const contractlessHttp = {
      ...facts().endpoints[0],
      requestContract: null,
      responseContract: null,
    };
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({ apiEndpointIds: ['e-1', 'e-b1'] }),
      baseRow: baseRow(),
      deps: {
        fetchCodeSpecFacts: jest
          .fn()
          .mockResolvedValue(facts({ endpoints: [contractlessHttp, batchEndpoint] })),
      },
    });
    expect(row.status).toBe('generated_with_warnings');
  });
});

describe('spec text structure', () => {
  it('starts with the required shape-spec prefix and titles every section', () => {
    const text = buildCodeSpecText({
      story: story(),
      facts: facts(),
      behaviours: facts().behaviours,
      omissions: [],
    });
    expect(text.startsWith('/agent-os:shape-spec ')).toBe(true);
    expect(text).toContain('## Endpoint: GET /owners/{id}');
    expect(text).toContain('### Request contract (committed, verbatim)');
    expect(text).toContain('### Response contract (committed, verbatim)');
    expect(text).toContain('### Data effects (1)');
    expect(text).toContain('## Behaviour blocks on the data-effect paths (1)');
    expect(text).toContain('## Parity obligation');
    expect(text).not.toContain('Captured examples');
  });
});

describe('ZERO-DATA-EFFECTS CAVEAT (C3, 2026-08-30)', () => {
  it('an endpoint with zero effects carries the blind-spot caveat, engine-agnostically', () => {
    const text = buildCodeSpecText({
      story: story(),
      facts: facts({ dataEffects: [] }),
      behaviours: [],
      omissions: [],
    });
    expect(text).toContain('### Data effects (0)');
    expect(text).toContain('_No committed data-effect edges for this endpoint._');
    expect(text).toContain(
      '**Zero data effects is NOT evidence that this endpoint writes nothing.**',
    );
    // Both named blind spots + the manual confirmation steps.
    expect(text).toContain('**Stored procedures.**');
    expect(text).toContain('{call ...}');
    expect(text).toContain('DAO interface -> implementation delegation');
    expect(text).toContain("source database's own procedure catalogue");
    expect(text).toContain('DB-delta oracle for this story is unsafe');
    // A re-scan alone is NOT presented as the remedy.
    expect(text).toContain('a re-scan will report zero');
    // Engine-agnostic: this is a GENERIC module (engine-name guard).
    expect(text).not.toMatch(/sysobjects|sybase|postgres/i);
  });

  it('an internal process with zero effects carries the caveat too (its oracle reads the empty scope)', () => {
    const text = buildInternalProcessSpecText({
      story: story({ protocol: 'internal', title: 'Implement OrderSyncJob' }),
      facts: {
        endpoints: [
          {
            id: 'e-1',
            name: 'SCHEDULED 0 0 * * * *',
            verb: null,
            path: null,
            endpointType: 'SCHEDULED',
            protocol: 'internal',
            interfaceName: 'OrderSyncJob',
            requestContract: null,
            responseContract: null,
            protocolMetadata: null,
          },
        ],
        dataEffects: [],
        behaviours: [],
      },
    });
    expect(text).toContain('### Data effects (0)');
    // The pre-existing empty-scope line stays; the caveat rides beneath it.
    expect(text).toContain('the effect scope below is EMPTY');
    expect(text).toContain(
      '**Zero data effects is NOT evidence that this internal process writes nothing.**',
    );
    expect(text).toContain('**Stored procedures.**');
    expect(text).not.toMatch(/sysobjects|sybase|postgres/i);
  });
});

describe('TARGET-STACK SECTION pin (2026-08-14)', () => {
  const SECTION = '## Target technology stack (captured decisions — authoritative)\n\nStack body.';

  it('appends the section to a carried fact spec (after the parity contract)', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
      targetStackSectionText: SECTION,
    });
    expect(row.status).toBe('generated');
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Target technology stack (captured decisions — authoritative)');
    // Appended at the END — the byte-faithful contract body is untouched above it.
    expect(text.indexOf('## Parity obligation')).toBeLessThan(
      text.indexOf('## Target technology stack'),
    );
  });

  it('manual-gate procedure text does NOT receive the section (human/wizard work)', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({
        tags: ['provenance:plan-deterministic', 'execution:manual-gate'],
        codeStoryKind: 'capture',
      }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn() },
      targetStackSectionText: SECTION,
    });
    expect(row.generatedSpecText).not.toContain('## Target technology stack');
  });

  it('absent section -> spec text unchanged (no empty block)', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(row.generatedSpecText).not.toContain('## Target technology stack');
  });
});


describe('DATA-EFFECT FLOORS (2026-09-03, Kiro review MECH-01 / BEHAV-06 / IMPL-05)', () => {
  it('an HTTP story whose endpoints carry ZERO effect rows is insufficient_context naming endpoint_data_effects', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts({ dataEffects: [] })) },
    });
    expect(row.status).toBe('insufficient_context');
    const missing = row.missingInputsJson as Array<{ input: string; reason: string }>;
    expect(missing[0].input).toBe('endpoint_data_effects');
    expect(missing[0].reason).toContain('reland-committed');
    expect(row.generatedSpecText ?? null).toBeNull();
  });

  it('an INTERNAL story with an empty effect scope refuses to render the DB-delta recipe', async () => {
    const internalFacts: CodeSpecFacts = {
      endpoints: [
        {
          id: 'job-1',
          name: 'INTERNAL SCHEDULED OrderSync',
          verb: 'SCHEDULED',
          path: null,
          endpointType: 'INTERNAL_PROCESS',
          protocol: 'internal',
          interfaceName: 'Internal Processing',
          requestContract: null,
          responseContract: null,
          protocolMetadata: { endpoint_subtype: 'scheduled', cron: '0 0 * * * *' },
        },
      ],
      dataEffects: [],
      behaviours: [],
    };
    const row = await runCodeSpecCarriage({
      projectId: 'p1',
      currentArchitectureId: 'arch-1',
      story: story({ apiEndpointIds: ['job-1'], protocol: 'internal' }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(internalFacts) },
    });
    expect(row.status).toBe('insufficient_context');
    const missing = row.missingInputsJson as Array<{ input: string; reason: string }>;
    expect(missing[0].input).toBe('endpoint_data_effects');
    expect(missing[0].reason).toContain('pass unconditionally');
    expect(row.generatedSpecText ?? null).toBeNull();
  });

  it('read-only vs NOT CAPTURED render as distinct markers', () => {
    const readOnly = buildCodeSpecText({ story: story(), facts: facts(), behaviours: facts().behaviours, omissions: [] });
    expect(readOnly).toContain('Read-only as captured: 1 read effect(s), no write effects.');
    expect(readOnly).not.toContain('NOT CAPTURED');
    const none = buildCodeSpecText({ story: story(), facts: facts({ dataEffects: [] }), behaviours: [], omissions: [] });
    expect(none).toContain('### Data effects (0)');
    expect(none).toContain('**NOT CAPTURED**');
  });
});


describe('CODE CARRIAGE ACCEPTANCE CRITERIA + coveredEndpointIds (2026-09-03)', () => {
  it('names the baseline to replay per endpoint (or missing_baseline) and populates coveredEndpointIds', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p1',
      currentArchitectureId: 'arch-1',
      story: story({ apiEndpointIds: ['e-1'], baselineByEndpointId: { 'e-1': 'bl-9' } }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(row.coveredEndpointIds).toEqual(['e-1']);
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Acceptance criteria');
    expect(text).toContain('1. `GET /owners/{id}` (e-1): replay EVERY accepted capture of baseline `bl-9`');
    expect(text.indexOf('## Acceptance criteria')).toBeLessThan(text.indexOf('## Parity obligation'));

    const uncovered = await runCodeSpecCarriage({
      projectId: 'p1',
      currentArchitectureId: 'arch-1',
      story: story({ apiEndpointIds: ['e-1'], baselineByEndpointId: {} }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(uncovered.generatedSpecText).toContain('(e-1): NO active baseline covers it');
  });
});


describe('PROTOCOL HEADER + PROTOCOL METADATA (2026-09-03, MECH-04 / DETAIL-05)', () => {
  it('derives the protocol from the verb when the column is empty and collapses provenance-only metadata', () => {
    const f = facts();
    f.endpoints[0] = {
      ...f.endpoints[0],
      protocol: '',
      protocolMetadata: { discovery_method: 'framework_scanner' },
    };
    const text = buildCodeSpecText({ story: story(), facts: f, behaviours: f.behaviours, omissions: [] });
    expect(text).toContain('protocol: REST/HTTP (derived from the verb)');
    expect(text).not.toContain('protocol: n/a');
    expect(text).not.toContain('SOAP protocol metadata');
    expect(text).toContain('_Protocol metadata carries provenance only (discovery_method=framework_scanner)');
  });

  it('renders REAL protocol facts verbatim under a protocol-neutral heading', () => {
    const f = facts();
    f.endpoints[0] = {
      ...f.endpoints[0],
      protocol: 'SOAP',
      protocolMetadata: { soap_action: 'urn:getOwner', wsdl_operation: 'GetOwner' },
    };
    const text = buildCodeSpecText({ story: story(), facts: f, behaviours: f.behaviours, omissions: [] });
    expect(text).toContain('protocol: SOAP');
    expect(text).toContain('### Protocol metadata (committed, verbatim)');
    expect(text).toContain('urn:getOwner');
  });
});
