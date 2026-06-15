Add Infrastructure domain backend model foundation

Add the backend model foundation for a sixth Architecture domain: Infrastructure.

Context:
- This repo is the Spring Boot architecture-model-service.
- The existing meta-model is loaded/saved through MetaModelEntitiesDto, MetaModelRelationshipsDto, and ModelService.
- The backend already has polymorphic point/supertype patterns:
  - ApplicationPointEntity / ApplicationPointDto
  - BusinessPointEntity / BusinessPointDto
  - DataEntityPointEntity / DataEntityPointDto
- Infrastructure should follow this existing approach by introducing a new polymorphic supertype:
  - InfrastructurePointEntity
  - InfrastructurePointDto
- Infrastructure records must be scoped consistently with the existing project + architecture model.
- Existing APIs use routes such as:
  - /api/model/projects/{projectId}/architectures/{architectureId}
  - /api/model/projects/{projectId}/architectures/{architectureId}/entities

Goal:
Introduce the backend persistence/model foundation for an Infrastructure Architecture domain that can support V1 infrastructure/cloud diagramming and later Terraform/GCP-assisted generation.

Type guidance:
- Conceptual data types are included for new attributes to help avoid ambiguity.
- For enum/string attributes, use the suggested values as guidance but preserve existing project conventions.
- For tags/metadata, follow the existing codebase convention for flexible metadata fields if one exists.

Infrastructure V1 concepts to model:

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

New polymorphic infrastructure point:
- Add InfrastructurePoint as the infrastructure-domain equivalent of ApplicationPoint, BusinessPoint, and DataEntityPoint.
- It should allow infrastructure relationships to reference multiple infrastructure entity types without introducing ad-hoc source_type/source_id columns everywhere.
- At minimum, InfrastructurePoint must be able to reference:
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
- Use the same style as the existing point abstractions wherever possible.

Suggested entity attributes:
All new entities should include the project/architecture scoping fields and standard audit/metadata fields used elsewhere in the service. Follow existing entity conventions rather than inventing a new base class unless the codebase already has one.

Environment:
- name: string
- description: text, nullable
- environment_type: enum/string, suggested values DEV, TEST, STAGING, PROD, DR, CURRENT_STATE, TARGET_STATE, OTHER
- lifecycle_state: enum/string, suggested values PLANNED, ACTIVE, DEPRECATED, RETIRED
- is_current_state: boolean
- is_target_state: boolean
- owner: string, nullable
- criticality: enum/string, suggested values LOW, MEDIUM, HIGH, CRITICAL, nullable
- tags/metadata: object/map, nullable, following existing convention

Cloud Account / Project / Tenant:
- environment FK -> Environment
- name: string
- description: text, nullable
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER
- external_account_id: string, nullable
- parent_org_id: string, nullable
- billing_owner: string, nullable
- technical_owner: string, nullable
- landing_zone_name: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Location / Site / Region:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- name: string
- description: text, nullable
- location_type: enum/string, suggested values CLOUD_REGION, CLOUD_ZONE, DATA_CENTRE, OFFICE, EDGE_SITE, OTHER
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- provider_region_code: string, nullable
- provider_zone_code: string, nullable
- country: string, nullable
- city: string, nullable
- address: text, nullable
- tags/metadata: object/map, nullable, following existing convention

Network:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- location FK -> Location / Site / Region, nullable
- name: string
- description: text, nullable
- network_type: enum/string, suggested values VPC, VNET, ON_PREM_NETWORK, LAN, WAN, OTHER
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- cidr: string, nullable
- external_id: string, nullable
- is_shared: boolean
- routing_mode: enum/string, suggested values REGIONAL, GLOBAL, STATIC, DYNAMIC, OTHER, nullable
- tags/metadata: object/map, nullable, following existing convention

Subnet / Network Segment:
- environment FK -> Environment
- network FK -> Network
- location FK -> Location / Site / Region, nullable
- name: string
- description: text, nullable
- cidr: string, nullable
- subnet_type: enum/string, suggested values PUBLIC, PRIVATE, APP, DATA, MANAGEMENT, DMZ, OTHER
- visibility: enum/string, suggested values PUBLIC, PRIVATE, ISOLATED, INTERNAL, OTHER
- provider_region_code: string, nullable
- provider_zone_code: string, nullable
- external_id: string, nullable
- gateway_address: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Compute Cluster / Platform:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- location FK -> Location / Site / Region, nullable
- network FK -> Network, nullable
- name: string
- description: text, nullable
- platform_type: enum/string, suggested values GKE, KUBERNETES, CLOUD_RUN, VMWARE, OPENSHIFT, SERVER_FARM, OTHER
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- version: string, nullable
- external_id: string, nullable
- owner: string, nullable
- operating_model: enum/string, suggested values MANAGED, SELF_MANAGED, HYBRID, OTHER, nullable
- tags/metadata: object/map, nullable, following existing convention

