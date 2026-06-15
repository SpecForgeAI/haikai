# Export Infrastructure Architecture to Terraform

Add Terraform export support for the Infrastructure Architecture domain.

Context:
- The tool now has or is gaining a sixth Architecture domain:
  - Infrastructure
- Previous Infrastructure specs introduce:
  - backend Infrastructure model foundation
  - backend Infrastructure API/model persistence integration
  - frontend Infrastructure types/model integration
  - Infrastructure table UI
  - Infrastructure diagram support
  - cross-domain integration
  - Terraform/discovery readiness metadata
- The Infrastructure domain includes V1 entities such as:
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
- The Infrastructure domain also includes relationships such as:
  - Resource hosted in Subnet / Segment
  - Deployment Unit runs on Compute
  - Load Balancer routes to Compute / Resource
- Terraform readiness support includes:
  - IaC Source
  - IaC Resource Binding
  - provenance metadata
  - Terraform hints/readiness fields
- This spec builds on that foundation to generate reviewable Terraform files from the approved Infrastructure model.

Goal:
Allow users to export a selected Infrastructure Architecture target state into a reviewable Terraform draft, starting with GCP as the first implemented provider while keeping the design extensible for other providers later.

Provider scope:
- Build a provider-neutral export framework.
- Implement GCP Terraform generation first.
- Do not hard-code the Infrastructure domain itself to GCP.
- Use provider fields, terraform_resource_hint, terraform_module_hint, provider_resource_type, and related metadata to guide export where available.
- Unsupported providers or unsupported resource types should generate clear TODO comments rather than failing the whole export.

Export user flow:
- User selects a project and architecture.
- User chooses an Infrastructure export action.
- User selects or confirms:
  - Environment
  - Cloud Account / Project / Tenant
  - Location / Site / Region, where applicable
  - provider, initially GCP
- The system generates a Terraform draft artifact.
- User can review and download the generated Terraform as a ZIP.
- The generated artifact should also be saved as a project/architecture artifact if existing artifact patterns support this.

Export output format:
- Generate a downloadable ZIP.
- The ZIP should contain at least:
  - main.tf
  - variables.tf
  - outputs.tf
  - README.md
- If the codebase has an existing artifact/export pattern, use that pattern.
- The generated Terraform should be human-readable and heavily commented.
- Comments should reference the Infrastructure concepts that produced the Terraform blocks.
- Comments should include TODOs for incomplete or ambiguous model data.

Safety boundaries:
- Do not run terraform init.
- Do not run terraform plan.
- Do not run terraform apply.
- Do not call GCP APIs.
- Do not handle cloud credentials.
- Do not attempt to validate against a live cloud account.
- Do not write directly to a Git repository.
- Do not provision infrastructure.
- This feature only generates reviewable Terraform text/files.

GCP export mapping:
Implement initial GCP mappings for the most important Infrastructure concepts.

Environment:
- Export as variables, labels, naming prefixes, and comments.
- Example Terraform usage:
  - var.environment
  - labels = { environment = var.environment }

Cloud Account / Project / Tenant:
- Export as project_id variable and provider configuration.
- Example Terraform usage:
  - variable "project_id"
  - provider "google" { project = var.project_id }

Location / Site / Region:
- Export as region/zone variables where cloud location fields exist.
- Example Terraform usage:
  - variable "region"
  - variable "zone"
  - provider "google" { region = var.region, zone = var.zone }

Network:
- Export GCP VPC networks where network_type/provider indicate a GCP-compatible VPC.
- Example Terraform resource:
  - google_compute_network

Subnet / Network Segment:
- Export GCP subnetworks where network, CIDR, region, and provider context are available.
- Example Terraform resource:
  - google_compute_subnetwork

Compute Cluster / Platform:
- Export GKE cluster resources where platform_type indicates GKE/KUBERNETES and provider is GCP.
- Example Terraform resources:
  - google_container_cluster
  - google_container_node_pool, only if enough fields exist or as TODO scaffold
- For CLOUD_RUN platform, generation may be implicit or documented as comments unless a concrete resource is needed.

