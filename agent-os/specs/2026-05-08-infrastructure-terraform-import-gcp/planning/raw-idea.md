Import Terraform into Infrastructure Architecture

Add Terraform import support for the Infrastructure Architecture domain.

Context:
- The tool has or is gaining a sixth Architecture domain:
  - Infrastructure
- Previous Infrastructure specs introduce:
  - backend Infrastructure model foundation
  - backend Infrastructure API/model persistence integration
  - frontend Infrastructure types/model integration
  - Infrastructure table UI
  - Infrastructure diagram support
  - cross-domain integration
  - Terraform/discovery readiness metadata
  - Terraform export support
- Infrastructure V1 is used to manually model and diagram high-level cloud/infrastructure architecture.
- Terraform readiness support includes:
  - IaC Source
  - IaC Resource Binding
  - provenance metadata
  - Terraform readiness/hints
- This spec imports Terraform files into reviewable Infrastructure candidates.
- Terraform import should not directly mutate the approved architecture model without user review.

Goal:
Allow users to upload Terraform files or a Terraform ZIP and generate reviewable Infrastructure Architecture candidates, starting with GCP provider mappings while keeping the design extensible for other providers later.

Provider scope:
- Build a provider-neutral import framework.
- Implement GCP Terraform resource classification first.
- Unsupported providers or unsupported resource types should be preserved as evidence/TODO candidates where useful rather than crashing.
- Do not hard-code the Infrastructure domain itself to GCP.

Import user flow:
- User selects a project and architecture.
- User opens an Infrastructure Terraform import action.
- User uploads:
  - one or more `.tf` files, or
  - a ZIP containing Terraform files
- User provides or confirms:
  - Environment, optional but recommended
  - Cloud Account / Project / Tenant, optional
  - Location / Site / Region, optional
  - provider, initially GCP
  - IaC Source details such as repository URL/path/workspace if known
- System parses Terraform files.
- System creates an import review result containing:
  - proposed Infrastructure entities
  - proposed Infrastructure relationships
  - proposed IaC Source
  - proposed IaC Resource Bindings
  - evidence and confidence
  - warnings and unsupported items
- User reviews candidates before applying them to the model.
- User can approve, ignore, or later refine candidates according to existing candidate/review patterns where available.

Safety boundaries:
- Do not run terraform init.
- Do not run terraform plan.
- Do not run terraform apply.
- Do not call GCP APIs.
- Do not handle cloud credentials.
- Do not read remote Terraform state.
- Do not write to Git.
- Do not directly provision infrastructure.
- Do not directly update the approved model unless the user explicitly approves candidates.

Import source support:
- Support uploaded `.tf` files.
- Support uploaded ZIPs containing `.tf` files.
- Ignore non-Terraform files unless needed for README/warnings.
- Do not support Git repo checkout in this spec.
- Do not support Terraform Cloud, remote backends, or live state access in this spec.

Terraform parsing scope:
Parse core Terraform syntax sufficiently to identify:
- resource blocks
- module blocks
- variable blocks
- output blocks
- locals blocks where simple values are useful
- provider blocks where simple provider/project/region data is available
- basic references between resources

Parsing limitations:
- Full Terraform expression evaluation is out of scope.
- Full module expansion is out of scope.
- Full variable interpolation resolution is out of scope.
- Full dependency graph reconstruction is out of scope.
- Complex expressions should be preserved as raw text/evidence where possible.
- Unknown or unresolved values should generate warnings/TODOs, not hard failures.

GCP classification mappings:
Map common GCP Terraform resource types into Infrastructure candidates.

Environment:
- May be inferred from workspace, variable names, labels, resource names, tags, or user-provided import options.
- If uncertain, use the user-selected Environment or create a candidate requiring review.

Cloud Account / Project / Tenant:
- Infer from provider.project, google_project resources, variables such as project_id, labels, or user-provided import options.
- Map to Cloud Account / Project / Tenant candidates.

Location / Site / Region:
- Infer from provider.region, provider.zone, resource region/location fields, variables such as region/zone, or user-provided import options.
- Map to Location / Site / Region candidates.

Network:
- Map `google_compute_network` to Network.
- Preserve name, description, routing mode, external/self-link references where available.

Subnet / Network Segment:
- Map `google_compute_subnetwork` to Subnet / Network Segment.
- Preserve CIDR, region, network reference, gateway address where available.
- Create Resource hosted/placement candidates only where references are clear.

Compute Cluster / Platform:
- Map `google_container_cluster` to Compute Cluster / Platform.
- Optionally map node pools as supporting evidence or TODO comments, not necessarily first-class entities unless the existing model requires them.

