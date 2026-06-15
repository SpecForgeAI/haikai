# Performance Score — Run a7dc5c6c...

Scored at: 2026-04-25T20:05:56.687Z  ·  Rubric v1  ·  Confidence: baseline-anchored

**Overall: 3.7 / 5.0**

## Run identification

- **runId:** `a7dc5c6c-b518-47e0-81b7-5c6794e43695`
- **service:** svc-mob4f5ai
- **pack combo:** java-lang / java-spring-boot
- **weight set:** backend-service
- **mode:** A, tier A

## Golden-anchor comparison

- **Compared against:** golden runId `526f24fa...` (score 4.4)
- **Δ vs golden:** -0.7 

## Per-type scores

| Type | Count | Coverage | Accuracy | Metadata | Provenance | Score | Reasoning |
|---|--:|--:|--:|--:|--:|--:|---|
| `interfaces` | 6 | 3 | 5 | 5 | 4 | **4.3** | The controller/interface rows shown are clearly real Spring MVC components with strong structured metadata. Coverage is materially below the golden anchor (6 vs 11), suggesting partial extraction of the web surface, but provenance is still acceptable because this pack is adapter-strong. |
| `endpoints` | 17 | 2 | 5 | 5 | 4 | **4.0** | Sampled endpoints are accurate and richly annotated with methods, paths, controller class, and parameter context. However, count is far below the baseline for this pack (17 vs 43), so endpoint coverage looks notably incomplete despite good deterministic extraction quality. |
| `logical_data_entities` | 1 | 0 | 4 | 5 | 3 | **3.0** | Only a single logical entity (Vets) was emitted, which is dramatically below the anchor and inconsistent with the evident domain model in Petclinic. The one row is legitimate and well-formed, but logical-entity extraction is effectively missing as a surface. |
| `logical_data_attributes` | 1 | 0 | 5 | 5 | 3 | **3.3** | The emitted attribute is valid and fully structured, but one logical attribute for the whole application is far below expectation and strongly indicates that this extractor barely fired. Provenance is only middling because a pack this deterministic should expose much more than a singleton row. |
| `physical_data_entities` | 6 | 2 | 5 | 5 | 4 | **4.0** | All sampled entities are real JPA-backed domain entities with solid table/class metadata. Coverage is still materially under the anchor (6 vs 19), so important persistence entities or mapped classes appear to be missing. |
| `physical_data_attributes` | 19 | 2 | 5 | 5 | 4 | **4.0** | The sampled attribute rows are high quality, including inherited fields, PK markers, nullability, and column names. But 19 attributes versus a 127-row anchor is a large shortfall, indicating only a subset of entity fields were captured. |
| `logical_data_entity_relationships` | 4 | 2 | 5 | 5 | 4 | **4.0** | The relationships shown are credible and structurally rich, with direction, cardinality, field names, and join context. Coverage is well below the baseline (4 vs 18), so relationship extraction seems partial even though what is present is trustworthy. |
| `interface_logical_entities` | 1 | 0 | 5 | 5 | 3 | **3.3** | The single mapping from VetController to Vets is plausible and correctly structured. Still, one interface-to-entity linkage in a Spring MVC CRUD app is far below expectation, indicating this join surface is mostly absent. |
| `business_logics` | 2 | 0 | 4 | 4 | 3 | **2.8** | Both rows are real methods, but they represent only validator methods and miss the much broader service/domain logic expected in the codebase relative to the 57-row anchor. Metadata is decent but not especially rich, and overall this type appears severely under-extracted. |
| `ui_screens` | 0 | 0 | 0 | 0 | 0 | **0.0** | No UI screens were emitted. This type is not weighted for the backend-service pack, so it does not affect the overall score. |
| `ui_components` | 0 | 0 | 0 | 0 | 0 | **0.0** | No UI components were emitted. This type is not weighted for the backend-service pack, so it does not affect the overall score. |

## Cross-cutting axes

| Axis | Score |
|---|--:|
| Determinism | 2 |
| Hallucination rate | 5 |
| Coverage of obvious gaps | 3 |
| Cost | 4 |

## Anomalies

- Run is entirely adapter-derived (100% adapter, 0% LLM), which is acceptable for a strong Java/Spring pack but falls outside the rubric's ideal mixed pattern and may indicate no gap-fill stage contribution.
- Coverage is consistently well below the golden anchor across most weighted types: endpoints 17 vs 43, business_logics 2 vs 57, logical_data_entities 1 vs 27, and physical_data_attributes 19 vs 127.
- Accuracy and metadata quality of emitted rows are strong; the weakness is primarily breadth rather than noise.
- No deterministic heuristic flags were raised, so this looks more like partial extraction than a completely failed pack.
- Cost appears likely favorable because the run is small and adapter-only, with no evidence of runaway LLM usage.

---

## Raw score JSON

