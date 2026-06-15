Add Infrastructure domain frontend types and model integration

Add frontend type and model integration for the new Infrastructure Architecture domain.

Context:
- This repo is the React/TypeScript frontend.
- The backend architecture-model-service is being extended with a sixth Architecture domain: Infrastructure.
- Previous backend specs introduce:
  - InfrastructurePoint
  - 12 Infrastructure entities
  - 3 Infrastructure relationships
  - backend model persistence through MetaModelEntitiesDto and MetaModelRelationshipsDto
- The frontend centralizes architecture model types and related configuration in areas such as:
  - src/types/model.ts
  - src/config/defaults.ts
  - src/config/gridConfigs.ts
  - src/config/relationshipDefinitions.ts
  - existing model API client files
- Existing frontend model load/save behaviour must remain compatible with Business, Application, Data, Behavioural, and UI domains.
- This spec should make the frontend aware of Infrastructure model data, but should not add tables or diagrams yet.

Goal:
Add frontend TypeScript model support, defaults, serialization/deserialization, and API integration for Infrastructure entities and relationships so the frontend can safely load, hold, edit, and save Infrastructure data through the existing architecture model APIs.

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

Frontend type requirements:
- Add TypeScript interfaces/types for all 12 Infrastructure entities.
- Add TypeScript interfaces/types for all 3 Infrastructure relationships.
- Add a TypeScript type/interface for InfrastructurePoint consistent with the backend API shape and existing frontend point abstractions.
- Extend the frontend meta-model entity type/container to include Infrastructure entity arrays.
- Extend the frontend meta-model relationship type/container to include Infrastructure relationship arrays.
- Ensure Infrastructure fields are optional or default-safe where needed so older backend payloads or incomplete payloads do not break the frontend.
- Use naming consistent with the backend JSON contract and existing frontend conventions.

Suggested frontend model fields:

Environment:
- id: string
- name: string
- description?: string
- environment_type?: string
- lifecycle_state?: string
- is_current_state?: boolean
- is_target_state?: boolean
- owner?: string
- criticality?: string
- tags/metadata?: flexible object/map, following existing frontend convention

Cloud Account / Project / Tenant:
- id: string
- environment_id?: string
- name: string
- description?: string
- provider?: string
- external_account_id?: string
- parent_org_id?: string
- billing_owner?: string
- technical_owner?: string
- landing_zone_name?: string
- tags/metadata?: flexible object/map

Location / Site / Region:
- id: string
- environment_id?: string
- cloud_account_id?: string
- name: string
- description?: string
- location_type?: string
- provider?: string
- provider_region_code?: string
- provider_zone_code?: string
- country?: string
- city?: string
- address?: string
- tags/metadata?: flexible object/map

Network:
- id: string
- environment_id?: string
- cloud_account_id?: string
- location_id?: string
- name: string
- description?: string
- network_type?: string
- provider?: string
- cidr?: string
- external_id?: string
- is_shared?: boolean
- routing_mode?: string
- tags/metadata?: flexible object/map

Subnet / Network Segment:
- id: string
- environment_id?: string
- network_id?: string
- location_id?: string
- name: string
- description?: string
- cidr?: string
- subnet_type?: string
- visibility?: string
- provider_region_code?: string
- provider_zone_code?: string
- external_id?: string
- gateway_address?: string
- tags/metadata?: flexible object/map

Compute Cluster / Platform:
- id: string
- environment_id?: string
- cloud_account_id?: string
- location_id?: string
- network_id?: string
- name: string
- description?: string
- platform_type?: string
- provider?: string
- version?: string
- external_id?: string
- owner?: string
- operating_model?: string
- tags/metadata?: flexible object/map

Compute Resource:
- id: string
- environment_id?: string
- cloud_account_id?: string
- location_id?: string
- cluster_id?: string
- name: string
- description?: string
- compute_type?: string
- provider?: string
- hostname?: string
- fqdn?: string
- private_ip?: string
- public_ip?: string
- os?: string
- runtime?: string
- instance_size?: string
- scaling_min?: number
- scaling_max?: number
- external_id?: string
- lifecycle_state?: string
- owner?: string
- tags/metadata?: flexible object/map

Deployment Unit:
- id: string
- application_entity_id?: string
- name: string
- description?: string
- deployment_unit_type?: string
- version?: string
- artifact_uri?: string
- image_name?: string
- image_tag?: string
- source_repository?: string
- source_commit?: string
- build_pipeline?: string
- owner?: string
- tags/metadata?: flexible object/map

Load Balancer / Ingress:
- id: string
- environment_id?: string
- cloud_account_id?: string
- location_id?: string
- network_id?: string
- name: string
- description?: string
- load_balancer_type?: string
- provider?: string
- exposure?: string
- scheme?: string
- dns_name?: string
- ip_address?: string
- external_id?: string
- owner?: string
- tags/metadata?: flexible object/map

Listener / Exposure:
- id: string
- environment_id?: string
- load_balancer_id?: string
- compute_resource_id?: string
- name: string
- description?: string
- protocol?: string
- port?: number
- host_name?: string
- path_pattern?: string
- exposure?: string
- is_public?: boolean
- certificate_reference?: string
- external_id?: string
- tags/metadata?: flexible object/map

