---
title: Fix relationship filtering to use domain entity membership (including hidden/super entities)

intent:
  - Ensure relationship visibility is determined by an Architecture Domain's full entity membership, not by the subset of entities visible/editable in the UI.
  - Restore visibility of relationships involving hidden "super class" entities such as Application Point and Business Point while keeping those entities hidden from Meta-Model entity tabs and Diagram RHS palette entity sections.

scope:
  in:
    - frontend only
    - relationship filtering logic for Meta-Model and Diagram View RHS Palette
    - domain configuration to separate entity membership from visible tabs
  out:
    - backend schema/APIs
    - changes to entity persistence
    - making Application Point / Business Point placeable or editable

acceptance_criteria:
  - Meta-Model View:
    - "Application Points" and "Business Points" remain hidden from Entities row tabs
    - In Application domain, relationship tabs referencing Application Point are visible
    - In Business domain, relationship tabs referencing Business Point are visible
  - Diagram RHS Palette:
    - Application Points and Business Points are NOT shown as entity sections
    - Relationship sections involving these entities remain visible under appropriate domains
  - Future-proof: hiding entities does not hide relationships if those entities remain domain members

implementation_approach:
  1) Create two mappings per domain:
     - DOMAIN_ENTITY_TYPES (authoritative membership, includes hidden entities)
     - domainGroupings (visible entity tabs only, excludes super entities)
  2) Meta-Model Entities row renders from domainGroupings (visible tabs)
  3) Relationship filtering uses DOMAIN_ENTITY_TYPES (full membership)
  4) Diagram palette entity sections use visible set, relationship sections use full membership

deliverable:
  - Relationship visibility based on domain membership (including hidden entities)
  - Prevents accidental loss of relationship tabs when entities are hidden from UI
---
