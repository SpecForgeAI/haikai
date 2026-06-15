# Cross-Layer Coverage Report

Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser
Task Groups 8 + 9 verification pass

## Test counts

| Layer | Existing (Groups 1-7) | New (Group 8 + 9) | Total |
|-------|----------------------:|------------------:|------:|
| AMS - Changeset smoke | 6 | 0 | 6 |
| AMS - Format detector | 7 | 0 | 7 |
| AMS - Parser service | 5 | +1 (WSDL 2.0) | 6 |
| AMS - Ingest service | 7 | 0 | 7 |
| AMS - Controller (parse-files) | 4 | 0 | 4 |
| AMS - Cross-layer (NEW file) | 0 | +5 | 5 |
| Gateway - Parse-files route | 7 | 0 | 7 |
| Gateway - Cross-layer (NEW file) | 0 | +2 | 2 |
| Frontend - Modal upload | 8 | 0 | 8 |
| Frontend - Cross-layer (NEW file) | 0 | +2 | 2 |
| Frontend - Project config (Task 7) | 3 | 0 | 3 |
| **Total** | **47** | **+10** | **57** |

Group 8 brief allowed up to 10 NEW strategic tests. Delivered exactly 10
(5 AMS + 2 Gateway + 2 Frontend + 1 WSDL 2.0 catch-up). The WSDL 2.0
happy-path test is counted under Group 9 per the brief but is included in
this table for completeness.

## Spec acceptance criterion -> test mapping

### Format auto-detection
| Criterion | Covered by |
|-----------|------------|
| OAS 2.0 / 3.0 / 3.1 detection | `ContractFormatDetectorTest` (existing) |
| WSDL 1.1 detection | `ContractFormatDetectorTest` (existing) |
| WSDL 2.0 detection | `ContractFormatDetectorTest` (existing) + `OasWsdlParserServiceTest#parsesWsdl20` (NEW, Group 9) |
| Unknown / plain text -> UNKNOWN | `ContractFormatDetectorTest` (existing) |
| 2KB byte sniff limit | `ContractFormatDetectorTest` (existing) |

### OAS parsing
| Criterion | Covered by |
|-----------|------------|
| Two operations from inline OAS 3.0 | `OasWsdlParserServiceTest#parsesOas30` |
| Suggested service name from info.title | Same |
| Per-operation identifier = operationId else `method + path` | Same |
| Strict case-only normalisation (no slash collapse) | Same |
| Empty / malformed bytes return FAILED (never throws) | `OasWsdlParserServiceTest#malformedReturnsFailedWithoutThrowing`, `#emptyBytesAreFailed` |

### WSDL 1.1 parsing
| Criterion | Covered by |
|-----------|------------|
| Operation extraction | `OasWsdlParserServiceTest#parsesWsdl11` |
| Suggested service name | Same |
| End-to-end commit pipeline (NOT preview only) | `OasWsdlBulkResolveCrossLayerTest#wsdl11_commitPipeline_persistsResolutionAndArtefact` (NEW) |

### WSDL 2.0 parsing
| Criterion | Covered by |
|-----------|------------|
| Operation + service name extraction | `OasWsdlParserServiceTest#parsesWsdl20` (NEW, Group 9 catch-up) |

### Match-and-classify per operation
| Criterion | Covered by |
|-----------|------------|
| Hash key derivation matches manual-entry keys | `OasWsdlContractIngestServiceTest` (existing) |
| MATCHED / ALREADY_RESOLVED / NO_MATCH classification | `OasWsdlContractIngestServiceTest` (existing) |
| Per-file service-name override differentiation between siblings | `OasWsdlBulkResolveCrossLayerTest#perFileServiceNameOverride_producesDifferentKeys` (NEW) |
| Idempotent re-upload (no duplicate resolution row) | `OasWsdlBulkResolveCrossLayerTest#reUploadingSameOas_isIdempotent` (NEW) |

