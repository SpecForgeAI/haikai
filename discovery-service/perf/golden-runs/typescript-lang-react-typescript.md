# Golden Run — typescript-lang / react-typescript

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `9c4f51d6-ec16-4baf-b345-233180e47fb3`
**Score:** 4.1 / 5.0
**Date:** 2026-04-25
**Adapter share:** 65%
**Total candidates:** 782

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 0 |
| `endpoints` | 43 |
| `logical_data_entities` | 122 |
| `logical_data_attributes` | 343 |
| `physical_data_entities` | 0 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 9 |
| `interface_logical_entities` | 0 |
| `business_logics` | 203 |
| `ui_screens` | 9 |
| `ui_components` | 53 |

## Notable observations from the scoring LLM

- Adapter share is 65%, which is well aligned with a React/TypeScript pack and indicates healthy deterministic extraction without suppressing LLM gap fill entirely.
- No deterministic flags were raised, and the core frontend-weighted surfaces—endpoints, screens, and components—are all present with solid quality.
- Two weighted gaps stand out: interfaces and interface_logical_entities are both entirely absent despite the repo clearly containing many TypeScript data shapes and API-facing structures.
- Hallucination risk appears low-to-moderate overall; sampled LLM rows for logical attributes and relationships are plausible, but relationship extraction is fully LLM-based and should receive spot review.
- Cost cannot be benchmarked confidently because duration and pack baseline are unavailable, so the score is conservative rather than punitive.

---

<!--GOLDEN_DATA:{"runId":"9c4f51d6-ec16-4baf-b345-233180e47fb3","score":4.1,"date":"2026-04-25","perType":{"interfaces":0,"endpoints":43,"logical_data_entities":122,"logical_data_attributes":343,"physical_data_entities":0,"physical_data_attributes":0,"logical_data_entity_relationships":9,"interface_logical_entities":0,"business_logics":203,"ui_screens":9,"ui_components":53},"adapterShare":0.6508951406649617}-->
