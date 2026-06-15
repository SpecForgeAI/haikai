Add Infrastructure cross-domain integration

Add cross-domain integration between the new Infrastructure Architecture domain and the existing architecture domains.

Context:
- The tool currently supports five architecture domains:
  - Business
  - Application
  - Data
  - Behavioural
  - UI
- Previous specs introduce the sixth domain:
  - Infrastructure
- Previous Infrastructure specs add:
  - backend Infrastructure model foundation
  - backend Infrastructure API/model persistence integration
  - frontend Infrastructure types/model integration
  - Infrastructure table UI
  - Infrastructure diagram support
- The current codebase already uses polymorphic point/supertype patterns such as:
  - ApplicationPoint
  - BusinessPoint
  - DataEntityPoint
- Infrastructure adds:
  - InfrastructurePoint
- This spec connects Infrastructure to existing domains without expanding the Infrastructure V1 scope into security, Terraform import, discovery, or deep runtime analysis.

Goal:
Allow users to connect Infrastructure Architecture to existing Application and Data Architecture concepts so the Infrastructure domain is not isolated from the rest of the model.

Primary cross-domain questions to support:
- Which application/service runs on which infrastructure?
- Which deployment artifact runs on which compute/runtime?
- Which infrastructure resource supports an application/service?
- Which data store instance supports a data entity or data store concept?
- How can users navigate from an Application or Data concept to the relevant Infrastructure view?
- How can diagrams show high-level links between logical architecture and runtime/cloud infrastructure?

Cross-domain relationships in scope:

1. Application deployed to Compute
- Source: existing Application-domain entity/service, using the existing ApplicationPoint pattern if appropriate.
- Target: Infrastructure Compute Resource.
- Optional link: Deployment Unit.
- Purpose: show that a logical application/service is deployed to a specific runtime/compute resource.

Suggested attributes:
- application_point FK -> ApplicationPoint or equivalent existing application polymorphic reference
- compute_resource FK -> Compute Resource
- deployment_unit FK -> Deployment Unit, nullable
- environment FK -> Environment, nullable
- deployment_role: enum/string, suggested values PRIMARY, SECONDARY, WORKER, BATCH, ADMIN, OTHER
- runtime_name: string, nullable
- runtime_version: string, nullable
- evidence_source: string, nullable
- confidence: number/decimal, nullable
- notes: text, nullable

2. Data entity hosted on Data Store
- Source: existing Data-domain entity, data object, physical data entity, or DataEntityPoint depending on existing data-domain patterns.
- Target: Infrastructure Data Store Instance.
- Purpose: show where important data entities are hosted from an infrastructure point of view.

Suggested attributes:
- data_point FK -> DataEntityPoint or equivalent existing data polymorphic reference
- data_store_instance FK -> Data Store Instance
- environment FK -> Environment, nullable
- database_name: string, nullable
- schema_name: string, nullable
- table_or_collection_name: string, nullable
- hosting_role: enum/string, suggested values PRIMARY, REPLICA, CACHE, ARCHIVE, ANALYTICS, OTHER
- evidence_source: string, nullable
- confidence: number/decimal, nullable
- notes: text, nullable

3. Application uses Infrastructure Resource
- Source: existing Application-domain entity/service, using ApplicationPoint if appropriate.
- Target: Infrastructure Resource.
- Purpose: show major platform dependencies such as buckets, queues, topics, caches, secret stores, schedulers, registries, and CDNs.

Suggested attributes:
- application_point FK -> ApplicationPoint or equivalent existing application polymorphic reference
- infrastructure_resource FK -> Infrastructure Resource
- environment FK -> Environment, nullable
- dependency_type: enum/string, suggested values READS_FROM, WRITES_TO, PUBLISHES_TO, SUBSCRIBES_TO, USES, STORES_IN, RETRIEVES_FROM, OTHER
- protocol: string, nullable
- endpoint_or_topic: string, nullable
- access_mode: enum/string, suggested values READ, WRITE, READ_WRITE, EXECUTE, ADMIN, OTHER, nullable
- evidence_source: string, nullable
- confidence: number/decimal, nullable
- notes: text, nullable

4. Application exposed through Load Balancer / Ingress
- Source: existing Application-domain entity/service, using ApplicationPoint if appropriate.
- Target: Load Balancer / Ingress or Listener / Exposure.
- Purpose: connect logical application/API concepts to infrastructure ingress/exposure.

Suggested attributes:
- application_point FK -> ApplicationPoint or equivalent existing application polymorphic reference
- load_balancer FK -> Load Balancer / Ingress, nullable
- listener FK -> Listener / Exposure, nullable
- environment FK -> Environment, nullable
- host_name: string, nullable
- path_pattern: string, nullable
- protocol: string, nullable
- port: number/integer, nullable
- exposure: enum/string, suggested values PUBLIC, PRIVATE, INTERNAL, OTHER, nullable
- evidence_source: string, nullable
- confidence: number/decimal, nullable
- notes: text, nullable

