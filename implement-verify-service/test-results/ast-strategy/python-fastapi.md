# Structural Analysis Standards

## Overview

- **Files analyzed:** 100
- **Total symbols:** 438 (156 variable, 124 unknown, 108 function, 49 class, 1 method)
- **Total call edges:** 305
- **Total imports:** 151
- **Inheritance chains:** 49

## Languages

- Python: 73 files
- python: 27 files

## Frameworks & Libraries

- **FastAPI** (web) — 91 files, confidence 1.0
- **Pydantic** (validation) — 35 files, confidence 0.7
- **pytest** (testing) — 1 files, confidence 0.02

## Dependency Graph (Top 15 Imports)

| Module | Files |
|--------|------:|
| fastapi | 69 |
| pydantic | 35 |
| typing | 13 |
| fastapi.testclient | 7 |
| fastapi.responses | 6 |
| .main | 4 |
| fastapi.encoders | 2 |
| fastapi.security | 1 |
| pydantic_settings | 1 |
| fastapi.middleware.httpsredirect | 1 |
| fastapi.middleware.trustedhost | 1 |
| fastapi.middleware.gzip | 1 |
| fastapi.websockets | 1 |
| contextlib | 1 |
| .dependencies | 1 |

## Call Graph Hotspots (Top 15)

| Target | Calls |
|--------|------:|
| FastAPI | 65 |
| app.get | 39 |
| app.put | 22 |
| response.json | 18 |
| HTTPException | 13 |
| Body | 12 |
| client.get | 11 |
| app.post | 10 |
| TestClient | 8 |
| Cookie | 6 |
| Depends | 6 |
| item.model_dump | 6 |
| results.update | 6 |
| client.post | 6 |
| set | 5 |

## Inheritance

- Cookies → BaseModel
- Cookies → BaseModel
- Cookies → BaseModel
- Cookies → BaseModel
- HTTPBearer403 → HTTPBearer
- Image → BaseModel
- Item → BaseModel
- Image → BaseModel
- Item → BaseModel
- Image → BaseModel
- Item → BaseModel
- Image → BaseModel
- Item → BaseModel
- Offer → BaseModel
- Image → BaseModel
- Item → BaseModel
- Message → BaseModel
- Item → BaseModel
- Item → BaseModel
- Message → BaseModel

## Triage Summary

- **Trivial files (SKIP):** 82
- **Complex files (ANALYZE):** 18

Complex files:
- `/tmp/test-python-fastapi/docs_src/additional_responses/tutorial001_py310.py` (complexity: 0.32)
- `/tmp/test-python-fastapi/docs_src/additional_responses/tutorial003_py310.py` (complexity: 0.32)
- `/tmp/test-python-fastapi/docs_src/app_testing/app_b_an_py310/main.py` (complexity: 0.39)
- `/tmp/test-python-fastapi/docs_src/app_testing/app_b_an_py310/test_main.py` (complexity: 0.33)
- `/tmp/test-python-fastapi/docs_src/app_testing/app_b_py310/main.py` (complexity: 0.38)
- `/tmp/test-python-fastapi/docs_src/app_testing/app_b_py310/test_main.py` (complexity: 0.33)
- `/tmp/test-python-fastapi/docs_src/app_testing/tutorial002_py310.py` (complexity: 0.31)
- `/tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial002_py310.py` (complexity: 0.31)
- `/tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial003_an_py310.py` (complexity: 0.35)
- `/tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial003_py310.py` (complexity: 0.34)
- `/tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial004_an_py310.py` (complexity: 0.37)
- `/tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial004_py310.py` (complexity: 0.36)
- `/tmp/test-python-fastapi/docs_src/body_nested_models/tutorial004_py310.py` (complexity: 0.33)
- `/tmp/test-python-fastapi/docs_src/body_nested_models/tutorial005_py310.py` (complexity: 0.33)
- `/tmp/test-python-fastapi/docs_src/body_nested_models/tutorial006_py310.py` (complexity: 0.33)
- `/tmp/test-python-fastapi/docs_src/body_nested_models/tutorial007_py310.py` (complexity: 0.41)
- `/tmp/test-python-fastapi/docs_src/body_updates/tutorial001_py310.py` (complexity: 0.3)
- `/tmp/test-python-fastapi/docs_src/body_updates/tutorial002_py310.py` (complexity: 0.37)

## Structural Practices

- Object-oriented design (class-based)
- Inheritance-based polymorphism
- High inter-module coupling (many call edges)
