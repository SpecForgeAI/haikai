# Structural Samples — python-fastapi

Showing 10 of 18 complex files.

These are what the LLM receives instead of raw source code.


## /tmp/test-python-fastapi/docs_src/additional_responses/tutorial001_py310.py
```
Imports:
  fastapi (FastAPI)
  fastapi.responses (JSONResponse)
  pydantic (BaseModel)

Symbols:
  class: Item extends BaseModel
  class: Message extends BaseModel
  variable: app
  function: read_item(item_id: str)
    unknown: item_id

Inheritance:
  Item -> BaseModel
  Message -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 15, external)
    -> app.get (line 18, external)
  read_item:
    -> JSONResponse (line 22, external)
```


## /tmp/test-python-fastapi/docs_src/additional_responses/tutorial003_py310.py
```
Imports:
  fastapi (FastAPI)
  fastapi.responses (JSONResponse)
  pydantic (BaseModel)

Symbols:
  class: Item extends BaseModel
  class: Message extends BaseModel
  variable: app
  function: read_item(item_id: str)
    unknown: item_id

Inheritance:
  Item -> BaseModel
  Message -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 15, external)
    -> app.get (line 18, external)
  read_item:
    -> JSONResponse (line 37, external)
```


## /tmp/test-python-fastapi/docs_src/app_testing/app_b_an_py310/main.py
```
Imports:
  typing (Annotated)
  fastapi (FastAPI, Header, HTTPException)
  pydantic (BaseModel)

Symbols:
  variable: fake_secret_token
  variable: fake_db
  variable: app
  class: Item extends BaseModel
  function: read_main(item_id: str, x_token: Annotated[str, Header()])
    unknown: item_id
    unknown: x_token
  function: create_item(item: Item, x_token: Annotated[str, Header()])
    unknown: item
    unknown: x_token

Inheritance:
  Item -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 13, external)
    -> app.get (line 22, external)
    -> app.post (line 31, external)
  create_item:
    -> Header (line 32, external)
    -> HTTPException (line 34, external)
    -> HTTPException (line 36, external)
    -> item.model_dump (line 37, external)
  read_main:
    -> Header (line 23, external)
    -> HTTPException (line 25, external)
    -> HTTPException (line 27, external)
```


## /tmp/test-python-fastapi/docs_src/app_testing/app_b_an_py310/test_main.py
```
Imports:
  fastapi.testclient (TestClient)
  .main (app)

Symbols:
  variable: client
  function: test_read_item()
    variable: response
  function: test_read_item_bad_token()
    variable: response
  function: test_read_nonexistent_item()
    variable: response
  function: test_create_item()
    variable: response
  function: test_create_item_bad_token()
    variable: response
  function: test_create_existing_item()
    variable: response

Calls:
  <module>:
    -> TestClient (line 5, external)
  test_create_existing_item:
    -> client.post (line 55, external)
    -> response.json (line 65, external)
  test_create_item:
    -> client.post (line 31, external)
    -> response.json (line 37, external)
  test_create_item_bad_token:
    -> client.post (line 45, external)
    -> response.json (line 51, external)
  test_read_item:
    -> client.get (line 9, external)
    -> response.json (line 11, external)
  test_read_item_bad_token:
    -> client.get (line 19, external)
    -> response.json (line 21, external)
  test_read_nonexistent_item:
    -> client.get (line 25, external)
    -> response.json (line 27, external)
```


## /tmp/test-python-fastapi/docs_src/app_testing/app_b_py310/main.py
```
Imports:
  fastapi (FastAPI, Header, HTTPException)
  pydantic (BaseModel)

Symbols:
  variable: fake_secret_token
  variable: fake_db
  variable: app
  class: Item extends BaseModel
  function: read_main(item_id: str, x_token: str = Header())
    unknown: item_id
    unknown: x_token
  function: create_item(item: Item, x_token: str = Header())
    unknown: item
    unknown: x_token

Inheritance:
  Item -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 11, external)
    -> app.get (line 20, external)
    -> app.post (line 29, external)
  create_item:
    -> Header (line 30, external)
    -> HTTPException (line 32, external)
    -> HTTPException (line 34, external)
    -> item.model_dump (line 35, external)
  read_main:
    -> Header (line 21, external)
    -> HTTPException (line 23, external)
    -> HTTPException (line 25, external)
```


