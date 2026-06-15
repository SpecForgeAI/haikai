Title: Add "Endpoint" Meta-Model Entity + Interface Contract Rendering (Endpoints + Entities/Attributes)

Summary:
Introduce a new meta-model entity: **Endpoint**, representing the operations/endpoints of an Interface (REST path, message queue/topic, file transfer location, etc.).
Endpoints are a **direct child** of Interface.

Enhance the diagram rendering so that when an Interface is added with its Endpoints and Logical Entities (with attributes), the Interface box visually contains:

1. A header with the Interface name
2. A section listing its Endpoints as text rows
3. Below that, ER-style boxes for Logical Entities (and their attributes)

Provide two ways to add Interface → Endpoint → Logical Entity trees:
1. A new RHS context menu item on Interface rows: **"Add endpoints and entities/attributes"**
2. Via **Advanced Add…** when the Interface, its Endpoints, and its Logical Entities are selected.

Finally, add **Endpoint** to the **Application Architecture** meta-model group in the top meta-model bar.

--------------------------------------------------------------------
1. New Meta-Model Entity: Endpoint

Add an entity named **Endpoint** with the following fields:

- **id** (string, required)
- **name** (string, required)
- **description** (string, optional)

- **interface_id** (foreign key → Interface, required)

- **endpoint_type** (enum):
  - HTTP_REST
  - MESSAGE_QUEUE
  - MESSAGE_TOPIC
  - FILE_TRANSFER
  - OTHER

- **path_or_address** (string)
  Examples:
    - REST: `/customers/{id}`
    - MQ: `CustomerEventsQueue`
    - File: `sftp://host:22/inbound/orders`

- **protocol** (enum):
  - HTTP, HTTPS
  - AMQP, JMS, KAFKA
  - FTP, SFTP, FILE
  - OTHER

- **operation_verb** (string/enum)
  Examples:
  - REST verbs: GET, POST, PUT, DELETE, PATCH
  - MQ verbs: PUBLISH, CONSUME, SUBSCRIBE
  - File verbs: SEND, RECEIVE

- **direction** (enum):
  - INBOUND
  - OUTBOUND
  - BIDIRECTIONAL

- **lifecycle_status** (enum):
  - PLANNED
  - ACTIVE
  - DEPRECATED
  - RETIRED

- **version** (string, optional)

(This set is intentionally flexible to support REST, messaging, and file-transfer patterns.)

--------------------------------------------------------------------
2. Add Endpoint to the Meta-Model Top Bar (Application Architecture Section)

In the meta-model top ribbon, update the **Application Architecture** group so it appears as:

`[Application] [Application Component] [Service] [Interface] [Endpoint] | [Logical Entities] [Physical Entities] …`

Endpoints must appear **immediately after Interface**.

--------------------------------------------------------------------
3. Direct Parent/Child Relationship: Interface → Endpoint

Declare a new direct parent/child relationship:

- **Parent:** Interface
- **Child:** Endpoint

This must behave identically to other direct containment chains (Application → Component → Service → Interface).

Consequences:
- Endpoints appear as children of Interfaces in the RHS relationship sections (if applicable).
- Endpoints appear under Interfaces in **Advanced Add…**.
- The diagram knows that Endpoints belong *inside* an Interface box.

--------------------------------------------------------------------
4. New RHS Context Menu Action on Interface Rows

When right-clicking an Interface row in the RHS meta-model tables, add a new menu item:

**"Add endpoints and entities/attributes"**

Behaviour:
- Add the Interface to the diagram (if not present).
- Add all its Endpoints (direct children).
- Add all Logical Entities (and their attributes) associated with that Interface (via existing Interface ↔ Logical Entity relationship).
- Render the Interface using the enhanced multi-section layout described in Section 6.

--------------------------------------------------------------------
5. Advanced Add Integration

When the user opens **Advanced Add…** and selects:

- An Interface
- One or more of its Endpoints
- One or more Logical Entities and their attributes

The resulting diagram element MUST render the Interface using the new multi-section layout:

1. Interface header (name)
2. Endpoint rows
3. Logical Entity ER-style boxes below

As with Logical Entities, endpoints selected individually or via "Select All" produce no standalone boxes—only integrated rendering within the parent Interface box.

--------------------------------------------------------------------
6. Diagram Rendering Rules for Interface + Endpoints + Entities

Interfaces now have a richer internal layout when added with endpoints and entities.

### 6.1 Interface Box Structure

When an Interface is drawn with Endpoints OR Logical Entities:

1. **Top Header:**
   - Interface name (bold, horizontally centered or left-aligned per existing style).

2. **Endpoints Section (new):**
   - Below the header, display one row per Endpoint.
   - Each row formatted as:
     `[operation_verb] [path_or_address] ([direction], [lifecycle_status])`
     Example:
     `GET /customers/{id} (INBOUND, ACTIVE)`

   - Rows use appropriate spacing based on the active spacing preset (Spacious / Normal / Tight).

3. **Entity Section (existing ER-style):**
   - Below the endpoints section, but still inside the Interface box.
   - Render Logical Entities using ER-style:
     - Entity name
     - Divider line
     - Attribute rows

4. Padding & layout follow the existing spacing preset rules.

### 6.2 Parent Resizing Rules

- The Interface box height must expand to accommodate:
  - All endpoint rows
  - All nested Logical Entity ER-style boxes
- Width must be large enough to contain the widest endpoint row OR the widest entity box.

--------------------------------------------------------------------
7. JSON Model (no structural changes needed)

- Endpoint objects stored in JSON under a new table/entity section.
- Interface nodes reference endpoints for rendering.
- Logical Entities still stored and rendered according to existing ER-style.

--------------------------------------------------------------------
8. Acceptance Criteria

1. Meta-model ribbon displays `[Endpoint]` under the Application Architecture group.
2. Users can define endpoints for an Interface in the RHS tables.
3. Right-click on Interface → "Add endpoints and entities/attributes":
   - Interface box appears.
   - Endpoint rows appear inside the Interface box.
   - Logical Entities (ER-style) appear below endpoint rows.
4. Advanced Add selection of Interface + Endpoints + Entities produces identical rendering.
5. The diagram display updates cleanly if endpoints or logical entities are added later.
6. Endpoints appear as children of Interfaces in Advanced Add and follow parent/child wrapping logic.
7. No attribute boxes appear for endpoints — they render only as text rows.

This completes the introduction of the Endpoint meta-model entity and its integrated rendering inside Interfaces.
