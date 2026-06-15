# Oatpp framework guidance

An `oatpp` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — not to restate
what it already captured.

Oatpp is a modern C++ web framework built around heavy macro-based
code generation. Controllers, DTOs, the DI container, and the
Swagger/OpenAPI layer are all expressed via macros that expand at
compile time. The deterministic adapter falls back to raw-source
regex (because tree-sitter-cpp cannot parse Oatpp's macro bodies),
which captures the controller class + endpoint surface but misses
every other macro-driven construct: DTOs, components, the DI
graph, connection handlers, Swagger metadata, WebSocket handlers.

## What the adapter already catches (do NOT re-emit these)

- **Classes inheriting from any namespace-qualified `ApiController`
  base** (e.g. `oatpp::web::server::api::ApiController`). Detected
  via the regex `class\s+(\w+)\s*:\s*public\s+[\w:]*ApiController`
  on the raw source — bypasses tree-sitter entirely because the
  surrounding `ENDPOINT(...)` macro bodies cause the parser to
  emit ERROR nodes for the entire class. Emitted as `interfaces`
  candidates with `controllerType: 'OatppController'`.
- **`ENDPOINT("METHOD", "/url", handlerName, ...)` macro
  invocations** inside any file that contains an ApiController
  subclass. Detected via the regex `ENDPOINT\s*\(\s*"([A-Z]+)"\s*
  ,\s*"([^"]+)"\s*,\s*(\w+)`. Emitted as `endpoints` candidates
  with `httpMethod`, `fullPath`, `methodName`, and
  `controllerClassName`. The first ApiController class in the
  file is used as `controllerClassName` for every endpoint —
  apps with multiple controllers per file are misattributed (a
  rare pattern but worth noting).

The adapter requires LITERAL string arguments for both the HTTP
method and URL. `ENDPOINT(method.c_str(), url.c_str(), ...)` with
variable arguments is invisible. The third argument (the handler
name) must also be a bare identifier; method-pointer expressions
or template-parameterised handlers are missed.

## What the adapter MISSES (your target surface area)

- **DTO definition macros (`DTO_INIT` / `DTO_FIELD`).** Oatpp
  expresses request and response object schemas via a deeply
  nested macro pattern:
  ```cpp
  class UserDto : public oatpp::DTO {
    DTO_INIT(UserDto, DTO)
    DTO_FIELD(String, name);
    DTO_FIELD(Int32, age);
    DTO_FIELD(List<String>, tags);
  };
  ```
  Tree-sitter sees the entire class body as opaque. The DTO
  fields define the JSON / XML schema for every endpoint's
  request / response. **Surface each `DTO_FIELD` declaration as
  a `logical_data_attributes` candidate** with the field name +
  type. The `class X : public oatpp::DTO` (or more commonly
  `class X : public DTO` after `using DTO = oatpp::DTO;`) is
  the parent `logical_data_entities`. This is the entire schema layer
  of an Oatpp service.
- **Object-mapping macros.** Apps register DTO ⇄ JSON / XML /
  Protobuf object mappers via
  `OATPP_CREATE_COMPONENT(std::shared_ptr<ObjectMapper>, ...)`.
  These wire serialisation behaviour — invisible to the adapter.
  Surface them as service infrastructure.
- **Component provider registration via `OATPP_CREATE_COMPONENT`
  / `OATPP_COMPONENT`.** Oatpp's DI container is declared via:
  ```cpp
  class AppComponent {
  public:
    OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::network::ServerConnectionProvider>, serverConnectionProvider)([] {
      return oatpp::network::tcp::server::ConnectionProvider::createShared({"0.0.0.0", 8000});
    }());

    OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::web::server::HttpRouter>, httpRouter)([] {
      return oatpp::web::server::HttpRouter::createShared();
    }());
  };

  // and consumed via:
  class UserController {
    OATPP_COMPONENT(std::shared_ptr<UserDb>, m_database);
  };
  ```
  Each `OATPP_CREATE_COMPONENT` declares a singleton bean; each
  `OATPP_COMPONENT` injects one. The adapter sees neither. **Surface
  every `OATPP_CREATE_COMPONENT` as a registered service /
  component bean** with name + provided type. Surface every
  `OATPP_COMPONENT` as a dependency edge. This is the DI graph.
- **Connection handler chains.** Apps wire HTTP and WebSocket
  connection handlers via:
  ```cpp
  OATPP_CREATE_COMPONENT(std::shared_ptr<ConnectionHandler>, connectionHandler)("http", [] {
    OATPP_COMPONENT(std::shared_ptr<HttpRouter>, router);
    return HttpConnectionHandler::createShared(router);
  }());
  ```
  Multiple handlers may be registered for different protocols
  (HTTP, WebSocket, raw TCP). The chain configuration determines
  routing behaviour — surface it.
- **Swagger / OpenAPI macros.** Endpoints are documented for
  Swagger via macros that wrap or precede `ENDPOINT()`:
  ```cpp
  ENDPOINT_INFO(getUser) {
    info->summary = "Get user by id";
    info->addResponse<Object<UserDto>>(Status::CODE_200, "application/json");
    info->addResponse<Object<StatusDto>>(Status::CODE_404, "application/json");
    info->pathParams["id"].description = "User identifier";
  }
  ENDPOINT("GET", "/users/{id}", getUser, PATH(Int32, id)) { ... }
  ```
  The `ENDPOINT_INFO(...)` macro provides the OpenAPI metadata
  the adapter does not extract. Surface response schemas, path-
  param descriptions, and summary text from each
  `ENDPOINT_INFO` block — these belong on the corresponding
  `endpoints` candidate.
- **WebSocket handlers.** Oatpp WebSocket support uses a
  separate API:
  ```cpp
  class ChatSocket : public oatpp::websocket::AsyncWebSocket::Listener {
    CoroutineStarter onPing(const std::shared_ptr<AsyncWebSocket>& socket, const oatpp::String& message) override;
    CoroutineStarter onMessage(const std::shared_ptr<AsyncWebSocket>& socket, v_uint8 opcode, p_char8 data, oatpp::v_io_size size) override;
    // ...
  };
  ```
  These are real classes with real methods (no macros) so tree-
  sitter parses them correctly, but the adapter's controller-
  class regex requires `ApiController` in the base — WebSocket
  listeners extend `AsyncWebSocket::Listener` instead. Missed.
  **Surface WebSocket listener classes as `interfaces` candidates**
  with the override-method signatures as `endpoints`.
- **Async chain endpoints (`ENDPOINT_ASYNC`).** The async-
  capable endpoint variant has a different macro shape:
  ```cpp
  ENDPOINT_ASYNC("GET", "/users", getUsers) {
    ENDPOINT_ASYNC_INIT(getUsers)
    Action act() override {
      return _return(controller->createResponse(Status::CODE_200, "OK"));
    }
  };
  ```
  The adapter's regex is `ENDPOINT(...)` — it does NOT match
  `ENDPOINT_ASYNC(...)`. **Surface async endpoints separately**
  with the same shape as sync ones plus a flag indicating they
  use the coroutine API.
- **Path / Query / Header / Body parameter declarations.** The
  third+ arguments to `ENDPOINT(...)` are macro-wrapped parameter
  declarations:
  ```cpp
  ENDPOINT("POST", "/users/{id}/posts",
           createPost,
           PATH(Int32, id),
           HEADER(String, authToken),
           QUERY(String, draft),
           BODY_DTO(Object<PostDto>, postDto)) { ... }
  ```
  The adapter's regex captures the handler name but stops there
  — `PATH` / `HEADER` / `QUERY` / `BODY_DTO` / `REQUEST` /
  `BUNDLE` declarations are invisible. **Surface every parameter
  macro as part of the endpoint signature** so the request
  contract is complete.
- **Authentication endpoints.** `BEARER_AUTHORIZATION` /
  `BASIC_AUTHORIZATION` / `AUTHORIZATION` macros declare per-
  endpoint authentication requirements; invisible to regex.
- **API client classes.** `class UserApiClient : public oatpp::
  web::client::ApiClient { API_CLIENT_INIT(UserApiClient)
  API_CALL("GET", "/users/{id}", getUser, PATH(Int32, id)); };`
  declares an HTTP client mirror of a server endpoint. Invisible
  to the adapter. Surface as outbound integration boundary.
- **Error handlers.** Custom `ErrorHandler` classes implementing
  `handleError(const oatpp::web::protocol::http::Status&,
  const oatpp::String&, const Headers&)` define the global error
  surface; surface as cross-cutting concern.

## Idioms to recognise as cues

- **`oatpp::Object<X>` / `oatpp::List<X>` / `oatpp::Vector<X>` /
  `oatpp::String` / `oatpp::Int32`** are the framework's
  reference-counted DTO field types. Their presence in a class
  body strongly suggests the class is a DTO even if the
  `DTO_FIELD` macros are not visible.
- **`OATPP_LOGD` / `OATPP_LOGI` / `OATPP_LOGE`** are the logging
  macros. Their presence is a cue for cross-cutting logging
  concerns.
- **`OATPP_ASSERT` / `OATPP_ASSERT_HTTP`** are precondition
  checks; OATPP_ASSERT_HTTP throws an HTTP error response when
  the precondition fails (similar to FastAPI's `HTTPException`).
- **`#include "oatpp/..."` headers.** Files importing
  `oatpp/web/server/api/ApiController.hpp` or
  `oatpp/core/data/mapping/type/Object.hpp` are framework users.
  Files importing only `oatpp/Types.hpp` are typically DTO
  modules.
- **The `App.cpp` / `App.hpp` convention** holds the application's
  `run()` entry point that wires components and starts the
  HTTP server. If the file you are looking at uses `App` or
  `Application` in its name and contains
  `OATPP_COMPONENT(std::shared_ptr<...>, ...)` injections, it
  is the application bootstrap.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
