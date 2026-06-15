# FastAPI Coding Standards & Conventions

## Overview

This document synthesizes structural analysis and LLM interpretations across 100 analyzed files (73 Python, 27 python-classified) to establish cohesive coding standards for a FastAPI-based codebase.

**Analysis Scope:**
- 438 total symbols (156 variables, 124 unknown, 108 functions, 49 classes, 1 method)
- 305 call edges mapping inter-module dependencies
- 151 total imports
- Primary frameworks: FastAPI (91 files, confidence 1.0), Pydantic (35 files, confidence 0.7)

---

## I. Naming Conventions

### Classes (PascalCase)

**Standard:** Use `PascalCase` for all class names.

**Scope:**
- Pydantic models (data validation): `Item`, `User`, `Message`, `Image`, `Offer`
- Domain entities
- Exception subclasses

**Rationale:** PEP 8 compliance; enables automatic Pydantic validation and OpenAPI schema generation.

**Example:**
```python
class Item(BaseModel):
    name: str
    price: float

class HTTPBearer403(HTTPBearer):
    pass
```

---

### Functions (snake_case)

**Standard:** Use `snake_case` for all function and method names.

**Patterns:**
- **Route handlers:** `verb_resource_variant` format
  - `read_item`, `create_item`, `update_item`, `delete_item`
  - `read_main`, `read_nonexistent_item`
- **Dependencies:** `verify_*`, `get_*`
  - `verify_token`, `get_db_connection`
- **Test functions:** `test_<action>_<scenario>`
  - `test_read_item`, `test_read_item_bad_token`, `test_create_existing_item`

**Rationale:** PEP 8 compliance; semantic clarity aids API discoverability.

**Example:**
```python
@app.get("/items/{item_id}")
def read_item(item_id: int) -> Item:
    ...

def test_read_item_bad_token():
    ...
```

---

### Variables & Parameters (snake_case)

**Standard:** Use `snake_case` for module-level variables, local variables, and function parameters.

**Special Patterns:**
- **Mock data prefix:** Use `fake_` prefix to clearly distinguish test/non-production values
  - `fake_secret_token`, `fake_db`
- **Module-level FastAPI instance:** `app` (lowercase conventional)
- **Test fixtures:** `client` (shared TestClient instance)
- **Response objects:** `response` (from TestClient)

**Rationale:** PEP 8 compliance; `fake_` prefix prevents accidental production use.

**Example:**
```python
fake_secret_token = "fake-super-secret-token"
fake_db = {"item-1": {"name": "Fake Item"}}

@app.get("/items/{item_id}")
def read_item(item_id: str, item: Item) -> dict:
    results = {"item_id": item_id}
    return results
```

---

## II. Type Annotation Standards

### Mandatory Type Hints

**Standard:** All function parameters and return types **must** have explicit type annotations.

**Scope:**
- FastAPI route handlers
- Pydantic model fields
- Helper functions
- Test functions (where applicable)

**Rationale:** 
- Enables FastAPI automatic request validation and OpenAPI schema generation
- Supports IDE autocomplete and type checkers (mypy)
- Documents intent for maintainers

**Example:**
```python
# ✓ Good
@app.get("/items/{item_id}", response_model=Item)
def read_item(item_id: int, skip: int = 0) -> Item:
    ...

# ✗ Bad (missing return type)
@app.get("/items/{item_id}")
def read_item(item_id: int, skip: int = 0):
    ...
```

---

### Annotated for Complex Parameters

**Standard:** Use `Annotated` from `typing` for parameters with metadata or constraints.

**Use Cases:**
- Header extraction: `Annotated[str, Header()]`
- Body parameters with constraints: `Annotated[int, Body(gt=0)]`
- Query parameters: `Annotated[str, Query(min_length=3)]`

**Rationale:** Makes HTTP parameter sources explicit and enables fine-grained validation.

**Example:**
```python
from typing import Annotated
from fastapi import Body, Header

def update_item(
    item_id: int,
    item: Item,
    user: User,
    importance: Annotated[int, Body()] = 1,
    x_token: Annotated[str, Header()] = None
) -> dict:
    ...
```

---

### Pydantic BaseModel for Schemas

**Standard:** All request/response data structures **must** inherit from `pydantic.BaseModel`.

**Applies To:**
- Request bodies
- Response schemas
- Shared data transfer objects (DTOs)

**Rationale:**
- Automatic validation on instantiation
- Serialization via `model_dump()` for responses
- OpenAPI documentation generation
- Type safety

