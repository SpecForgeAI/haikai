; Capture Go route-registration calls (T3.1).
; Examples: r.GET("/users", handler), router.POST("/login", h), mux.HandleFunc("/x", h)

; Method-call form: router.GET("/path", h)
(call_expression
  function: (selector_expression
    operand: (_) @call.receiver
    field: (field_identifier) @call.method)
  arguments: (argument_list) @call.args) @call

; Function-call form: HandleFunc("/x", h)
(call_expression
  function: (identifier) @call.method
  arguments: (argument_list) @call.args) @call
