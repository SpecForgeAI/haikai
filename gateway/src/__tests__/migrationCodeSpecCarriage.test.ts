/**
 * Unit pins — code-story verbatim spec carriage (Spec 2026-07-06-h,
 * Code-Tier Oracle Program).
 *
 *   - VERBATIM: fenced canonical JSON round-trips deep-equal to the AMS facts
 *   - FENCE: embedded backtick runs can never terminate a fence early
 *   - EXAMPLES: one canonical example per distinct response status,
 *     happy-first; the state-delta not-captured marker is explicit
 *   - BUDGET: deterministic trim ladder + omission manifest; contracts and
 *     SQL are never dropped
 *   - HONESTY: no contracts -> insufficient_context(no_committed_contracts);
 *     no examples on an unflagged story -> insufficient_context; model drift
 *     (endpoint gone) -> insufficient_context naming the endpoint
 *   - MANUAL-GATE: capture/closure stories get deterministic procedure text
 *   - MARKERS: blob extras map tolerantly (camelCase + snake_case)
 */

import {
  CarriageBaselineExample,
  CodeSpecFacts,
  buildCodeSpecText,
  canonicalJson,
  codeCarriageMarkersFromBlob,
  isCodeCarriageStory,
  isCodeFactCarriageStory,
  isManualGateCarriageStory,
  pathMatchesTemplate,
  runCodeSpecCarriage,
  selectCanonicalExamples,
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
    dataEffects: [{ endpointId: 'e-1', accessMode: 'read', pathMetadata: PATH_METADATA }],
    behaviours: [{ name: 'find', behavior: BEHAVIOUR }],
    examples: [
      ex('happy', 200),
      ex('missing', 404),
    ],
    ...overrides,
  };
}

function ex(scenario: string, status: number, path = '/owners/42'): CarriageBaselineExample {
  return {
    endpointId: 'e-1',
    scenarioName: scenario,
    method: 'GET',
    path,
    requestJson: { query: {}, headers: { 'X-Tenant': 't1' }, body: null },
    responseStatus: status,
    responseJson: status === 200 ? { id: 42, name: 'Ada' } : { error: 'not found' },
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

describe('EXAMPLES pin', () => {
  it('selects one canonical example per distinct status, happy-first, deterministically', () => {
    const all = [ex('b-500', 500), ex('a-404', 404), ex('z-200', 200), ex('a-200', 200)];
    const selected = selectCanonicalExamples(all, 'e-1');
    expect(selected.map((e) => e.responseStatus)).toEqual([200, 404, 500]);
    expect(selected[0].scenarioName).toBe('a-200'); // stable within-status pick
  });

  it('marks the state delta explicitly not captured (Spec N pending)', async () => {
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts()) },
    });
    expect(row.generatedSpecText).toContain('State delta: not captured (Spec N pending).');
  });

  it('matches concrete captured paths to committed templates', () => {
    expect(pathMatchesTemplate('/owners/42', '/owners/{id}')).toBe(true);
    expect(pathMatchesTemplate('/owners/42/pets', '/owners/{id}')).toBe(false);
    expect(pathMatchesTemplate('/owners/42?full=true', '/owners/{id}')).toBe(true);
  });
});

describe('BUDGET pin (trim ladder)', () => {
  it('trims extra examples first with an omission manifest; contracts and SQL survive', async () => {
    const many = [
      ex('s200', 200),
      ex('s400', 400),
      ex('s404', 404),
      ex('s409', 409),
      ex('s500', 500),
    ];
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: {
        fetchCodeSpecFacts: jest.fn().mockResolvedValue(facts({ examples: many })),
        maxChars: 4_000, // force the ladder
      },
    });
    expect(row.status).toBe('generated_with_warnings');
    const text = row.generatedSpecText as string;
    expect(text).toContain('## Omitted for size');
    // Happy + first error survive; later variants are named in the manifest.
    expect(text).toContain('scenario: s200');
    expect(text).toContain('scenario: s400');
    expect(text).toContain('s409');
    // Contracts + verbatim SQL are NEVER dropped.
    const blocks = parsedJsonBlocks(text);
    expect(blocks).toContainEqual(REQUEST_CONTRACT);
    expect(blocks).toContainEqual(PATH_METADATA);
  });
});

describe('HONESTY pins', () => {
  it('no committed contracts anywhere -> insufficient_context(no_committed_contracts)', async () => {
    const bare = facts();
    bare.endpoints[0].requestContract = null;
    bare.endpoints[0].responseContract = null;
    const row = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(bare) },
    });
    expect(row.status).toBe('insufficient_context');
    expect(JSON.stringify(row.missingInputsJson)).toContain('no_committed_contracts');
  });

  it('zero baseline examples on an UNFLAGGED story -> insufficient_context; flagged missing_baseline proceeds', async () => {
    const noExamples = facts({ examples: [] });
    const unflagged = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story(),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(noExamples) },
    });
    expect(unflagged.status).toBe('insufficient_context');
    expect(JSON.stringify(unflagged.missingInputsJson)).toContain('no_baseline_examples');

    const flagged = await runCodeSpecCarriage({
      projectId: 'p-1',
      currentArchitectureId: 'arch-1',
      story: story({ flagReason: 'missing_baseline', codeStoryKind: 'exceptional-endpoint' }),
      baseRow: baseRow(),
      deps: { fetchCodeSpecFacts: jest.fn().mockResolvedValue(noExamples) },
    });
    expect(flagged.status).toBe('generated');
    expect(flagged.generatedSpecText).toContain('missing_baseline');
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

describe('spec text structure', () => {
  it('starts with the required shape-spec prefix and titles every section', () => {
    const canonical = new Map([['e-1', selectCanonicalExamples(facts().examples, 'e-1')]]);
    const text = buildCodeSpecText({
      story: story(),
      facts: facts(),
      examplesByEndpoint: canonical,
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
  });
});