Compute Resource:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- location FK -> Location / Site / Region, nullable
- cluster FK -> Compute Cluster / Platform, nullable
- name: string
- description: text, nullable
- compute_type: enum/string, suggested values VM, PHYSICAL_SERVER, CONTAINER_SERVICE, KUBERNETES_WORKLOAD, SERVERLESS_FUNCTION, CLOUD_RUN_SERVICE, BATCH_JOB, OTHER
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- hostname: string, nullable
- fqdn: string, nullable
- private_ip: string, nullable
- public_ip: string, nullable
- os: string, nullable
- runtime: string, nullable
- instance_size: string, nullable
- scaling_min: integer, nullable
- scaling_max: integer, nullable
- external_id: string, nullable
- lifecycle_state: enum/string, suggested values PLANNED, ACTIVE, DEPRECATED, RETIRED, UNKNOWN, nullable
- owner: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Deployment Unit:
- application_entity FK -> existing Application-domain entity/service, nullable if feasible in the existing model
- name: string
- description: text, nullable
- deployment_unit_type: enum/string, suggested values CONTAINER_IMAGE, VM_IMAGE, FUNCTION_BUNDLE, JAR, WAR, STATIC_BUNDLE, PACKAGE, OTHER
- version: string, nullable
- artifact_uri: string, nullable
- image_name: string, nullable
- image_tag: string, nullable
- source_repository: string, nullable
- source_commit: string, nullable
- build_pipeline: string, nullable
- owner: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Load Balancer / Ingress:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- location FK -> Location / Site / Region, nullable
- network FK -> Network, nullable
- name: string
- description: text, nullable
- load_balancer_type: enum/string, suggested values EXTERNAL_HTTP, EXTERNAL_HTTPS, INTERNAL_HTTP, INTERNAL_TCP, INGRESS_CONTROLLER, F5, NGINX, API_GATEWAY, OTHER
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- exposure: enum/string, suggested values PUBLIC, PRIVATE, INTERNAL, OTHER
- scheme: string, nullable
- dns_name: string, nullable
- ip_address: string, nullable
- external_id: string, nullable
- owner: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Listener / Exposure:
- environment FK -> Environment
- load_balancer FK -> Load Balancer / Ingress, nullable
- compute_resource FK -> Compute Resource, nullable
- name: string
- description: text, nullable
- protocol: enum/string, suggested values HTTP, HTTPS, TCP, UDP, TLS, GRPC, OTHER
- port: integer, nullable
- host_name: string, nullable
- path_pattern: string, nullable
- exposure: enum/string, suggested values PUBLIC, PRIVATE, INTERNAL, OTHER
- is_public: boolean
- certificate_reference: string, nullable
- external_id: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Data Store Instance:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- location FK -> Location / Site / Region, nullable
- name: string
- description: text, nullable
- data_store_type: enum/string, suggested values RELATIONAL_DB, DOCUMENT_DB, KEY_VALUE, CACHE, DATA_WAREHOUSE, OBJECT_STORAGE_AS_DATASTORE, OTHER
- engine: enum/string, suggested values POSTGRES, MYSQL, ORACLE, SQLSERVER, BIGQUERY, REDIS, MONGODB, OTHER, nullable
- engine_version: string, nullable
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- host: string, nullable
- port: integer, nullable
- external_id: string, nullable
- encrypted: boolean
- ha_enabled: boolean
- backup_enabled: boolean
- owner: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Infrastructure Resource:
- environment FK -> Environment
- cloud_account FK -> Cloud Account / Project / Tenant, nullable
- location FK -> Location / Site / Region, nullable
- name: string
- description: text, nullable
- resource_type: enum/string, suggested values OBJECT_BUCKET, MESSAGE_TOPIC, MESSAGE_QUEUE, CACHE, SECRET_STORE, SCHEDULER, EVENT_BUS, CDN, REGISTRY, OTHER
- provider: enum/string, suggested values GCP, AWS, AZURE, ON_PREM, OTHER, nullable
- provider_resource_type: string, nullable, e.g. google_storage_bucket, google_pubsub_topic
- endpoint: string, nullable
- external_id: string, nullable
- criticality: enum/string, suggested values LOW, MEDIUM, HIGH, CRITICAL, nullable
- owner: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Relationship shapes:
Use the existing relationship table/entity patterns where possible.

