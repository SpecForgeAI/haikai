---
title: Hide super-point entities from Meta-Model tables and expose Class/Method in Diagram RHS palette

intent:
  - Correct two UI integration issues after Architecture Domain filtering and Class/Method introduction:
    1) Business Point and Application Point should NOT be directly editable via Meta-Model entity tables
    2) Class and Method must be available in the Diagram RHS palette so they can be added to diagrams
  - Keep all backend models, relationships, and diagram semantics unchanged

scope:
  in:
    - frontend only
    - Meta-Model view entity tab rendering
    - Diagram View RHS Palette entity sections
  out:
    - backend schema or APIs
    - removal of Business Point / Application Point from relationships or diagrams
    - any diagram-type-specific rendering or behaviour

acceptance_criteria:
  - Meta-Model View:
    - "Business Points" and "Application Points" do NOT appear in the Entities row for any Architecture Domain
    - Relationships involving Business Point / Application Point remain visible and unchanged
  - Diagram View (RHS Palette):
    - When Application Architecture domain is selected:
      - "Classes" and "Methods" appear as palette sections/items
      - User can add Class and Method nodes to a diagram using existing palette interaction patterns
  - No regression to existing entity tabs, palette items, or domain filtering logic

implementation_steps:

  1) Hide Business Point and Application Point from Meta-Model entity tabs
    - Remove or exclude Business Points and Application Points from entity tab lists in Meta-Model view ONLY
    - Keep grid configs, API wiring, and domain classification intact
    - Relationship tabs referencing these entities remain visible

  2) Expose Class and Method in the Diagram RHS Palette
    - Add palette entries for Classes and Methods in Application Architecture domain
    - Use same structure and behaviour as existing Application entities
    - Show only when Application Architecture domain is active

  3) Consistency check
    - Verify Meta-Model and RHS palette use separate inclusion lists
    - Verify domain icon filtering continues to work

tests:
  - Manual:
    - Business domain → no "Business Points" entity tab
    - Application domain → no "Application Points" entity tab
    - Diagram View + Application domain → "Classes" and "Methods" visible in RHS palette
    - Add Class and Method to diagram canvas without errors

deliverable:
  - Cleaner Meta-Model UI with super-point entities hidden from direct editing
  - Class and Method fully usable in diagrams via RHS palette
---
