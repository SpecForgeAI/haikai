# Raw Idea

**Name:** sequence-diagram-fix-self-loop-spacing-and-collection-label-rendering

**Scope:** frontend

**Type:** layout-bugfix + rendering-bugfix

## Description

```
intent:
  Fix two regressions in Sequence Diagram rendering:
    1) Self-referencing message exchanges (From == To) must reserve vertical space based on the
       bottom of the loopback shape, preventing collisions with subsequent messages or fragment
       boundaries.
    2) Message exchanges marked "Is Collection?" for PhysicalEntity/LogicalEntity references must
       render as "Collection<EntityName>" rather than just "EntityName".

constraints:
  - No changes to diagram data model or backend persistence in this increment
  - No changes to non-self message layout behavior
  - No changes to fragment semantics, only layout spacing calculation
  - Do not change existing label text for non-collection messages

fix_1_self_message_spacing:
  current_issue:
    - Self-loop messages draw correctly but layout spacing uses the top/outgoing segment Y,
      causing the next message or fragment bottom border to appear too close or touching,
      especially when the self-loop is near the bottom of a fragment.
  required_behavior:
    - When computing vertical layout for message exchanges:
        - If exchange.fromParticipantId == exchange.toParticipantId (self-loop):
            - The reserved vertical space / nextY must be based on the loop's lowest Y
              (bottom-most point of the rendered loopback path), not the top segment.
            - Ensure the standard inter-message padding is applied measured from that bottom-most Y.
    - Result:
        - Subsequent message exchanges maintain normal spacing below the self-loop.
        - Fragment boundaries (top/bottom lines) do not touch or overlap the loopback shape.
  acceptance_criteria:
    - Self-loop messages inside fragments have consistent spacing below the loop
      (no touching/overlap with the next message or fragment border).
    - Self-loop messages outside fragments also maintain consistent spacing to the next message.

fix_2_collection_label_rendering:
  current_issue:
    - "Is Collection?" can be selected for PhysicalEntity/LogicalEntity references, but the diagram
      renders only the entity name (e.g., "Asset") instead of "Collection<Asset>".
  required_behavior:
    - For request and response message content rendering:
        - If content mode == Reference
          AND referenceType IN {PhysicalEntity, LogicalEntity}
          AND isCollection == true (as stored on the message/content model):
              render label as: "Collection<${entityName}>"
        - Otherwise, render label exactly as today.
    - Examples:
        - ReferenceType=PhysicalEntity, entity=Asset, isCollection=true  -> "Collection<Asset>"
        - ReferenceType=LogicalEntity, entity=Role, isCollection=false   -> "Role"
  acceptance_criteria:
    - Any message exchange added with "Is Collection?" checked renders as "Collection<EntityName>"
      in the diagram.
    - Non-collection messages and non-entity reference types render unchanged.

non_goals:
  - Do not add new UI controls (checkbox already exists)
  - Do not change export/print behavior in this increment
  - Do not change message ordering, routing, or fragment definitions
```
