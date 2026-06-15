# Task Breakdown: Infrastructure Terraform Import (GCP)

## Overview
Total Tasks: 7 task groups covering ~10 new backend files (5 service-package files in `service/import/terraform/` + 5 hand-rolled HCL parser files in `service/import/terraform/hcl/` + 1 controller + 4 test classes) plus 1 new test-resources fixture directory; ~5 frontend files (1 modal + 1 menu wiring + 1 TopBar wiring + 1 API helper + 2 tests); 0 Liquibase changesets; 0 new dependencies.

This is the **import-only Terraform feature** layered as the inverse / dual of the Terraform Export spec (`2026-05-08-infrastructure-terraform-export-gcp`). Backend is the bulk of the work (hand-rolled HCL parser + strategy interface + reverse-mapping classifier on `GcpTerraformImporter` + variable/locals/module resolution + relationship inference + matching + service orchestrator + controller + 2 golden-file fixtures). Frontend is moderate: one two-step modal (upload form → read-only review table), one menu item, one TopBar wiring, one API helper, two tests.

**Locked contract from the spec + requirements (do not violate):**
- All 12 clarifying-question defaults from `planning/requirements.md` apply.
- snake_case JSON throughout backend payloads (matches existing `@JsonProperty("snake_case")` pattern).
- Hand-rolled tolerant subset HCL parser — **no new Maven dependency** (no HashiCorp HCL4j, no ANTLR, no Apache Commons Compress for ZIP read; reuse `java.util.zip.{ZipInputStream, ZipEntry}`).
- Strategy interface registered as Spring beans by `providerId()` in `Map<String, TerraformImporter>`. V1 registers only `GcpTerraformImporter` (`providerId() == "GCP"`).
- Reuse `iacSourceProviderOptions` from `frontend/src/config/defaults.ts` (line 1321) for the provider dropdown — do **NOT** redeclare or modify. Backend mirror via the existing `TerraformExportService.PROVIDER_OPTIONS` (or equivalent shared `Set<String>`) — reuse, do not duplicate.
- Zero Liquibase changesets (V1 transient — no `ImportRunEntity` row, no per-candidate persistence; provenance + binding + source schemas already exist from Spec 7).
- No edits to `ModelController.java`, `InfrastructureTerraformExportController.java`, `TerraformExportService.java`, `GcpTerraformExporter.java`, the existing 16 Infrastructure grids, existing diagram palette / edges, gateway, mcp-server, discovery-service.
- No edits to applied Liquibase changesets (≤125).
- Hard-fail (4xx) ONLY for: any file part missing; `environmentId` missing; `provider` missing or not in `iacSourceProviderOptions`; `provider` not registered in the importer map (V1: anything other than `GCP`); ZIP > configured max size; any individual file > configured max size. Hard-fail boundary checks run BEFORE parse to avoid wasted I/O.
- All other validation gaps (unknown resource types, unresolved `var.x` / `local.x` references, missing local module files, malformed HCL fragments, partial LB composite, ambiguous matching) are **soft-warn**: TODO entry on the candidate AND entry in the result-level `warnings` list. Soft-warns NEVER throw out of the importer.
- Slug helper: reuse `name.toLowerCase().replaceAll("[^a-z0-9]+", "_")` shared with the export.
- `iac_address` MUST be persisted byte-equal to what the parser saw — round-trip stability with the export is a top-level invariant pinned by `TerraformImportRoundTripTest`.
- Confidence buckets: HIGH (`0.900`) / MEDIUM (`0.600`) / LOW (`0.300`) stored as `DECIMAL(4,3)` on `IaCResourceBinding.confidence`. Only these three values in V1.
- Field-precedence on match (`willUpdate`): user-edited `name` + `description` win; imported wins for technical fields (CIDR, region, engine, type, `provider_resource_type`, machine type, version, etc.).
- Whole upload (ZIP root OR set of `.tf` files) is ONE proposed `IaCSource`. All bindings produced by the run point at this single source.
- Local module references (`source = "./modules/x"`) are followed when present in the upload; remote module sources (`git::`, `registry.terraform.io/...`) → soft-warn TODO; importer NEVER fetches.
- V1 deterministic-only — no LLM, no feature flag (Q12).
- Safety boundaries (verbatim from requirements): NO `terraform init/plan/apply`, NO GCP API calls, NO credentials, NO Git checkout, NO remote backend access, NO remote module fetch, NO model mutation in this spec's controller (mutation flows through the existing model-save endpoint on "Approve all").
- Per-individual candidate approve/ignore controls in the UI are **deferred** (Q11=b: V1 ships read-only summary + "Approve all" / "Discard all"). The candidate payload shape MUST already carry per-candidate identity + ignore-state plumbing so the follow-up UI spec is pure UI work.

**Carry-forward test-failure context (do not investigate during this spec):**
- Pre-existing broken backend tests carry forward unchanged. Apply the broken-tests staging workaround (move them temporarily out of `src/test/java`, run targeted tests, restore) at every targeted backend-test verification step, mirroring the export spec's discipline.
- Pre-existing frontend failures listed in project memory remain untouched.

**Implementer note — the heaviest groups are 2 + 3:** the hand-rolled HCL parser (Group 2) and the per-resource reverse-mapping classifier on `GcpTerraformImporter` (Group 3) carry the bulk of the resource-handling logic. Plan accordingly. Group 4 (resolution + matching + relationship inference) is conceptually dense but small in code volume. Group 6 (golden-file + round-trip fixtures) is the round-trip-parity gate against the export spec; expect to iterate on the fixture inputs once.

---

## Task List

### Backend — Service Foundation

#### Task Group 1: Strategy Interface + Records + Context Carrier
**Dependencies:** None

