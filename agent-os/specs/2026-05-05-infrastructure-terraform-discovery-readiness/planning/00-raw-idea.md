Add Terraform and discovery readiness for Infrastructure domain without full import

Add Terraform and discovery-readiness support for the Infrastructure Architecture domain without implementing full Terraform import, cloud inventory import, or automated provisioning.

Context:
- The tool now has or is gaining a sixth Architecture domain:
  - Infrastructure
- Previous specs introduce:
  - backend Infrastructure model foundation
  - backend Infrastructure API/model persistence integration
  - frontend Infrastructure types/model integration
  - Infrastructure table UI
  - Infrastructure diagram support
  - cross-domain integration between Infrastructure, Application, and Data
- The wider system includes:
  - architecture-model-service as the system of record
  - frontend as the modelling and diagramming UI
  - discovery-service for code/discovery pipeline concepts
  - gateway and MCP server for orchestration/LLM-assisted workflows
- Infrastructure V1 is primarily for manually modelling and diagramming high-level infrastructure.
- V1.1 should prepare the model and UI for future Terraform/GCP-assisted import/export/generation without implementing the full importer yet.

Goal:
Make the Infrastructure domain ready for future Terraform and discovery workflows by adding provenance, source mapping, review-friendly metadata, and lightweight readiness surfaces.

This spec should make it possible to answer:
- Which Terraform/IaC source or module is expected to define this infrastructure concept?
- Which Terraform resource address might correspond to this architecture entity?
- Which architecture entities are ready to be generated into Terraform later?
- Which architecture entities were manually created versus discovered/imported/suggested?
- How can a future Terraform importer map `.tf` resources into existing Infrastructure entities?
- How can a future discovery pipeline produce Infrastructure candidates without changing the domain model again?

Concepts in scope:

1. IaC Source
Represents a source of infrastructure-as-code, such as a Terraform repo/path/workspace.

Suggested attributes:
- id
- project_id FK -> Project
- architecture_id FK -> Architecture
- environment_id FK -> Environment, nullable
- name: string
- source_type: enum/string, suggested values TERRAFORM, OPENTOFU, CLOUDFORMATION, BICEP, PULUMI, KUBERNETES, HELM, OTHER
- repository_url: string, nullable
- repository_provider: enum/string, suggested values GITHUB, GITLAB, BITBUCKET, AZURE_DEVOPS, OTHER, nullable
- branch: string, nullable
- commit_sha: string, nullable
- path: string, nullable
- workspace: string, nullable
- module_name: string, nullable
- module_path: string, nullable
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, MULTI, OTHER, nullable
- description: text, nullable
- owner: string, nullable
- last_scanned_at: timestamp, nullable
- last_imported_at: timestamp, nullable
- tags/metadata: object/map, nullable, following existing convention

2. IaC Resource Binding
Represents a mapping between an Infrastructure Architecture entity and a future/current IaC resource address.

Suggested attributes:
- id
- project_id FK -> Project
- architecture_id FK -> Architecture
- iac_source_id FK -> IaC Source
- infrastructure_point FK -> InfrastructurePoint
- environment_id FK -> Environment, nullable
- iac_address: string, e.g. module.orders.google_cloud_run_v2_service.service
- iac_resource_type: string, e.g. google_cloud_run_v2_service
- iac_resource_name: string, nullable
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- file_path: string, nullable
- start_line: integer, nullable
- end_line: integer, nullable
- state_resource_id: string, nullable
- external_id: string, nullable
- binding_status: enum/string, suggested values PLANNED, SUGGESTED, CONFIRMED, STALE, REMOVED, UNKNOWN
- confidence: number/decimal, nullable
- last_seen_at: timestamp, nullable
- notes: text, nullable
- tags/metadata: object/map, nullable, following existing convention

3. Infrastructure Source Metadata
Add lightweight source/provenance metadata to existing Infrastructure entities and relationships where appropriate.

Suggested common fields, if not already covered by existing conventions:
- source_origin: enum/string, suggested values MANUAL, DISCOVERED, IMPORTED, GENERATED, SUGGESTED, OTHER
- source_system: string, nullable, e.g. terraform, gcp-cloud-asset-inventory, discovery-service, manual
- source_reference: string, nullable, e.g. Terraform address, cloud resource id, repo path
- generation_status: enum/string, suggested values NOT_READY, READY, GENERATED, BLOCKED, NOT_APPLICABLE, UNKNOWN
- generation_notes: text, nullable
- last_verified_at: timestamp, nullable

Apply this metadata in a consistent way to the existing Infrastructure V1 entities and relationships where useful:
- Environment
- Cloud Account / Project / Tenant
- Location / Site / Region
- Network
- Subnet / Network Segment
- Compute Cluster / Platform
- Compute Resource
- Deployment Unit
- Load Balancer / Ingress
- Listener / Exposure
- Data Store Instance
- Infrastructure Resource
- Resource hosted in Subnet / Segment
- Deployment Unit runs on Compute
- Load Balancer routes to Compute / Resource

4. Terraform Readiness Flags
Add enough model support to let future workflows assess whether a concept is ready to be converted into Terraform.

Suggested fields, if not already covered elsewhere:
- terraform_ready: boolean, nullable
- terraform_module_hint: string, nullable
- terraform_resource_hint: string, nullable
- terraform_variable_hints: object/map or text, nullable
- terraform_notes: text, nullable

These fields should be lightweight hints only. They should not become a Terraform engine.

