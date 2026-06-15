# Raw Idea

**Feature Name:** Fix UI Characteristics Picker Grouping and Key Suggestions

**Description:**
Fix two UX issues in the UI Characteristics grid:

1) UI column (Application Point picker) grouping:
   - Currently lumps most Application Points under a generic "Application Points" section.
   - Change to group by Application Point kind (Application / Application Component / Service)
   - Reuse existing dropdown grouping patterns already used in other relationship pickers

2) Key column suggestions:
   - Enable Key suggestions sourced from backend config (bootstrap)
   - Suggestions display human-friendly labels but store raw key values
   - Type-dependent suggestions (ui_capability, interaction_complexity, technical_shape)

SCOPE: Frontend + architecture-model-service bootstrap/config only. No persistence schema changes.
