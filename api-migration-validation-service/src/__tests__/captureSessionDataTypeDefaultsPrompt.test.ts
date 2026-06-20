/**
 * Capture data-type format defaults -- LLM prompt wiring tests.
 *
 * Spec: 2026-06-20 Capture data-type format defaults -- Task Group 4
 * (`dataTypeDefaults` prompt block + session threading).
 *
 * Covers the load-bearing behaviours for the SEPARATE `dataTypeDefaults`
 * prompt block injected into `buildScenarioPrompt` (NOT an OAS override):
 *
 *   1. The block INCLUDES non-null categories and OMITS `null` (explicit
 *      "no default") categories so the LLM gets no nudge for those types.
 *   2. The block is omitted entirely when the map is empty, all-null, or the
 *      session carries no defaults (null / absent whole-field empty state).
 *   3. The guidance expresses the scan-time precedence both WITH a default
 *      (`code-evidence > operator default > contract > LLM`) and WITHOUT
 *      (operator slot skipped) without contradicting the contract-first
 *      instruction.
 *   4. The value is threaded from `session.dataTypeDefaultsJson` (hydrated by
 *      `toCaptureSession`) all the way to the rendered prompt -- i.e. it reaches
 *      the builder from the session rather than being supplied by hand.
 */

import { buildScenarioPrompt } from '../services/captureSessionOrchestrator';
import { toCaptureSession } from '../services/archModelClient';
import type { CaptureSessionDto } from '../services/archModelClient';
import type { CaptureSession } from '../types/captureSession';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000a1';
const ARCH_ID = '00000000-0000-0000-0000-0000000000b1';
const SESSION_ID = '00000000-0000-0000-0000-0000000000c1';