Resource hosted in Subnet / Segment:
- source/hosted resource should be represented through InfrastructurePoint if feasible
- subnet FK -> Subnet / Network Segment
- environment FK -> Environment
- relationship_role: enum/string, suggested values PRIMARY_PLACEMENT, PRIVATE_CONNECTIVITY, BACKEND_PLACEMENT, OTHER
- primary_ip: string, nullable
- private_ip: string, nullable
- public_ip: string, nullable
- evidence_source: string, nullable
- confidence: decimal, nullable, suggested range 0.0 to 1.0
- tags/metadata: object/map, nullable, following existing convention

Deployment Unit runs on Compute:
- deployment_unit FK -> Deployment Unit
- compute_resource FK -> Compute Resource
- environment FK -> Environment
- version: string, nullable
- runtime_config: object/map or text, nullable, following existing convention
- desired_instances: integer, nullable
- min_instances: integer, nullable
- max_instances: integer, nullable
- deployment_status: enum/string, suggested values PLANNED, DEPLOYED, DEPRECATED, FAILED, UNKNOWN, nullable
- evidence_source: string, nullable
- confidence: decimal, nullable, suggested range 0.0 to 1.0
- tags/metadata: object/map, nullable, following existing convention

Load Balancer routes to Compute / Resource:
- load_balancer FK -> Load Balancer / Ingress
- listener FK -> Listener / Exposure, nullable
- target should be represented through InfrastructurePoint if feasible
- environment FK -> Environment
- protocol: enum/string, suggested values HTTP, HTTPS, TCP, UDP, TLS, GRPC, OTHER, nullable
- target_port: integer, nullable
- host_name: string, nullable
- path_pattern: string, nullable
- routing_type: enum/string, suggested values DEFAULT, HOST_BASED, PATH_BASED, WEIGHTED, FAILOVER, OTHER, nullable
- weight: integer, nullable
- health_check_path: string, nullable
- tags/metadata: object/map, nullable, following existing convention

Backend integration requirements:
- Add DTOs for all new infrastructure entities and relationships.
- Add JPA entities for all new infrastructure entities and relationships.
- Add repositories following existing repository conventions.
- Add mapping logic consistent with the current ModelService and DTO/entity mapping style.
- Extend MetaModelEntitiesDto with infrastructure entity lists using snake_case JSON names.
- Extend MetaModelRelationshipsDto with the three infrastructure relationship lists using snake_case JSON names.
- Ensure save/load of the full model includes the new Infrastructure domain data.
- Ensure delete/replace/update semantics match existing ModelService behaviour for other domains.
- Ensure projectId and architectureId scoping is preserved and enforced consistently.
- Add Liquibase migration(s) or equivalent migration files following the existing migration style.
- Add validation only where the existing backend already applies validation patterns. Do not overbuild validation in this spec.

Suggested JSON names:
Entities:
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

Relationships:
- resource_subnet_hostings
- deployment_unit_compute_resources
- load_balancer_resource_routes

Naming note:
If existing naming conventions suggest different names, prefer consistency with the codebase over these suggested names. However, keep the product meaning intact.

Out of scope:
- Frontend TypeScript types
- Frontend tables
- Frontend diagrams
- Gateway changes
- MCP tools
- Discovery-service changes
- Terraform parsing/import/export
- GCP-specific provisioning
- Security group/firewall/IAM modelling
- Data entity hosted on data store relationship
- Traffic flow relationship
- Infrastructure resource dependency relationship

Acceptance criteria:
- The backend can persist and return the new Infrastructure entities as part of the architecture meta-model.
- The backend can persist and return the three Infrastructure relationships as part of the architecture meta-model.
- InfrastructurePoint exists and follows the same architectural style as the existing point/supertype abstractions.
- Infrastructure relationships can use InfrastructurePoint where polymorphic infrastructure references are required.
- Existing Business, Application, Data, Behavioural, and UI model load/save behavior remains unchanged.
- Existing tests continue to pass.
- New backend tests cover basic save/load round trip for the Infrastructure domain model.
- New backend tests cover at least one relationship that references InfrastructurePoint polymorphically.
- Migrations create the required persistence structures without breaking existing data.
- Terraform import/generation is left for a later spec.
