Add Infrastructure domain diagram support

Add diagram support for the new Infrastructure Architecture domain.

Context:
- This repo is the React/TypeScript frontend.
- Previous specs introduce Infrastructure backend model support, frontend model/type integration, and Infrastructure table UI.
- Infrastructure V1 includes 12 entity types and 3 relationship types.
- The frontend already supports architecture diagrams through existing diagram components and configuration.
- Relevant frontend areas may include:
  - src/types/model.ts
  - diagram-related types/constants
  - DiagramsView
  - PalettePanel
  - Canvas
  - SelectionInspector
  - diagram serialization/deserialization helpers
  - shape/edge rendering configuration
- Infrastructure diagram support should follow existing diagram conventions instead of introducing a separate diagram engine.

Goal:
Allow users to create and edit Infrastructure Architecture diagrams that visualize the key high-level cloud/infrastructure concepts needed for target-state agreement.

Primary V1 diagram type:
- Infrastructure Architecture Diagram

The V1 diagram should support high-level architecture agreement for:
- cloud target-state infrastructure
- provider-neutral infrastructure topology
- GCP-style infrastructure examples
- hybrid/on-prem concepts where manually entered
- application deployment placement at a high level

The V1 diagram should prioritize showing:
- environment/context
- cloud account/project/tenant boundary
- location/site/region grouping
- network and subnet structure
- compute/runtime resources
- deployment units where useful
- load balancers/ingress and listeners
- data store instances
- important infrastructure resources
- routing from load balancers to backend resources
- resource placement in subnet/network segment

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

Diagram creation and navigation:
- Users should be able to create an Infrastructure Architecture Diagram from the existing diagram creation flow.
- Users should be able to open, edit, save, and delete Infrastructure diagrams using existing diagram lifecycle patterns.
- Infrastructure diagrams should be scoped to the selected project and architecture.
- Infrastructure diagrams should appear alongside other diagram types in existing diagram navigation/listing.
- Existing diagram types and diagram data must remain backward compatible.

Palette support:
Add Infrastructure shapes to the diagram palette for:
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

Palette behaviour:
- Shapes should have clear human-readable labels.
- Shapes should be grouped under an Infrastructure palette/category.
- Adding a shape should either create or reference the corresponding Infrastructure model entity according to existing diagram conventions.
- If existing diagrams support dragging existing model entities onto the canvas, Infrastructure entities should be available in the same way.
- If existing diagrams create new model entities from palette shapes, Infrastructure shapes should follow that convention.
- Infrastructure shape creation should not require cloud-provider-specific fields.

Shape rendering:
- Each Infrastructure entity type should have a visually distinguishable shape/icon/label treatment.
- The visual design should fit the existing diagram style.
- Containers/boundaries should be visually suitable for:
  - Environment
  - Cloud Account / Project / Tenant
  - Location / Site / Region
  - Network
  - Subnet / Network Segment
  - Compute Cluster / Platform
- Node-like shapes should be visually suitable for:
  - Compute Resource
  - Deployment Unit
  - Load Balancer / Ingress
  - Listener / Exposure
  - Data Store Instance
  - Infrastructure Resource
- Labels should prefer the entity name and show compact secondary metadata where useful.
- Useful secondary labels may include:
  - provider
  - region/location
  - CIDR
  - compute_type
  - platform_type
  - protocol/port
  - data_store_type/engine
  - resource_type
  - exposure
- Avoid overcrowding the diagram with too many attributes by default.

Container and grouping behaviour:
- Infrastructure diagrams should support logical nesting/grouping where the existing diagram engine allows it.
- The desired visual grouping hierarchy is:
  - Environment
    - Cloud Account / Project / Tenant
      - Location / Site / Region
        - Network
          - Subnet / Network Segment
            - Compute Resource
            - Data Store Instance
            - Infrastructure Resource
            - Load Balancer / Ingress where appropriate
        - Compute Cluster / Platform where appropriate
- This hierarchy is guidance for layout and grouping, not a requirement to force all shapes into one rigid hierarchy.
- The diagram should support manually arranging shapes when automatic grouping does not fit.
- Resource hosted in Subnet / Segment should help place or visually associate resources with a subnet/segment.
- The diagram should not require a complete hierarchy before a resource can be shown.

Edge/relationship rendering:
Add diagram edge support for the three Infrastructure relationships:

