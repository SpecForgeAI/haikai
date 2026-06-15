# Raw Idea: Candidate Save-Back to Canonical Model

Build the feature to promote accepted discovery candidates from Phase 1d back into the canonical architecture meta-model. After Phase 1 discovery completes and produces candidates (applications, services, app_components, interfaces, logical_entities, physical_entities, data_entities, business_processes), the user should be able to trigger a "save-back" action that writes accepted candidates into the real meta-model entities (applications, services, interfaces, etc.) stored in the architecture-model-service.

Key areas to design:
- How MCP save tools should be structured (one tool per entity type? batch tool?)
- Whether save-back is a new discovery run step or a separate action
- How idempotent matching works (name+type? name+parent? dedicated matching logic?)
- How candidate-to-entity mapping is stored (new table? field on candidate?)
- How parent resolution works when saving (top-down order? dependency resolution?)
- Gateway API for triggering save-back
- What happens to candidate status after save
- Error handling for partial saves
- Whether the MCP server or discovery service orchestrates the save
