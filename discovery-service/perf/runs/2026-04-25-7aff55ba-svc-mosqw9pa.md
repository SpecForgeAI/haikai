# Performance Score — Run 7aff55ba...

Scored at: 2026-04-25T20:28:37.542Z  ·  Rubric v1  ·  Confidence: no-baseline

**Overall: 3.1 / 5.0**

## Run identification

- **runId:** `7aff55ba-a5e7-4e52-a159-a5265d6838ad`
- **service:** svc-mosqw9pa
- **pack combo:** python-lang / django
- **weight set:** fullstack-monolith
- **mode:** A, tier A

## Golden-anchor comparison

- No prior golden for this pack; this run becomes the seed golden if scoring succeeds.

## Deterministic flags

- **[warn] endpoints-missing-structure** — 3 endpoint candidate(s) missing httpMethod or path/url — likely hallucinations or under-extracted.

## Per-type scores

| Type | Count | Coverage | Accuracy | Metadata | Provenance | Score | Reasoning |
|---|--:|--:|--:|--:|--:|--:|---|
| `interfaces` | 1 | 1 | 5 | 5 | 4 | **3.8** | The single GraphQLView candidate appears real and has the required structured metadata. Coverage is very low for a Django application of this size because URL modules, class-based views, GraphQL schema/resolvers, and other interface surfaces are not represented. |
| `endpoints` | 3 | 0 | 1 | 0 | 2 | **0.8** | All three endpoint candidates are django_urls_placeholder rows and the deterministic flag notes that they lack httpMethod and path/url. These are pointers to URL modules rather than usable endpoint discoveries, indicating the Django urlpatterns extractor did not resolve actual routes. |
| `logical_data_entities` | 5 | 1 | 4 | 5 | 3 | **3.3** | The sampled forms and enum-like classes appear plausible and include the required name/class identifiers. Coverage is thin for a large Django/Saleor codebase, with only a few forms or LLM-derived classes and little representation of serializers, DTOs, GraphQL types, or domain data shapes. |
| `logical_data_attributes` | 22 | 1 | 4 | 5 | 2 | **3.0** | The sampled CustomerEvents constants are plausible logical attributes and have logicalEntityName and fieldName populated. However, the count is low relative to the application size and is heavily LLM-derived, suggesting the adapter is not extracting most form, serializer, enum, or schema-level logical fields. |
| `physical_data_entities` | 120 | 5 | 5 | 5 | 5 | **5.0** | The Django adapter found a strong set of model entities across modules, and the samples are real application models. Required metadata such as entityClassName and tableName is populated consistently, with fully deterministic provenance. |
| `physical_data_attributes` | 625 | 5 | 5 | 5 | 5 | **5.0** | The field extraction is strong, with real Django model fields and rich metadata including entityClassName, fieldName, columnName, fieldType, nullability, and primary-key flags. Adapter provenance is appropriate for Django ORM extraction. |
| `logical_data_entity_relationships` | 199 | 5 | 5 | 5 | 5 | **5.0** | The relationship samples correctly capture Django ForeignKey, OneToOne, and ManyToMany associations with source, target, fieldName, cardinality, and relationshipType. Some targets remain symbolic, such as settings.AUTH_USER_MODEL, but they are still grounded in the code. |
| `interface_logical_entities` | 0 | 0 | 0 | 0 | 0 | **0.0** | No mappings were produced between interfaces and logical entities. Given the discovered GraphQLView and the large Django model layer, the run should have linked API or view surfaces to domain entities. |
| `business_logics` | 318 | 4 | 4 | 2 | 4 | **3.5** | The sampled functions look like real domain or service logic and the count is substantial for this codebase. Metadata is weaker than required because samples include method/function names and parameter counts but do not populate className, and many return types are unknown. |
| `ui_screens` | 0 | 0 | 0 | 0 | 0 | **0.0** | No UI screens were found. Under the supplied fullstack-monolith weighting, this is a complete gap for server-rendered routes, templates, or screen identifiers, even if this particular Django service may be primarily API-oriented. |
| `ui_components` | 0 | 0 | 0 | 0 | 0 | **0.0** | No UI components were discovered. For the fullstack-monolith weight set this leaves the UI component surface entirely uncovered. |

## Cross-cutting axes

| Axis | Score |
|---|--:|
| Determinism | 4 |
| Hallucination rate | 4 |
| Coverage of obvious gaps | 2 |
| Cost | 5 |

## Anomalies

- No golden anchor exists for python-lang/django, so this score is absolute rather than baseline-anchored.
- Adapter share is very high at 93%, which is appropriate for deterministic Django ORM extraction, but the URL/interface extraction stage clearly under-fired.
- The main deterministic gap is endpoint extraction: all endpoint candidates are placeholders without httpMethod or path/url.
- Physical model, field, and relationship extraction is excellent and dominates the candidate volume.
- Fullstack-monolith weighting penalizes the run for zero ui_screens and ui_components, although the sampled project appears more API/backend-oriented than server-rendered UI-oriented.
- No cost anomaly is visible from the provided data; LLM volume is small at 87 rows.

---

## Raw score JSON

