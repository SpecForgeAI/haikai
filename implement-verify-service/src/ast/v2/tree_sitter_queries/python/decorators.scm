; Capture route decorators on Python functions (T2.3).
; Matches: @app.route(...), @router.get(...), @bp.route(...), @http.route(...).

; Decorator on a function definition: @router.get("/users")
(decorated_definition
  (decorator
    (call
      function: [
        (identifier) @dec.name
        (attribute
          object: (_) @dec.object
          attribute: (identifier) @dec.name)
      ]
      arguments: (argument_list) @dec.args)) @dec
  definition: (function_definition
    name: (identifier) @method.name)) @method

; Bare decorator (no call): @login_required, @staticmethod
(decorated_definition
  (decorator
    (identifier) @dec.name) @dec
  definition: (function_definition
    name: (identifier) @method.name)) @method

; Class-level decorator
(decorated_definition
  (decorator
    (call
      function: [
        (identifier) @dec.name
        (attribute attribute: (identifier) @dec.name)
      ]
      arguments: (argument_list) @dec.args)) @dec
  definition: (class_definition
    name: (identifier) @class.name)) @class
