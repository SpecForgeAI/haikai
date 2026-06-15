# Raw Idea: Add "Interactions" meta-model tab and editable Interaction table

## Title
Add "Interactions" meta-model tab and editable Interaction table

## Summary
The "User Interactions" section is visible in the Diagrams palette, but there is currently **no way to create or edit Interaction records** in the meta-model. The "Interactions" entity must appear as a first-class tab in the meta-model top bar (between Activities and Applications), with a table that behaves like all other entity tables. The RHS "User Interactions" diagram section must be populated from this table.

------------------------------------------------------------

## 1. Meta-model top bar: insert "Interactions" tab

Update the Meta-model view's entity tab strip so that the order is:

- Users
- Processes
- Activities
- **Interactions**
- | (divider)
- Applications
- App Components
- Services
- Interfaces
- Endpoints
- | (divider)
- Logical Entities
- Logical Attributes
- Physical Entities
- Physical Attributes

Details:
- Tab label: **Interactions** (plural).
- When clicked, it shows the Interaction table described in Section 2.

------------------------------------------------------------

## 2. Interaction table definition

Add a new meta-model entity table **Interactions** with columns:

1) **Name** (required, string)
2) **Description** (optional, string/multiline)
3) **User** (required, foreign key to Business Users)
4) **Primary Point** (required, foreign key to App_Business_Point)
5) **Secondary Point** (optional, foreign key to App_Business_Point)
6) **Tags** (optional, free-text or comma-separated)

Notes:

- "Primary Point" and "Secondary Point" must use the App_Business_Point super-type:
  - Autocomplete shows: `<name> (<entity_type>)`
  - Valid options include:
    - Applications
    - Application Components
    - Services
    - Interfaces
    - Endpoints
    - Business Processes
    - Process Activities

- Each row corresponds 1:1 to an Interaction entity instance already defined in previous specs.

Behaviour:

- Support Add / Edit / Delete rows exactly like other entity tables (Applications, Activities, etc.).
- New rows default:
  - Name: empty
  - Description: empty
  - User: unset
  - Primary Point: unset
  - Secondary Point: unset
  - Tags: empty

- Validation:
  - Name: required (non-empty).
  - User: required.
  - Primary Point: required.
  - Secondary Point: optional.
  - Show inline validation errors in the table (e.g., red border + tooltip) and in the global validation dialog.

------------------------------------------------------------

## 3. Wiring to diagram "User Interactions" section

Source of truth:
- The "User Interactions" section in the Diagrams RHS palette must take its data from the **Interactions table**.

Update behaviour:

- When the user creates or edits rows in the Interactions table:
  - The palette's "User Interactions" list is updated accordingly (after save).
  - Each Interaction appears with:
    - Display name: `Interaction Name`
    - Optionally show a short hint: `(<User name>, <Primary Point name>[, <Secondary Point name>])`.

- When a User Interaction is dragged/added from the RHS palette to the diagram:
  - It uses the Interaction record's:
    - user_id
    - primary_app_business_point_id
    - secondary_app_business_point_id
  - Dotted-line rendering behaviour stays as previously specified (user ↔ primary, or primary ↔ secondary plus optional user line).

Persistence:
- Interaction table rows must be included in the meta-model JSON save/load flow like other entities.

------------------------------------------------------------

## 4. Acceptance criteria

AC1 – New Interactions tab:
- The meta-model top bar shows an "Interactions" tab between Activities and Applications.
- Clicking it displays a table with the specified columns.

AC2 – CRUD:
- Users can add, edit, and delete Interaction rows.
- Required fields (Name, User, Primary Point) are validated and highlighted when missing.

AC3 – Palette population:
- The "User Interactions" section in the Diagrams RHS palette lists all saved Interactions.
- Creating a new Interaction row and saving causes it to appear under "User Interactions" without page reload.

AC4 – Diagram integration:
- Adding a User Interaction from the palette to a diagram uses the Interaction record as its data source (user + primary/secondary App_Business_Points), and existing dotted-line rendering rules still apply.

This completes the Interaction feature loop by allowing users to define interactions in the meta-model and then use them in the diagram view.