### Persistence model
| Criterion | Covered by |
|-----------|------------|
| Changeset 151 adds resolution_source + project_artifact_id | `BulkResolveOasWsdlParserChangesetSmokeTest` (existing) |
| Changeset 151 backfills pre-existing rows to 'manual' | Same |
| Changeset 152 adds max_contract_upload_file_size_mb | Same |
| Entity round-trip (boxed Integer / UUID) | Same |

### Parse-files endpoint
| Criterion | Covered by |
|-----------|------------|
| Preview returns per-operation status without DB writes | `MissingInputResolutionsControllerParseFilesTest#parseFiles_previewReturnsResults` (existing) |
| Commit persists artefact + resolution rows | `MissingInputResolutionsControllerParseFilesTest#parseFiles_commitDelegatesToIngestCommit` (existing) |
| Commit creates exactly one artefact + one resolution per matched op (end-to-end) | `OasWsdlBulkResolveCrossLayerTest#oasPreviewThenCommit_producesOneResolutionAndOneArtefact` (NEW) |
| File-size cap enforcement (per-project) | `MissingInputResolutionsControllerParseFilesTest#parseFiles_fileSizeCapMarksFileFailed` (existing) |
| Sibling-file failure isolation (oversize + valid mix) | `MissingInputResolutionsControllerParseFilesTest#parseFiles_mixedFilesSiblingIsolation` (existing) |
| Sibling-file failure isolation (mixed format + malformed at service layer) | `OasWsdlBulkResolveCrossLayerTest#mixedFormatBatch_siblingIsolation` (NEW) |
| Response shape (files + summary + previewOnly) | `MissingInputResolutionsControllerParseFilesTest` (existing) |

### Gateway proxy
| Criterion | Covered by |
|-----------|------------|
| Multipart forwarded verbatim, status + body round-trip | `missingInputResolutionsParseFilesRoute.test.ts` (existing) |
| Multi-file + serviceNames + commit form-field forwarding | Same |
| X-User-Id forwarding | Same |
| AMS 4xx / 5xx pass-through | Same |
| `?commit=true` query string forwarding (vs form-field) | `missingInputResolutionsParseFilesCrossLayer.test.ts` (NEW) |
| Per-file failure isolation pass-through verbatim | Same (NEW) |

### Frontend modal
| Criterion | Covered by |
|-----------|------------|
| Multi-file selection + per-file panels | `MigrationDeliveryBulkResolveModalUpload.test.tsx` (existing) |
| Per-operation status chips (matched / already_resolved / no_match) | Same |
| "view existing resolution" side panel link | Same |
| Service-name override per file (editable) | Same |
| Preview -> commit two-step (re-sends files) | Same |
| Per-file inline failure error rendering | Same |
| Multi-file mixed-format preview (OAS + WSDL + failed) renders 3 panels + correct summary | `MigrationDeliveryBulkResolveModalCrossLayer.test.tsx` (NEW) |
| onCommitted receives COMMIT-stage response (not preview-stage) | Same (NEW) |

### Project settings
| Criterion | Covered by |
|-----------|------------|
| Uploads section + Max contract file size (MB) field | `project-config-modal.test.tsx` (existing) |
| Default 10 MB when DTO null | Same |
| Boxed Integer PATCH delta semantics | Same |

## Coverage gaps closed by Group 8 tests

1. **WSDL 1.1 end-to-end commit** -- existing tests only exercised WSDL 1.1
   at the parser level (preview classification). The NEW
   `wsdl11_commitPipeline_persistsResolutionAndArtefact` test covers the
   full detect -> parse -> classify -> persist pipeline for WSDL.

2. **Idempotent re-upload** -- existing tests covered the ALREADY_RESOLVED
   classification in isolation, but not the "re-uploading the same file
   twice creates no duplicate row" scenario in one test. The NEW
   `reUploadingSameOas_isIdempotent` test wires the second-upload classify
   pass through the commit branch and verifies zero persistence calls.

