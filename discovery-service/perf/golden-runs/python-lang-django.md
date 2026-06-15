# Golden Run — python-lang / django

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `7aff55ba-a5e7-4e52-a159-a5265d6838ad`
**Score:** 3.1 / 5.0
**Date:** 2026-04-25
**Adapter share:** 93%
**Total candidates:** 1,293

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 1 |
| `endpoints` | 3 |
| `logical_data_entities` | 5 |
| `logical_data_attributes` | 22 |
| `physical_data_entities` | 120 |
| `physical_data_attributes` | 625 |
| `logical_data_entity_relationships` | 199 |
| `interface_logical_entities` | 0 |
| `business_logics` | 318 |
| `ui_screens` | 0 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- No golden anchor exists for python-lang/django, so this score is absolute rather than baseline-anchored.
- Adapter share is very high at 93%, which is appropriate for deterministic Django ORM extraction, but the URL/interface extraction stage clearly under-fired.
- The main deterministic gap is endpoint extraction: all endpoint candidates are placeholders without httpMethod or path/url.
- Physical model, field, and relationship extraction is excellent and dominates the candidate volume.
- Fullstack-monolith weighting penalizes the run for zero ui_screens and ui_components, although the sampled project appears more API/backend-oriented than server-rendered UI-oriented.
- No cost anomaly is visible from the provided data; LLM volume is small at 87 rows.

---

<!--GOLDEN_DATA:{"runId":"7aff55ba-a5e7-4e52-a159-a5265d6838ad","score":3.1,"date":"2026-04-25","perType":{"interfaces":1,"endpoints":3,"logical_data_entities":5,"logical_data_attributes":22,"physical_data_entities":120,"physical_data_attributes":625,"logical_data_entity_relationships":199,"interface_logical_entities":0,"business_logics":318,"ui_screens":0,"ui_components":0},"adapterShare":0.9327146171693735}-->
