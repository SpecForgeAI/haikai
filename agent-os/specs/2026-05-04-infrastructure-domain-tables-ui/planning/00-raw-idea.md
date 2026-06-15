Add Infrastructure domain tables UI

Add table-based UI support for the new Infrastructure Architecture domain.

Context:
- This repo is the React/TypeScript frontend.
- Previous specs introduce Infrastructure backend model support and frontend model/type integration.
- The frontend already has table/grid-style editing for existing architecture domains.
- Relevant frontend areas may include:
  - src/types/model.ts
  - src/config/gridConfigs.ts
  - src/config/defaults.ts
  - src/config/relationshipDefinitions.ts
  - existing domain table components/views
  - existing model save/load flows
- Infrastructure V1 should be manually modelable before diagram automation or Terraform import exists.
- This spec is for Infrastructure table UI only. Diagram support comes later.

Goal:
Allow users to view, create, edit, and delete Infrastructure Architecture entities and relationships using table/grid UI consistent with the existing domain modelling experience.

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

User experience:
- Add Infrastructure as a first-class domain in the model/table UI alongside Business, Application, Data, Behavioural, and UI.
- Users should be able to open an Infrastructure area/tab/section and see the Infrastructure entities and relationships.
- The UI should follow existing domain/table conventions rather than introducing a different editing pattern.
- Users should be able to manually add, edit, and delete Infrastructure records.
- Relationship tables should allow users to select valid source/target records from the appropriate Infrastructure records.
- Infrastructure tables should be scoped to the selected project and architecture through existing model state.
- Table changes should participate in the existing model save/update flow.

Entity table requirements:
Add table/grid configuration and editing support for the 12 Infrastructure entities.

Environment table:
- Primary display fields:
  - name
  - environment_type
  - lifecycle_state
  - is_current_state
  - is_target_state
  - owner
  - criticality
  - description

Cloud Account / Project / Tenant table:
- Primary display fields:
  - name
  - environment_id
  - provider
  - external_account_id
  - parent_org_id
  - billing_owner
  - technical_owner
  - landing_zone_name
  - description

Location / Site / Region table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_type
  - provider
  - provider_region_code
  - provider_zone_code
  - country
  - city
  - description

Network table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_id
  - network_type
  - provider
  - cidr
  - is_shared
  - routing_mode
  - description

Subnet / Network Segment table:
- Primary display fields:
  - name
  - environment_id
  - network_id
  - location_id
  - cidr
  - subnet_type
  - visibility
  - provider_region_code
  - provider_zone_code
  - gateway_address
  - description

Compute Cluster / Platform table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_id
  - network_id
  - platform_type
  - provider
  - version
  - operating_model
  - owner
  - description

Compute Resource table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_id
  - cluster_id
  - compute_type
  - provider
  - hostname
  - private_ip
  - public_ip
  - runtime
  - instance_size
  - scaling_min
  - scaling_max
  - lifecycle_state
  - owner
  - description

Deployment Unit table:
- Primary display fields:
  - name
  - application_entity_id
  - deployment_unit_type
  - version
  - artifact_uri
  - image_name
  - image_tag
  - source_repository
  - source_commit
  - build_pipeline
  - owner
  - description

Load Balancer / Ingress table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_id
  - network_id
  - load_balancer_type
  - provider
  - exposure
  - scheme
  - dns_name
  - ip_address
  - owner
  - description

Listener / Exposure table:
- Primary display fields:
  - name
  - environment_id
  - load_balancer_id
  - compute_resource_id
  - protocol
  - port
  - host_name
  - path_pattern
  - exposure
  - is_public
  - certificate_reference
  - description

Data Store Instance table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_id
  - data_store_type
  - engine
  - engine_version
  - provider
  - host
  - port
  - encrypted
  - ha_enabled
  - backup_enabled
  - owner
  - description

Infrastructure Resource table:
- Primary display fields:
  - name
  - environment_id
  - cloud_account_id
  - location_id
  - resource_type
  - provider
  - provider_resource_type
  - endpoint
  - external_id
  - criticality
  - owner
  - description

Relationship table requirements:
Add table/grid configuration and editing support for the three Infrastructure relationships.

