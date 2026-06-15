; Capture PHP route-registration calls (T3.4).
; $app->get('/x', $h), Route::post('/login', 'Ctrl@store'), $router->delete(...)

; Method call on $var: $app->get('/x', $h) — node type is `member_call_expression`
(member_call_expression
  object: (variable_name) @call.receiver
  name: (name) @call.method
  arguments: (arguments) @call.args) @call

; Static call: Route::get('/x', 'Ctrl@idx')
(scoped_call_expression
  scope: (name) @call.receiver
  name: (name) @call.method
  arguments: (arguments) @call.args) @call

; Function call: register_rest_route('ns', '/x', $args)
(function_call_expression
  function: (name) @call.method
  arguments: (arguments) @call.args) @call
