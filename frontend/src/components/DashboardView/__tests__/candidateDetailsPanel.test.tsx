/**
 * CandidateDetailsPanel Tests
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 4.
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 4.1.
 *
 * Two describe blocks, both driving `<CandidateDetailsPanel candidate={...} />`:
 *
 * 1. `CandidateDetailsPanel` — Spec 1/2 orchestrator coverage preserved
 *    verbatim (wrapper testid, three column headings, three body testids,
 *    exact placeholder strings for Log Scans / LLM Review). The generic
 *    `CandidateEvidenceSectionCard` introduced in Spec 3 emits the same
 *    DOM as the previous bespoke renderers, so these assertions are
 *    byte-identical to Spec 2.
 *
 * 2. `CandidateDetailsPanel — Code Detection section` — rewrite of the
 *    Spec 2 `CodeDetectionPanel` describe block. The dedicated
 *    `CodeDetectionPanel` component was deleted in Spec 3 Task Group 3;
 *    each test now mounts `<CandidateDetailsPanel candidate={...} />` and
 *    continues to assert on the same `code-detection-*` testids, which the
 *    generic `CandidateEvidenceSectionCard` emits when called with
 *    `testIdPrefix="code-detection"`. The per-type field-coverage matrix
 *    (server-shape Spring Boot, client-shape React/axios, Spring controller,
 *    Spring bean, sparse logical entity, sparse interface_logical_entity,
 *    isMostlyEmpty empty-state, source-files list) is preserved as
 *    orchestrator-level integration coverage. Deeper unit coverage of the
 *    wrapper builder lives in `candidateEvidenceBuilder.test.ts` and the
 *    generic card lives in `candidateEvidenceSectionCard.test.tsx`.
 *
 * 3. `CandidateDetailsPanel — Log Scans wire-up (Spec 6 Group 4.1)` — three
 *    integration tests asserting the new `runtimeEvidenceContext` prop is
 *    threaded through the orchestrator into the Log Scans dispatcher.
 *    Exhaustive per-type coverage lives in
 *    `logScansEvidenceBuilder.test.ts` (Group 3); these tests verify
 *    only the panel-level wiring + the LLM-only-with-logs scenario where
 *    Log Scans renders alongside the Code Detection empty-state line.
 *
 * No discoveryApi mocks needed -- the orchestrator is pure presentational
 * and imports nothing from the API client. No ArchitectureContext mocks
 * needed -- it doesn't read context either.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import type { RuntimeEvidenceContext } from '../candidateEvidenceTypes';
import { CandidateDetailsPanel } from '../CandidateDetailsPanel';

// CSS-module identity mock so className assertions (if any) are predictable
// and the components mount without a real CSS pipeline. (Spec 1 pattern.)
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ----------------------------------------------------------------------------
// Fixture builder
// ----------------------------------------------------------------------------

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-001',
    run_id: 'run-001',
    candidate_type: 'endpoints',
    name: 'GET /orders',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/example/SampleController.java'],
    data: {
      _addedBy: 'spring-boot-adapter',
      httpMethod: 'GET',
      fullPath: '/orders',
      controllerClassName: 'OrderController',
      methodName: 'listOrders',
    },
    synthesized_at: '2026-05-10T12:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

// ============================================================================
// CandidateDetailsPanel (orchestrator) -- preserved verbatim from Spec 1/2
// ============================================================================

describe('CandidateDetailsPanel', () => {
  it('renders the three column headings and the three column data-testids', () => {
    const candidate = makeCandidate();
    render(<CandidateDetailsPanel candidate={candidate} />);

    // Wrapper testid uses the candidate id.
    expect(screen.getByTestId(`candidate-details-panel-${candidate.id}`)).toBeInTheDocument();

    // Three column headings.
    expect(screen.getByRole('heading', { level: 4, name: 'Code Detection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Log Scans' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'LLM Review' })).toBeInTheDocument();

    // Three body testids.
    expect(screen.getByTestId('code-detection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('log-scans-panel')).toBeInTheDocument();
    expect(screen.getByTestId('llm-review-panel')).toBeInTheDocument();
  });

  it('shows the exact placeholder strings for Log Scans and LLM Review', () => {
    render(<CandidateDetailsPanel candidate={makeCandidate()} />);

    expect(screen.getByTestId('log-scans-panel')).toHaveTextContent(
      'Log scan evidence was not found for this run.'
    );
    expect(screen.getByTestId('llm-review-panel')).toHaveTextContent(
      'No candidate-specific LLM review details are available yet.'
    );
  });
});

// ============================================================================
// CandidateDetailsPanel — Code Detection section -- per-type shaped assertions
// ============================================================================
//
// Spec 3 rewrite: the dedicated `CodeDetectionPanel` was deleted, so each
// test now mounts `<CandidateDetailsPanel candidate={...} />` and asserts on
// the byte-identical `code-detection-*` testids the generic
// `CandidateEvidenceSectionCard` emits with `testIdPrefix="code-detection"`.
//
// All fixtures use camelCase `candidate.data` keys exactly as the
// discovery-service framework adapters emit them. Each test asserts:
//   - the curated labels documented for that type appear,
//   - the curated reason string is present,
//   - the brief's aspirational labels (which adapters do NOT emit today)
//     are NOT present.
// ============================================================================

describe('CandidateDetailsPanel — Code Detection section', () => {
  // -------------------------------------------------------------------------
  // endpoints — server-shape (Spring Boot)
  // -------------------------------------------------------------------------
  it('renders curated server-shape labels and the controller reason for a Spring Boot endpoint', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-server',
      candidate_type: 'endpoints',
      source_cluster_ids: ['src/main/java/com/example/OwnerController.java'],
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners/{ownerId}',
        controllerClassName: 'OwnerController',
        methodName: 'getOwner',
        responseType: 'OwnerDto',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(screen.getByTestId('code-detection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('code-detection-detected-by')).toHaveTextContent(
      'Detected by: Spring Boot Adapter'
    );
    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Detected as a controller method exposed through framework route annotations.'
    );

    // Curated server-shape field rows present, with their slugified testids.
    expect(screen.getByTestId('code-detection-field-http-method')).toHaveTextContent(
      'HTTP method: GET'
    );
    expect(screen.getByTestId('code-detection-field-path')).toHaveTextContent(
      'Path: /owners/{ownerId}'
    );
    expect(screen.getByTestId('code-detection-field-controller')).toHaveTextContent(
      'Controller: OwnerController'
    );
    expect(screen.getByTestId('code-detection-field-handler-method')).toHaveTextContent(
      'Handler method: getOwner'
    );

    // Client-shape labels must NOT appear on a server-shape candidate.
    expect(screen.queryByTestId('code-detection-field-url')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-calling-function')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-api-library')).not.toBeInTheDocument();

    // Client reason wording must NOT appear.
    expect(screen.getByTestId('code-detection-reason')).not.toHaveTextContent(
      'Detected as an HTTP call from frontend code'
    );

    // Empty-section fallback must NOT appear when curated fields exist.
    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // endpoints — client-shape (React/axios)
  // -------------------------------------------------------------------------
  it('renders curated client-shape labels and the client reason for a React/axios endpoint', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-client',
      candidate_type: 'endpoints',
      source_cluster_ids: ['src/services/orderClient.ts'],
      data: {
        _addedBy: 'react-axios-adapter',
        httpMethod: 'POST',
        url: '/api/orders',
        canonicalUrl: '/api/orders',
        apiLibrary: 'axios',
        callingFunction: 'OrderService.createOrder',
        responseType: 'OrderDto',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(screen.getByTestId('code-detection-detected-by')).toHaveTextContent(
      'Detected by: React (axios/fetch) Adapter'
    );
    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Detected as an HTTP call from frontend code making framework HTTP-client calls.'
    );

    // Curated client-shape field rows present.
    expect(screen.getByTestId('code-detection-field-http-method')).toHaveTextContent(
      'HTTP method: POST'
    );
    expect(screen.getByTestId('code-detection-field-url')).toHaveTextContent(
      'URL: /api/orders'
    );
    expect(screen.getByTestId('code-detection-field-calling-function')).toHaveTextContent(
      'Calling function: OrderService.createOrder'
    );
    expect(screen.getByTestId('code-detection-field-api-library')).toHaveTextContent(
      'API library: axios'
    );

    // Server-shape labels must NOT appear.
    expect(screen.queryByTestId('code-detection-field-controller')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-path')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-handler-method')).not.toBeInTheDocument();

    // Server reason wording must NOT appear.
    expect(screen.getByTestId('code-detection-reason')).not.toHaveTextContent(
      'Detected as a controller method exposed through framework route annotations.'
    );

    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // interfaces — standard Spring controller shape
  // -------------------------------------------------------------------------
  it('renders curated controller labels and the controller reason for a standard Spring interface', () => {
    const candidate = makeCandidate({
      id: 'cand-iface-controller',
      candidate_type: 'interfaces',
      source_cluster_ids: ['src/main/java/com/example/OwnerController.java'],
      data: {
        _addedBy: 'spring-boot-adapter',
        className: 'OwnerController',
        controllerType: 'RestController',
        basePath: '/owners',
        packageName: 'com.example.owner',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Detected as an interface/API surface from framework controller metadata.'
    );

    expect(screen.getByTestId('code-detection-field-class')).toHaveTextContent(
      'Class: OwnerController'
    );
    expect(screen.getByTestId('code-detection-field-interface-type')).toHaveTextContent(
      'Interface type: RestController'
    );
    expect(screen.getByTestId('code-detection-field-base-path')).toHaveTextContent(
      'Base path: /owners'
    );
    expect(screen.getByTestId('code-detection-field-package')).toHaveTextContent(
      'Package: com.example.owner'
    );

    // Bean-shape labels must NOT appear on a controller-shape candidate.
    expect(screen.queryByTestId('code-detection-field-bean-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-bean-return-type')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-configuration-class')).not.toBeInTheDocument();

    // Bean reason must NOT appear.
    expect(screen.getByTestId('code-detection-reason')).not.toHaveTextContent(
      'Detected as a Spring bean definition from a @Configuration class.'
    );

    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // interfaces — Spring bean-definition shape (the discriminator branch)
  // -------------------------------------------------------------------------
  it('renders curated bean labels and the bean reason for a Spring @Configuration bean interface', () => {
    const candidate = makeCandidate({
      id: 'cand-iface-bean',
      candidate_type: 'interfaces',
      source_cluster_ids: ['src/main/java/com/example/AppConfig.java'],
      data: {
        _addedBy: 'spring-boot-adapter',
        interfaceSubtype: 'spring-bean-definition',
        beanName: 'orderService',
        beanReturnType: 'OrderService',
        configurationClassName: 'AppConfig',
        packageName: 'com.example.config',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Detected as a Spring bean definition from a @Configuration class.'
    );

    expect(screen.getByTestId('code-detection-field-bean-name')).toHaveTextContent(
      'Bean name: orderService'
    );
    expect(screen.getByTestId('code-detection-field-bean-return-type')).toHaveTextContent(
      'Bean return type: OrderService'
    );
    expect(screen.getByTestId('code-detection-field-configuration-class')).toHaveTextContent(
      'Configuration class: AppConfig'
    );
    expect(screen.getByTestId('code-detection-field-package')).toHaveTextContent(
      'Package: com.example.config'
    );

    // The bean-shape branch does NOT emit Base path or Class — make that
    // explicit so a future regression that re-enables them is caught.
    expect(screen.queryByTestId('code-detection-field-base-path')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-class')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-interface-type')).not.toBeInTheDocument();

    // Controller reason must NOT appear.
    expect(screen.getByTestId('code-detection-reason')).not.toHaveTextContent(
      'Detected as an interface/API surface from framework controller metadata.'
    );

    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // logical_data_entities — sparse spring-boot output (Type + Package only)
  // -------------------------------------------------------------------------
  it('renders only Type + Package for a sparse spring-boot logical data entity, with no isMostlyEmpty fallback', () => {
    const candidate = makeCandidate({
      id: 'cand-lde-spring',
      candidate_type: 'logical_data_entities',
      source_cluster_ids: ['src/main/java/com/example/OwnerDto.java'],
      data: {
        _addedBy: 'spring-boot-adapter',
        className: 'OwnerDto',
        packageName: 'com.example.owner',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Detected as a logical data shape referenced by interface or endpoint code.'
    );

    expect(screen.getByTestId('code-detection-field-type')).toHaveTextContent(
      'Type: OwnerDto'
    );
    expect(screen.getByTestId('code-detection-field-package')).toHaveTextContent(
      'Package: com.example.owner'
    );

    // The brief's aspirational labels for spring-* logical entities (Kind,
    // Extends) must NOT appear — adapters do not emit these today.
    expect(screen.queryByTestId('code-detection-field-kind')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-extends')).not.toBeInTheDocument();

    // Two curated fields populated -> isMostlyEmpty branch must NOT render.
    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // interface_logical_entities — minimal two-field shape
  // -------------------------------------------------------------------------
  it('renders Interface + Logical data entity with the always-fallback reason for an interface_logical_entities candidate', () => {
    const candidate = makeCandidate({
      id: 'cand-ile',
      candidate_type: 'interface_logical_entities',
      source_cluster_ids: ['src/main/java/com/example/OwnerController.java'],
      data: {
        _addedBy: 'spring-boot-adapter',
        interfaceClassName: 'OwnerController',
        logicalEntityName: 'OwnerDto',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    expect(screen.getByTestId('code-detection-reason')).toHaveTextContent(
      'Detected because interface code references this logical data entity.'
    );

    expect(screen.getByTestId('code-detection-field-interface')).toHaveTextContent(
      'Interface: OwnerController'
    );
    expect(screen.getByTestId('code-detection-field-logical-data-entity')).toHaveTextContent(
      'Logical data entity: OwnerDto'
    );

    // Brief's aspirational fields for interface_logical_entities (relationship
    // role, supporting method) must NOT appear — adapters do not emit them.
    expect(screen.queryByTestId('code-detection-field-relationship-role')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-supporting-method')).not.toBeInTheDocument();
    // Defensive text-level check too in case a future regression renders the
    // brief wording without a testid.
    const panel = screen.getByTestId('code-detection-panel');
    expect(panel).not.toHaveTextContent('Relationship role:');
    expect(panel).not.toHaveTextContent('Supporting method:');

    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // isMostlyEmpty branch — allowlisted type with empty data
  // -------------------------------------------------------------------------
  // Spec 3 semantics intentionally narrowed the `-empty` rule: the
  // generic `CandidateEvidenceSectionCard` emits `code-detection-empty`
  // ONLY when ALL of fields, sourceFiles, reason, and summary are empty.
  // Spec 2's mapper always sets a non-empty `reason`, and source-files are
  // typically present too, so under real candidate data the `-empty`
  // testid is never tripped through the wrapper builder. This test
  // therefore asserts the new-but-equivalent semantics for an empty-data
  // candidate: NO curated field rows render, the structural lines
  // (detected-by, reason, source-files) DO render, and the `-empty`
  // testid is correctly suppressed because the structural lines provide
  // the column body. (Direct-emit coverage of the `-empty` testid path
  // lives in `candidateEvidenceSectionCard.test.tsx`, where the renderer
  // can be driven with a fully-empty section.)
  it('renders structural lines but no curated field rows for an allowlisted type with empty data', () => {
    const candidate = makeCandidate({
      id: 'cand-empty',
      candidate_type: 'interface_logical_entities',
      source_cluster_ids: ['src/main/java/com/example/Sample.java'],
      data: {} as Record<string, unknown>,
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    // No curated field rows when data is empty.
    expect(screen.queryByTestId('code-detection-field-interface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-logical-data-entity')).not.toBeInTheDocument();

    // Reason and detected-by lines still render (they are not type-specific).
    expect(screen.getByTestId('code-detection-reason')).toBeInTheDocument();
    expect(screen.getByTestId('code-detection-detected-by')).toHaveTextContent(
      'Detected by: deterministic code analysis'
    );

    // Source-files block still renders from source_cluster_ids.
    expect(screen.getByTestId('code-detection-source-files')).toBeInTheDocument();

    // `-empty` is correctly suppressed because reason and source-files
    // are present (structural lines provide the column body).
    expect(screen.queryByTestId('code-detection-empty')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // code-detection-source-files rename — vertical list under the new testid
  // -------------------------------------------------------------------------
  it('renders source paths as a vertical list inside the renamed code-detection-source-files block', () => {
    const candidate = makeCandidate({
      id: 'cand-sources',
      candidate_type: 'endpoints',
      source_cluster_ids: [
        'src/main/java/com/example/OwnerController.java',
        'src/main/java/com/example/OwnerService.java',
      ],
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        controllerClassName: 'OwnerController',
        methodName: 'list',
      },
    });
    render(<CandidateDetailsPanel candidate={candidate} />);

    const sourcesBlock = screen.getByTestId('code-detection-source-files');
    expect(sourcesBlock).toBeInTheDocument();

    // Both source paths appear as separate lines inside the block.
    expect(within(sourcesBlock).getByText('Source files:')).toBeInTheDocument();
    expect(
      within(sourcesBlock).getByText('src/main/java/com/example/OwnerController.java')
    ).toBeInTheDocument();
    expect(
      within(sourcesBlock).getByText('src/main/java/com/example/OwnerService.java')
    ).toBeInTheDocument();

    // Spec 1's old testid must NOT exist any more.
    expect(screen.queryByTestId('code-detection-source')).not.toBeInTheDocument();
  });
});

// ============================================================================
// CandidateDetailsPanel — Log Scans wire-up (Spec 6 Group 4.1)
// ============================================================================
//
// Three integration tests asserting the new optional `runtimeEvidenceContext`
// prop is threaded through the orchestrator into the Log Scans dispatcher.
// Exhaustive per-type / per-field-shape coverage of the dispatcher itself
// lives in `logScansEvidenceBuilder.test.ts` (Group 3 unit tests). These
// tests verify only:
//
//   1. The endpoints-candidate happy path: when the candidate's
//      `log_enrichment.runtime.matched` block is populated, the panel
//      emits the exact summary text and the three per-field testids
//      (`log-scans-field-status-codes`, `log-scans-field-first-seen`,
//      `log-scans-field-last-seen`).
//   2. The LLM-only-with-logs scenario: an `endpoints` candidate with NO
//      `_addedBy` adapter tag and NO Code Detection details still
//      renders Log Scans evidence from `log_enrichment.runtime.matched`,
//      AND Code Detection still renders its existing empty-state line
//      (`isMostlyEmpty`-driven `code-detection-empty` testid).
//   3. The orchestrator three-card layout (`code-detection-panel`,
//      `log-scans-panel`, `llm-review-panel`) is preserved verbatim
//      regardless of whether `runtimeEvidenceContext` is supplied.
// ============================================================================

describe('CandidateDetailsPanel — Log Scans wire-up (Spec 6 Group 4.1)', () => {
  // -------------------------------------------------------------------------
  // Helper: build a minimal RuntimeEvidenceContext with empty maps. The
  // panel only needs the per-candidate slice for the endpoints case; the
  // three rollup maps are unused in these tests.
  // -------------------------------------------------------------------------
  function emptyContext(): RuntimeEvidenceContext {
    return {
      byCandidateId: new Map(),
      interfaceRollupByCandidateId: new Map(),
      logicalDataEntityRollupByCandidateId: new Map(),
      interfaceLogicalEntityRollupByCandidateId: new Map(),
    };
  }

  it('threads runtimeEvidenceContext through to Log Scans for an endpoints candidate with matched runtime evidence', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-runtime',
      candidate_type: 'endpoints',
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners/{ownerId}',
        controllerClassName: 'OwnerController',
        methodName: 'getOwner',
      },
      // The endpoints builder reads the per-candidate log_enrichment.runtime
      // block directly; the context is still passed in for other types.
      log_enrichment: {
        runtime: {
          matched: {
            method: 'GET',
            codePathTemplate: '/owners/{ownerId}',
            normalizedLogPath: '/owners/123',
            observedUsageCount: 1842,
            totalLogRequests: 12430,
            status2xxCount: 1500,
            status3xxCount: 42,
            status4xxCount: 250,
            status5xxCount: 50,
            firstSeen: '2026-04-01T12:00:00Z',
            lastSeen: '2026-04-15T08:30:00Z',
            matchConfidence: 0.95,
            matchReason: 'normalized URI match',
          },
        },
      },
    });

    render(
      <CandidateDetailsPanel
        candidate={candidate}
        runtimeEvidenceContext={emptyContext()}
      />
    );

    // Exact summary text from the brief.
    const logScans = screen.getByTestId('log-scans-panel');
    expect(logScans).toHaveTextContent(
      'Observed 1,842 successful/redirect calls in supplied logs.'
    );

    // The three per-field testids the brief calls out by name.
    expect(screen.getByTestId('log-scans-field-status-codes')).toBeInTheDocument();
    expect(screen.getByTestId('log-scans-field-first-seen')).toBeInTheDocument();
    expect(screen.getByTestId('log-scans-field-last-seen')).toBeInTheDocument();

    // Status codes line includes ALL four classes (all > 0 in the fixture).
    expect(screen.getByTestId('log-scans-field-status-codes')).toHaveTextContent(
      '2xx: 1,500 \u00b7 3xx: 42 \u00b7 4xx: 250 \u00b7 5xx: 50'
    );

    // Date-only YYYY-MM-DD format.
    expect(screen.getByTestId('log-scans-field-first-seen')).toHaveTextContent(
      'First seen: 2026-04-01'
    );
    expect(screen.getByTestId('log-scans-field-last-seen')).toHaveTextContent(
      'Last seen: 2026-04-15'
    );

    // The placeholder "not found" string MUST NOT appear when matched
    // evidence is rendered.
    expect(logScans).not.toHaveTextContent(
      'Log scan evidence was not found for this run.'
    );
  });

  it('renders Log Scans evidence AND the Code Detection empty-state appearance for an LLM-only candidate with matched runtime evidence', () => {
    // LLM-only: no `_addedBy` adapter tag, no controller/handler/path
    // fields, no source files. Spec 2's `buildEndpointCodeDetails` always
    // emits a non-empty `reason` (the REASON_ENDPOINT_FALLBACK constant)
    // even when no fields curated, so the renderer's `-empty` testid
    // does NOT fire (the existing Spec 3 test
    // 'renders structural lines but no curated field rows for an
    // allowlisted type with empty data' documents this same behaviour).
    // The "empty-state appearance" the spec refers to is therefore: NO
    // curated field rows in Code Detection, while Log Scans nonetheless
    // renders the matched runtime evidence in full.
    const candidate = makeCandidate({
      id: 'cand-llm-only-runtime',
      candidate_type: 'endpoints',
      source_cluster_ids: [],
      data: {} as Record<string, unknown>,
      log_enrichment: {
        runtime: {
          matched: {
            method: 'POST',
            codePathTemplate: '/llm-suggested',
            normalizedLogPath: '/llm-suggested',
            observedUsageCount: 7,
            totalLogRequests: 100,
            status2xxCount: 7,
            status3xxCount: 0,
            status4xxCount: 0,
            status5xxCount: 0,
            firstSeen: '2026-05-01T00:00:00Z',
            lastSeen: '2026-05-02T00:00:00Z',
            matchConfidence: 0.6,
            matchReason: 'normalized URI match',
          },
        },
      },
    });

    render(
      <CandidateDetailsPanel
        candidate={candidate}
        runtimeEvidenceContext={emptyContext()}
      />
    );

    // Code Detection: NO curated field rows for the LLM-only endpoint
    // (data is empty, so the Spec 2 mapper produces fields=[]).
    expect(screen.queryByTestId('code-detection-field-http-method')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-controller')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-path')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-detection-field-handler-method')).not.toBeInTheDocument();
    // The Code Detection card still mounts (with its reason structural
    // line); the `-empty` testid does NOT fire because reason is always
    // populated by the Spec 2 mapper.
    expect(screen.getByTestId('code-detection-panel')).toBeInTheDocument();

    // Log Scans nonetheless renders the matched runtime evidence in full.
    const logScans = screen.getByTestId('log-scans-panel');
    expect(logScans).toHaveTextContent(
      'Observed 7 successful/redirect calls in supplied logs.'
    );
    expect(screen.getByTestId('log-scans-field-status-codes')).toHaveTextContent(
      '2xx: 7'
    );
    expect(screen.getByTestId('log-scans-field-first-seen')).toHaveTextContent(
      'First seen: 2026-05-01'
    );
    expect(screen.getByTestId('log-scans-field-last-seen')).toHaveTextContent(
      'Last seen: 2026-05-02'
    );
  });

  it('preserves the three-card orchestrator layout when runtimeEvidenceContext is supplied', () => {
    const candidate = makeCandidate({
      id: 'cand-three-card-runtime',
      candidate_type: 'endpoints',
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/orders',
        controllerClassName: 'OrderController',
        methodName: 'list',
      },
    });

    render(
      <CandidateDetailsPanel
        candidate={candidate}
        runtimeEvidenceContext={emptyContext()}
      />
    );

    // Wrapper testid uses the candidate id.
    expect(
      screen.getByTestId(`candidate-details-panel-${candidate.id}`)
    ).toBeInTheDocument();

    // Three column headings.
    expect(screen.getByRole('heading', { level: 4, name: 'Code Detection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Log Scans' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'LLM Review' })).toBeInTheDocument();

    // Three preserved body testids — verbatim from Spec 1/2.
    expect(screen.getByTestId('code-detection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('log-scans-panel')).toBeInTheDocument();
    expect(screen.getByTestId('llm-review-panel')).toBeInTheDocument();
  });
});
// ============================================================================
// CandidateDetailsPanel -- Impact-block population (Spec 7 Group 5.3)
// ============================================================================
//
// End-to-end verification that the Code Detection `Impact: Base confidence`
// block AND the Log Scans `Impact: Confidence increased` block both render
// when (and only when) `displayConfidence > baseConfidence`. Per the Spec 3
// generic renderer (`CandidateEvidenceSectionCard`), the impact block is
// emitted as a single `<div data-testid="${prefix}-confidence-impact">`
// containing the labelled `Impact: <label>` line plus the optional reason.
//
// These two tests close the candidate gap identified in Group 5.2: the
// builder-level wiring is already covered exhaustively by
// `candidateEvidenceBuilder.test.ts` and `logScansEvidenceBuilder.test.ts`,
// but no panel-level integration test confirmed BOTH blocks render together
// inside the orchestrator. Acceptance criterion 14 from `spec.md`.
//
// Note on data shape: `displayConfidence` reads matched runtime evidence
// from `runtimeEvidenceContext.byCandidateId` (the precomputed memo), while
// the endpoints Log Scans builder reads from `candidate.log_enrichment.runtime`
// directly. Both sources must therefore be populated to exercise the
// end-to-end "uplift > 0" path through the orchestrator.
// ============================================================================

describe('CandidateDetailsPanel -- Impact-block population (Spec 7 Group 5.3)', () => {
  function emptyContext(): RuntimeEvidenceContext {
    return {
      byCandidateId: new Map(),
      interfaceRollupByCandidateId: new Map(),
      logicalDataEntityRollupByCandidateId: new Map(),
      interfaceLogicalEntityRollupByCandidateId: new Map(),
    };
  }

  function contextWithEndpointMatched(
    candidateId: string,
    observedUsageCount: number
  ): RuntimeEvidenceContext {
    const ctx = emptyContext();
    ctx.byCandidateId.set(candidateId, {
      runtime: {
        matched: {
          method: 'GET',
          codePathTemplate: '/orders',
          normalizedLogPath: '/orders',
          observedUsageCount,
          totalLogRequests: observedUsageCount,
          status2xxCount: observedUsageCount,
          status3xxCount: 0,
          status4xxCount: 0,
          status5xxCount: 0,
          matchConfidence: 0.95,
          matchReason: 'exact match',
        },
      },
    });
    return ctx;
  }

  it('emits BOTH the Code Detection "Impact: Base confidence" block AND the Log Scans "Impact: Confidence increased" block when displayConfidence > baseConfidence', () => {
    // Adapter endpoint with observedUsageCount = 1842 -> +5 uplift via
    // the adapter rule. baseConfidence 0.80 -> displayConfidence 0.85
    // -> impact blocks should be populated in BOTH builders.
    //
    // Both data sources are populated:
    //   - candidate.log_enrichment.runtime.matched: drives the Log Scans
    //     per-type endpoints builder's summary + status fields.
    //   - runtimeEvidenceContext.byCandidateId: drives getDisplayConfidence's
    //     uplift computation in BOTH the code-detection AND log-scans
    //     dispatchers' impact-block population gate.
    const candidate = makeCandidate({
      id: 'cand-impact-both',
      candidate_type: 'endpoints',
      confidence: 0.8,
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/orders',
        controllerClassName: 'OrderController',
        methodName: 'list',
      },
      log_enrichment: {
        runtime: {
          matched: {
            method: 'GET',
            codePathTemplate: '/orders',
            normalizedLogPath: '/orders',
            observedUsageCount: 1842,
            totalLogRequests: 1842,
            status2xxCount: 1842,
            status3xxCount: 0,
            status4xxCount: 0,
            status5xxCount: 0,
            matchConfidence: 0.95,
            matchReason: 'exact match',
          },
        },
      },
    });

    render(
      <CandidateDetailsPanel
        candidate={candidate}
        runtimeEvidenceContext={contextWithEndpointMatched('cand-impact-both', 1842)}
      />
    );

    // Code Detection impact block: "Base confidence" + adapter reason.
    const codeImpact = screen.getByTestId('code-detection-confidence-impact');
    expect(codeImpact).toHaveTextContent('Impact: Base confidence');
    expect(codeImpact).toHaveTextContent('Deterministic code adapter evidence.');

    // Log Scans impact block: "Confidence increased" + thousand-separated reason.
    const logImpact = screen.getByTestId('log-scans-confidence-impact');
    expect(logImpact).toHaveTextContent('Impact: Confidence increased');
    expect(logImpact).toHaveTextContent(
      'Runtime logs observed 1,842 successful/redirect calls matching this candidate.'
    );
  });

  it('does NOT emit any impact block when displayConfidence === baseConfidence (no log uplift)', () => {
    // Adapter endpoint with NO matched runtime evidence -> uplift = 0
    // -> displayConfidence === baseConfidence -> existing Spec 3
    // conditional-render rule hides the impact block in BOTH sections.
    const candidate = makeCandidate({
      id: 'cand-impact-none',
      candidate_type: 'endpoints',
      confidence: 0.8,
      data: {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/orders',
        controllerClassName: 'OrderController',
        methodName: 'list',
      },
      // no log_enrichment -> no matched runtime block -> +0 uplift
    });

    render(
      <CandidateDetailsPanel
        candidate={candidate}
        runtimeEvidenceContext={emptyContext()}
      />
    );

    // Neither builder populates the impact block; the renderer omits both.
    expect(screen.queryByTestId('code-detection-confidence-impact')).not.toBeInTheDocument();
    expect(screen.queryByTestId('log-scans-confidence-impact')).not.toBeInTheDocument();
  });
});