Compute Resource:
- Export provider-specific compute/runtime resources where enough fields exist.
- GCP examples:
  - google_compute_instance for VM-style resources
  - google_cloud_run_v2_service for Cloud Run services
  - TODO scaffold/comment for unsupported compute types
- Use Deployment Unit relationships to populate container image or artifact values where available.

Deployment Unit:
- Export as image URI, artifact variable, function source, VM image, or TODO comment depending on the target Compute Resource.
- Deployment Unit itself usually does not become a standalone Terraform resource unless the target platform requires one.
- Use Deployment Unit runs on Compute relationships to place deployment artifact values into compute resources.

Load Balancer / Ingress:
- Export GCP load balancer scaffolding where enough data exists.
- One architecture Load Balancer may expand into multiple Terraform resources.
- GCP examples may include:
  - google_compute_backend_service
  - google_compute_url_map
  - google_compute_target_http_proxy or google_compute_target_https_proxy
  - google_compute_global_forwarding_rule
  - google_compute_region_network_endpoint_group where routing to Cloud Run is supported
- If fields are incomplete, emit TODO comments that preserve the architecture intent.

Listener / Exposure:
- Export as forwarding rule port/protocol, service port, ingress/URL map rule, or comments depending on the parent resource.
- Use protocol, port, host_name, path_pattern, exposure, and certificate_reference where present.

Data Store Instance:
- Export common GCP data store resources where enough fields exist.
- GCP examples:
  - google_sql_database_instance for Cloud SQL-like relational stores
  - google_sql_database where database name is available or inferred
  - google_redis_instance for Redis/Memorystore-like cache
  - TODO scaffold/comment for BigQuery, AlloyDB, or unsupported engines if not implemented.
- Use encrypted, ha_enabled, backup_enabled where available if safe and obvious.
- Avoid inventing production-grade settings when missing; use TODO comments instead.

Infrastructure Resource:
- Export common GCP platform resources where enough fields exist.
- GCP examples:
  - google_storage_bucket for OBJECT_BUCKET
  - google_pubsub_topic for MESSAGE_TOPIC
  - google_pubsub_subscription for MESSAGE_QUEUE where applicable
  - google_redis_instance for CACHE where applicable
  - google_secret_manager_secret for SECRET_STORE
  - google_cloud_scheduler_job for SCHEDULER
  - TODO scaffold/comment for unsupported resource types.
- Do not create secret values.

Resource hosted in Subnet / Segment:
- Use this relationship to set network, subnetwork, private_network, VPC connector, or placement-related Terraform fields where applicable.
- If the target resource type does not directly support subnet placement, emit a helpful comment.

Deployment Unit runs on Compute:
- Use this relationship to populate image/artifact/version/runtime fields on compute resources.
- Example:
  - Cloud Run container image
  - VM image
  - function source
- If multiple deployment units target the same compute resource, generate a warning/TODO comment unless the mapping is unambiguous.

Load Balancer routes to Compute / Resource:
- Use this relationship to generate backend service, NEG/backend group, URL map, target pool, or equivalent routing scaffolding where supported.
- If target resolution is ambiguous or unsupported, emit TODO comments with source and target names.

IaC Source and IaC Resource Binding:
- If IaC Source exists for the selected environment/provider, use it to populate README context and artifact metadata.
- If IaC Resource Bindings exist, use them to preserve stable Terraform addresses where possible.
- If no binding exists for a generated resource, generate a sensible Terraform resource name and optionally mark that a binding could be created later.
- Do not overwrite confirmed IaC Resource Bindings without explicit future workflow support.

Generated comments:
Each generated Terraform block should include comments referencing the architecture model concept, for example:
- Infrastructure concept: Network
- Architecture entity: prod-vpc
- Source model id: <id> where useful and safe
- Environment: prod
- Generated from Infrastructure Architecture export
- TODO comments where required fields are missing

Example comment style:
- Keep comments useful for DevSecOps users who will review the generated Terraform.
- Avoid dumping excessive internal IDs unless useful for traceability.
- Prefer human-readable names plus optional model IDs.

