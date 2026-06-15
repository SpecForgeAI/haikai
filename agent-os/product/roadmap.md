# Product Roadmap

## Phase 1: Meta-model CRUD + JSON Load/Save (v0.1 Core)

1. [x] JSON Schema Definition - Define complete TypeScript interfaces for architecture meta-model including business entities (users, processes), application entities (applications, components, services, application_points), data entities (logical/physical entities, attributes), and relationships `S`

2. [x] In-Memory Data Store - Implement React context-based state management to hold the complete architecture model with CRUD operations for all entity types `S`

3. [x] Top Navigation Bar - Create persistent top bar with view toggle (grid/diagram modes), Load JSON button, and Save JSON button with file name display `XS`

4. [x] JSON File Operations - Implement Load JSON (file picker, parse, validate, populate state) and Save JSON (serialize state, download as file) with error handling for malformed files `S`

5. [x] Tabbed Grid Container - Create tab navigation component for switching between entity type grids (Users, Processes, Applications, Components, Services, Application Points, Logical Entities, Physical Entities, Attributes, Relationships) `XS`

6. [x] Entity Grid Component - Build reusable data grid with inline editing, row add/delete, column sorting, and entity-specific column configurations for all meta-model types `M`

7. [x] Relationship Grid with Dropdowns - Extend grid component to support relationship editing with dropdown selectors for source/target entities filtered by type `S`

8. [x] Basic Validation - Implement validation for required fields, unique identifiers, referential integrity (relationships reference existing entities), and display validation errors inline `S`

## Phase 2: Diagram Rendering (Read-only)

9. [x] Diagram Data Structures - Extend TypeScript interfaces for diagrams[], diagram_nodes[] (position, size, entity reference), and diagram_edges[] with edge_points[] for polyline routing `S`

10. [x] Diagram Selector UI - Add diagram selection dropdown/tabs to switch between multiple diagrams defined in the model `XS`

11. [x] Canvas Foundation - Implement HTML5 Canvas or SVG-based rendering surface with coordinate system and viewport management `M`

12. [x] Node Rendering - Render diagram nodes as rectangles with entity name labels, styled by entity type (different colors/shapes for applications, components, data entities) `S`

13. [x] Containment Rendering - Render parent-child relationships visually with child nodes positioned inside parent bounds and appropriate visual hierarchy `S`

14. [x] Edge Rendering - Render polyline edges following edge_points[] waypoints with arrowheads indicating direction and relationship type labels `M`

15. [x] Pan and Zoom Controls - Implement mouse-based pan (drag canvas) and zoom (scroll wheel) with zoom level indicator and reset-to-fit button `S`

## Phase 3: Interactive Diagram Editing (MVP)

16. [x] Entity Palette - Create right-hand collapsible palette showing available meta-model entities grouped by type with search and click-to-add functionality `S`

17. [ ] Drag-and-Drop Creation - Enable dragging entities from palette onto canvas to create new diagram_node at drop position with auto-generated node ID `M`

18. [x] Node Selection - Implement click-to-select with visual selection indicator (handles/border), multi-select with shift-click, and selection state management `S`

19. [x] Node Movement - Enable drag-to-move selected nodes with real-time position update, grid snapping, and boundary constraints `S`

20. [x] Node Resizing - Add resize handles to selected nodes enabling proportional and free-form resizing with minimum size constraints `S`

21. [ ] Containment Drag Support - Detect when node is dragged into/out of container node and update parent reference, moving children with parent `M`

22. [ ] Connector Tool - Implement edge creation mode: click source node, click target node, select relationship type from popup, create edge with default waypoints `M`

23. [x] Edge Waypoint Editing - Enable adding, moving, and deleting waypoints on selected edges to create clean polyline routing around obstacles `M`

24. [x] Delete Operations - Support deleting selected nodes (with confirmation if has children/edges) and edges via keyboard shortcut or context menu `S`

25. [x] Auto-Save to State - Ensure all diagram edits immediately update in-memory state so Save JSON captures current diagram layout `XS`

## Phase 4: UX Polish & Model-Assisted Features

26. [ ] Visual Styling System - Implement configurable node styling (colors, borders, icons) per entity type with consistent visual language across diagrams `M`

27. [ ] Keyboard Shortcuts - Add shortcuts for common operations: delete (Del), select all (Ctrl+A), copy/paste nodes (Ctrl+C/V), undo/redo (Ctrl+Z/Y) `M`

28. [ ] Mini-map Navigation - Add thumbnail overview panel showing entire diagram with viewport indicator, click-to-navigate, and drag-to-pan `M`

29. [ ] Relationship Suggestions - When adding entities to diagram, highlight and offer quick-add for related entities based on existing relationships in meta-model `L`

30. [ ] Quick-Add Related - Right-click entity to see "Add related" submenu listing all connected entities not yet on diagram, with one-click add and auto-positioning `M`

31. [ ] Enhanced Validation UI - Show validation errors in dedicated panel with click-to-navigate to problematic entity, categorized by severity `S`

32. [ ] Undo/Redo System - Implement command pattern for all state-changing operations with full undo/redo stack for both grid edits and diagram operations `L`

33. [ ] Search and Filter - Add global search across all entity types with results highlighting and filter grids by search term `S`

## Phase 5: Backend, Multi-User & Deployment

34. [x] Spring Boot API Foundation - Create Java Spring Boot application with REST endpoints for CRUD operations on architecture models `M`

35. [x] PostgreSQL Persistence - Implement JPA entities and repositories to persist architecture models to PostgreSQL database `M`

36. [ ] Model Versioning - Store version history with timestamp, author, and change description; enable viewing and restoring previous versions `L`

37. [ ] Authentication Integration - Implement Spring Security with OAuth2/OIDC for user authentication against corporate identity provider `M`

38. [ ] Access Control - Implement role-based permissions (viewer, editor, admin) at model level with UI reflecting user's permissions `M`

39. [x] Frontend-Backend Integration - Connect React frontend to Spring Boot API, replacing local JSON file operations with API calls `M`

40. [x] Docker Containerization - Create Dockerfiles for frontend (Nginx) and backend (Java), plus docker-compose for local development `S`

41. [ ] CI/CD Pipeline - Configure GitHub Actions or similar for automated testing, building Docker images, and deployment to target environment `M`

> Notes
> - Order items by technical dependencies and product architecture
> - Each item represents an end-to-end functional and testable feature
> - Effort estimates: XS (1 day), S (2-3 days), M (1 week), L (2 weeks), XL (3+ weeks)
> - Phase 1-3 represent MVP with frontend-only architecture
> - Phase 4-5 add polish and enterprise capabilities
> - Future considerations not included: Git integration, programmatic API, OpenAPI generation, documentation generation, multi-tenancy, import from spreadsheets/Visio
