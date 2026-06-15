# Golden Run — ruby-lang / rails

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `f02178d8-9024-4441-9532-a915a6155524`
**Score:** 3.0 / 5.0
**Date:** 2026-04-25
**Adapter share:** 87%
**Total candidates:** 543

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 59 |
| `endpoints` | 201 |
| `logical_data_entities` | 0 |
| `logical_data_attributes` | 0 |
| `physical_data_entities` | 96 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 115 |
| `interface_logical_entities` | 0 |
| `business_logics` | 68 |
| `ui_screens` | 0 |
| `ui_components` | 4 |

## Notable observations from the scoring LLM

- No golden anchor exists for ruby-lang / rails, so this score is absolute and confidence is no-baseline.
- Adapter share is high at 87%, which is good for controllers, routes, models, and associations, but several important fullstack surfaces are absent.
- Major missing types: logical_data_entities, logical_data_attributes, physical_data_attributes, interface_logical_entities, and ui_screens all have zero candidates.
- Physical entity table-name inference appears naive in samples, with examples like newss, anonymoususers, and applicationrecords.
- Business logic and UI components are LLM-only; sampled rows are mostly plausible, but business_logics lack the required structured method name field.
- No deterministic flags were raised, so coverageOfObviousGaps is scored high, but per-type scoring still penalizes the zero-count surfaces.
- Duration and exact cost are unknown; cost is scored as acceptable based on modest total candidates and only 72 LLM rows.

---

<!--GOLDEN_DATA:{"runId":"f02178d8-9024-4441-9532-a915a6155524","score":3,"date":"2026-04-25","perType":{"interfaces":59,"endpoints":201,"logical_data_entities":0,"logical_data_attributes":0,"physical_data_entities":96,"physical_data_attributes":0,"logical_data_entity_relationships":115,"interface_logical_entities":0,"business_logics":68,"ui_screens":0,"ui_components":4},"adapterShare":0.8674033149171271}-->