```json
{
  "runId": "a7dc5c6c-b518-47e0-81b7-5c6794e43695",
  "scoredAt": "2026-04-25T20:05:56.687Z",
  "rubricVersion": "1",
  "packCombo": {
    "language": "java-lang",
    "frameworks": [
      "java-spring-boot"
    ]
  },
  "weightSet": "backend-service",
  "goldenAnchor": {
    "runId": "526f24fa-176b-46de-8c0b-e758b3ed868a",
    "score": 4.4
  },
  "deterministicFlags": [],
  "perType": {
    "interfaces": {
      "count": 6,
      "axes": {
        "coverage": 3,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 4
      },
      "score": 4.3,
      "reasoning": "The controller/interface rows shown are clearly real Spring MVC components with strong structured metadata. Coverage is materially below the golden anchor (6 vs 11), suggesting partial extraction of the web surface, but provenance is still acceptable because this pack is adapter-strong."
    },
    "endpoints": {
      "count": 17,
      "axes": {
        "coverage": 2,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 4
      },
      "score": 4,
      "reasoning": "Sampled endpoints are accurate and richly annotated with methods, paths, controller class, and parameter context. However, count is far below the baseline for this pack (17 vs 43), so endpoint coverage looks notably incomplete despite good deterministic extraction quality."
    },
    "logical_data_entities": {
      "count": 1,
      "axes": {
        "coverage": 0,
        "accuracy": 4,
        "metadataRichness": 5,
        "provenanceBalance": 3
      },
      "score": 3,
      "reasoning": "Only a single logical entity (Vets) was emitted, which is dramatically below the anchor and inconsistent with the evident domain model in Petclinic. The one row is legitimate and well-formed, but logical-entity extraction is effectively missing as a surface."
    },
    "logical_data_attributes": {
      "count": 1,
      "axes": {
        "coverage": 0,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 3
      },
      "score": 3.3,
      "reasoning": "The emitted attribute is valid and fully structured, but one logical attribute for the whole application is far below expectation and strongly indicates that this extractor barely fired. Provenance is only middling because a pack this deterministic should expose much more than a singleton row."
    },
    "physical_data_entities": {
      "count": 6,
      "axes": {
        "coverage": 2,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 4
      },
      "score": 4,
      "reasoning": "All sampled entities are real JPA-backed domain entities with solid table/class metadata. Coverage is still materially under the anchor (6 vs 19), so important persistence entities or mapped classes appear to be missing."
    },
    "physical_data_attributes": {
      "count": 19,
      "axes": {
        "coverage": 2,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 4
      },
      "score": 4,
      "reasoning": "The sampled attribute rows are high quality, including inherited fields, PK markers, nullability, and column names. But 19 attributes versus a 127-row anchor is a large shortfall, indicating only a subset of entity fields were captured."
    },
    "logical_data_entity_relationships": {
      "count": 4,
      "axes": {
        "coverage": 2,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 4
      },
      "score": 4,
      "reasoning": "The relationships shown are credible and structurally rich, with direction, cardinality, field names, and join context. Coverage is well below the baseline (4 vs 18), so relationship extraction seems partial even though what is present is trustworthy."
    },
    "interface_logical_entities": {
      "count": 1,
      "axes": {
        "coverage": 0,
        "accuracy": 5,
        "metadataRichness": 5,
        "provenanceBalance": 3
      },
      "score": 3.3,
      "reasoning": "The single mapping from VetController to Vets is plausible and correctly structured. Still, one interface-to-entity linkage in a Spring MVC CRUD app is far below expectation, indicating this join surface is mostly absent."
    },
    "business_logics": {
      "count": 2,
      "axes": {
        "coverage": 0,
        "accuracy": 4,
        "metadataRichness": 4,
        "provenanceBalance": 3
      },
      "score": 2.8,
      "reasoning": "Both rows are real methods, but they represent only validator methods and miss the much broader service/domain logic expected in the codebase relative to the 57-row anchor. Metadata is decent but not especially rich, and overall this type appears severely under-extracted."
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
      "reasoning": "No UI screens were emitted. This type is not weighted for the backend-service pack, so it does not affect the overall score."
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
      "reasoning": "No UI components were emitted. This type is not weighted for the backend-service pack, so it does not affect the overall score."
    }
  },
  "crossCutting": {
    "determinism": 2,
    "hallucinationRate": 5,
    "coverageOfObviousGaps": 3,
    "cost": 4
  },
  "overall": 3.7,
  "confidence": "baseline-anchored",
  "anomalies": [
    "Run is entirely adapter-derived (100% adapter, 0% LLM), which is acceptable for a strong Java/Spring pack but falls outside the rubric's ideal mixed pattern and may indicate no gap-fill stage contribution.",
    "Coverage is consistently well below the golden anchor across most weighted types: endpoints 17 vs 43, business_logics 2 vs 57, logical_data_entities 1 vs 27, and physical_data_attributes 19 vs 127.",
    "Accuracy and metadata quality of emitted rows are strong; the weakness is primarily breadth rather than noise.",
    "No deterministic heuristic flags were raised, so this looks more like partial extraction than a completely failed pack.",
    "Cost appears likely favorable because the run is small and adapter-only, with no evidence of runaway LLM usage."
  ]
}
```
