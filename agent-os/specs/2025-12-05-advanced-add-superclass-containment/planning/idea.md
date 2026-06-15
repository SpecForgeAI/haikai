# Advanced Add – super-class aware containment for App Point ↔ Business Point and Interface ↔ Logical Entity (Option 1, no Point nodes)

## Summary

Advanced Add and diagram rendering must correctly understand:
1) The super-classes **Application Point** and **Business Point**,
2) All **direct parent/child** relationships (from entity tables), and
3) Explicit **indirect parent/child** relationships, starting with:
   - App Point ↔ Business Point
   - Interface ↔ Logical Entity

In this model:
- Diagrams show **only concrete entities** (Application, Application Component, Service, Business Process, Process Activity, Interface, Logical Entity, etc.).
- Application Point and Business Point are used internally for relationships but are **never rendered as nodes** and **never appear in Advanced Add trees**.
- For the two focus relationships:
  1. **App Point ↔ Business Point** behaves as containment: Business "stuff" (Business Processes / Activities) must appear **inside** the Application "stuff" (Applications / Components / Services).
  2. **Interface ↔ Logical Entity** behaves as containment: Logical Entities appear **inside** Interface boxes.

All other relationships (e.g. User ↔ Business Point, Logical ER, Logical ↔ Physical, Data Movements) remain **edge-only** and are explicitly **out of scope** for containment/Advanced Add in this spec.

## Scope

- Advanced Add tree-building logic.
- Diagram wrapping/nesting logic for containment relationships.
- Super-class handling for Application Point and Business Point.
- Visualisation rules for:
  - App Point ↔ Business Point (boxes nested, no edge line)
  - Interface ↔ Logical Entity (boxes nested, no edge line)

## Out of scope

- Styling and rendering of pure edge relationships (User ↔ Business Point, Logical ER, Logical ↔ Physical, Data Movements, etc.).
- Any change to existing meta-model semantics of entities and relationships beyond clarifying containment vs edge behaviour.
- Any change to Application Point / Business Point meta-model other than how they are used in Advanced Add and diagrams.