Backend requirements:
- Add backend DTOs/entities/repositories/mapping support for the cross-domain relationships.
- Integrate these relationships into MetaModelRelationshipsDto or the existing equivalent model relationship container.
- Preserve projectId and architectureId scoping.
- Use existing relationship modelling patterns and point abstractions.
- Use InfrastructurePoint only where the relationship target/source is infrastructure-polymorphic.
- Use ApplicationPoint and DataEntityPoint where the relationship source/target is application/data-polymorphic.
- Ensure full-model save/load includes the cross-domain relationships.
- Ensure delete/replace behaviour is consistent with existing relationship semantics.
- Prevent or safely handle dangling references when related records are removed.
- Do not introduce new top-level Infrastructure entities in this spec unless required to support the relationships above.

Frontend model/type requirements:
- Add TypeScript types for the cross-domain relationships.
- Extend the frontend model relationship container with arrays for these relationships.
- Add default empty arrays for older architectures.
- Add relationship metadata definitions so these links are available to UI/table/diagram features.
- Ensure older model payloads without these relationship arrays load safely.
- Ensure save flows preserve these relationships.

Frontend table/UI requirements:
- Add table/grid support for the cross-domain relationships where existing relationship tables are shown.
- Relationship tables should use human-readable selectors for:
  - ApplicationPoint/application concepts
  - DataEntityPoint/data concepts
  - Compute Resource
  - Deployment Unit
  - Data Store Instance
  - Infrastructure Resource
  - Load Balancer / Ingress
  - Listener / Exposure
  - Environment
- Use existing table/grid conventions.
- Do not create a separate new cross-domain UI pattern.
- If there is already a relationship editor shared by domains, integrate these relationships there.

Diagram requirements:
- Existing Infrastructure diagrams should be able to optionally show cross-domain links.
- Application deployment links should support showing:
  - Application/service -> Compute Resource
  - Application/service -> Deployment Unit -> Compute Resource where useful
- Data hosting links should support showing:
  - Data entity -> Data Store Instance
- Infrastructure dependency links should support showing:
  - Application/service -> Infrastructure Resource
- Exposure links should support showing:
  - Application/service -> Listener / Exposure
  - Application/service -> Load Balancer / Ingress
- These cross-domain links should be optional overlays or selectable relationship types, not mandatory clutter on every Infrastructure diagram.
- Existing Application/Data diagrams should not be disrupted, but where existing diagram tooling supports cross-domain references, these links should be available.

Navigation and usability:
- From an Application concept, users should be able to identify related Infrastructure concepts where relationships exist.
- From a Data concept, users should be able to identify related Infrastructure Data Store Instances where relationships exist.
- From an Infrastructure concept, users should be able to identify linked Application/Data concepts where relationships exist.
- Use existing side panels, inspectors, linked-record displays, or relationship panels if the frontend already has them.
- Avoid building a new navigation paradigm unless existing patterns require it.

Model boundaries:
- Keep Infrastructure as the runtime/deployment/cloud/on-prem domain.
- Keep Application as the logical application/service/API/component domain.
- Keep Data as the logical/physical data architecture domain.
- Do not duplicate Application entities as Compute Resources.
- Do not duplicate Data entities as Data Store Instances.
- Cross-domain relationships should connect the concepts rather than merging them.

Out of scope:
- Terraform import/export/generation
- Discovery-service integration
- Gateway changes
- MCP tools
- Security group/firewall/IAM modelling
- Detailed Traffic Flow modelling
- Data lineage modelling
- Behavioural event-to-infrastructure mapping
- UI hosting/CDN relationship unless already covered through Application uses Infrastructure Resource
- Automatic inference of relationships from code, Terraform, or cloud inventory
- Live cloud provider integration
- Cost/observability/compliance integrations

Acceptance criteria:
- Backend supports full-model save/load for the cross-domain relationships in scope.
- Frontend types and default model state include the cross-domain relationships in scope.
- Cross-domain relationship tables or equivalent relationship editing UI are available.
- Users can link an Application concept to a Compute Resource.
- Users can optionally link a Deployment Unit to the Application-to-Compute relationship.
- Users can link a Data concept to a Data Store Instance.
- Users can link an Application concept to an Infrastructure Resource.
- Users can link an Application concept to a Load Balancer / Ingress or Listener / Exposure.
- Cross-domain links can be viewed from the relevant Infrastructure-side records.
- Infrastructure diagrams can optionally display the cross-domain links without requiring them.
- Existing Business, Application, Data, Behavioural, UI, and Infrastructure V1 behaviours remain unchanged.
- No Terraform, Discovery, Gateway, MCP, security/IAM/firewall, or live cloud integration is included in this spec.
