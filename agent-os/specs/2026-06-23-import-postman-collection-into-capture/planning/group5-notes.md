# Task Group 5 -- Spike findings + chosen approach

Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A4.
Service: architecture-model-service (AMS).

## 5.1 Spike finding (the constraint, verified)

`discovery_candidate.run_id` is **NOT NULL** and a **FK to `discovery_run(id)`
ON DELETE CASCADE** (Liquibase `070-discovery-candidate.sql:27,35`; entity
`DiscoveryCandidateEntity.runId @Column(nullable = false)`). **A candidate
REQUIRES a parent run.** There is no nullable-run-id path.

The existing candidate-staging endpoint is **NOT a no-op match** for
"Add to architecture":

- `DiscoveryCandidateController` is mounted at
  `.../discovery/runs/{runId}/candidates` -- every write goes through
  `runGuard.verify(runId, projectId, architectureId)`, so it REQUIRES a
  pre-existing run id. The Postman "Add to architecture" consumer
  (`onStageDiscoveryCandidate(item)`, Task Group 4) has a (project,
  architecture) and an imported endpoint, but **NO run id**.
- `frontend/src/api/discoveryReviewApi.ts` is a CONVERSATION client (start /
  answer / capture / confirm over an existing run's agenda). It has **no
  single-candidate "stage one" call**.
- `createRun` (`DiscoveryRunService.createRun`) is unsuitable for a synthetic
  parent: it enforces the **active-run constraint** (409 if a PENDING/RUNNING
  run exists for the project) AND requires a **COMPLETE Phase 0 config** (400)
  for project-scoped code runs. Reusing it would fail spuriously for the
  Postman import flow.

Conclusion: Group 5 is **not** a no-op. A new AMS-side staging path is needed.

## Chosen approach (option b -- least-invasive that fits the schema)

Stage ONE imported endpoint as an un-approved discovery candidate parented by a
**find-or-create lightweight synthetic "imported" run** scoped to (project,
architecture). Why this over the alternatives:

- (a) reuse an existing endpoint -- rejected: none accepts a single-candidate
  create without a caller-supplied run id (see spike).
- (b) parent the candidate by a synthetic run -- CHOSEN. A `discovery_run` row
  with `status='COMPLETED'`, `discovery_kind='code'`, an empty config snapshot,
  a marker `config_snapshot.importedEndpointStaging = true`, created DIRECTLY
  via the repository (NOT via `createRun`) so it bypasses the active-run +
  config gates that do not apply to an import. One synthetic run is REUSED
  across repeated imports for the same (project, architecture) -- found by the
  marker -- so we do not accumulate one run per staged endpoint.
- (c) new Liquibase column / nullable FK -- rejected: NOT needed. The existing
  `discovery_candidate` + `discovery_run` schema already expresses everything
  (a candidate with `review_status='pending_review'`, `status='proposed'`,
  `operation='create'`, and a `data` JSONB carrying method/path/source).

### What was built (AMS)

- NEW DTO `StageImportedCandidateRequest` (snake_case wire per R8; no
  `@CamelCaseWire` -- the discovery candidate data plane is snake_case): carries
  `method`, `path`, optional `name`, `source_item_name`, `summary`.
- NEW service `PostmanImportCandidateStagingService` (its OWN
  `@RequiredArgsConstructor`, depends on `DiscoveryCandidateRepository` +
  `DiscoveryRunRepository`). **Deliberately a new service, NOT a method on
  `DiscoveryCandidateService`**, to avoid changing that service's generated
  constructor -- 5 existing unit tests construct
  `new DiscoveryCandidateService(candidateRepository, runGuard)` manually and
  would all break on a new dependency.
- NEW `@PostMapping("/stage-imported-candidate")` ANCHORED onto the existing
  architecture-scoped `DiscoveryOrphanController`
  (`.../architectures/{architectureId}/discovery`) -- the natural no-runId
  discovery anchor. The candidate is staged un-approved
  (`review_status='pending_review'`, `status='proposed'`).

### Test

`PostmanImportCandidateStagingControllerTest` -- a `@WebMvcTest` slice
(service mocked, like `DiscoveryCandidateControllerTest`). Asserts: the
endpoint posts/parses the snake_case shape, returns the staged un-approved
candidate, and 400s on a missing required field. No Liquibase migration was
added (none required), so no migration needs to run in the test context.

### Frontend client (for Task Group 8 to bind to `onStageDiscoveryCandidate`)

`stageImportedDiscoveryCandidate(...)` added to `frontend/src/api/discoveryApi.ts`
(the existing discovery client). It POSTs the snake_case stage shape and parses
the snake_case `DiscoveryCandidateDto` response, matching that file's existing
fetch/error conventions.

### LIMITATION carried to Group 8 (gateway wiring)

The frontend discovery client talks to the **gateway** at `/api/v1/discovery/*`,
which proxies to the discovery-service / AMS. The new AMS endpoint
(`POST .../discovery/stage-imported-candidate`) is **not yet proxied** by the
gateway. Adding that proxy hop spans the gateway (and possibly
discovery-service) and is **out of Group 5's AMS-side scope**. Group 8 (which
binds `onStageDiscoveryCandidate` and owns the cross-service wiring) must add
the matching gateway proxy route before the frontend call resolves end-to-end.
The AMS endpoint, the request/response contract, and the typed client are all in
place so that binding is a thin pass-through.
