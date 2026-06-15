Migration Delivery Progress and Evidence Tracking

Feature summary:
Add a migration delivery dashboard for a generated migration book of work. The dashboard rolls up progress across the generated hierarchy — initiatives, epics, features, and stories — and shows whether each part of the migration has been saved to backlog, has generated shape-specs, has implementation workspace activity, has evidence/artifacts, and still has gaps or blocked items.

The dashboard is primarily a read-only operational view but ALSO includes three small surgical additions to close low-hanging workflow gaps that the dashboard naturally exposes:

  A. Bulk regenerate from the needs-attention queue (calls existing Spec 2 batch endpoint with a targetWorkItemIds whitelist — already supported by the gateway handler).

  B. Persist the generated-item-id → WorkItem-id mapping during save-to-backlog so the dashboard joins by stored id, not by title-matching.

  C. Surface the specific missingInputs[] entries from spec-generation rows in the needs-attention list + story drawer (not just a count badge).

This spec does NOT execute migration work, does NOT add a new dependency model, and does NOT add an in-product spec editor. Those remain follow-ups under a future "Migration Backlog Refinement" spec.

Primary goal:
Operationalise the generated migration book of work by making delivery progress, spec generation progress, implementation evidence, and outstanding gaps visible in one place, plus enable bulk re-attempt of failed / insufficient-context specs from the same surface.

Key product principle:
Discovery + evidence + target architecture + mappings + API baselines generate the book of work and specs; this feature shows whether that generated work is moving through delivery and verification, AND lets the user trigger bulk re-attempts on items the dashboard flags as needing attention.

Inputs consumed:
- GeneratedMigrationBookOfWork
- Saved WorkItems created from the book of work
- MigrationStorySpecGeneration records (including missing_inputs_json content)
- WorkItemImplementWorkspace records
- WorkItem hierarchy/status
- API Behaviour Baselines
- Discovery Findings/Evidence
- ArchitectureElementMappings
- Existing implementation artifacts stored in work item workspaces

Main output:
A migration delivery dashboard for a generated book of work showing:
- backlog save progress
- shape-spec generation progress
- implementation workspace progress
- evidence/artifact coverage
- blocked / needs-attention items
- progress by initiative, epic, feature, story, and workstream
- specific missing-inputs detail for each insufficient-context story
- a bulk-regenerate action on the needs-attention queue

V1 scope:
- Add dashboard/detail view for a generated migration book of work.
- Add roll-up summary counts.
- Show hierarchy progress by initiative, epic, feature, and story.
- Show spec generation status per story.
- Show implementation workspace activity per story.
- Show evidence/artifact presence per story.
- Show needs-attention / blocked items.
- Show workstream-level progress.
- Link back to generated book of work, backlog WorkItems, generated specs, and implementation workspace.
- Prefer read-only aggregation from existing data.
- Add minimal derived aggregation APIs if needed.
- (Addition A) Bulk regenerate action: from the needs-attention panel, the user can trigger a bulk regenerate of all failed specs or all insufficient-context specs in a single click. The action reuses the Spec 2 gateway endpoint POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch with regenerateAll=true and a targetWorkItemIds whitelist drawn from the dashboard's currently filtered needs-attention rows. NO new gateway or AMS endpoint is required.
- (Addition B) Lock in generated-item-id → WorkItem-id linkage during save-to-backlog: extend the save-to-backlog persistence so each generated book item that becomes a saved WorkItem carries its WorkItem id back in book_of_work_json.items[].workItemId. The dashboard then joins by stored id, never by title-matching. This is mandatory, not conditional — if the current save-to-backlog flow does not preserve this id today, fix it here.
- (Addition C) Surface specific missing inputs: the dashboard's story drawer and needs-attention rows render the actual missing_inputs_json entries (kind / id / reason fields) from the MigrationStorySpecGeneration row for insufficient-context stories. The summary roll-up keeps its count, but the per-story view shows the specific blockers.

Out of scope:
- Running Claude Code.
- Executing generated shape-specs.
- Modifying application repositories.
- Running tests.
- Running API reconciliation.
- Running database reconciliation.
- Running data migration jobs.
- Creating a first-class dependency graph model.
- Creating a new migration execution engine.
- Replacing existing WorkItem status handling.
- Replacing existing implementation workspace flow.
- In-product spec editor (out of scope; specs are edited via Claude Code or text editor).
- Missing-input resolver flow (out of scope; the dashboard surfaces the missing inputs but does NOT yet let the user bind a missing mapping/baseline/contract inline and re-trigger. That belongs to a future "Migration Backlog Refinement" spec — but the surface created here is what the resolver flow will live on).

Core concept:
Migration Delivery Dashboard — primarily-read-only operational view for one GeneratedMigrationBookOfWork, with one bulk-action affordance (regenerate from needs-attention).

