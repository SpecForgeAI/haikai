; Capture TypeScript decorators (T2.4).
; Decorators are SIBLINGS of the decorated node in tree-sitter-typescript.

; Class decorator via `export @X class Y`
(export_statement
  (decorator) @dec
  (class_declaration name: (type_identifier) @class.name) @class)

; Method decorator inside a class body. The `.` anchor ensures the decorator
; is the IMMEDIATE preceding sibling of the method_definition, not any pair.
(class_body
  (decorator) @dec
  .
  (method_definition
    name: [(property_identifier) (identifier)] @method.name) @method)
