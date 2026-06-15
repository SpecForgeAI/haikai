# Golden Run — java-lang / java-spring-boot

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `c639f908-f001-460f-a8a3-5c8c759c1854`
**Score:** 4.7 / 5.0
**Date:** 2026-04-26
**Adapter share:** 100%
**Total candidates:** 531

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 11 |
| `endpoints` | 47 |
| `logical_data_entities` | 31 |
| `logical_data_attributes` | 193 |
| `physical_data_entities` | 19 |
| `physical_data_attributes` | 127 |
| `logical_data_entity_relationships` | 18 |
| `interface_logical_entities` | 31 |
| `business_logics` | 54 |
| `ui_screens` | 0 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- No deterministic flags were raised, and all major Spring Boot backend surfaces are present.
- Counts are very close to the golden anchor: interfaces, physical entities, physical attributes, and relationships match exactly; endpoints and DTO-derived logical surfaces are slightly higher.
- Adapter provenance is extremely high at 529 of 531 candidates, which is appropriate for annotation-rich Spring/JPA extraction and matches the historical anchor, though it leaves little LLM gap-fill contribution to assess.
- Duration and concrete cost were not provided, but total candidate volume and provenance mix do not suggest runaway prompt usage.

---

<!--GOLDEN_DATA:{"runId":"c639f908-f001-460f-a8a3-5c8c759c1854","score":4.7,"date":"2026-04-26","perType":{"interfaces":11,"endpoints":47,"logical_data_entities":31,"logical_data_attributes":193,"physical_data_entities":19,"physical_data_attributes":127,"logical_data_entity_relationships":18,"interface_logical_entities":31,"business_logics":54,"ui_screens":0,"ui_components":0},"adapterShare":0.9962335216572504}-->
