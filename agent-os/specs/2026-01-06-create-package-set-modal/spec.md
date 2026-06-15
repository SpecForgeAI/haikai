# Specification: Create Package Set Modal with Embedded Packages Builder

## Goal
Enable users to create new project-level Package Sets (and their Packages) via a dedicated modal from the "Package Sets" screen, using an immutable creation model where Package Sets and Packages cannot be edited after creation.

## User Stories
- As an architect, I want to create a new Package Set with one or more Packages so that I can define reusable package structures for service design.
- As an architect, I want to see my newly created Package Set immediately after creation so that I can verify it was created correctly.

## Specific Requirements

**Entry Point Button**
- Add "Create Package Set" primary button to PackageSetsView header area
- Button positioned in the masterHeader section, right-aligned
- Button triggers modal open state

**Modal Structure and Layout**
- Modal title: "Create Package Set"
- Modal uses existing modal patterns from `src/components/common/Modal.tsx` and `CreateBusinessLogicModal.tsx`
- Modal overlay closes on escape key or click outside
- Form content scrollable if exceeds viewport height

**Package Set Name Field**
- Required text input field for Package Set name
- Label: "Name" with required asterisk indicator
- Placeholder: "Enter package set name"
- Validation error: "Package set name is required" when empty/whitespace on submit

**Packages Builder (Embedded Table)**
- Editable table/list embedded within modal for creating packages
- Each row contains: Package Name (required), Purpose (optional)
- Initial state: one empty row ready for input
- "Add Package" button below table to add new blank rows
- Row-level "Remove" action (trash icon or button) to delete rows
- Minimum one package required for validation

**Package Row Reordering**
- Up/Down arrow buttons per row for reordering (if time permits)
- sort_order assigned as consecutive integers starting at 1 based on final order
- Fallback: If reordering UI is not implemented, assign sort_order by insertion order

**Validation Rules**
- Create button disabled until all conditions met:
  - Package Set Name is non-empty (trimmed)
  - At least 1 package row exists
  - All package names are non-empty (trimmed)
- Inline error messages displayed per field/row on validation failure

**Creation Behavior**
- Generate new UUID for Package Set id using `generateEntityId('package_sets')`
- Generate UUIDs for each Package id using `generateEntityId('packages')`
- Insert Package Set into `metaModel.entities.package_sets` array via dispatch
- Insert Packages into `metaModel.entities.packages` array via dispatch
- Close modal after successful creation
- Auto-select newly created Package Set in the view (set selectedPackageSetId)

**Modal Buttons**
- Footer with two buttons: Cancel (secondary), Create (primary)
- Create button disabled when validation fails
- Cancel closes modal without saving

## Visual Design
No visual mockups provided. Follow existing modal patterns from CreateBusinessLogicModal.tsx for consistent styling.

## Existing Code to Leverage

**`src/components/MetaModelView/PackageSetsView.tsx`**
- Existing read-only view for Package Sets and Packages
- Add modal state management (isModalOpen, setIsModalOpen)
- Add "Create Package Set" button in masterHeader
- Handle onCreated callback to set selectedPackageSetId

**`src/components/DiagramsView/modals/CreateBusinessLogicModal.tsx`**
- Reference modal structure with header, content, and footer sections
- Form state management pattern with useState and validation
- Field change handlers with error clearing
- Submit handler pattern with entity creation
- CSS module structure for modal styling

**`src/utils/idGenerator.ts`**
- Use `generateEntityId('package_sets')` for Package Set IDs
- Use `generateEntityId('packages')` for Package IDs
- Note: Add prefixes 'pkgset' and 'pkg' to getEntityPrefix() if not present

**`src/contexts/ArchitectureContext.tsx`**
- Use existing ADD_ENTITY action for both package_sets and packages
- Dispatch multiple ADD_ENTITY actions for Package Set then each Package
- Context already supports package_sets and packages entity types

**`src/types/model.ts`**
- PackageSet interface: { id: string; name: string }
- Package interface: { id: string; package_set_id: string; name: string; purpose?: string; sort_order?: number }
- Entity types already defined in MetaModelEntities

## Out of Scope
- Editing existing Package Sets or Packages (immutable after creation)
- Clone-and-customize functionality (Iteration 4)
- "Add from existing..." package picker (future iteration)
- Assigning Package Sets to Services (Iteration 5)
- Match rules fields for Package Sets
- Packages as a separate navigation item
- Backend API calls (all changes are local model mutations)
- Auto-save functionality (persist via manual File -> Save)
- Inline editing of Package Sets list or detail table
- Drag-and-drop reordering (use up/down buttons if implementing reorder)
