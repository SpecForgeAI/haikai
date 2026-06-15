# Golden Run — java-lang / spring-classic

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `d6b40127-309a-44ee-8c8b-aba475e6457c`
**Score:** 4.0 / 5.0
**Date:** 2026-04-25
**Adapter share:** 65%
**Total candidates:** 3,511

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 124 |
| `endpoints` | 1 |
| `logical_data_entities` | 69 |
| `logical_data_attributes` | 257 |
| `physical_data_entities` | 129 |
| `physical_data_attributes` | 773 |
| `logical_data_entity_relationships` | 334 |
| `interface_logical_entities` | 99 |
| `business_logics` | 1725 |
| `ui_screens` | 0 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- Adapter share is 65%, which is well aligned with expectations for Java/Spring classic and indicates the deterministic pack is functioning.
- The major weakness is endpoint extraction: only a single LLM-only HL7-style endpoint was emitted, which is likely a substantial undercount for a codebase of this size.
- Logical data entities show some classification drift, with DAOs, listeners, and handler-style classes appearing among entity candidates.
- Physical data attributes have metadata-quality issues in sample rows because several omit required columnName values.
- Business logic volume is very high but sampled rows are credible; no strong evidence of widespread hallucination is visible in the provided samples.
- No deterministic flags were raised, but the endpoint scarcity remains a notable likely gap not captured by the precomputed checks.
- Cost cannot be benchmarked precisely because duration and pack-relative spend norms were not provided; score is conservative-neutral.

---

<!--GOLDEN_DATA:{"runId":"d6b40127-309a-44ee-8c8b-aba475e6457c","score":4,"date":"2026-04-25","perType":{"interfaces":124,"endpoints":1,"logical_data_entities":69,"logical_data_attributes":257,"physical_data_entities":129,"physical_data_attributes":773,"logical_data_entity_relationships":334,"interface_logical_entities":99,"business_logics":1725,"ui_screens":0,"ui_components":0},"adapterShare":0.6539447450868698}-->