Resource hosted in Subnet / Segment table:
- Users should select the hosted resource using InfrastructurePoint-compatible selection.
- Users should select the subnet/network segment from Subnet / Network Segment records.
- Primary display fields:
  - hosted resource
  - subnet_id
  - environment_id
  - relationship_role
  - primary_ip
  - private_ip
  - public_ip
  - evidence_source
  - confidence

Deployment Unit runs on Compute table:
- Users should select a Deployment Unit.
- Users should select a Compute Resource.
- Primary display fields:
  - deployment_unit_id
  - compute_resource_id
  - environment_id
  - version
  - desired_instances
  - min_instances
  - max_instances
  - deployment_status
  - evidence_source
  - confidence

Load Balancer routes to Compute / Resource table:
- Users should select a Load Balancer / Ingress.
- Users may select a Listener / Exposure.
- Users should select a target resource using InfrastructurePoint-compatible selection.
- Primary display fields:
  - load_balancer_id
  - listener_id
  - target resource
  - environment_id
  - protocol
  - target_port
  - host_name
  - path_pattern
  - routing_type
  - weight
  - health_check_path

Lookup/select behaviour:
- FK fields should use dropdown/select behaviour where existing table UI supports it.
- Select labels should show human-readable names, not raw IDs, wherever existing frontend patterns allow.
- The selection options should be constrained to records from the current project/architecture model state.
- InfrastructurePoint-based selections should allow the user to choose from the valid infrastructure entity types for that relationship.
- Application-domain selection for Deployment Unit.application_entity_id should reuse existing Application entity/service lookup patterns if available.
- If a referenced record is missing, the table should degrade gracefully and display a safe fallback.

Field editing:
- String/text fields should use existing text editing patterns.
- Boolean fields should use existing checkbox/toggle patterns.
- Numeric fields should use existing numeric editing patterns.
- Enum/string fields may use free text or select options depending on existing table conventions.
- Description and long text fields should follow existing multiline editing conventions if available.
- Tags/metadata should only be exposed if existing tables already provide a suitable metadata editing pattern; otherwise it can remain hidden from V1 table UI.

Navigation/placement:
- Add Infrastructure to the existing domain navigation, tabs, or section list where users access Business/Application/Data/Behavioural/UI model tables.
- Keep Infrastructure clearly separate from diagrams. Users should be able to manage Infrastructure records without opening a diagram.
- If existing UI groups entities and relationships separately, follow that convention for Infrastructure.
- If existing UI uses one combined model editor, add Infrastructure sections there consistently.

Model save/load integration:
- Creating/editing/deleting Infrastructure table rows should update the frontend model state.
- Infrastructure changes should be included in the existing save flow.
- Loading an architecture with Infrastructure data should populate the Infrastructure tables.
- Loading an architecture without Infrastructure data should show empty Infrastructure tables rather than errors.
- Existing non-Infrastructure domain table behaviour must remain unchanged.

Validation and guardrails:
- Required fields should follow the same validation style used by existing model tables.
- At minimum, new records should have a name where the concept is an entity with a name.
- Relationship records should prevent obviously invalid empty source/target references where existing table validation supports this.
- Do not add heavy validation or cloud-provider-specific validation in this spec.
- Do not require GCP-specific values; the Infrastructure model should remain provider-neutral.

Out of scope:
- Infrastructure diagram rendering
- Infrastructure diagram palette/shapes
- Terraform import/export/generation
- Discovery-service integration
- Gateway changes
- MCP tools
- Security group/firewall/IAM modelling
- Traffic flow relationship
- Data entity hosted on data store relationship
- Infrastructure resource dependency relationship
- Advanced validation against real cloud provider constraints
- Automatic diagram generation from table rows

Acceptance criteria:
- Infrastructure appears as a first-class domain/section in the model table UI.
- Users can view, add, edit, and delete the 12 Infrastructure entity types.
- Users can view, add, edit, and delete the 3 Infrastructure relationship types.
- FK fields use human-readable lookup/select behaviour where existing UI patterns support it.
- InfrastructurePoint-compatible relationship fields allow valid infrastructure target selection.
- Infrastructure table edits update frontend model state.
- Infrastructure table edits are included in the existing model save flow.
- Existing architectures without Infrastructure data load without errors and show empty Infrastructure tables.
- Existing Business, Application, Data, Behavioural, and UI table behaviour remains unchanged.
- No diagram, Terraform, Gateway, MCP, or Discovery implementation is included in this spec.
