# Golden Run — python-lang / flask

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `13707813-0896-4c9b-8c24-0cda1badfc2f`
**Score:** 2.9 / 5.0
**Date:** 2026-04-25
**Adapter share:** 100%
**Total candidates:** 75

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 0 |
| `endpoints` | 26 |
| `logical_data_entities` | 9 |
| `logical_data_attributes` | 23 |
| `physical_data_entities` | 5 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 12 |
| `interface_logical_entities` | 0 |
| `business_logics` | 0 |
| `ui_screens` | 0 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- Adapter share is 100% with zero LLM contribution; although deterministic Flask extraction is useful for routes and models, the rubric treats an all-adapter run as a likely skipped or failed gap-fill stage.
- No deterministic flags were raised, but baseline-relative gaps are substantial: physical_data_attributes dropped from 29 to 0 and business_logics dropped from 40 to 0.
- Endpoint, WTForms logical entity, logical attribute, and physical entity extraction are strong and mostly metadata-rich.
- Relationship extraction is only partially useful because targetEntity is unresolved as 'unknown' throughout the sample and some cardinalities appear semantically wrong.
- Cost is likely favorable due to no LLM rows, but duration and explicit dollar cost are unknown.

---

<!--GOLDEN_DATA:{"runId":"13707813-0896-4c9b-8c24-0cda1badfc2f","score":2.9,"date":"2026-04-25","perType":{"interfaces":0,"endpoints":26,"logical_data_entities":9,"logical_data_attributes":23,"physical_data_entities":5,"physical_data_attributes":0,"logical_data_entity_relationships":12,"interface_logical_entities":0,"business_logics":0,"ui_screens":0,"ui_components":0},"adapterShare":1}-->
