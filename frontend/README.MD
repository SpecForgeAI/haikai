# 📘 Architecture Modelling Tool — Frontend UI
*A Business-Friendly and Technically-Capable Architecture Design Workspace*

---

## 🌟 What This Tool Is
This tool is an **interactive architecture modelling environment** that allows both business and technical users to:

- Define the organisation’s **business**, **application**, **data**, and **integration** architectures using structured meta-model tables.
- Draw **living architecture diagrams** that automatically reflect the underlying meta-model.
- Track architectural evolution through **temporality** (`valid_from`, `valid_to`).
- Add **decorations**, annotations, and custom shapes for communication and storytelling.
- Produce **custom visualisations** (e.g., UML/ERD-style entities, Interface + Endpoints contracts, wrapped application hierarchy).
- Import/export meta-models via **Excel (.xlsx)**.
- Move toward automated **OpenAPI Specification (OAS)** generation in future versions.

The tool enforces modelling rules, ensures consistency across diagrams, and links multiple architecture layers into one coherent view.

---

## 🧠 What a Business User Can Do

### ✔️ Understand Business Capabilities
- Define **Business Processes** and **Process Activities**.
- Describe how work flows through the business.

### ✔️ Understand How Applications Support the Business
- View which applications support which processes.
- See how services and interfaces expose business functionality.

### ✔️ Understand How Data Is Structured
- Visualise **logical** and **physical** data models.
- View attributes in clean UML-style entity boxes.

### ✔️ Interactions & User Journeys
- Model user interactions across applications, processes, and interfaces.
- Visualise dotted-line interaction paths.

### ✔️ Work Over Time
- Move between different periods (e.g., Q1 2024 → Q3 2025) and see how:
    - Applications change
    - Services move
    - Processes evolve
    - Data structures change
    - Diagram layouts adapt automatically

---

## 🛠️ Technical Overview (For Developers & Architects)

### Frontend
- **React + TypeScript** SPA
- Diagrams rendered using **HTML5 canvas / SVG layers**
- Internal layout engine supports:
    - Auto-wrapping
    - Parent-child hierarchy
    - Node-edge routing
    - Spacing presets (Tight/Normal/Spacious)

### Backend (current features, expanding soon)
- Node/TS backend providing integration endpoints (e.g., scanning Draw.io diagrams)
- Soon to include persistent storage + API metadata processing
- Future integration with **MCP server** and **Gateway** to support LLM reasoning

### Persistence
- Currently: JSON files stored locally in the browser
- Future: PostgreSQL back-end schema (entities, relationships, diagrams)

### Import/Export
- Uses XLSX library
- Worksheets correspond to meta-model tables
- Relationship sheets replace `<->` with `-` in worksheet names
- Export reproduces this format exactly

### Temporality Engine
- Supports versioned meta-model elements
- Now supports versioned **diagram elements** (nodes, edges, decorations)
- Time-based rendering = selecting correct version at period T

---

## 📚 Meta-Model Catalogue
*Comprehensive list of all entities and relationships in the architecture modelling tool, grouped by the 5 Architecture Domains shown in the UI.*

> Note: Some relationships appear in more than one domain. They are intentionally repeated below wherever they are visible/usable.

---

### 🧑‍💼 Business Domain

#### Entities

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Entity** | Business User | Represents a user or user role interacting with business or application capabilities. |
| **Entity** | Business Process | High-level business workflow or function. |
| **Entity** | Process Activity | A specific step within a Business Process. Includes User Interaction Level, Frequency, etc. |
| **Entity** | Business Point | Superclass representing Business Process or Process Activity. |

#### Relationships

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Relationship** | User ↔ Business Point | A user engages with business processes or activities. |
| **Relationship** | App Point ↔ Business Point | Applications/components/services support business functionality. |
| **Relationship** | Interaction | A User and one or two App_Business_Points forming dotted-line interactions (no interaction node). |

---

### 🧩 Application Domain

#### Entities

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Entity** | Application | A top-level application in the application architecture. |
| **Entity** | Application Component | A functional module within an Application. |
| **Entity** | Service | A service exposed by an Application Component. |
| **Entity** | Interface | An interface/protocol boundary (API, MQ, File Transfer, etc.). |
| **Entity** | Endpoint | A concrete endpoint (path, verb, operation) belonging to an Interface. |
| **Entity** | Class | A software class used to model internal application design. |
| **Entity** | Method | An operation on a Class (parameters/returns/throws captured as method details). |
| **Entity** | Package Set | A named grouping of packages/modules (useful for scoping or packaging views). |
| **Entity** | App Point | Superclass representing Application, Component, or Service for relationship purposes. |