3. **Per-file service-name override differentiation** -- the existing
   `serviceNameResolution_userOverrideBeatsSuggestedBeatsFallback` test
   exercised ONE file with an override. The NEW
   `perFileServiceNameOverride_producesDifferentKeys` test exercises TWO
   files with DIFFERENT overrides on the SAME operation identifier,
   proving the per-file override is correctly partitioned (no cross-file
   contamination).

4. **Mixed-format sibling-file isolation through the full ingest pipeline**
   -- existing tests covered oversize-vs-valid at the controller layer
   only. The NEW `mixedFormatBatch_siblingIsolation` test exercises OAS +
   WSDL + malformed inputs through the FULL parser stack and verifies the
   FAILED file does not abort the OAS / WSDL siblings.

5. **End-to-end preview -> commit happy path** -- the most load-bearing
   user workflow. The NEW
   `oasPreviewThenCommit_producesOneResolutionAndOneArtefact` test runs
   the same FileEntry through preview (verifying no writes) and then
   commit (verifying one artefact + one resolution row), all in one
   test inside one JVM.

6. **Gateway `?commit=true` query string forwarding** -- the existing
   gateway tests only verified `commit` as a form field. The NEW
   `forwards ?commit=true query string verbatim` test verifies the spec
   requirement that AMS receives the query string parameter.

7. **Gateway sibling-file failure isolation pass-through** -- the existing
   gateway tests covered single-file paths. The NEW "files[] array
   verbatim with mixed PARSED + FAILED" test verifies the proxy never
   collapses, re-orders, or re-shapes the per-file array.

8. **Frontend multi-file mixed-format preview render** -- existing test 4
   covered ONE file with three operation statuses. The NEW "OAS+WSDL+
   failed renders 3 panels + correct summary" test covers THREE files
   with three statuses (one parsed-with-match, one parsed-with-match,
   one failed) and verifies the summary banner sums across files.

9. **Frontend onCommitted receives the COMMIT response** -- existing
   test 6 verified onCommitted is called with a response, but not that
   the COMMIT-stage response (not the preview-stage one) is handed back.
   The NEW test confirms the modal hands the commit response to the
   parent so the dashboard ready-to-retry counter refreshes accurately.

10. **WSDL 2.0 happy-path parser test** (Group 9 catch-up) -- deferred
    in Group 2 per the brief. The NEW `parsesWsdl20` test confirms the
    detector + parser dispatch produces the expected operation + service
    name from an inline WSDL 2.0 description (~30 lines of XML).

## Compile / typecheck status

| Pipeline | Result |
|----------|--------|
| AMS main compile (`mvn -DskipTests compile`) | PASS (BUILD SUCCESS) |
| AMS feature tests (isolated javac + console launcher, 6 classes, 35 tests) | PASS (35 / 35) |
| Gateway parse-files Jest tests (2 files, 9 tests) | PASS (9 / 9) |
| Frontend modal + config Vitest (3 files, 16 tests) | PASS (16 / 16) |
| Gateway TypeScript `tsc --noEmit` | No NEW errors in our files. Pre-existing errors in `gateway/src/server.ts` (unrelated -- missing router exports from prior spec). |
| Frontend TypeScript `tsc --noEmit` | No NEW errors in our files. Pre-existing errors across `src/utils/*` and other modules (unrelated to this spec). |
| Liquibase changesets 151 + 152 registered in `db.changelog-master.yaml` | Both registered, in order. |

## Out-of-scope / deferred

- Full Liquibase H2 / Postgres apply integration test (per the Group 1
  brief, deferred to a future broader test-suite refresh; content-level
  changeset assertions cover the contract today).
- Full Spring `@SpringBootTest` integration test of the parse-files
  endpoint (the controller MockMvc test + the cross-layer service test
  with real parser cover the same integration points without paying the
  Spring context startup cost).
- Production smoke test against real OAS + WSDL files from disk -- Task
  9.3 calls for this when the broader test suite is green; left as a
  manual smoke step in the implementation notes.
