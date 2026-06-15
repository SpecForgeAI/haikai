/**
 * Migration Discovery Context -- Group 5 resolver scope verification test.
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration (Task Group 5).
 *
 * Group 2's existing tests already cover resolver registration, default-
 * architecture POST, bounded text + durable IDs, and the fail-soft fallback.
 * The one gap left in the scope-verification charter (task 5.1) is the
 * combination of:
 *
 *   - The no-parameter resolver omits `discoveryRunIds` from the AMS request
 *     body (delegating "latest relevant run" resolution to AMS, per the
 *     shaping decision that the resolver provides a sensible default for
 *     prompt-time use).
 *   - When AMS returns an "insufficient" readiness with empty findings, the
 *     resolver surfaces explicit gap codes from `readinessAssessment.gaps[]`
 *     in the bounded prompt-ready text (no invented detail).
 *
 * This single reinforcement test wires both behaviours through the live
 * resolver so the verification path is proven against the production
 * registry instance (not a hand-built stub).
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing units under test
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
  getContextResolverRegistry,
  initializeContextResolverRegistry,
  MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS,
} from '../services/contextResolvers';
import { _resetDefaultArchitectureCache } from '../services/architectureModelClient';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

function listArchitecturesResponse(architectureId: string) {
  return jsonResponse(200, [
    {
      id: architectureId,
      projectId: 'proj-test',
      name: 'Default',
      description: null,
      tags: [],
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]);
}

/**
 * AMS response simulating an architecture with NO discovery findings, NO
 * baselines, NO mappings -- the "insufficient" path. Readiness is
 * `insufficient` with explicit gap codes from the fixed set.
 */
function buildInsufficientContext(): MigrationDiscoveryContext {
  return {
    projectId: 'proj-test',
    currentArchitectureId: 'arch-default',
    targetArchitectureId: null,
    discoveryRunIds: [],
    apiBehaviourBaselineIds: [],
    generatedAt: '2026-05-16T12:00:00Z',
    summary: 'No discovery runs, baselines, or mappings found for this architecture.',
    currentArchitectureSummary: {
      architectureId: 'arch-default',
      name: 'Default',
      hasModel: true,
    },
    findingsSummary: {
      totalFindings: 0,
      countsByStatus: {},
      countsBySeverity: {},
      countsByCategory: {},
      highSeverityUnreviewedCount: 0,
      sampleDataHintCount: 0,
    },
    highPriorityFindings: [],
    evidenceHighlights: [],
    unresolvedDecisionTasks: [],
    readinessAssessment: {
      overallStatus: 'insufficient',
      apiReadiness: 'insufficient',
      dataReadiness: 'insufficient',
      infrastructureReadiness: 'insufficient',
      discoveryReadiness: 'insufficient',
      mappingReadiness: 'insufficient',
      baselineReadiness: 'insufficient',
      decisionReadiness: 'insufficient',
      gaps: [
        'no_api_behaviour_baseline',
        'missing_current_to_target_mappings',
        'no_database_discovery_findings',
        'insufficient_runtime_evidence',
      ],
    },
    contextWarnings: ['No discovery runs available for this architecture.'],
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  _resetDefaultArchitectureCache();
  initializeContextResolverRegistry();
});

// ---------------------------------------------------------------------------
// Group 5 reinforcement test
// ---------------------------------------------------------------------------
test(
  'no-parameter resolver from live registry omits discoveryRunIds and surfaces explicit gap codes ' +
    'when AMS returns an insufficient readiness assessment',
  async () => {
    // listArchitectures -> default-id lookup.
    mockFetch.mockResolvedValueOnce(listArchitecturesResponse('arch-default'));
    // POST migration-discovery-context -> AMS returns the insufficient view.
    mockFetch.mockResolvedValueOnce(jsonResponse(200, buildInsufficientContext()));

    // Pull the resolver from the live registry rather than instantiating a new
    // one -- proves the registered instance is what the prompt-resolution path
    // actually uses.
    const registry = getContextResolverRegistry();
    const resolver = registry.get('migration-discovery-context');
    expect(resolver).toBeDefined();
    if (!resolver) return; // type narrow

    const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS);

    // --- Latest-run delegation: request body MUST NOT carry discoveryRunIds ---
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, postInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.currentArchitectureId).toBe('arch-default');
    // No-parameter resolver delegates "latest relevant" run selection to AMS.
    expect(body.discoveryRunIds).toBeUndefined();
    // Same applies to baseline IDs: caller-driven only.
    expect(body.apiBehaviourBaselineIds).toBeUndefined();

    // --- Insufficient readiness surfaced as EXPLICIT gap codes ---
    expect(out).toContain('Overall: insufficient');
    expect(out).toContain('no_api_behaviour_baseline');
    expect(out).toContain('missing_current_to_target_mappings');
    expect(out).toContain('no_database_discovery_findings');
    expect(out).toContain('insufficient_runtime_evidence');

    // --- "Do not invent" prompt guard appended ---
    expect(out.toLowerCase()).toContain('inventing details');
    expect(out.toLowerCase()).toContain('prerequisite work');

    // --- Resolver does NOT fabricate findings / baselines / decision tasks
    // that AMS did not report. Empty collections stay empty in the output.
    expect(out).not.toMatch(/findingId=/);
    expect(out).not.toMatch(/baselineId=/);
    expect(out).not.toMatch(/taskId=/);
  }
);
