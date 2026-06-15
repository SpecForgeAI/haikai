; Capture PHP 8 attributes (T2.6).
; Symfony 6+: #[Route('/users', methods: ['GET'])]

; Attribute on class
(class_declaration
  (attribute_list
    (attribute_group
      (attribute
        (name) @attr.name
        (arguments)? @attr.args) @attr))
  name: (name) @class.name) @class

; Attribute on method
(method_declaration
  (attribute_list
    (attribute_group
      (attribute
        (name) @attr.name
        (arguments)? @attr.args) @attr))
  name: (name) @method.name) @method

; Qualified-name form: #[\Symfony\...\Route(...)]
(class_declaration
  (attribute_list
    (attribute_group
      (attribute
        (qualified_name) @attr.name
        (arguments)? @attr.args) @attr))
  name: (name) @class.name) @class

(method_declaration
  (attribute_list
    (attribute_group
      (attribute
        (qualified_name) @attr.name
        (arguments)? @attr.args) @attr))
  name: (name) @method.name) @method
