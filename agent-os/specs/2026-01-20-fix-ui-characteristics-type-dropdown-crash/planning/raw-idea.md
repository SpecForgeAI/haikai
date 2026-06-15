# Raw Idea

**Feature Name:** Fix UI Characteristics Type Dropdown Crash

**Description:**
Fix the runtime crash when clicking "Add Row" in the UI Characteristics grid, plus add pretty label display for dropdown options.

GOAL
1) Fix the runtime crash when clicking "Add Row" in the UI Characteristics grid.
2) Optional improvement: Keep dropdown option values as strings, but display human-friendly labels in the dropdown UI (e.g. "Business Feature" instead of "business_feature"), without changing the stored value.

ROOT CAUSE
DropdownCell expects `options: string[]` and renders `<option>{option}</option>`.
UI Characteristics passed `options` as `{value,label}[]`, so React attempted to render objects, causing:
- "Objects are not valid as a React child (found: object with keys {value, label})"
- duplicate key warnings (key becomes "[object Object]")

SCOPE
Frontend only (no backend changes).

PART A — BUG FIX (required)
Update the UI Characteristics grid config to pass string options for the Type dropdown.

PART B — OPTIONAL IMPROVEMENT
Make DropdownCell display a human-friendly label while still storing the raw string value using a formatOptionLabel helper.
