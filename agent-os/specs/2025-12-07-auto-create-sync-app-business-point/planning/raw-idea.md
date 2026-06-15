# Raw Idea

## Title
Auto-Create + Sync App_Business_Point for All Business + Application Entities

## Summary
Ensure App_Business_Point behaves exactly like Application Point / Business Point: automatically created, synced, and deleted based on concrete entities in the Business and Application architecture sections.

## Key Changes

### 1. New Indirect Entity: APP_BUSINESS_POINT
- Fields: id (auto), name, kind (enum), source_entity_id
- No UI tab - invisible to users
- Used as populated lookup for Interaction.primary_point and Interaction.secondary_point

### 2. Auto-Creation Rules
- When creating APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, PROCESS, or ACTIVITY
- Automatically create corresponding APP_BUSINESS_POINT with:
  - name = entity.name
  - kind = entity.type
  - source_entity_id = entity.id

### 3. Sync Rules – Rename
- When any source entity is renamed
- Update corresponding APP_BUSINESS_POINT.name to match

### 4. Delete Rules
- When source entity is deleted:
  - Delete matching APP_BUSINESS_POINT
  - Clear orphan references in INTERACTION.primary_point and INTERACTION.secondary_point

### 5. Interactions Table – Dropdown Population
- Primary Point and Secondary Point dropdowns list all APP_BUSINESS_POINT records
- Display format: "<name> (<kind>)"
- Sorted alphabetically

### 6. No UI Panel
- No RHS section for APP_BUSINESS_POINT
- No user edit view

## Acceptance Criteria
- AC1: Creating any Application, App Component, Service, Interface, Process, or Activity auto-creates an App_Business_Point row
- AC2: Renaming any of those entities renames the linked App_Business_Point
- AC3: Deleting any of those entities deletes its App_Business_Point and clears references in Interaction rows
- AC4: Interactions → Primary Point and Secondary Point dropdowns show all App_Business_Point values with display "<name> (<kind>)"
- AC5: User never sees App_Business_Point as a separate table/section—only through dropdowns
