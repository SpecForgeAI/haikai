# Raw Idea

## Title
Add File menu (Open/Save/Import/Export Meta-Model) and remove top-right JSON buttons

## Summary
Replace the "Architecture Tool" label and separate "Load JSON" / "Save" buttons with a unified File menu in the top bar. The File menu will contain: Open (existing Load JSON), Save (existing Save), Import Meta-Model (from Excel), and Export Meta-Model (to Excel). The Meta-model / Diagrams tabs remain centred. The right side of the top bar is left empty.

## Key Changes

### 1. Top bar layout changes
- Left: File menu button (replaces "Architecture Tool" label)
- Centre: [ Meta-model ] [ Diagrams ] (unchanged)
- Right: empty (remove Load JSON / Save buttons)

### 2. File menu items
- Open - reuses existing Load JSON handler
- Save - reuses existing Save handler
- Import Meta-Model - import from Excel (.xlsx)
- Export Meta-Model - export to Excel (.xlsx)

### 3. Excel Import (Import Meta-Model)
- Open browser file chooser for .xlsx files
- Use JS XLSX library to read workbook
- Each worksheet = one meta-model entity/relationship table
- Worksheet names match UI tab names (with <-> replaced by hyphen for relationships)
- Append rows to existing meta-model (don't overwrite)
- Validate: duplicate IDs, missing required columns
- Show import summary modal with success counts and errors

### 4. Excel Export (Export Meta-Model)
- Generate .xlsx workbook in memory
- One worksheet per entity table and relationship table
- Column headers match UI column labels
- Trigger browser download

### 5. Acceptance Criteria
- AC1: Top bar layout updated (File menu left, tabs center, right empty)
- AC2: Open/Save behave identically to previous buttons
- AC3: Import Meta-Model appends rows from Excel, shows summary
- AC4: Export Meta-Model downloads .xlsx with all meta-model tables
- AC5: Backward compatibility with JSON Open/Save