```json
{
  "runId": "7aff55ba-a5e7-4e52-a159-a5265d6838ad",
  "scoredAt": "2026-04-25T20:28:37.542Z",
  "rubricVersion": "1",
  "packCombo": {
    "language": "python-lang",
    "frameworks": [
      "django"
    ]
  },
  "weightSet": "fullstack-monolith",
  "goldenAnchor": {
    "runId": null,
    "score": null
  },
  "deterministicFlags": [
    {
      "code": "endpoints-missing-structure",
      "severity": "warn",
      "message": "3 endpoint candidate(s) missing httpMethod or path/url — likely hallucinations or under-extracted."
    }
  ],
  "perType": {
    "interfaces": {
      "count": 1,
      "axes": {
        "coverage": 1,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 4
      },
      "score": 3.8,
      "reasoning": "The single GraphQLView candidate appears real and has the required structured metadata. Coverage is very low for a Django application of this size because URL modules, class-based views, GraphQL schema/resolvers, and other interface surfaces are not represented."
    },
    "endpoints": {
      "count": 3,
      "axes": {
        "coverage": 0,
        "accuracy": 1,
        "metadataRichness": 0,
        "provenanceBalance": 2
      },
      "score": 0.8,
      "reasoning": "All three endpoint candidates are django_urls_placeholder rows and the deterministic flag notes that they lack httpMethod and path/url. These are pointers to URL modules rather than usable endpoint discoveries, indicating the Django urlpatterns extractor did not resolve actual routes."
    },
    "logical_data_entities": {
      "count": 5,
      "axes": {
        "coverage": 1,
        "accuracy": 4,
        "metadataRichness": 5,
        "provenanceBalance": 3
      },
      "score": 3.3,
      "reasoning": "The sampled forms and enum-like classes appear plausible and include the required name/class identifiers. Coverage is thin for a large Django/Saleor codebase, with only a few forms or LLM-derived classes and little representation of serializers, DTOs, GraphQL types, or domain data shapes."
    },
    "logical_data_attributes": {
      "count": 22,
      "axes": {
        "coverage": 1,
        "accuracy": 4,
        "metadataRichness": 5,
        "provenanceBalance": 2
      },
      "score": 3,
      "reasoning": "The sampled CustomerEvents constants are plausible logical attributes and have logicalEntityName and fieldName populated. However, the count is low relative to the application size and is heavily LLM-derived, suggesting the adapter is not extracting most form, serializer, enum, or schema-level logical fields."
    },
    "physical_data_entities": {
      "count": 120,
      "axes": {
        "coverage": 5,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 5
      },
      "score": 5,
      "reasoning": "The Django adapter found a strong set of model entities across modules, and the samples are real application models. Required metadata such as entityClassName and tableName is populated consistently, with fully deterministic provenance."
    },
    "physical_data_attributes": {
      "count": 625,
      "axes": {
        "coverage": 5,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 5
      },
      "score": 5,
      "reasoning": "The field extraction is strong, with real Django model fields and rich metadata including entityClassName, fieldName, columnName, fieldType, nullability, and primary-key flags. Adapter provenance is appropriate for Django ORM extraction."
    },
    "logical_data_entity_relationships": {
      "count": 199,
      "axes": {
        "coverage": 5,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 5
      },
      "score": 5,
      "reasoning": "The relationship samples correctly capture Django ForeignKey, OneToOne, and ManyToMany associations with source, target, fieldName, cardinality, and relationshipType. Some targets remain symbolic, such as settings.AUTH_USER_MODEL, but they are still grounded in the code."
    },
    "interface_logical_entities": {
      "count": 0,
      "axes": {
        "coverage": 0,
        "accuracy": 0,
        "metadataRichness": 0,
        "provenanceBalance": 0
      },
      "score": 0,
      "reasoning": "No mappings were produced between interfaces and logical entities. Given the discovered GraphQLView and the large Django model layer, the run should have linked API or view surfaces to domain entities."
    },
    "business_logics": {
      "count": 318,
      "axes": {
        "coverage": 4,
        "accuracy": 4,
        "metadataRichness": 2,
        "provenanceBalance": 4
      },
      "score": 3.5,
      "reasoning": "The sampled functions look like real domain or service logic and the count is substantial for this codebase. Metadata is weaker than required because samples include method/function names and parameter counts but do not populate className, and many return types are unknown."
    },
    "ui_screens": {
      "count": 0,
      "axes": {
        "coverage": 0,
        "accuracy": 0,
        "metadataRichness": 0,
        "provenanceBalance": 0
      },
      "score": 0,
      "reasoning": "No UI screens were found. Under the supplied fullstack-monolith weighting, this is a complete gap for server-rendered routes, templates, or screen identifiers, even if this particular Django service may be primarily API-oriented."
    },
    "ui_components": {
      "count": 0,
      "axes": {
        "coverage": 0,
        "accuracy": 0,
        "metadataRichness": 0,
        "provenanceBalance": 0
      },
      "score": 0,
      "reasoning": "No UI components were discovered. For the fullstack-monolith weight set this leaves the UI component surface entirely uncovered."
    }
  },
  "crossCutting": {
    "determinism": 4,
    "hallucinationRate": 4,
    "coverageOfObviousGaps": 2,
    "cost": 5
  },
  "overall": 3.1,
  "confidence": "no-baseline",
  "anomalies": [
    "No golden anchor exists for python-lang/django, so this score is absolute rather than baseline-anchored.",
    "Adapter share is very high at 93%, which is appropriate for deterministic Django ORM extraction, but the URL/interface extraction stage clearly under-fired.",
    "The main deterministic gap is endpoint extraction: all endpoint candidates are placeholders without httpMethod or path/url.",
    "Physical model, field, and relationship extraction is excellent and dominates the candidate volume.",
    "Fullstack-monolith weighting penalizes the run for zero ui_screens and ui_components, although the sampled project appears more API/backend-oriented than server-rendered UI-oriented.",
    "No cost anomaly is visible from the provided data; LLM volume is small at 87 rows."
  ]
}
```
