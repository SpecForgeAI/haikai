# Spec Requirements: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response

## Initial Description
For Sequence Diagram Message Exchanges where Request Content is a Reference to an InterfaceEndpoint:
- Provide an endpoint-specific response mode ("Endpoint Response") when "Include Response Message" is enabled.
- Replace the single-line label (endpoint name) with a configurable multi-line label that can show:
    1. Endpoint Name
    2. Verb + Path
    3. Request/Response Data (derived from the InterfaceEndpoint's request/response data entity point FKs)
- Require the user to select at least one "What to Show?" option.
- Add new database columns (show_endpoint_name, show_endpoint_verb_path, show_endpoint_req_res_data, response_mode) to sequence_messages table.
- Render multi-line labels on the sequence diagram arrows based on selected options.
- Add "Endpoint Response" as a third response content radio option when the request references an InterfaceEndpoint.

## Requirements Discussion

### First Round Questions

**Q1:** SequenceMessageEntity.java is missing the isCollection field that was added in a prior spec. Should we fix this as part of this spec or leave it for a separate fix?
**Answer:** Leave as-is for THIS spec. Fix in a separate spec.

**Q2:** Where should the "What to Show?" checkbox group be placed in the Add Message Exchange drawer?
**Answer:** Immediately after the InterfaceEndpoint Reference picker, before "Is Collection?".

**Q3:** What should the radio button order be for the Response Content options, and what happens to other controls when "Endpoint Response" is selected?
**Answer:** Radio order: Label Text / Reference / Endpoint Response. When "Endpoint Response" is selected, hide the Reference Type and Reference picker controls.

**Q4:** How should multi-line labels be handled in the renderer when labels can be up to 3 lines?
**Answer:** Increase row height/vertical spacing as needed for up to 3 lines. No overlap allowed.

**Q5:** How should data entity point IDs (dep_log_*/dep_phy_* FKs) be resolved to display names?
**Answer:** Reuse existing resolver if present; otherwise create a small utility that maps dep_log_*/dep_phy_* IDs to entity name via meta-model.

**Q6:** How should backward compatibility work for existing InterfaceEndpoint messages that lack the new fields?
**Answer:** Defaults should preserve current behavior. For existing InterfaceEndpoint messages, default to showing endpoint name. Treat "all flags missing" as legacy -- show name. So effectively show_endpoint_name=true for legacy records.

**Q7:** Should request and response labels have any visual distinction (prefixes, styling)?
**Answer:** No extra prefixes. Labels are just the selected lines. Request/response distinction via arrow style (solid vs dashed) only.

### Existing Code to Reference
No similar existing features were explicitly identified for reference.

### Follow-up Questions
No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Add "What to Show?" checkbox group (Name, Verb and Path, Request/Response Data) that appears when request references an InterfaceEndpoint
- Place "What to Show?" immediately after the InterfaceEndpoint Reference picker, before "Is Collection?"
- Default selection: Verb and Path = checked, Request/Response Data = checked, Name = unchecked
- Validation: at least one checkbox must be selected
- Add "Endpoint Response" as third radio option in response content section, ordered: Label Text / Reference / Endpoint Response
- When "Endpoint Response" is selected, hide Reference Type and Reference picker controls
- Response implicitly uses the same InterfaceEndpoint as the request
- Render multi-line labels on sequence diagram arrows based on selected "What to Show?" options
- Increase row height/vertical spacing for up to 3 lines of label text; no overlap allowed
- Resolve data entity point IDs to display names via existing resolver or new utility mapping dep_log_*/dep_phy_* IDs to entity name via meta-model
- Request/response distinction via arrow style only (solid vs dashed); no label prefixes

### Reusability Opportunities
- Existing data entity point ID resolver (if one exists) should be reused
- If no resolver exists, create a small utility for mapping dep_log_*/dep_phy_* IDs to entity names

### Scope Boundaries
**In Scope:**
- "What to Show?" checkbox group in Add Message Exchange drawer
- "Endpoint Response" radio option for response content
- Multi-line label rendering on sequence diagram arrows
- Database migration adding 4 new columns to sequence_messages
- Entity/DTO mapping for new fields
- Data entity point ID resolution utility (if needed)
- Backward compatibility: legacy records default to show_endpoint_name=true

**Out of Scope:**
- isCollection entity fix on SequenceMessageEntity.java (separate spec)
- Changes to InterfaceEndpoint meta-model
- Changes to message routing, lifeline layout, fragments, or spacing beyond label height
- Export/print changes
- New reference types or changes to existing reference rendering
- Auto-generation of request/response data
- User-configurable templates beyond the 3 options
- Label prefixes for request vs response distinction

### Technical Considerations
- Database: Add columns show_endpoint_name, show_endpoint_verb_path, show_endpoint_req_res_data (BOOLEAN), response_mode (TEXT) to sequence_messages table via Liquibase
- Backward compatibility: treat "all flags missing/false" as legacy and render endpoint name (effectively show_endpoint_name=true)
- Validation: if reference_type != InterfaceEndpoint, response_mode must be "normal"
- Validation: if InterfaceEndpoint, at least one show_* flag must be true
- Row height in renderer must accommodate up to 3 lines without overlap
