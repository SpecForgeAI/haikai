; Capture TypeScript/JavaScript route-registration calls (T3.2).
; app.get("/users", h), router.post("/login", h), someRouter.delete(...).

(call_expression
  function: (member_expression
    object: (_) @call.receiver
    property: (property_identifier) @call.method)
  arguments: (arguments) @call.args) @call