Backend requirements:
- Add backend model support for IaC Source.
- Add backend model support for IaC Resource Binding.
- Add DTOs/entities/repositories/mapping support using existing architecture-model-service conventions.
- Include IaC Source and IaC Resource Binding in full-model save/load where appropriate.
- Preserve projectId and architectureId scoping.
- Use InfrastructurePoint for IaC Resource Binding target references.
- Add migrations following existing migration conventions.
- Add provenance/readiness metadata to Infrastructure entities/relationships only where it fits cleanly with existing model patterns.
- Keep backwards compatibility with existing Infrastructure data created before these fields exist.
- Do not implement parsing of `.tf` files.
- Do not implement Terraform generation.
- Do not implement Terraform plan/apply.
- Do not call Terraform CLI.

Frontend requirements:
- Add TypeScript types for IaC Source and IaC Resource Binding.
- Add default empty arrays for IaC Source and IaC Resource Binding where the model stores them.
- Add table/grid support for IaC Source and IaC Resource Binding if consistent with existing Infrastructure tables.
- Show provenance/readiness fields in Infrastructure entity details or tables where useful but avoid overwhelming the V1 UI.
- Add simple visual indicators where existing UI patterns support them, such as:
  - manual/discovered/imported/generated source origin
  - Terraform-ready status
  - confirmed/stale/suggested binding status
- Ensure older models without these fields load safely.
- Ensure save flows preserve IaC metadata and bindings.

Discovery-service readiness:
- Add or document a stable DTO/API contract shape that a future discovery-service Infrastructure pipeline can use to propose Infrastructure entities, relationships, IaC sources, and IaC bindings.
- Align with existing discovery concepts where possible:
  - candidates
  - evidence
  - confidence
  - decision tasks
  - approved candidates
- Do not implement a full Infrastructure discovery pipeline in this spec.
- Do not implement Terraform parsing in discovery-service.
- Do not implement code scanning for infrastructure files yet.
- The output shape should make future discovery work possible without needing to redesign the Infrastructure domain.

Gateway/MCP readiness:
- Add only minimal type/schema awareness if required by existing save/tooling flows.
- If MCP save tools already require explicit model concept support, add placeholder/readiness support for saving IaC Source and IaC Resource Binding.
- Do not add conversational Terraform generation or import workflows in this spec.
- Do not add LLM-based Terraform creation in this spec.
- Do not add cloud provider calls in this spec.

Terraform/GCP mapping guidance:
Capture lightweight mapping guidance in code comments, config, or documentation where the project normally stores such mappings.

Examples:
- Network may map to `google_compute_network`
- Subnet / Network Segment may map to `google_compute_subnetwork`
- Compute Cluster / Platform may map to `google_container_cluster`
- Compute Resource may map to `google_compute_instance`, `google_cloud_run_v2_service`, `google_cloudfunctions2_function`, or Kubernetes resources
- Deployment Unit may map to container image, function source, VM image, or artifact URI
- Load Balancer / Ingress may map to GCP forwarding rules, backend services, URL maps, target proxies, NEGs, or ingress resources
- Listener / Exposure may map to forwarding rule ports, ingress rules, service ports, or container ports
- Data Store Instance may map to `google_sql_database_instance`, AlloyDB, BigQuery, Redis/Memorystore, or similar
- Infrastructure Resource may map to `google_storage_bucket`, `google_pubsub_topic`, `google_pubsub_subscription`, `google_redis_instance`, `google_secret_manager_secret`, `google_cloud_scheduler_job`, or similar

This guidance should be treated as future workflow support, not hard-coded provider-specific behaviour in the core model.

User experience:
- Users should be able to see whether an Infrastructure item is manual, discovered, imported, generated, or suggested.
- Users should be able to associate an Infrastructure item with an IaC Source and IaC Resource Binding.
- Users should be able to see the Terraform/GCP resource hint for an Infrastructure item when available.
- Users should be able to mark or review whether an Infrastructure item is Terraform-ready.
- This should support future agreement workflows such as:
  - "this target-state architecture is ready to be converted into Terraform"
  - "this resource is already represented in Terraform"
  - "this resource is only manually modelled"
  - "this binding was suggested but not confirmed"

Out of scope:
- Full Terraform import
- Terraform parsing
- Terraform state parsing
- Terraform generation
- Terraform plan/apply
- OpenTofu support beyond source_type/hints
- Live GCP API integration
- Cloud Asset Inventory integration
- Discovery-service infrastructure scanning
- LLM-based IaC generation
- Security group/firewall/IAM modelling
- Cost estimation
- Drift detection
- Policy/compliance scanning
- Automatic diagram generation from Terraform

Acceptance criteria:
- Backend supports IaC Source records scoped by project and architecture.
- Backend supports IaC Resource Binding records scoped by project and architecture.
- IaC Resource Binding can reference Infrastructure entities through InfrastructurePoint.
- Full-model save/load preserves IaC Source and IaC Resource Binding data.
- Infrastructure entities and relationships can store source/provenance metadata where implemented.
- Infrastructure entities can store lightweight Terraform readiness/hint metadata where implemented.
- Frontend types include IaC Source and IaC Resource Binding.
- Frontend default model state safely handles missing IaC Source and IaC Resource Binding arrays.
- Users can view and edit IaC Source and IaC Resource Binding information through table/details UI if consistent with existing patterns.
- Existing Infrastructure V1 diagrams and tables continue to work unchanged.
- Existing Business, Application, Data, Behavioural, and UI domains continue to work unchanged.
- Discovery/Gateway/MCP changes are limited to readiness/schema support only where required.
- No Terraform parser, generator, importer, plan/apply, live cloud integration, or LLM IaC workflow is implemented in this spec.