**Example:**
```python
from pydantic import BaseModel

class Item(BaseModel):
    name: str
    description: str | None = None
    price: float
    tax: float | None = None

class User(BaseModel):
    username: str
    email: str
```

---

## III. Route Definition & Handler Patterns

### FastAPI Decorator-Based Routing

**Standard:** Use FastAPI decorators (`@app.get`, `@app.post`, `@app.put`, `@app.delete`) for all route registration.

**Pattern:**
```python
app = FastAPI()

@app.get("/items/{item_id}", response_model=Item)
def read_item(item_id: int) -> Item:
    ...

@app.post("/items/", response_model=Item)
def create_item(item: Item) -> Item:
    ...

@app.put("/items/{item_id}")
def update_item(item_id: int, item: Item, user: User) -> dict:
    ...
```

**Key Points:**
- Route path should be lowercase with hyphens or forward slashes
- HTTP method conveyed via decorator (`get`, `post`, `put`, `delete`)
- Path parameters extracted from `{param}` syntax
- Handler function signature uses type hints for body/query/header extraction

**Rationale:** Declarative routing provides clean API definition and automatic documentation.

---

### Handler Function Signature

**Standard:** Structure handler parameters to match HTTP semantics.

**Parameter Source Inference:**
1. **Path parameters:** Extracted from route path `{item_id}`
2. **Body parameters:** Pydantic models or primitives (inferred from type)
3. **Query parameters:** Optional or `Query()` annotation
4. **Headers:** `Header()` annotation

**Example:**
```python
@app.put("/items/{item_id}")
def update_item(
    item_id: int,                                  # Path parameter
    item: Item,                                    # Body parameter (Pydantic model)
    importance: Annotated[int, Body()] = 1,      # Explicit body primitive
    skip: int = 0                                  # Query parameter (default value)
) -> dict:
    return {"item_id": item_id, "item": item}
```

---

## IV. Data Validation & Response Handling

### Request Validation via Pydantic

**Standard:** Leverage Pydantic's automatic validation on model instantiation.

**Validation Triggers:**
- Type mismatches (e.g., `"not-a-number"` for `int` field)
- Missing required fields
- Custom validators (via `@field_validator`)

**Error Responses:** FastAPI returns 422 Unprocessable Entity with validation details automatically.

**Example:**
```python
class Item(BaseModel):
    name: str
    price: float  # Rejects non-numeric values

# Client sends: {"name": "Widget", "price": "not-a-number"}
# Response: 422 Unprocessable Entity with error details
```

---

### Explicit Response Types

**Standard:** Use explicit response models via `response_model` parameter when deviating from automatic serialization.

**Pattern:**
```python
@app.get("/items/{item_id}", response_model=Item)
def read_item(item_id: int) -> Item:
    ...

# For custom responses (headers, status codes):
from fastapi.responses import JSONResponse

def read_item(item_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={"item_id": item_id},
        headers={"X-Custom-Header": "value"}
    )
```

**Rationale:**
- `response_model` ensures response validation and OpenAPI documentation
- `JSONResponse` for non-standard responses (custom headers, unusual status codes)

---

## V. Error Handling & HTTP Exceptions

### HTTPException for API Errors

**Standard:** Raise `HTTPException` with explicit `status_code` and `detail` for API-level errors.

**Pattern:**
```python
from fastapi import HTTPException

@app.get("/items/{item_id}")
def read_item(item_id: int) -> Item:
    if item_id not in fake_db:
        raise HTTPException(
            status_code=404,
            detail=f"Item {item_id} not found"
        )
    return fake_db[item_id]

@app.post("/items/")
def create_item(item: Item) -> Item:
    if item.name in [i.name for i in fake_db.values()]:
        raise HTTPException(
            status_code=409,
            detail="Item with this name already exists"
        )
    return item
```

**Supported Status Codes:**
- `400` Bad Request (validation/logic error)
- `401` Unauthorized (authentication failure)
- `403` Forbidden (authorization failure)
- `404` Not Found (resource missing)
- `409` Conflict (duplicate/business rule violation)
- `422` Unprocessable Entity (validation error—automatic from Pydantic)
- `500` Internal Server Error (unhandled exception)

**Rationale:** Explicit exceptions allow clients to handle specific error conditions.

---

### Extracting Repeated Validation Logic

**Standard:** Extract repeated validation (e.g., token checks) into reusable dependency functions.

**Anti-Pattern (Duplication):**
```python
@app.get("/items/")
def read_items(x_token: Annotated[str, Header()]) -> list:
    if x_token != fake_secret_token:
        raise HTTPException(status_code=403, detail="Invalid token")
    # ... read logic

@app.post("/items/")
def create_item(item: Item, x_token: Annotated[str, Header()]) -> Item:
    if x_token != fake_secret_token:
        raise HTTPException(status_code=403, detail="Invalid token")
    # ... create logic
```