## /tmp/test-python-fastapi/docs_src/app_testing/app_b_py310/test_main.py
```
Imports:
  fastapi.testclient (TestClient)
  .main (app)

Symbols:
  variable: client
  function: test_read_item()
    variable: response
  function: test_read_item_bad_token()
    variable: response
  function: test_read_nonexistent_item()
    variable: response
  function: test_create_item()
    variable: response
  function: test_create_item_bad_token()
    variable: response
  function: test_create_existing_item()
    variable: response

Calls:
  <module>:
    -> TestClient (line 5, external)
  test_create_existing_item:
    -> client.post (line 55, external)
    -> response.json (line 65, external)
  test_create_item:
    -> client.post (line 31, external)
    -> response.json (line 37, external)
  test_create_item_bad_token:
    -> client.post (line 45, external)
    -> response.json (line 51, external)
  test_read_item:
    -> client.get (line 9, external)
    -> response.json (line 11, external)
  test_read_item_bad_token:
    -> client.get (line 19, external)
    -> response.json (line 21, external)
  test_read_nonexistent_item:
    -> client.get (line 25, external)
    -> response.json (line 27, external)
```


## /tmp/test-python-fastapi/docs_src/app_testing/tutorial002_py310.py
```
Imports:
  fastapi (FastAPI)
  fastapi.testclient (TestClient)
  fastapi.websockets (WebSocket)

Symbols:
  variable: app
  function: read_main()
  function: websocket(websocket: WebSocket)
    unknown: websocket
  function: test_read_main()
    variable: client
    variable: response
  function: test_websocket()
    variable: client
    variable: data

Calls:
  <module>:
    -> FastAPI (line 5, external)
    -> app.get (line 8, external)
    -> app.websocket (line 13, external)
  test_read_main:
    -> TestClient (line 21, external)
    -> client.get (line 22, external)
    -> response.json (line 24, external)
  test_websocket:
    -> TestClient (line 28, external)
    -> client.websocket_connect (line 29, external)
    -> websocket.receive_json (line 30, external)
  websocket:
    -> websocket.accept (line 15, external)
    -> websocket.send_json (line 16, external)
    -> websocket.close (line 17, external)
```


## /tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial002_py310.py
```
Imports:
  fastapi (FastAPI)
  pydantic (BaseModel)

Symbols:
  variable: app
  class: Item extends BaseModel
  class: User extends BaseModel
  function: update_item(item_id: int, item: Item, user: User)
    unknown: item
    unknown: item_id
    unknown: user
    variable: results

Inheritance:
  Item -> BaseModel
  User -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 4, external)
    -> app.put (line 19, external)
```


## /tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial003_an_py310.py
```
Imports:
  typing (Annotated)
  fastapi (Body, FastAPI)
  pydantic (BaseModel)

Symbols:
  variable: app
  class: Item extends BaseModel
  class: User extends BaseModel
  function: update_item( item_id: int, item: Item, user: User, importance: Annotated[int, Body()] )
    unknown: importance
    unknown: item
    unknown: item_id
    unknown: user
    variable: results

Inheritance:
  Item -> BaseModel
  User -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 6, external)
    -> app.put (line 21, external)
  update_item:
    -> Body (line 23, external)
```


## /tmp/test-python-fastapi/docs_src/body_multiple_params/tutorial003_py310.py
```
Imports:
  fastapi (Body, FastAPI)
  pydantic (BaseModel)

Symbols:
  variable: app
  class: Item extends BaseModel
  class: User extends BaseModel
  function: update_item(item_id: int, item: Item, user: User, importance: int = Body())
    unknown: importance
    unknown: item
    unknown: item_id
    unknown: user
    variable: results

Inheritance:
  Item -> BaseModel
  User -> BaseModel

Calls:
  <module>:
    -> FastAPI (line 4, external)
    -> app.put (line 19, external)
  update_item:
    -> Body (line 20, external)
```