- [x] 1.0 Create the foundation interface, records, and context carrier under a new `service/import/terraform/` package
  - [x] 1.1 Write 2-3 focused tests for foundation types
    - One test asserting `ImportedCandidate` is a record with the expected components: `targetEntityType` (discriminator string), `proposedEntityFields` (Map), `proposedBinding` (IaCResourceBinding shape), `confidence` (BigDecimal), `perCandidateWarnings` (List), and an `evidence` block (`filePath`, `startLine`, `endLine`, `rawSnippet`, `unresolvedExpressionText`).
    - One test asserting `ImportReviewResult` is a record carrying `iacSource` proposal, `willCreate`, `willUpdate`, `unsupported`, `warnings`, and a `summary` block with counts per category.
    - One test asserting `TerraformImportContext` carries the parsed HCL files + selected `environmentId` / `cloudAccountId` / `locationId` / `providerId` + the loaded existing model + a mutable `warnings` collector + lookup maps for matching by `iac_address`.
    - Optionally one test asserting the `TerraformImporter` interface signature: `String providerId()` + `List<ImportedCandidate> importResources(TerraformImportContext ctx)`.
    - Bundle into a single test file with 2-3 tightly grouped methods.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImporterFoundationTest.java`
    - Total tests in this file: 2-3 max.
  - [x] 1.2 Create `TerraformImporter` strategy interface
    - Methods: `String providerId();` plus `List<ImportedCandidate> importResources(TerraformImportContext ctx);`.
    - Default-method bodies are NOT supplied — V1 registers only `GcpTerraformImporter`; future providers implement the same interface.
    - Mirrors `TerraformExporter` shape for symmetric naming.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/TerraformImporter.java`
    - **NB:** package `import_` (with trailing underscore) because `import` is a reserved keyword in Java. Confirm directory naming convention with the repo (likely the package is named differently — e.g. `tfimport` or `inbound` — match what the existing repo prefers; check first via a quick search of existing package naming choices for any other reserved-keyword cases).
  - [x] 1.3 Create `ImportedCandidate` record
    - Components: `String targetEntityType` (discriminator: `Network` / `Subnet` / `ComputeCluster` / `ComputeResource` / `DeploymentUnit` / `LoadBalancer` / `Listener` / `DataStoreInstance` / `InfrastructureResource` / `CloudAccount` / `Location` / `Environment` / `Unsupported`), `Map<String, Object> proposedEntityFields`, `ProposedBinding proposedBinding` (nested record holding `iac_address`, `iac_resource_type`, `iac_resource_name`, `provider`, `file_path`, `start_line`, `end_line`, `external_id` opt, `confidence`), `BigDecimal confidence`, `List<String> perCandidateWarnings`, `Evidence evidence` (nested record: `filePath`, `startLine`, `endLine`, `rawSnippet`, `unresolvedExpressionText`).
    - Per-candidate identity + ignore-state plumbing fields included in the shape (e.g. `String candidateId`, `boolean ignored`) so the follow-up per-row-controls spec is pure UI work — set defaults appropriately for V1 (unique UUID per candidate, `ignored=false`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/ImportedCandidate.java`
  - [x] 1.4 Create `ImportReviewResult` record
    - Components: `ProposedIaCSource iacSource` (nested record holding `repositoryUrl`, `branch`, `commitSha`, `path`, `workspace`, `provider`), `List<ImportedCandidate> willCreate`, `List<ImportedCandidate> willUpdate`, `List<ImportedCandidate> unsupported`, `List<String> warnings`, `Summary summary` (nested record: `int willCreateCount`, `int willUpdateCount`, `int unsupportedCount`, `int totalWarningsCount`).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/ImportReviewResult.java`
  - [x] 1.5 Create `TerraformImportContext` value class
    - Carries: `List<ParsedHclFile> hclFiles` (each with `filePath`, list of `HclBlock`s, and per-block line ranges); user-supplied import options (`UUID environmentId` required, `UUID cloudAccountId` opt, `UUID locationId` opt, `String providerId` required, `String repositoryUrl` opt, `String branch` opt, `String commitSha` opt, `String path` opt, `String workspace` opt); the loaded existing `MetaModelDto`; pre-built lookup map `Map<String, IaCResourceBindingDto>` keyed by `iac_address` for matching; mutable `List<String> warnings` collector; static slug helper `slugify(String)`.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/TerraformImportContext.java`
  - [x] 1.6 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround (move pre-existing broken backend test files temporarily out of `src/test/java`).
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the test from 1.1.
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2-3 tests written in 1.1 pass.
- `TerraformImporter` interface compiles with `String providerId()` + `List<ImportedCandidate> importResources(TerraformImportContext ctx)`.
- `ImportedCandidate` is a Java record with the documented components AND per-candidate identity + ignore-state plumbing fields.
- `ImportReviewResult` is a Java record with the documented components + nested `Summary` record carrying counts.
- `TerraformImportContext` exposes parsed HCL files + user-supplied options + loaded model + matching lookup map + mutable warnings collector + static `slugify` helper.
- Package `service/import_/terraform/` (or repo-preferred non-reserved-keyword equivalent) is created and compiles cleanly.

---

### Backend — HCL Parser

#### Task Group 2: Hand-rolled Tolerant HCL Subset Parser
**Dependencies:** Task Group 1

- [x] 2.0 Build the hand-rolled HCL lexer + parser supporting the locked subset, with line-range tracking and comment preservation
  - [x] 2.1 Write 4-8 focused tests for the lexer + parser
    - **Lexer tests** (one test class, ~3-4 methods):
      - Token-stream test: input `resource "google_compute_network" "vpc" { name = "x" }` lexes to the expected sequence (IDENT, STRING, STRING, LBRACE, IDENT, EQUALS, STRING, RBRACE).
      - String-escape test: `"line1\nline2 \"quoted\""` lexes to a single STRING token with the unescaped value preserved (or kept verbatim, matching the lexer's chosen escape policy).
      - Number / bool / list / map literal test: each shape produces the expected token sequence.
      - Comment-stripping test: `# comment`, `// comment`, and `/* ... */` are stripped from the token stream BUT preserved on the immediately-following `HclBlock` as `precedingComments`.
    - **Parser tests** (one test class, ~3-4 methods):
      - One test per top-level construct (`resource`, `module`, `variable`, `output`, `locals`, `provider`) producing the expected `HclBlock` shape with correct `startLine` / `endLine`.
      - Reference-extraction test: `bucket = google_storage_bucket.assets.name` parses to a `HclValue` with `rawExpression = "google_storage_bucket.assets.name"` AND extracted reference parts (resource type, name, attr).
      - Var / local / module ref test: `region = var.region` and `host = local.db_host` and `name = module.network.vpc_id` each parse to `HclValue`s with kind=VAR_REF / LOCAL_REF / MODULE_REF and the referenced symbol preserved.
      - Error-tolerant test: malformed fragment (`resource "x" "y" { invalid <<= }`) produces a `HclParser` warning of shape `"unparseable block at <file>:<line>"` AND parsing continues to the next block. Parser MUST NOT throw out of the importer.
      - Unsupported-expression test: `count = length(var.subnets)` → preserved verbatim on the `HclValue.rawExpression` AND a soft-warn TODO is recorded on the `HclBlock`.
    - Bundle into 2 test files (`HclLexerTest.java`, `HclParserTest.java`); 4-8 tests total across both.
    - **Files:**
      - `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/hcl/HclLexerTest.java`
      - `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/hcl/HclParserTest.java`
  - [x] 2.2 Create the HCL value types
    - `HclValue` class with `kind` enum (`STRING`, `NUMBER`, `BOOL`, `LIST`, `MAP`, `VAR_REF`, `LOCAL_REF`, `MODULE_REF`, `RESOURCE_REF`, `UNSUPPORTED_EXPRESSION`), `Object literalValue` (populated for literal kinds), `String rawExpression` (always populated; verbatim source text), `String referenceTarget` (populated for ref kinds: e.g. `var.region` → `"region"`), `List<HclValue> listElements`, `Map<String, HclValue> mapEntries`.
    - `HclAttribute` record: `String name`, `HclValue value`, `int line`.
    - `HclBlock` class: `String blockType` (`resource` / `module` / `variable` / `output` / `locals` / `provider`), `List<String> labels` (e.g. `["google_compute_network", "vpc"]` for `resource "google_compute_network" "vpc"`), `Map<String, HclAttribute> attributes`, `List<HclBlock> nestedBlocks`, `int startLine`, `int endLine`, `String precedingComments`, `List<String> warnings`.
    - **Files:**
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclValue.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclAttribute.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclBlock.java`
  - [x] 2.3 Implement `HclLexer`
    - Single-pass character-by-character tokenizer producing a `List<Token>` (or equivalent stream).
    - Token kinds: IDENT, STRING (with escape handling: `\n`, `\t`, `\"`, `\\`), NUMBER (integer + decimal + scientific), BOOL (`true` / `false`), LBRACE, RBRACE, LBRACKET, RBRACKET, EQUALS, COMMA, COLON (for object kv), DOT (for refs), QUESTION + COLON (for ternaries — preserved as raw expression), DOLLAR_LBRACE (for `${...}` template start — preserved as raw expression).
    - Comment handling: `#` and `//` consume until end-of-line; `/* */` consume across newlines. Comments are stripped from the token stream but accumulated into a per-line buffer that the parser attaches to the next block as `precedingComments`.
    - Line tracking: every emitted token carries its source line number (1-indexed).
    - Quoted strings with `${...}` interpolation (e.g. `"projects/${var.project_id}/regions/europe-west1"`) are kept as a single STRING token with `containsInterpolation = true`; the parser treats them as `HclValue.kind = UNSUPPORTED_EXPRESSION` with `rawExpression` = the original verbatim string and emits a soft-warn TODO.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclLexer.java`
  - [x] 2.4 Implement `HclParser`
    - Recursive-descent parser consuming the lexer's token stream.
    - Top-level loop dispatches on the leading IDENT: `resource` / `module` / `variable` / `output` / `locals` / `provider`. Anything else → consume as best-effort UNSUPPORTED block + emit warning `"unsupported top-level construct at <file>:<line>"`.
    - Block parser: consumes labels (zero or more STRINGs depending on block kind), opens LBRACE, consumes attributes (`IDENT EQUALS <value>`) and nested blocks (`IDENT LBRACE ... RBRACE`), closes RBRACE. Records `startLine` / `endLine` from the matching LBRACE / RBRACE token line numbers.
    - Value parser: recognises STRING / NUMBER / BOOL / LIST (`[ ... ]`) / MAP-OR-OBJECT (`{ k = v, ... }`) / reference expression (chained `.`-separated IDENTs). Anything else (function calls `<ident>(...)`, ternaries, `${...}` templates with logic, `for` / `for_each` / `count` blocks) → consume tokens to the matching boundary, build `HclValue` with `kind = UNSUPPORTED_EXPRESSION` and `rawExpression` set to the verbatim source slice, AND record a soft-warn TODO on the parent block.
    - Reference detection: a chain of IDENT-DOT-IDENT(...) starting with `var` → `VAR_REF`; `local` → `LOCAL_REF`; `module` → `MODULE_REF`; otherwise → `RESOURCE_REF` (parts: resource type, name, attribute path).
    - Comment attachment: the parser maintains a "pending comments" buffer that the lexer feeds; on opening a new block, the buffer is moved to the block's `precedingComments` and cleared.
    - Error tolerance: on a parse error inside a block, consume tokens until the matching RBRACE, record a `"unparseable block at <file>:<line>"` warning on the block, and continue parsing. Parser never throws out of the importer.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclParser.java`
  - [x] 2.5 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 2.1 (4-8 lexer + parser tests).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 4-8 tests written in 2.1 pass.
- Lexer recognises all required token kinds, strips comments while preserving them on the next block, and tracks line numbers per token.
- Parser dispatches on `resource` / `module` / `variable` / `output` / `locals` / `provider` and produces `HclBlock`s with correct labels, attributes, nested blocks, line ranges, and preceding comments.
- Reference extraction works for `var.x`, `local.x`, `module.x.attr`, and `<resource_type>.<name>.<attr>`.
- Unsupported expressions (functions, templated strings with `${...}`, ternaries, `for` / `for_each` / `count`) preserved verbatim on `HclValue.rawExpression` and surface as soft-warn TODO on the parent block.
- Parser is error-tolerant: malformed fragments produce a warning and parsing continues — parser never throws out of the importer.
- Zero new Maven dependency added.

---

### Backend — GCP Importer (Mappings + Classifier)

#### Task Group 3: GcpTerraformImporter — GCP Reverse-Mapping Classifier + Composite-LB Detection
**Dependencies:** Task Group 2

- [x] 3.0 Create `GcpTerraformImporter` and implement the per-resource-family classifier methods that invert the locked `GcpTerraformExporter` mapping table
  - [x] 3.1 Write 8-10 focused tests for the per-resource-type classifier methods (one test per resource family)
    - Test: `google_compute_network` → `Network` candidate with name / description / routing-mode preserved.
    - Test: `google_compute_subnetwork` → `Subnet` candidate with `ip_cidr_range` / region / parent-network reference preserved.
    - Test: `google_container_cluster` → `ComputeCluster` (KUBERNETES) candidate; node-pool blocks captured as evidence comments only (NOT first-class candidates).
    - Test: `google_compute_instance` → `ComputeResource` (VM) candidate with machine type / region/zone / image hint preserved.
    - Test: `google_cloud_run_v2_service` → `ComputeResource` (CLOUD_RUN_SERVICE) candidate PLUS implicit `ComputeCluster` (CLOUD_RUN) candidate when one is not already present in the candidate set; container `image` field → `DeploymentUnit` candidate linked to the parent CR via "Deployment Unit runs on Compute" relationship.
    - Test: `google_cloudfunctions2_function` → `ComputeResource` (FUNCTION) + implicit `ComputeCluster` (CLOUD_FUNCTIONS) when not already present; function `source` → `DeploymentUnit` candidate.
    - Test: `google_sql_database_instance` → `DataStoreInstance` (relational) candidate; `google_sql_database` → child `DataStoreInstance` (database-level) with `parentInstanceRef` preserved as evidence.
    - Test: `google_redis_instance` → `DataStoreInstance` (cache, REDIS engine) — exactly mirrors the export's choice for round-trip parity.
    - Test: `google_storage_bucket` → `InfrastructureResource` (`OBJECT_BUCKET`); `google_pubsub_topic` → `InfrastructureResource` (`MESSAGE_TOPIC`); `google_pubsub_subscription` → `InfrastructureResource` (`MESSAGE_QUEUE`) with parent-topic reference preserved; `google_secret_manager_secret` → `InfrastructureResource` (`SECRET_STORE`) AND secret values are NEVER imported even if literally present; `google_cloud_scheduler_job` → `InfrastructureResource` (`SCHEDULER`); `google_artifact_registry_repository` → `InfrastructureResource` with the same `provider_resource_type` choice the export uses (must match exactly for round-trip).
    - Test: BigQuery / AlloyDB resource types → `DataStoreInstance` candidates at LOW confidence with TODO warning.
    - Test: composite LB happy path — 5 resources (`google_compute_global_forwarding_rule` + `google_compute_target_https_proxy` + `google_compute_url_map` + `google_compute_backend_service` + `google_compute_region_network_endpoint_group`) → ONE `LoadBalancer` + ONE `Listener` candidate; URL-map host/path rules drive listener routes; forwarding-rule port + target-proxy protocol drive listener port/protocol.
    - Test: composite LB fallback — given only `google_compute_backend_service` + `google_compute_url_map` (missing forwarding rule + target proxy) → emits per-component candidates each with TODO warning + one top-level `"unrecognised LB pattern"` warning on the result.
    - Test: any other `google_*` resource (e.g. `google_compute_firewall`) → emitted as `Unsupported` candidate with full HCL preserved as evidence + per-candidate warning.
    - Test: `provider.region` / `provider.zone` / per-resource region/location fields → `Location / Site / Region` candidate (inferred), SKIPPED when the user supplied `locationId` in the form.
    - Test: `google_project` block / `provider.project` / `var.project_id` → `CloudAccount / Project / Tenant` candidate (inferred), SKIPPED when the user supplied `cloudAccountId` in the form.
    - Bundle into 8-10 grouped methods (some tests cover multiple sibling resource types as the table notes).
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/GcpTerraformImporterTest.java`
  - [x] 3.2 Create `GcpTerraformImporter` class scaffolding
    - Annotated `@Component`, implements `TerraformImporter`, `providerId()` returns `"GCP"`.
    - `importResources(TerraformImportContext ctx)` orchestrates: walk every `HclBlock` of `blockType == "resource"` across all parsed files; dispatch on the resource type label to the corresponding `classifyXxx(...)` method; collect emitted candidates; run composite-LB grouping pass; return the full list.
    - Inject no repositories — the class is pure: it consumes `TerraformImportContext` only and is fed lookup data via the context's pre-built maps.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/GcpTerraformImporter.java`
  - [x] 3.3 Implement networking classifiers
    - `classifyComputeNetwork(HclBlock, ctx)` → `Network` candidate; preserves `name` / `description` / `routing_mode`; resource-naming uses `iac_address` derived from `resource <type> "<name>"` form (`google_compute_network.vpc` → `iac_address = "google_compute_network.vpc"`); confidence HIGH if no unresolved refs, MEDIUM otherwise.
    - `classifyComputeSubnetwork(HclBlock, ctx)` → `Subnet / NetworkSegment` candidate; preserves `ip_cidr_range`, `region`, parent `network` reference; relationship-inference candidate "Resource hosted in Subnet" emitted later in Group 4 from these references.
  - [x] 3.4 Implement compute classifiers
    - `classifyContainerCluster(HclBlock, ctx)` → `ComputeCluster` (KUBERNETES); node-pool inline blocks captured as `# Node pool: <name>` comment on the candidate's evidence.
    - `classifyComputeInstance(HclBlock, ctx)` → `ComputeResource` (VM); preserves `machine_type`, `zone` / `region`, image hint via `boot_disk.initialize_params.image`.
    - `classifyCloudRunV2Service(HclBlock, ctx)` → `ComputeResource` (CLOUD_RUN_SERVICE) PLUS implicit `ComputeCluster` (CLOUD_RUN) when not already present in the candidate set being assembled. Container `image` field → `DeploymentUnit` candidate linked via "Deployment Unit runs on Compute".
    - `classifyCloudFunctions2Function(HclBlock, ctx)` → `ComputeResource` (FUNCTION) PLUS implicit `ComputeCluster` (CLOUD_FUNCTIONS) when not already present. Function `source` → `DeploymentUnit` candidate.
  - [x] 3.5 Implement load balancer classifiers + composite-LB grouping pass
    - Per-component classifiers `classifyForwardingRule` / `classifyBackendService` / `classifyUrlMap` / `classifyTargetHttpProxy` / `classifyTargetHttpsProxy` / `classifyRegionNetworkEndpointGroup` initially produce per-component `Unsupported`-style candidates with full HCL preserved.
    - Post-pass `groupLbComposites(List<ImportedCandidate>, ctx)`:
      - Walk the candidate set looking for the closure of `forwarding_rule` → `target_proxy` → `url_map` → `backend_service` (+ optional NEG) refs.
      - On success: replace the 5 per-component candidates with ONE `LoadBalancer` + ONE `Listener` candidate; URL-map host/path rules drive Listener route fields; forwarding-rule port + target-proxy protocol drive listener port/protocol; the 5 underlying bindings remain attached to the LoadBalancer entity (preserving every `iac_address`).
      - On partial: leave the per-component candidates in place, attach a TODO warning to each ("this looks like part of a composite LB; consider creating a parent LoadBalancer entity manually"), and emit one top-level `"unrecognised LB pattern at <closure-summary>"` warning on the result.
  - [x] 3.6 Implement data-store classifiers
    - `classifySqlDatabaseInstance` → `DataStoreInstance` (relational); preserves engine + version + region.
    - `classifySqlDatabase` → child `DataStoreInstance` (database-level) with `parentInstanceRef` preserved as evidence — match the export's choice exactly.
    - `classifyRedisInstance` → `DataStoreInstance` (cache, REDIS engine) — exactly mirrors export.
    - `classifyBigQuery*` / `classifyAlloyDb*` → `DataStoreInstance` candidates at LOW confidence + TODO warning.
  - [x] 3.7 Implement infrastructure-resource classifiers
    - `classifyStorageBucket` → `InfrastructureResource` (`OBJECT_BUCKET`).
    - `classifyPubsubTopic` → `InfrastructureResource` (`MESSAGE_TOPIC`).
    - `classifyPubsubSubscription` → `InfrastructureResource` (`MESSAGE_QUEUE`); parent-topic reference preserved as evidence.
    - `classifySecretManagerSecret` → `InfrastructureResource` (`SECRET_STORE`); **never** import secret values even if present (filtered out at field-extraction time).
    - `classifyCloudSchedulerJob` → `InfrastructureResource` (`SCHEDULER`).
    - `classifyArtifactRegistryRepository` → `InfrastructureResource` with the same `provider_resource_type` choice the export uses (cross-check the export's existing constant for round-trip parity).
  - [x] 3.8 Implement context-inference classifiers
    - `classifyProviderBlock` → emits `CloudAccount` candidate from `project = ...` / `var.project_id`, SKIPPED when `ctx.cloudAccountId` is supplied. Emits `Location` candidate from `region = ...` / `zone = ...`, SKIPPED when `ctx.locationId` is supplied. Always SKIPS `Environment` inference in V1 (the controller requires `environmentId` form param, so the user-supplied environment always wins).
    - `classifyGoogleProjectResource` → emits `CloudAccount` candidate, SKIPPED when `ctx.cloudAccountId` is supplied.
  - [x] 3.9 Implement unsupported-fallback classifier
    - `classifyUnsupportedResource(HclBlock, ctx)` → emits `Unsupported` candidate with `targetEntityType = "Unsupported"`, `confidence = LOW (0.300)`, full HCL preserved on the evidence block, per-candidate warning `"unsupported resource type: <type>; preserved as TODO"`.
  - [x] 3.10 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 3.1 (8-10 tests in `GcpTerraformImporterTest.java`).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 8-10 tests written in 3.1 pass.
- `GcpTerraformImporter.providerId()` returns `"GCP"`.
- Every entry in the locked GCP reverse-mapping table from `spec.md` produces the documented Infrastructure entity candidate AND inverts `GcpTerraformExporter` exactly (resource-type strings, composite-LB shape, `google_redis_instance` → cache `DataStoreInstance` choice, `google_artifact_registry_repository` → `provider_resource_type` choice all match).
- Composite-LB success path emits ONE `LoadBalancer` + ONE `Listener` for the canonical 5-resource closure; partial path emits per-component candidates + per-candidate TODO + top-level `"unrecognised LB pattern"` warning.
- `SECRET_STORE` candidates NEVER include secret values even when literally present in the HCL.
- `CloudAccount` / `Location` inference is SKIPPED when the user supplied `cloudAccountId` / `locationId` in the form.
- Unsupported `google_*` resource types produce LOW-confidence `Unsupported` candidates with full HCL preserved as evidence; importer never throws on unknown resource types.
- `iac_address` recorded byte-equal to the parsed `<resource_type>.<resource_name>` form.

---

### Backend — Resolution + Matching + Relationship Inference

#### Task Group 4: One-hop Resolution + Deterministic Matching + Relationship Inference
**Dependencies:** Task Group 3

- [x] 4.0 Implement variable / locals / module-file resolution, deterministic candidate matching, and Terraform-evidence-based relationship inference
  - [x] 4.1 Write 4-8 focused tests covering resolution, matching, and relationship inference
    - **Resolution tests** (3-4):
      - `var.region` resolved priority 1: user-supplied form option (`ctx.locationId` text mapping) wins.
      - `var.region` resolved priority 2: `variable "region" { default = "europe-west1" }` literal wins when no form option.
      - `var.region` unresolved: no form option, no default → preserved verbatim on `rawExpression` AND TODO warning on candidate; confidence drops to MEDIUM.
      - `local.db_host` resolved from `locals { db_host = "10.0.0.5" }` literal; non-literal locals (e.g. `local.db_host = "${var.x}"`) preserved verbatim + TODO warning.
      - Module-body parsing: `module "network" { source = "./modules/network" }` parses files at `./modules/network/*.tf` when present in the upload, lands resources as candidates with `file_path = "modules/network/main.tf"` and a `# Module call: network` evidence comment.
      - Remote module: `source = "git::..."` or `source = "registry.terraform.io/..."` → soft-warn TODO `"remote module not fetched: <source>"`; importer NEVER attempts a network fetch (assert via no `URL`/`HttpClient` usage in the resolver).
    - **Matching tests** (1-2):
      - Match by exact `iac_address` against existing `IaCResourceBinding` rows scoped by `projectId` + `architectureId` → produces `willUpdate` candidate.
      - On match, user-edited `name` + `description` win (proposed update keeps existing model values for these); imported wins for technical fields (CIDR, region, engine, type, `provider_resource_type`, machine type, version, etc.). Diverging fields surfaced on the candidate's `proposedEntityFields` map AND as a side-by-side diff list (left = current, right = imported) — V1 UI presents read-only.
      - No match → produces `willCreate` candidate.
    - **Relationship-inference tests** (1-2):
      - "Resource hosted in Subnet" inferred from `subnet_id` / `network` / `private_network` / `network_interface` reference on a compute or data-store resource pointing at a parsed `google_compute_subnetwork` / `google_compute_network` candidate.
      - "Deployment Unit runs on Compute" inferred from `image` / `artifact` / function `source` / VM image fields on the parent `ComputeResource` candidate.
      - "Load Balancer routes to Compute / Resource" inferred from `backend_service` / NEG / URL-map / `target_pool` references when the composite-LB success path fired. Partial / per-component fallback emits NO relationships, only warnings.
    - Bundle into 4-8 grouped methods.
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/GcpImporterResolutionMatchingTest.java`
  - [x] 4.2 Implement `VariableResolver`
    - Signature: `Optional<String> resolveVarRef(String varName, TerraformImportContext ctx)`.
    - Priority order: (1) user-supplied import option matching `varName` (e.g. `var.region` matches `ctx.locationName` when locked); (2) `variable "<varName>" { default = ... }` literal from any parsed HCL file; (3) Optional.empty() → caller emits TODO warning.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/VariableResolver.java`
  - [x] 4.3 Implement `LocalsResolver`
    - Signature: `Optional<String> resolveLocalRef(String localName, TerraformImportContext ctx)`.
    - Walks every `locals { ... }` block in every parsed HCL file. Returns the literal value if it's a STRING / NUMBER / BOOL `HclValue` directly; returns Optional.empty() (with caller emitting TODO warning) for any non-literal value.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/LocalsResolver.java`
  - [x] 4.4 Implement `ModuleResolver`
    - Signature: `List<HclBlock> resolveLocalModule(HclBlock moduleBlock, TerraformImportContext ctx)`.
    - Reads `source = "./..."` from the module block. If the referenced relative path resolves to one or more `.tf` files present in the parsed upload, returns their parsed resource blocks. Each returned block has `file_path` set to the path relative to the ZIP root (e.g. `modules/network/main.tf`) AND a `# Module call: <module-name>` line prepended to `precedingComments`.
    - Remote module sources (`git::`, `registry.terraform.io/...`, `<owner>/<name>/<provider>`) → emit TODO warning `"remote module not fetched: <source>"`; return empty list. NEVER attempt a network fetch.
    - Parameter substitution into module variables is NOT performed in V1 — variables inside the module body resolve via `VariableResolver` against the module's own file scope, not the caller's args.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/ModuleResolver.java`
  - [x] 4.5 Implement `CandidateMatcher`
    - Signature: `MatchResult match(ImportedCandidate candidate, TerraformImportContext ctx)`.
    - Match key: `proposedBinding.iac_address`. Looks up in `ctx.existingBindingsByAddress` (the pre-built map keyed by `iac_address`, scoped by `projectId` + `architectureId`).
    - On match: returns `MatchResult.WILL_UPDATE` carrying the existing `IaCResourceBinding` + the existing `Infrastructure*` entity. The caller (orchestrator) applies the field-precedence rule when assembling the `willUpdate` payload: existing model wins for `name` + `description`; imported wins for technical fields (whitelist enumerated in the matcher: `cidr`, `region`, `zone`, `engine`, `version`, `provider_resource_type`, `machine_type`, `type`, `ip_cidr_range`, `routing_mode`, plus other obvious technical fields).
    - The candidate review payload surfaces ALL diverging fields (left = current, right = imported) for V1 read-only UI display — this is independent of the precedence rule.
    - On no match: returns `MatchResult.WILL_CREATE`.
    - `iac_address` MUST be persisted EXACTLY as parsed (round-trip stability with the export contract — the matcher does NOT canonicalise it).
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/CandidateMatcher.java`
  - [x] 4.6 Implement `RelationshipInferrer`
    - Signature: `List<InferredRelationship> infer(List<ImportedCandidate> candidates, TerraformImportContext ctx)`.
    - "Resource hosted in Subnet" — walk every Compute / Data-Store candidate; if its source HCL has a `subnet_id` / `network` / `private_network` / `network_interface` / `vpc_connector` reference resolving to a parsed `google_compute_subnetwork` / `google_compute_network` candidate, emit a relationship.
    - "Deployment Unit runs on Compute" — walk every `ComputeResource` candidate; if its source HCL has `image` / `artifact` / function `source` / VM image fields, emit a relationship to the corresponding `DeploymentUnit` candidate.
    - "Load Balancer routes to Compute / Resource" — walk every `LoadBalancer` candidate (composite-success case only); follow the closure to the resolved `backend_service` / NEG → emit a relationship to the corresponding `ComputeResource` / `InfrastructureResource` candidate. Composite-fallback case emits NO relationships — only warnings.
    - Each `InferredRelationship` carries source candidate id, target candidate id, relationship type label, and the source HCL snippet as evidence.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/RelationshipInferrer.java`
  - [x] 4.7 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 4.1 (4-8 tests).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 4-8 tests written in 4.1 pass.
- `VariableResolver` follows the locked priority order (user form option → variable default → Optional.empty + TODO).
- `LocalsResolver` resolves only literal `locals` values; non-literals → Optional.empty + TODO.
- `ModuleResolver` parses local module files when present in the upload; remote module sources → soft-warn TODO; importer NEVER attempts a network fetch.
- `CandidateMatcher` matches by exact `iac_address` against existing `IaCResourceBinding` rows scoped by `projectId` + `architectureId`; field-precedence rule applies (user-edited name+description wins, imported wins for technical fields); diverging fields surfaced on the candidate.
- `RelationshipInferrer` emits the 3 documented relationships only when direct Terraform evidence exists; composite-LB fallback emits NO relationships.
- All resolution, matching, and inference are deterministic and pure — no LLM calls, no external I/O, no network access.

---

### Backend — Service Orchestrator + Controller

#### Task Group 5: TerraformImportService + InfrastructureTerraformImportController
**Dependencies:** Task Group 4

- [x] 5.0 Build the orchestration layer that consumes uploaded files, drives parse + classify + resolve + match + infer, and exposes the HTTP endpoint
  - [x] 5.1 Write 4-8 focused tests for the service + controller
    - **Service tests** (2-4):
      - `TerraformImportService.importTerraform(...)` happy path: given a small `.tf` content + selected env/provider, returns an `ImportReviewResult` with non-empty `willCreate` + zero `unsupported` + zero top-level warnings.
      - Service hard-fail: `provider == "AWS"` → throws `IllegalArgumentException` (V1: only GCP registered).
      - Service hard-fail: `environmentId == null` → throws `IllegalArgumentException`.
      - ZIP handling: given a multipart upload containing a single ZIP, the service extracts every `.tf` file under the ZIP root, parses them all, and `IaCResourceBinding.file_path` on each candidate matches the relative path inside the ZIP (e.g. `modules/network/main.tf`).
    - **Controller tests** (2-4) — MockMvc:
      - Happy path: `POST` `multipart/form-data` with one `.tf` file part + form fields → `200 OK`, `Content-Type: application/json`, body parses as `ImportReviewResult`.
      - `400 Bad Request` when `environmentId` form field missing.
      - `400 Bad Request` when `provider == "AWS"` (V1: only GCP registered).
      - `400 Bad Request` when no file part is provided.
      - `400 Bad Request` when uploaded ZIP exceeds configured max size.
    - Bundle into 4-8 grouped methods across two files.
    - **Files:**
      - `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImportServiceTest.java`
      - `architecture-model-service/src/test/java/com/example/architecturemodel/controller/InfrastructureTerraformImportControllerTest.java`
  - [x] 5.2 Create `TerraformImportService` orchestrator
    - Annotated `@Service`. Constructor-injected:
      - `ModelService modelService` (for `loadModelByProjectAndArchitecture`).
      - `Map<String, TerraformImporter> importers` (Spring auto-wires by `providerId()`).
      - `HclParser` (or `HclLexer + HclParser` factory).
      - `VariableResolver`, `LocalsResolver`, `ModuleResolver`, `CandidateMatcher`, `RelationshipInferrer`.
    - Method signature: `ImportReviewResult importTerraform(UUID projectId, UUID architectureId, ImportRequest request)` where `ImportRequest` carries the multipart files (as `List<UploadedFile>` with raw bytes + filename) + form fields.
    - Orchestration steps:
      1. **Hard-fail boundary checks (BEFORE parse):**
         - `request.environmentId == null` → throw `IllegalArgumentException` (mapped to 4xx by controller).
         - `request.providerId == null || !iacSourceProviderOptionsBackendMirror.contains(request.providerId)` → throw `IllegalArgumentException`.
         - `!importers.containsKey(request.providerId)` → throw `IllegalArgumentException` ("provider not registered: <id>"). V1: only `GCP` registered.
         - `request.files == null || request.files.isEmpty()` → throw `IllegalArgumentException`.
         - ZIP > max size OR any file > max size → throw `IllegalArgumentException`. (Configured via `application.properties`; reasonable defaults — e.g. 5 MB / file, 50 MB ZIP.)
      2. **Unzip / collect:** if exactly one ZIP is uploaded, extract all `.tf` files under the ZIP root using `java.util.zip.{ZipInputStream, ZipEntry}` (no Apache Commons Compress); preserve the relative path inside the ZIP for each entry's `filePath`. Otherwise treat the multipart files as the upload set with filename only as `filePath`.
      3. **Parse:** invoke `HclParser` on each file's content. Collect `List<ParsedHclFile>` carrying file path + blocks + per-file warnings.
      4. **Build context:** load the existing model via `modelService.loadModelByProjectAndArchitecture(projectId, architectureId)`, build `ctx.existingBindingsByAddress` from the existing `IaCResourceBinding` rows, attach the parsed files + form fields.
      5. **Classify:** invoke `importers.get(request.providerId).importResources(ctx)` → produces the candidate list.
      6. **Resolve + match + infer:** the resolvers / matcher / inferrer are invoked by the importer internally as part of step 5. The orchestrator does NOT re-invoke them.
      7. **Bucketize:** split the returned candidate list into `willCreate` / `willUpdate` / `unsupported` based on `MatchResult` + `targetEntityType`.
      8. **Build IaCSource proposal:** one per import, populated from the form fields (`repositoryUrl`, `branch`, `commitSha`, `path`, `workspace`, `provider`).
      9. **Build summary:** counts per category + total warnings count.
      10. Return `ImportReviewResult`. **NO model mutation.**
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/TerraformImportService.java`
  - [x] 5.3 Create `InfrastructureTerraformImportController`
    - Annotated `@RestController`, `@RequestMapping("/api/model")`.
    - Constructor-injected `TerraformImportService`.
    - Single endpoint:
      ```java
      @PostMapping(
          value = "/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform",
          consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
          produces = MediaType.APPLICATION_JSON_VALUE)
      public ResponseEntity<ImportReviewResult> importTerraform(
          @PathVariable UUID projectId,
          @PathVariable UUID architectureId,
          @RequestParam("files") List<MultipartFile> files,
          @RequestParam("environmentId") UUID environmentId,
          @RequestParam(value = "cloudAccountId", required = false) UUID cloudAccountId,
          @RequestParam(value = "locationId", required = false) UUID locationId,
          @RequestParam("provider") String provider,
          @RequestParam(value = "repositoryUrl", required = false) String repositoryUrl,
          @RequestParam(value = "branch", required = false) String branch,
          @RequestParam(value = "commitSha", required = false) String commitSha,
          @RequestParam(value = "path", required = false) String path,
          @RequestParam(value = "workspace", required = false) String workspace)
      ```
    - Body: assemble `ImportRequest`; call `terraformImportService.importTerraform(...)`. Return `ResponseEntity.ok(result)`.
    - Catch `IllegalArgumentException` from the service hard-fails → `ResponseEntity.badRequest().build()` (or matching repo convention via `@ControllerAdvice`).
    - **NOT folded into `ModelController.java`.** This is a new top-level controller.
    - Approval is NOT a new endpoint in this spec — the frontend posts approved candidates back through the existing model-save flow on `PUT /api/model/projects/{p}/architectures/{a}` with the importer-supplied entity payload merged into the model. "Discard all" is a pure client-side state clear; nothing is persisted server-side mid-review.
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformImportController.java`
    - **Reference:** `InfrastructureTerraformExportController.java` for verbatim project/architecture path scoping + slug helper + `iacSourceProviderOptions` provider validation.
  - [x] 5.4 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 5.1 (4-8 tests across two files).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 4-8 tests written in 5.1 pass.
- `TerraformImportService` orchestrates parse → classify → match → bucketize → return without mutating the model.
- Service hard-fails BEFORE parse when: `environmentId` missing, provider missing or not in `iacSourceProviderOptions`, provider not registered (V1: only GCP), no file parts, ZIP / individual file > max size.
- `InfrastructureTerraformImportController` exposes `POST /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform` accepting `multipart/form-data` and returning `application/json` with the `ImportReviewResult` payload.
- ZIP handling preserves relative file paths in `IaCResourceBinding.file_path`.
- `ModelController.java`, `InfrastructureTerraformExportController.java`, `TerraformExportService.java`, `GcpTerraformExporter.java` are **NOT** modified.
- ZIP read uses only `java.util.zip.{ZipInputStream, ZipEntry}`; no new Maven dependency.

---

### Backend — Forward Fixture + Round-Trip Golden

#### Task Group 6: TerraformImportForwardFixtureTest + TerraformImportRoundTripTest
**Dependencies:** Task Group 5

- [x] 6.0 Pin the importer's output via two snapshot tests: a forward-only fixture covering edge cases the export wouldn't produce, and a round-trip fixture consuming the export spec's golden files
  - [x] 6.1 Write 2 focused snapshot tests
    - **`TerraformImportForwardFixtureTest`** (1 test): given the hand-rolled `architecture-model-service/src/test/resources/terraform-import/input.tf` + supporting files, run the full importer pipeline and assert the produced `ImportReviewResult` JSON is byte-equal to the committed `expected-candidates.json`.
    - **`TerraformImportRoundTripTest`** (1 test): given the export spec's golden HCL files (`architecture-model-service/src/test/resources/terraform-export/expected/main.tf` + `variables.tf` + `outputs.tf`), run the full importer pipeline and assert the resulting candidate set entity-for-entity matches the export's seed model: same entity names, same technical fields, same `iac_address` values byte-equal to what the export emitted.
    - Bundle as 2 separate test files (one snapshot per direction).
    - **Files:**
      - `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImportForwardFixtureTest.java`
      - `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImportRoundTripTest.java`
  - [x] 6.2 Build the forward-only fixture under `src/test/resources/terraform-import/`
    - Create directory: `architecture-model-service/src/test/resources/terraform-import/`.
    - Hand-rolled `input.tf` exercising every supported GCP resource family from the locked reverse-mapping table PLUS edge cases the export wouldn't naturally produce:
      - Comment preservation (`#`, `//`, `/* */` styles).
      - Unresolved `var.x` reference with no default (TODO warning expected).
      - At least one literal-only `locals { ... }` block resolved successfully.
      - One unsupported `google_*` resource type (e.g. `google_compute_firewall`) → `Unsupported` candidate with full HCL preserved.
      - Partial LB pieces (e.g. only `google_compute_backend_service` + `google_compute_url_map`, missing forwarding-rule + target-proxy) → composite-fallback path with per-component candidates + top-level warning.
      - One local module reference (`module "network" { source = "./modules/network" }`) with the target file present at `architecture-model-service/src/test/resources/terraform-import/modules/network/main.tf` — module-body resources land as candidates with `file_path = "modules/network/main.tf"`.
      - One `var.region` overridden by a user form option (simulated via the test's invocation params).
      - An expression involving `${var.x}` template interpolation (preserved verbatim + TODO warning).
    - Committed expected payload: `architecture-model-service/src/test/resources/terraform-import/expected-candidates.json`. First test run will produce mismatched output; capture, manually review for correctness against the spec's reverse-mapping table + warning rules + confidence buckets, then commit as the golden. Subsequent runs assert byte-equal.
  - [x] 6.3 Implement `TerraformImportForwardFixtureTest`
    - Loads the input `.tf` files via classpath.
    - Calls `TerraformImportService.importTerraform(...)` with fixed input form fields (e.g. `environmentId = <fixed UUID>`, `provider = "GCP"`, `locationId = <fixed UUID>` to exercise user-form-option resolution).
    - Mocks `ModelService.loadModelByProjectAndArchitecture` to return an empty existing model (so all candidates are `willCreate`).
    - Serialises the returned `ImportReviewResult` to JSON via Jackson with snake_case naming + stable ordering (sort lists by `iac_address` before serialisation to keep diff stable).
    - Asserts byte-equal against `expected-candidates.json`.
  - [x] 6.4 Implement `TerraformImportRoundTripTest`
    - Loads `architecture-model-service/src/test/resources/terraform-export/expected/main.tf` + `variables.tf` + `outputs.tf` via classpath.
    - Calls `TerraformImportService.importTerraform(...)` with the same fixture input form fields the export's `TerraformExportGoldenFileTest` used (env, cloud_account, location IDs all matching the export's seed model so user-supplied form values match the seed).
    - Mocks `ModelService.loadModelByProjectAndArchitecture` to return an empty existing model (so all candidates are `willCreate` — clean round-trip with no field-precedence collisions).
    - Asserts entity-for-entity:
      - Same entity names as the export's seed model (`prod_app_vpc`, `prod_app_subnet`, `prod_app_gke`, `prod_app_run`, `prod_app_db`, `prod_app_assets`, `prod_app_lb`, etc.).
      - Same technical fields (CIDR, region, engine, type, `provider_resource_type`, machine type, version) on each candidate.
      - `iac_address` values byte-equal to what the export emitted (e.g. `google_compute_network.prod_app_vpc`).
      - Composite-LB symmetry: 5 GCP resources from export → ONE `LoadBalancer` + ONE `Listener` candidate from import.
    - **NB:** any change to the export's golden files MUST update this test in lockstep — surfaced as a CI failure linking the two specs.
  - [x] 6.5 Verify Java compiles + targeted tests pass
    - Apply broken-tests staging workaround.
    - Run `mvn -pl architecture-model-service compile`.
    - Run ONLY the tests from 6.1 (the 2 snapshot tests).
    - Restore broken tests.
    - Do NOT run the entire backend test suite.

**Acceptance Criteria:**
- The 2 tests written in 6.1 pass.
- `TerraformImportForwardFixtureTest` asserts byte-equal `ImportReviewResult` JSON against the committed `expected-candidates.json` for the hand-rolled fixture covering edge cases.
- `TerraformImportRoundTripTest` asserts entity-for-entity match against the export's seed model when fed the export's golden HCL — pinning round-trip parity (`iac_address` symmetry + entity-name symmetry + technical-field symmetry + composite-LB symmetry + provenance round-trip).
- Forward fixture covers: comments, unresolved variables, unsupported resource type, partial LB pieces, a literal-only `locals` block, a local module reference, a user-form-option `var.x` override, a template-interpolation expression.
- Round-trip uses the export spec's golden files (NOT a separately maintained import fixture) so the two specs stay locked in sync.
- Existing export-spec test resources under `architecture-model-service/src/test/resources/terraform-export/` are **NOT** modified.

---

### Frontend — API + Modal + Menu + TopBar

#### Task Group 7: Frontend Modal (Two-Step Upload + Review), Menu Entry, TopBar Wiring, API Helper, and Tests
**Dependencies:** Task Group 6

- [x] 7.0 Wire the import feature into the frontend: API helper, two-step modal (upload form → read-only review table), FileMenu entry, TopBar state wiring, and 2 frontend tests
  - [x] 7.1 Write 8-10 focused tests
    - **`InfrastructureTerraformImportModal.test.tsx`** (modal-render smoke + 2-step flow + approve/discard, ~6-7 tests):
      - Test: step 1 renders file picker (accepts `.tf` multi-select OR a single `.zip`), Environment (required dropdown), Cloud Account (optional dropdown), Location (optional dropdown), Provider (required dropdown with `GCP` enabled and `AWS` / `AZURE` / `ON_PREM` / `MULTI` / `OTHER` rendered as disabled with "Coming soon" tooltip), and 5 optional IaC Source metadata text inputs (`repositoryUrl`, `branch`, `commitSha`, `path`, `workspace`).
      - Test: "Parse and review" submit button is disabled until at least one file is selected AND Environment + Provider are set.
      - Test: clicking "Parse and review" assembles the `FormData` correctly (one entry per file part + each form field) and invokes `modelApi.importInfrastructureTerraform(...)` with the expected URL + body.
      - Test: post-parse, modal swaps to step 2 (review) showing: a warnings panel at the top listing all top-level `warnings`; three category sections "Will create" / "Will update" / "Unsupported / TODO" each rendering a table with columns (entity type, name, source `file:line`, confidence-bucket badge, warnings count, evidence-snippet expander).
      - Test: collapsible-row expander toggles raw HCL evidence visibility.
      - Test: "Approve all" button posts the candidates through the existing model-save flow (`PUT /api/model/projects/{p}/architectures/{a}`) with the importer-supplied entity payload merged into the current model.
      - Test: "Discard all" button clears modal state and closes the modal — no server call.
      - Test: V1 only `GCP` is enabled in the Provider dropdown; the other 5 entries are rendered disabled with the "Coming soon" tooltip.
    - **`modelApi.importInfrastructureTerraform.test.ts`** (or appended to existing `modelApi.test.ts` per repo convention, ~3-5 tests):
      - Test: `importInfrastructureTerraform(projectId, architectureId, formData)` mocks `fetch` and asserts the request URL matches `/api/model/projects/<projectId>/architectures/<architectureId>/infrastructure/import-terraform`, method is `POST`, body is the supplied `FormData` instance, and `Content-Type` header is NOT manually set (the browser supplies the multipart boundary).
      - Test: successful response (`200 OK` JSON body) parses to the expected `ImportReviewResult` shape.
      - Test: error response (`400 Bad Request` with JSON error body) is propagated to the caller as a thrown error (or rejected Promise) carrying the server error message.
      - Test: scoping params (projectId, architectureId) are correctly URL-encoded into the path.
    - Bundle into 8-10 grouped methods across both files.
    - **Files:**
      - `frontend/src/components/Import/__tests__/InfrastructureTerraformImportModal.test.tsx`
      - `frontend/src/api/__tests__/modelApi.importInfrastructureTerraform.test.ts` (or appended to existing `modelApi.test.ts` per repo convention)
  - [x] 7.2 Append `importInfrastructureTerraform` to `frontend/src/api/modelApi.ts`
    - Signature: `importInfrastructureTerraform(projectId: string, architectureId: string, formData: FormData): Promise<ImportReviewResult>`.
    - `POST` to `/api/model/projects/<projectId>/architectures/<architectureId>/infrastructure/import-terraform` with `body: formData`. Do NOT manually set `Content-Type` — the browser supplies the multipart boundary.
    - Parses the response as JSON, returns the typed `ImportReviewResult`.
    - On non-2xx, throws an error carrying the server's error message (mirror existing `modelApi.ts` error-handling convention).
    - Mirrors `exportInfrastructureTerraform(...)` in placement and shape, but `POST` `multipart/form-data` returning parsed JSON (vs `GET` returning raw `Response`).
    - **File:** `frontend/src/api/modelApi.ts`
  - [x] 7.3 Create `InfrastructureTerraformImportModal.tsx` + `.module.css`
    - Two-step state machine. **Step 1 — upload + form:**
      - File picker `<input type="file" multiple accept=".tf,.zip">` accepting `.tf` files (multiple) OR a single `.zip` (validate at submit time: if any `.zip` is present, only that single ZIP can be selected; otherwise multiple `.tf` files are allowed).
      - Environment (required dropdown of `metaModel.entities.environments`; display `name`, submit value is `id`).
      - Cloud Account (optional dropdown of `metaModel.entities.cloud_accounts`).
      - Location (optional dropdown of `metaModel.entities.locations`).
      - Provider (required dropdown sourced from `iacSourceProviderOptions` imported from `frontend/src/config/defaults.ts` line 1321 — DO NOT redeclare). V1: only `GCP` enabled; other entries (`AWS`, `AZURE`, `ON_PREM`, `MULTI`, `OTHER`) rendered disabled with "Coming soon" tooltip.
      - Optional IaC Source metadata fields: `repositoryUrl`, `branch`, `commitSha`, `path`, `workspace`.
      - Submit button "Parse and review" disabled until at least one file is selected AND Environment + Provider are set.
      - On submit: assemble `FormData` (one `files` entry per file part + each form field as a separate entry); call `modelApi.importInfrastructureTerraform(...)`; on success advance to step 2; on error show inline error banner.
    - **Step 2 — read-only review:**
      - Top: warnings panel listing every top-level `warnings` entry (one row each).
      - Three category sections "Will create" / "Will update" / "Unsupported / TODO" each rendering a table with columns: entity type, name, source `file:line` (concatenated), confidence-bucket badge (HIGH 0.90 / MEDIUM 0.60 / LOW 0.30 — colour-coded), warnings count, evidence expander (collapsible row that reveals the raw HCL snippet from the candidate's `evidence.rawSnippet`).
      - Empty sections render an empty-state message ("No candidates in this category").
      - Footer buttons:
        - "Approve all" → posts the candidates through the existing model-save flow on `PUT /api/model/projects/{p}/architectures/{a}` with the importer-supplied entity payload merged into the current model. Uses the existing model-save infrastructure (whatever helper the rest of the app uses for this endpoint). On success, close the modal and trigger the model-reload pattern matching how other model-save flows behave.
        - "Discard all" → clears modal state and closes the modal. No server call.
    - Mirror layout / styling of `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx` + `.module.css`. Step 1 layout matches the export modal closely; step 2 is new.
    - **Files:**
      - `frontend/src/components/Import/InfrastructureTerraformImportModal.tsx`
      - `frontend/src/components/Import/InfrastructureTerraformImportModal.module.css`
  - [x] 7.4 Append menu item to `FileMenu.tsx`
    - Add "Import Infrastructure from Terraform..." entry parallel to the existing "Export Infrastructure as Terraform..." entry (same group, parallel position).
    - New props on `FileMenu`: `onImportInfrastructureTerraform: () => void`, `importInfrastructureTerraformDisabled: boolean`.
    - Disabled gate matches the export entry: model loaded AND `metaModel.entities.environments.length > 0` (at least one Environment exists in the Infrastructure domain).
    - On click: invokes `onImportInfrastructureTerraform()` to open the new modal.
    - **File:** `frontend/src/components/TopBar/FileMenu.tsx`
  - [x] 7.5 Wire modal state into `TopBar.tsx`
    - Add `importTerraformOpen` state (parallel to `exportTerraformOpen`).
    - Pass `onImportInfrastructureTerraform={() => setImportTerraformOpen(true)}` and `importInfrastructureTerraformDisabled={...}` to `FileMenu`.
    - Render `<InfrastructureTerraformImportModal open={importTerraformOpen} onClose={() => setImportTerraformOpen(false)} ... />` parallel to the export modal.
    - Pass `projectId`, `architectureId`, `metaModel`, and the existing model-save callback into the modal so it can: (a) populate dropdowns, (b) call the import API, (c) post approved candidates back through the existing model-save flow.
    - **File:** `frontend/src/components/TopBar/TopBar.tsx`
  - [x] 7.6 Verify TypeScript compiles + targeted tests pass
    - Run `npx tsc --noEmit` from `frontend/`. Verify zero new TypeScript errors.
    - Run ONLY the tests from 7.1 (modal smoke + API helper test, 8-10 tests). Use `npx vitest run <test-file-path>` to scope to the new test files.
    - Do NOT run the full Vitest suite at this stage.
    - After targeted tests pass, run the full Vitest sweep on `frontend/`. Confirm net new failures = 0 (compare against pre-existing failures captured in project memory: `bootstrap-summary-fetching.test.ts`, `chatV2-panel-*`, etc.).

**Acceptance Criteria:**
- The 8-10 tests written in 7.1 pass.
- `modelApi.importInfrastructureTerraform(...)` `POST`s `multipart/form-data` and returns parsed `ImportReviewResult` JSON.
- Modal step 1 renders all required fields with correct gating; Provider dropdown shows `GCP` enabled and the other 5 options disabled with "Coming soon" tooltip; submit disabled until file + Environment + Provider all set.
- Modal step 2 renders warnings panel + three category tables with the documented columns; evidence row-expander toggles raw HCL visibility.
- "Approve all" posts candidates through the existing model-save flow on `PUT /api/model/projects/{p}/architectures/{a}`; "Discard all" clears state with no server call.
- FileMenu entry sits parallel to the export entry; disabled unless model loaded + at least one Environment exists.
- TopBar wires modal state in parallel to the export modal state.
- `iacSourceProviderOptions` from `defaults.ts:1321` is imported and reused, **NOT** redeclared.
- `npx tsc --noEmit` reports zero new TypeScript errors.
- Full Vitest sweep shows net new failures = 0 (only previously-known pre-existing failures remain).

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Foundation interface + records + context carrier** — `TerraformImporter`, `ImportedCandidate`, `ImportReviewResult`, `TerraformImportContext`. Everything below depends on these types.
2. **Task Group 2: Hand-rolled HCL lexer + parser** — `HclLexer`, `HclParser`, `HclBlock`, `HclAttribute`, `HclValue` covering the locked subset with line-range tracking, comment preservation, and error tolerance. Heaviest single group.
3. **Task Group 3: GcpTerraformImporter — reverse-mapping classifier + composite-LB grouping** — per-resource-family classifiers covering every entry in the locked GCP reverse-mapping table + composite-LB success/fallback paths.
4. **Task Group 4: Resolution + matching + relationship inference** — `VariableResolver`, `LocalsResolver`, `ModuleResolver`, `CandidateMatcher`, `RelationshipInferrer`. Conceptually dense, small in code volume.
5. **Task Group 5: TerraformImportService + InfrastructureTerraformImportController** — service orchestrator + endpoint exposing `POST /api/model/projects/{p}/architectures/{a}/infrastructure/import-terraform` accepting multipart upload + returning `ImportReviewResult` JSON.
6. **Task Group 6: Forward fixture + round-trip golden snapshots** — `TerraformImportForwardFixtureTest` (hand-rolled edge cases) + `TerraformImportRoundTripTest` (consumes export's golden HCL). Pins round-trip parity contract.
7. **Task Group 7: Frontend two-step modal + menu + TopBar wiring + API helper + 2 tests** — `modelApi.importInfrastructureTerraform`, `InfrastructureTerraformImportModal.tsx` (step 1 upload form + step 2 read-only review), `FileMenu.tsx` entry, `TopBar.tsx` modal state. Includes final full Vitest sweep with net-new-failures=0.

---

## File Summary

### Backend Files to Create (~17)

**Service package `service/import_/terraform/` (5 — orchestration layer):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/TerraformImporter.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/ImportedCandidate.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/ImportReviewResult.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/TerraformImportContext.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/TerraformImportService.java`

**Service package `service/import_/terraform/` (5 — classifier + helpers):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/GcpTerraformImporter.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/VariableResolver.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/LocalsResolver.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/ModuleResolver.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/CandidateMatcher.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/RelationshipInferrer.java`

**HCL parser package `service/import_/terraform/hcl/` (5):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclLexer.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclParser.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclBlock.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclAttribute.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/import_/terraform/hcl/HclValue.java`

**Controller (1):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformImportController.java`

**Backend test files (7):**
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImporterFoundationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/hcl/HclLexerTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/hcl/HclParserTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/GcpTerraformImporterTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/GcpImporterResolutionMatchingTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImportServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/InfrastructureTerraformImportControllerTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImportForwardFixtureTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/import_/terraform/TerraformImportRoundTripTest.java`

**Backend test fixtures (under one new directory):**
- `architecture-model-service/src/test/resources/terraform-import/input.tf`
- `architecture-model-service/src/test/resources/terraform-import/modules/network/main.tf` (and any other supporting module files exercised by the fixture)
- `architecture-model-service/src/test/resources/terraform-import/expected-candidates.json`
- (Round-trip test consumes the export spec's existing `architecture-model-service/src/test/resources/terraform-export/expected/main.tf` + `variables.tf` + `outputs.tf` directly — no new fixture files for the round-trip path.)

### Backend Files to Modify (0)
- **None.** No edits to `ModelController.java`, `InfrastructureTerraformExportController.java`, `TerraformExportService.java`, `GcpTerraformExporter.java`, no Liquibase changesets, no `pom.xml` changes, no edits to existing entity / DTO / repository / service classes from specs 1-7. Spring auto-wires the new `@Component` / `@Service` beans.

### Frontend Files to Create (1 modal + 1 CSS + 2 tests = 4)
- `frontend/src/components/Import/InfrastructureTerraformImportModal.tsx`
- `frontend/src/components/Import/InfrastructureTerraformImportModal.module.css`
- `frontend/src/components/Import/__tests__/InfrastructureTerraformImportModal.test.tsx`
- `frontend/src/api/__tests__/modelApi.importInfrastructureTerraform.test.ts` (or appended to existing `modelApi.test.ts` per repo convention)

### Frontend Files to Modify (3)
- `frontend/src/api/modelApi.ts` (append `importInfrastructureTerraform` function).
- `frontend/src/components/TopBar/FileMenu.tsx` (append "Import Infrastructure from Terraform..." entry parallel to the existing export entry; new props `onImportInfrastructureTerraform` + `importInfrastructureTerraformDisabled`).
- `frontend/src/components/TopBar/TopBar.tsx` (modal state wiring parallel to the export modal).

### Files Explicitly NOT to Touch
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java` — new controller, not folded in.
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformExportController.java` — separate spec's controller, untouched.
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/**` — entire export package untouched. Reverse-mapping logic lives in the new import package.
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — zero changesets in this spec (V1 transient).
- All applied Liquibase changesets `001-` through `125-` — never amend.
- `architecture-model-service/src/test/resources/terraform-export/**` — read-only; round-trip test consumes these as-is.
- All existing entity / DTO / repository / service classes from specs 1-7 — read-only at import time.
- `frontend/src/config/defaults.ts` `iacSourceProviderOptions` (line 1321) — reused, NOT redeclared.
- `frontend/src/components/Export/InfrastructureTerraformExportModal.tsx` + `.module.css` — separate spec's modal, untouched. Pattern reused via parallel new files under `Import/`.
- All 16 existing Infrastructure grid configs in `frontend/src/config/gridConfigs.ts` — unchanged.
- `frontend/src/utils/relationshipUtils.ts`, `frontend/src/utils/rendering.ts`, `frontend/src/utils/paletteData.ts`, `frontend/src/components/SelectionInspector/SelectionInspector.tsx` — no diagram support for Terraform imports.
- `gateway/`, `mcp-server/`, `discovery-service/` — zero code changes.
- `pom.xml` — no new dependency added.

---

## Reference Patterns

### Existing Code to Follow

- **`architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/`** — direct symmetric template for the new `service/import_/terraform/` package:
  - `TerraformExporter` ↔ `TerraformImporter` strategy interface shape.
  - `GcpTerraformExporter` ↔ `GcpTerraformImporter` provider impl.
  - `TerraformContext` ↔ `TerraformImportContext`.
  - `TerraformExportService` ↔ `TerraformImportService`.
  - Spring `List<TerraformImporter>` keyed by `providerId()` follows the `List<TerraformExporter>` pattern verbatim.

- **`architecture-model-service/src/main/java/com/example/architecturemodel/controller/InfrastructureTerraformExportController.java`** — direct template for `InfrastructureTerraformImportController`:
  - Same project/architecture path scoping.
  - Same hard-fail-before-work pattern.
  - Same slug helper.
  - Same `iacSourceProviderOptions` provider validation.
  - **Inverted:** `POST` instead of `GET`, `multipart/form-data` request, `application/json` response (NOT `application/zip`).

- **`architecture-model-service/src/main/java/com/example/architecturemodel/service/export/terraform/GcpTerraformExporter.java` (mapping table)** — authoritative source for the GCP reverse-mapping table the importer must invert exactly. Round-trip golden test enforces parity.

- **`architecture-model-service/src/test/.../service/export/terraform/TerraformExportGoldenFileTest.java`** — direct template for `TerraformImportForwardFixtureTest`'s snapshot assertion shape (Jackson serialise → byte-equal against committed golden JSON). The round-trip test re-uses the export's existing input fixture.

- **Spec-7 `IaCSource` + `IaCResourceBinding` entities + provenance fields (`2026-05-05-infrastructure-terraform-discovery-readiness`)** — reused as-is. Importer creates `IaCSource` rows on approval (one per import) and `IaCResourceBinding` rows (one per mapped resource block) with `iac_address`, `iac_resource_type`, `iac_resource_name`, `provider`, `file_path`, `start_line`, `end_line`, `external_id` (where available), `confidence`. Provenance fields `source_origin = 'IMPORTED'`, `source_system = 'terraform-import'`, `source_reference = '<iac_address>'`, `last_verified_at = <now>` stamped on every imported Infrastructure entity. Zero schema changes.

- **`InfrastructurePoint` polymorphic point pattern** — reused unchanged. `IaCResourceBinding.infrastructure_point_id` resolves to the appropriate Infrastructure entity via the `target_type` discriminator.

- **`frontend/src/api/modelApi.ts` `exportInfrastructureTerraform`** — direct template for the new `importInfrastructureTerraform` API helper (mirrored signature, but `POST` `multipart/form-data` returning parsed JSON instead of `GET` returning raw `Response`).

- **`frontend/src/components/Export/InfrastructureTerraformExportModal.tsx`** — direct template for `InfrastructureTerraformImportModal.tsx` step 1 (form layout, Environment/Cloud Account/Location/Provider dropdowns, submit-disabled gating). Step 2 (read-only review table) is a new pattern.

- **`frontend/src/components/TopBar/FileMenu.tsx` + `TopBar.tsx`** — direct template for the new menu item + modal state wiring. Mirror the existing `onExportInfrastructureTerraform` / `exportInfrastructureTerraformDisabled` props verbatim, parallel position in the menu, parallel enablement gate.

- **`frontend/src/config/defaults.ts` line 1321 `iacSourceProviderOptions`** — provider dropdown source; imported as-is, NOT redeclared.

- **Discovery-service candidate-review pattern (`discovery-service/src/services/runManager.ts`)** — documented as the canonical target pattern when persistent import-runs land in a follow-up spec. **NOT reused in V1** (Q2 = transient, Q11 = read-only summary).

### Key Decisions to Honour (Locked Contract)

1. **Endpoint:** `POST /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform`. NOT folded into `ModelController`.
2. **Request:** `multipart/form-data` with `files` parts (`.tf` multi OR single `.zip`) + form fields (`environmentId` required, `cloudAccountId` opt, `locationId` opt, `provider` required, `repositoryUrl` opt, `branch` opt, `commitSha` opt, `path` opt, `workspace` opt).
3. **Response:** `application/json` with `ImportReviewResult` payload — NOT a ZIP, NOT a file write. Fully transient (Q2 = b).
4. **No model mutation in this controller.** Approval flows through the existing model-save endpoint (`PUT /api/model/projects/{p}/architectures/{a}`). "Discard all" is pure client-side state clear.
5. **HCL parser:** hand-rolled tolerant subset; zero new Maven dependency. Supports `resource` / `module` / `variable` / `output` / `locals` / `provider` blocks; STRING / NUMBER / BOOL / LIST / MAP literals; `var.x` / `local.x` / `<resource>.<name>.<attr>` / `module.<name>.<attr>` references. Anything else preserved verbatim + soft-warn TODO.
6. **Strategy interface:** Spring beans registered by `providerId()` in `Map<String, TerraformImporter>`. V1 only `GcpTerraformImporter` registered.
7. **Hard-fail vs soft-warn:** hard-fail (4xx) ONLY for missing `environmentId`, missing/unknown/unregistered `provider`, no file parts, oversized file/ZIP. Hard-fail boundary checks BEFORE parse. All other gaps are soft-warn (TODO on candidate + entry in result `warnings`; never throw).
8. **Confidence buckets:** HIGH 0.900 / MEDIUM 0.600 / LOW 0.300 stored as `DECIMAL(4,3)` on `IaCResourceBinding.confidence`.
9. **Field-precedence on match:** user-edited `name` + `description` win; imported wins for technical fields (CIDR, region, engine, type, `provider_resource_type`, machine type, version, etc.).
10. **`iac_address` byte-equal preservation** — round-trip stability with the export contract is a top-level invariant.
11. **Composite-LB symmetry:** 5 GCP resources ↔ ONE `LoadBalancer` + ONE `Listener` (try-then-fallback); fallback emits per-component candidates + warnings, no relationships.
12. **`SECRET_STORE` candidates NEVER include secret values** even when literally present in the HCL.
13. **One `IaCSource` per import** — whole-ZIP-is-one-IaCSource (Q4).
14. **One-hop variable / locals / module-file resolution** — V1 cut (Q5). No `for_each` / `count` / template-string evaluation; preserved verbatim + TODO.
15. **Remote module sources NEVER fetched** — soft-warn TODO only.
16. **Provenance stamps on approval:** `source_origin = 'IMPORTED'`, `source_system = 'terraform-import'`, `source_reference = '<iac_address>'`, `last_verified_at = <now>`.
17. **snake_case JSON throughout backend.**
18. **Zero Liquibase changesets** (V1 transient).
19. **No edits** to `ModelController`, `InfrastructureTerraformExportController`, `TerraformExportService`, `GcpTerraformExporter`, `pom.xml`, applied changesets (≤125), gateway, mcp-server, discovery-service, existing 16 Infrastructure grids, existing diagram palette / edges.
20. **Reuse `iacSourceProviderOptions` from `defaults.ts:1321`** — do NOT redeclare on either backend or frontend.
21. **Per-individual candidate approve/ignore is deferred** — V1 ships read-only summary + "Approve all" / "Discard all" only (Q11=b). Candidate payload shape carries per-candidate identity + ignore-state plumbing so the follow-up spec is pure UI work.
22. **No LLM enrichment in V1** — deterministic-only, no flag (Q12).
23. **Safety boundaries verbatim:** NO `terraform init/plan/apply`, NO GCP API calls, NO credentials, NO Git checkout, NO remote backend access, NO remote module fetch, NO production-grade Terraform validation.
24. **Pre-existing broken backend tests** carry forward unchanged. Apply broken-tests staging workaround at every targeted-test verification step.
