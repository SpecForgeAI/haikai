; Capture Ruby DSL calls — Rails routing (T2.8).
; tree-sitter-ruby uses `call` for both `get 'x'` and `obj.method('x')` forms.

; Bare identifier call: get 'path', resources :users, root to: 'x'
(call
  method: (identifier) @call.name
  arguments: (argument_list) @call.args) @call

; Identifier call without method: field — fallback when grammar exposes the
; identifier as the first child rather than as a `method:` field.
(call
  (identifier) @call.name
  (argument_list) @call.args) @call
