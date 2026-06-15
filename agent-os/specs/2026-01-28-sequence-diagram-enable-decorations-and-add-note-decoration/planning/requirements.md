# Spec Requirements: Sequence Diagram - Enable Decorations and Add Note Decoration

## Initial Description
Allow "Decorations" to be added to diagrams of type="Sequence" (in addition to the existing rule-driven sequence rendering of Participants, Message Exchanges, and Fragments). Introduce a new Decoration type "Note" styled like a post-it note (folded corner + text). Decorations are an optional overlay layer that do not affect sequence layout rules, behave the same across diagram types (drag, resize, edit text), and persist with the diagram.

## Requirements Discussion

### First Round Questions

**Q1:** Should the decoration rendering layer be rendered inside the SequenceDiagramRenderer or as a separate overlay pass after it?
**Answer:** Render AFTER the SequenceDiagramRenderer (separate overlay pass), not inside it.

**Q2:** Should the folded corner be positioned at the top-left or the UML-standard top-right?
**Answer:** Top-left corner (as originally stated), not UML top-right.

**Q3:** Should we add "Note" as a new value on the existing ShapeDecorationType enum and reuse the same ShapeDecoration interface?
**Answer:** Yes. Add "Note" as a new value on the existing ShapeDecorationType enum and reuse the same ShapeDecoration interface.

**Q4:** What stroke width should the note border use?
**Answer:** 3px stroke width.

**Q5:** What exact colour should be used for the post-it yellow fill?
**Answer:** Use #FFEB3B (fine to tweak slightly later).

**Q6:** Is a DB migration needed, or can we reuse existing diagram decorations storage?
**Answer:** Confirmed. No DB migration needed; reuse existing diagram decorations storage.

**Q7:** Are there any interaction conflicts between decorations and existing sequence diagram elements (participants, messages, fragments)?
**Answer:** No new conflicts. Decorations behave exactly like in General diagrams and must not affect sequence elements.

**Q8:** Are there any explicit exclusions or non-goals beyond what was stated in the raw idea?
**Answer:** No sticky/fixed notes. No new styling controls. No changes to export/print behavior beyond existing decoration handling.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: General diagram decorations - existing decoration rendering, palette, and persistence logic used by General diagrams should be reused directly for Sequence diagrams.
- Feature: ShapeDecorationType enum and ShapeDecoration interface - extend with "Note" value.
- Feature: SequenceDiagramRenderer - decoration overlay pass will render after this component.

### Follow-up Questions
No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Enable the existing Decorations panel for Sequence diagram type so users can add any existing decoration onto a Sequence diagram.
- Add "Note" as a new ShapeDecorationType value, reusing the existing ShapeDecoration interface.
- Render the Note decoration as an SVG rectangle with a folded top-left corner, 3px black stroke, #FFEB3B yellow fill, and centered editable text.
- Render all decorations as a separate overlay pass AFTER the SequenceDiagramRenderer, not inside it.
- Decorations persist on save and reload for Sequence diagrams using existing diagram decorations storage (no DB migration).
- Decorations support the same interactions as General diagrams: select, drag, resize, edit text.

### Reusability Opportunities
- Reuse existing General diagram decoration rendering, palette, and persistence logic.
- Extend existing ShapeDecorationType enum with "Note" value.
- Reuse existing ShapeDecoration interface fields (id, type, x, y, width, height, rotation, text, textAlign, verticalAlign, style).
- Reuse existing diagram decorations storage/persistence pipeline (no new DB schema).

### Scope Boundaries
**In Scope:**
- Enabling Decorations panel for Sequence diagrams
- Adding "Note" decoration type to the palette
- Rendering Note with post-it styling (folded top-left corner, #FFEB3B fill, 3px black stroke, centered text)
- Separate overlay rendering pass after SequenceDiagramRenderer
- Save/load of decorations for Sequence diagrams via existing storage
- Backward compatibility (existing Sequence diagrams load with empty decorations list)

**Out of Scope:**
- Sticky/fixed notes behavior
- New decoration styling controls or UI
- Changes to export/print behavior beyond existing decoration handling
- Changes to sequence layout rules based on decorations
- DB migration

### Technical Considerations
- Decoration overlay must not interfere with participant/message/fragment selection or layout.
- Backward compatibility: if decorations are missing from a Sequence diagram, treat as empty list.
- Post-it yellow (#FFEB3B) may be tweaked slightly later.
- Layering approach should match General diagrams.