**Refactored (Reusable Dependency):**
```python
def verify_token(x_token: Annotated[str, Header()]) -> str:
    if x_token != fake_secret_token:
        raise HTTPException(status_code=403, detail="Invalid token")
    return x_token

@app.get("/items/", dependencies=[Depends(verify_token)])
def read_items() -> list:
    # ... read logic (token already verified)

@app.post("/items/", dependencies=[Depends(verify_token)])
def create_item(item: Item) -> Item:
    # ... create logic (token already verified)
```

**Rationale:** DRY principle; centralized token validation enables consistent error handling and easier maintenance.

---

## VI. Testing Standards

### Test Structure & Organization

**Standard:** Use `pytest` with FastAPI `TestClient` for integration testing.

**File Organization:**
- Test files named `test_*.py` for automatic pytest discovery
- Flat function-based tests or class-based grouping by feature
- Module-level `TestClient` instantiation for shared use

**Pattern:**
```python
from fastapi.testclient import TestClient
from .main import app

client = TestClient(app)

def test_read_item():
    response = client.get("/items/1")
    assert response.status_code == 200
    assert response.json()["name"] == "Widget"

def test_read_item_not_found():
    response = client.get("/items/999")
    assert response.status_code == 404
```

---

### Test Naming Convention

**Standard:** Use `test_<action>_<scenario>` naming for clarity.

**Pattern:**
- **Happy path:** `test_read_item`, `test_create_item`
- **Error conditions:** `test_read_item_bad_token`, `test_create_item_duplicate`
- **Edge cases:** `test_read_nonexistent_item`, `test_create_existing_item`

**Rationale:** Test names document expected behavior and failure modes.

---

### Response Assertion Requirements

**Standard:** **Always assert on both `response.status_code` and `response.json()` content.** Never extract without validation.

**Mandatory Pattern:**
```python
def test_create_item():
    response = client.post(
        "/items/",
        json={"name": "Widget", "price": 19.99}
    )
    assert response.status_code == 201  # ✓ Validate status
    data = response.json()
    assert data["name"] == "Widget"     # ✓ Validate content
    assert data["price"] == 19.99
```

**Anti-Pattern:**
```python
# ✗ Bad: Extract without validating
def test_create_item():
    response = client.post("/items/", json={"name": "Widget"})
    data = response.json()  # No status code check; assumes success
```

**Rationale:** Incomplete assertions lead to false test passes; status code and payload must both be validated.

---

### Scenario Coverage

**Standard:** For each endpoint, test:
1. **Success path** (2xx response)
2. **Authentication failures** (401/403 if applicable)
3. **Validation failures** (400/422)
4. **Not found** (404)
5. **Conflict/duplicate** (409) if applicable

**Example Coverage (6 tests for 2 endpoints):**
- `test_read_item` — success
- `test_read_item_bad_token` — auth failure
- `test_read_nonexistent_item` — 404
- `test_create_item` — success
- `test_create_item_bad_token` — auth failure
- `test_create_existing_item` — conflict

---

## VII. Dependency Injection Patterns

### FastAPI Dependency System

**Standard:** Use `Depends()` for reusable logic (validation, auth, database access).

**Pattern:**
```python
from fastapi import Depends

def get_db() -> dict:
    return {"items": [...]}

def verify_token(x_token: Annotated[str, Header()]) -> str:
    if x_token != "secret":
        raise HTTPException(status_code=403)
    return x_token

@app.get("/items/")
def read_items(
    db: dict = Depends(get_db),
    token: str = Depends(verify_token)
) -> list:
    return db["items"]
```

**Benefits:**
- Code reusability across multiple endpoints
- Automatic dependency caching per request
- Easy testing via dependency overrides

---

### Header & Query Parameter Dependencies

**Standard:** Use `Header()` and `Query()` annotations for explicit parameter source binding.

**Pattern:**
```python
from fastapi import Header, Query

@app.get("/items/")
def read_items(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(le=100)] = 10,
    x_token: Annotated[str, Header()] = None
) -> list:
    ...
```

**Rationale:** Explicit annotations clarify HTTP parameter sources and enable validation constraints.

---

## VIII. Module & File Organization

### File Structure

**Standard:** Single-file modules acceptable for tutorials and simple applications; production code should use layered structure.

**Layers (for production):**
```
project/
├── main.py           # FastAPI app instantiation
├── routes/           # Route