#### Relationships

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Relationship** | App Point ↔ Business Point | Applications/components/services support business functionality. |
| **Relationship** | Interaction | A User and one or two App_Business_Points forming dotted-line interactions (no interaction node). |
| **Relationship** | Interface ↔ Logical Entity | A contract specifying which logical entities appear in an interface schema. |
| **Relationship** | Data Movements | Data exchanges between applications/services/entities. |
| **Relationship** | App Point ↔ Business Logic | Links application points to business logic blocks they implement or invoke. |

---

### 🗄️ Data Domain

#### Entities

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Entity** | Logical Entity | A conceptual data structure used across applications. |
| **Entity** | Logical Attribute | An attribute belonging to a Logical Entity (OAS-style primitive types). |
| **Entity** | Physical Entity | A data structure as implemented in databases. |
| **Entity** | Physical Attribute | A physical attribute (SQL-style primitive types). |

#### Relationships

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Relationship** | Logical / Physical ER | Entity–relationship connections between Logical and/or Physical Entities. |
| **Relationship** | Logical ↔ Physical Entities | Mapping conceptual data models to physical storage models. |
| **Relationship** | Logical ↔ Physical Attributes | Mapping conceptual attributes to physical attributes. |
| **Relationship** | Interface ↔ Logical Entity | A contract specifying which logical entities appear in an interface schema. |
| **Relationship** | Data Movements | Data exchanges between applications/services/entities. |

---

### 🧠 Behavioural Domain

#### Entities

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Entity** | Event | A business or system event that triggers behaviour (e.g., OrderPlaced). |
| **Entity** | State | A named state in a state machine (e.g., Pending, Approved). |
| **Entity** | State Transition | A transition between states, typically triggered by an event or condition. |
| **Entity** | Activity Node | A node within an activity diagram (action/step/decision). |
| **Entity** | Activity Flow | A directed flow/edge between activity nodes. |
| **Entity** | Activity Partition | A swimlane/partition grouping activity nodes by owner/responsibility. |
| **Entity** | Business Logic | A discrete business rule/logic block (used to represent behaviour/decisioning). |

#### Relationships

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Relationship** | Interaction | A User and one or two App_Business_Points forming dotted-line interactions (no interaction node). |
| **Relationship** | App Point ↔ Business Logic | Links application points to business logic blocks they implement or invoke. |

---

### 🖥️ UI Domain

#### Entities

| **Type** | **Name** | **Short Description** |
|---------|----------|------------------------|
| **Entity** | UI Screen | A user-facing screen/view in the UI (page, route, or major panel). |
| **Entity** | UI Workflow Transition | A transition between UI screens (e.g., navigation or step progression). |
| **Entity** | UI Component | A reusable UI component (widget/control/component). |
| **Entity** | UI Action | A user action or UI-triggered action (click, submit, select, etc.). |

#### Relationships
*UI has no official relationship tables yet (by design, for now).*

---

## 🎨 Diagram Capabilities

### Diagram Nodes
- Applications, Components, Services, Interfaces, Entities
- Composite nodes (Interface + Endpoints + Entities)
- UML/ERD-style entity rendering
- Nested hierarchy (Application → Component → Service → Interface → Entity/Attribute)

### Diagram Edges
- Solid lines for structural relationships
- Dotted lines for **User Interactions**
- Lines with multiplicity labels (1, M) for Logical ER

### Decorations
- Boxes, ovals, diamonds, parallelograms, cylinders, circles, arrows
- Resizable with drag handles
- Saved and reloaded with the diagram

### Temporality
- Each diagram element has versioning:
    - `valid_from`
    - `valid_to`
- Edits in past/future periods create new layout versions automatically
- Diagrams seamlessly adapt across time

---

## 📂 File Menu
- **Open** — Load JSON diagram/meta-model
- **Save** — Save current file
- **Import Meta-Model (.xlsx)** — Append worksheets into meta-model
- **Export Meta-Model (.xlsx)** — Export current meta-model into worksheets