It answers:
- Has the generated book of work been saved to the backlog?
- Which stories have generated shape-specs?
- Which specs were generated successfully, with warnings, insufficient context, or failed?
- Which WorkItems have implementation workspace activity?
- Which WorkItems have execution artifacts?
- Which workstreams are progressing?
- Which items need attention?
- For insufficient-context stories, what specific inputs are missing?
- Which generated backlog areas still lack specs, evidence, or implementation activity?

It lets the user bulk-regenerate failed or insufficient-context specs from the needs-attention queue.

Suggested frontend route: Project / Architecture / Product / Migration Delivery, reachable from GeneratedMigrationBookOfWork detail page, Product Roadmap/Backlog area, Shape-spec generation workspace, and WorkItem implementation area where appropriate. Route includes projectId, architectureId (architecture-scoped to inherit AppShell chrome), and generatedBookOfWorkId.

Backend aggregation endpoint:
GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard

Response DTO: MigrationDeliveryDashboardDto with: bookOfWorkId, projectId, currentArchitectureId, targetArchitectureId, title, status, generatedAt, summary, hierarchy, workstreamSummaries, specGenerationSummary, backlogSaveSummary, implementationSummary, evidenceSummary, needsAttention (per-item includes missingInputs entries verbatim where applicable — Addition C), warnings.

Hierarchy nodes carry workItemId driven by stored id (Addition B) and missingInputsCount (Addition C) alongside the existing status/confidence/implementation/evidence fields.

Needs-attention items include an optional missingInputs[] (Addition C — present for type='insufficient_context'; each entry has { kind, id?, reason } drawn from missing_inputs_json).

Aggregation rules:
1. Generated book hierarchy from book_of_work_json.
2. WorkItem linkage by stored workItemId on book_of_work_json.items[] — never by title. Save-to-backlog flow MUST write the created WorkItem id back into book_of_work_json (Addition B is the load-bearing change).
3. Spec generation status by latest generation_attempt_number per WorkItem; surface missing_inputs_json[] entries for insufficient-context rows (Addition C).
4. Implementation workspace status derived from existing WorkItemImplementWorkspace fields; never invent completion.
5. Evidence coverage from book item metadata (evidenceReferences, discoveryFindingReferences, apiBaselineReferences, mappingReferences, architectureReferences).
6. Needs attention prioritised: failed > insufficient_context > blocked > not_saved_to_backlog > generated_with_warnings.

Frontend sections: header, summary cards, workstream progress, hierarchy tree (with badges including missing-inputs count for insufficient-context nodes), needs-attention panel (with Addition A bulk-regenerate buttons that honour the current workstream filter and Addition C inline missingInputs rendering), story detail drawer (with Addition C "Missing inputs" subsection rendering structured rows), navigation links, refresh.

Bulk-regenerate buttons in the needs-attention panel:
- "Regenerate all failed specs" — disabled when zero failed rows; calls Spec 2 gateway endpoint POST .../spec-generations/generate-batch with body { regenerateAll: true, targetWorkItemIds: [<all-failed-workitem-ids>] }; refreshes dashboard on completion.
- "Regenerate all insufficient-context specs" — same shape with insufficient-context workItemIds.
- Both honour current filters (per-workstream regen if user has narrowed the panel).
- In-flight banner matches BatchGenerationControls.tsx UX.

AMS additions:
- MigrationDeliveryDashboardDto + sibling DTOs (MigrationDeliverySummaryDto, MigrationDeliveryHierarchyNodeDto, MigrationDeliveryWorkstreamSummaryDto, MigrationDeliveryNeedsAttentionItemDto with optional missingInputs[], MigrationDeliverySpecGenerationSummaryDto, MigrationDeliveryImplementationSummaryDto, MigrationDeliveryEvidenceSummaryDto).
- MigrationDeliveryDashboardService that batches WorkItem / spec-generation / workspace fetches to avoid N+1.
- MigrationDeliveryDashboardController exposing GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard.
- Save-to-backlog flow change (Addition B): after each WorkItem create, write the new WorkItem id back into book_of_work_json.items[i].workItemId; persist the updated book_of_work_json in the same transaction. This is the ONLY data-model write this spec performs.

Gateway: thin proxy route GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard. NO new endpoint needed for Addition A — gateway POST .../spec-generations/generate-batch already accepts targetWorkItemIds (added during Spec 2 follow-up wiring).

Frontend API client: new getMigrationDeliveryDashboard(projectId, bookId) returning MigrationDeliveryDashboardDto. REUSE existing specGenerationApi.startBatchGeneration for Addition A — no new client function needed.

Testing (38 test cases across AMS + gateway + frontend + integration, explicitly tagged for Addition A / B / C coverage), 19 acceptance criteria, and explicit references to existing on-disk work (migrationShapeSpecGenerationHandler.ts targetWorkItemIds support, Liquibase changesets 139 and 140) included in the spec brief.