Validation before export:
- Validate that an Environment is selected.
- Validate that provider is selected, initially GCP.
- Validate that required high-level context exists:
  - Cloud Account / Project / Tenant or project_id equivalent
  - Location / Site / Region or region equivalent, where needed
- Validate that entity references used by relationships can be resolved.
- Do not block export for every missing field.
- For incomplete resources, generate TODO comments rather than failing the entire export.
- Return a clear list of warnings to the user.

Backend requirements:
- Add an export service that converts Infrastructure model data into Terraform file contents.
- Add provider-specific exporter structure with GCP as the first implementation.
- Keep exporter design extensible for future AWS/Azure/providers.
- Add an API endpoint for exporting Terraform from a project/architecture Infrastructure model.
- Endpoint should be scoped by projectId and architectureId.
- Endpoint should accept export options such as:
  - environment_id
  - cloud_account_id, optional
  - location_id, optional
  - provider
  - output_format, default ZIP
- Endpoint should return or create a downloadable artifact using existing backend conventions.
- If project artifact support exists, save the generated export artifact with useful metadata.
- Add backend tests for export generation using representative Infrastructure model data.

Frontend requirements:
- Add an Infrastructure Terraform export action in a suitable Infrastructure UI location.
- Let the user select Environment, Cloud Account / Project / Tenant, Location / Site / Region, and provider where applicable.
- Trigger the backend export endpoint.
- Show export warnings/errors in a user-friendly way.
- Allow the user to download the generated ZIP.
- If artifact saving exists, show a link/reference to the saved artifact.
- Do not add a full Terraform editor in this spec.
- Do not add Terraform plan/apply controls.

Generated README.md:
The README should include:
- project/architecture context
- selected environment
- selected provider
- generated timestamp
- list of generated files
- warnings/TODOs
- clear statement that the Terraform is a draft
- clear statement that it has not been planned or applied
- suggested next human review steps

Testing scope:
Backend tests should cover:
- successful GCP export with basic network/subnet/compute/data store resources
- generated ZIP includes main.tf, variables.tf, outputs.tf, README.md
- export includes comments referencing Infrastructure concepts
- export produces TODO comments for incomplete resources
- export does not require Terraform CLI or cloud credentials
- export respects projectId/architectureId scoping
- unsupported provider/resource types produce warnings/TODOs rather than crashing

Frontend tests should cover:
- export action renders where expected
- export request sends selected options
- successful response exposes download flow
- warnings are displayed where returned
- no Terraform plan/apply UI is present

Out of scope:
- Terraform import
- Terraform parser
- Terraform state parsing
- Terraform plan/apply
- Terraform CLI integration
- OpenTofu execution
- Live GCP API calls
- Cloud credentials handling
- Git repository writes
- Automatic pull request creation
- Full module generation strategy
- Complete production-grade GCP landing zone generation
- Security group/firewall/IAM expansion beyond TODO comments where necessary
- Cost estimation
- Drift detection
- Policy/compliance scanning
- Automatic diagram generation from Terraform
- LLM-based Terraform generation unless an existing LLM utility is already used only for comments or suggestions

Acceptance criteria:
- User can export selected Infrastructure Architecture data as a Terraform ZIP.
- Export supports GCP as the first implemented provider.
- Generated ZIP includes main.tf, variables.tf, outputs.tf, and README.md.
- Generated Terraform includes useful comments linking resources back to Infrastructure concepts.
- Generated Terraform includes TODO comments for unsupported or incomplete mappings.
- Export does not run Terraform, call GCP APIs, require credentials, or provision anything.
- Network and Subnet entities can generate basic GCP Terraform resources.
- At least one Compute Resource type can generate a basic GCP Terraform resource or scaffold.
- At least one Data Store Instance type can generate a basic GCP Terraform resource or scaffold.
- At least one Infrastructure Resource type can generate a basic GCP Terraform resource or scaffold.
- Load Balancer / Ingress and Listener / Exposure can generate supported scaffolding or clear TODO comments.
- Relationship data is used where available to improve generated Terraform.
- Export warnings are returned and displayed to the user.
- Existing Infrastructure modelling, table, and diagram behaviours remain unchanged.
