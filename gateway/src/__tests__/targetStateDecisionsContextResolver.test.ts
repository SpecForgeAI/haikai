/**
 * Target State Decisions context resolver -- gateway tests (Task Group 6, Task 6.1).
 *
 * Spec: 2026-05-24 Target State Captured Decisions -- Data Plane.
 *
 * Test inventory (4 focused tests per the spec's 2-4 cap):
 *   1. No active target architecture: resolver returns the distinct
 *      "no target architecture defined yet" copy.
 *   2. Active target exists but the captured-decisions list is empty:
 *      resolver returns the distinct "no decisions captured yet" copy.
 *   3. Populated decisions render the bounded grouped-by-scope summary:
 *      architecture-wide block first, then per-service / per-interface /
 *      per-element overrides. Each line carries decisionCode, answerSummary,
 *      and the optional standards parenthetical.
 *   4. Registry lookup of 'target-state-decisions-context' resolves to the
 *      new resolver and the key appears in KNOWN_CONTEXT_KEYS.
 *
 * Spec: 2026-06-06 Architect Conversation -- Open-Ended LLM Phase, Task Group 5.
 *
 * Additional inventory (5 focused tests, the 5.1 cap) for the two additive
 * prompt-ready-output sections the open phase feeds:
 *   5. `### Free-form discussion notes` renders from the `note.<slug>` rows.
 *   6. First-class user-raised `adhoc.<slug>` decisions surface under
 *      `### Additional / user-raised decisions` (distinct from the notes).
 *   7. The two open-phase row kinds do NOT bleed into each other's section AND
 *      do NOT disrupt the preset `### Architecture-wide` rendering (preset
 *      architecture-wide rows render exactly as before; new sections come last).
 *   8. With ONLY preset architecture-wide rows present, neither new heading is
 *      emitted (the additive sections are gated on the open-phase rows).
 *   9. The `target-state-decisions-context` resolver registration is unchanged
 *      (both PM tasks still resolve the same resolver instance) -- a guard that
 *      Task Group 5 leaves the registration untouched.
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing the units under test
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  TargetStateDecisionsContextResolver,
  buildTargetStateDecisionsPromptText,
  getContextResolverRegistry,
  getKnownContextKeys,
  initializeContextResolverRegistry,
} from '../services/contextResolvers';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';
import {
  ADHOC_DECISION_CREATED_BY_TASK,
  NOTE_CREATED_BY_TASK,
  adhocDecisionCode,
  noteCode,
} from '../services/architectConversation/openPhaseCodes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () =>
      body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

function activeTargetResponse(savedTargetArchitectureId: string | null) {
  // Spec 2026-06-26 Task Group 3: the resolver now defaults to the
  // most-recent-SAVED target id endpoint (decoupled from "active").
  return jsonResponse(200, { savedTargetArchitectureId });
}

function decision(
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return {
    decisionId: '00000000-0000-0000-0000-000000000001',
    projectId: 'proj-test',
    targetArchitectureId: 'target-abc',
    decisionCode: 'db.engine',
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: 'Postgres 18',
    answerSummary: 'Postgres 18',
    standardsLookupRef: 'Postgres 18 default stack',
    conversationThreadId: null,
    conversationTurnRef: null,
    createdAt: '2026-05-24T12:00:00Z',
    createdByTask: 'architect-persona--target-state-conversation',
    supersededById: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  initializeContextResolverRegistry();
});

// ---------------------------------------------------------------------------
// Test 1: no active target architecture
// ---------------------------------------------------------------------------

test('resolver returns "no target architecture defined yet" when no active target exists', async () => {
  // First (and only) upstream call: active-target lookup returns null.
  mockFetch.mockResolvedValueOnce(activeTargetResponse(null));

  const resolver = new TargetStateDecisionsContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  expect(out).toBe('no target architecture defined yet');

  // Only the active-target lookup ran -- the captured-decisions list call
  // must be skipped when no active target exists.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-test/saved-target-architecture-id',
  );
});

// ---------------------------------------------------------------------------
// Test 2: active target exists but no decisions captured
// ---------------------------------------------------------------------------

test('resolver returns "no decisions captured yet" when active target exists but list is empty', async () => {
  mockFetch.mockResolvedValueOnce(activeTargetResponse('target-abc'));
  mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

  const resolver = new TargetStateDecisionsContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  expect(out).toBe('no decisions captured yet');

  // Two upstream calls: active-target lookup + captured-decisions list.
  expect(mockFetch).toHaveBeenCalledTimes(2);
  const [, postUrl] = mockFetch.mock.calls.map((c) => c[0]);
  expect(postUrl).toBe(
    'http://localhost:8080/api/projects/proj-test/target-architectures/target-abc/captured-decisions',
  );
});

// ---------------------------------------------------------------------------
// Test 3: populated decisions render the grouped-by-scope summary
// ---------------------------------------------------------------------------

test('resolver renders the bounded grouped-by-scope summary when decisions exist', async () => {
  const sample: TargetStateCapturedDecision[] = [
    // Architecture-wide
    decision({
      decisionId: 'd1',
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerSummary: 'Postgres 18',
      standardsLookupRef: 'Postgres 18 default stack',
    }),
    decision({
      decisionId: 'd2',
      decisionCode: 'service.framework',
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerSummary: 'Spring Boot 3.4',
      standardsLookupRef: 'Java 21 / Spring Boot 3.4 default stack',
    }),
    // Per-service override
    decision({
      decisionId: 'd3',
      decisionCode: 'api.protocol',
      scopeKind: 'service',
      scopeRefType: null,
      scopeRefId: 'svc-uuid-abc',
      answerSummary: 'SOAP -- kept for client compatibility',
      standardsLookupRef: null,
    }),
    // Per-interface override
    decision({
      decisionId: 'd4',
      decisionCode: 'auth.scheme',
      scopeKind: 'interface',
      scopeRefType: null,
      scopeRefId: 'iface-uuid-def',
      answerSummary: 'OAuth2 client credentials',
      standardsLookupRef: 'OAuth2 baseline',
    }),
    // Per-element override (scopeRefType non-null per the CHECK constraint)
    decision({
      decisionId: 'd5',
      decisionCode: 'attribute.pii',
      scopeKind: 'element',
      scopeRefType: 'attribute',
      scopeRefId: 'attr-uuid-ghi',
      answerSummary: 'redacted in non-prod',
      standardsLookupRef: null,
    }),
  ];

  // Use the pure renderer for a deterministic shape assertion -- the resolver
  // wrapper is exercised in tests 1/2 (the active-target / list flow).
  const text = buildTargetStateDecisionsPromptText(sample);

  // Header + each section heading.
  expect(text).toContain('## Target State Decisions');
  expect(text).toContain('### Architecture-wide');
  expect(text).toContain('### Per-service overrides');
  expect(text).toContain('### Per-interface overrides');
  expect(text).toContain('### Per-element overrides');

  // Architecture-wide block first -- assert ordering via index comparison.
  const idxArchWide = text.indexOf('### Architecture-wide');
  const idxPerService = text.indexOf('### Per-service overrides');
  const idxPerInterface = text.indexOf('### Per-interface overrides');
  const idxPerElement = text.indexOf('### Per-element overrides');
  expect(idxArchWide).toBeGreaterThan(-1);
  expect(idxArchWide).toBeLessThan(idxPerService);
  expect(idxPerService).toBeLessThan(idxPerInterface);
  expect(idxPerInterface).toBeLessThan(idxPerElement);

  // Decision codes rendered as backtick-quoted code spans.
  expect(text).toContain('`db.engine` = Postgres 18 (standards: Postgres 18 default stack)');
  expect(text).toContain('`service.framework` = Spring Boot 3.4');

  // Scope qualifiers prefix the per-scope override lines.
  expect(text).toContain('service:svc-uuid-abc');
  expect(text).toContain('interface:iface-uuid-def');
  expect(text).toContain('element:attribute:attr-uuid-ghi');

  // standardsLookupRef parenthetical present when non-null, omitted when null.
  expect(text).toContain('(standards: Postgres 18 default stack)');
  expect(text).toContain('(standards: OAuth2 baseline)');
  // The api.protocol override has null standardsLookupRef -- no standards
  // parenthetical should appear for it.
  const apiProtocolLine = text
    .split('\n')
    .find((line) => line.includes('`api.protocol`'));
  expect(apiProtocolLine).toBeDefined();
  expect(apiProtocolLine).not.toContain('standards:');

  // No transcript content (per Q5) -- assert we did NOT leak conversation
  // turn refs or thread ids into the prompt text.
  expect(text).not.toContain('conversationThreadId');
  expect(text).not.toContain('conversationTurnRef');
});

// ---------------------------------------------------------------------------
// Test 4: registry lookup + KNOWN_CONTEXT_KEYS membership
// ---------------------------------------------------------------------------

test('target-state-decisions-context is registered and listed in known keys', () => {
  const registry = getContextResolverRegistry();
  expect(registry.has('target-state-decisions-context')).toBe(true);
  expect(registry.get('target-state-decisions-context')).toBeInstanceOf(
    TargetStateDecisionsContextResolver,
  );

  const keys = getKnownContextKeys();
  expect(keys).toContain('target-state-decisions-context');
});

// ===========================================================================
// Task Group 5 (Spec 2026-06-06 open-ended phase): the two additive sections.
// ===========================================================================

// Factory: a free-form discussion NOTE row exactly as Task Group 4's
// open-phase `summarise` route writes it (architecture scope, `note.<slug>`
// per-note-unique code, distinct `createdByTask`, `answerSummary` =
// "<topicLabel>: <noteText>").
function noteRow(
  topicLabel: string,
  uniqueToken: string,
  noteText: string,
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return decision({
    decisionId: `note-${topicLabel}-${uniqueToken}`,
    decisionCode: noteCode(topicLabel, uniqueToken),
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: noteText,
    answerSummary: `${topicLabel}: ${noteText}`,
    standardsLookupRef: null,
    createdByTask: NOTE_CREATED_BY_TASK,
    ...overrides,
  });
}

// Factory: a first-class user-raised DECISION row exactly as Task Group 4's
// open-phase `pick` route writes it (architecture scope, `adhoc.<slug>` code
// derived from the topic label, distinct `createdByTask`).
function adhocRow(
  topicLabel: string,
  answerSummary: string,
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return decision({
    decisionId: `adhoc-${topicLabel}`,
    decisionCode: adhocDecisionCode(topicLabel),
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: answerSummary,
    answerSummary,
    standardsLookupRef: null,
    createdByTask: ADHOC_DECISION_CREATED_BY_TASK,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Test 5: notes render under `### Free-form discussion notes`
// ---------------------------------------------------------------------------

test('renders `### Free-form discussion notes` from the note.<slug> rows', () => {
  const rows: TargetStateCapturedDecision[] = [
    noteRow('Cutover window', '1', 'Prefer a weekend big-bang cutover.'),
    noteRow('Cutover window', '2', 'Keep a 48h rollback window after switch.'),
    noteRow('Observability', '1', 'Carry the existing Splunk dashboards forward.'),
  ];

  const text = buildTargetStateDecisionsPromptText(rows);

  expect(text).toContain('### Free-form discussion notes');

  // Both per-note-unique codes are present (they do NOT supersede each other).
  expect(text).toContain('`note.cutover-window-1`');
  expect(text).toContain('`note.cutover-window-2`');
  expect(text).toContain('`note.observability-1`');

  // The note bodies are citable verbatim.
  expect(text).toContain('Prefer a weekend big-bang cutover.');
  expect(text).toContain('Keep a 48h rollback window after switch.');
  expect(text).toContain('Carry the existing Splunk dashboards forward.');

  // Notes are NOT mixed into the generic preset architecture-wide grouping:
  // with only note rows there is no `### Architecture-wide` heading at all.
  expect(text).not.toContain('### Architecture-wide');
  // ...and they are not mislabelled as user-raised decisions.
  expect(text).not.toContain('### Additional / user-raised decisions');
});

// ---------------------------------------------------------------------------
// Test 6: user-raised decisions surface under `### Additional / user-raised
// decisions` (distinct from the notes section)
// ---------------------------------------------------------------------------

test('surfaces adhoc.<slug> user-raised decisions under `### Additional / user-raised decisions`', () => {
  const rows: TargetStateCapturedDecision[] = [
    adhocRow('Batch processing', 'Move nightly batch to event-driven streaming.'),
    adhocRow('Caching / CDN strategy', 'Adopt a read-through cache in front of the API.'),
  ];

  const text = buildTargetStateDecisionsPromptText(rows);

  expect(text).toContain('### Additional / user-raised decisions');

  // The generated codes are cited verbatim (citable by specs via evidenceRefs).
  expect(text).toContain('`adhoc.batch-processing` = Move nightly batch to event-driven streaming.');
  expect(text).toContain('`adhoc.caching-cdn-strategy` = Adopt a read-through cache in front of the API.');

  // They are NOT folded into the generic preset grouping and NOT into notes.
  expect(text).not.toContain('### Architecture-wide');
  expect(text).not.toContain('### Free-form discussion notes');
});

// ---------------------------------------------------------------------------
// Test 7: preset + adhoc + note rows render without bleed; preset
// `### Architecture-wide` rendering is byte-faithful and the new sections come
// last (after the per-scope override sections).
// ---------------------------------------------------------------------------

test('preset / adhoc / note rows do not bleed across sections and preset rendering is unchanged', () => {
  const rows: TargetStateCapturedDecision[] = [
    // Preset architecture-wide (the existing rendering must be untouched).
    decision({
      decisionId: 'preset-1',
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      answerSummary: 'Postgres 18',
      standardsLookupRef: 'Postgres 18 default stack',
    }),
    // Preset per-element override (a non-architecture scope to anchor ordering).
    decision({
      decisionId: 'preset-2',
      decisionCode: 'attribute.pii',
      scopeKind: 'element',
      scopeRefType: 'attribute',
      scopeRefId: 'attr-uuid-ghi',
      answerSummary: 'redacted in non-prod',
      standardsLookupRef: null,
    }),
    // Open-phase user-raised decision.
    adhocRow('Batch processing', 'Move nightly batch to event-driven streaming.'),
    // Open-phase note.
    noteRow('Cutover window', '1', 'Prefer a weekend big-bang cutover.'),
  ];

  const text = buildTargetStateDecisionsPromptText(rows);

  // Preset architecture-wide rendering is byte-faithful: the preset row renders
  // under `### Architecture-wide` exactly as before, and the adhoc/note codes
  // do NOT appear in that block.
  const idxArchWide = text.indexOf('### Architecture-wide');
  const idxPerElement = text.indexOf('### Per-element overrides');
  const idxAdhoc = text.indexOf('### Additional / user-raised decisions');
  const idxNotes = text.indexOf('### Free-form discussion notes');

  expect(idxArchWide).toBeGreaterThan(-1);
  expect(idxPerElement).toBeGreaterThan(-1);
  expect(idxAdhoc).toBeGreaterThan(-1);
  expect(idxNotes).toBeGreaterThan(-1);

  // The preset `### Architecture-wide` block still carries ONLY the preset row.
  expect(text).toContain('`db.engine` = Postgres 18 (standards: Postgres 18 default stack)');

  // The two new sections come AFTER the per-scope override sections so the
  // existing scope grouping is undisturbed; notes come last.
  expect(idxArchWide).toBeLessThan(idxPerElement);
  expect(idxPerElement).toBeLessThan(idxAdhoc);
  expect(idxAdhoc).toBeLessThan(idxNotes);

  // No bleed: the adhoc/note codes appear exactly once, each in its own
  // section -- never inside the preset `### Architecture-wide` block.
  const archWideBlock = text.slice(idxArchWide, idxPerElement);
  expect(archWideBlock).not.toContain('adhoc.batch-processing');
  expect(archWideBlock).not.toContain('note.cutover-window');

  const adhocBlock = text.slice(idxAdhoc, idxNotes);
  expect(adhocBlock).toContain('`adhoc.batch-processing`');
  expect(adhocBlock).not.toContain('note.cutover-window');

  const notesBlock = text.slice(idxNotes);
  expect(notesBlock).toContain('`note.cutover-window-1`');
  expect(notesBlock).not.toContain('adhoc.batch-processing');
});

// ---------------------------------------------------------------------------
// Test 8: with ONLY preset architecture-wide rows, neither new heading appears
// (the additive sections are gated on the open-phase rows existing).
// ---------------------------------------------------------------------------

test('does not emit the new headings when only preset rows are present', () => {
  const rows: TargetStateCapturedDecision[] = [
    decision({
      decisionId: 'preset-1',
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      answerSummary: 'Postgres 18',
      standardsLookupRef: 'Postgres 18 default stack',
    }),
    decision({
      decisionId: 'preset-2',
      decisionCode: 'service.framework',
      scopeKind: 'architecture',
      answerSummary: 'Spring Boot 3.4',
      standardsLookupRef: null,
    }),
  ];

  const text = buildTargetStateDecisionsPromptText(rows);

  expect(text).toContain('### Architecture-wide');
  expect(text).toContain('`db.engine` = Postgres 18 (standards: Postgres 18 default stack)');
  expect(text).toContain('`service.framework` = Spring Boot 3.4');

  // The additive sections must be absent when there are no open-phase rows.
  expect(text).not.toContain('### Additional / user-raised decisions');
  expect(text).not.toContain('### Free-form discussion notes');
});

// ---------------------------------------------------------------------------
// Test 9: the resolver registration is UNCHANGED (Task Group 5 must not touch
// the registration or either PM task config). Both PM tasks consume the SAME
// registered resolver instance under `target-state-decisions-context`.
// ---------------------------------------------------------------------------

test('target-state-decisions-context registration is unchanged (single shared resolver instance)', () => {
  const registry = getContextResolverRegistry();

  const resolver = registry.get('target-state-decisions-context');
  expect(resolver).toBeInstanceOf(TargetStateDecisionsContextResolver);

  // Both PM tasks resolve the SAME key -> the SAME instance. A second lookup
  // returns the identical object (no per-call re-registration / swap).
  expect(registry.get('target-state-decisions-context')).toBe(resolver);

  // The key remains in the known-keys set after Task Group 5's renderer change.
  expect(getKnownContextKeys()).toContain('target-state-decisions-context');
});

// ===========================================================================
// Task Group 7 (Spec 2026-06-26): Tier-2 "free facts" feed the prompt-ready
// output. The builder appends a "### Lower-level facts (from manifests)" section
// (additive + gated); the resolver reads the persisted facts off the
// manifest-artifacts store (fail-soft) and passes them in.
// ===========================================================================

const EM_DASH = '—';

function manifestArtifactRow(
  tier2Facts: Array<{ friendly_name: string; coordinate: string }>,
) {
  return {
    id: 'm1',
    project_id: 'proj-test',
    target_architecture_id: 'target-abc',
    tag: 'orders',
    kind: 'pom',
    ecosystem: 'MAVEN',
    manifest_path: 'pom.xml',
    content: '<project/>',
    package_lock_content: null,
    resolved_dependencies: [],
    tier2_facts: tier2Facts,
    is_latest: true,
    created_at: '2026-06-26T00:00:00Z',
  };
}

test('buildTargetStateDecisionsPromptText appends the `### Lower-level facts (from manifests)` section when tier-2 facts are supplied (additive, last)', () => {
  const rows = [decision({ decisionCode: 'db.engine', answerSummary: 'Postgres 18' })];

  const text = buildTargetStateDecisionsPromptText(rows, [
    `MCP SDK ${EM_DASH} io.modelcontextprotocol.sdk`,
    `Spring AI / LLM client ${EM_DASH} spring-ai-openai`,
  ]);

  expect(text).toContain('### Lower-level facts (from manifests)');
  expect(text).toContain(`- MCP SDK ${EM_DASH} io.modelcontextprotocol.sdk`);
  expect(text).toContain(`- Spring AI / LLM client ${EM_DASH} spring-ai-openai`);
  // The section is appended AFTER the preset architecture-wide block (additive).
  expect(text.indexOf('### Architecture-wide')).toBeGreaterThan(-1);
  expect(text.indexOf('### Architecture-wide')).toBeLessThan(
    text.indexOf('### Lower-level facts (from manifests)'),
  );
});

test('buildTargetStateDecisionsPromptText omits the facts section when there are none (default param == explicit empty == byte-faithful)', () => {
  const rows = [decision({ decisionCode: 'db.engine', answerSummary: 'Postgres 18' })];

  const withoutArg = buildTargetStateDecisionsPromptText(rows);
  const withEmpty = buildTargetStateDecisionsPromptText(rows, []);

  expect(withoutArg).not.toContain('### Lower-level facts (from manifests)');
  // No behaviour drift: the new optional param defaults to the prior output.
  expect(withEmpty).toBe(withoutArg);
});

test('the resolver reads persisted Tier-2 free facts off the manifest-artifacts store and feeds them into the prompt-ready output', async () => {
  mockFetch.mockResolvedValueOnce(activeTargetResponse('target-abc'));
  mockFetch.mockResolvedValueOnce(
    jsonResponse(200, [decision({ decisionCode: 'db.engine', answerSummary: 'Postgres 18' })]),
  );
  mockFetch.mockResolvedValueOnce(
    jsonResponse(200, [
      manifestArtifactRow([
        { friendly_name: 'MCP SDK', coordinate: 'io.modelcontextprotocol.sdk' },
      ]),
    ]),
  );

  const resolver = new TargetStateDecisionsContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  // Decisions still render AND the Tier-2 section is appended.
  expect(out).toContain('`db.engine` = Postgres 18');
  expect(out).toContain('### Lower-level facts (from manifests)');
  expect(out).toContain(`- MCP SDK ${EM_DASH} io.modelcontextprotocol.sdk`);

  // Three upstream calls: active-target + captured-decisions + manifest-artifacts.
  expect(mockFetch).toHaveBeenCalledTimes(3);
  const manifestUrl = mockFetch.mock.calls[2][0] as string;
  expect(manifestUrl).toBe(
    'http://localhost:8080/api/model/projects/proj-test/target-architectures/target-abc/manifest-artifacts',
  );
});

test('the resolver is fail-soft if the Tier-2 fetch fails: decisions still render, no facts section, never throws', async () => {
  mockFetch.mockResolvedValueOnce(activeTargetResponse('target-abc'));
  mockFetch.mockResolvedValueOnce(
    jsonResponse(200, [decision({ decisionCode: 'db.engine', answerSummary: 'Postgres 18' })]),
  );
  // manifest-artifacts read fails (non-2xx) -> the helper swallows + returns [].
  mockFetch.mockResolvedValueOnce(jsonResponse(503, { error: 'AMS down' }));

  const resolver = new TargetStateDecisionsContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  expect(out).toContain('`db.engine` = Postgres 18');
  expect(out).not.toContain('### Lower-level facts (from manifests)');
});
