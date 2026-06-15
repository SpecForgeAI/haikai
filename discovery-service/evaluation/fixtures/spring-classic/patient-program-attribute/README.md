# patient-program-attribute

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/PatientProgramAttribute.java
- **Category**: known blind spot (HBM XML + generic-parameter relationship)

## Why this fixture

A second HBM-XML-mapped entity (see also `global-property`). Unlike `GlobalProperty`, this one also exercises the generic-parameter relationship pattern (`BaseAttribute<ProgramAttributeType, PatientProgram>`) — so the entity, its PK, and its owner-relationship are ALL invisible to the Jakarta-Persistence pack. Pure gap-fill recall test for the HBM-XML blind spot combined with the inherited-generic-parameter blind spot.

## Notes

Pack emits zero candidates; all three expected entries are `'gap-fill'`. Complements `global-property` (which is a simpler HBM blind spot without the generic-parameter twist) and `concept-attribute` (which exercises @AssociationOverride on the generic-parameter form).
