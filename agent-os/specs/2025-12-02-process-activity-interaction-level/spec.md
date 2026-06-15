# Specification: Process Activity User Interaction Level Update

## Goal
Replace the confusing two-field approach (is_manual + user_input_amount) with a single user_interaction_level enum, and ensure diagram colours update automatically when this value changes.

## User Stories
- As a modeler, I want a single clear field for user interaction level so that I don't have to reason about is_manual + user_input_amount combinations.
- As a diagram author, I want activity colours to reflect interaction level so that I can visually distinguish automated from manual activities.

## Specific Requirements

**Meta-model Schema Changes**
- Remove `is_manual: boolean` field from ProcessActivity interface in model.ts
- Remove `user_input_amount: UserInputAmount` field from ProcessActivity interface
- Add `user_interaction_level: UserInteractionLevel` field to ProcessActivity interface
- Define UserInteractionLevel type as `"AUTOMATED" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"`
- Remove the existing `UserInputAmount` type definition (`'NA' | 'MINIMAL' | 'MODERATE' | 'SIGNIFICANT'`)
- Default value for new process_activity rows: `"AUTOMATED"`

**Migration / Backwards Compatibility**
- In buildModelFromData (fileOperations.ts), add migration logic for old fields
- Migration mapping: `is_manual=false` (any user_input_amount) -> `"AUTOMATED"`
- Migration mapping: `is_manual=true` + `user_input_amount="MINIMAL"` -> `"MINIMAL"`
- Migration mapping: `is_manual=true` + `user_input_amount="MODERATE"` -> `"MODERATE"`
- Migration mapping: `is_manual=true` + `user_input_amount="SIGNIFICANT"` -> `"SIGNIFICANT"`
- Default fallback when neither pattern matches: `"AUTOMATED"`
- On save, only persist `user_interaction_level` (do not write old fields to JSON)

**Grid Configuration Changes**
- Update process_activities grid config in gridConfigs.ts
- Remove "Is Manual" column (field: `is_manual`, cellType: `boolean`)
- Remove "User Input Amount" column (field: `user_input_amount`, cellType: `dropdown`)
- Add single "User Interaction Level" column (field: `user_interaction_level`, cellType: `dropdown`)
- Options: Automated, Minimal, Moderate, Significant (display labels for AUTOMATED, MINIMAL, MODERATE, SIGNIFICANT)
- Column is required; no conditional enable/disable logic needed

**Defaults Configuration Changes**
- Remove `userInputAmountOptions` array from defaults.ts
- Add `userInteractionLevelOptions` array: `['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT']`
- Update `processActivityColors` to use UserInteractionLevel keys instead of UserInputAmount
- Rename `getProcessActivityDefaultFill` to reference `user_interaction_level` instead of `user_input_amount`

**Validation Changes**
- Remove `validateProcessActivityConstraints` function from validation.ts (no longer needed)
- Remove `formatProcessActivityConstraintErrorMessage` function from validation.ts
- Remove call to `validateProcessActivityConstraints` in `validateModel` function
- Update required field validation to include `user_interaction_level` (handled by grid config `required: true`)
- Remove any references to `is_manual` or `user_input_amount` in error message formatters

**Diagram Rendering**
- Update `getProcessActivityDefaultFill` helper in defaults.ts (or rename appropriately)
- Colour mapping: `AUTOMATED` -> medium green (#a5d6a7)
- Colour mapping: `MINIMAL` -> light green (#c8e6c9)
- Colour mapping: `MODERATE` -> light yellow (#fff9c4)
- Colour mapping: `SIGNIFICANT` -> light red (#ffcdd2)
- Update `processActivityColors` Record to use `UserInteractionLevel` type as key
- Colours are derived at render time from meta-model state, not persisted

**Live Update Behaviour**
- Diagram renderer consumes process_activity from shared ArchitectureContext
- When grid updates `user_interaction_level`, context state updates trigger React re-render
- On re-render, renderer recomputes fill colours via `getProcessActivityDefaultFill`
- No manual refresh or JSON reload required

## Existing Code to Leverage

**ProcessActivity interface in model.ts (lines 33-47)**
- Current interface contains `is_manual: boolean` and `user_input_amount: UserInputAmount`
- UserInputAmount type defined on line 31: `'NA' | 'MINIMAL' | 'MODERATE' | 'SIGNIFICANT'`
- Replace UserInputAmount with new UserInteractionLevel type

**process_activities grid config in gridConfigs.ts (lines 31-43)**
- Contains "Is Manual" (boolean) and "User Input Amount" (dropdown) columns
- Uses `userInputAmountOptions` from defaults.ts
- Replace with single "User Interaction Level" dropdown column

**getProcessActivityDefaultFill in defaults.ts (lines 317-320)**
- Reads `activity.user_input_amount` and returns colour from `processActivityColors`
- Update to read `activity.user_interaction_level` instead
- Maps to colour palette based on interaction level

**processActivityColors in defaults.ts (lines 303-308)**
- Currently keyed by UserInputAmount: NA, MINIMAL, MODERATE, SIGNIFICANT
- Update keys to UserInteractionLevel: AUTOMATED, MINIMAL, MODERATE, SIGNIFICANT
- Update colour values per spec (AUTOMATED=#a5d6a7, MINIMAL=#c8e6c9, etc.)

**buildModelFromData in fileOperations.ts (lines 110-144)**
- Parses JSON and builds ArchitectureModel
- Add migration logic for old `is_manual`/`user_input_amount` fields before returning process_activities

## Out of Scope
- Changes to other ProcessActivity fields (actor_hint, sequence_order, name, description, tags, valid_from, valid_to)
- New process activity features beyond field consolidation
- Changes to other entity types (BusinessProcess, Application, etc.)
- Changes to diagram layout or positioning logic
- Backend/API changes (this is frontend-only scope)
- Performance optimizations beyond standard React re-render behaviour
- Changes to ActorHint field or options
- New validation rules beyond required field check
- Changes to ProcessActivity cascade delete behaviour
- Changes to relationship edges involving ProcessActivity