Resource hosted in Subnet / Segment:
- Visual purpose: show placement of a resource in a subnet/network segment.
- Preferred rendering:
  - containment/grouping if the diagram supports it
  - otherwise a subtle placement edge
- Label examples:
  - hosted in
  - private connectivity
  - primary placement

Deployment Unit runs on Compute:
- Visual purpose: show artifact/package/image running on a compute resource.
- Preferred rendering:
  - nested/attached label if supported
  - otherwise a directed edge from Deployment Unit to Compute Resource
- Label examples:
  - runs on
  - deployed as
  - version

Load Balancer routes to Compute / Resource:
- Visual purpose: show ingress/backend routing.
- Preferred rendering:
  - directed edge from Load Balancer / Ingress or Listener / Exposure to target resource
- Label examples:
  - routes to
  - HTTP 8080
  - HTTPS 443
  - host/path if available

Relationship selection:
- Users should be able to draw/create Infrastructure relationships from the diagram using existing edge creation conventions.
- Edge creation should update the underlying model relationship list.
- Existing Infrastructure relationships from model data should render as diagram edges or containment where applicable.
- Relationship endpoints should resolve through InfrastructurePoint where required by the backend/frontend model.
- Invalid relationship endpoints should be prevented where existing diagram patterns support validation.
- Missing/deleted referenced entities should degrade gracefully.

Selection inspector:
- Selecting an Infrastructure shape should show editable fields using the existing inspector pattern.
- Selecting an Infrastructure relationship edge should show editable relationship fields using the existing inspector pattern.
- Inspector fields should prioritize the same fields used in the Infrastructure table UI.
- The inspector should allow editing key display-driving fields such as:
  - name
  - description
  - provider
  - type/category fields
  - CIDR
  - protocol
  - port
  - exposure
  - host/path
  - version
- Changes made in the inspector should update the frontend model state and save through the existing save flow.

Diagram serialization:
- Infrastructure diagram nodes and edges should serialize/deserialize consistently with existing diagram storage.
- Diagram nodes should maintain references to the underlying Infrastructure model entities.
- Diagram edges should maintain references to the underlying Infrastructure relationships where applicable.
- Existing diagrams should continue to load without requiring Infrastructure data.
- Infrastructure diagrams should survive save/reload round trips.

Initial layout support:
- Provide a reasonable default placement/layout when users add Infrastructure shapes manually.
- If existing diagrams support auto-layout or generated layouts, add basic support for Infrastructure diagrams.
- The initial V1 layout only needs to be good enough for high-level architecture agreement.
- Avoid building complex cloud-specific layout automation in this spec.

Provider-neutral design:
- Shapes and labels should remain provider-neutral.
- GCP examples may influence labels and metadata, but the diagram should also support AWS, Azure, on-prem, and other providers.
- Do not hard-code GCP-specific diagram behaviour.
- Do not require Terraform data to create or edit diagrams.

Out of scope:
- Terraform import/export/generation
- Automatic diagram generation from Terraform
- Discovery-service integration
- Gateway changes
- MCP tools
- Security group/firewall/IAM diagramming
- Traffic Flow relationship
- Infrastructure Resource dependency relationship
- Data entity hosted on Data Store relationship
- Detailed network routing/firewall visualization
- Live cloud inventory integration
- Cost, monitoring, IAM, policy, or compliance views
- Advanced automatic layout beyond existing diagram capabilities

Acceptance criteria:
- Users can create an Infrastructure Architecture Diagram.
- Infrastructure Architecture Diagrams can be opened, edited, saved, reloaded, and deleted.
- The Infrastructure palette/category includes shapes for all 12 Infrastructure entity types.
- Infrastructure shapes can be added to the canvas using existing diagram interaction patterns.
- Infrastructure shapes reference or create underlying Infrastructure model entities consistently with existing diagram behaviour.
- Infrastructure diagrams support the three V1 Infrastructure relationships.
- Resource hosted in Subnet / Segment can be visualized as containment/grouping or a placement edge.
- Deployment Unit runs on Compute can be visualized as nesting/attachment or an edge.
- Load Balancer routes to Compute / Resource can be visualized as a directed routing edge.
- Selecting Infrastructure shapes and edges shows editable details in the existing inspector pattern.
- Diagram save/reload preserves Infrastructure shapes, edges, and model references.
- Existing non-Infrastructure diagrams continue to work unchanged.
- No Terraform, Gateway, MCP, Discovery, security/IAM/firewall, or live cloud integration is included in this spec.
