# Product Mission

## Pitch

Architecture Capture & Diagram Tool is an internal utility that helps architects, technical leads, and domain owners capture, explore, and visualize enterprise architecture by providing a structured meta-model with diagram rendering capabilities, eliminating scattered documentation and enabling consistent, queryable architecture views.

## Users

### Primary Customers

- **Architects and Senior Engineers**: Need to maintain and communicate architecture decisions across business, application, and data domains
- **Technical Leads**: Preparing architecture reviews and need quick access to system relationships
- **Domain Owners**: Want consistent, up-to-date views of their domain architecture

### User Personas

**Enterprise Architect** (35-55)
- **Role:** Senior architect responsible for cross-domain architecture
- **Context:** Works across multiple teams, needs to understand system dependencies and data flows
- **Pain Points:** Architecture knowledge is fragmented across PowerPoint, Visio, Confluence, and tribal knowledge; answering simple questions like "Which processes does this system support?" requires hours of research
- **Goals:** Single source of truth that can be queried and visualized without manual diagram updates

**Technical Lead** (28-45)
- **Role:** Team lead preparing for architecture reviews
- **Context:** Needs to present domain architecture to stakeholders and identify integration points
- **Pain Points:** Diagrams become stale quickly; significant manual effort to prepare architecture reviews; no consistent way to show relationships
- **Goals:** Quickly generate accurate diagrams from current architecture model; enable new team members to understand architecture in under 30 seconds

**Domain Owner** (30-50)
- **Role:** Product or domain owner needing architecture visibility
- **Context:** Makes decisions about system investments and needs to understand current state
- **Pain Points:** Inconsistent spreadsheets and multiple tools without common meta-model; hard to get answers to basic architecture questions
- **Goals:** Consistent, maintainable view of domain architecture that stays current with actual state

## The Problem

### Scattered Architecture Knowledge

Architecture knowledge is fragmented across static diagrams in PowerPoint/Visio/Confluence, tribal knowledge in people's heads, inconsistent spreadsheets, and multiple tools without a common meta-model. This fragmentation makes it extremely difficult to answer fundamental architecture questions, leads to diagrams that become stale within weeks of creation, and requires significant manual effort for every architecture review.

**Our Solution:** A small, opinionated web application that captures a structured meta-model (Business: users, processes; Applications: applications, components, services, application_points; Data: logical and physical entities and attributes; Relationships) and renders diagrams directly from that model, ensuring diagrams always reflect current architecture state.

### Static, Non-Queryable Documentation

Traditional architecture documentation in PowerPoint or Visio cannot be queried. Questions like "Which processes does this system support?" or "What applications consume this data entity?" require manual investigation across multiple documents and conversations.

**Our Solution:** A structured meta-model that captures relationships explicitly, enabling immediate answers to architecture queries through the data model itself.

### High Maintenance Burden

Keeping architecture diagrams current requires redrawing or manually updating visuals whenever the architecture changes. This leads to documentation debt where diagrams lag reality.

**Our Solution:** Separation of model and layout - update the meta-model once, and all diagrams reflect the change. Deterministic rendering with explicit positions ensures diagrams remain consistent and predictable.

## Differentiators

### Model-First Architecture

Unlike Visio or draw.io which are drawing tools where diagrams ARE the data, we provide a structured meta-model that separates architecture facts from visual presentation. This results in architecture that can be queried, validated, and rendered into multiple views without duplication.

### Lightweight and Opinionated

Unlike enterprise architecture tools (TOGAF tooling, Sparx EA) that require significant setup and learning curves, we provide an Excel-like data entry experience with JSON file storage. This results in new users being able to add application and data movement in under 5 minutes.

### Deterministic Rendering

Unlike auto-layout tools that rearrange diagrams unpredictably, we provide explicit positioning where architects control exact node placement and edge routing. This results in consistent, professional diagrams that don't shift unexpectedly.

### Single-File Portability

Unlike tools requiring databases or cloud accounts, we provide JSON file storage that can be version-controlled, shared, and backed up easily. This results in full portability and integration with existing developer workflows.

## Key Features

### Core Features

- **Meta-model CRUD**: Capture business users, processes, applications, components, services, application points, logical/physical data entities, attributes, and relationships through intuitive grid-based editing
- **JSON Load/Save**: Store entire architecture model in a single, portable JSON file that can be version-controlled and shared
- **Tabbed Grid UI**: Excel-like data entry experience for rapid capture of architecture elements across all domains
- **Basic Validation**: Ensure referential integrity and required fields are populated before save

### Visualization Features

- **Diagram Rendering**: Read-only canvas displaying nodes, containment hierarchies, polyline edges with waypoints, and labels
- **Pan and Zoom**: Navigate large diagrams smoothly with standard controls
- **Multiple Diagrams**: Support multiple diagram views of the same underlying meta-model

### Editing Features

- **Drag-and-Drop Palette**: Add meta-model entities to diagrams by dragging from categorized palette
- **Interactive Positioning**: Move and resize nodes with visual feedback and grid snapping
- **Containment Support**: Nest components within applications, attributes within entities
- **Polyline Edge Editing**: Create and modify multi-segment connectors with explicit waypoints
- **Connector Tool**: Draw relationships between elements with relationship type selection

### Advanced Features

- **Model-Assisted Actions**: Show potential relationships based on meta-model; quick-add related entities
- **Keyboard Shortcuts**: Power-user productivity with common operations accessible via keyboard
- **Mini-map**: Overview navigation for large diagrams
- **Version History**: Track changes to architecture model over time

## Key Goals

1. **Single Source of Truth**: One authoritative location for architecture meta-model across business, application, and data domains
2. **Separation of Model and Layout**: Architecture facts stored independently from visual presentation
3. **Lightweight Data Entry**: Excel-like grid editing that feels familiar and fast
4. **Deterministic Diagrams**: Explicit positions and waypoints, not auto-layout, ensuring consistent rendering
5. **Incremental Enhancement**: Start simple with JSON files and grid editing, scale to backend and multi-user later

## Success Criteria

- Architects can represent domain architecture using grid views + JSON editing
- JSON files can be loaded, rendered as diagrams, and saved without data loss
- Tool answers questions like "What systems are involved in this process?" directly from the model
- New users can add application and data movement in under 5 minutes
- Users can understand existing diagram in under 30 seconds
