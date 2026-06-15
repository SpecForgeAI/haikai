; Capture Python route-registration calls (T3.3).
; Examples: path('users/', views.list), re_path(r'^users/$', v), app.get('/users').

; path('route', handler) / re_path(r'route', handler) / url('route', handler)
(call
  function: (identifier) @call.method
  arguments: (argument_list) @call.args) @call

; app.get(...), router.post(...) — dotted-call form
(call
  function: (attribute
    object: (_) @call.receiver
    attribute: (identifier) @call.method)
  arguments: (argument_list) @call.args) @call
