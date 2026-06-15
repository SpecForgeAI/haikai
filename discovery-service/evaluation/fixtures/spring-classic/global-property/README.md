# global-property

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/GlobalProperty.java
- **Category**: known blind spot (HBM XML mapping)

## Why this fixture

This class is a real OpenMRS entity persisted to the `global_property` table, but it relies on the **legacy HBM XML mapping** (`api/src/main/resources/org/openmrs/api/db/hibernate/*.hbm.xml`) rather than JPA annotations. The Jakarta-Persistence-driven `springClassicFrameworkPack` cannot see HBM-only entities, so it emits zero candidates. This is the canonical HBM-XML blind spot the spec calls out.

## Notes

All three expected entries are `'gap-fill'` — the deterministic pack cannot recover the entity status or key/value columns. The LLM gap-fill stage should surface `GlobalProperty` + its `property` / `propertyValue` columns from the Javadoc ("simple key-value pairs persisted in the database") plus the `@Cacheable` / `@Audited` side-channel annotations. Pack recall for this fixture is `0/0 = NaN`; gap-fill recall carries the weight.
