Add Infrastructure domain backend API and model persistence integration

Add backend API and model persistence integration for the new Infrastructure Architecture domain.

Context:
- This repo is the Spring Boot architecture-model-service.
- A previous spec introduces the Infrastructure backend model foundation, including:
  - InfrastructurePoint
  - 12 Infrastructure entities
  - 3 Infrastructure relationships
- The existing backend exposes architecture model data through project + architecture scoped routes.
- Existing model APIs use patterns such as:
  - /api/model/projects/{projectId}/architectures/{architectureId}
  - /api/model/projects/{projectId}/architectures/{architectureId}/entities
  - /api/model/projects/{projectId}/architectures/{architectureId}/relationships
- The existing meta-model is loaded/saved through:
  - MetaModelEntitiesDto
  - MetaModelRelationshipsDto
  - ModelService
- Infrastructure must integrate with the same full-model load/save style as the existing Business, Application, Data, Behavioural, and UI domains.
- Infrastructure should not be exposed as a disconnected backend module with different scoping, serialization, or persistence semantics.

Goal:
Expose and persist the Infrastructure domain through the same backend model API patterns already used by the rest of the architecture model.

Infrastructure concepts in scope:

Entities:
1. Environment
2. Cloud Account / Project / Tenant
3. Location / Site / Region
4. Network
5. Subnet / Network Segment
6. Compute Cluster / Platform
7. Compute Resource
8. Deployment Unit
9. Load Balancer / Ingress
10. Listener / Exposure
11. Data Store Instance
12. Infrastructure Resource

Relationships:
1. Resource hosted in Subnet / Segment
2. Deployment Unit runs on Compute
3. Load Balancer routes to Compute / Resource

API shape:
- Extend the existing full model retrieval endpoint so Infrastructure entities and relationships are returned with the rest of the architecture model.
- Extend the existing full model save/update flow so Infrastructure entities and relationships are persisted with the rest of the architecture model.
- Extend entity-specific model APIs, if they exist for other domains, so Infrastructure entities can be listed, created, updated, and deleted using equivalent conventions.
- Extend relationship-specific model APIs, if they exist for other domains, so Infrastructure relationships can be listed, created, updated, and deleted using equivalent conventions.
- Keep all Infrastructure API routes scoped by:
  - projectId
  - architectureId
- Use the same response, error, validation, and authorization conventions as existing model endpoints.
- Preserve backwards compatibility for existing frontend/API clients that do not yet send Infrastructure fields.

Expected JSON shape:
Infrastructure entities should appear inside MetaModelEntitiesDto using names consistent with the previous backend model foundation spec, for example:
- environments
- cloud_accounts
- locations
- networks
- subnets
- compute_clusters
- compute_resources
- deployment_units
- load_balancers
- listeners
- data_store_instances
- infrastructure_resources
- infrastructure_points

Infrastructure relationships should appear inside MetaModelRelationshipsDto using names consistent with the previous backend model foundation spec, for example:
- resource_subnet_hostings
- deployment_unit_compute_resources
- load_balancer_resource_routes

If the codebase has established naming conventions that differ from these suggested names, prefer consistency with the existing codebase while preserving the product meaning.

Model persistence behaviour:
- Full architecture model save/load should include Infrastructure entities and Infrastructure relationships.
- If an incoming model payload omits Infrastructure lists, existing Infrastructure data should be handled consistently with how omitted lists are handled for other domains.
- If an incoming model payload includes empty Infrastructure lists, deletion/replacement semantics should match existing domain behaviour.
- InfrastructurePoint records should be created, resolved, updated, and deleted consistently with ApplicationPoint, BusinessPoint, and DataEntityPoint behaviours.
- Relationship endpoints and full-model save flows should correctly resolve InfrastructurePoint references.
- Deleting or replacing Infrastructure entities should not leave invalid dangling InfrastructurePoint or relationship records.
- Existing Business, Application, Data, Behavioural, and UI persistence behaviour must remain unchanged.

API capabilities:
Support the same level of CRUD capability that comparable existing domain entities have.

At minimum, the backend should support:
- retrieving all Infrastructure entities and relationships as part of the architecture model
- saving all Infrastructure entities and relationships as part of the architecture model
- creating/updating/deleting Infrastructure entities through existing model save semantics
- creating/updating/deleting Infrastructure relationships through existing model save semantics

If the codebase already supports more granular CRUD endpoints for model entities/relationships, include Infrastructure in those endpoints too.

InfrastructurePoint API behaviour:
- InfrastructurePoint should not be treated as a user-facing business concept unless existing point types are exposed that way.
- If ApplicationPoint, BusinessPoint, or DataEntityPoint are exposed in API responses, InfrastructurePoint should follow the same pattern.
- If point records are internal implementation details, InfrastructurePoint should remain internal too.
- Relationships that reference InfrastructurePoint should serialize in the same style as comparable existing polymorphic relationships.

Validation expectations:
- Enforce projectId and architectureId scoping consistently.
- Validate required references where existing patterns do so.
- Reject or safely handle references to Infrastructure records from a different project or architecture.
- Validate that relationship targets using InfrastructurePoint resolve to valid Infrastructure entities.
- Keep validation consistent with existing model API behaviour; do not introduce a different validation style for Infrastructure only.

Migration/backwards compatibility:
- Existing architecture model payloads without Infrastructure fields should continue to load and save successfully.
- Existing tests for other domains should continue to pass without requiring frontend changes.
- Database migrations from the backend model foundation spec should support the API behaviours in this spec.
- Seed/default model data should only be changed if existing patterns require default empty lists for new domains.

Out of scope:
- Frontend TypeScript types
- Frontend API clients
- Frontend tables
- Frontend diagrams
- Gateway changes
- MCP tools
- Discovery-service changes
- Terraform parsing/import/export
- GCP provisioning
- Security group/firewall/IAM modelling
- Data entity hosted on data store relationship
- Traffic flow relationship
- Infrastructure resource dependency relationship

Acceptance criteria:
- Existing full architecture model retrieval returns Infrastructure entity and relationship lists.
- Existing full architecture model save/update persists Infrastructure entity and relationship lists.
- Infrastructure entities are scoped to the correct project and architecture.
- Infrastructure relationships are scoped to the correct project and architecture.
- InfrastructurePoint references resolve correctly in the three Infrastructure relationship types.
- Existing model payloads that omit Infrastructure data remain backwards compatible.
- Existing non-Infrastructure model save/load tests continue to pass.
- New backend tests cover full-model save/load round trip for Infrastructure entities.
- New backend tests cover full-model save/load round trip for Infrastructure relationships.
- New backend tests cover at least one Infrastructure relationship using InfrastructurePoint.
- New backend tests cover project/architecture scoping for Infrastructure data.
- No frontend, gateway, MCP, discovery, or Terraform implementation is included in this spec.
