Title: Define Temporary Architecture Diagram JSON Contract (ER First)

Objective:
Create a generic, robust, and LLM-friendly temporary diagram JSON contract that can represent many future architecture-derived diagrams, with ER diagrams as the first supported example.

This contract must:
- Be generic enough to support multiple diagram kinds in future
- Be simple enough for an LLM to generate reliably
- Be deterministic enough for tool-side code to map into native diagram data
- Avoid any dependency on internal architecture entity/attribute/relationship IDs
- Preserve layout and routing so diagrams can be rendered immediately
- Support view-mode-specific behavior, with ER as the initial implemented kind
- Support later deterministic mapping to either logical or physical architecture model elements

This increment defines the contract only.
It does NOT implement prompt behavior, saving, rendering, mapping, modal flows, or finalization.

---

Problem Context:
The product needs a generic mechanism whereby a saved slice of the architecture meta-model can be turned into a temporary diagram specification by an LLM, and then deterministically transformed by tool code into the tool's native diagram representation.

The first concrete use case is:
- diagram_kind = "ER"
- view_mode = "LOGICAL" or "PHYSICAL"

For ER:
- LOGICAL mode maps later to logical_data_entities and logical_data_attributes
- PHYSICAL mode maps later to physical_data_entities and physical_data_attributes

The contract must therefore be:
- generic at the top level
- specialized in a controlled way for ER as the first example

---

Scope:
1. Define a new shared schema/type named: `TemporaryArchitectureDiagram`
2. Define generic node and edge structures that can be reused for future diagram kinds.
3. Define ER-specific extensions or fields within that generic structure for the first use case.
4. Add an example JSON payload for an ER diagram in both PHYSICAL and LOGICAL mode.
5. Add validation support or helper utilities if the codebase already has a suitable pattern for schema validation.

---

Required Top-Level Contract:

TemporaryArchitectureDiagram
- id: string
- name: string
- description?: string
- diagram_kind: "ER"
- source_architecture_domain: "DATA"
- view_mode: "LOGICAL" | "PHYSICAL"
- version: number
- nodes: TemporaryArchitectureDiagramNode[]
- edges: TemporaryArchitectureDiagramEdge[]
- groups?: TemporaryArchitectureDiagramGroup[]
- metadata?: { created_by_task?: string, notes?: string[] }

---

Required Generic Node Contract:

TemporaryArchitectureDiagramNode
- id: string
- node_kind: "ENTITY"
- semantic_type: string
- ref_name: string
- display_name: string
- pos_x: number
- pos_y: number
- width: number
- height: number
- z_index?: number
- compartments?: TemporaryArchitectureDiagramCompartment[]
- style?: { background_color?: string, line_color?: string, text_color?: string }
- metadata?: { is_primary?: boolean, is_reference?: boolean, tags?: string[] }

---

Required Generic Compartment Contract:

TemporaryArchitectureDiagramCompartment
- id: string
- compartment_kind: "ATTRIBUTES"
- items: TemporaryArchitectureDiagramCompartmentItem[]

---

Required Generic Compartment Item Contract:

TemporaryArchitectureDiagramCompartmentItem
- id: string
- item_kind: "ATTRIBUTE"
- ref_name: string
- display_name: string
- semantic_type: string
- metadata?: { is_primary_key?: boolean, is_foreign_key?: boolean, data_type?: string, is_nullable?: boolean }

---

Required Generic Edge Contract:

TemporaryArchitectureDiagramEdge
- id: string
- edge_kind: "RELATIONSHIP"
- semantic_type: string
- source_node_id: string
- target_node_id: string
- source_ref_name: string
- target_ref_name: string
- source_item_ref_name?: string
- target_item_ref_name?: string
- relationship_hint?: string
- cardinality?: "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE" | "MANY_TO_MANY"
- edge_points: TemporaryArchitectureDiagramPoint[]
- source_label?: { text: string, pos_x: number, pos_y: number }
- target_label?: { text: string, pos_x: number, pos_y: number }
- style?: { line_color?: string, line_type?: "SOLID" | "DASHED", line_weight?: number }
- metadata?: { optionality?: "OPTIONAL" | "REQUIRED" | "UNKNOWN", notes?: string[] }

---

Required Point Contract:

TemporaryArchitectureDiagramPoint
- sequence_order: number
- pos_x: number
- pos_y: number

---

Required Generic Group Contract:

TemporaryArchitectureDiagramGroup
- id: string
- group_kind: string
- ref_name?: string
- display_name?: string
- pos_x: number
- pos_y: number
- width: number
- height: number
- child_node_ids: string[]
- style?: { background_color?: string, line_color?: string, text_color?: string }

---

ER-First Constraints:
For this increment: diagram_kind = "ER", source_architecture_domain = "DATA", view_mode = "LOGICAL" | "PHYSICAL"

ER mapping rules:
- LOGICAL: node.semantic_type = "LOGICAL_DATA_ENTITY", item.semantic_type = "LOGICAL_DATA_ATTRIBUTE"
- PHYSICAL: node.semantic_type = "PHYSICAL_DATA_ENTITY", item.semantic_type = "PHYSICAL_DATA_ATTRIBUTE"

Edge matching rules for ER:
- Matching must later be possible using: source_ref_name, source_item_ref_name, target_ref_name, target_item_ref_name

---

Design Principles:
- No architecture IDs in this contract
- Exact names only; no abbreviations, aliases, or paraphrasing
- Layout must be explicit and complete
- Contract must be generic enough for future diagram kinds
- ER must be the first fully supported specialization

---

Non-Goals:
- Do NOT add MCP integration, saving logic, rendering logic, auto-mapping logic, confirmation modal logic
- Do NOT modify native persisted diagram schema yet
- Do NOT implement any non-ER diagram kinds yet

---

Deliverables:
1. New shared type/schema definitions for all contracts listed above
2. Inline documentation/comments for each field
3. Example payload files (one PHYSICAL ER, one LOGICAL ER)
4. Optional validation helpers

---

Acceptance Criteria:
- A generic temporary architecture diagram contract exists in shared code
- The contract supports ER as the first implemented diagram kind
- The contract supports both LOGICAL and PHYSICAL ER modes
- The contract contains enough information for deterministic future mapping
- The contract contains enough geometry/routing data for direct rendering later
- No internal architecture IDs required anywhere
- Simple enough for reliable LLM generation
- Existing native diagram persistence remains unchanged