Data Store Instance:
- id: string
- environment_id?: string
- cloud_account_id?: string
- location_id?: string
- name: string
- description?: string
- data_store_type?: string
- engine?: string
- engine_version?: string
- provider?: string
- host?: string
- port?: number
- external_id?: string
- encrypted?: boolean
- ha_enabled?: boolean
- backup_enabled?: boolean
- owner?: string
- tags/metadata?: flexible object/map

Infrastructure Resource:
- id: string
- environment_id?: string
- cloud_account_id?: string
- location_id?: string
- name: string
- description?: string
- resource_type?: string
- provider?: string
- provider_resource_type?: string
- endpoint?: string
- external_id?: string
- criticality?: string
- owner?: string
- tags/metadata?: flexible object/map

InfrastructurePoint:
- id: string
- point_type or equivalent discriminator matching backend/API convention
- reference id fields needed to point to one Infrastructure entity
- display/name fields if existing frontend point abstractions include them
- follow the existing ApplicationPoint, BusinessPoint, and DataEntityPoint frontend patterns

Resource hosted in Subnet / Segment:
- id: string
- hosted_resource_point_id or equivalent InfrastructurePoint reference
- subnet_id: string
- environment_id?: string
- relationship_role?: string
- primary_ip?: string
- private_ip?: string
- public_ip?: string
- evidence_source?: string
- confidence?: number
- tags/metadata?: flexible object/map

Deployment Unit runs on Compute:
- id: string
- deployment_unit_id: string
- compute_resource_id: string
- environment_id?: string
- version?: string
- runtime_config?: flexible object/map or string, following API convention
- desired_instances?: number
- min_instances?: number
- max_instances?: number
- deployment_status?: string
- evidence_source?: string
- confidence?: number
- tags/metadata?: flexible object/map

Load Balancer routes to Compute / Resource:
- id: string
- load_balancer_id: string
- listener_id?: string
- target_point_id or equivalent InfrastructurePoint reference
- environment_id?: string
- protocol?: string
- target_port?: number
- host_name?: string
- path_pattern?: string
- routing_type?: string
- weight?: number
- health_check_path?: string
- tags/metadata?: flexible object/map

Defaults and empty state:
- Extend frontend default model state so Infrastructure entity and relationship arrays exist and default to empty arrays.
- Ensure model loading normalizes missing Infrastructure arrays to empty arrays.
- Ensure model saving includes Infrastructure arrays in the same way other domain arrays are included.
- Ensure cloning, resetting, importing, exporting, and local model manipulation utilities preserve Infrastructure fields if those utilities exist.
- Avoid breaking existing saved projects/architectures that do not yet contain Infrastructure data.

API/model integration:
- Update frontend API client types so the architecture model response and request payloads include Infrastructure entities and relationships.
- Ensure existing calls that fetch/save the full model can carry Infrastructure fields end-to-end.
- Ensure API serialization uses the backend JSON names exactly.
- Ensure unknown or missing Infrastructure fields do not crash rendering or save flows.
- Preserve existing behaviour for all non-Infrastructure domains.

Relationship metadata integration:
- Add relationship definitions/configuration for:
  - Resource hosted in Subnet / Segment
  - Deployment Unit runs on Compute
  - Load Balancer routes to Compute / Resource
- Relationship metadata should identify the correct source/target concepts and use InfrastructurePoint where the backend/API model requires it.
- Do not add diagram rendering behaviour in this spec, but ensure the relationship definitions are available for later table and diagram specs.

Configuration integration:
- Add Infrastructure domain/entity metadata to existing frontend config registries where other domains/entities are registered.
- Add labels, singular/plural names, and basic display names for each Infrastructure concept.
- Add basic field metadata only where required by existing frontend patterns.
- Do not create full table column configuration in this spec unless the existing frontend requires it for type registration. Full table UI belongs to the later Infrastructure tables spec.

Out of scope:
- Infrastructure table UI
- Infrastructure diagram UI
- New routes/pages/tabs for Infrastructure
- Gateway changes
- MCP tools
- Discovery-service changes
- Terraform import/export/generation
- Security group/firewall/IAM modelling
- Traffic flow relationship
- Data entity hosted on data store relationship
- Infrastructure resource dependency relationship

Acceptance criteria:
- Frontend TypeScript types include all 12 Infrastructure entities.
- Frontend TypeScript types include all 3 Infrastructure relationships.
- Frontend TypeScript types include InfrastructurePoint in a style consistent with existing point abstractions.
- Full architecture model type includes Infrastructure entity arrays.
- Full architecture model type includes Infrastructure relationship arrays.
- Default/empty model state includes empty Infrastructure arrays.
- Loading an older model payload without Infrastructure fields does not break the frontend.
- Saving a model preserves Infrastructure fields when present.
- Existing non-Infrastructure model load/save behaviour remains unchanged.
- Relationship definitions/configuration include the three Infrastructure relationships.
- No Infrastructure tables, diagrams, Terraform import, Gateway, MCP, or Discovery implementation is included in this spec.