function buildSessionDomain(
  overrides: Partial<CaptureSession> = {},
): CaptureSession {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'data-type-defaults-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: true,
    startedAt: now,
    completedAt: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildSessionDto(
  overrides: Partial<CaptureSessionDto> = {},
): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'data-type-defaults-session',
    status: 'running',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Parse the single `user` message JSON payload out of the prompt. */
function parseUserPayload(messages: ReturnType<typeof buildScenarioPrompt>): any {
  expect(messages).toHaveLength(2);
  const userMsg = messages[1];
  expect(userMsg.role).toBe('user');
  return JSON.parse(userMsg.content as string);
}

// ---------------------------------------------------------------------------
// Test 1: non-null categories included, null categories omitted.
// ---------------------------------------------------------------------------
test('dataTypeDefaults block INCLUDES non-null categories and OMITS null ones', () => {
  const session = buildSessionDomain();
  // `enum` is an explicit "no default" (null) -> must NOT appear; the two
  // non-null categories must appear with their exact format strings.
  const defaults = {
    date: 'dd-MMM-yyyy',
    decimal: '#0.00',
    enum: null,
  };

  const messages = buildScenarioPrompt(
    session,
    'getPetById',
    'happy_path',
    'GET',
    '/pets/{id}',
    undefined,
    undefined,
    undefined,
    undefined,
    defaults,
  );
  const parsed = parseUserPayload(messages);

  expect(parsed.dataTypeDefaults).toBeDefined();
  expect(parsed.dataTypeDefaults.formats).toEqual({
    date: 'dd-MMM-yyyy',
    decimal: '#0.00',
  });
  // The explicit "no default" category is omitted entirely (no nudge).
  expect(parsed.dataTypeDefaults.formats).not.toHaveProperty('enum');
  expect(Object.keys(parsed.dataTypeDefaults.formats)).not.toContain('enum');
});

// ---------------------------------------------------------------------------
// Test 2: an all-null map yields NO block (every category is "no default").
// ---------------------------------------------------------------------------
test('dataTypeDefaults block is omitted when every category is null (no nudge at all)', () => {
  const session = buildSessionDomain();
  const messages = buildScenarioPrompt(
    session,
    'getPetById',
    'happy_path',
    'GET',
    '/pets/{id}',
    undefined,
    undefined,
    undefined,
    undefined,
    { enum: null, boolean: null },
  );
  const parsed = parseUserPayload(messages);
  expect(parsed.dataTypeDefaults).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Test 3: empty map / absent defaults -> NO block (legacy empty state).
// ---------------------------------------------------------------------------
test('dataTypeDefaults block is omitted when the map is empty or absent', () => {
  const session = buildSessionDomain();

  // Empty object.
  const empty = parseUserPayload(
    buildScenarioPrompt(
      session,
      'getPetById',
      'happy_path',
      'GET',
      '/pets/{id}',
      undefined,
      undefined,
      undefined,
      undefined,
      {},
    ),
  );
  expect(empty.dataTypeDefaults).toBeUndefined();

  // Explicit null whole-field.
  const nullField = parseUserPayload(
    buildScenarioPrompt(
      session,
      'getPetById',
      'happy_path',
      'GET',
      '/pets/{id}',
      undefined,
      undefined,
      undefined,
      undefined,
      null,
    ),
  );
  expect(nullField.dataTypeDefaults).toBeUndefined();

  // Argument omitted entirely (no regression for the no-defaults flow).
  const omitted = parseUserPayload(
    buildScenarioPrompt(session, 'getPetById', 'happy_path', 'GET', '/pets/{id}'),
  );
  expect(omitted.dataTypeDefaults).toBeUndefined();
  // Existing payload fields still present (block is purely additive).
  expect(omitted.sessionId).toBe(SESSION_ID);
  expect(omitted.operationId).toBe('getPetById');
});

// ---------------------------------------------------------------------------
// Test 4: guidance expresses BOTH precedence forms and refines (does not
// contradict) the contract-first instruction.
// ---------------------------------------------------------------------------
test('dataTypeDefaults guidance expresses code>operator-default>contract>LLM and the null skip, refining the contract-first rule', () => {
  const session = buildSessionDomain();
  const messages = buildScenarioPrompt(
    session,
    'getPetById',
    'happy_path',
    'GET',
    '/pets/{id}',
    undefined,
    undefined,
    undefined,
    undefined,
    { date: 'dd-MMM-yyyy', enum: null },
  );
  const parsed = parseUserPayload(messages);
  const guidance: string = parsed.dataTypeDefaults.guidance;

  // WITH a default: the operator default wedges ABOVE the contract but BELOW a
  // field's own code-evidence, and is preferred over the contract format.
  expect(guidance).toContain('NO code-evidence');
  expect(guidance).toContain('PREFER it over the');
  expect(guidance.toLowerCase()).toContain("contract's declared format");
  // A field's own code-evidence still wins (above the operator default).
  expect(guidance.toLowerCase()).toContain("code-evidence still wins");
  // "Defaults not absolutes" -- may still adapt; never retry a rejected format
  // (this is what realises the null/operator-slot-skipped path at scan time:
  // an omitted category simply has no nudge and falls back to contract/LLM).
  expect(guidance.toLowerCase()).toContain('adapt from live');
  expect(guidance.toLowerCase()).toContain('never retry a rejected format');

  // Refines, not contradicts: the base contract-first instruction is still the
  // top-level instruction in the same payload.
  expect(String(parsed.instructions)).toContain(
    'build the request using the contract formats',
  );

  // The omitted (null) category genuinely has no nudge -> its scan-time order
  // collapses to code > contract > LLM (operator slot absent).
  expect(parsed.dataTypeDefaults.formats).not.toHaveProperty('enum');
  expect(parsed.dataTypeDefaults.formats).toHaveProperty('date', 'dd-MMM-yyyy');
});

// ---------------------------------------------------------------------------
// Test 5: the block is threaded from session.dataTypeDefaultsJson (hydrated by
// toCaptureSession) -- it reaches the builder off the session, including null
// map-value preservation through hydration.
// ---------------------------------------------------------------------------
test('dataTypeDefaults is threaded from session.dataTypeDefaultsJson (hydrated by toCaptureSession, null preserved)', () => {
  // Wire shape (snake_case) carrying a non-null AND a null map value.
  const dto = buildSessionDto({
    data_type_defaults_json: { date: 'dd-MMM-yyyy', enum: null },
  });
  const session = toCaptureSession(dto);

  // Hydration carried the field onto the domain projection, null intact.
  expect(session.dataTypeDefaultsJson).toEqual({ date: 'dd-MMM-yyyy', enum: null });

  // Mirror the orchestrator call site: pass session.dataTypeDefaultsJson as the
  // trailing arg. The non-null category surfaces; the null one is omitted.
  const messages = buildScenarioPrompt(
    session,
    'getPetById',
    'happy_path',
    'GET',
    '/pets/{id}',
    undefined,
    undefined,
    undefined,
    undefined,
    session.dataTypeDefaultsJson,
  );
  const parsed = parseUserPayload(messages);
  expect(parsed.dataTypeDefaults.formats).toEqual({ date: 'dd-MMM-yyyy' });

  // And an absent wire field hydrates to null -> no block downstream.
  const bare = toCaptureSession(buildSessionDto());
  expect(bare.dataTypeDefaultsJson).toBeNull();
  const bareParsed = parseUserPayload(
    buildScenarioPrompt(
      bare,
      'getPetById',
      'happy_path',
      'GET',
      '/pets/{id}',
      undefined,
      undefined,
      undefined,
      undefined,
      bare.dataTypeDefaultsJson,
    ),
  );
  expect(bareParsed.dataTypeDefaults).toBeUndefined();
});

// ===========================================================================
// TG7 strategic gap-fill (spec 2026-06-20) -- the HEADLINE end-to-end thread.
// Every hop is unit-tested in isolation above; this one assertion proves the
// continuity across the persist -> hydrate -> prompt boundary: the EXACT
// `data_type_defaults_json` map the wizard PATCHes (a chosen default + an
// explicit `null` "no default") is carried verbatim by `toCaptureSession`
// hydration and, when threaded into `buildScenarioPrompt` straight off
// `session.dataTypeDefaultsJson` (as the orchestrator call site does), yields a
// block that INCLUDES the non-null category and OMITS the null one. This is the
// `persist(null) -> prompt-omits-null` leg of `preview -> seed -> persist(null)
// -> prompt-omits-null`.
// ===========================================================================
test('end-to-end: the persisted {date,enum:null} map hydrates and the prompt block includes date + omits the null enum', () => {
  // The wire shape AMS returns for a session the wizard PATCHed with a concrete
  // date default AND an explicit "(no default)" for enum -- the same shape the
  // AMS round-trip test and the frontend client test pin (null VALUE present,
  // not an absent key).
  const PERSISTED_MAP = { date: 'dd-MMM-yyyy', enum: null } as Record<string, string | null>;

  const dto = buildSessionDto({ data_type_defaults_json: PERSISTED_MAP });

  // 1) Hydration carries the persisted map verbatim onto the domain session,
  //    null VALUE intact (distinct from the absent/empty state).
  const session = toCaptureSession(dto);
  expect(session.dataTypeDefaultsJson).toEqual({ date: 'dd-MMM-yyyy', enum: null });
  expect(session.dataTypeDefaultsJson).toHaveProperty('enum', null);

  // 2) Thread the SESSION-derived value into the builder exactly as the
  //    orchestrator call site does (the trailing arg is
  //    `session.dataTypeDefaultsJson`, not a hand-built map).
  const parsed = parseUserPayload(
    buildScenarioPrompt(
      session,
      'getPetById',
      'happy_path',
      'GET',
      '/pets/{id}',
      undefined,
      undefined,
      undefined,
      undefined,
      session.dataTypeDefaultsJson,
    ),
  );

  // 3) The block exists, INCLUDES the non-null category with its exact string,
  //    and OMITS the explicit "no default" (null) category entirely.
  expect(parsed.dataTypeDefaults).toBeDefined();
  expect(parsed.dataTypeDefaults.formats).toEqual({ date: 'dd-MMM-yyyy' });
  expect(parsed.dataTypeDefaults.formats).not.toHaveProperty('enum');

  // 4) The "no default" category genuinely got no nudge: its scan-time order at
  //    the field level collapses to code > contract > LLM (operator slot absent).
  //    The guidance still refines (does not replace) the contract-first rule.
  expect(String(parsed.instructions)).toContain('build the request using the contract formats');
});