Compute Resource:
- Map common compute/runtime resources where feasible:
  - `google_compute_instance`
  - `google_cloud_run_v2_service`
  - `google_cloudfunctions2_function`
  - Kubernetes workload resources if already represented in uploaded Terraform and supported by parser
- Preserve name, provider type, runtime/image hints, region/location, scaling hints where available.

Deployment Unit:
- Infer from container image, VM image, function source, package/artifact fields, or related variables.
- Create Deployment Unit candidates when an artifact/image can be identified.
- Link to Compute Resource candidates through Deployment Unit runs on Compute where confidence is sufficient.

Load Balancer / Ingress:
- Classify common GCP load-balancer-related resources into a high-level Load Balancer / Ingress candidate where possible:
  - forwarding rules
  - backend services
  - URL maps
  - target proxies
  - network endpoint groups
- Do not require perfect GCP load balancer reconstruction.
- Produce a readable candidate and warnings when only partial LB structure is understood.

Listener / Exposure:
- Infer Listener / Exposure candidates from forwarding rule ports, target proxy protocol, URL map host/path rules, service ports, container ports, or ingress-style resources.
- Preserve protocol, port, host_name, path_pattern, and exposure when available.

Data Store Instance:
- Map common GCP data store resources:
  - `google_sql_database_instance`
  - `google_sql_database`
  - `google_redis_instance`
  - BigQuery resources if easily classified
  - AlloyDB resources if easily classified
- Preserve engine/version, region/location, host/connection name, backup/encryption hints where available.

Infrastructure Resource:
- Map common GCP platform resources:
  - `google_storage_bucket`
  - `google_pubsub_topic`
  - `google_pubsub_subscription`
  - `google_secret_manager_secret`
  - `google_cloud_scheduler_job`
  - `google_artifact_registry_repository`
  - CDN or cache resources where easily classified
- Preserve provider_resource_type, endpoint/name, region/location, and external identifiers where available.

Relationship inference:
Infer relationship candidates only when there is direct Terraform evidence.

Resource hosted in Subnet / Segment:
- Infer from subnet/network/private_network/network_interface/VPC connector references where clear.
- Use InfrastructurePoint-compatible references in the candidate model.

Deployment Unit runs on Compute:
- Infer from image/artifact/function source fields on compute resources.
- Link Deployment Unit candidate to Compute Resource candidate.

Load Balancer routes to Compute / Resource:
- Infer from backend service, NEG/backend group, URL map, target pool, or equivalent references where clear.
- If LB reconstruction is incomplete, generate warnings and partial candidates.

IaC Source:
- Create or propose an IaC Source for the import.
- Use user-provided source metadata where available:
  - repository_url
  - branch
  - commit_sha
  - path
  - workspace
  - provider
- If uploaded files do not provide repo metadata, create a local/upload-based IaC Source candidate or metadata record.

IaC Resource Binding:
- For every Terraform resource successfully mapped to an Infrastructure candidate, propose an IaC Resource Binding.
- Binding should include:
  - iac_address
  - iac_resource_type
  - iac_resource_name
  - provider
  - file_path
  - start_line
  - end_line
  - external_id where available
  - confidence
- Bindings should reference InfrastructurePoint candidates or approved Infrastructure entities after user approval.

Candidate/review behaviour:
- Imported Terraform should create reviewable candidates, not directly update approved Infrastructure entities by default.
- Reuse existing discovery candidate/review patterns where feasible.
- Candidates should include:
  - proposed entity or relationship type
  - proposed field values
  - source Terraform address
  - source file path
  - source line range where available
  - evidence snippet or summary
  - confidence
  - warnings
- Users should be able to approve candidates into the Infrastructure model.
- Users should be able to ignore unsupported or unwanted candidates.
- Users should be able to resolve conflicts where imported Terraform matches an existing Infrastructure entity.

Matching to existing model:
- Attempt deterministic matching before creating new candidates:
  - existing IaC Resource Binding by iac_address
  - provider external_id where available
  - exact name match within selected Environment/provider
  - provider_resource_type + name match
- If a match is found, propose update/merge candidate rather than duplicate entity.
- If matching is ambiguous, create a decision task or warning according to existing review patterns.
- Do not silently overwrite existing model records.

LLM usage:
- Prefer deterministic parsing and mapping first.
- Use LLM assistance only for enrichment/suggestions where existing system patterns support it.
- LLM may help with:
  - naming cleanup
  - grouping partial GCP load balancer resources into one high-level Load Balancer / Ingress candidate
  - suggesting relationships from Terraform references
  - explaining unsupported resources
- LLM must not be required for basic import to function.
- LLM output must remain reviewable and should not directly mutate the approved model.

Backend requirements:
- Add a Terraform import service that accepts uploaded Terraform files/ZIPs.
- Add a parser/classifier layer that extracts Terraform blocks and maps supported GCP resource types to Infrastructure candidates.
- Add an API endpoint scoped by projectId and architectureId for Terraform import.
- Endpoint should accept upload files and import options.
- Endpoint should return an import review result or create a review/import run using existing patterns.
- Include warnings for unsupported resource types and unresolved references.
- Preserve source evidence such as file path, Terraform address, line range, and raw snippets where practical.
- Add tests for parsing and mapping representative GCP Terraform resources.
- Add tests showing import does not require Terraform CLI, cloud credentials, or GCP API calls.

Frontend requirements:
- Add an Infrastructure Terraform import action in a suitable Infrastructure UI location.
- Allow user to upload `.tf` files or ZIP.
- Allow user to provide/confirm import options:
  - Environment
  - Cloud Account / Project / Tenant
  - Location / Site / Region
  - provider
  - IaC Source metadata where applicable
- Display import results as reviewable candidates.
- Show warnings and unsupported resource summaries.
- Allow user to approve or ignore candidates if existing review UI patterns support this.
- If no existing review UI is reusable, show the import result in a simple review table and defer advanced approval workflow to a later spec.
- Do not add Terraform editing, plan, or apply UI.

Generated/updated model data after approval:
Approving candidates should be able to create or update:
- Infrastructure entities
- Infrastructure relationships
- IaC Source
- IaC Resource Binding
- provenance metadata
- Terraform readiness/hint fields where useful

Approval should preserve projectId and architectureId scoping.

User-facing warnings:
Warn users when:
- Terraform resource type is unsupported
- required values are unresolved variables or expressions
- module expansion is not performed
- resource relationship is ambiguous
- resource appears to match multiple existing Infrastructure entities
- imported data may be partial
- no Terraform plan/apply has been run

Testing scope:
Backend tests should cover:
- parsing uploaded `.tf` file content
- parsing uploaded ZIP content
- mapping `google_compute_network` to Network candidate
- mapping `google_compute_subnetwork` to Subnet candidate
- mapping at least one compute resource to Compute Resource candidate
- mapping at least one data store resource to Data Store Instance candidate
- mapping at least one infrastructure resource to Infrastructure Resource candidate
- producing IaC Resource Binding candidates
- producing warnings for unsupported resources
- no Terraform CLI execution
- no cloud API calls
- projectId/architectureId scoping

Frontend tests should cover:
- Terraform import action renders where expected
- upload request includes files and selected options
- import results/warnings are displayed
- approve/ignore actions are available if review UI is implemented
- no Terraform plan/apply UI is present

Out of scope:
- Terraform export
- Terraform CLI execution
- terraform init/plan/apply
- Terraform state parsing
- Remote backend access
- Git repository checkout
- Terraform Cloud integration
- Live GCP API calls
- Cloud credential handling
- Full Terraform expression evaluation
- Full module expansion
- Complete dependency graph reconstruction
- Automatic direct mutation of approved model without review
- Full cloud load balancer reconstruction
- Cost estimation
- Drift detection
- Policy/compliance scanning
- Security/IAM/firewall expansion beyond preserving unsupported evidence
- Automatic diagram generation from imported Terraform
- Pull request creation
- Production-grade Terraform validation

Acceptance criteria:
- User can upload `.tf` files or a Terraform ZIP for import.
- Import supports GCP as the first implemented provider.
- Import parses Terraform resource blocks and produces Infrastructure candidates.
- Import maps common GCP network resources to Network/Subnet candidates.
- Import maps at least one compute resource type to Compute Resource candidates.
- Import maps at least one data store resource type to Data Store Instance candidates.
- Import maps at least one platform resource type to Infrastructure Resource candidates.
- Import proposes IaC Source and IaC Resource Binding data.
- Import preserves evidence such as Terraform address, file path, and line range where practical.
- Import produces warnings for unsupported or unresolved Terraform resources.
- Import does not run Terraform, call GCP APIs, require credentials, or provision anything.
- Imported candidates are reviewable before being applied to the approved Infrastructure model.
- Approval creates or updates Infrastructure model records using existing project/architecture scoping.
- Existing Infrastructure modelling, table, diagram, and export behaviours remain unchanged.
